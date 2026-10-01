/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: JS Startup Cost axis source (React Native) ───────────────
 *
 * An RN-exclusive, ADDITIVE, display-only meter that measures the cost of
 * getting the JS bundle from "start being evaluated" to "the app has rendered
 * something React" — a ONE-SHOT-per-session signal. A heavy bundle (too much
 * eager top-level work, giant synchronous requires, un-code-split screens)
 * shows up here as a long gap before the first render the kit observes.
 *
 * The clock starts at the earliest honest anchor we can find:
 *   • global.__BUNDLE_START_TIME__ (Metro's prelude sets this when bundle
 *     evaluation begins) → fromBundleStart:1, the truest reading, OR
 *   • the kit module-eval timestamp (when THIS module was first evaluated) →
 *     fromBundleStart:0, a conservative lower bound (the kit loaded partway
 *     through the bundle, so real startup is at least this long).
 * The clock stops at the FIRST React render the kit observes — reported by the
 * kit's own render source (BoosthisProfiler commit / first screen mount).
 *
 * WHICH CLOCK THE ANCHOR IS ON — READ IT, NEVER ASSUME IT.
 * Metro's prelude writes `__BUNDLE_START_TIME__ = nativePerformanceNow
 * ? nativePerformanceNow() : Date.now()`. So the host hands us a number on one
 * of TWO clocks and does not say which: a monotonic reading of milliseconds
 * since the device/VM started, or an epoch millisecond. This module used to
 * document it as the second and subtract `Date.now()` from it either way. On
 * every Hermes device that took the first branch, so the subtraction returned
 * the wall-clock instant the DEVICE BOOTED — about 1.79e12 ms — scored it
 * against the band below and published "poor" on every install we had.
 * See docs/startup-clock-fix-never-landed-2026-09.md.
 *
 * The anchor's SCALE is therefore tested, not trusted (an epoch ms is always
 * above EPOCH_SCALE_MS; a monotonic uptime reading essentially never is), and
 * the end of the duration is read from the matching clock. Where the two ends
 * cannot be shown to share a clock — or where the delta is beyond any
 * plausible startup, which means they did not — the axis says so and scores
 * NOTHING. `startupClock` puts that answer on the wire, so the next mismatch
 * is visible in stored data instead of needing a source audit.
 *
 * HONESTY / INVARIANTS:
 *   • NEVER feeds the composite Speed score (TTFF/TTI/FID). Display-only.
 *   • ONE-SHOT: startupMs is latched on the FIRST render and never changes.
 *   • OMIT WHILE WARMING: readJsStartup() returns pending (null score) until the
 *     first render is observed — never a fabricated 0/100.
 *   • A CLOCK MISMATCH IS NOT A SLOW APP: an impossible duration returns the
 *     pending shape with startupMs null. Never 0, never a band.
 *   • NUMERIC-ONLY on the wire: { score, rating, startupMs, fromBundleStart,
 *     startupClock }. No caption — the server rebuilds it.
 *   • Bands: linearScore(startupMs, good=1500, poor=5000).
 *
 * GUEST-SAFETY: nothing here wraps a host global. markFirstRender() is a plain
 * best-effort latch called from the kit's existing render observers; a throw can
 * never reach the host. No native modules, no timers, no promises.
 */

import { linearScore, ratingFor, type AxisRating, type AxisThresholds } from "./axisScoring";

/** Startup-cost score bands (ms). ≤1.5s reads as a lean bundle (100); ≥5s is a
 *  heavy, slow-to-boot bundle (0). */
export const JS_STARTUP_THRESHOLDS = { good: 1500, poor: 5000 } as const satisfies AxisThresholds;

/**
 * Above this, a number is an epoch millisecond and not a duration.
 *
 * Date.now() passed 1e12 in September 2001 and stays above it until 2286, so
 * any anchor at or above this came from a wall clock. A monotonic uptime
 * reading would have to be ~31 years of continuous uptime to reach it.
 */
export const EPOCH_SCALE_MS = 1_000_000_000_000;

/**
 * The longest startup we will publish as a startup.
 *
 * Mirrors the boot ladder's MAX_PLAUSIBLE_BOOT_MS (perfBoot.ts) deliberately:
 * both measure the same launch from different ends, and one bound for "this
 * cannot be a launch" is easier to hold true than two. Beyond it we are not
 * looking at a slow app, we are looking at two clocks — an app that genuinely
 * took longer than this to render anything has crashed or been killed long
 * before it can upload, and the reading we would publish is a boot instant.
 */
export const MAX_PLAUSIBLE_STARTUP_MS = 60_000;

/**
 * Which clock the two ends of the duration were read from. A closed numeric
 * vocabulary — the words belong to the server (see snapshotView).
 *
 *   WALL      both ends from Date.now().
 *   MONOTONIC both ends from performance.now().
 *   UNMATCHED the host's anchor could not be matched to a clock the kit can
 *             read at the other end, so no duration exists. NOT a reading of
 *             zero and not a slow app: an answer of "we cannot tell".
 */
export const STARTUP_CLOCK = {
  WALL: 0,
  MONOTONIC: 1,
  UNMATCHED: 2,
} as const;

export type StartupClock = (typeof STARTUP_CLOCK)[keyof typeof STARTUP_CLOCK];

export interface JsStartupResult {
  /** 0–100, or null while pending (first render not observed yet). */
  score:           number | null;
  rating:          AxisRating;
  /** Ms from bundle-eval start to the first observed React render, or null
   *  while pending — or where the two ends could not be shown to share a
   *  clock. One-shot — latched on the first render. */
  startupMs:       number | null;
  /** 1 when the clock started at global.__BUNDLE_START_TIME__ (truest); 0 when
   *  it fell back to the kit module-eval timestamp (a lower bound). */
  fromBundleStart: 0 | 1;
  /** Which clock produced the reading — see STARTUP_CLOCK. UNMATCHED means no
   *  duration was computable, which is why startupMs is null. */
  startupClock:    StartupClock;
}

/** The host's monotonic clock, or null when it has none. Null is the whole
 *  point: a caller has to know whether it got a monotonic reading or a wall
 *  one, because subtracting one from the other is the bug above. */
function monotonicNow(): number | null {
  try {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      const t = performance.now();
      if (typeof t === "number" && Number.isFinite(t)) return t;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** A monotonic-ish clock the whole module shares. performance.now() when it
 *  exists (monotonic), else Date.now(). Used for the kit's OWN anchor, where
 *  both ends are read here and are the same clock by construction. */
function nowMs(): number {
  return monotonicNow() ?? Date.now();
}

interface StartupGlobals {
  __BUNDLE_START_TIME__?: number;
}

/** The host's anchor, exactly as it was handed to us. */
const bundleStartRaw = (() => {
  try {
    const g = globalThis as unknown as StartupGlobals;
    const v = g.__BUNDLE_START_TIME__;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  } catch {
    /* best-effort */
  }
  return null;
})();

const fromBundleStart: 0 | 1 = bundleStartRaw != null ? 1 : 0;

/**
 * Resolve the anchor ONCE at module eval, together with the clock it is on.
 *
 * Three outcomes, and the third is the one that used to be scored:
 *   • no host anchor  → our own module-eval instant, on whichever clock this
 *     host has. Both ends ours, so the arithmetic cannot be wrong.
 *   • host anchor at epoch scale → Metro fell back to Date.now(); the wall
 *     clock is the matching one.
 *   • host anchor below epoch scale → Metro used the native monotonic clock.
 *     Matchable only if this host exposes performance.now() (React Native
 *     wires it to the same nativePerformanceNow the prelude used). Without
 *     one there is no clock to subtract from and the answer is UNMATCHED.
 */
const anchor: { value: number | null; clock: StartupClock } = (() => {
  if (bundleStartRaw == null) {
    const mono = monotonicNow();
    return mono != null
      ? { value: mono, clock: STARTUP_CLOCK.MONOTONIC }
      : { value: Date.now(), clock: STARTUP_CLOCK.WALL };
  }
  if (bundleStartRaw >= EPOCH_SCALE_MS) {
    return { value: bundleStartRaw, clock: STARTUP_CLOCK.WALL };
  }
  return monotonicNow() != null
    ? { value: bundleStartRaw, clock: STARTUP_CLOCK.MONOTONIC }
    : { value: null, clock: STARTUP_CLOCK.UNMATCHED };
})();

/** Latched on the first observed render. Null until then — and null for good
 *  where the clocks did not match. */
let startupMs: number | null = null;
let firstRenderSeen = false;
/** What we will say on the wire. Starts as the anchor's clock and can only
 *  move to UNMATCHED, when the latch proves the two ends disagree. */
let startupClock: StartupClock = anchor.clock;

/**
 * Latch the first React render the kit observes. Idempotent — only the FIRST
 * call takes effect, so the reading is a true one-shot. Best-effort, NEVER
 * throws. Called from the kit's render observers (BoosthisProfiler commit,
 * first screen mount).
 */
export function markFirstRender(): void {
  try {
    if (firstRenderSeen) return;
    firstRenderSeen = true;
    if (anchor.value == null) return; // already UNMATCHED — nothing to subtract
    const end =
      anchor.clock === STARTUP_CLOCK.MONOTONIC ? monotonicNow() : Date.now();
    if (end == null) {
      // The monotonic clock answered at module eval and not now. Rather than
      // fall back to Date.now() — the exact substitution that produced the
      // boot-time reading — say we cannot tell.
      startupClock = STARTUP_CLOCK.UNMATCHED;
      return;
    }
    const delta = end - anchor.value;
    if (!Number.isFinite(delta) || delta < 0 || delta > MAX_PLAUSIBLE_STARTUP_MS) {
      // Negative, or longer than any launch: the two ends are not on one
      // clock, whatever their scales suggested. A mismatch is not a slow app,
      // so nothing is scored and nothing is clamped to zero.
      startupClock = STARTUP_CLOCK.UNMATCHED;
      return;
    }
    startupMs = Math.round(delta);
  } catch {
    /* best-effort — a bookkeeping slip must never reach the host */
  }
}

/**
 * The JS Startup axis, or a pending reading until the first render is observed
 * — or for ever, where the clocks could not be matched.
 * Pure read — never mutates state, NEVER throws. Numbers-only wire shape.
 */
export function readJsStartup(): JsStartupResult {
  try {
    if (!firstRenderSeen || startupMs == null) {
      return {
        score: null,
        rating: "pending",
        startupMs: null,
        fromBundleStart,
        startupClock,
      };
    }
    const score = linearScore(
      startupMs,
      JS_STARTUP_THRESHOLDS.good,
      JS_STARTUP_THRESHOLDS.poor,
    );
    return {
      score,
      rating: ratingFor(score),
      startupMs,
      fromBundleStart,
      startupClock,
    };
  } catch {
    return {
      score: null,
      rating: "pending",
      startupMs: null,
      fromBundleStart,
      startupClock,
    };
  }
}

/** Reset all latched state — telemetry.forget() hook + tests. Idempotent. */
export function resetJsStartup(): void {
  startupMs = null;
  firstRenderSeen = false;
  startupClock = anchor.clock;
}

/** @internal test hooks — deterministic, no dependence on real timing. */
export const _jsStartupInternals = {
  JS_STARTUP_THRESHOLDS,
  MAX_PLAUSIBLE_STARTUP_MS,
  EPOCH_SCALE_MS,
  STARTUP_CLOCK,
  get firstRenderSeen(): boolean {
    return firstRenderSeen;
  },
  get fromBundleStart(): 0 | 1 {
    return fromBundleStart;
  },
  /** The anchor the module resolved at eval, and the clock it is on. Exposed
   *  so a test can assert WHICH branch a host reached, rather than inferring
   *  it from a duration. */
  get anchor(): { value: number | null; clock: StartupClock } {
    return { value: anchor.value, clock: anchor.clock };
  },
  /**
   * Latch a synthetic startupMs directly (bypasses the subtraction).
   *
   * Scoring cover only. It cannot fail on anything the collector gets wrong,
   * because it supplies the number the collector would have computed — which
   * is how the boot-clock reading survived every test this module had. The
   * subtraction itself is covered by re-importing the module against a host
   * whose anchor and clocks are set up first; see jsStartup.test.ts.
   */
  setStartupForTests(ms: number): void {
    firstRenderSeen = true;
    startupMs = Math.max(0, Math.round(ms));
  },
  reset(): void {
    resetJsStartup();
  },
  /** The module's clock reader, so a test can see what this host offers. */
  _nowMs: nowMs,
  _monotonicNow: monotonicNow,
};
