/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: Re-render Storms axis source (React Native) ──────────────
 *
 * An RN-exclusive, ADDITIVE, display-only meter that counts how many React
 * COMMITS an interaction triggers — a "render storm" is a single tap that
 * cascades into dozens of re-renders (un-memoized subtrees, state→effect→state
 * loops, an animation driven through React state instead of the native driver).
 * The axis correlates commits reported by the kit's <BoosthisProfiler> to taps
 * (fid-sampler timestamps): every commit within ~500ms after a tap is
 * attributed to that interaction. It scores the p75 commits-per-interaction.
 *
 * RELEASE HONESTY (non-negotiable): React's <Profiler onRender> is INERT in
 * release builds, so no commits are ever reported there. We therefore report
 * `measurable:0, rating:"pending"` whenever no commit has EVER been observed —
 * the server caption says "release build — React's Profiler is off, run a dev
 * session". We never pretend a release build has "zero" re-render storms.
 *
 * Thresholds on commitsP75: good ≤2, poor ≥8. storms = interactions with ≥8
 * commits. Pending until ≥10 correlated interactions.
 *
 * HONESTY / INVARIANTS:
 *   • NEVER feeds the composite Speed score (TTFF/TTI/FID). Display-only.
 *   • measurable:0 is STILL uploaded so the tile explains itself.
 *   • NUMERIC-ONLY on the wire: { score, rating, commitsP75, interactionCount,
 *     storms, measurable }. No caption — the server rebuilds it.
 *   • Bands: linearScore(commitsP75, good=2, poor=8).
 *
 * GUEST-SAFETY: both recorders are plain best-effort counters called from
 * existing kit observers (BoosthisProfiler commit / fid tap); a throw can never
 * reach the host. No host globals wrapped, no native modules, no timers.
 */

import { linearScore, ratingFor, type AxisRating, type AxisThresholds } from "./axisScoring";
import { REASON_OFF_IN_THIS_BUILD } from "./axisReasons";

/** Commits-per-interaction score bands. ≤2 commits/tap is lean (100); ≥8 is a
 *  render storm (0). */
export const RE_RENDERS_THRESHOLDS = { good: 2, poor: 8 } as const satisfies AxisThresholds;

/** A commit is attributed to a tap if it lands within this window after it. */
const COMMIT_ATTRIBUTION_MS = 500;

/** Interactions (taps that saw ≥1 commit) needed before leaving "pending". */
const RE_RENDERS_MIN_INTERACTIONS = 10;

/** An interaction with ≥ this many commits is a "storm". */
const STORM_COMMITS = 8;

/** Bounded ring of per-interaction commit counts. */
const RE_RENDERS_RING_CAP = 300;

export interface ReRendersResult {
  /** 0–100, or null while pending / not measurable (release build). */
  score:            number | null;
  rating:           AxisRating;
  /** p75 commits-per-interaction, or null while pending / not measurable. */
  commitsP75:       number | null;
  /** Correlated interactions (taps that triggered ≥1 commit) — shown even
   *  while pending. */
  interactionCount: number;
  /** Interactions with ≥8 commits (render storms). */
  storms:           number;
  /** 1 when any commit has been observed (dev build with Profiler live); 0 when
   *  none have (release build — Profiler is inert). */
  measurable:       0 | 1;
  reasonCode?:       number;
}

/** The tap currently accumulating commits: its timestamp + running count. */
let openTapAt: number | null = null;
let openTapCommits = 0;
/** Closed interactions' commit counts (each tap that saw ≥1 commit). */
const interactionCommitCounts: number[] = [];
/** True once ANY commit has ever been observed (proves Profiler is live). */
let anyCommitSeen = false;
/** True once a <BoosthisProfiler> subtree has actually rendered. */
let profilerMounted = false;
/** True once the person has interacted (a tap reached the fid sampler). */
let sawInteraction = false;

/**
 * Record that a <BoosthisProfiler> subtree rendered. Best-effort, NEVER throws.
 *
 * This is what makes the release-build verdict EVIDENCE rather than a guess.
 * "No commit seen" alone is also true of a kit that started a moment ago, a
 * host that wrapped nothing, and the state right after `forget()` — none of
 * which say anything about the build. A profiled subtree that rendered, and a
 * person who then interacted with it, and STILL no commit reported, is the one
 * combination only an inert Profiler produces.
 */
export function noteProfilerMounted(): void {
  try {
    profilerMounted = true;
  } catch {
    /* best-effort */
  }
}

/** Close the currently-open tap window, banking its commit count if it saw any
 *  commits (a tap with zero commits isn't an "interaction that rendered"). */
function closeOpenTap(): void {
  if (openTapAt != null && openTapCommits > 0) {
    interactionCommitCounts.push(openTapCommits);
    if (interactionCommitCounts.length > RE_RENDERS_RING_CAP) {
      interactionCommitCounts.splice(
        0,
        interactionCommitCounts.length - RE_RENDERS_RING_CAP,
      );
    }
  }
  openTapAt = null;
  openTapCommits = 0;
}

/**
 * Record a tap timestamp (from the fid sampler). Opens a fresh attribution
 * window, banking the previous one. Best-effort, NEVER throws.
 */
export function recordInteractionTap(now: number): void {
  try {
    sawInteraction = true;
    closeOpenTap();
    openTapAt = now;
    openTapCommits = 0;
  } catch {
    /* best-effort */
  }
}

/**
 * Record a React commit (from <BoosthisProfiler>'s onRender). If it lands within
 * COMMIT_ATTRIBUTION_MS after the open tap, it counts toward that interaction;
 * otherwise the stale window is closed. Best-effort, NEVER throws.
 */
export function recordCommit(now: number): void {
  try {
    anyCommitSeen = true;
    if (openTapAt == null) return;
    if (now - openTapAt <= COMMIT_ATTRIBUTION_MS) {
      openTapCommits += 1;
    } else {
      // Commit arrived after the window — bank the finished interaction and
      // drop this stray commit (it belongs to no tap).
      closeOpenTap();
    }
  } catch {
    /* best-effort */
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
 * The Re-render Storms axis, or a pending reading while warming / not
 * measurable. Pure read — never mutates state, NEVER throws. To include the
 * still-open tap, callers may first close it via readReRenders (we snapshot a
 * copy so a read never loses the open window's partial count).
 */
export function readReRenders(): ReRendersResult {
  try {
    // Snapshot: include the open tap if it has commits, WITHOUT banking it (a
    // read must not mutate — the next commit/tap still updates the live window).
    const counts = [...interactionCommitCounts];
    if (openTapAt != null && openTapCommits > 0) counts.push(openTapCommits);

    const interactionCount = counts.length;
    const storms = counts.filter((c) => c >= STORM_COMMITS).length;

    // Release build — React's Profiler is compiled out. Said only on POSITIVE
    // evidence: a profiled subtree rendered, the person then interacted with
    // it, and React still reported no commit at all. A fresh kit, a host that
    // wrapped nothing, and the state right after forget() all have "no commit
    // seen" too, and each of them stays pending, because none of them is a
    // fact about the build.
    if (profilerMounted && sawInteraction && !anyCommitSeen) {
      return {
        score:            null,
        rating:           "not-available",
        commitsP75:       null,
        interactionCount: 0,
        storms:           0,
        measurable:       0,
        reasonCode:        REASON_OFF_IN_THIS_BUILD,
      };
    }
    // Dev build, but not enough correlated interactions yet.
    if (interactionCount < RE_RENDERS_MIN_INTERACTIONS) {
      return {
        score:            null,
        rating:           "pending",
        commitsP75:       null,
        interactionCount,
        storms,
        measurable:       1,
      };
    }
    const commitsP75 = p75(counts);
    const score = linearScore(
      commitsP75,
      RE_RENDERS_THRESHOLDS.good,
      RE_RENDERS_THRESHOLDS.poor,
    );
    return {
      score,
      rating:           ratingFor(score),
      commitsP75,
      interactionCount,
      storms,
      measurable:       1,
    };
  } catch {
    return {
      score:            null,
      rating:           "pending",
      commitsP75:       null,
      interactionCount: 0,
      storms:           0,
      measurable:       0,
    };
  }
}

/** Reset all state (telemetry.forget() hook + tests). Idempotent. */
export function resetReRenders(): void {
  openTapAt = null;
  openTapCommits = 0;
  interactionCommitCounts.length = 0;
  anyCommitSeen = false;
  // The evidence goes with the state it was gathered in. After forget() the
  // kit has seen nothing again, so it must look again before it may call this
  // host a release build.
  profilerMounted = false;
  sawInteraction = false;
}

/** @internal test hooks — deterministic, no dependence on real timing. */
export const _reRendersInternals = {
  RE_RENDERS_THRESHOLDS,
  RE_RENDERS_MIN_INTERACTIONS,
  COMMIT_ATTRIBUTION_MS,
  STORM_COMMITS,
  get interactionCount(): number {
    return interactionCommitCounts.length;
  },
  get anyCommitSeen(): boolean {
    return anyCommitSeen;
  },
  get profilerMounted(): boolean {
    return profilerMounted;
  },
  get sawInteraction(): boolean {
    return sawInteraction;
  },
  reset(): void {
    resetReRenders();
  },
};
