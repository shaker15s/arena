/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: background-suspend sensor (React Native) ──────────────────
 *
 * A phone app that is backgrounded does not stop measuring — it stops RUNNING.
 * The screen the user left is still "mounting", the fetch in flight is still
 * "in flight", and when they come back an hour later the kit closes the sample
 * and records an hour. Production evidence: one install reported a resilience
 * p99 of 445,188 ms — 7.4 minutes — against a p50 of 204 ms over 16 samples,
 * and another reported a 922,172 ms screen and a 923,390 ms boot phase. Those
 * are not slow apps. They are apps that were put in a pocket.
 *
 * This is the phone's answer to the server kits' host-suspend sensor
 * (`suspendSensor.ts` in the Node kit, `runtime_vitals.py` in Python): the same
 * fault, the same treatment. A duration whose measurement window OVERLAPS a
 * period the app spent in the background is WITHHELD from the meters, and the
 * count and worst withheld duration are reported on the axis so the discount is
 * VISIBLE, never silent — a customer whose tail suddenly improved is owed the
 * reason.
 *
 * WHAT COUNTS AS A SUSPEND. Only a background period of at least
 * BACKGROUND_GAP_MS. A momentary trip through `inactive` (a notification
 * shade, a permission sheet, the app switcher passing by) is the app still
 * working, and discounting those would hide real stalls. The threshold is the
 * server kits' SUSPEND_GAP_MS, deliberately: the two sensors answer the same
 * question and a customer comparing a phone tile with a server tile should not
 * find two different definitions behind them.
 *
 * CLOCK. Wall clock (`Date.now()`), because that is the clock the perf events
 * are stamped in and the only one that keeps running while the app is asleep.
 * A monotonic clock is the right choice for measuring work and the wrong one
 * for noticing that no work happened.
 *
 * PRIVACY: timestamps and counts only. Nothing here ever sees a screen name, a
 * URL or any customer string. Every entry point is total — it can be called
 * from a lifecycle callback and can never throw into the host.
 */

/** A background period at or above this (ms) is a suspend: work stopped, and
 *  anything still being timed across it is measuring sleep. Matches the server
 *  kits' SUSPEND_GAP_MS so both sensors mean the same thing. */
export const BACKGROUND_GAP_MS = 10_000;

/** How many completed background periods to remember. A sample is only ever
 *  checked against periods it could overlap, and perf events are themselves
 *  bounded, so a small ring is enough — and keeps this module's memory flat in
 *  a session that runs for days. */
const MAX_SPANS = 32;

interface Span {
  from: number;
  to: number;
}

/** Completed background periods, oldest first, only those >= BACKGROUND_GAP_MS. */
let spans: Span[] = [];
/** When the app went to background, or 0 while it is in the foreground. */
let backgroundSince = 0;
/** How many samples have been withheld because they spanned a suspend. */
let discounted = 0;
/** The longest sample withheld (ms) — what the tail WOULD have said. */
let worstMs = 0;

/**
 * Tell the sensor the app's foreground state changed.
 *
 * Called from the kit's single AppState listener (`lifecycleAxes`), so there is
 * no second subscription on the host's lifecycle. `active` is the RN AppState
 * "active" state; `inactive` and `background` both count as not-foreground,
 * because on iOS a genuine backgrounding passes through `inactive` and staying
 * there is exactly the case that stretches a measurement.
 */
export function noteAppForegroundState(active: boolean, nowMs?: number): void {
  const now = nowMs ?? Date.now();
  if (active) {
    if (backgroundSince > 0) {
      const length = now - backgroundSince;
      // Only a REAL suspend is remembered. A brief trip out and back is the app
      // still working, and discounting it would hide a genuine stall.
      if (length >= BACKGROUND_GAP_MS) {
        spans.push({ from: backgroundSince, to: now });
        if (spans.length > MAX_SPANS) spans.splice(0, spans.length - MAX_SPANS);
      }
      backgroundSince = 0;
    }
    return;
  }
  // Going to background. Ignore a repeat (inactive → background is one trip
  // out, not two) so the period is measured from when the app actually stopped
  // being usable.
  if (backgroundSince === 0) backgroundSince = now;
}

/**
 * Did a measurement that ended at `endMs` after running for `durationMs` cross
 * a background suspend?
 *
 * True when its window overlaps a completed background period, or when the app
 * is backgrounded RIGHT NOW and has been for long enough to count — a sample
 * closed during a suspend (a timer that fired, a fetch that resolved on resume)
 * is the same artifact.
 *
 * Non-finite or negative inputs answer false: a sensor that cannot judge a
 * sample must let it through, never invent a reason to drop it.
 */
export function spansBackgroundSuspend(durationMs: number, endMs?: number): boolean {
  if (!Number.isFinite(durationMs) || durationMs < 0) return false;
  const end = endMs ?? Date.now();
  if (!Number.isFinite(end)) return false;
  const start = end - durationMs;
  for (const s of spans) {
    // Half-open overlap: the sample was running while the app was asleep.
    if (start < s.to && s.from < end) return true;
  }
  if (backgroundSince > 0) {
    const asleepFor = end - backgroundSince;
    if (asleepFor >= BACKGROUND_GAP_MS && start < end && backgroundSince < end) {
      return true;
    }
  }
  return false;
}

/** Record that one sample was withheld for spanning a suspend. Counts and the
 *  worst withheld duration are what the axis publishes, so the discount can be
 *  read rather than guessed at. */
export function noteBackgroundDiscount(durationMs: number): void {
  discounted++;
  if (Number.isFinite(durationMs) && durationMs > worstMs) {
    worstMs = Math.round(durationMs);
  }
}

/** What the axes publish: how many samples were withheld, and the longest one.
 *  Both zero means nothing was discounted and the fields are omitted upstream —
 *  an axis never carries a field claiming a discount that did not happen. */
export function getBackgroundSuspendStats(): {
  suspendDiscounts: number;
  suspendWorstMs: number;
} {
  return { suspendDiscounts: discounted, suspendWorstMs: worstMs };
}

/** Is the app in the background right now (whatever the length)? Exposed for
 *  the recorders that want to know without judging a sample. */
export function isBackgrounded(): boolean {
  return backgroundSince > 0;
}

/** Wipe sensor state. Wired into the same forget()/erase path as the other
 *  meters, so a customer who clears their data clears this too. Idempotent. */
export function clearBackgroundSpans(): void {
  spans = [];
  backgroundSince = 0;
  discounted = 0;
  worstMs = 0;
}

/** @internal test hooks — deterministic state without wall-clock games. */
export const _backgroundSpansInternals = {
  BACKGROUND_GAP_MS,
  MAX_SPANS,
  reset(): void {
    clearBackgroundSpans();
  },
  /** Plant a completed background period directly. */
  addSpanForTest(from: number, to: number): void {
    spans.push({ from, to });
  },
  /** Force "in the background since". */
  setBackgroundSinceForTest(ms: number): void {
    backgroundSince = ms;
  },
  spanCount(): number {
    return spans.length;
  },
};
