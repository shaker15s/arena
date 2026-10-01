/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: press-to-screen timing source (React Native) ──────────────
 *
 * Two readings, one join, taken from the same pair of clock reads.
 *
 *   navDeadTime    the press → the destination screen STARTS mounting.
 *                  The gap where nothing visibly happens.
 *   pressToScreen  the press → that screen is USABLE. The whole wait, which
 *                  is the thing a person actually complains about.
 *
 * Dead time alone flatters an app that shows an empty shell instantly and then
 * spins: the shell mounts in 80ms and the reading calls that good while the
 * person waits three seconds for content. So the press is now carried through
 * to the completion of the destination screen's OWN reading, and the whole
 * interval is published beside the leg.
 *
 * THE BOUND, AND WHAT IT LEAVES BEHIND
 * A press used to be thrown away if no screen mounted within 3 seconds, with
 * no count kept. That deleted exactly the navigations this reading exists to
 * catch and published the survivors as healthy. The bound is now 15 seconds —
 * long enough that a genuinely slow navigation becomes a reading — and every
 * press it does not join is COUNTED, in two kinds, and sent:
 *
 *   unjoinedPastBound  a screen mounted, later than the bound allows. The
 *                      navigation happened and it was slow; we will not claim
 *                      it was this press that caused it.
 *   unjoinedNoScreen   no destination we could attribute to this press: it was
 *                      replaced by the next press before anything mounted.
 *
 * Both clock reads are Date.now() taken in this process — the press in the
 * touch handler, the mount and the completion in the screen observer — so the
 * two ends of every interval are on one clock.
 *
 * HONESTY / INVARIANTS:
 *   • NEITHER reading feeds the composite Speed score. Both are additive.
 *   • The whole interval is MEASURED, never the sum of the two legs'
 *     percentiles: p75(a+b) is not p75(a)+p75(b), and summing would publish a
 *     wait nobody had.
 *   • OMIT WHILE WARMING: both readers stay pending until ≥5 navigations.
 *   • NUMERIC-ONLY on the wire. No captions, no screen names, no identifiers.
 *   • The bound travels as a number so the server can word it without
 *     retyping the constant.
 *
 * WHEN IT CAN NEVER BE TAKEN HERE
 * An app whose navigation this kit cannot see would otherwise sit on
 * "pending" for ever — a promise of a number that is never coming. Three
 * answers replace it, all POSITIVELY evidenced and never inferred from an
 * absent value:
 *
 *   OFF_IN_THIS_BUILD           a press reached the touch sampler and never
 *                               reached this reading, so the collector
 *                               between them is not running. This is the
 *                               ordinary case in a SHIPPED app: the sampler
 *                               forwards presses only while the in-app
 *                               monitor is on, and that is off by default
 *                               outside development.
 *   NOT_WIRED_BY_HOST           the host app never mounted the navigation
 *                               observer, and has been pressed five times
 *                               since — long past any race with app start.
 *   NAVIGATION_NOT_RECOGNISED   the observer mounted and could not read the
 *                               router it was handed.
 *
 * All three also require that NOTHING has ever joined: a kit that has produced
 * one navigation plainly can follow this app, whatever the observer says
 * now, and the counts ride along either way so a reader can tell the two
 * apart.
 *
 * Contract: docs/press-to-screen-contract.md
 *
 * GUEST-SAFETY: every recorder is a plain best-effort counter called from an
 * existing kit observer; a throw can never reach the host. No host globals
 * wrapped, no native modules, no timers.
 */

import { linearScore, ratingFor, type AxisRating, type AxisThresholds } from "./axisScoring";
import {
  REASON_NAVIGATION_NOT_RECOGNISED,
  REASON_NOT_WIRED_BY_HOST,
  REASON_OFF_IN_THIS_BUILD,
} from "./axisReasons";
import { noteLiveConnectionScreenChange } from "./liveConnections";

/** Dead-time score bands (ms). ≤200ms feels immediate (100); ≥1s reads as a
 *  dead tap (0). */
export const NAV_DEAD_TIME_THRESHOLDS = { good: 200, poor: 1000 } as const satisfies AxisThresholds;

/**
 * Whole-interval bands (ms). A different quantity from the leg above, so a
 * different pair of edges: the upper one is the complaint this reading came
 * from — "I tapped and the screen took three seconds" — so three seconds sits
 * at the bottom of the scale rather than somewhere in the middle of it.
 */
export const PRESS_TO_SCREEN_THRESHOLDS = { good: 1_000, poor: 3_000 } as const satisfies AxisThresholds;

/**
 * How long a press may wait for a destination before we stop attributing one
 * to it. Deliberately generous: the old 3s window deleted the slow
 * navigations this reading exists to catch. What it still refuses is counted
 * and published rather than dropped — a person who taps, gives up, and taps
 * something else twenty seconds later did not experience one navigation.
 */
export const NAV_JOIN_BOUND_MS = 15_000;

/** Navigations needed before either reading leaves "pending". */
const NAV_DEAD_TIME_MIN_NAVS = 5;

/** Bounded rings of per-nav readings. */
const NAV_RING_CAP = 300;

export interface NavDeadTimeResult {
  /** 0–100, or null while pending (fewer than 5 navs). */
  score:    number | null;
  rating:   AxisRating;
  /** p75 press→mount-start gap (ms), or null while pending. */
  p75Ms:    number | null;
  /** Correlated navigations (shown even while pending). */
  navCount: number;
}

export interface PressToScreenResult {
  /** 0–100, or null while pending (fewer than 5 joined navigations). */
  score:   number | null;
  rating:  AxisRating;
  /** p75 press→usable interval (ms), or null while pending. */
  p75Ms:   number | null;
  /** Navigations joined press→usable (shown even while pending). */
  navCount: number;
  /** p75 of the dead-time leg over the SAME joined navigations. */
  deadP75Ms:   number | null;
  /** p75 of the settle leg (mount-start→usable) over the same navigations. */
  settleP75Ms: number | null;
  /** Presses whose screen mounted past the bound. Never silently dropped. */
  unjoinedPastBound: number;
  /** Presses no destination could be attributed to at all. */
  unjoinedNoScreen:  number;
  /** Presses whose destination screen never produced a reading of its own —
   *  abandoned before it drew, past the arrival cap, or superseded by the
   *  next screen. The wait was real; there is simply no end to measure it to,
   *  and it is counted rather than dropped. */
  unjoinedNoTiming:  number;
  /** The bound in force, so the server words it without retyping it. */
  boundMs: number;
  /** 0 beside a reason code: this app will never produce the reading, so no
   *  surface may word it as warming up. Absent while the reading is live or
   *  genuinely still warming. */
  measurable?: 0;
  /** WHY it can never be taken here, from the shared closed vocabulary in
   *  axisReasons.ts. A code, never prose — the server owns the words. */
  reasonCode?: number;
}

/** The most recent press, still eligible to join a mount. Consumed once a
 *  mount joins it, so one press yields at most one navigation. */
let lastTapAt: number | null = null;
/** Per-nav dead-time gaps (ms) — the leg, on its own, as before. */
const gaps: number[] = [];
/** Joined navigations: the whole interval and the leg it contains. */
const joined: { dead: number; whole: number }[] = [];
/** The press the screen currently mounting belongs to, awaiting its
 *  completion. Null when this mount had no press to join. */
let openPressAt: number | null = null;
/** Where the mount that consumed that press started. */
let openMountAt: number | null = null;

let unjoinedPastBound = 0;
let unjoinedNoScreen = 0;
let unjoinedNoTiming = 0;

/** Presses this kit saw, whether or not a screen followed. Positive evidence
 *  that the app is being USED: without it, "nobody has navigated yet" and
 *  "this app's navigation is invisible to us" look identical, and the second
 *  must never be claimed from the first. */
let pressesSeen = 0;

/** Presses that reached the touch sampler, whether or not it forwarded them
 *  to this reading. The sampler stamps this before its own monitor gate, so
 *  a press counted here and missing from `pressesSeen` is proof that the
 *  press collector is not running in this build — which is the ordinary case
 *  in a shipped app, where the monitor is off by default. Without it, "nobody
 *  has pressed anything yet" and "presses are not being collected" are the
 *  same silence, and this reading would wait for a number that is never
 *  coming. */
let tapsObserved = 0;

/** Told by the touch sampler that a press reached it. Best-effort, NEVER
 *  throws: it runs on the host's own gesture path. */
export function noteTapObserved(): void {
  try {
    tapsObserved++;
  } catch {
    /* best-effort */
  }
}

/** What the navigation observer found. */
export type NavWiring =
  /** Nothing was ever attached — the host app never mounted the observer. */
  | "none"
  /** Attached, and handed a router it could not read. We looked. */
  | "unrecognised"
  /** A router it subscribed to, or route values fed straight in. */
  | "followed";

/** Pushed in by the observer on every change, rather than read back out of
 *  it: the observer imports this module, and an import the other way would
 *  close a cycle. */
let navWiring: NavWiring = "none";

/** Told by the navigation observer whenever what it found changes. */
export function noteNavWiring(w: NavWiring): void {
  try {
    navWiring = w;
  } catch {
    /* best-effort */
  }
}

/** Presses that must pass before "the host never wired it" is a fact rather
 *  than a race with app start. An observer that was going to mount has
 *  mounted long before a person has pressed five things. */
const WIRING_EVIDENCE_PRESSES = 5;

/**
 * Record a press (from the fid sampler). The next screen-mount start within
 * the bound joins it. Best-effort, NEVER throws.
 */
export function recordNavTap(now: number): void {
  try {
    // A press still waiting when the next one arrives never reached a screen.
    // That is the count the old window threw away in silence.
    if (lastTapAt != null) unjoinedNoScreen++;
    // Counted whether or not anything ever follows it: this is the evidence
    // that the app is in use, which is what separates a silent kit from a
    // silent app.
    pressesSeen++;
    lastTapAt = now;
  } catch {
    /* best-effort */
  }
}

/**
 * Record the START of a screen mount (from the kit's screen tracker). Banks
 * the dead-time leg and holds the press for this screen's own completion.
 * Best-effort, NEVER throws.
 */
export function recordScreenMountStart(now: number): void {
  try {
    // Realtime: the SAME screen-mount signal tells the live-connection watcher
    // that the app moved. No new navigation listener, so an app on any router
    // is covered identically. Announced BEFORE the press-join early return
    // below — a screen change is a screen change whether or not a press
    // preceded it.
    noteLiveConnectionScreenChange();
  } catch {
    /* best-effort */
  }
  try {
    // A new mount supersedes whatever the last one was waiting to complete.
    // That earlier screen never produced a reading, so its press has no end
    // to be measured to — counted as such, never charged to this screen.
    if (openPressAt != null) unjoinedNoTiming++;
    openPressAt = null;
    openMountAt = null;
    if (lastTapAt == null) return;
    const gap = now - lastTapAt;
    // Consume the press regardless — a mount that arrives ends this press's
    // candidacy either way (a later, unrelated mount must not reuse it).
    const tapAt = lastTapAt;
    lastTapAt = null;
    if (gap < 0) {
      // The arrival precedes the press. There is no interval here to publish,
      // and no destination we can attribute to this press.
      unjoinedNoScreen++;
      return;
    }
    if (gap > NAV_JOIN_BOUND_MS) {
      unjoinedPastBound++;
      return;
    }
    gaps.push(gap);
    if (gaps.length > NAV_RING_CAP) {
      gaps.splice(0, gaps.length - NAV_RING_CAP);
    }
    // Held for the destination screen's own completion, which is what turns
    // this leg into the whole interval.
    openPressAt = tapAt;
    openMountAt = now;
  } catch {
    /* best-effort */
  }
}

/**
 * The destination screen is USABLE — called from the screen observer at the
 * same moment it completes that screen's own reading, so the two readings
 * cannot disagree about when a screen was ready. Best-effort, NEVER throws.
 */
export function recordScreenUsable(now: number): void {
  try {
    const pressAt = openPressAt;
    const mountAt = openMountAt;
    openPressAt = null;
    openMountAt = null;
    if (pressAt == null || mountAt == null) return;
    const whole = now - pressAt;
    const dead = mountAt - pressAt;
    if (whole < 0 || dead < 0 || whole < dead) return;
    joined.push({ dead, whole });
    if (joined.length > NAV_RING_CAP) {
      joined.splice(0, joined.length - NAV_RING_CAP);
    }
  } catch {
    /* best-effort */
  }
}

/**
 * The screen that was mounting went away without ever producing a reading —
 * abandoned, backgrounded, or measured by the host itself. The press it was
 * holding is dropped rather than charged to whatever screen completes next.
 */
export function forgetPendingScreenPress(): void {
  // The wait was real — there is simply no moment to measure it to. Counted,
  // so a screen that never draws shows up as presses that reached no timed
  // screen rather than as nothing at all.
  if (openPressAt != null) unjoinedNoTiming++;
  openPressAt = null;
  openMountAt = null;
}

/** Nearest-rank p75 of an unordered list (does not mutate). 0 when empty. */
function p75(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(0.75 * sorted.length) - 1));
  return sorted[idx];
}

/**
 * The Navigation Dead Time axis, or a pending reading while warming up (<5
 * navs). Pure read — never mutates state, NEVER throws. Numbers-only wire shape.
 */
export function readNavDeadTime(): NavDeadTimeResult {
  try {
    const navCount = gaps.length;
    if (navCount < NAV_DEAD_TIME_MIN_NAVS) {
      return { score: null, rating: "pending", p75Ms: null, navCount };
    }
    const gap = p75(gaps);
    const score = linearScore(
      gap,
      NAV_DEAD_TIME_THRESHOLDS.good,
      NAV_DEAD_TIME_THRESHOLDS.poor,
    );
    return { score, rating: ratingFor(score), p75Ms: Math.round(gap), navCount };
  } catch {
    return { score: null, rating: "pending", p75Ms: null, navCount: 0 };
  }
}

/**
 * The whole press→usable interval, its two legs, and everything the bound
 * left behind. Pure read — never mutates state, NEVER throws.
 *
 * The counts ride even while the reading is pending: "nothing joined yet, and
 * here is how many presses went nowhere" is an answer, and it is the one the
 * old silent discard made impossible.
 */
export function readPressToScreen(): PressToScreenResult {
  try {
    const navCount = joined.length;
    const base = {
      navCount,
      unjoinedPastBound,
      unjoinedNoScreen,
      unjoinedNoTiming,
      boundMs: NAV_JOIN_BOUND_MS,
    };
    if (navCount < NAV_DEAD_TIME_MIN_NAVS) {
      // WHY it is empty, wherever we can say why. Both branches need the app
      // to have been pressed and nothing to have ever joined; the counts ride
      // along either way (docs/press-to-screen-contract.md).
      // A press reached the sampler and never reached this reading: the
      // collector between them is not running in this build. Positive
      // evidence, and the ordinary case in a shipped app — checked FIRST,
      // because where presses are not collected at all, what the navigation
      // observer found cannot make the reading available either.
      const collectorOff =
        navCount === 0 && pressesSeen === 0 && tapsObserved > 0;
      const unreadable =
        navCount === 0 && pressesSeen > 0 && navWiring === "unrecognised";
      const neverWired =
        navCount === 0 &&
        pressesSeen >= WIRING_EVIDENCE_PRESSES &&
        navWiring === "none";
      if (collectorOff || unreadable || neverWired) {
        return {
          score: null,
          rating: "not-available" as AxisRating,
          measurable: 0,
          reasonCode: collectorOff
            ? REASON_OFF_IN_THIS_BUILD
            : unreadable
              ? REASON_NAVIGATION_NOT_RECOGNISED
              : REASON_NOT_WIRED_BY_HOST,
          p75Ms: null,
          deadP75Ms: null,
          settleP75Ms: null,
          ...base,
        };
      }
      return {
        score: null,
        rating: "pending" as AxisRating,
        p75Ms: null,
        deadP75Ms: null,
        settleP75Ms: null,
        ...base,
      };
    }
    const whole = p75(joined.map((j) => j.whole));
    const score = linearScore(
      whole,
      PRESS_TO_SCREEN_THRESHOLDS.good,
      PRESS_TO_SCREEN_THRESHOLDS.poor,
    );
    return {
      score,
      rating: ratingFor(score),
      p75Ms: Math.round(whole),
      // Both legs are percentiles over the SAME joined navigations, each
      // measured in its own right. They are not expected to add up to the
      // whole, and a reader who adds them is reading three percentiles.
      deadP75Ms: Math.round(p75(joined.map((j) => j.dead))),
      settleP75Ms: Math.round(p75(joined.map((j) => j.whole - j.dead))),
      ...base,
    };
  } catch {
    return {
      score: null,
      rating: "pending",
      p75Ms: null,
      navCount: 0,
      deadP75Ms: null,
      settleP75Ms: null,
      unjoinedPastBound: 0,
      unjoinedNoScreen: 0,
      unjoinedNoTiming: 0,
      boundMs: NAV_JOIN_BOUND_MS,
    };
  }
}

/** Reset all state (telemetry.forget() hook + tests). Idempotent. */
export function resetNavDeadTime(): void {
  lastTapAt = null;
  gaps.length = 0;
  joined.length = 0;
  openPressAt = null;
  openMountAt = null;
  unjoinedPastBound = 0;
  unjoinedNoScreen = 0;
  unjoinedNoTiming = 0;
  pressesSeen = 0;
  tapsObserved = 0;
  // Back to what the observer's own reset says: nothing attached. A stale
  // "followed" here would let a forgotten session speak for a new one.
  navWiring = "none";
}

/** @internal test hooks — deterministic, no dependence on real timing. */
export const _navDeadTimeInternals = {
  NAV_DEAD_TIME_THRESHOLDS,
  PRESS_TO_SCREEN_THRESHOLDS,
  NAV_DEAD_TIME_MIN_NAVS,
  NAV_JOIN_BOUND_MS,
  WIRING_EVIDENCE_PRESSES,
  get navCount(): number {
    return gaps.length;
  },
  get joinedCount(): number {
    return joined.length;
  },
  get hasPendingTap(): boolean {
    return lastTapAt != null;
  },
  get hasOpenPress(): boolean {
    return openPressAt != null;
  },
  reset(): void {
    resetNavDeadTime();
  },
};
