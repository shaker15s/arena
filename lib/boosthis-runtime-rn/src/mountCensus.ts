/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: mount census (RELEASE-SAFE) ────────────────────────────
 *
 * How many children does a scroll container mount in ONE commit?
 *
 * This exists because the reading that would otherwise answer it is switched
 * off where it matters. React's `<Profiler onRender>` is a no-op in release
 * builds, so renderProfiler's store stays empty in production and a screen
 * that synchronously mounts an entire API batch — 200 story cards, 500 media
 * tiles — is invisible to every axis the kit uploads.
 *
 * So this reads the element tree as it is BUILT, not as it is profiled. It
 * wraps `React.createElement` and the automatic JSX runtime's `jsx` / `jsxs` /
 * `jsxDEV` — the same interception `imageWeight.ts` already ships and which is
 * proven to fire in a production bundle — and counts the direct children
 * handed to a scroll container.
 *
 * Why this discriminates, and why a fixed screen stands down by construction
 * -------------------------------------------------------------------------
 * The defect is written `<ScrollView>{items.map(...)}</ScrollView>`: the
 * container is handed an array of N children and mounts all of them. The
 * remedy is written `<FlatList data={items} renderItem={...} />`: the
 * container is handed NO children at all — rows arrive later, a window at a
 * time, from inside the list. A virtualised list therefore never reaches this
 * census, and a screen that has been fixed stops reporting because of what it
 * now IS, not because a threshold happened not to trip.
 *
 * What is read
 * ------------
 * A count, a container's own type name, and the screen label the kit already
 * holds. Nothing about the person using the app, nothing about the content of
 * any row, no prop value of any child. A mounted child count is a structural
 * fact about the app.
 *
 * Where the threshold came from
 * -----------------------------
 * docs/decisions/mount-cost-proxy.md, derived from two observed populations
 * and React Native's own shipped render batch size. See MOUNT_CENSUS_THRESHOLD.
 */

import { isRuntimeInert } from "./killSwitch";
import { currentScreenLabel, subscribeScreenChange } from "./pageMap";

/**
 * The number of direct children above which a scroll container is mounting a
 * collection rather than a screen's own furniture.
 *
 * NOT a round figure. Determined by a stated rule over two observed
 * populations and one shipped constant — full derivation in
 * docs/decisions/mount-cost-proxy.md:
 *
 *   - Largest hand-written scroll container in every real React Native screen
 *     this repository holds: 17 children (measured; see
 *     scripts/live-proofs/rn-mount-cost/scrollview-children.json).
 *   - Smallest container in the observed defect: 200 children.
 *   - React Native's own `maxToRenderPerBatch` default: 10 — the most its own
 *     virtualiser will commit in one go.
 *
 * The rule: the smallest whole number of React Native render batches leaving
 * at least a 2x margin above the largest healthy container observed and at
 * least a 4x margin below the smallest observed defect. 30 fails the upper
 * margin (1.8x); 40 satisfies both (2.4x above, 5.0x below). 40 is therefore
 * the unique answer. Re-run the two scripts to re-derive it.
 */
export const MOUNT_CENSUS_THRESHOLD = 40;

/** Distinct (screen, container) pairs kept. A cap so a pathological app
 *  cannot grow this without bound; the weakest goes first. */
export const MAX_CENSUS_ENTRIES = 50;

/** Container types whose children are all mounted at once. Matched by the
 *  component's own name, so a host's `Animated.ScrollView`, a
 *  `KeyboardAwareScrollView` or any other wrapper that forwards to one is
 *  caught alongside React Native's own. */
const SCROLL_CONTAINER_NAMES = new Set([
  "ScrollView",
  "AnimatedScrollView",
  "KeyboardAwareScrollView",
  "KeyboardAvoidingScrollView",
  "ScrollViewNativeComponent",
  "RCTScrollView",
]);

/** One container on one screen, at its worst. */
export interface MountCensusRecord {
  /** The screen the kit was on when the container mounted, or null when no
   *  navigation had been observed yet. Three states, never two: a named
   *  screen, a screen we had not yet identified, and no record at all. */
  screen: string | null;
  /** The container's own type name, e.g. "ScrollView". */
  container: string;
  /** The most direct children this container was ever handed in one commit. */
  maxChildren: number;
  /** How many times this container mounted at or above the threshold. */
  overCount: number;
}

interface Entry extends MountCensusRecord {
  /** Monotonic recency stamp — the tie-break when counts are equal. */
  seq: number;
}

const entries = new Map<string, Entry>();
let seq = 0;
let truncated = false;

/* ─── Recording ──────────────────────────────────────────────────────── */

const KEY_SEP = "\u0000";

/**
 * How long after a container mounts a navigation may still claim it.
 *
 * A screen's children are created during the render that mounts the screen,
 * but the kit learns the screen's NAME only afterwards: React Navigation
 * emits its `state` event from a post-commit effect, and the expo-router /
 * custom-router path calls `noteScreenChange()` from an effect too. Reading
 * the label at mount time therefore names the PREVIOUS screen on every
 * navigation, and names nothing at all on the first screen of a cold start —
 * which is precisely the case this signal exists for.
 *
 * So a mount is held briefly and attributed once the screen for that commit
 * is known. The window has to cover render + commit + effect flush for the
 * worst container we score: the hand audit's worst long task on the defective
 * build was 240 ms, and 400 ms leaves that a margin while staying well below
 * the gap between a list appearing and a person tapping something on it.
 *
 * The trade-off is stated rather than hidden: a container that mounts on a
 * SETTLED screen fewer than 400 ms before a navigation is attributed to the
 * destination. That is the rarer error, and the alternative — the label at
 * mount time — is wrong on every navigation instead of on that one.
 */
export const MOUNT_ATTRIBUTION_WINDOW_MS = 400;

/** A mount whose screen is not settled yet. */
interface PendingMount {
  container: string;
  children: number;
  /** The label the kit held at mount time: the answer when nothing navigates. */
  labelAtMount: string | null;
  at: number;
}

/** Mounts waiting for their screen. Bounded — a burst cannot grow it. */
const pending: PendingMount[] = [];
const MAX_PENDING = 64;

/** Put one mount into the census under a decided screen. */
function commitMount(container: string, children: number, screen: string | null): void {
  const key = (screen ?? "") + KEY_SEP + container;
  seq++;
  const prev = entries.get(key);
  if (prev) {
    prev.maxChildren = Math.max(prev.maxChildren, children);
    prev.overCount++;
    prev.seq = seq;
    return;
  }
  entries.set(key, {
    screen,
    container,
    maxChildren: children,
    overCount: 1,
    seq,
  });
  while (entries.size > MAX_CENSUS_ENTRIES) {
    let worstKey: string | null = null;
    let worst: Entry | null = null;
    for (const [k, e] of entries) {
      if (
        !worst ||
        e.maxChildren < worst.maxChildren ||
        (e.maxChildren === worst.maxChildren && e.seq < worst.seq)
      ) {
        worst = e;
        worstKey = k;
      }
    }
    if (worstKey === null) break;
    entries.delete(worstKey);
    truncated = true;
  }
}

/** Fold every held mount the window has closed on: nothing navigated in time,
 *  so the label the kit held when it mounted is the answer. */
function foldSettled(now: number): void {
  if (pending.length === 0) return;
  const held: PendingMount[] = [];
  for (const p of pending) {
    if (now - p.at > MOUNT_ATTRIBUTION_WINDOW_MS) {
      commitMount(p.container, p.children, p.labelAtMount);
    } else {
      held.push(p);
    }
  }
  pending.length = 0;
  for (const p of held) pending.push(p);
}

/** A navigation landed. Every mount still inside the window was created by
 *  the render that produced it, so it belongs to the screen that just
 *  arrived — not to the one the kit was still holding while it rendered. */
function attributeToArrivedScreen(screen: string, now: number): void {
  if (pending.length === 0) return;
  for (const p of pending) {
    const claimed = now - p.at <= MOUNT_ATTRIBUTION_WINDOW_MS;
    commitMount(p.container, p.children, claimed ? screen : p.labelAtMount);
  }
  pending.length = 0;
}

/* The census is TOLD which screen settled rather than asking: pageMap is the
 * single funnel both navigation paths reach, and it reaches it after the
 * commit this mount happened in. */
subscribeScreenChange((label) => {
  try {
    attributeToArrivedScreen(label, Date.now());
  } catch {
    // never break the host's navigation
  }
});

/**
 * Record one scroll container's mount. Hot path: called once per scroll
 * container per commit, does nothing at all below the threshold, and NEVER
 * throws into the host.
 */
export function recordContainerMount(container: string, children: number): void {
  try {
    if (isRuntimeInert()) return;
    if (!container || children < MOUNT_CENSUS_THRESHOLD) return;
    const now = Date.now();
    foldSettled(now);
    pending.push({
      container,
      children,
      labelAtMount: currentScreenLabel(),
      at: now,
    });
    // The oldest held mount is the one closest to settling anyway, so a burst
    // commits it under the label it has rather than losing the reading.
    while (pending.length > MAX_PENDING) {
      const oldest = pending.shift();
      if (!oldest) break;
      commitMount(oldest.container, oldest.children, oldest.labelAtMount);
    }
  } catch {
    // the census must never break the host app
  }
}

/** Every container the census holds, worst first. ON-DEVICE read. */
export function getMountCensus(): MountCensusRecord[] {
  const now = Date.now();
  foldSettled(now);
  const out = new Map<string, MountCensusRecord>();
  for (const e of entries.values()) {
    out.set((e.screen ?? "") + KEY_SEP + e.container, {
      screen: e.screen,
      container: e.container,
      maxChildren: e.maxChildren,
      overCount: e.overCount,
    });
  }
  // A mount still inside its window is ANSWERED with the best label the kit
  // has now, but not committed under it: a navigation arriving a moment later
  // may still be the screen that produced it, and a read must not settle the
  // wrong name on the way past.
  for (const p of pending) {
    const key = (p.labelAtMount ?? "") + KEY_SEP + p.container;
    const prev = out.get(key);
    if (prev) {
      prev.maxChildren = Math.max(prev.maxChildren, p.children);
      prev.overCount++;
      continue;
    }
    out.set(key, {
      screen: p.labelAtMount,
      container: p.container,
      maxChildren: p.children,
      overCount: 1,
    });
  }
  return [...out.values()].sort((a, b) => b.maxChildren - a.maxChildren);
}

/** True when a cap evicted a container — the census is showing a subset. */
export function isMountCensusTruncated(): boolean {
  return truncated;
}

/* ─── Interception ───────────────────────────────────────────────────── */

interface ReactLike {
  createElement?: (type: unknown, props?: unknown, ...children: unknown[]) => unknown;
}

let installed = false;
/**
 * POSITIVE evidence that the census cannot be wired on this host: the
 * interception was ATTEMPTED and React was not there to wrap. A host that has
 * simply not opted in yet is NOT this — it has no verdict at all, because
 * "the host never called us" and "the host will call us in a moment" are the
 * same observation.
 */
let refused = false;
let ReactRef: ReactLike | null = null;
/** The host's OWN function, kept by reference so teardown puts back exactly
 *  what was there. Never the bound copy below: restoring a wrapper of the
 *  host's function is not restoring the host's function, and a later reader
 *  comparing the two would be told the kit was still installed. */
let origCreateElement:
  | ((type: unknown, props?: unknown, ...children: unknown[]) => unknown)
  | null = null;

/** A swapped export on one of React's JSX runtime modules, kept so teardown
 *  can put the host's own function back exactly. */
interface JsxRuntimePatch {
  mod: Record<string, unknown>;
  key: string;
  orig: (...args: unknown[]) => unknown;
}
let jsxPatches: JsxRuntimePatch[] = [];

/** The container's own name, or null when this element is not a scroll
 *  container. Reads only the component's identity — never a prop value. */
export function scrollContainerName(type: unknown): string | null {
  try {
    if (typeof type === "string") {
      return SCROLL_CONTAINER_NAMES.has(type) ? type : null;
    }
    if (typeof type !== "function" && typeof type !== "object") return null;
    const t = type as { displayName?: unknown; name?: unknown; render?: unknown };
    const raw =
      (typeof t.displayName === "string" && t.displayName) ||
      (typeof t.name === "string" && t.name) ||
      (typeof (t.render as { name?: unknown })?.name === "string" &&
        ((t.render as { name?: string }).name as string)) ||
      "";
    if (!raw) return null;
    // "Animated(ScrollView)" / "ForwardRef(ScrollView)" name the wrapped
    // container; the wrapper still receives and mounts the whole child list.
    const inner = /\(([A-Za-z]+)\)\s*$/.exec(raw)?.[1];
    for (const candidate of [raw, inner ?? ""]) {
      if (candidate && SCROLL_CONTAINER_NAMES.has(candidate)) return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * How many direct children this element was handed.
 *
 * Both ways React is called are counted the same: the classic
 * `createElement(type, props, ...children)` passes them as trailing
 * arguments, the automatic runtime passes them as `props.children`. A single
 * child is one; an array is its length, flattened one level because
 * `{a}{items.map(...)}` arrives as a mixed array. A `<FlatList>` is handed no
 * children at all and never reaches here.
 */
export function countDirectChildren(props: unknown, rest: unknown[]): number {
  let total = 0;
  const add = (value: unknown): void => {
    if (value == null || value === false || value === true) return;
    if (Array.isArray(value)) {
      for (const item of value) add(item);
      return;
    }
    total++;
  };
  if (rest.length > 0) {
    for (const child of rest) add(child);
    return total;
  }
  if (props && typeof props === "object") {
    add((props as { children?: unknown }).children);
  }
  return total;
}

function observe(type: unknown, props: unknown, rest: unknown[]): void {
  const container = scrollContainerName(type);
  if (container === null) return;
  recordContainerMount(container, countDirectChildren(props, rest));
}

/** React's production automatic-runtime module, or null if it will not load.
 *
 *  Static specifier, deliberately. Metro reads every require at BUILD time to
 *  decide what goes in the bundle, and a `require(variable)` is a hard build
 *  error — the app does not start at all. Nothing in this file may take a
 *  computed specifier. */
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

/**
 * Wrap `jsx` / `jsxs` / `jsxDEV` on React's automatic-runtime modules, which
 * is where an ordinary `<ScrollView>...</ScrollView>` in a modern app
 * arrives. Patching `createElement` alone would census nothing: the automatic
 * transform is the default in React Native's Babel preset and never touches
 * it. Best-effort; NEVER throws.
 */
function installJsxRuntimeInterception(): void {
  for (const mod of [loadJsxRuntime(), loadJsxDevRuntime()]) {
    if (!mod || typeof mod !== "object") continue;
    for (const name of ["jsx", "jsxs", "jsxDEV"]) {
      const current = mod[name];
      if (typeof current !== "function") continue;
      const orig = current as (...args: unknown[]) => unknown;
      const wrapped = function (type: unknown, props?: unknown, ...rest: unknown[]): unknown {
        try {
          observe(type, props, []);
        } catch {
          /* the census never changes what the host renders */
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
        /* read-only export — the classic path still censuses */
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
 * Install the census interception. Idempotent, best-effort, NEVER throws. On
 * any failure the host's own React is left exactly as it was and the census
 * simply holds nothing.
 */
export function installMountCensus(): void {
  let react: ReactLike | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    react = require("react") as ReactLike;
  } catch {
    // A module we could not even load tells us nothing: a failed look is not
    // a look that found nothing, so it must not reach the permanent word.
    return;
  }
  installMountCensusWith(react);
}

function installMountCensusWith(react: ReactLike | null): void {
  if (installed) return;
  try {
    if (!react || typeof react.createElement !== "function") {
      // Looked, and the surface to wrap is not here. Positive evidence.
      refused = true;
      return;
    }
    ReactRef = react;
    origCreateElement = react.createElement;
    const orig = react.createElement.bind(react);
    const wrapped = function (type: unknown, props?: unknown, ...children: unknown[]): unknown {
      try {
        observe(type, props, children);
      } catch {
        /* the census never changes what the host renders */
      }
      return orig(type, props, ...children);
    };
    (react as { createElement: unknown }).createElement = wrapped;
    installJsxRuntimeInterception();
    installed = true;
  } catch {
    try {
      uninstallMountCensus();
    } catch {
      /* best-effort */
    }
    installed = false;
  }
}

/** Restore React's own createElement and JSX runtime. Idempotent, NEVER
 *  throws. Wired into telemetry.forget(). */
export function uninstallMountCensus(): void {
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
  installed = false;
  // Teardown clears the claim with the interception: forget() leaves a kit
  // that has looked at nothing, and it must look again before saying a host
  // cannot supply this reading.
  refused = false;
}

/** Clear the census (telemetry.forget() hook + tests). */
export function resetMountCensus(): void {
  entries.clear();
  pending.length = 0;
  seq = 0;
  truncated = false;
  // A reset kit has looked at nothing. Keeping the refusal would let a fresh
  // install inherit the last one's verdict about a different host.
  refused = false;
}

/** @internal test hooks. */
export const _mountCensusInternals = {
  get isInstalled(): boolean {
    return installed;
  },
  /** How many automatic-runtime exports are wrapped. 0 with the classic path
   *  alone, which is the shape that censuses nothing in a modern app. */
  get jsxPatchCount(): number {
    return jsxPatches.length;
  },
  /** The attempt that found no React surface to wrap. */
  get refused(): boolean {
    return refused;
  },
  /** The wrapped `jsx` export ON THE MODULE OBJECT THE KIT PATCHED. */
  get patchedJsx(): ((type: unknown, props?: unknown, key?: string) => unknown) | null {
    const patch = jsxPatches.find((entry) => entry.key === "jsx");
    if (!patch) return null;
    return patch.mod.jsx as (type: unknown, props?: unknown, key?: string) => unknown;
  },
  /** Drive the real wiring with a React the test resolved itself. */
  installWithForTests(react: unknown): void {
    installMountCensusWith(react as ReactLike);
  },
  reset(): void {
    uninstallMountCensus();
    resetMountCensus();
  },
};
