/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: network sampler (FIELD-CAPABLE) ────────────────────────
 *
 * Surfaces the class of bug that bit the Rival iOS/Hermes sign-in: a fetch
 * that silently HANGS or DROPS on a reused socket, where the failure is
 * invisible because nothing ever rejects and nothing is logged. This sampler
 * lets the host app (or a transport wrapper) report, per network attempt, only
 * how long it took and how it ended — so the dashboard can show "how often do
 * this app's calls stall / silently time out, and how slow are they."
 *
 * PRIVACY CONTRACT (load-bearing): the public API accepts ONLY a duration and
 * a coarse outcome bucket. It deliberately has NO parameter for a URL, host,
 * path, query string, header, body, status code, or any per-request label —
 * there is no way to feed one in. So nothing that could identify a request, a
 * user, or a destination ever reaches this layer, and the aggregate it exposes
 * (counts + durations only) clears the shared PII guard inside the snapshot
 * upload exactly like every other axis.
 *
 * Like the scroll sampler (and unlike the dev-only render profiler), this works
 * in RELEASE builds — it is plain counters, not a dev-only hook — so Network is
 * a field-capable axis: it lives in computeMeterAxes and rides the uploaded
 * snapshot. It stays "pending" until the host reports a few attempts, just as
 * Scroll stays pending until the user scrolls.
 *
 * Nothing here touches the shared TTFF/TTI/FID composite — it is an additive
 * axis with its own thresholds (see meterAxes.ts).
 */

import { isBoosthisDisabled } from "./runtimeFlags";

/** How an attempt ended. Coarse buckets only — never a status code or message.
 *   - "ok":      the request completed (the app got a response, success or not)
 *   - "error":   the request rejected/failed loudly (the app KNEW it failed)
 *   - "timeout": the caller's own timer fired before any response
 *   - "stall":   completed, but slow enough that the caller flagged it as a
 *                near-hang (the silent-drop class — the call eventually returned
 *                but took long enough to feel broken). */
export type NetworkOutcome = "ok" | "error" | "timeout" | "stall";

export interface NetworkStats {
  /** Total attempts reported this session. */
  attemptCount: number;
  /** Of those, ones that completed normally ("ok"). */
  completedCount: number;
  /** Loud failures ("error") — the app knew the call failed. */
  failedCount: number;
  /** Caller-timer timeouts ("timeout") — no response before the deadline. */
  timeoutCount: number;
  /** Near-hangs the caller flagged ("stall") — the silent-drop class. */
  stallCount: number;
  /** p75 of reported attempt durations (ms), 0 when nothing reported yet. */
  p75Ms: number;
  /** Worst single attempt duration (ms), 0 when none. */
  worstMs: number;
}

const VALID_OUTCOMES: readonly NetworkOutcome[] = [
  "ok",
  "error",
  "timeout",
  "stall",
];

/** Keep the percentile window bounded so a long session can't grow memory —
 *  the recent attempts are what matter for "is the app stalling right now". */
const MAX_DURATIONS = 200;

/** Defensive clamp: never let a bogus caller duration skew worst/p75. */
const MAX_DURATION_MS = 120_000;

function nowMs(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((p / 100) * sorted.length)),
  );
  return Math.round(sorted[idx]);
}

class NetworkSampler {
  private attempts = 0;
  private completed = 0;
  private failed = 0;
  private timeouts = 0;
  private stalls = 0;
  private worst = 0;
  // Bounded ring of recent attempt durations for percentile math.
  private durations: number[] = [];

  /** Report one network attempt. Counts + duration only — NO URL/label ever.
   *  No-op when Boosthis is disabled or the outcome bucket is unrecognised. */
  record(input: { durationMs: number; outcome: NetworkOutcome }): void {
    if (isBoosthisDisabled()) return;
    const outcome = input?.outcome;
    if (!VALID_OUTCOMES.includes(outcome)) return;

    let d =
      typeof input?.durationMs === "number" && Number.isFinite(input.durationMs)
        ? input.durationMs
        : 0;
    if (d < 0) d = 0;
    if (d > MAX_DURATION_MS) d = MAX_DURATION_MS;

    this.attempts++;
    switch (outcome) {
      case "ok":
        this.completed++;
        break;
      case "error":
        this.failed++;
        break;
      case "timeout":
        this.timeouts++;
        break;
      case "stall":
        this.stalls++;
        break;
    }
    if (d > this.worst) this.worst = d;
    this.durations.push(d);
    if (this.durations.length > MAX_DURATIONS) this.durations.shift();
  }

  /** Pure read — does not mutate counters. */
  getStats(): NetworkStats {
    return {
      attemptCount: this.attempts,
      completedCount: this.completed,
      failedCount: this.failed,
      timeoutCount: this.timeouts,
      stallCount: this.stalls,
      p75Ms: percentile(this.durations, 75),
      worstMs: Math.round(this.worst),
    };
  }

  clear(): void {
    this.attempts = 0;
    this.completed = 0;
    this.failed = 0;
    this.timeouts = 0;
    this.stalls = 0;
    this.worst = 0;
    this.durations = [];
    recentAutomatic.length = 0;
  }
}

export const networkSampler = new NetworkSampler();

/* ─── Counting one attempt ONCE in an app that reports it twice ──────────
 *
 * Two things can report the same request: the host's own
 * `measureNetworkAttempt` call and the optional transport wrapper
 * (networkAutoWrap.ts). A mixed app — some calls hand-wired, the rest picked
 * up automatically — would otherwise report a number larger than the traffic
 * it describes, and an inflated denominator makes a stall rate look better
 * than it is.
 *
 * The rule is that the WRAPPER owns an attempt it can be shown to have
 * measured, and the caller's timer stands down only for THAT attempt. Both
 * halves of that sentence are load-bearing, and each replaces a failure:
 *
 *   · Standing the caller down whenever any automatic report happened during
 *     its window drops real attempts. A measured call on a transport the kit
 *     cannot reach, made while an unrelated wrapped request happened to be in
 *     the air, would vanish — an absence dressed as a measurement, which is
 *     the defect this whole axis is being repaired for.
 *   · Letting the caller's window suppress "the next automatic report"
 *     mis-attributes: it hands the suppression to whichever request dispatched
 *     first, so a second request made alongside a measured one is banked with
 *     the measured one's duration and outcome. The totals add up while the
 *     outcome buckets lie.
 *
 * So the caller stands down on positive evidence of the SAME request, never
 * on coincidence, and there are exactly two kinds of evidence:
 *
 *   1. The promise the caller awaited is the one a wrapper handed back. That
 *      is identity, not inference, and covers the ordinary
 *      `measureNetworkAttempt(() => fetch(url))`.
 *   2. An automatic attempt that began inside the caller's window, settled at
 *      the moment the caller's own call settled, and ended the same WAY —
 *      completed with completed, failed with failed. This is what covers a
 *      transport that awaits a token refresh before dispatching, or wraps the
 *      response, so the promise identity is lost on the way back.
 *
 * Each automatic attempt can be claimed once. Anything else — including a
 * concurrent request that merely overlapped — is recorded, because recording
 * one attempt twice overstates traffic while dropping one erases it, and only
 * the second turns an absence into a number.
 */

/** One attempt an automatic layer measured itself, waiting to be claimed. */
interface AutomaticAttempt {
  startedAt: number;
  settledAt: number;
  /** Ended loudly (error/timeout) rather than completing (ok/stall). */
  failed: boolean;
  claimed: boolean;
}

/** Bounded: a few concurrent requests, never a session's worth. */
const RECENT_AUTOMATIC_MAX = 16;

/**
 * How close two settles must be to be one request (ms).
 *
 * The caller's `await` resumes a microtask after the wrapper's own settle, so
 * the honest gap is sub-millisecond; the allowance is for a loaded device, not
 * for guessing. A second request that merely overlapped is rejected by this
 * bound, by the outcome class, or by having already been claimed.
 */
const SAME_REQUEST_SETTLE_MS = 10;

const recentAutomatic: AutomaticAttempt[] = [];

function isLoudFailure(outcome: NetworkOutcome): boolean {
  return outcome === "error" || outcome === "timeout";
}

/**
 * An automatic layer has just BANKED an attempt it measured itself. Called at
 * settle (not at dispatch), with the window it actually measured, so a caller
 * awaiting the same request can recognise it rather than infer it.
 */
export function noteAutomaticAttempt(attempt: {
  startedAt: number;
  settledAt: number;
  outcome: NetworkOutcome;
}): void {
  recentAutomatic.push({
    startedAt: attempt.startedAt,
    settledAt: attempt.settledAt,
    failed: isLoudFailure(attempt.outcome),
    claimed: false,
  });
  while (recentAutomatic.length > RECENT_AUTOMATIC_MAX) recentAutomatic.shift();
}

/**
 * Was the caller's own call one a wrapper already banked? Claims it if so, so
 * no second caller can stand down on the same attempt.
 */
export function claimAutomaticAttempt(window: {
  startedAt: number;
  endedAt: number;
  failed: boolean;
}): boolean {
  for (let i = recentAutomatic.length - 1; i >= 0; i--) {
    const a = recentAutomatic[i];
    if (a.claimed) continue;
    if (a.failed !== window.failed) continue;
    // Began after the caller started timing, and was over by the time the
    // caller's own call came back.
    if (a.startedAt < window.startedAt) continue;
    if (a.settledAt > window.endedAt) continue;
    if (window.endedAt - a.settledAt > SAME_REQUEST_SETTLE_MS) continue;
    a.claimed = true;
    return true;
  }
  return false;
}

/**
 * Marks the promise a wrapper hands back, so its caller knows it by identity.
 *
 * A REGISTERED symbol rather than a string key. `Symbol.for` returns the same
 * symbol to every copy of this kit loaded in the realm, which is the actual
 * requirement — an app can easily end up with two copies, and the wrapper in
 * one has to be recognised by `measureNetworkAttempt` in the other. A string
 * property was ours by convention only: an app or a transport is free to own
 * a property of that name on its own promise, and defining ours would have
 * replaced it. No string-named property can reach a symbol key, so that
 * accidental collision is gone.
 *
 * It is NOT unnameable, and the guarantee is worded accordingly: a REGISTERED
 * symbol is by definition shared, so anyone asking `Symbol.for` for this key
 * gets this marker — which is exactly how a second copy of the kit finds it.
 * An app that deliberately defines this key on its own promise keeps its own
 * value (the stamp is never redefined over an existing one); if that value is
 * `true` its promise reads as one of ours, and a hand-measured call around it
 * stands down for an attempt the wrapper did not make. Deliberate, not
 * accidental, and the same is true of any shared registry key.
 */
const AUTOMATIC_PROMISE: symbol = Symbol.for("boosthis.automaticAttempt");

/**
 * Stamp the promise a wrapper returns.
 *
 * Symbol-keyed and non-enumerable, so `JSON.stringify`, `Object.keys`, a
 * `for...in` and `Object.getOwnPropertyNames` over the app's own promise are
 * all unchanged by it — not invisible, which would be a bigger claim:
 * `Object.getOwnPropertySymbols` finds it, and that is the honest
 * description. An existing stamp is left alone rather than redefined, and a
 * frozen or exotic thenable simply refuses it and keeps the settle-time
 * evidence instead.
 */
export function markAutomaticPromise<T>(value: T): T {
  try {
    if (
      Object.getOwnPropertyDescriptor(value as object, AUTOMATIC_PROMISE) ===
      undefined
    ) {
      Object.defineProperty(value as object, AUTOMATIC_PROMISE, {
        value: true,
        enumerable: false,
        configurable: true,
        writable: false,
      });
    }
  } catch {
    // A frozen or exotic thenable. The settle-time evidence still applies.
  }
  return value;
}

/** Is this the very promise one of our wrappers returned? */
export function isAutomaticPromise(value: unknown): boolean {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return false;
  }
  try {
    // Read as a descriptor rather than by index: the marker is always an OWN
    // property, this cannot run a getter the app put on a prototype, and it
    // keeps the kit compiling on the older TypeScript settings a host may
    // build it under, where a plain `symbol` is not an index type.
    return (
      Object.getOwnPropertyDescriptor(value as object, AUTOMATIC_PROMISE)
        ?.value === true
    );
  } catch {
    return false;
  }
}

/**
 * Report one network attempt to the Network axis. The ONLY way to feed this
 * axis. Call it from your transport layer once per request:
 *
 *   recordNetworkAttempt({ durationMs: 920, outcome: "ok" });
 *   recordNetworkAttempt({ durationMs: 8000, outcome: "timeout" });
 *
 * Pass only the millisecond duration and a coarse outcome bucket — there is
 * intentionally no field for the URL, host, status, or any request detail, so
 * nothing identifying can leak through this surface.
 *
 * WITH AUTOMATIC WRAPPING ON (`autoWrapNetwork`) this still records exactly
 * what it is handed, and is NOT de-duplicated against the wrapper. It arrives
 * after the fact, and a duration and an outcome word carry nothing that could
 * say whether they belong to a call the wrapper has just timed or to a second
 * one on a transport we never saw — so suppressing it would be a guess, and
 * guessing here drops real attempts. Keep it for transports the kit cannot
 * reach; for a call that goes out through the global `fetch` or
 * `XMLHttpRequest`, use `measureNetworkAttempt`, which recognises the
 * wrapper's own measurement of that same request and is therefore counted
 * once.
 */
export function recordNetworkAttempt(input: {
  durationMs: number;
  outcome: NetworkOutcome;
}): void {
  networkSampler.record(input);
}

/** Current aggregate, for dashboards/tests. Counts + durations only. */
export function getNetworkStats(): NetworkStats {
  return networkSampler.getStats();
}

/**
 * Convenience wrapper: time a promise-returning network call and report the
 * attempt automatically. Records "ok" on resolve (or "stall" when a `stallMs`
 * threshold is given and exceeded) and "error" on reject, then re-throws so
 * your own error handling is unchanged. Like `recordNetworkAttempt`, it never
 * sees a URL/label — pass the bare call. For an explicit caller-timer timeout,
 * report `outcome: "timeout"` yourself.
 *
 * WITH AUTOMATIC WRAPPING ON this records nothing when one of the kit's own
 * transport layers measured THIS request — the promise it handed back is the
 * one being awaited here, or an automatic attempt began inside this window,
 * settled with it and ended the same way. That layer has already banked the
 * request with its own duration and outcome, and a second record here would
 * be the same attempt counted twice; the `stallMs` given here then does not
 * apply, because the wrapper's own threshold, set once on `enableTelemetry`,
 * decided it. An unrelated request that merely overlapped this one does NOT
 * stand this timer down: see the rule above for why a coincidence may never
 * suppress a reading.
 */
export async function measureNetworkAttempt<T>(
  fn: () => Promise<T>,
  opts: { stallMs?: number } = {},
): Promise<T> {
  const startedAt = nowMs();
  let pending: unknown;
  try {
    pending = fn();
  } catch (e) {
    // Threw before returning anything — including a wrapped transport that
    // throws synchronously, which banks its own loud failure.
    if (!claimAutomaticAttempt({ startedAt, endedAt: nowMs(), failed: true })) {
      networkSampler.record({
        durationMs: nowMs() - startedAt,
        outcome: "error",
      });
    }
    throw e;
  }
  // Identity, taken before awaiting: this IS the promise a wrapper returned.
  const wrapperOwns = isAutomaticPromise(pending);
  let result: T;
  try {
    result = (await pending) as T;
  } catch (e) {
    const claimed = claimAutomaticAttempt({
      startedAt,
      endedAt: nowMs(),
      failed: true,
    });
    if (!wrapperOwns && !claimed) {
      networkSampler.record({
        durationMs: nowMs() - startedAt,
        outcome: "error",
      });
    }
    throw e;
  }
  const endedAt = nowMs();
  // Claimed either way, so the attempt this call was cannot later be taken as
  // some other call's own.
  const claimed = claimAutomaticAttempt({ startedAt, endedAt, failed: false });
  if (wrapperOwns || claimed) return result;
  const durationMs = endedAt - startedAt;
  const stallMs = opts.stallMs;
  networkSampler.record({
    durationMs,
    outcome:
      typeof stallMs === "number" && stallMs > 0 && durationMs >= stallMs
        ? "stall"
        : "ok",
  });
  return result;
}
