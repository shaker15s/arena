/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: input-delay sampling (FID + ongoing responsiveness) ──────
 *
 * Adapted from Indeed's react-native-lighthouse PanResponder pattern.
 * Mount once at the root layout via {...panHandlers} on a root <View>.
 *
 * Two signals come out of the SAME root touch observer:
 *   1. First Input Delay (FID) — the classic one-shot metric. Captured on
 *      the first touch of the session, exposed via getSessionFid(), and fed
 *      into the composite score. Behaviour unchanged.
 *   2. Ongoing responsiveness (INP-style) — EVERY touch's main-thread
 *      processing delay, kept in a small rolling ring buffer so the meter
 *      can show p75/p95 interaction latency, not just the first tap.
 *
 * The observer never steals the gesture (every handler returns false), so
 * descendants still handle touches normally. The ongoing INP ring buffer is
 * gated by perfMonitor.isEnabled() so a shipped (non-dev) app pays nothing for
 * it — but the ONE-SHOT FID is captured UNGATED, because the composite score
 * reads getSessionFid() even in production (where the monitor's dev-only flag
 * is off); gating it would silently drop the FID weight and break parity.
 */

import { useMemo } from "react";
import {
  PanResponder,
  type GestureResponderEvent,
  type PanResponderInstance,
} from "react-native";
import { perfMonitor, frameSampler } from "../perfMonitor";
import { recordInteractionTap } from "../reRenders";
import { recordNavTap, noteTapObserved } from "../navDeadTime";
import { currentScreen } from "../screenAttribution";

let sessionFidMs: number | null = null;
let captured = false;

/** Rolling buffer of recent interaction delays (ms), bounded so memory
 *  stays flat over a long session. */
const MAX_INTERACTION_SAMPLES = 100;
let interactionDeltas: number[] = [];
/** Dedupe guard: the capture + bubble handlers BOTH fire for a single
 *  gesture, so without this we'd double-count every touch. It also prevents
 *  overlapping measures from stacking. */
let measuring = false;

/* ─── Rage-tap (frustration) detection ────────────────────────────────────
 * A "rage burst" = ≥RAGE_MIN_TAPS taps within RAGE_WINDOW_MS, clustered inside
 * a small on-screen region (≤RAGE_RADIUS_DP across), where the measured input
 * delay was ≥RAGE_MIN_DELAY_MS — i.e. the user jabbed the same spot because
 * nothing responded fast enough. This is the human "is it frozen?" signal.
 *
 * PRIVACY: touch coordinates are compared EPHEMERALLY in memory to test the
 * cluster geometry and are NEVER persisted beyond the rolling window, logged,
 * or uploaded. The only things that leave this module are coordinate-free
 * counts: a `rage:burst` event (carrying just the input delay) and the
 * burstCount / worstDelayMs aggregates exposed by getFrustrationStats(). */
export const RAGE_WINDOW_MS = 700;     // taps must fall inside this rolling window
export const RAGE_MIN_TAPS  = 3;       // ≥3 jabs to count as a frustrated mash
export const RAGE_RADIUS_DP = 64;      // jabs must cluster within ~one control
/** Input delay (ms) above which a tap "felt unresponsive". Kept in lockstep
 *  with RESPONSIVENESS_THRESHOLDS.poor in meterAxes.ts, duplicated as a plain
 *  number so this touch-hot hook never imports the axes layer. */
export const RAGE_MIN_DELAY_MS = 300;
/** Bound the ephemeral coordinate buffer so memory stays flat. */
const RAGE_MAX_BUFFER = 12;

export interface RageTapSample { t: number; x: number; y: number }

/** Ephemeral rolling buffer of recent tap positions — trimmed to the rage
 *  window on every touch and CLEARED after a confirmed burst. Never persisted
 *  or transmitted; exists only to test cluster geometry transiently. */
let recentTaps: RageTapSample[] = [];
let rageBurstCount = 0;
let worstRageDelayMs = 0;

/** Pure geometry+timing test: do the recent taps (already trimmed to the rage
 *  window) plus THIS tap's measured input delay constitute a rage burst? No
 *  side effects, no I/O — exported so it can be unit-tested without timers. */
export function isRageBurst(recent: RageTapSample[], delayMs: number): boolean {
  if (delayMs < RAGE_MIN_DELAY_MS) return false;     // the app actually responded fast
  if (recent.length < RAGE_MIN_TAPS) return false;   // not enough jabs (e.g. a double-tap)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const tp of recent) {
    if (tp.x < minX) minX = tp.x;
    if (tp.x > maxX) maxX = tp.x;
    if (tp.y < minY) minY = tp.y;
    if (tp.y > maxY) maxY = tp.y;
  }
  // The whole cluster must fit inside one small region — taps scattered across
  // the screen are navigation, not a frustrated mash on a frozen control.
  return maxX - minX <= RAGE_RADIUS_DP && maxY - minY <= RAGE_RADIUS_DP;
}

/** Defer a callback to just after the current input event. `setImmediate`
 *  exists in React Native (and Node) but NOT in browsers, so on Expo web we
 *  fall back to a 0ms timeout. `typeof` on an undeclared global is safe and
 *  never throws. */
const deferToNextTick: (cb: () => void) => void =
  typeof setImmediate === "function"
    ? setImmediate
    : (cb) => {
        setTimeout(cb, 0);
      };

/** Get the captured first-input delay for this session, or null if no
 *  interaction has happened yet. Cheap pure read. */
export function getSessionFid(): number | null {
  return sessionFidMs;
}

export interface InteractionStats {
  /** Number of interactions sampled (capped at the ring size). */
  count:   number;
  /** 75th-percentile interaction delay, ms — the INP-style headline. */
  p75Ms:   number;
  /** 95th-percentile interaction delay, ms. */
  p95Ms:   number;
  /** Worst single interaction in the window, ms. */
  worstMs: number;
}

/** Snapshot the rolling interaction-delay window. Pure read — sampling
 *  keeps running. Returns zeros (count 0) when nothing has been sampled. */
export function getInteractionStats(): InteractionStats {
  const sorted = [...interactionDeltas].sort((a, b) => a - b);
  const p = (q: number) =>
    sorted.length === 0
      ? 0
      : sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
  return {
    count:   sorted.length,
    p75Ms:   p(0.75),
    p95Ms:   p(0.95),
    worstMs: sorted.length === 0 ? 0 : sorted[sorted.length - 1],
  };
}

export interface FrustrationStats {
  /** Confirmed rage-tap bursts this session (coordinate-free). */
  burstCount:   number;
  /** Worst input delay (ms) measured during a rage burst, 0 if none. */
  worstDelayMs: number;
}

/** Snapshot the session's rage-tap counters. Pure read; never exposes
 *  coordinates (none are retained beyond the ephemeral window). */
export function getFrustrationStats(): FrustrationStats {
  return { burstCount: rageBurstCount, worstDelayMs: worstRageDelayMs };
}

/** Observe one root touch: schedule a deferred main-thread-delay measure.
 *  Deduped per gesture via `measuring`.
 *
 *  Gating is split ON PURPOSE:
 *   - The ONE-SHOT FID is captured on the first touch UNCONDITIONALLY. The
 *     composite score reads getSessionFid() even in a shipped app (where the
 *     monitor's dev-only `enabled` flag is false), so gating it would drop the
 *     0.30 FID weight and break cross-runtime parity with Python + the server
 *     rating buckets.
 *   - The ongoing INP ring buffer only fills while perfMonitor.isEnabled().
 *   - Once the FID is captured AND monitoring is off, this does ZERO per-touch
 *     work, so a shipped app pays nothing after its first interaction. */
function handleTouchCapture(x?: number, y?: number): void {
  // This runs on the HOST's root touch observer, outside any React error
  // boundary. A throw here (or in the deferred tick below) would crash the
  // host's gesture system, so the whole path is fail-soft: any error is
  // swallowed and `measuring` is always reset so sampling can't wedge.
  try {
    const enabled = perfMonitor.isEnabled();
    // After the one-shot FID is captured, a disabled monitor does no more work.
    if (captured && !enabled) return;
    // The press-to-screen reading is told that a press REACHED this sampler,
    // whether or not the monitor forwards it below. That is the difference
    // between "nobody has pressed anything" and "presses are not being
    // collected in this build", which the axis cannot otherwise tell apart —
    // and in a shipped app, where the monitor is off by default, the second
    // is the true answer. One observation settles it, so this sits after the
    // early return above: a captured-and-disabled app still does no work.
    noteTapObserved();
    if (measuring) return;
    measuring = true;
    const inputTime = Date.now();
    // Idle axis — stamp this interaction so the FrameSampler knows the user is
    // still active; any frame it samples ≥5s after the last touch counts as idle
    // wasted work. Coordinate-free (timestamp only) and only meaningful while the
    // monitor — and thus the frame sampler — is running, so it's gated on enabled.
    if (enabled) frameSampler.markTouch();
    // Re-render Storms + Navigation Dead Time axes: stamp this tap's timestamp
    // so a following commit / screen-mount-start can be attributed to it.
    // Coordinate-free (timestamp only). Both recorders are best-effort and can
    // never throw into the host's gesture system.
    if (enabled) {
      recordInteractionTap(inputTime);
      recordNavTap(inputTime);
    }
    // Record this tap's position in the EPHEMERAL rage window — only while
    // enabled, and only when the platform handed us coordinates. These are
    // compared transiently for burst geometry and never stored beyond the
    // window, logged, or uploaded.
    if (enabled && typeof x === "number" && typeof y === "number") {
      recentTaps.push({ t: inputTime, x, y });
      const cutoff = inputTime - RAGE_WINDOW_MS;
      while (recentTaps.length > 0 && recentTaps[0].t < cutoff) recentTaps.shift();
      if (recentTaps.length > RAGE_MAX_BUFFER) {
        recentTaps.splice(0, recentTaps.length - RAGE_MAX_BUFFER);
      }
    }
    deferToNextTick(() => {
      try {
        const delay = Date.now() - inputTime;
        // Ongoing responsiveness — ring buffer, only while enabled (NOT
        // recordEvent: its MIN_LOG_MS floor would drop fast taps and skew p75 up).
        if (enabled) {
          interactionDeltas.push(delay);
          if (interactionDeltas.length > MAX_INTERACTION_SAMPLES) {
            interactionDeltas.splice(0, interactionDeltas.length - MAX_INTERACTION_SAMPLES);
          }
          // Frustration — if this tap landed in a confirmed rage burst, count it
          // (coordinate-free) and clear the window, so a long continuous mash
          // registers as one burst until ≥3 fresh jabs accrue again.
          if (isRageBurst(recentTaps, delay)) {
            rageBurstCount += 1;
            if (delay > worstRageDelayMs) worstRageDelayMs = delay;
            // Name the screen the user was jabbing at, read HERE rather than
            // when the finding is built (by then it is the last screen seen).
            // No screen current means the burst carries none — never a guess.
            const onScreen = currentScreen();
            perfMonitor.recordEvent(
              "rage:burst",
              delay,
              onScreen == null ? undefined : { screen: onScreen },
            );
            recentTaps = [];
          }
        }
        // One-shot FID — first interaction only, ALWAYS captured (feeds the
        // composite). recordEvent self-gates on isEnabled() internally.
        if (!captured) {
          captured = true;
          sessionFidMs = delay;
          perfMonitor.recordEvent("fid:firstInput", delay);
        }
      } catch {
        // fail soft: a sampling error must never crash a deferred tick
      } finally {
        measuring = false;
      }
    });
  } catch {
    // fail soft: touch observation must never crash the host's gesture system.
    // Reset the dedupe guard so a single failure can't wedge all sampling.
    measuring = false;
  }
}

export interface UseFidSamplerResult {
  /** Spread onto a root <View> as `{...result.panHandlers}` to observe
   *  every touch start app-wide. */
  panHandlers: PanResponderInstance["panHandlers"];
}

export function useFidSampler(): UseFidSamplerResult {
  const responder = useMemo(() => {
    // Capture-phase: observe touches app-wide before any descendant claims
    // the responder. We always return false so we never steal the gesture —
    // descendants still handle it normally.
    const onCapture = (evt: GestureResponderEvent) => {
      // pageX/pageY feed ONLY the ephemeral rage-burst geometry test; they are
      // never stored, logged, or uploaded (see handleTouchCapture).
      const ne = evt?.nativeEvent;
      handleTouchCapture(ne?.pageX, ne?.pageY);
      return false;
    };
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: onCapture,
      onStartShouldSetPanResponder: onCapture,
      onMoveShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: () => false,
    });
  }, []);
  return { panHandlers: responder.panHandlers };
}

/** Test-only: simulate a single root touch capture. Drives the exact path
 *  the PanResponder handlers do, since the RN test stub doesn't invoke the
 *  responder config. */
export function _simulateTouchForTests(x?: number, y?: number): void {
  handleTouchCapture(x, y);
}

/** Test-only hook to reset all captured state between sessions. */
export function _resetSessionFidForTests(): void {
  sessionFidMs = null;
  captured = false;
  interactionDeltas = [];
  measuring = false;
  recentTaps = [];
  rageBurstCount = 0;
  worstRageDelayMs = 0;
}
