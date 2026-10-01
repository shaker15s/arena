/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: Timer Health axis source (React Native) ──────────────────
 *
 * An RN-exclusive, ADDITIVE, display-only meter that scores the TREND in the
 * number of OUTSTANDING (created-but-not-yet-fired/cleared) JS timers over
 * time. A steadily climbing outstanding-timer count is a classic leak: a
 * component that schedules a setInterval/setTimeout on every render/mount and
 * never clears it, a poll loop that reschedules faster than it drains, an
 * animation driven by JS timers that survives its screen. A flat/steady count
 * is healthy; a sustained climb is the leak signal — exactly the "score a
 * trend, never a raw count" rule (a raw outstanding-timer count has no honest
 * good/bad rating without a capacity reference).
 *
 * HONESTY / INVARIANTS (see docs/perf-meters.md):
 *   • NEVER feeds the composite Speed score (TTFF/TTI/FID). Display-only.
 *   • OMIT WHILE WARMING: readTimerHealth() returns null until ≥12 samples
 *     span ≥60s — never a fabricated 0/100.
 *   • NUMERIC-ONLY on the wire: { score, rating, timers, growthPerMin,
 *     sampleCount }. No caption — the server rebuilds it.
 *   • Bands: linearScore(growthPerMin, good=1, poor=20).
 *
 * GUEST-SAFETY (this is the highest-risk part — guest code must NEVER break the
 * host's timers):
 *   • We wrap global setTimeout/setInterval/clearTimeout/clearInterval ONLY to
 *     count outstanding timers. Every wrapper ALWAYS delegates to the captured
 *     original with the SAME args and RETURNS its EXACT return value, so host
 *     behaviour is byte-identical.
 *   • The bookkeeping (increment on create, decrement on fire/clear) is entirely
 *     inside try/catch and can NEVER throw into the host.
 *   • If wrapping throws, or a global is missing, we fall back to NOT tracking:
 *     the axis simply returns null and the host's timers are left untouched.
 *   • uninstallTimerTracking() RESTORES the exact originals; it is wired into
 *     the kit's forget() path (telemetry.forget → clearVitals-equivalent) so
 *     nothing Boosthis-shaped keeps wrapping after erasure.
 *   • NO new poller/thread: the outstanding count is SAMPLED at the SAME cadence
 *     the frame sampler already ticks (frameSampler calls sample() per frame).
 */

import {
  clearCurrentScreen,
  currentScreen,
  setCurrentScreen,
  _resetScreenAttributionForTests,
} from "./screenAttribution";
import { linearScore, ratingFor, type AxisRating, type AxisThresholds } from "./axisScoring";
import { earnedPerMin, windowMinOf } from "./rateHonesty";

/** Growth-per-minute score bands (outstanding timers/min). ≤1/min reads as
 *  steady (100); ≥20/min is a clear leak (0). */
export const TIMER_HEALTH_THRESHOLDS = { good: 1, poor: 20 } as const satisfies AxisThresholds;

/** eventLoopLag p95 bands and sample floor from the scheduling contract. */
export const EVENT_LOOP_LAG_THRESHOLDS = { good: 20, poor: 200 } as const satisfies AxisThresholds;
export const EVENT_LOOP_LAG_MIN_SAMPLES = 20;
/** A timer tick at least this late is one blockingAsync event. */
export const BLOCKING_ASYNC_BLOCK_THRESHOLD_MS = 250;
export const BLOCKING_ASYNC_THRESHOLDS = { good: 0.5, poor: 10 } as const satisfies AxisThresholds;
/** A kit-owned wrapped callback taking at least this long is slow. */
export const ASYNC_SLOW_CALLBACK_THRESHOLD_MS = 50;
export const ASYNC_SLOW_CALLBACK_THRESHOLDS = { good: 0.2, poor: 10 } as const satisfies AxisThresholds;
/** Both rate readings require a full observed minute. */
export const ASYNC_RATE_MIN_WINDOW_MS = 60_000;
/** The recent timer-drift distribution is bounded for long-lived apps. */
export const EVENT_LOOP_LAG_RING_CAP = 240;

export interface EventLoopLagResult {
  score: number;
  rating: AxisRating;
  lagMs: number;
  p95Ms: number;
  sampleCount: number;
  windowMin: number;
  caption: string;
}

export interface BlockingAsyncResult {
  score: number;
  rating: AxisRating;
  count: number;
  perMin: number;
  worstMs: number;
  windowMin: number;
  caption: string;
}

export interface AsyncSlowCallbacksResult {
  score: number;
  rating: AxisRating;
  count: number;
  perMin: number;
  windowMin: number;
  caption: string;
}

/** Minimum samples before the trend is trustworthy. */
const MIN_TIMER_SAMPLES = 12;
/** Minimum wall-clock span the samples must cover (ms) — a slope over a few
 *  seconds is noise, not a leak. */
const MIN_TIMER_SPAN_MS = 60_000;
/** Throttle between samples (ms) — the frame loop ticks ~60×/s, but one sample
 *  per second is plenty for a trend and keeps the ring small. */
const TIMER_SAMPLE_THROTTLE_MS = 1_000;
/** Bounded ring so a long-lived session can never grow this unbounded. */
const TIMER_RING_CAP = 240;

export interface TimerHealthResult {
  /** 0–100, or null while pending (not enough samples / span yet). */
  score:        number | null;
  rating:       AxisRating;
  /** Outstanding (created-but-not-fired/cleared) timers at the last sample, or
   *  null while pending. */
  timers:       number | null;
  /** Least-squares growth of the outstanding-timer count per minute (1dp), or
   *  null while pending. */
  growthPerMin: number | null;
  /** Samples backing the reading (shown even while pending). */
  sampleCount:  number;
}

interface CountSample {
  t: number;
  count: number;
}

type TimeoutFn = (
  handler: (...args: unknown[]) => void,
  timeout?: number,
  ...args: unknown[]
) => unknown;
type ClearFn = (handle?: unknown) => void;

interface TimerGlobals {
  setTimeout?: TimeoutFn;
  setInterval?: TimeoutFn;
  clearTimeout?: ClearFn;
  clearInterval?: ClearFn;
}

let installed = false;
/** Outstanding (created-but-not-fired/cleared) timer count. Never negative. */
let outstanding = 0;
const samples: CountSample[] = [];
let lastSampleAt = 0;
const eventLoopLagSamples: number[] = [];
let asyncObservationStartedAt = -1;
let asyncObservationLastAt = 0;
let blockingAsyncCount = 0;
let blockingAsyncWorstMs = 0;
let asyncSlowCallbackCount = 0;

function monotonicNowMs(): number {
  try {
    const p = (globalThis as unknown as {
      performance?: { now?: () => number };
    }).performance;
    if (p && typeof p.now === "function") return p.now();
  } catch {
    /* use the wall-clock fallback */
  }
  return Date.now();
}

/** Observe work the host already caused through our existing timer wrappers. */
function noteTimerCallback(lagMs: number, durationMs: number, observedAt: number): void {
  try {
    if (!installed) return;
    const lag = Math.max(0, lagMs);
    const duration = Math.max(0, durationMs);
    if (asyncObservationStartedAt < 0) asyncObservationStartedAt = observedAt;
    asyncObservationLastAt = Math.max(asyncObservationLastAt, observedAt);
    eventLoopLagSamples.push(lag);
    if (eventLoopLagSamples.length > EVENT_LOOP_LAG_RING_CAP) {
      eventLoopLagSamples.shift();
    }
    if (lag >= BLOCKING_ASYNC_BLOCK_THRESHOLD_MS) {
      blockingAsyncCount += 1;
      blockingAsyncWorstMs = Math.max(blockingAsyncWorstMs, lag);
    }
    if (duration >= ASYNC_SLOW_CALLBACK_THRESHOLD_MS) {
      asyncSlowCallbackCount += 1;
    }
  } catch {
    /* timer observation must never affect the host callback */
  }
}

function nearestRank(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? 0;
}

function observedWindowMs(): number {
  return Math.max(0, asyncObservationLastAt - asyncObservationStartedAt);
}

export function readEventLoopLag(): EventLoopLagResult | null {
  if (!installed || eventLoopLagSamples.length < EVENT_LOOP_LAG_MIN_SAMPLES) {
    return null;
  }
  const p95Ms = nearestRank(eventLoopLagSamples, 0.95);
  const score = linearScore(
    p95Ms,
    EVENT_LOOP_LAG_THRESHOLDS.good,
    EVENT_LOOP_LAG_THRESHOLDS.poor,
  );
  return {
    score,
    rating: ratingFor(score),
    lagMs: Math.round(eventLoopLagSamples[eventLoopLagSamples.length - 1]),
    p95Ms: Math.round(p95Ms),
    sampleCount: eventLoopLagSamples.length,
    windowMin: windowMinOf(observedWindowMs()),
    caption: `Timer callbacks are ${Math.round(p95Ms)} ms late at p95.`,
  };
}

export function readBlockingAsync(): BlockingAsyncResult | null {
  const windowMs = observedWindowMs();
  if (!installed || windowMs < ASYNC_RATE_MIN_WINDOW_MS) return null;
  const perMin = earnedPerMin(blockingAsyncCount, windowMs);
  if (perMin === null) return null;
  const score = linearScore(
    perMin,
    BLOCKING_ASYNC_THRESHOLDS.good,
    BLOCKING_ASYNC_THRESHOLDS.poor,
  );
  return {
    score,
    rating: ratingFor(score),
    count: blockingAsyncCount,
    perMin,
    worstMs: Math.round(blockingAsyncWorstMs),
    windowMin: windowMinOf(windowMs),
    caption: `${blockingAsyncCount} timer callbacks arrived at least ${BLOCKING_ASYNC_BLOCK_THRESHOLD_MS} ms late.`,
  };
}

export function readAsyncSlowCallbacks(): AsyncSlowCallbacksResult | null {
  const windowMs = observedWindowMs();
  if (!installed || windowMs < ASYNC_RATE_MIN_WINDOW_MS) return null;
  const perMin = earnedPerMin(asyncSlowCallbackCount, windowMs);
  if (perMin === null) return null;
  const score = linearScore(
    perMin,
    ASYNC_SLOW_CALLBACK_THRESHOLDS.good,
    ASYNC_SLOW_CALLBACK_THRESHOLDS.poor,
  );
  return {
    score,
    rating: ratingFor(score),
    count: asyncSlowCallbackCount,
    perMin,
    windowMin: windowMinOf(windowMs),
    caption: `${asyncSlowCallbackCount} wrapped callbacks took at least ${ASYNC_SLOW_CALLBACK_THRESHOLD_MS} ms.`,
  };
}

/* ─── Screen Timer Leaks axis (shares these wrappers) ────────────────────
 * "How many JS timers outlive their screen?" We TAG every timer/interval a
 * screen creates with the current screen id (via the SAME wrappers above — no
 * second set), and 5s after a screen unmounts we count how many of ITS timers
 * are still outstanding. Honest wording: this covers JS timers ONLY, not native
 * subscriptions/listeners. Purely additive + display-only — never feeds the
 * speed composite. See SCREEN_LEAKS_THRESHOLDS below. */

/** leaked-per-exit score bands. ≤0 timers/exit is clean (100); ≥3/exit is a
 *  chronic per-screen leak (0). */
export const SCREEN_LEAKS_THRESHOLDS = { good: 0, poor: 3 } as const satisfies AxisThresholds;

/** Screen exits needed before the axis leaves "pending". */
const SCREEN_LEAKS_MIN_EXITS = 5;

/** How long after a screen unmounts before we count its survivors (ms). */
const SCREEN_LEAKS_SETTLE_MS = 5_000;

/** The screen currently mounted — timers created now are tagged with it. Held
 *  in `screenAttribution.ts`, the kit's ONE holder, so every other reading
 *  taken while a screen is up can name the same screen this one does. null
 *  when no screen is active (timers then aren't screen-attributed). */
/** handle → screen id that created it. Bounded via the same churn guard as the
 *  handle Sets (cleared together). */
const handleScreen = new Map<unknown, string>();
/** Cumulative screen exits observed and the total leaked-timer count across
 *  them, plus the worst single exit. */
let screenExits = 0;
let leakedTotal = 0;
let worstLeaked = 0;

/** Tag a freshly-created handle with the current screen, if any. Best-effort. */
function tagHandle(handle: unknown): void {
  try {
    const screen = currentScreen();
    if (screen != null) {
      handleScreen.set(handle, screen);
      if (handleScreen.size > TIMER_RING_CAP * 8) handleScreen.clear();
    }
  } catch {
    /* best-effort */
  }
}

/** Untag a handle that fired/cleared (it can't be a leak anymore). */
function untagHandle(handle: unknown): void {
  try {
    handleScreen.delete(handle);
  } catch {
    /* best-effort */
  }
}

// Captured originals, restored verbatim on uninstall.
let origSetTimeout: TimeoutFn | null = null;
let origSetInterval: TimeoutFn | null = null;
let origClearTimeout: ClearFn | null = null;
let origClearInterval: ClearFn | null = null;

/** setInterval handles never auto-decrement on "fire" (they repeat), so we
 *  track which handles are intervals and decrement only on clearInterval. Plain
 *  timeout handles decrement when they fire OR when cleared. WeakSet would be
 *  ideal but handles may be numbers (web); a bounded Set keyed by handle is
 *  safe and self-limiting via the outstanding cap logic. */
const intervalHandles = new Set<unknown>();
const timeoutHandles = new Set<unknown>();

function dec(): void {
  if (outstanding > 0) outstanding -= 1;
}

/**
 * Install the timer-count wrappers. Idempotent, best-effort, NEVER throws.
 * On any failure the originals are left in place and tracking stays off (the
 * axis then simply reads null). Call once from telemetry start.
 */
export function installTimerTracking(): void {
  if (installed) return;
  try {
    const g = globalThis as unknown as TimerGlobals;
    const oST = g.setTimeout;
    const oSI = g.setInterval;
    const oCT = g.clearTimeout;
    const oCI = g.clearInterval;
    // Require the full quartet — if any is missing/non-function, do not track
    // (never leave the host with a half-wrapped timer surface).
    if (
      typeof oST !== "function" ||
      typeof oSI !== "function" ||
      typeof oCT !== "function" ||
      typeof oCI !== "function"
    ) {
      return;
    }
    origSetTimeout = oST;
    origSetInterval = oSI;
    origClearTimeout = oCT;
    origClearInterval = oCI;

    const wrappedSetTimeout: TimeoutFn = function (
      handler: (...args: unknown[]) => void,
      timeout?: number,
      ...rest: unknown[]
    ): unknown {
      // ALWAYS delegate to the original with the SAME args and RETURN its exact
      // return value. Bookkeeping is wrapped so it can never break the host.
      let handle: unknown;
      const scheduledAt = monotonicNowMs();
      const dueAt = scheduledAt + Math.max(0, timeout ?? 0);
      const wrappedHandler = function (this: unknown, ...hargs: unknown[]): void {
        const callbackStartedAt = monotonicNowMs();
        try {
          if (timeoutHandles.delete(handle)) dec();
          untagHandle(handle);
        } catch {
          /* never throw from a host timer callback */
        }
        // Delegate to the host's handler. A throw here is the HOST's bug — let
        // it propagate exactly as it would without Boosthis.
        try {
          return (handler as (...a: unknown[]) => void).apply(this, hargs);
        } finally {
          const callbackEndedAt = monotonicNowMs();
          noteTimerCallback(
            callbackStartedAt - dueAt,
            callbackEndedAt - callbackStartedAt,
            callbackStartedAt,
          );
        }
      };
      handle = (origSetTimeout as TimeoutFn)(
        wrappedHandler as (...a: unknown[]) => void,
        timeout as number,
        ...rest,
      );
      try {
        outstanding += 1;
        timeoutHandles.add(handle);
        tagHandle(handle);
        if (timeoutHandles.size > TIMER_RING_CAP * 8) {
          // Pathological churn guard: forget the oldest tracked handle keys so
          // the Set can never grow without bound. Outstanding count is still
          // corrected by clear/fire on tracked handles; untracked ones simply
          // stop decrementing (conservative, never negative).
          timeoutHandles.clear();
        }
      } catch {
        /* best-effort */
      }
      return handle;
    };

    const wrappedSetInterval: TimeoutFn = function (
      handler: (...args: unknown[]) => void,
      timeout?: number,
      ...rest: unknown[]
    ): unknown {
      // Intervals never auto-fire-to-completion; they only leave on clear.
      const intervalMs = Math.max(0, timeout ?? 0);
      let dueAt = monotonicNowMs() + intervalMs;
      const wrappedHandler = function (this: unknown, ...hargs: unknown[]): void {
        const callbackStartedAt = monotonicNowMs();
        try {
          return (handler as (...a: unknown[]) => void).apply(this, hargs);
        } finally {
          const callbackEndedAt = monotonicNowMs();
          noteTimerCallback(
            callbackStartedAt - dueAt,
            callbackEndedAt - callbackStartedAt,
            callbackStartedAt,
          );
          dueAt += intervalMs;
        }
      };
      const handle = (origSetInterval as TimeoutFn)(
        wrappedHandler as (...a: unknown[]) => void,
        timeout as number,
        ...rest,
      );
      try {
        outstanding += 1;
        intervalHandles.add(handle);
        tagHandle(handle);
        if (intervalHandles.size > TIMER_RING_CAP * 8) intervalHandles.clear();
      } catch {
        /* best-effort */
      }
      return handle;
    };

    const wrappedClearTimeout: ClearFn = function (handle?: unknown): void {
      try {
        if (handle !== undefined && timeoutHandles.delete(handle)) dec();
        if (handle !== undefined) untagHandle(handle);
      } catch {
        /* best-effort */
      }
      (origClearTimeout as ClearFn)(handle);
    };

    const wrappedClearInterval: ClearFn = function (handle?: unknown): void {
      try {
        if (handle !== undefined && intervalHandles.delete(handle)) dec();
        if (handle !== undefined) untagHandle(handle);
      } catch {
        /* best-effort */
      }
      (origClearInterval as ClearFn)(handle);
    };

    g.setTimeout = wrappedSetTimeout;
    g.setInterval = wrappedSetInterval;
    g.clearTimeout = wrappedClearTimeout;
    g.clearInterval = wrappedClearInterval;
    installed = true;
  } catch {
    // Wrapping failed — restore anything we may have swapped and stay OFF so
    // the host's timers are never left broken.
    try {
      uninstallTimerTracking();
    } catch {
      /* best-effort */
    }
    installed = false;
  }
}

/**
 * Sample the current outstanding-timer count at the caller's cadence (the frame
 * sampler tick). Throttled to one sample/second. Pure bookkeeping — NEVER
 * throws. No-op when tracking is not installed.
 */
export function sampleTimerCount(now: number): void {
  try {
    if (!installed) return;
    if (now - lastSampleAt < TIMER_SAMPLE_THROTTLE_MS) return;
    lastSampleAt = now;
    samples.push({ t: now, count: outstanding });
    if (samples.length > TIMER_RING_CAP) samples.shift();
  } catch {
    /* best-effort */
  }
}

/** Least-squares slope of a count over wall-clock minutes. */
function countSlopePerMin(s: readonly CountSample[]): number {
  const n = s.length;
  const t0 = s[0].t;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of s) {
    const x = (p.t - t0) / 60_000;
    const y = p.count;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return 0;
  return (n * sxy - sx * sy) / denom;
}

/**
 * The Timer Health axis, or a pending reading while warming up (< MIN samples
 * or too short a span) / when tracking is not installed. Pure read — never
 * mutates state, NEVER throws. Numbers-only wire shape (no caption).
 */
export function readTimerHealth(): TimerHealthResult {
  try {
    if (!installed || samples.length < MIN_TIMER_SAMPLES) {
      return {
        score: null,
        rating: "pending",
        timers: null,
        growthPerMin: null,
        sampleCount: samples.length,
      };
    }
    const first = samples[0];
    const last = samples[samples.length - 1];
    const spanMs = last.t - first.t;
    if (spanMs < MIN_TIMER_SPAN_MS) {
      return {
        score: null,
        rating: "pending",
        timers: null,
        growthPerMin: null,
        sampleCount: samples.length,
      };
    }
    const growth = countSlopePerMin(samples);
    // A flat/shrinking timer set is healthy — never penalize negative growth.
    const score = linearScore(
      Math.max(0, growth),
      TIMER_HEALTH_THRESHOLDS.good,
      TIMER_HEALTH_THRESHOLDS.poor,
    );
    return {
      score,
      rating: ratingFor(score),
      timers: last.count,
      growthPerMin: Math.round(growth * 10) / 10,
      sampleCount: samples.length,
    };
  } catch {
    return {
      score: null,
      rating: "pending",
      timers: null,
      growthPerMin: null,
      sampleCount: 0,
    };
  }
}

/* ─── Screen Timer Leaks: lifecycle + read ──────────────────────────────── */

export interface ScreenLeaksResult {
  score:         number;
  rating:        AxisRating;
  /** Mean JS timers still outstanding 5s after a screen exit (2dp). */
  leakedPerExit: number;
  /** Screen exits observed + settled (shown even while pending). */
  exitCount:     number;
  leakedTotal:   number;
}

/**
 * Mark that a screen has mounted and is now the ACTIVE screen — timers created
 * from now on are tagged with it. Best-effort, NEVER throws. Called from the
 * kit's screen tracker.
 */
export function markScreenMounted(screen: string): void {
  setCurrentScreen(screen);
}

/**
 * Mark that a screen has UNMOUNTED. After a SCREEN_LEAKS_SETTLE_MS grace period
 * we count how many timers this screen created are STILL outstanding (its
 * leak). We schedule the delayed count with the CAPTURED ORIGINAL setTimeout so
 * it never re-enters our wrapper (no self-counting, no re-tagging). Best-effort,
 * NEVER throws. Called from the kit's screen tracker on unmount.
 */
export function markScreenExit(screen: string): void {
  try {
    if (typeof screen !== "string" || screen.length === 0) return;
    // Clearing the active screen: a subsequent timer with no screen mounted is
    // not attributed to the exited screen.
    clearCurrentScreen(screen);
    if (!installed) return;
    const scheduler = origSetTimeout;
    if (typeof scheduler !== "function") return;
    // Delayed survivor count on the HOST's original timer (never our wrapper).
    scheduler(() => {
      try {
        let leaked = 0;
        for (const s of handleScreen.values()) {
          if (s === screen) leaked += 1;
        }
        screenExits += 1;
        leakedTotal += leaked;
        if (leaked > worstLeaked) worstLeaked = leaked;
        // Stop tracking this screen's surviving handles so a later exit of a
        // DIFFERENT screen can't recount them (and memory stays bounded).
        for (const [h, s] of [...handleScreen.entries()]) {
          if (s === screen) handleScreen.delete(h);
        }
      } catch {
        /* best-effort — a delayed count must never throw into the host */
      }
    }, SCREEN_LEAKS_SETTLE_MS);
  } catch {
    /* best-effort */
  }
}

/**
 * The Screen Timer Leaks axis, or a pending reading while warming (<5 settled
 * exits). Pure read — never mutates state, NEVER throws. Numbers-only wire.
 */
export function readScreenLeaks(): ScreenLeaksResult | null {
  try {
    if (screenExits < SCREEN_LEAKS_MIN_EXITS) return null;
    const perExit = leakedTotal / screenExits;
    const score = linearScore(
      perExit,
      SCREEN_LEAKS_THRESHOLDS.good,
      SCREEN_LEAKS_THRESHOLDS.poor,
    );
    return {
      score,
      rating:        ratingFor(score),
      leakedPerExit: Math.round(perExit * 100) / 100,
      exitCount: screenExits,
      leakedTotal,
    };
  } catch {
    return null;
  }
}

/**
 * Restore the exact original globals and drop all tracking state. Idempotent,
 * NEVER throws. Wired into telemetry.forget() so nothing Boosthis-shaped keeps
 * wrapping the host's timers after erasure.
 */
export function uninstallTimerTracking(): void {
  try {
    const g = globalThis as unknown as TimerGlobals;
    if (origSetTimeout) g.setTimeout = origSetTimeout;
    if (origSetInterval) g.setInterval = origSetInterval;
    if (origClearTimeout) g.clearTimeout = origClearTimeout;
    if (origClearInterval) g.clearInterval = origClearInterval;
  } catch {
    /* best-effort — never throw on teardown */
  }
  origSetTimeout = null;
  origSetInterval = null;
  origClearTimeout = null;
  origClearInterval = null;
  installed = false;
  outstanding = 0;
  lastSampleAt = 0;
  samples.length = 0;
  eventLoopLagSamples.length = 0;
  asyncObservationStartedAt = -1;
  asyncObservationLastAt = 0;
  blockingAsyncCount = 0;
  blockingAsyncWorstMs = 0;
  asyncSlowCallbackCount = 0;
  // Screen-leaks state — clear per-screen tagging + tallies on erasure too.
  _resetScreenAttributionForTests();
  screenExits = 0;
  leakedTotal = 0;
  worstLeaked = 0;
  try {
    intervalHandles.clear();
    timeoutHandles.clear();
    handleScreen.clear();
  } catch {
    /* best-effort */
  }
}

/** @internal test hooks — deterministic, no dependence on real timers. */
export const _timerInternals = {
  TIMER_HEALTH_THRESHOLDS,
  MIN_TIMER_SAMPLES,
  MIN_TIMER_SPAN_MS,
  TIMER_SAMPLE_THROTTLE_MS,
  TIMER_RING_CAP,
  EVENT_LOOP_LAG_THRESHOLDS,
  EVENT_LOOP_LAG_MIN_SAMPLES,
  BLOCKING_ASYNC_BLOCK_THRESHOLD_MS,
  BLOCKING_ASYNC_THRESHOLDS,
  ASYNC_SLOW_CALLBACK_THRESHOLD_MS,
  ASYNC_SLOW_CALLBACK_THRESHOLDS,
  ASYNC_RATE_MIN_WINDOW_MS,
  EVENT_LOOP_LAG_RING_CAP,
  get isInstalled(): boolean {
    return installed;
  },
  get outstanding(): number {
    return outstanding;
  },
  get sampleCount(): number {
    return samples.length;
  },
  /** Force the installed flag on/off without wrapping real globals. */
  setInstalledForTests(v: boolean): void {
    installed = v;
  },
  /** Push a synthetic outstanding-count sample, bypassing the throttle. */
  pushSample(t: number, count: number): void {
    samples.push({ t, count });
    if (samples.length > TIMER_RING_CAP) samples.shift();
  },
  noteTimerCallbackForTests(lagMs: number, durationMs: number, observedAt: number): void {
    noteTimerCallback(lagMs, durationMs, observedAt);
  },
  reset(): void {
    uninstallTimerTracking();
  },

  /* ─── Screen Timer Leaks hooks (deterministic, no real 5s timer) ────── */
  SCREEN_LEAKS_THRESHOLDS,
  SCREEN_LEAKS_MIN_EXITS,
  SCREEN_LEAKS_SETTLE_MS,
  get currentScreen(): string | null {
    return currentScreen();
  },
  get screenExits(): number {
    return screenExits;
  },
  get taggedHandleCount(): number {
    return handleScreen.size;
  },
  /** Tag n synthetic handles with a screen id (simulates timer creations under
   *  that screen), bypassing real timers. */
  tagHandlesForTests(screen: string, n: number): void {
    for (let i = 0; i < Math.max(0, Math.round(n)); i++) {
      handleScreen.set(`${screen}#${Math.random()}#${i}`, screen);
    }
  },
  /** Run the delayed survivor count for a screen SYNCHRONOUSLY (bypasses the
   *  5s settle timer), banking one exit + its leaked count. */
  settleScreenExitForTests(screen: string): void {
    let leaked = 0;
    for (const s of handleScreen.values()) if (s === screen) leaked += 1;
    screenExits += 1;
    leakedTotal += leaked;
    if (leaked > worstLeaked) worstLeaked = leaked;
    for (const [h, s] of [...handleScreen.entries()]) {
      if (s === screen) handleScreen.delete(h);
    }
  },
};
