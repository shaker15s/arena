/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: Image Weight axis source (React Native) ──────────────────
 *
 * An RN-exclusive, ADDITIVE, display-only meter that scores IMAGE OVERFETCH:
 * how much bigger the DECODED image is than the box it's actually painted in.
 * A 4000×3000 photo squeezed into a 100×100 avatar decodes ~1200× more pixels
 * than it displays — wasted decode time, memory, and (usually) bandwidth. The
 * axis reports the p75 overfetch ratio across measured images.
 *
 * overfetchX = p75 of (decoded pixel area) / (displayed pixel area, adjusted by
 * PixelRatio so a 100dp box on a 3× screen is fairly credited 300×300 device
 * pixels). Thresholds: good ≤2×, poor ≥8×. overfetchedCount = images whose
 * ratio ≥4×. Pending until ≥5 images measured.
 *
 * DATA SOURCE (two honest, release-safe paths):
 *   1. recordImage(decodedW, decodedH, displayedW, displayedH) — the host (or
 *      the kit's optional Image interception) reports one measurement. Plain
 *      numbers; nothing identifying reaches this layer.
 *   2. installImageWeightTracking() — a DEFAULT-ON, fully-guarded interception of
 *      React.createElement for RN <Image> elements. It chains onLoad (to read
 *      the decoded source size) and onLayout (to read the displayed box),
 *      delegating BYTE-IDENTICALLY to any host-provided handlers. Every wrapper
 *      is total-try/catch, and uninstall restores the original createElement.
 *
 * HONESTY / INVARIANTS:
 *   • NEVER feeds the composite Speed score (TTFF/TTI/FID). Display-only.
 *   • Works in RELEASE builds (onLoad/onLayout fire in production).
 *   • OMIT WHILE WARMING: readImageWeight() returns pending until ≥5 images.
 *   • NUMERIC-ONLY on the wire: { score, rating, overfetchX, overfetchedCount,
 *     imagesMeasured }. No caption — the server rebuilds it.
 *   • Bands: linearScore(overfetchX, good=2, poor=8).
 *
 * GUEST-SAFETY: the createElement wrapper ALWAYS delegates to the captured
 * original with identical args and returns its exact return value. Every
 * chained handler calls the host's original first (fail-soft), then does
 * best-effort bookkeeping. uninstall restores the original. No native modules,
 * no timers, no promises.
 */

import { linearScore, ratingFor, type AxisRating, type AxisThresholds } from "./axisScoring";
import {
  REASON_NOT_WIRED_BY_HOST,
  REASON_OFF_IN_THIS_BUILD,
} from "./axisReasons";

/** Overfetch score bands (decoded/displayed pixel-area ratio). ≤2× is
 *  reasonable (100); ≥8× is heavy overfetch (0). */
export const IMAGE_WEIGHT_THRESHOLDS = { good: 2, poor: 8 } as const satisfies AxisThresholds;

/** Ratio at/above which a single image counts as "overfetched" (for the
 *  informational overfetchedCount). */
const OVERFETCH_FLAG_RATIO = 4;

/** Images needed before the axis leaves "pending". */
const IMAGE_WEIGHT_MIN_SAMPLES = 5;

/** Bounded ring so a long session with many images stays flat in memory. */
const IMAGE_RING_CAP = 500;

export interface ImageWeightResult {
  /** 0–100, or null while pending (fewer than 5 images measured). */
  score:            number | null;
  rating:           AxisRating;
  /** p75 of decoded/displayed pixel-area ratio (1dp), or null while pending. */
  overfetchX:       number | null;
  /** Images whose ratio ≥4× (shown even while pending). */
  overfetchedCount: number;
  /** Images measured this session (shown even while pending). */
  imagesMeasured:   number;
  measurable:       0 | 1;
  reasonCode?:       number;
}

/** Per-image overfetch ratios (decoded area / displayed device-pixel area). */
const ratios: number[] = [];

/** Device pixel ratio, resolved lazily+best-effort so a displayed box in dp is
 *  fairly compared to decoded device pixels. Defaults to 1 if RN isn't present
 *  (e.g. unit tests / web) — a conservative lower bound on overfetch. */
let pixelRatio = 1;
let pixelRatioResolved = false;

function resolvePixelRatio(): number {
  if (pixelRatioResolved) return pixelRatio;
  pixelRatioResolved = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require("react-native") as {
      PixelRatio?: { get?: () => number };
    };
    const pr = rn?.PixelRatio?.get?.();
    if (typeof pr === "number" && Number.isFinite(pr) && pr > 0) pixelRatio = pr;
  } catch {
    /* not an RN runtime — keep 1 */
  }
  return pixelRatio;
}

/**
 * Record one image measurement: the DECODED intrinsic size (source pixels) and
 * the DISPLAYED box (in dp). Best-effort, NEVER throws. Ignores nonsensical or
 * zero-area inputs. The displayed area is scaled by PixelRatio² so it is in
 * device pixels, matching the decoded area's units.
 */
export function recordImage(
  decodedW: number,
  decodedH: number,
  displayedW: number,
  displayedH: number,
): void {
  try {
    if (
      !(decodedW > 0) || !(decodedH > 0) ||
      !(displayedW > 0) || !(displayedH > 0)
    ) {
      return;
    }
    const pr = resolvePixelRatio();
    const decodedArea = decodedW * decodedH;
    const displayedArea = displayedW * displayedH * pr * pr;
    if (!(displayedArea > 0)) return;
    const ratio = decodedArea / displayedArea;
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    ratios.push(ratio);
    if (ratios.length > IMAGE_RING_CAP) {
      ratios.splice(0, ratios.length - IMAGE_RING_CAP);
    }
  } catch {
    /* best-effort — a bookkeeping slip must never reach the host */
  }
}

/** Nearest-rank p75 of an unordered list (does not mutate). 0 when empty. */
function p75(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(0.75 * sorted.length) - 1));
  return sorted[idx];
}

/**
 * The Image Weight axis, or a pending reading while warming up (<5 images).
 * Pure read — never mutates state, NEVER throws. Numbers-only wire shape.
 */
export function readImageWeight(): ImageWeightResult {
  try {
    const imagesMeasured = ratios.length;
    const overfetchedCount = ratios.filter((r) => r >= OVERFETCH_FLAG_RATIO).length;
    // The interception was attempted and the host had no <Image> to wrap.
    // A host that simply has not opted in yet falls through to pending below:
    // "never asked us" and "about to ask us" are the same observation, and
    // neither is evidence about the platform.
    // The app switched the collector off. Its own decision, not this host's
    // limits and not a wait — so it gets the code for that and never the
    // "warming up" sentence. A refusing app that still calls recordImage()
    // by hand is measured, and the first real image ends this branch.
    if (hostRefused && imagesMeasured === 0) {
      return {
        score: null,
        rating: "not-available",
        overfetchX: null,
        overfetchedCount,
        imagesMeasured,
        measurable: 0,
        reasonCode: REASON_OFF_IN_THIS_BUILD,
      };
    }
    if (ceRefused && imagesMeasured === 0) {
      return {
        score: null,
        rating: "not-available",
        overfetchX: null,
        overfetchedCount,
        imagesMeasured,
        measurable: 0,
        reasonCode: REASON_NOT_WIRED_BY_HOST,
      };
    }
    if (imagesMeasured < IMAGE_WEIGHT_MIN_SAMPLES) {
      return {
        score:            null,
        rating:           "pending",
        overfetchX:       null,
        overfetchedCount,
        imagesMeasured,
        measurable:       1,
      };
    }
    const overfetchX = p75(ratios);
    const score = linearScore(
      overfetchX,
      IMAGE_WEIGHT_THRESHOLDS.good,
      IMAGE_WEIGHT_THRESHOLDS.poor,
    );
    return {
      score,
      rating:           ratingFor(score),
      overfetchX:       Math.round(overfetchX * 10) / 10,
      overfetchedCount,
      imagesMeasured,
      measurable:       1,
    };
  } catch {
    return {
      score:            null,
      rating:           "pending",
      overfetchX:       null,
      overfetchedCount: 0,
      imagesMeasured:   0,
      measurable:       0,
    };
  }
}

/* ─── DEFAULT-ON React.createElement interception for RN <Image> ─────────
 * Fully guarded: chains onLoad (decoded source size) + onLayout (displayed
 * box), delegates byte-identically to host handlers, restores on uninstall. */

interface ReactLike {
  createElement?: (type: unknown, props?: unknown, ...children: unknown[]) => unknown;
}
interface RNImageLike {
  Image?: unknown;
}

let ceInstalled = false;
/**
 * POSITIVE evidence that image measurement cannot be wired on this host: the
 * interception was ATTEMPTED and React or React Native's <Image> was not there
 * to wrap. A host that has simply not opted in yet is not this — it stays
 * pending and says what it is waiting for, because "the host never called us"
 * and "the host will call us in a moment" are the same observation.
 */
let ceRefused = false;
/**
 * The host asked us NOT to measure images (`trackImageWeight: false`).
 *
 * Distinct from both flags above: the interception was never attempted, and
 * that was the app's decision rather than anything about this host. Written
 * positively by the start path so the axis can say so.
 */
let hostRefused = false;
let origCreateElement:
  | ((type: unknown, props?: unknown, ...children: unknown[]) => unknown)
  | null = null;
let ReactRef: ReactLike | null = null;
let ImageType: unknown = null;

/** Per-element scratch: last decoded + displayed sizes, keyed transiently so
 *  onLoad and onLayout for the same element can be joined. We attach a small
 *  hidden holder object into the wrapped props' closure instead of a global
 *  map (no element identity to key on reliably), so each element gets its own. */

/**
 * Clone an <Image>'s props with measurement handlers chained onto onLoad and
 * onLayout, joining the decoded source size to the displayed box.
 *
 * Shared by BOTH ways a host can create that element. Patching
 * `React.createElement` alone measures nothing in a modern app: the automatic
 * JSX transform — the default in React Native's Babel preset, and what this
 * kit itself compiles with — emits calls to `react/jsx-runtime` instead, and
 * never touches createElement at all. A reading wired to only the classic path
 * is a collector that never fires on the hosts we actually ship to.
 *
 * Host handlers are delegated byte-identically first; a throw from one is the
 * host's own, exactly as without Boosthis.
 */
function measureImageProps(p: Record<string, unknown>): Record<string, unknown> {
  // Per-element scratch to join onLoad (decoded) + onLayout (displayed).
  const scratch: {
    decodedW?: number;
    decodedH?: number;
    displayW?: number;
    displayH?: number;
    recorded?: boolean;
  } = {};

  const maybeRecord = (): void => {
    if (scratch.recorded || scratch.decodedW == null || scratch.displayW == null) {
      return;
    }
    scratch.recorded = true;
    recordImage(
      scratch.decodedW,
      scratch.decodedH ?? 0,
      scratch.displayW,
      scratch.displayH ?? 0,
    );
  };

  const hostOnLoad = p.onLoad as ((e: unknown) => void) | undefined;
  const hostOnLayout = p.onLayout as ((e: unknown) => void) | undefined;

  const nextProps: Record<string, unknown> = { ...p };

  nextProps.onLoad = function (this: unknown, e: unknown): unknown {
    let ret: unknown;
    if (typeof hostOnLoad === "function") {
      ret = hostOnLoad.call(this, e);
    }
    try {
      const src = (e as { nativeEvent?: { source?: { width?: number; height?: number } } })
        ?.nativeEvent?.source;
      if (src && typeof src.width === "number" && typeof src.height === "number") {
        scratch.decodedW = src.width;
        scratch.decodedH = src.height;
        maybeRecord();
      }
    } catch {
      /* best-effort */
    }
    return ret;
  };

  nextProps.onLayout = function (this: unknown, e: unknown): unknown {
    let ret: unknown;
    if (typeof hostOnLayout === "function") {
      ret = hostOnLayout.call(this, e);
    }
    try {
      const layout = (e as { nativeEvent?: { layout?: { width?: number; height?: number } } })
        ?.nativeEvent?.layout;
      if (layout && typeof layout.width === "number" && typeof layout.height === "number") {
        scratch.displayW = layout.width;
        scratch.displayH = layout.height;
        maybeRecord();
      }
    } catch {
      /* best-effort */
    }
    return ret;
  };

  return nextProps;
}

/** React's production automatic-runtime module, or null if it will not load.
 *  Static specifier — see installJsxRuntimeInterception(). */
function loadJsxRuntime(): Record<string, unknown> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("react/jsx-runtime") as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** React's development automatic-runtime module, or null if it will not load. */
function loadJsxDevRuntime(): Record<string, unknown> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("react/jsx-dev-runtime") as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** A swapped export on one of React's JSX runtime modules, kept so teardown
 *  can put the host's own function back exactly. */
interface JsxRuntimePatch {
  mod:  Record<string, unknown>;
  key:  string;
  orig: (...args: unknown[]) => unknown;
}
let jsxPatches: JsxRuntimePatch[] = [];

/**
 * Wrap `jsx` / `jsxs` / `jsxDEV` on React's automatic-runtime modules, which is
 * where an ordinary `<Image ... />` in a modern app arrives. Best-effort: a
 * module that is missing, or whose exports are read-only, is skipped silently
 * and the classic path still stands. NEVER throws.
 */
function installJsxRuntimeInterception(): void {
  const names = ["jsx", "jsxs", "jsxDEV"];
  // Both specifiers are written out in full, deliberately. Metro reads every
  // require at BUILD time to decide what goes in the bundle, and a
  // `require(variable)` is a hard build error ("Invalid call") — the app does
  // not start at all. Nothing in this file may take a computed specifier.
  for (const mod of [loadJsxRuntime(), loadJsxDevRuntime()]) {
    if (!mod || typeof mod !== "object") continue;
    for (const name of names) {
      const current = mod[name];
      if (typeof current !== "function") continue;
      const orig = current as (...args: unknown[]) => unknown;
      const wrapped = function (type: unknown, props?: unknown, ...rest: unknown[]): unknown {
        try {
          if (type === ImageType && props && typeof props === "object") {
            return orig(type, measureImageProps(props as Record<string, unknown>), ...rest);
          }
        } catch {
          /* fall through to a byte-identical delegate below */
        }
        return orig(type, props, ...rest);
      };
      try {
        mod[name] = wrapped;
        // A frozen namespace accepts the write and keeps the old value; leave
        // it alone rather than recording a restore we never performed.
        if (mod[name] !== wrapped) continue;
        jsxPatches.push({ mod, key: name, orig });
      } catch {
        /* read-only export — the classic path still measures */
      }
    }
  }
}

/** Put every swapped JSX-runtime export back. Idempotent, NEVER throws. */
function uninstallJsxRuntimeInterception(): void {
  for (const patch of jsxPatches) {
    try {
      patch.mod[patch.key] = patch.orig;
    } catch {
      /* best-effort — teardown must never throw into the host */
    }
  }
  jsxPatches = [];
}

/**
 * Install the guarded createElement interception. DEFAULT-ON (refusable with
 * `trackImageWeight: false`), idempotent, best-effort, NEVER throws. On any
 * failure the original createElement is left in place and tracking simply
 * relies on manual recordImage() calls. The wrapper always delegates to the
 * original and returns its exact value.
 */
export function installImageWeightTracking(): void {
  hostRefused = false;
  const react = resolveReact();
  const image = resolveImageType();
  // A module we could not even load tells us nothing: it is a failed look, not
  // a look that found nothing, so it must not reach the permanent word.
  if (!react.looked || !image.looked) return;
  installImageWeightWith(react.mod, image.type);
}

/** Load React, saying whether the question could be asked at all. */
function resolveReact(): { looked: boolean; mod: ReactLike | null } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return { looked: true, mod: require("react") as ReactLike };
  } catch {
    return { looked: false, mod: null };
  }
}

/** Load React Native's <Image>, saying whether the question could be asked. */
function resolveImageType(): { looked: boolean; type: unknown } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require("react-native") as RNImageLike;
    return { looked: true, type: rn?.Image ?? null };
  } catch {
    return { looked: false, type: null };
  }
}

/**
 * Wire the interception onto an already-resolved React and <Image>. Split from
 * the resolution above so a test can drive the real wiring on a host where
 * `require("react-native")` cannot run, which is every non-Metro environment
 * the kit's own suite uses.
 */
function installImageWeightWith(react: ReactLike | null, image: unknown): void {
  if (ceInstalled) return;
  try {
    // Looked, and the surface to wrap is not here. Positive evidence, so the
    // read may say this host cannot supply the reading.
    if (!react || typeof react.createElement !== "function") {
      ceRefused = true;
      return;
    }
    if (image == null) {
      ceRefused = true;
      return;
    }
    ReactRef = react;
    ImageType = image;
    // The host's OWN function, kept BY REFERENCE so teardown puts back
    // exactly what was there — never the bound copy the wrapper calls below.
    // Restoring a bound copy leaves the host with a function it never wrote,
    // and anything comparing references (including the census stacked on top
    // of this one) is then told a Boosthis wrapper is still installed.
    origCreateElement = react.createElement;
    const orig = react.createElement.bind(react);

    const wrapped = function (
      type: unknown,
      props?: unknown,
      ...children: unknown[]
    ): unknown {
      // Only touch RN <Image>. Everything else delegates byte-identically.
      try {
        if (type === ImageType && props && typeof props === "object") {
          return orig(type, measureImageProps(props as Record<string, unknown>), ...children);
        }
      } catch {
        /* fall through to a byte-identical delegate below */
      }
      return orig(type, props, ...children);
    };

    (react as { createElement: unknown }).createElement = wrapped;
    // ...and the automatic runtime, which is where a modern app's JSX goes.
    installJsxRuntimeInterception();
    ceInstalled = true;
  } catch {
    // Wrapping failed — restore anything we swapped and stay OFF.
    try {
      uninstallImageWeightTracking();
    } catch {
      /* best-effort */
    }
    ceInstalled = false;
  }
}

/**
 * Restore the original React.createElement. Idempotent, NEVER throws. Wired into
 * telemetry.forget(). Note: measured ratios are cleared by resetImageWeight().
 */
export function uninstallImageWeightTracking(): void {
  try {
    if (ReactRef && origCreateElement) {
      (ReactRef as { createElement: unknown }).createElement = origCreateElement;
    }
  } catch {
    /* best-effort — never throw on teardown */
  }
  uninstallJsxRuntimeInterception();
  ReactRef = null;
  origCreateElement = null;
  ImageType = null;
  ceInstalled = false;
  // Teardown clears the claim with the interception: forget() leaves a kit
  // that has looked at nothing, and it must look again before saying a host
  // cannot supply this reading.
  ceRefused = false;
  hostRefused = false;
}

/**
 * Record that this app asked us not to measure images.
 *
 * Installs nothing and reads nothing — it only writes the refusal down, so the
 * Image Weight axis can say it is off in this build instead of warming up for
 * a measurement that will never be taken. `recordImage()` keeps working: an
 * app that refused the interception and still reports sizes by hand is
 * measured, and the refusal falls away the moment a real image arrives.
 */
export function refuseImageWeightTracking(): void {
  hostRefused = true;
}

/** Clear measured ratios (telemetry.forget() hook + tests). */
export function resetImageWeight(): void {
  ratios.length = 0;
  pixelRatio = 1;
  pixelRatioResolved = false;
  // A reset kit has looked at nothing. Keeping the refusal here would let a
  // fresh install inherit the last one's verdict about a different host.
  ceRefused = false;
  hostRefused = false;
}

/** @internal test hooks. */
export const _imageWeightInternals = {
  IMAGE_WEIGHT_THRESHOLDS,
  IMAGE_WEIGHT_MIN_SAMPLES,
  OVERFETCH_FLAG_RATIO,
  get sampleCount(): number {
    return ratios.length;
  },
  get isInstalled(): boolean {
    return ceInstalled;
  },
  /** How many automatic-runtime exports we currently have wrapped. 0 with the
   *  classic path alone, which is the shape that measured nothing in a modern
   *  app. */
  get jsxPatchCount(): number {
    return jsxPatches.length;
  },
  /** The wrapped `jsx` export ON THE MODULE OBJECT THE KIT PATCHED. A test
   *  that resolves `react/jsx-runtime` itself may get a different instance
   *  under a bundler's aliasing and would then prove nothing. */
  /** Drive the real wiring with modules the test resolved itself. */
  installWithForTests(react: unknown, image: unknown): void {
    installImageWeightWith(react as ReactLike, image);
  },
  get patchedJsx(): ((type: unknown, props?: unknown, key?: string) => unknown) | null {
    const patch = jsxPatches.find((entry) => entry.key === "jsx");
    if (!patch) return null;
    return patch.mod.jsx as (type: unknown, props?: unknown, key?: string) => unknown;
  },
  /** The attempt that found no React / <Image> surface to wrap. */
  setRefusedForTests(v: boolean): void {
    ceRefused = v;
  },
  get refused(): boolean {
    return ceRefused;
  },
  /** The app's own refusal of a default-on collector. */
  get hostRefused(): boolean {
    return hostRefused;
  },
  /** Force the device pixel ratio for deterministic tests. */
  setPixelRatioForTests(v: number): void {
    pixelRatio = v;
    pixelRatioResolved = true;
  },
  reset(): void {
    uninstallImageWeightTracking();
    resetImageWeight();
  },
};
