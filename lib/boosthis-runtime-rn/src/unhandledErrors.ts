/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: Unhandled-error + promise-rejection rate axes (RN) ───────
 *
 * Two RN-exclusive, ADDITIVE, display-only meters that count how often the
 * app's global error / rejection reporters fire, per foreground hour. Both are
 * error-hygiene signals — DISTINCT from crashFree (which counts crashes the
 * kit's crash reporter captured) because here we simply chain the RN global
 * error handler / the host's rejection event and TALLY, never suppressing or
 * altering what the host sees.
 *
 * NON-NEGOTIABLE (see crash-reporter-guest-safety.md): the RN ErrorUtils global
 * handler is CHAINED, never replaced. We store the host's previous handler and
 * ALWAYS call it (with the ORIGINAL isFatal flag) so the host's crash reporting
 * and RN's own red-box / fatal behaviour are completely unchanged. We observe
 * ONLY a count — never the error object, message, or stack. If chaining fails
 * we stay OFF and the axis reads pending (never a fake "healthy" reading).
 *
 *   • unhandledErrors    — global JS errors observed per foreground hour, via a
 *     CHAINED ErrorUtils.setGlobalHandler. Absent when ErrorUtils is missing.
 *   • promiseRejections  — unhandled promise rejections per foreground hour,
 *     via a PASSIVE globalThis 'unhandledrejection' listener WHERE THE HOST
 *     EXPOSES IT (many RN runtimes do not). Absent when the event is absent.
 *
 * HONESTY / INVARIANTS:
 *   • NEVER feed the composite Speed score (TTFF/TTI/FID). Display-only.
 *   • NOT WIRED ⇒ PENDING: if the chain/listener never attached we omit the
 *     axis (null) so the server renders it as "warming up" rather than faking
 *     a perfect score.
 *   • WARM-UP: a ZERO-count reading stays pending until enough foreground time
 *     has passed; but a fired error/rejection surfaces IMMEDIATELY.
 *   • Numbers-only wire ({ score, rating, count, perHour, windowMin }).
 *
 * GUEST-SAFETY: bookkeeping is try/catch'd so a counter slip can never reach
 * the host's handler; the previous handler/listener is always invoked; teardown
 * restores the host's ErrorUtils handler and removes our rejection listener,
 * and is wired into telemetry.forget(). Idempotent, never throws.
 */

import { linearScore, ratingFor, type AxisRating, type AxisThresholds } from "./axisScoring";
import { earnedPerHour, MIN_RATE_WINDOW_MS, windowMinOf } from "./rateHonesty";
import {
  REASON_OFF_IN_THIS_BUILD,
  REASON_PLATFORM_DOES_NOT_EXPOSE,
} from "./axisReasons";
import { bankedWatch, NO_BANKED_WATCH, type BankedWatch } from "./watchHistory";

/** Errors/rejections per foreground hour bands. ≤1/hr is an occasional blip
 *  (100); ≥30/hr is chronically erroring (0). */
export const UNHANDLED_ERROR_THRESHOLDS = { good: 1, poor: 30 } as const satisfies AxisThresholds;
export const PROMISE_REJECTION_THRESHOLDS = { good: 1, poor: 30 } as const satisfies AxisThresholds;

/** Observe at least this much foreground time before the per-hour projection
 *  (and the score it feeds) may be published — the earned-rate contract, shared
 *  by every rate reading in the kit. The COUNT surfaces immediately regardless. */
const ERR_MIN_ACTIVE_MS = MIN_RATE_WINDOW_MS;

export interface UnhandledErrorRateResult {
  /** 0–100, or null while pending (not wired / warming with no error). */
  score:     number | null;
  rating:    AxisRating;
  /** Global JS errors inside the banked window — this run's, plus what
   *  earlier runs of this app on this device banked (shown even while
   *  pending). */
  count:     number;
  /** Errors per foreground hour (1dp), or null while pending. */
  perHour:   number | null;
  /** Foreground minutes observed — the rate denominator, across every run
   *  inside the banked window. */
  windowMin: number;
  /** Runs inside the window this reading pooled, when more than one.
   *  Omitted for a single-run reading. */
  runsInWindow?: number;
  measurable?: 0 | 1;
  reasonCode?: number;
}

export interface PromiseRejectionRateResult {
  /** 0–100, or null while pending (not wired / warming with no rejection). */
  score:     number | null;
  rating:    AxisRating;
  /** Unhandled promise rejections observed this session (shown even while
   *  pending). */
  count:     number;
  /** Rejections per foreground hour (1dp), or null while pending. */
  perHour:   number | null;
  /** Foreground minutes observed — the rate denominator (rounded). */
  windowMin: number;
  measurable?: 0 | 1;
  reasonCode?: number;
}

/* ─── ErrorUtils global-handler surface (lazy-required) ─────────────── */

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsLike {
  getGlobalHandler?: () => GlobalErrorHandler | undefined;
  setGlobalHandler?: (handler: GlobalErrorHandler) => void;
}

/* ─── Module state ──────────────────────────────────────────────────── */

let errorInstalled = false;
let errorCount = 0;
let priorHandler: GlobalErrorHandler | undefined;
let ourHandler: GlobalErrorHandler | null = null;

let rejectionInstalled = false;
let rejectionCount = 0;
let rejectionListener: ((...a: unknown[]) => void) | null = null;

/**
 * POSITIVE evidence that this host cannot take each reading: an install was
 * attempted and the surface it needs — RN's ErrorUtils, the host's
 * 'unhandledrejection' event — was not there.
 *
 * An `installed === false` on its own is NOT that evidence. It is equally true
 * of a kit that has not started and of one torn down by forget(), and reading
 * it as a platform verdict was the first version of this fix. Only a look that
 * found nothing earns "not available here"; anything else stays "pending".
 */
let errorSurfaceAbsent = false;
let rejectionSurfaceAbsent = false;

/**
 * The host asked us NOT to install the error hooks (`trackUnhandledErrors:
 * false`).
 *
 * A third state, and it has to be its own: the surface was never looked at,
 * so nothing is claimed about this host, and the silence is not a wait either
 * — it is the app's decision and the reading says so.
 */
let errorRefused = false;
let rejectionRefused = false;

/** Find ErrorUtils — it lives on the global in RN, but guard everything. */
function getErrorUtils(): ErrorUtilsLike | null {
  try {
    const g = globalThis as unknown as { ErrorUtils?: ErrorUtilsLike };
    const eu = g.ErrorUtils;
    if (eu && typeof eu.setGlobalHandler === "function") return eu;
  } catch {
    /* best-effort */
  }
  return null;
}

/**
 * CHAIN the RN global error handler to COUNT (never suppress) unhandled JS
 * errors. Idempotent, best-effort, NEVER throws. On any failure tracking stays
 * OFF and the axis reads pending. Call once from telemetry start.
 */
export function installUnhandledErrorTracking(): void {
  if (errorInstalled) return;
  errorRefused = false;
  try {
    const eu = getErrorUtils();
    if (!eu) {
      // We looked: this host has no ErrorUtils to chain, so no unhandled error
      // can ever be counted here. That is the reading's answer, not a wait.
      errorSurfaceAbsent = true;
      return;
    }
    const prev =
      typeof eu.getGlobalHandler === "function" ? eu.getGlobalHandler() : undefined;
    priorHandler = prev;
    const handler: GlobalErrorHandler = (error: unknown, isFatal?: boolean) => {
      // Observe FIRST (a counter slip must never stop the host's handler).
      try {
        errorCount += 1;
      } catch {
        /* best-effort */
      }
      // ALWAYS call the host's previous handler with the ORIGINAL args so RN's
      // red-box / fatal behaviour and the host's crash reporter are unchanged.
      if (typeof prev === "function") {
        prev(error, isFatal);
      }
    };
    ourHandler = handler;
    eu.setGlobalHandler!(handler);
    errorInstalled = true;
  } catch {
    errorInstalled = false;
    priorHandler = undefined;
    ourHandler = null;
  }
}

/**
 * Attach a PASSIVE 'unhandledrejection' listener WHERE THE HOST EXPOSES IT.
 * Idempotent, best-effort, NEVER throws. Never calls preventDefault — the
 * host's own rejection handling is untouched. On any failure (event absent)
 * tracking stays OFF and the axis reads pending.
 */
export function installPromiseRejectionTracking(): void {
  if (rejectionInstalled) return;
  rejectionRefused = false;
  try {
    const g = globalThis as unknown as {
      addEventListener?: (t: string, h: (...a: unknown[]) => void) => void;
    };
    if (typeof g.addEventListener !== "function") {
      // We looked: this host exposes no event target to hear a rejection on.
      rejectionSurfaceAbsent = true;
      return;
    }
    const listener = (..._a: unknown[]): void => {
      try {
        rejectionCount += 1;
      } catch {
        /* best-effort — never touch the event or call preventDefault */
      }
    };
    rejectionListener = listener;
    g.addEventListener("unhandledrejection", listener);
    rejectionInstalled = true;
  } catch {
    rejectionInstalled = false;
    rejectionListener = null;
  }
}

function rate(
  installed: boolean,
  /** POSITIVE evidence the host surface this axis needs is not there — an
   *  install was attempted and found nothing. Never merely "not installed". */
  surfaceAbsent: boolean,
  /** POSITIVE evidence the APP refused this collector. Checked before the
   *  platform verdict because a refused collector never looked, so it has
   *  nothing to say about the host. */
  refused: boolean,
  count: number,
  activeMs: number,
  thresholds: { good: number; poor: number },
  /** What earlier runs of this app on this device banked. BOTH halves of the
   *  rate come from it or neither: a window pooled without its count would
   *  divide this run's errors by a day of watching. See watchHistory.ts and
   *  docs/decisions/rate-window-earned-across-sessions.md. */
  banked: { count: number; activeMs: number; runs: number } = {
    count: 0,
    activeMs: 0,
    runs: 0,
  },
): {
  score: number | null;
  rating: AxisRating;
  count: number;
  perHour: number | null;
  windowMin: number;
  runsInWindow?: number;
  /** Present ONLY on a not-available reading: the pair the wire contract
   *  demands, so no surface has to guess why the score is null. */
  measurable?: 0;
  reasonCode?: number;
} {
  const live = typeof activeMs === "number" && activeMs > 0 ? activeMs : 0;
  const ms = live + banked.activeMs;
  const windowMin = windowMinOf(ms);
  const n = Math.max(0, Math.round(count)) + banked.count;
  const runsTail = banked.runs > 0 ? { runsInWindow: banked.runs + 1 } : {};
  if (!installed && refused) {
    return {
      score: null,
      rating: "not-available",
      count: n,
      perHour: null,
      windowMin,
      measurable: 0,
      reasonCode: REASON_OFF_IN_THIS_BUILD,
    };
  }
  if (!installed && surfaceAbsent) {
    return {
      score: null,
      rating: "not-available",
      count: n,
      perHour: null,
      windowMin,
      measurable: 0,
      reasonCode: REASON_PLATFORM_DOES_NOT_EXPOSE,
    };
  }
  // Not listening, and we never got as far as looking (kit not started, or
  // torn down by forget()). Nothing is claimed about the platform.
  if (!installed) {
    return { score: null, rating: "pending", count: n, perHour: null, windowMin, ...runsTail };
  }
  // The earned-rate contract (rateHonesty.ts): a projection needs a real
  // observation behind it, so below the minimum we publish neither the rate nor
  // the judgement it feeds. The COUNT still surfaces immediately — an error in
  // the first seconds is never hidden just because the window is short.
  const perHour = earnedPerHour(n, ms);
  if (perHour === null) {
    return { score: null, rating: "pending", count: n, perHour: null, windowMin, ...runsTail };
  }
  const score = linearScore(perHour, thresholds.good, thresholds.poor);
  return { score, rating: ratingFor(score), count: n, perHour, windowMin, ...runsTail };
}

/** The Unhandled-error rate axis. Pure read — never throws. `activeMs` is the
 *  shared foreground clock (frame.activeMs). */
export function readUnhandledErrors(
  activeMs: number,
  banked: BankedWatch = bankedWatch(),
): UnhandledErrorRateResult {
  try {
    return rate(
      errorInstalled,
      errorSurfaceAbsent,
      errorRefused,
      errorCount,
      activeMs,
      UNHANDLED_ERROR_THRESHOLDS,
      // Pooled across the runs of this app on this device: a four-minute
      // session can never earn a per-hour projection on its own. An error
      // still surfaces the moment it happens — only the all-clear waits.
      {
        count: banked.unhandledErrors,
        activeMs: banked.frameActiveMs,
        runs: banked.runs,
      },
    );
  } catch {
    return { score: null, rating: "pending", count: 0, perHour: null, windowMin: 0 };
  }
}

/** The Promise-rejection rate axis. Pure read — never throws.
 *
 *  Deliberately NOT pooled across runs: the ledger banks unhandled ERRORS,
 *  and pooling a window without the count it is divided by would report this
 *  run's rejections over a day of watching. Both halves travel together or
 *  neither does. */
export function readPromiseRejections(activeMs: number): PromiseRejectionRateResult {
  try {
    return rate(
      rejectionInstalled,
      rejectionSurfaceAbsent,
      rejectionRefused,
      rejectionCount,
      activeMs,
      PROMISE_REJECTION_THRESHOLDS,
    );
  } catch {
    return { score: null, rating: "pending", count: 0, perHour: null, windowMin: 0 };
  }
}

/**
 * Restore the host's ErrorUtils global handler and drop all state. Idempotent,
 * NEVER throws. Only restores if OUR handler is still the installed one (if the
 * host chained on top of ours we leave the chain alone — ours is inert once
 * `errorInstalled` is false). Wired into telemetry.forget().
 */
export function uninstallUnhandledErrorTracking(): void {
  try {
    const eu = getErrorUtils();
    if (
      eu &&
      ourHandler !== null &&
      typeof eu.getGlobalHandler === "function" &&
      eu.getGlobalHandler() === ourHandler &&
      typeof priorHandler === "function"
    ) {
      eu.setGlobalHandler!(priorHandler);
    }
  } catch {
    /* best-effort — never throw on teardown */
  }
  ourHandler = null;
  priorHandler = undefined;
  errorInstalled = false;
  // Erasure leaves NO claim behind, including the claim that this host cannot
  // be read. The next install looks again and decides again.
  errorSurfaceAbsent = false;
  errorRefused = false;
  errorCount = 0;
}

/**
 * Record that this app asked us not to chain the global error handler.
 *
 * Chains nothing and reads nothing — it only writes the refusal down. The
 * app's ErrorUtils handler is left exactly as it was, and the axis states
 * that it is off in this build rather than waiting for a count that can
 * never arrive.
 */
export function refuseUnhandledErrorTracking(): void {
  errorRefused = true;
}

/** The same refusal for the passive rejection listener; they are one switch. */
export function refusePromiseRejectionTracking(): void {
  rejectionRefused = true;
}

/** Remove the 'unhandledrejection' listener and drop all state. Idempotent,
 *  NEVER throws. Wired into telemetry.forget(). */
export function uninstallPromiseRejectionTracking(): void {
  try {
    const g = globalThis as unknown as {
      removeEventListener?: (t: string, h: (...a: unknown[]) => void) => void;
    };
    if (rejectionListener && typeof g.removeEventListener === "function") {
      g.removeEventListener("unhandledrejection", rejectionListener);
    }
  } catch {
    /* best-effort — never throw on teardown */
  }
  rejectionListener = null;
  rejectionInstalled = false;
  // Same as above: forget() erases the verdict along with the listener.
  rejectionSurfaceAbsent = false;
  rejectionRefused = false;
  rejectionCount = 0;
}

/**
 * Unhandled JS errors counted by THIS RUN, for the cross-run ledger.
 *
 * Live count only — never the pooled one, or a run would bank a figure that
 * already contains every earlier run and the ledger would compound on itself
 * once per write. A collector that never attached reports nothing rather than
 * a zero: an unwatched run's silence is not evidence of a clean one. See
 * watchHistory.ts.
 */
export function unhandledErrorRunCount(): number | null {
  return errorInstalled ? errorCount : null;
}

/** @internal test hooks — deterministic, no dependence on real globals. */
export const _unhandledInternals = {
  UNHANDLED_ERROR_THRESHOLDS,
  PROMISE_REJECTION_THRESHOLDS,
  ERR_MIN_ACTIVE_MS,
  get errorInstalled(): boolean {
    return errorInstalled;
  },
  get rejectionInstalled(): boolean {
    return rejectionInstalled;
  },
  get errorCount(): number {
    return errorCount;
  },
  get rejectionCount(): number {
    return rejectionCount;
  },
  setErrorInstalledForTests(v: boolean): void {
    errorInstalled = v;
  },
  setRejectionInstalledForTests(v: boolean): void {
    rejectionInstalled = v;
  },
  /** Force the "we looked and ErrorUtils was not there" evidence. That look,
   *  never the bare installed flag, is what "not available here" rests on. */
  setErrorSurfaceAbsentForTests(v: boolean): void {
    errorSurfaceAbsent = v;
  },
  /** Force the "we looked and there is no event target to hear a rejection
   *  on" evidence. Same rule as above. */
  setRejectionSurfaceAbsentForTests(v: boolean): void {
    rejectionSurfaceAbsent = v;
  },
  /** The app's own refusal of a default-on collector. Checked BEFORE the
   *  platform verdict: a refused collector never looked at the host. */
  get errorRefused(): boolean {
    return errorRefused;
  },
  get rejectionRefused(): boolean {
    return rejectionRefused;
  },
  fireErrorForTests(n = 1): void {
    errorCount += Math.max(0, Math.round(n));
  },
  fireRejectionForTests(n = 1): void {
    rejectionCount += Math.max(0, Math.round(n));
  },
  reset(): void {
    uninstallUnhandledErrorTracking();
    uninstallPromiseRejectionTracking();
  },
};
