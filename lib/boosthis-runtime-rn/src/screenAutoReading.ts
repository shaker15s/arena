/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: a screen reading nobody had to ask for ─────────────────
 *
 * `<BoosthisNavigationObserver>` already watches every route change. This
 * module is what turns that change into a MEASUREMENT, so an app that mounts
 * the observer gets per-screen readings without adding `useBoosthis()` to
 * every screen — the way the Flutter and Swift kits already behave.
 *
 * The shape is the Flutter kit's, deliberately, rather than a second design:
 *
 *   route becomes current   → `armScreenReading(label)` starts this screen's
 *                             measurement (and is also the mount START the
 *                             navigation dead-time axis correlates a tap with)
 *   the screen is actually up → the reading is completed and recorded ONCE
 *
 * "Actually up" is `InteractionManager.runAfterInteractions` — the same signal
 * `useBoosthis()` has always used for TTI, so an observed reading and a
 * hand-placed one mean the same thing and can be compared.
 *
 * TWO SOURCES, NEVER TWO READINGS
 * A screen that already calls `useBoosthis()` keeps doing exactly what it does
 * today: the hook's reading is the one that counts, and the automatic path
 * stands down for that boundary rather than adding a second reading beside it.
 * The stand-down is by BOUNDARY first (a hook that mounts while this screen's
 * reading is still open claims it, whatever the developer named it) and by
 * LABEL after that (so later visits to the same screen stand down before the
 * measurement is even started).
 *
 * WHAT THE OBSERVER CANNOT SEE
 * A modal, a drawer, a wizard step — anything that never changes route — is
 * still the developer's call to make with `useBoosthis()`. Nothing here
 * pretends to cover them.
 */

import { InteractionManager } from "react-native";
import { perfMonitor } from "./perfMonitor";
import { linearScore } from "./axisScoring";
import {
  recordProdSample,
  type ScreenReadingSource,
} from "./perfProdSampler";
import { getSessionFid } from "./hooks/useFidSampler";
import { safeScreenName, warnPartNameRefusal, MAX_PART_NAME } from "./partName";
import {
  recordScreenMountStart,
  recordScreenUsable,
  forgetPendingScreenPress,
} from "./navDeadTime";
import { markScreenMounted } from "./timerHealth";
import { markFirstRender } from "./jsStartup";

/**
 * How long a screen may stay open before the reading is abandoned. Past this
 * the app was backgrounded, or the route was left before it ever drew, and the
 * gap measures nothing: the wait is dropped rather than filed as a very slow
 * screen. Same bound, and same reason, as the Flutter kit's.
 */
export const SCREEN_ARRIVAL_CAP_MS = 10_000;

/** How many screen names may be remembered as hand-instrumented. */
const HOST_LABEL_CAP = 200;

interface PendingReading {
  label: string;
  startedAt: number;
  /** A hand-placed call has claimed this boundary — do not record it. */
  claimed: boolean;
  cancel: (() => void) | null;
}

let pending: PendingReading | null = null;
/** Screens the host measures itself; the observer stands down for these. */
const hostInstrumented = new Set<string>();
let observerReadings = 0;
let hostReadings = 0;
let standDowns = 0;
let refusedNames = 0;

/** Add a label to the hand-instrumented set, bounded. */
function rememberHostLabel(label: string): void {
  try {
    if (hostInstrumented.size >= HOST_LABEL_CAP) return;
    hostInstrumented.add(label);
  } catch {
    // never break the host
  }
}

/**
 * Score a screen phase against its band. Delegates to the kit's one checked
 * scorer rather than interpolating here.
 *
 * This was a private copy of the interpolation with no band check in it. The
 * bands it is called with are inline literals a few lines below, which is the
 * shape the repository gate cannot read — so a reversed pair here would have
 * been refused by nothing at all and simply published a perfect screen score.
 */
function linear(ms: number, good: number, poor: number): number {
  return linearScore(ms, good, poor);
}

export interface ScreenReadingScore {
  score: number;
  rating: "good" | "needs-work" | "poor" | "insufficient-data";
}

/**
 * The one place a screen reading is scored, so an observed reading and a
 * hand-placed one are never scored two different ways. A missing part simply
 * does not weigh: with no TTFF this is exactly the weighting `useBoosthis`
 * has always applied, and with one it is `usePhaseTracker`'s.
 */
export function scoreScreenReading(input: {
  ttffMs: number | null;
  ttiMs: number | null;
  fidMs: number | null;
}): ScreenReadingScore {
  const W = { TTFF: 0.25, TTI: 0.45, FID: 0.3 };
  let weightSum = 0;
  let scoreSum = 0;
  if (input.ttffMs != null) {
    weightSum += W.TTFF;
    scoreSum += W.TTFF * linear(input.ttffMs, 300, 800);
  }
  if (input.ttiMs != null && input.ttiMs > 0) {
    weightSum += W.TTI;
    scoreSum += W.TTI * linear(input.ttiMs, 500, 1500);
  }
  if (input.fidMs != null) {
    weightSum += W.FID;
    scoreSum += W.FID * linear(input.fidMs, 50, 150);
  }
  const score = weightSum === 0 ? 0 : Math.round(scoreSum / weightSum);
  return {
    score,
    rating:
      weightSum === 0
        ? "insufficient-data"
        : score >= 85
          ? "good"
          : score >= 60
            ? "needs-work"
            : "poor",
  };
}

/** Forget whatever is open, without recording it. */
function dropPending(): void {
  const open = pending;
  pending = null;
  if (!open) return;
  try {
    open.cancel?.();
  } catch {
    // ignore
  }
}

/** Close the open reading, if it is still ours to close. */
function completeReading(label: string): void {
  try {
    const open = pending;
    if (!open || open.label !== label) return;
    pending = null;
    // The host measures this boundary itself: its own completion is what marks
    // the screen usable, so nothing is recorded here. The press this mount is
    // holding is closed by the host's own call (useBoosthis), not dropped.
    if (open.claimed) return;
    // ONE clock read feeds both readings. This screen's own reading and the
    // press→usable join must never disagree about when it was ready.
    const completedAt = Date.now();
    const ttiMs = completedAt - open.startedAt;
    if (ttiMs < 0 || ttiMs > SCREEN_ARRIVAL_CAP_MS) {
      // Past the cap this measures nothing — backgrounded, or the route was
      // left before it drew. Neither reading takes it, and the press this
      // screen was holding is dropped rather than charged to a later screen.
      forgetPendingScreenPress();
      return;
    }
    const fidMs = getSessionFid();
    const { score, rating } = scoreScreenReading({
      ttffMs: null,
      ttiMs,
      fidMs,
    });
    observerReadings++;
    // The press this screen's mount joined is closed HERE, at the same moment
    // the observer calls the screen ready — the automatic path answers the
    // press→usable question exactly as the hand-placed hook does. Without
    // this the join opened on every navigation and closed on none, so an app
    // wired the usual way (an observer at the root, no per-screen hook)
    // reported "pending" for ever while its presses were dropped in silence.
    recordScreenUsable(completedAt);
    // The same two recorders `useBoosthis` feeds: the on-device screen ladder
    // (which the snapshot's per-screen rows are folded from) and the sampler.
    perfMonitor.recordScreen(label, ttiMs);
    recordProdSample({
      screen: label,
      ttffMs: null,
      ttiMs,
      fidMs,
      score,
      rating,
      source: "observer",
    });
  } catch {
    // never break the host
  }
}

/**
 * A route became current: start this screen's measurement.
 *
 * Called by the navigation observer for every screen change it sees. Safe to
 * call from anywhere — it never throws, and it records nothing by itself.
 */
export function armScreenReading(rawName: unknown): void {
  try {
    const label = safeScreenName(rawName);
    if (label === null) {
      refusedNames++;
      warnPartNameRefusal(
        typeof rawName === "string" && rawName.length > MAX_PART_NAME
          ? "too-long"
          : "invalid",
      );
      return;
    }

    // The screen currently on display, for every reading that wants to name
    // one (long tasks, rage taps, the per-sample frame and heap readings).
    // This happens whether or not we go on to measure the screen ourselves.
    markScreenMounted(label);

    // Already measured by hand: the host's own call is the reading for this
    // screen, so nothing is started here.
    if (hostInstrumented.has(label)) {
      dropPending();
      standDowns++;
      return;
    }

    // A screen still waiting when the next one arrives was never the screen
    // anybody ended up looking at. Forget it rather than charge the new
    // screen's frame with the old screen's wait.
    dropPending();

    const startedAt = Date.now();
    // The additive axes a mount start feeds, exactly as the hook feeds them.
    recordScreenMountStart(startedAt);
    markFirstRender();

    const open: PendingReading = { label, startedAt, claimed: false, cancel: null };
    pending = open;
    try {
      const handle = InteractionManager.runAfterInteractions(() =>
        completeReading(label),
      );
      open.cancel = () => handle?.cancel?.();
    } catch {
      // No InteractionManager here (a bare test host): nothing is measured,
      // and the screen is not left open pretending it will be.
      pending = null;
    }
  } catch {
    // never break the host
  }
}

/**
 * A hand-placed per-screen call ran. The host is measuring this boundary
 * itself, so the automatic path stands down for it — now, and on every later
 * visit to the same screen.
 *
 * Called by `useBoosthis` / `usePhaseTracker`. Never throws.
 */
export function noteHostScreenReading(name: unknown): void {
  try {
    hostReadings++;
    const open = pending;
    if (open && !open.claimed) {
      // Whatever the developer named it, the hook that mounted while this
      // screen's reading was open is measuring THIS boundary.
      open.claimed = true;
      rememberHostLabel(open.label);
      standDowns++;
      dropPending();
    }
    const label = safeScreenName(name);
    if (label !== null) rememberHostLabel(label);
  } catch {
    // never break the host
  }
}

export interface ScreenReadingCounts {
  /** Readings the observer produced with no per-screen code. */
  observer: number;
  /** Hand-placed `useBoosthis` / `usePhaseTracker` calls seen. */
  manual: number;
  /** Boundaries the observer left to a hand-placed call. */
  standDowns: number;
  /** Screen names the observer refused (unnameable), so none was invented. */
  refused: number;
  /** A screen whose reading is open right now — counted once, here. */
  open: string | null;
}

/** Everything a surface needs to say what it is counting, from ONE read. */
export function getScreenReadingCounts(): ScreenReadingCounts {
  return {
    observer: observerReadings,
    manual: hostReadings,
    standDowns,
    refused: refusedNames,
    open: pending && !pending.claimed ? pending.label : null,
  };
}

/**
 * What this kit's per-screen path has done, in words — ONE wording, so the
 * panel, the guide and anything else asking cannot answer differently. A
 * screen whose reading is open right now is named once and counted nowhere
 * else: it is not a reading until it completes.
 */
export function describeScreenReadingCounts(): string {
  const c = getScreenReadingCounts();
  const open = c.open === null ? "" : ` Measuring ${c.open} now.`;
  return (
    `Screens measured without being asked: ${c.observer}. ` +
    `Screens this app measures itself: ${c.manual}. ` +
    `A screen measured both ways is counted once.${open}`
  );
}

/** Is a screen's automatic reading open right now? (introspection/tests) */
export function hasOpenScreenReading(): boolean {
  return pending !== null && !pending.claimed;
}

/** @internal test hook — forget every reading, label and count. */
export function _resetScreenAutoReadingForTests(): void {
  dropPending();
  hostInstrumented.clear();
  observerReadings = 0;
  hostReadings = 0;
  standDowns = 0;
  refusedNames = 0;
}

/** @internal test hook — the hand-instrumented screens remembered so far. */
export const _screenAutoReadingInternals = {
  hostLabels: (): string[] => Array.from(hostInstrumented),
  openLabel: (): string | null => (pending ? pending.label : null),
  HOST_LABEL_CAP,
};

export type { ScreenReadingSource };
