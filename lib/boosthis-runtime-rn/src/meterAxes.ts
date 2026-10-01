/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis meter axes — ADDITIVE on-device perf signals ─────────────
 *
 * These axes ENRICH the dashboard without touching the shared composite
 * score. The composite (TTFF·0.25 + TTI·0.45 + FID·0.30, defined in
 * thresholds.ts) is byte-identical to the Python runtime and is reported to
 * the server as rating buckets that feed the community learning loop —
 * reshaping it would break cross-runtime parity. So everything here lives in
 * its OWN module with its OWN thresholds, is React-Native-only, stays on the
 * device, and never alters or replaces the speed score.
 *
 * Axes:
 *   1. Smoothness     — frame health from the rAF frame sampler (jank %).
 *   2. Responsiveness — INP-style ongoing interaction delay (p75).
 *   3. Stability      — JS-thread long-task rate (≥50ms blocks per minute).
 *   4. Scroll         — frame jank while actively scrolling (+ blank cells).
 *   5. Budget         — share of scorable screens already on budget.
 *   6. Confidence     — how much data backs the numbers (sample count).
 *
 * Plus a DEV-ONLY axis, computed here but deliberately NOT aggregated into
 * computeMeterAxes, so it never enters the uploaded payload:
 *   • Render Efficiency — React commit-phase busyness from <BoosthisProfiler>
 *      (React's <Profiler onRender> is inert in release, so it stays on-device).
 */

import type { FrameStats } from "./perfMonitor";
import type { DiagnosisReport } from "./perfDiagnose";
import { computeScreenScore } from "./perfDiagnose";
import { SCORE_THRESHOLDS } from "./thresholds";
import { REASON_OFF_IN_THIS_BUILD } from "./axisReasons";
import {
  readAsyncSlowCallbacks,
  readBlockingAsync,
  readEventLoopLag,
  readTimerHealth,
  type AsyncSlowCallbacksResult,
  type BlockingAsyncResult,
  type EventLoopLagResult,
  readScreenLeaks,
  type TimerHealthResult,
  type ScreenLeaksResult,
} from "./timerHealth";
import {
  readMemoryWarnings,
  type MemoryWarningsResult,
} from "./memoryWarnings";
import { readReRenders, type ReRendersResult } from "./reRenders";
import {
  readSwallowedErrors,
  type SwallowedErrorsResult,
} from "./swallowedErrors";
import { readLeakWatch, type LeakWatchResult } from "./leakWatch";
import { getBackgroundSuspendStats as readBackgroundSuspendStats } from "./backgroundSpans";
import {
  readLiveConnections,
  type LiveConnectionsReading,
} from "./liveConnections";
import { readDevPosture, type DevPostureReading } from "./devPosture";
import { readImageWeight, type ImageWeightResult } from "./imageWeight";
import { readBridgeTraffic, type BridgeTrafficResult } from "./bridgeTraffic";
import { readJsStartup, type JsStartupResult } from "./jsStartup";
import {
  readNavDeadTime,
  readPressToScreen,
  type NavDeadTimeResult,
  type PressToScreenResult,
} from "./navDeadTime";
import {
  readForegroundResidency,
  readBackgroundRecovery,
  readDimensionChurn,
  readAppearanceChurn,
  readKeyboardLatency,
  observedForegroundMs,
  type ForegroundResidencyResult,
  type BackgroundRecoveryResult,
  type DimensionChurnResult,
  type AppearanceChurnResult,
  type KeyboardLatencyResult,
} from "./lifecycleAxes";
import {
  readUnhandledErrors,
  readPromiseRejections,
  type UnhandledErrorRateResult,
  type PromiseRejectionRateResult,
} from "./unhandledErrors";
import {
  readHeapHeadroom,
  readGcPressure,
  readGcTax,
  readHermesRuntime,
  readJsiCapability,
  type HeapHeadroomResult,
  type GcPressureResult,
  type GcTaxResult,
  type HermesRuntimeResult,
  type JsiCapabilityResult,
} from "./hermesAxes";
import {
  readStorageLatency,
  readStorageFailures,
  type StorageLatencyResult,
  type StorageFailureResult,
} from "./storageLatency";
import { readBuildInfo, hasBuildTime, buildTimeMs } from "./buildIdentity";
import { bankedWatch, NO_BANKED_WATCH, type BankedWatch } from "./watchHistory";
import { getAiCallStats, type AiCallStats } from "./aiCalls";
import { readBackgroundWork, type BackgroundWorkResult } from "./backgroundWork";
import { readUpstreamCache, type UpstreamCacheResult } from "./upstreamCache";
import {
  rejectionPressureFrom,
  type RejectionPressureResult,
} from "./rejectionPressure";

import {
  MIN_RATE_WINDOW_MIN,
  MIN_RATE_WINDOW_MS,
  earnedPerHour,
  earnedPerMin,
  windowMinOf,
} from "./rateHonesty";
import { REASON_PLATFORM_DOES_NOT_EXPOSE } from "./axisReasons";

/* The 0-100 scale, the word it maps to and the shape of a band now live in
 * axisScoring.ts — a leaf that imports nothing. They used to be declared
 * here, which made this module (the one that ASSEMBLES a snapshot out of
 * every axis module) a dependency of every axis module in turn: fourteen
 * files in one cycle, and a require-cycle warning per bundle in the
 * customer's own terminal. Nothing about a piecewise-linear score needs to
 * know what an axis is.
 *
 * They are re-exported unchanged so every importer inside the kit and out of
 * it keeps working. Note the direction: this module reads FROM the leaf, and
 * the leaf reads from nobody, so re-exporting cannot bring the cycle back. */
import {
  linearScore,
  ratingFor,
  type AxisRating,
  type AxisThresholds,
} from "./axisScoring";

export { linearScore, ratingFor };
export type { AxisRating, AxisThresholds };

/* ─── AI calls (global RN XMLHttpRequest watch) ─────────────────────────
 *
 * The watcher can honestly measure destinations, send counts, completion
 * durations and coarse failures. It cannot inspect a fetch response body
 * without disturbing the app, so spend, tokens, stream detail and headroom are
 * deliberately absent rather than fabricated.
 */
export const AI_CALL_MIN_SAMPLES = 5;
export const AI_FAIL_PCT_THRESHOLDS = { good: 0, poor: 10 } as const satisfies AxisThresholds;

export interface AiCallsResult {
  score?: number;
  rating: AxisRating;
  measurable: 0 | 1;
  callCount?: number;
  providerCount?: number;
  topProvider?: number;
  p75Ms?: number;
  worstMs?: number;
  failCount?: number;
  unclassifiedCalls?: number;
  declaredCalls?: number;
  unwatchedClients?: number;
}

/** Exactly three states: absent without evidence, pending while count-only or
 * below the shared five-sample floor, and scored once enough calls exist. */
export function computeAiCalls(stats: AiCallStats): AiCallsResult | null {
  const callCount = Math.max(0, Math.round(stats?.callCount ?? 0));
  const unwatchedClients =
    stats?.unwatchedClients === undefined
      ? undefined
      : Math.max(0, Math.round(stats.unwatchedClients));
  const unclassifiedCalls = Math.max(
    0,
    Math.round(stats?.unclassifiedCalls ?? 0),
  );
  if (
    callCount === 0 &&
    unclassifiedCalls === 0 &&
    (unwatchedClients === undefined || unwatchedClients === 0)
  ) {
    return null;
  }
  if (callCount === 0) {
    return {
      rating: "pending",
      measurable: 0,
      ...(unclassifiedCalls > 0 ? { unclassifiedCalls } : {}),
      ...(unwatchedClients === undefined ? {} : { unwatchedClients }),
    };
  }
  const base: Omit<AiCallsResult, "score" | "rating" | "measurable"> = {
    callCount,
    providerCount: Math.max(0, Math.round(stats.providerCount)),
    topProvider: Math.max(0, Math.round(stats.topProvider)),
    failCount: Math.max(0, Math.round(stats.failCount)),
    ...(stats.p75Ms === undefined
      ? {}
      : { p75Ms: Math.max(0, Math.round(stats.p75Ms)) }),
    ...(stats.worstMs === undefined
      ? {}
      : { worstMs: Math.max(0, Math.round(stats.worstMs)) }),
    ...(stats.declaredCalls > 0
      ? { declaredCalls: Math.max(0, Math.round(stats.declaredCalls)) }
      : {}),
    ...(unclassifiedCalls > 0 ? { unclassifiedCalls } : {}),
    ...(unwatchedClients === undefined ? {} : { unwatchedClients }),
  };
  if (callCount < AI_CALL_MIN_SAMPLES) {
    return { rating: "pending", measurable: 0, ...base };
  }
  const failPct = (base.failCount! / callCount) * 100;
  const score = linearScore(
    failPct,
    AI_FAIL_PCT_THRESHOLDS.good,
    AI_FAIL_PCT_THRESHOLDS.poor,
  );
  return {
    score,
    rating: ratingFor(score),
    measurable: 1,
    ...base,
  };
}

/* ─── 1. Smoothness (frame health) ──────────────────────────────────────
 * Scored on the fraction of frames that blew the 60fps budget (>32ms),
 * which the FrameSampler already computes as `jankFraction`. A perfectly
 * smooth screen janks ~0% of frames; ≥10% janky reads as visibly stuttery.
 */
export const SMOOTHNESS_THRESHOLDS = { good: 0.02, poor: 0.1 } as const satisfies AxisThresholds;

export interface SmoothnessResult {
  /** 0-100, or null when no frames have been sampled yet. */
  score:       number | null;
  rating:      AxisRating;
  /** Janky-frame percentage (0-100), or null when no data. */
  jankPct:     number | null;
  sampleCount: number;
  measurable?: 0 | 1;
  reasonCode?: number;
}

export function computeSmoothnessScore(stats: FrameStats): SmoothnessResult {
  if (stats?.sourceAbsent === 1) {
    return {
      score: null, rating: "not-available", jankPct: null, sampleCount: 0,
      measurable: 0, reasonCode: REASON_PLATFORM_DOES_NOT_EXPOSE,
    };
  }
  if (!stats || stats.sampleCount === 0) {
    return { score: null, rating: "pending", jankPct: null, sampleCount: 0 };
  }
  const score = linearScore(
    stats.jankFraction,
    SMOOTHNESS_THRESHOLDS.good,
    SMOOTHNESS_THRESHOLDS.poor,
  );
  return {
    score,
    rating:      ratingFor(score),
    jankPct:     Math.round(stats.jankFraction * 1000) / 10,
    sampleCount: stats.sampleCount,
  };
}

/* ─── 2. Responsiveness (INP-style) ─────────────────────────────────────
 * Scored on the p75 of ONGOING interaction delays (not just the one-shot
 * FID). Mirrors web INP guidance scaled to mobile: ≤100ms feels instant,
 * ≥300ms feels sluggish.
 */
export const RESPONSIVENESS_THRESHOLDS = { good: 100, poor: 300 } as const satisfies AxisThresholds;

/** Minimal shape consumed from useFidSampler's `getInteractionStats()`.
 *  Kept structural so this module stays decoupled from the hook layer. */
export interface InteractionStatsLike {
  count: number;
  p75Ms: number;
}

export interface ResponsivenessResult {
  score:  number | null;
  rating: AxisRating;
  p75Ms:  number | null;
  count:  number;
}

export function computeResponsivenessScore(
  stats: InteractionStatsLike,
): ResponsivenessResult {
  if (!stats || stats.count === 0) {
    return { score: null, rating: "pending", p75Ms: null, count: 0 };
  }
  const score = linearScore(
    stats.p75Ms,
    RESPONSIVENESS_THRESHOLDS.good,
    RESPONSIVENESS_THRESHOLDS.poor,
  );
  return { score, rating: ratingFor(score), p75Ms: stats.p75Ms, count: stats.count };
}

/* ─── 3. Budget compliance ──────────────────────────────────────────────
 * "How many of the screens we can actually score are already on budget?"
 * Reuses the existing per-screen score so it stays consistent with the
 * headline — no new capture, no new thresholds.
 */
export interface BudgetCompliance {
  /** Scorable screens rated "good". */
  onBudget: number;
  /** Scorable screens (excludes insufficient-data). */
  total:    number;
  /** Percentage on budget (0-100), or null when nothing is scorable yet. */
  pct:      number | null;
  /**
   * The 0-100 number `rating` was read off — the same quantity as `pct`, under
   * the name every other axis uses.
   *
   * This axis shipped a verdict with no score behind it on every React Native
   * install: `pct` is what the bands were applied to, but nothing downstream
   * knows that `pct` and `score` are the same number, so a reader was handed a
   * word it could not check and every score-shaped surface saw this axis as
   * unscored. Carrying it under the shared name closes that, and costs
   * nothing: a verdict is never served without the number behind it.
   */
  score:    number | null;
  /** Pre-derived rating so the in-app panel AND the web mirror render the tile
   *  without re-deriving the 85/60 bands (single source of truth — the server
   *  never recomputes it). "pending" until at least one screen is scorable. */
  rating:   AxisRating;
}

export function computeBudgetCompliance(diag: DiagnosisReport): BudgetCompliance {
  if (!diag || !Array.isArray(diag.screens) || diag.screens.length === 0) {
    return { onBudget: 0, total: 0, pct: null, score: null, rating: "pending" };
  }
  const scored = diag.screens
    .map((s) => computeScreenScore(s))
    .filter((b) => b.rating !== "insufficient-data");
  if (scored.length === 0)
    return { onBudget: 0, total: 0, pct: null, score: null, rating: "pending" };
  const onBudget = scored.filter((b) => b.rating === "good").length;
  const pct = Math.round((onBudget / scored.length) * 100);
  return { onBudget, total: scored.length, pct, score: pct, rating: ratingFor(pct) };
}

/* ─── 4. Confidence (sample count) ──────────────────────────────────────
 * A reminder of how much data backs the numbers, so a single fast/slow
 * sample isn't mistaken for a trend.
 */
export const CONFIDENCE_CUTOFFS = { medium: 5, high: 20 } as const;
export type ConfidenceLevel = "none" | "low" | "medium" | "high";

export function confidenceLevel(sampleCount: number): ConfidenceLevel {
  if (!sampleCount || sampleCount <= 0) return "none";
  if (sampleCount < CONFIDENCE_CUTOFFS.medium) return "low";
  if (sampleCount < CONFIDENCE_CUTOFFS.high) return "medium";
  return "high";
}

/** Pre-derived rating for the confidence axis, on the shared rating bands, so
 *  the in-app panel and the web mirror never re-derive it (single source of
 *  truth). "pending" until there is at least one sample. */
export function confidenceRatingFor(level: ConfidenceLevel): AxisRating {
  return level === "high"
    ? "good"
    : level === "medium"
      ? "needs-work"
      : level === "low"
        ? "poor"
        : "pending";
}

/** Human caption for the confidence axis, shared by every consumer so the copy
 *  can't drift between the device panel and the web mirror. */
const CONFIDENCE_CAPTIONS: Record<ConfidenceLevel, string> = {
  none:   "no samples yet",
  low:    "few samples",
  medium: "moderate samples",
  high:   "well-sampled",
};

/** The same levels, worded for the case where the SAMPLES would support more
 *  but the watch time does not. Without this the reader is told "few samples"
 *  when the real answer is "we have barely watched this app yet" — a different
 *  thing to do about it. */
const CONFIDENCE_CAPTIONS_SHORT_WATCH: Record<ConfidenceLevel, string> = {
  none:   "no samples yet",
  low:    "barely watched yet",
  medium: "briefly watched",
  high:   "well-sampled",
};
export function confidenceCaptionFor(
  level: ConfidenceLevel,
  /** True when observed foreground time, not the sample count, is what holds
   *  the level down. */
  limitedByWatchTime = false,
): string {
  return limitedByWatchTime
    ? CONFIDENCE_CAPTIONS_SHORT_WATCH[level]
    : CONFIDENCE_CAPTIONS[level];
}

/** Observed foreground minutes needed before the sample count alone may speak
 *  for the snapshot. */
export const CONFIDENCE_WATCH_CUTOFFS_MS = {
  medium: 2 * 60_000,
  high:  10 * 60_000,
} as const;
/** How many samples back the LEAST-sampled scorable screen — the weakest
 *  contributor to the averaged headline. One lucky fast mount shouldn't read
 *  as a trend, so confidence keys off the minimum, not the total. Returns 0
 *  when there is no diagnosis or no scorable screen yet. */
function leastScorableMounts(diag: DiagnosisReport | null): number {
  if (!diag || !Array.isArray(diag.screens)) return 0;
  const scoredMounts = diag.screens
    .filter((s) => computeScreenScore(s).rating !== "insufficient-data")
    .map((s) => s.mounts ?? 0);
  return scoredMounts.length ? Math.min(...scoredMounts) : 0;
}

/* ─── Stability (JS-thread long tasks) ──────────────────────────────────
 * "How often does the JS thread freeze long enough to feel like a stall?"
 * The FrameSampler tallies, across the whole session, every frame gap ≥50ms
 * (a perceptible block — 3+ dropped frames) and the foreground time it has
 * sampled, so we can score a session-wide RATE rather than a momentary blip.
 * This is a distinct signal from Smoothness: Smoothness is the windowed
 * fraction of merely-janky (>32ms) frames, while Stability counts the rarer,
 * worse, sustained ≥50ms freezes over time — so the two never double-count.
 *
 * Scored on long tasks per minute of foreground sampling: a calm app blocks
 * the JS thread a handful of times a minute at most; ≥20/min (one every ~3s)
 * reads as chronically stalling. Pending until we have enough foreground time
 * sampled (STABILITY_MIN_ACTIVE_MS) that the rate isn't dominated by a single
 * early hiccup. Field-capable (derived from sampler stats already uploaded in
 * the snapshot), so it lives in computeMeterAxes alongside the other axes.
 */
export const STABILITY_THRESHOLDS = { good: 2, poor: 20 } as const satisfies AxisThresholds;

/** Minimum foreground sampling time before the axis leaves "pending" — below
 *  this, one stray freeze would swamp the per-minute rate. */
const STABILITY_MIN_ACTIVE_MS = 10_000;

export interface StabilityResult {
  /** 0–100, or null while pending (not enough foreground time yet). */
  score:           number | null;
  rating:          AxisRating;
  /** ≥50ms JS-thread blocks per minute of foreground time, or null while pending. */
  longTasksPerMin: number | null;
  /** Cumulative ≥50ms blocks seen this session (shown even while pending). */
  longTaskCount:   number;
  /** Worst single JS-thread block (ms) this session, 0 if none. */
  worstBlockMs:    number;
  measurable?:     0 | 1;
  reasonCode?:      number;
}

export function computeStabilityScore(stats: FrameStats): StabilityResult {
  if (stats?.sourceAbsent === 1) {
    return {
      score: null, rating: "not-available", longTasksPerMin: null,
      longTaskCount: stats?.longTaskCount ?? 0,
      worstBlockMs: Math.round(stats?.worstBlockMs ?? 0),
      measurable: 0, reasonCode: REASON_PLATFORM_DOES_NOT_EXPOSE,
    };
  }
  if (!stats || stats.activeMs < STABILITY_MIN_ACTIVE_MS) {
    return {
      score:           null,
      rating:          "pending",
      longTasksPerMin: null,
      longTaskCount:   stats?.longTaskCount ?? 0,
      worstBlockMs:    Math.round(stats?.worstBlockMs ?? 0),
    };
  }
  const score = linearScore(
    stats.longTasksPerMin,
    STABILITY_THRESHOLDS.good,
    STABILITY_THRESHOLDS.poor,
  );
  return {
    score,
    rating:          ratingFor(score),
    longTasksPerMin: Math.round(stats.longTasksPerMin * 10) / 10,
    longTaskCount:   stats.longTaskCount,
    worstBlockMs:    Math.round(stats.worstBlockMs),
  };
}

/* ─── Scroll / list health ──────────────────────────────────────────────
 * "How smooth does scrolling actually feel?" The scrollSampler attributes
 * frame jank ONLY to active-scroll windows (drag + momentum), so this scores
 * the worst-case moment for jank — a heavy list flying under the user's finger
 * — separately from the all-frames Smoothness axis. It can also fold in
 * FlashList's blank-cell signal (cells not ready as you scroll) when the app
 * uses one; plain lists leave blankEvents at 0 and the axis scores on jank.
 *
 * Field-capable: the scroll loop measures real requestAnimationFrame gaps, so
 * (unlike the dev-only Render Efficiency axis) it produces data in release
 * builds and is therefore part of computeMeterAxes / the uploaded snapshot.
 *
 * Scored on the janky-frame fraction DURING scroll: ≤5% reads as buttery,
 * ≥20% as visibly stuttery. Pending until enough scroll frames are sampled
 * (SCROLL_MIN_FRAMES ≈ 1s of scrolling) that one early hitch can't dominate.
 */
export const SCROLL_THRESHOLDS = { good: 0.05, poor: 0.2 } as const satisfies AxisThresholds;

/** Minimum frames sampled while scrolling before the axis leaves "pending". */
const SCROLL_MIN_FRAMES = 60;

/** Minimal shape consumed from scrollSampler.getStats(). Structural so this
 *  module stays decoupled from the sampler (mirrors the other *Like shapes). */
export interface ScrollStatsLike {
  frameCount:   number;
  jankFraction: number;
  blankEvents:  number;
  worstBlankPx: number;
}

export interface ScrollHealthResult {
  /** 0–100, or null while pending (not enough scroll frames yet). */
  score:        number | null;
  rating:       AxisRating;
  /** Janky-frame percentage DURING scroll (0–100), or null while pending. */
  jankPct:      number | null;
  /** Frames sampled while scrolling (shown even while pending). */
  frameCount:   number;
  /** FlashList blank-cell events seen (0 for plain lists). */
  blankEvents:  number;
  /** Worst blank gap (px) seen while scrolling, 0 if none. */
  worstBlankPx: number;
}

export function computeScrollHealth(stats: ScrollStatsLike): ScrollHealthResult {
  if (!stats || stats.frameCount < SCROLL_MIN_FRAMES) {
    return {
      score:        null,
      rating:       "pending",
      jankPct:      null,
      frameCount:   stats?.frameCount ?? 0,
      blankEvents:  stats?.blankEvents ?? 0,
      worstBlankPx: Math.round(stats?.worstBlankPx ?? 0),
    };
  }
  const score = linearScore(
    stats.jankFraction,
    SCROLL_THRESHOLDS.good,
    SCROLL_THRESHOLDS.poor,
  );
  return {
    score,
    rating:       ratingFor(score),
    jankPct:      Math.round(stats.jankFraction * 1000) / 10,
    frameCount:   stats.frameCount,
    blankEvents:  stats.blankEvents,
    worstBlankPx: Math.round(stats.worstBlankPx),
  };
}

/* ─── Frustration (rage taps) ───────────────────────────────────────────
 * "How often is the user telling us, with their thumb, that the app feels
 * broken?" useFidSampler confirms a rage burst on-device — ≥3 jabs in one spot
 * within ~700ms while the measured input delay was ≥300ms — and exposes a
 * COORDINATE-FREE count via getFrustrationStats(). This axis scores those
 * bursts as a RATE over foreground time, so a single accidental double-jab on
 * a slow cold start can't dominate.
 *
 * This is a DISTINCT signal from Responsiveness: Responsiveness is the p75 of
 * EVERY interaction's delay (a continuous latency gauge); Frustration counts
 * only the rare confirmed mashes where slowness provably changed the user's
 * behaviour. A snappy app has 0 bursts; an app that strands the user behind a
 * frozen tap racks them up — so the two never double-count. Field-capable
 * (derived from on-device counters that are already coordinate-free), so it
 * rides in the uploaded snapshot alongside the other axes.
 *
 * Scored on confirmed rage bursts per minute of foreground time: ≤0.5/min is
 * background noise, ≥3/min (one frustrated mash every ~20s) reads as a
 * chronically painful experience. Pending until enough foreground time is
 * sampled (FRUSTRATION_MIN_ACTIVE_MS) that one early burst can't swamp the rate.
 */
export const FRUSTRATION_THRESHOLDS = { good: 0.5, poor: 3 } as const satisfies AxisThresholds;

/** Minimum foreground sampling time before the axis leaves "pending". */
const FRUSTRATION_MIN_ACTIVE_MS = 10_000;

/** Minimal shape consumed from useFidSampler.getFrustrationStats(). Structural
 *  so this module stays decoupled from the hook (mirrors InteractionStatsLike).
 *  Both fields are coordinate-free aggregates — no touch positions ever reach
 *  this layer. */
export interface FrustrationStatsLike {
  burstCount:   number;
  worstDelayMs: number;
}

export interface FrustrationResult {
  /** 0–100, or null while pending (not enough foreground time yet). */
  score:        number | null;
  rating:       AxisRating;
  /** Confirmed rage-tap bursts per minute of foreground time, or null while pending. */
  ragePerMin:   number | null;
  /** Cumulative confirmed rage-tap bursts this session (shown even while pending). */
  burstCount:   number;
  /** Worst input delay (ms) measured during a rage burst, 0 if none. */
  worstDelayMs: number;
  /** The observation the rate came from, so no caption prints a projection
   *  without the window that earned it. Null while pending. */
  windowMin:    number | null;
}

export function computeFrustrationScore(
  stats: FrustrationStatsLike,
  activeMs: number,
): FrustrationResult {
  if (!stats || activeMs < FRUSTRATION_MIN_ACTIVE_MS) {
    return {
      score:        null,
      rating:       "pending",
      ragePerMin:   null,
      burstCount:   stats?.burstCount ?? 0,
      worstDelayMs: Math.round(stats?.worstDelayMs ?? 0),
      windowMin:    null,
    };
  }
  // The earned-rate contract (rateHonesty.ts) — the 10s gate above is already
  // past the per-minute minimum, so this cannot be null.
  const ragePerMin = earnedPerMin(stats.burstCount, activeMs, 2) ?? 0;
  const score = linearScore(
    ragePerMin,
    FRUSTRATION_THRESHOLDS.good,
    FRUSTRATION_THRESHOLDS.poor,
  );
  return {
    score,
    rating:       ratingFor(score),
    ragePerMin,
    burstCount:   stats.burstCount,
    worstDelayMs: Math.round(stats.worstDelayMs),
    windowMin:    windowMinOf(activeMs),
  };
}

/* ─── Idle efficiency (wasted work / battery) ───────────────────────────
 * "When the user STOPS interacting, does the app actually go quiet?" The
 * FrameSampler marks every frame sampled ≥5s after the last touch as 'idle' and
 * counts how many of those idle frames the JS thread still blew the 60fps budget
 * on (idleJankFrames) — i.e. work done while nobody was driving the UI. A
 * well-behaved app is quiescent when idle (timers parked, animations on the
 * native driver, no render storms), so almost no idle frame should jank; a
 * wasteful one keeps the JS thread — and the battery — busy with polling,
 * setInterval churn, or React-state animations even when untouched.
 *
 * DISTINCT from Smoothness and Stability: those score ALL foreground frames
 * (how the app feels WHILE you use it). Idle efficiency scores ONLY the
 * after-you-stopped subset (whether the app wastes power when you DON'T). The
 * same 32ms/50ms frame cutoffs are reused, but the populations don't overlap in
 * meaning — a janky frame during active use never lands in the idle bucket, so
 * the axes never double-count.
 *
 * Scored on the janky-frame fraction DURING idle windows: ≤2% reads as properly
 * quiescent, ≥20% as burning cycles with nobody watching. Pending until enough
 * idle frames are sampled (IDLE_MIN_FRAMES ≈ 2s) that one stray idle hitch can't
 * dominate. Field-capable (the idle counters ride in the uploaded snapshot).
 */
export const IDLE_EFFICIENCY_THRESHOLDS = { good: 0.02, poor: 0.2 } as const satisfies AxisThresholds;

/** Minimum idle frames sampled before the axis leaves "pending" — below this,
 *  one stray idle hitch would swamp the fraction. */
const IDLE_MIN_FRAMES = 120;

export interface IdleEfficiencyResult {
  /** 0–100, or null while pending (not enough idle frames yet). */
  score:             number | null;
  rating:            AxisRating;
  /** Janky-frame percentage DURING idle windows (0–100), or null while pending. */
  idleBusyPct:       number | null;
  /** Idle frames sampled (shown even while pending). */
  idleFrameCount:    number;
  /** ≥50ms JS-thread blocks observed while idle (sustained wasted work). */
  idleLongTaskCount: number;
  measurable?:       0 | 1;
  reasonCode?:        number;
}

export function computeIdleEfficiency(stats: FrameStats): IdleEfficiencyResult {
  if (stats?.sourceAbsent === 1) {
    return {
      score: null, rating: "not-available", idleBusyPct: null,
      idleFrameCount: stats?.idleFrameCount ?? 0,
      idleLongTaskCount: stats?.idleLongTaskCount ?? 0,
      measurable: 0, reasonCode: REASON_PLATFORM_DOES_NOT_EXPOSE,
    };
  }
  if (!stats || stats.idleFrameCount < IDLE_MIN_FRAMES) {
    return {
      score:             null,
      rating:            "pending",
      idleBusyPct:       null,
      idleFrameCount:    stats?.idleFrameCount ?? 0,
      idleLongTaskCount: stats?.idleLongTaskCount ?? 0,
    };
  }
  const busy = stats.idleJankFrames / stats.idleFrameCount;
  const score = linearScore(
    busy,
    IDLE_EFFICIENCY_THRESHOLDS.good,
    IDLE_EFFICIENCY_THRESHOLDS.poor,
  );
  return {
    score,
    rating:            ratingFor(score),
    idleBusyPct:       Math.round(busy * 1000) / 10,
    idleFrameCount:    stats.idleFrameCount,
    idleLongTaskCount: stats.idleLongTaskCount,
  };
}

/* ─── Frame Floor (sustained-frame-rate floor) ──────────────────────────
 * "How bad was the WORST second?" Average FPS and even windowed jank % can
 * average away a single terrible stretch — one frozen second in an otherwise
 * smooth session reads as ~1% jank. This axis reports the worst completed
 * 1-second window's effective frame rate (frames ÷ window seconds) over the
 * whole session, so that stretch is never smoothed over. The FrameSampler
 * does the bucketing on-device (counts + rates only, suspensions excluded);
 * this axis only scores the result. Field-capable — it rides the existing
 * frame stats in the uploaded snapshot. Never feeds the speed composite.
 *
 * Scored on the floor FPS itself (HIGHER is better, unlike the other axes):
 * a floor ≥50fps means even the worst second stayed fluid; a floor ≤20fps
 * means the app was visibly frozen/slideshow-like for at least one second.
 */
export const FRAME_FLOOR_THRESHOLDS = { goodFps: 50, poorFps: 20 } as const;

/** Minimum completed 1s windows before the axis leaves "pending" — below
 *  this, one warm-up second would define the whole session's floor. */
const FRAME_FLOOR_MIN_WINDOWS = 5;

export interface FrameFloorResult {
  /** 0–100, or null while pending (not enough completed windows yet). */
  score:       number | null;
  rating:      AxisRating;
  /** Worst completed 1s window's effective FPS, or null while pending. */
  floorFps:    number | null;
  /** Completed 1s windows backing the reading (shown even while pending). */
  windowCount: number;
  measurable?: 0 | 1;
  reasonCode?: number;
}

export function computeFrameFloor(stats: FrameStats): FrameFloorResult {
  if (stats?.sourceAbsent === 1) {
    return {
      score: null, rating: "not-available", floorFps: null,
      windowCount: stats?.floorWindowCount ?? 0,
      measurable: 0, reasonCode: REASON_PLATFORM_DOES_NOT_EXPOSE,
    };
  }
  if (
    !stats ||
    stats.floorWindowCount < FRAME_FLOOR_MIN_WINDOWS ||
    stats.floorFps <= 0
  ) {
    return {
      score:       null,
      rating:      "pending",
      floorFps:    null,
      windowCount: stats?.floorWindowCount ?? 0,
    };
  }
  // Higher FPS is better, so invert onto linearScore's lower-is-better scale
  // by scoring the SHORTFALL below the good floor (0 shortfall = 100).
  const shortfall = Math.max(0, FRAME_FLOOR_THRESHOLDS.goodFps - stats.floorFps);
  const score = linearScore(
    shortfall,
    0,
    FRAME_FLOOR_THRESHOLDS.goodFps - FRAME_FLOOR_THRESHOLDS.poorFps,
  );
  return {
    score,
    rating:      ratingFor(score),
    floorFps:    stats.floorFps,
    windowCount: stats.floorWindowCount,
  };
}

/* ─── Network reliability (stalls / silent timeouts) ────────────────────
 * "How often do this app's network calls stall or silently time out, and how
 * slow are they?" The networkSampler tallies, per host-reported attempt, only
 * a duration and a coarse outcome bucket (ok | error | timeout | stall) — never
 * a URL, host, status, or any request detail. This axis turns that aggregate
 * into a score on the SAME 0-100 / 85-60 scale as every other axis.
 *
 * It exists because of the Rival iOS/Hermes sign-in incident: a fetch that
 * silently hung on a reused socket, where the failure was invisible. So the
 * axis scores the WORSE of two independent problems, and either one alone turns
 * the tile red:
 *   • latency  — p75 of attempt durations (≤800ms feels snappy, ≥3s feels broken)
 *   • stalls   — (timeout + stall) / attempts, the silent-drop class (≤1% is
 *                noise, ≥10% is a chronically unreliable connection)
 * Loud failures ("error") are surfaced as context (failedCount) but NOT scored:
 * an app that correctly knows a call failed is the opposite of a silent stall.
 *
 * Field-capable (plain counters that work in release builds), so it lives in
 * computeMeterAxes and rides the uploaded snapshot. Pending until at least
 * NETWORK_MIN_ATTEMPTS attempts are reported, so one early slow call can't
 * dominate. Like Scroll, it needs the host to wire it (recordNetworkAttempt)
 * and stays "pending" until then. Never feeds the speed composite.
 */
export const NETWORK_THRESHOLDS = {
  p75GoodMs: 800,
  p75PoorMs: 3000,
  stallRateGood: 0.01,
  stallRatePoor: 0.1,
} as const;

/** Minimum reported attempts before the axis leaves "pending". */
const NETWORK_MIN_ATTEMPTS = 3;

/** Minimal shape consumed from networkSampler.getStats(). Structural so this
 *  module stays decoupled from the sampler (mirrors the other *Like shapes).
 *  Every field is a count or a duration — no labels ever reach this layer. */
export interface NetworkStatsLike {
  attemptCount:   number;
  completedCount: number;
  failedCount:    number;
  timeoutCount:   number;
  stallCount:     number;
  p75Ms:          number;
  worstMs:        number;
  /** Transports the kit is reporting attempts from itself (0 when the host
   *  wires this axis by hand, which is the original and still-supported way).
   *  Absent on a reading taken before automatic reporting existed. */
  watching?:         number;
  /** Transports this app HAS and the kit could not reach. A call made through
   *  one of these is invisible to us, so it is counted and reported rather
   *  than quietly reducing to a measured zero. */
  unwatchedClients?: number;
  /** This app switched automatic reporting OFF (`autoWrapNetwork: false`).
   *  Positive evidence, sent on its own without a coverage claim beside it:
   *  "we watched nothing" and "we were told not to watch" are different
   *  sentences and only the second one is the app's own doing. */
  refused?: boolean;
}

export interface NetworkResult {
  /** 0–100, or null while pending (not enough attempts yet). */
  score:        number | null;
  rating:       AxisRating;
  /** p75 attempt latency (ms), or null while pending. */
  p75Ms:        number | null;
  /** (timeout + stall) / attempts as a percentage (0–100), or null while pending. */
  stallPct:     number | null;
  /** Attempts reported (shown even while pending). */
  attemptCount: number;
  /** Caller-timer timeouts seen this session. */
  timeoutCount: number;
  /** Near-hangs the caller flagged this session (the silent-drop class). */
  stallCount:   number;
  /** Loud failures seen this session (context only — not scored). */
  failedCount:  number;
  /** Worst single attempt duration (ms), 0 if none. */
  worstMs:      number;
  /** Transports the kit is reporting from itself. Zero is a CLAIM — nothing
   *  is watching this axis, so a zero attempt count means "not switched on"
   *  rather than "this app made no calls". ABSENT where the kit has no claim
   *  to make: automatic reporting off, or a reading from an older kit. */
  watching?:          number;
  /** Transports present and out of reach: what we could not watch, stated
   *  rather than folded into the measured figure. Absent on the same terms
   *  as `watching`. */
  unwatchedClients?:  number;
  /** The not-available pair, present ONLY where this app switched automatic
   *  reporting off and reported nothing by hand either. A default-on
   *  collector the app refused is a fact about the app, and the reading says
   *  so rather than claiming to be warming up for ever. */
  measurable?:        0;
  reasonCode?:        number;
}

/**
 * Publish a coverage claim only where the kit HAS one.
 *
 * A zero here is read downstream as positive evidence that nobody wired this
 * axis up — which is exactly right when automatic reporting is on and found
 * no transport, and quite wrong when it is off, because the host may be
 * reporting every attempt by hand through the original API. The off state
 * therefore sends no field at all, and the generic "nothing observed yet"
 * wording stands rather than a claim we cannot support.
 */
function coverageOf(stats: NetworkStatsLike | null | undefined): {
  watching?: number;
  unwatchedClients?: number;
} {
  const out: { watching?: number; unwatchedClients?: number } = {};
  if (typeof stats?.watching === "number") {
    out.watching = Math.max(0, Math.round(stats.watching));
  }
  if (typeof stats?.unwatchedClients === "number") {
    out.unwatchedClients = Math.max(0, Math.round(stats.unwatchedClients));
  }
  return out;
}
export function computeNetworkScore(stats: NetworkStatsLike): NetworkResult {
  // The app switched a default-on collector off, and reported nothing by hand
  // either. That is an answer, not a wait: the reading cannot be taken in this
  // build and says why. An app that refused the wrapper and still calls
  // `recordNetworkAttempt` itself is measured on the ordinary path below —
  // the first attempt it reports ends this branch.
  if (stats?.refused === true && (stats?.attemptCount ?? 0) === 0) {
    return {
      score:        null,
      rating:       "not-available",
      p75Ms:        null,
      stallPct:     null,
      attemptCount: 0,
      timeoutCount: 0,
      stallCount:   0,
      failedCount:  0,
      worstMs:      0,
      measurable:   0,
      reasonCode:   REASON_OFF_IN_THIS_BUILD,
    };
  }
  if (!stats || stats.attemptCount < NETWORK_MIN_ATTEMPTS) {
    return {
      score:        null,
      rating:       "pending",
      p75Ms:        null,
      stallPct:     null,
      attemptCount: stats?.attemptCount ?? 0,
      timeoutCount: stats?.timeoutCount ?? 0,
      stallCount:   stats?.stallCount ?? 0,
      failedCount:  stats?.failedCount ?? 0,
      worstMs:      Math.round(stats?.worstMs ?? 0),
      ...coverageOf(stats),
    };
  }
  const stallRate = (stats.timeoutCount + stats.stallCount) / stats.attemptCount;
  const latencyScore = linearScore(
    stats.p75Ms,
    NETWORK_THRESHOLDS.p75GoodMs,
    NETWORK_THRESHOLDS.p75PoorMs,
  );
  const stallScore = linearScore(
    stallRate,
    NETWORK_THRESHOLDS.stallRateGood,
    NETWORK_THRESHOLDS.stallRatePoor,
  );
  // Either slowness OR silent stalls should turn the tile red — take the worse.
  const score = Math.min(latencyScore, stallScore);
  return {
    score,
    rating:       ratingFor(score),
    p75Ms:        Math.round(stats.p75Ms),
    stallPct:     Math.round(stallRate * 1000) / 10,
    attemptCount: stats.attemptCount,
    timeoutCount: stats.timeoutCount,
    stallCount:   stats.stallCount,
    failedCount:  stats.failedCount,
    worstMs:      Math.round(stats.worstMs),
    ...coverageOf(stats),
  };
}

/* ─── Baseline (anomaly vs. its own normal) ─────────────────────────────
 * "Did this screen GET slow?" Fixed thresholds answer "is it slow?"; this axis
 * grades each screen against ITS OWN recent history, so a screen that doubled
 * (270→540ms) is flagged even while it's still nominally "good".
 *
 * For every screen with enough mounts this session, its chronologically-ordered
 * mount durations are split into a BASELINE window (all but the last few) and a
 * RECENT window (the last few). The anomaly ratio is recentMedian /
 * baselineMedian; a screen is anomalous when it is BOTH materially slower
 * (ratio ≥ good) AND the absolute jump clears a floor (BASELINE_MIN_DELTA_MS),
 * so a tiny 10→25ms screen never screams. The axis scores on the WORST eligible
 * ratio: 1.2× still scores 100, 2× (doubled) scores 0. Medians (not means) so
 * one stray slow mount can't fake a regression.
 *
 * DISTINCT from every other axis: those grade the CURRENT session against fixed
 * budgets; Baseline grades the recent window against the session's own earlier
 * window — a relative, self-referential signal that a flat line can't catch.
 *
 * Purely numeric + label-free: only ordered durations reach this function
 * (never the screen key), and only counts, ratios and durations leave it — no
 * screen content, no timestamps of user activity. Like every axis here it is
 * ADDITIVE and NEVER feeds the TTFF/TTI/FID speed composite. Pending until at
 * least one screen has enough mounts to split.
 */
export const BASELINE_THRESHOLDS = { good: 1.2, poor: 2 } as const satisfies AxisThresholds;

/** Per-screen mounts needed before we can split baseline vs. recent. */
const BASELINE_MIN_SAMPLES = 6;
/** How many of the most-recent mounts form the "current" window. */
const BASELINE_RECENT_N = 3;
/** Absolute slowdown (ms) a screen must clear to count as an anomaly, so a
 *  tiny fast screen doubling in noise (8→18ms) never trips the axis. */
const BASELINE_MIN_DELTA_MS = 50;

/** Structural per-route input: a chronologically-ordered (oldest→newest) list
 *  of one screen's mount durations. Label-free by design — the route key never
 *  enters the Baseline axis, so the result stays purely numeric. Built by
 *  buildRouteSeries() from the screen events already in the log. */
export interface RouteSeriesLike {
  durations: number[];
}

export interface BaselineResult {
  /** 0–100, or null while pending (no screen has enough mounts yet). */
  score:           number | null;
  rating:          AxisRating;
  /** recent/baseline ratio of the worst regressing screen (≥1), or null when
   *  nothing has regressed past the floor / while pending. */
  worstRatio:      number | null;
  /** That screen's baseline-window median (ms), or null. */
  worstBaselineMs: number | null;
  /** That screen's recent-window median (ms), or null. */
  worstCurrentMs:  number | null;
  /** How many screens are currently beyond the anomaly threshold. */
  anomalyCount:    number;
  /** How many screens COMPLETED a comparison (shown even while good) — not how
   *  many merely had enough mounts. A screen whose earlier window is too fast to
   *  divide by counts in `unscoredRoutes` instead, so a caption built from this
   *  can never claim steadiness over a screen the axis never examined. */
  scoredRoutes:    number;
  /** Screens with enough mounts whose earlier-window median was 0ms. Durations
   *  are captured as whole milliseconds, so a sub-millisecond screen leaves no
   *  denominator to divide by and its drift is unknowable here. Counted, never
   *  silently dropped. */
  unscoredRoutes:  number;
  /** 0 when nothing could be compared, 1 once any screen was. Mirrors the
   *  can't-know shape the other axes use (`measurable: 0` + "pending"), so an
   *  abstention is visibly different from a good reading. */
  measurable:      0 | 1;
}

/** Median of an unordered list (does not mutate the input). 0 when empty. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function computeBaselineScore(series: RouteSeriesLike[]): BaselineResult {
  let scoredRoutes = 0;
  let unscoredRoutes = 0;
  let anomalyCount = 0;
  let worstRatio: number | null = null;
  let worstBaselineMs: number | null = null;
  let worstCurrentMs: number | null = null;

  for (const route of series) {
    const durations = route?.durations;
    if (!Array.isArray(durations) || durations.length < BASELINE_MIN_SAMPLES) {
      continue;
    }
    const recent = durations.slice(-BASELINE_RECENT_N);
    const base = durations.slice(0, -BASELINE_RECENT_N);
    const baseMed = median(base);
    const recentMed = median(recent);
    // A sub-millisecond screen records every duration as 0 (whole-ms capture),
    // so its earlier window medians to 0 and there is no ratio to take. Abstain
    // for this screen and SAY SO: counting it as scored here is what let a
    // hundred-fold regression on a fast screen report "steady".
    if (baseMed <= 0) {
      unscoredRoutes++;
      continue;
    }
    scoredRoutes++;
    const ratio = recentMed / baseMed;
    const delta = recentMed - baseMed;
    // Only a slowdown that clears BOTH the relative and the absolute floor
    // counts as an anomaly — protects tiny-but-noisy screens.
    if (ratio < BASELINE_THRESHOLDS.good || delta < BASELINE_MIN_DELTA_MS) {
      continue;
    }
    anomalyCount++;
    if (worstRatio === null || ratio > worstRatio) {
      worstRatio = ratio;
      worstBaselineMs = Math.round(baseMed);
      worstCurrentMs = Math.round(recentMed);
    }
  }

  if (scoredRoutes === 0) {
    // Nothing was compared, so there is no verdict — never a perfect score.
    // `unscoredRoutes` tells the two silences apart downstream: 0 = no screen
    // has enough mounts yet (warming up), >0 = every screen was too fast to
    // divide by (cannot tell).
    return {
      score:           null,
      rating:          "pending",
      worstRatio:      null,
      worstBaselineMs: null,
      worstCurrentMs:  null,
      anomalyCount:    0,
      scoredRoutes:    0,
      unscoredRoutes,
      measurable:      0,
    };
  }
  // Enough data, but no screen cleared the anomaly floors → everything is
  // steady against its own normal.
  if (worstRatio === null) {
    return {
      score:           100,
      rating:          "good",
      worstRatio:      null,
      worstBaselineMs: null,
      worstCurrentMs:  null,
      anomalyCount:    0,
      scoredRoutes,
      unscoredRoutes,
      measurable:      1,
    };
  }
  const score = linearScore(
    worstRatio,
    BASELINE_THRESHOLDS.good,
    BASELINE_THRESHOLDS.poor,
  );
  return {
    score,
    rating:          ratingFor(score),
    worstRatio:      Math.round(worstRatio * 100) / 100,
    worstBaselineMs,
    worstCurrentMs,
    anomalyCount,
    scoredRoutes,
    unscoredRoutes,
    measurable:      1,
  };
}

/* ─── Resilience (latency-tail stability) ───────────────────────────────
 * How stable the latency TAIL is: the p99/p50 "tail blowup" ratio blended
 * with the poor-sample rate, pooled across every screen's mount durations.
 * Mirrors the Node/Python/Web resilience axis (tail good ≤3× · poor ≥8×;
 * poor-rate good ≤5% · poor ≥25%; blend 0.6·tail + 0.4·poorRate) so all four
 * runtimes read the same way. A screen set whose median is fine but whose
 * worst-case mounts blow up 8× reads as fragile even while "good" on average.
 * Label-free (durations only), additive + display-only — never feeds the
 * TTFF/TTI/FID speed composite. Pending until enough pooled mounts exist.
 */
export const RESILIENCE_TAIL_THRESHOLDS = { good: 3, poor: 8 } as const satisfies AxisThresholds;
export const RESILIENCE_POOR_RATE_THRESHOLDS = { good: 0.05, poor: 0.25 } as const satisfies AxisThresholds;

/* ── Resilience tail contract — shared by EVERY kit ──────────────────────────
 *
 * p99/p50 on its own produces confident nonsense at low latency: no absolute
 * floor (a 22 ms worst case was rated POOR because the median was 3 ms), and a
 * FREE PERFECT SCORE whenever the median rounded to 0 ms — which, since mount
 * durations are captured in whole milliseconds, is the normal condition for a
 * cheap screen. The tail is 0.6 of THIS kit's score, half again as much as
 * Node's 0.4, so the free score was worth more here than anywhere.
 *
 * Bands and blend weights stay per-kit; these three numbers are identical in
 * every kit, and scripts/src/__tests__/resilience-tail-parity.test.ts names
 * every copy so a future one cannot drift.
 */

/** A p99 at or below this is not a tail worth acting on, whatever the ratio. */
export const RESILIENCE_TAIL_FLOOR_MS = 50;

/** Pooled mounts needed before a p99 — and so the axis — is published. Below
 *  this a "p99" is just the slowest of a handful. */
export const RESILIENCE_MIN_TAIL_SAMPLES = 20;

/** A median below the capture resolution is unmeasured, not small. */
export const RESILIENCE_MIN_MEDIAN_MS = 1;

/** What the tail can honestly say about a set of samples. */
export type TailReading =
  | { state: "insufficient" }
  | { state: "flat"; ratio: number | null }
  | { state: "unmeasurable" }
  | { state: "rated"; ratio: number };

/** The one place this judgement is made in the RN kit. */
export function readResilienceTail(
  p50Ms: number | null | undefined,
  p99Ms: number | null | undefined,
  sampleCount: number,
): TailReading {
  if (
    sampleCount < RESILIENCE_MIN_TAIL_SAMPLES ||
    p50Ms == null ||
    p99Ms == null ||
    !Number.isFinite(p50Ms) ||
    !Number.isFinite(p99Ms)
  ) {
    return { state: "insufficient" };
  }
  const measurableMedian = p50Ms >= RESILIENCE_MIN_MEDIAN_MS;
  if (p99Ms <= RESILIENCE_TAIL_FLOOR_MS) {
    return { state: "flat", ratio: measurableMedian ? p99Ms / p50Ms : null };
  }
  if (!measurableMedian) return { state: "unmeasurable" };
  return { state: "rated", ratio: p99Ms / p50Ms };
}

/** Nearest-rank percentile of an unordered list (does not mutate the input).
 *  0 when empty. q in (0,1]. Mirrors the Node/Python runtimes' method. */
function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}

export interface ResilienceResult {
  /** 0–100, or null while pending (not enough pooled mounts yet). */
  score:       number | null;
  rating:      AxisRating;
  /** p99/p50 tail-blowup ratio (1dp), or null while pending. */
  tailRatio:   number | null;
  /** Pooled p50 mount duration (ms, rounded), or null while pending. */
  p50Ms:       number | null;
  /** Pooled p99 mount duration (ms, rounded), or null while pending. */
  p99Ms:       number | null;
  sampleCount: number;
  /** How many durations were withheld for spanning a background suspend.
   *  Present ONLY when at least one was — the phone's mirror of the server
   *  kits' host-suspend discount. */
  suspendDiscounts?: number;
  /** The longest withheld duration (ms) — what the tail WOULD have said had
   *  the app's time in a pocket been counted as work. */
  suspendWorstMs?: number;
}

/**
 * Attach the background-suspend discount to a resilience reading, when there
 * was one.
 *
 * The phone's answer to the server kits' host-suspend discount: a duration
 * measured across a spell in the background was never withheld before this, and
 * one production install reported a p99 of 445,188 ms — 7.4 minutes — against a
 * 204 ms median. Those samples are now withheld at record time, and these two
 * numbers make the withholding visible: how many, and what the worst one would
 * have said. Discount, never hide.
 */
export function withBackgroundDiscounts(r: ResilienceResult): ResilienceResult {
  const { suspendDiscounts, suspendWorstMs } = readBackgroundSuspendStats();
  if (suspendDiscounts <= 0) return r;
  return { ...r, suspendDiscounts, suspendWorstMs };
}

export function computeResilienceScore(series: RouteSeriesLike[]): ResilienceResult {
  const pooled: number[] = [];
  for (const route of series) {
    const durations = route?.durations;
    if (!Array.isArray(durations)) continue;
    for (const d of durations) {
      if (typeof d === "number" && Number.isFinite(d) && d >= 0) pooled.push(d);
    }
  }
  const p50 = pooled.length > 0 ? percentile(pooled, 0.5) : null;
  const p99 = pooled.length > 0 ? percentile(pooled, 0.99) : null;
  const tail = readResilienceTail(p50, p99, pooled.length);
  if (tail.state === "insufficient") {
    return {
      score:       null,
      rating:      "pending",
      tailRatio:   null,
      p50Ms:       null,
      p99Ms:       null,
      sampleCount: pooled.length,
    };
  }
  if (tail.state === "unmeasurable") {
    // The median is below the capture resolution and the tail is above the
    // floor, so no ratio can be taken. The tail is 0.6 of this score —
    // withhold the whole axis rather than publish a verdict whose dominant
    // term was never measured. Same null-and-pending shape this axis already
    // uses for too-few samples, so every surface already renders it.
    return {
      score:       null,
      rating:      "pending",
      tailRatio:   null,
      p50Ms:       Math.round(p50!),
      p99Ms:       Math.round(p99!),
      sampleCount: pooled.length,
    };
  }
  const tailRatio = tail.ratio;
  const tailScore =
    tail.state === "flat"
      ? 100
      : linearScore(
          tail.ratio,
          RESILIENCE_TAIL_THRESHOLDS.good,
          RESILIENCE_TAIL_THRESHOLDS.poor,
        );
  const poorCount = pooled.filter((d) => d >= SCORE_THRESHOLDS.tti.poor).length;
  const poorRate = pooled.length > 0 ? poorCount / pooled.length : 0;
  const poorRateScore = linearScore(
    poorRate,
    RESILIENCE_POOR_RATE_THRESHOLDS.good,
    RESILIENCE_POOR_RATE_THRESHOLDS.poor,
  );
  const score = Math.round(0.6 * tailScore + 0.4 * poorRateScore);
  return {
    score,
    rating:      ratingFor(score),
    tailRatio:   tailRatio == null ? null : Math.round(tailRatio * 10) / 10,
    p50Ms:       Math.round(p50!),
    p99Ms:       Math.round(p99!),
    sampleCount: pooled.length,
  };
}

/* ─── crashFree (UNIVERSAL axis) ────────────────────────────────────────
 * "How stable is this app for real users?" Derived purely from the crash hook
 * the kit ALREADY installs (ErrorUtils global handler → crashReporter.capture),
 * via a counter — no new collection. Scored on the observed crash RATE
 * (crashes per hour) against the cross-runtime band good 0 · poor 3, matching
 * the Node/Python/Go/Java crashFree axis byte-for-byte.
 *
 * Warm-up gate: return "pending" (null score) while there have been ZERO
 * crashes AND fewer than CRASHFREE_MIN_WINDOW_MIN minutes observed — but a
 * crash surfaces IMMEDIATELY, even during warm-up, so a real crash is never
 * hidden behind the window. Numbers-only wire ({ score, rating, crashes,
 * windowMin }); the server rebuilds any caption. Additive + display-only —
 * never feeds the TTFF/TTI/FID speed composite.
 */
export const CRASHFREE_RATE_THRESHOLDS = { good: 0, poor: 3 } as const satisfies AxisThresholds;

/** Observe at least this many minutes before claiming crash-free (a crash
 *  surfaces immediately regardless). */
const CRASHFREE_MIN_WINDOW_MIN = MIN_RATE_WINDOW_MIN;

/** Minimal, label-free input for the crashFree axis: the session crash count
 *  (from crashReporter.crashCount()) and minutes observed since telemetry
 *  started. Both are plain numbers — nothing identifying reaches this layer. */
export interface CrashStatsLike {
  crashes:   number;
  windowMin: number;
}

export interface CrashFreeResult {
  /** 0–100, or null while pending (still warming, no crash yet). */
  score:     number | null;
  rating:    AxisRating;
  /** Crashes inside the banked window — this run's, plus what earlier runs
   *  of this app on this device banked (shown even while pending). */
  crashes:   number;
  /** Minutes watched, across every run inside the banked window. */
  windowMin: number;
  /** Runs the window spans, when more than one. Said out loud because a
   *  succession of healthy young runs is exactly how a crashing app
   *  presents itself. Omitted for a single-run reading. */
  runsInWindow?: number;
}

export function computeCrashFree(
  stats: CrashStatsLike,
  /** What earlier runs of this app on this device banked. A phone app is used
   *  in bursts of a few minutes, so a window earned inside one run is a window
   *  crashFree never reaches — and a crash that ENDS a run is exactly the
   *  event the run's own memory cannot report. Both halves of the rate come
   *  from the bank or neither does. See watchHistory.ts and
   *  docs/decisions/rate-window-earned-across-sessions.md. */
  banked: BankedWatch = NO_BANKED_WATCH,
): CrashFreeResult {
  const crashes = Math.max(0, Math.round(stats?.crashes ?? 0)) + banked.crashes;
  // Eligibility is judged on the RAW elapsed time, never on the reported
  // window: windowMinOf() is a two-decimal figure for a reader, and deciding
  // the ceiling from it would let 4 minutes 59.7 seconds present itself as an
  // earned five.
  const windowMs =
    Math.max(0, stats?.windowMin ?? 0) * 60_000 + banked.crashWatchMs;
  const windowMin = windowMinOf(windowMs);
  const runsTail = banked.runs > 0 ? { runsInWindow: banked.runs + 1 } : {};
  // The earned-rate contract (rateHonesty.ts): below the minimum observation
  // we publish neither the crash RATE nor the score built on it — a 37x
  // extrapolation off two minutes is a number the data never earned. The crash
  // COUNT and the window observed are reported either way, so a crash in the
  // first seconds surfaces immediately.
  const perHour = earnedPerHour(crashes, windowMs);
  if (perHour === null) {
    return { score: null, rating: "pending", crashes, windowMin, ...runsTail };
  }
  // SCORED FROM THE UNROUNDED RATE. Once a window can span a day, one crash is
  // 0.04/hour — which rounds to 0.0, scores 100 and rates "good". That is the
  // false all-clear rebuilt out of arithmetic: the crash survived the restart,
  // reached the reading, and was rounded back out of it. The exact rate
  // scores; the rounded one is only ever spoken. Mirrors readCrashFree() in
  // the Node kit byte for byte.
  const exactPerHour = earnedPerHour(crashes, windowMs, 4) ?? perHour;
  const score = linearScore(
    exactPerHour,
    CRASHFREE_RATE_THRESHOLDS.good,
    CRASHFREE_RATE_THRESHOLDS.poor,
  );
  return { score, rating: ratingFor(score), crashes, windowMin, ...runsTail };
}

/* ─── frozenFrames (ADDITIVE — frozen-frame rate) ───────────────────────
 * "How often does a frame visibly FREEZE?" The FrameSampler classifies any
 * foreground frame gap ≥700ms (< 5s) — the industry / Sentry frozen-frame
 * threshold — as a frozen frame, ONLY once AppState has confirmed the app was
 * active (never a mis-attributed backgrounding). This axis scores those frozen
 * frames as a RATE per foreground hour, so one early hitch on a cold start
 * can't dominate. A frozen frame surfaces IMMEDIATELY (crashFree-style): the
 * warm-up gate only holds a ZERO-frozen reading pending.
 *
 * DISTINCT from Smoothness / Stability / Frame Floor: those score merely-janky
 * or ≥50ms-blocked frames and the worst 1-second window; a frozen frame is the
 * rarer, worse, ≥700ms freeze the user actually sees lock up. Numbers-only wire
 * shape; the server rebuilds any caption. Additive + display-only — never feeds
 * the TTFF/TTI/FID speed composite.
 *
 * Bands: linearScore(perHour, good=1, poor=30). ≤1 frozen frame/hr reads as an
 * occasional, tolerable blip (100); ≥30/hr is chronically freezing (0).
 */
export const FROZEN_FRAMES_THRESHOLDS = { good: 1, poor: 30 } as const satisfies AxisThresholds;

/** Observe at least this much foreground time before a ZERO-frozen reading
 *  leaves "pending" — a frozen frame surfaces immediately regardless. */
const FROZEN_MIN_ACTIVE_MS = MIN_RATE_WINDOW_MS;

export interface FrozenFramesResult {
  /** 0–100, or null while pending (warming with no frozen frame yet). */
  score:         number | null;
  rating:        AxisRating;
  /** Confirmed-foreground frozen frames (≥700ms) inside the banked window —
   *  this run's, plus what earlier runs banked (shown even while pending). */
  frozenCount:   number;
  /** Frozen frames per foreground hour (1dp), or null while pending. */
  frozenPerHour: number | null;
  /** Foreground minutes — the rate denominator, across every run inside the
   *  banked window. */
  windowMin:     number;
  /** Runs the window spans, when more than one. Omitted otherwise. */
  runsInWindow?: number;
  measurable?:   0 | 1;
  reasonCode?:   number;
}

export function computeFrozenFramesScore(
  stats: FrameStats,
  /** Pooled across the runs of this app on this device — see watchHistory.ts.
   *  A frozen frame still surfaces immediately; only the all-clear waits. */
  banked: BankedWatch = NO_BANKED_WATCH,
): FrozenFramesResult {
  const frozenCount =
    Math.max(0, Math.round(stats?.frozenFrameCount ?? 0)) + banked.frozenFrames;
  const liveActiveMs =
    typeof stats?.activeMs === "number" && stats.activeMs > 0 ? stats.activeMs : 0;
  const activeMs = liveActiveMs + banked.frameActiveMs;
  const windowMin = windowMinOf(activeMs);
  const runsTail = banked.runs > 0 ? { runsInWindow: banked.runs + 1 } : {};
  if (stats?.sourceAbsent === 1) {
    return {
      score: null, rating: "not-available", frozenCount,
      frozenPerHour: null, windowMin, measurable: 0,
      reasonCode: REASON_PLATFORM_DOES_NOT_EXPOSE,
    };
  }
  // The earned-rate contract (rateHonesty.ts): the projection and the score it
  // feeds wait for a window that earned them; the frozen-frame COUNT and the
  // foreground time observed surface immediately either way.
  const frozenPerHour = earnedPerHour(frozenCount, activeMs);
  if (frozenPerHour === null) {
    return {
      score: null, rating: "pending", frozenCount, frozenPerHour: null, windowMin,
      ...runsTail,
    };
  }
  const score = linearScore(
    frozenPerHour,
    FROZEN_FRAMES_THRESHOLDS.good,
    FROZEN_FRAMES_THRESHOLDS.poor,
  );
  return {
    score,
    rating:        ratingFor(score),
    frozenCount,
    frozenPerHour,
    windowMin,
    ...runsTail,
  };
}

/* ─── appHang (ADDITIVE — app-hang verdict) ─────────────────────────────
 * "Did the main JS queue ever go unresponsive for ≥5s?" The FrameSampler
 * classifies a confirmed-foreground frame gap ≥5s (a rAF that never fired
 * while the app stayed 'active') as an APP HANG — Sentry's app-hang wording.
 * This is the HONEST JS-side watchdog: it is NOT a native ANR (we can't see
 * the native main thread from JS), only the JS event loop's own stall.
 *
 * Scored like crashFree — a rare-but-serious event — on the hang RATE per
 * foreground hour. Warm-up gate: pending while there have been ZERO hangs AND
 * fewer than 5 minutes of foreground time; a hang surfaces IMMEDIATELY. Bands:
 * linearScore(perHour, good=0, poor=2). Even a low sustained hang rate is
 * damning, so the poor band is tight. Numbers-only wire; server rebuilds any
 * caption. Additive + display-only — never feeds the speed composite.
 */
export const APP_HANG_THRESHOLDS = { good: 0, poor: 2 } as const satisfies AxisThresholds;

/** Observe at least this much foreground time before a ZERO-hang reading leaves
 *  "pending" — a hang surfaces immediately regardless. */
const APP_HANG_MIN_ACTIVE_MS = MIN_RATE_WINDOW_MS;

export interface AppHangResult {
  /** 0–100, or null while pending (warming with no hang yet). */
  score:       number | null;
  rating:      AxisRating;
  /** Confirmed-foreground app hangs (≥5s) inside the banked window — this
   *  run's, plus what earlier runs banked (shown even while pending). */
  hangCount:   number;
  /** Worst single app hang (ms, rounded) THIS RUN, 0 if none. Never banked:
   *  an earlier run's extreme is not a stall this one had. */
  worstHangMs: number;
  /** Foreground minutes — the rate denominator, across every run inside the
   *  banked window. */
  windowMin:   number;
  /** Runs the window spans, when more than one. Omitted otherwise. */
  runsInWindow?: number;
  measurable?: 0 | 1;
  reasonCode?: number;
}

export function computeAppHangScore(
  stats: FrameStats,
  /** Pooled across the runs of this app on this device — see watchHistory.ts.
   *  A hang still surfaces immediately; only the all-clear waits.
   *
   *  The WORST hang is deliberately NOT banked: it is this run's own extreme,
   *  and carrying the worst of an earlier run forward would report a stall
   *  the current one never had. */
  banked: BankedWatch = NO_BANKED_WATCH,
): AppHangResult {
  const hangCount = Math.max(0, Math.round(stats?.hangCount ?? 0)) + banked.hangs;
  const worstHangMs = Math.round(stats?.worstHangMs ?? 0);
  const liveActiveMs =
    typeof stats?.activeMs === "number" && stats.activeMs > 0 ? stats.activeMs : 0;
  const activeMs = liveActiveMs + banked.frameActiveMs;
  const windowMin = windowMinOf(activeMs);
  const runsTail = banked.runs > 0 ? { runsInWindow: banked.runs + 1 } : {};
  if (stats?.sourceAbsent === 1) {
    return {
      score: null, rating: "not-available", hangCount, worstHangMs, windowMin,
      measurable: 0, reasonCode: REASON_PLATFORM_DOES_NOT_EXPOSE,
    };
  }
  // The earned-rate contract (rateHonesty.ts): no projection, and no judgement
  // built on one, until the window has earned it. The hang COUNT and the worst
  // hang surface immediately either way.
  const perHour = earnedPerHour(hangCount, activeMs);
  if (perHour === null) {
    return {
      score: null, rating: "pending", hangCount, worstHangMs, windowMin, ...runsTail,
    };
  }
  // Scored from the UNROUNDED rate, for the same reason crashFree is: once the
  // window can span a day, one hang is 0.04/hour, which rounds to 0.0 and
  // scores a clean 100 over a stall that really happened.
  const exactPerHour = earnedPerHour(hangCount, activeMs, 4) ?? perHour;
  const score = linearScore(
    exactPerHour,
    APP_HANG_THRESHOLDS.good,
    APP_HANG_THRESHOLDS.poor,
  );
  return {
    score, rating: ratingFor(score), hangCount, worstHangMs, windowMin, ...runsTail,
  };
}

/* ─── Patch Lag (build exposure window) ─────────────────────────────────
 * "How OLD is the build this device is actually running?" A device stuck on a
 * weeks-stale bundle is exposed to every bug fixed since — the exposure window.
 * This axis reports that lag in days and grades it: fresh builds score high, a
 * two-month-old build scores 0.
 *
 * HONESTY: this is a LAG meter, nothing more — it NEVER implies the app is
 * safe/patched, only how far behind the running build is. The build stamp
 * comes ONLY from the telemetry init options the developer wires (buildTimeMs,
 * e.g. from expo-constants / EAS metadata). When the host never supplies a
 * build time, the axis is ABSENT — no fabricated / warming reading (mirrors the
 * env-gated axes' honest-absence path). A commit-only stamp is not enough: the
 * age needs a time, so the axis appears ONLY when buildTimeMs is known.
 *
 * ADDITIVE: like every axis here it NEVER feeds the TTFF/TTI/FID speed
 * composite. ageDays = buildAgeMs / 86_400_000; rating good < 7d, needs-work
 * < 30d, else poor; score = round(clamp(100 - (ageDays/60)*100, 0, 100)) — a
 * 60-day-old build floors at 0.
 */
export const PATCH_LAG_GOOD_DAYS = 7;
export const PATCH_LAG_NEEDS_WORK_DAYS = 30;
/** Age (days) at which the score reaches 0. */
export const PATCH_LAG_FLOOR_DAYS = 60;

export interface PatchLagResult {
  /** 0–100, or null when the age is unknown (never happens once emitted, but
   *  kept nullable to mirror the shared axis shape). */
  score:       number | null;
  rating:      Exclude<AxisRating, "pending">;
  /** now - buildTimeMs at capture, clamped ≥0. */
  buildAgeMs:  number;
  /** The build time this age was measured against (epoch ms). */
  buildTimeMs: number;
  /** Dependency count — RN kit NEVER emits this (no dependency inventory on
   *  device). Present in the type only for cross-runtime wire parity. */
  depCount?:   number;
}

/** Rating band for a build age in days: good <7, needs-work <30, else poor. */
export function patchLagRatingFor(
  ageDays: number,
): Exclude<AxisRating, "pending"> {
  if (ageDays < PATCH_LAG_GOOD_DAYS) return "good";
  if (ageDays < PATCH_LAG_NEEDS_WORK_DAYS) return "needs-work";
  return "poor";
}

/** Compute the Patch Lag axis for a known build time. Caller must only invoke
 *  this when a build time is known (hasBuildTime()); returns null otherwise so
 *  the axis stays ABSENT (honest absence, never a fabricated reading). */
export function computePatchLag(now: number): PatchLagResult | null {
  const bt = buildTimeMs();
  if (!hasBuildTime() || typeof bt !== "number") return null;
  const buildAgeMs = Math.max(0, now - bt);
  const ageDays = buildAgeMs / 86_400_000;
  const score = Math.round(
    Math.max(0, Math.min(100, 100 - (ageDays / PATCH_LAG_FLOOR_DAYS) * 100)),
  );
  return {
    score,
    rating: patchLagRatingFor(ageDays),
    buildAgeMs,
    buildTimeMs: bt,
  };
}

/* ─── Combined axes — SINGLE SOURCE OF TRUTH ────────────────────────────
 * Both the in-app dashboard (BoosthisEnginePanel) and the snapshot upload
 * (capturePerfSnapshot) call this one helper so the axes can never drift
 * between the device and the web mirror. The server NEVER recomputes these —
 * it only renders the values uploaded here — so this function is the only
 * place the axis logic lives. Compute it from the FULL diagnosis (before any
 * per-screen cap the upload applies), since confidence reads min-mounts across
 * every scorable screen.
 */
export interface MeterAxes {
  backgroundWork?: BackgroundWorkResult;
  upstreamCache?: UpstreamCacheResult;
  /** AI calls observed at RN's real outbound transport. Absent until a known,
   * declared or AI-shaped destination is actually sent. */
  aiCalls?: AiCallsResult;
  smoothness:     SmoothnessResult;
  responsiveness: ResponsivenessResult;
  /** JS-thread long-task stability (derived from the same frame sampler). */
  stability:      StabilityResult;
  /** Scroll/list health — frame jank attributed to active scrolling, plus an
   *  optional FlashList blank-cell signal. Field-capable (release-safe). */
  scroll:         ScrollHealthResult;
  /** Frustration — confirmed rage-tap bursts per minute. Coordinate-free,
   *  field-capable (release-safe). */
  frustration:    FrustrationResult;
  /** Idle efficiency — wasted JS-thread work (battery drain) once the user has
   *  stopped interacting. Derived from the same frame sampler, field-capable. */
  idle:           IdleEfficiencyResult;
  /** Frame Floor — the worst completed 1-second window's effective FPS over
   *  the session, so one frozen second is never averaged away. Derived from
   *  the same frame sampler, field-capable. */
  frameFloor:     FrameFloorResult;
  /** Network reliability — stall / silent-timeout rate + p75 latency from
   *  host-reported attempts (counts + durations only). Field-capable. */
  network:        NetworkResult;
  /** Baseline anomaly — each screen graded against ITS OWN recent history
   *  (recent window vs. earlier window), so a screen that doubled is flagged
   *  even while nominally "good". Label-free, purely numeric, field-capable. */
  baseline:       BaselineResult;
  /** Resilience — latency-tail stability (p99/p50 blowup + poor-sample rate)
   *  pooled across all screens. Label-free, purely numeric, field-capable.
   *  Mirrors the Node/Python/Web resilience axis. */
  resilience:     ResilienceResult;
  /** Timer Health (RN-exclusive) — the growth TREND of outstanding JS timers,
   *  a leak signal from wrapped global set/clear timers. Purely numeric,
   *  field-capable. Pending until enough samples span enough time. */
  timerHealth:    TimerHealthResult;
  eventLoopLag?: EventLoopLagResult;
  blockingAsync?: BlockingAsyncResult;
  asyncSlowCallbacks?: AsyncSlowCallbacksResult;
  /** Memory Warnings (RN-exclusive) — OS memory-pressure warnings (AppState
   *  'memoryWarning') per foreground hour. A DEVICE signal the server runtimes
   *  cannot see. Numbers-only, field-capable. Pending until installed and a
   *  warning has fired or enough foreground time has passed. */
  memoryWarnings?: MemoryWarningsResult;
  /** swallowedErrors (PORT of the Python kit's Near-Miss Rate) — errors the
   *  HOST app logged at error level but did NOT crash on, per hour, observed by
   *  CHAINING console.error (timestamps only; our own logging excluded). Wire
   *  shape identical to Python ({ score, rating, count, perHour, windowMin,
   *  caption }). OMITTED (undefined → dropped by JSON.stringify) while warming
   *  inside the 5-minute min window; { measurable: 0 } when the chain never
   *  installed so the tile explains itself instead of warming forever. */
  swallowedErrors?: SwallowedErrorsResult;
  /** leakWatch (shared additive axis, Aug 2026) — detects the HOST app leaking
   *  stack traces, secrets/keys, or personal details TO ITS OWN USERS. On RN
   *  the only user-visible surface a JS kit can observe is console output
   *  (LogBox / dev overlay), so it PIGGYBACKS the SAME console.error chain
   *  swallowedErrors installs (no second hook) and classifies each observation
   *  into exactly one of secret/pii/stack. NEVER feeds the Speed score; display-
   *  only. Wire shape { score, rating, count, perHour, windowMin, stackCount,
   *  secretCount, piiCount, caption } (routeClassCount OMITTED — RN has no
   *  response path). Counts + category words only; content NEVER stored/emitted.
   *  OMITTED (undefined → dropped by JSON.stringify) while warming inside the
   *  5-minute min window; { measurable: 0 } when the chain never installed. */
  leakWatch?: LeakWatchResult;
  /** devPosture (shared additive "Dev Posture" axis, wave 2) — reports whether
   *  a live app is still wearing its development clothes. Reports EXPOSURE,
   *  never safety: a clean tile means "none of the development settings we can
   *  read were on", never "production-hardened". READ ONCE at startup (frozen).
   *  On RN the readable checks are debugFlag (__DEV__) and profilingOpen
   *  (remote JS debugging, OMITTED when uncertain); verboseErrors/sourceMaps
   *  are not readable → OMITTED. Wire shape { score, rating, caption, findings,
   *  checks, measurable, debugFlag?, verboseErrors?, sourceMaps?,
   *  profilingOpen? } — numbers + rating/caption only. RN always has at least
   *  one readable check (__DEV__), so this always emits. NEVER feeds the Speed
   *  score; display-only. */
  devPosture: DevPostureReading;
  /** liveConnections (shared additive axis, Aug 2026) — the app's long-lived
   *  connections: chat sockets, presence channels, live feeds, streamed
   *  answers. Counts how many are open, how long they last, how often they
   *  drop and reconnect, and tells a connection that is merely QUIET apart
   *  from one that has silently died — abstaining (`undecided`) when nothing
   *  ever arrived regularly enough to tell. Counts and durations only; a
   *  message's content is never read. NEVER feeds the Speed score;
   *  display-only. OMITTED (undefined → dropped by JSON.stringify) when the
   *  app opened no such connection at all — an app with no realtime feature
   *  must show NOTHING here, never a row of zeros. */
  liveConnections?: LiveConnectionsReading;
  /** crashFree (universal) — crashes/hour from the crash hook the kit already
   *  installs. Numbers-only, field-capable. Pending while warming with no
   *  crashes; a crash surfaces immediately. */
  crashFree:      CrashFreeResult;
  /** frozenFrames (RN-exclusive, additive) — confirmed-foreground frozen
   *  frames (≥700ms, Sentry threshold) per foreground hour, derived from the
   *  same frame sampler. Numbers-only, field-capable. Pending while warming
   *  with no frozen frame; a frozen frame surfaces immediately. */
  frozenFrames:   FrozenFramesResult;
  /** appHang (RN-exclusive, additive) — confirmed-foreground app hangs (≥5s,
   *  the honest JS-side watchdog, NOT a native ANR) per foreground hour, from
   *  the same frame sampler. Numbers-only, field-capable. Pending while warming
   *  with no hang; a hang surfaces immediately. */
  appHang:        AppHangResult;
  /** Re-render Storms (RN-exclusive, additive) — React commits per interaction
   *  (p75), correlated from <BoosthisProfiler> commits + fid taps. React's
   *  Profiler is INERT in release builds → measurable:0, pending. Numbers-only.
   *  Reads its own module state. */
  reRenders:      ReRendersResult;
  /** Image Weight (RN-exclusive, additive) — decoded-vs-displayed image
   *  overfetch (p75 ratio). Release-safe (onLoad/onLayout fire in production).
   *  Numbers-only. Reads its own module state. */
  imageWeight:    ImageWeightResult;
  /** Bridge Traffic (RN-exclusive, additive) — JS↔native MessageQueue calls
   *  per minute (old arch). New arch (Bridgeless/JSI) → newArch:1, measurable:0,
   *  pending (JSI is invisible from JS). Numbers-only. Reads its own module
   *  state. */
  bridgeTraffic:  BridgeTrafficResult;
  /** JS Startup Cost (RN-exclusive, additive) — one-shot bundle-eval→first-
   *  render time. Numbers-only. Reads its own module state. Pending until the
   *  first render is observed. */
  jsStartup:      JsStartupResult;
  /** Navigation Dead Time (RN-exclusive, additive) — p75 gap between a tap and
   *  the destination screen's mount START, correlated from fid taps + screen
   *  mounts. Numbers-only. Reads its own module state. Pending until ≥5 navs. */
  navDeadTime:    NavDeadTimeResult;
  /** press -> destination screen USABLE, with both legs and every press the
   *  join bound left behind. Contract: docs/press-to-screen-contract.md */
  pressToScreen:  PressToScreenResult;
  /** Screen Timer Leaks (RN-exclusive, additive) — JS timers that outlive their
   *  screen (mean leaked per exit), from the SAME wrapped timers as timerHealth
   *  (per-screen tagged). JS timers only, not native subscriptions. Numbers-only.
   *  Reads its own module state. Pending until ≥5 screen exits. */
  screenLeaks?:   ScreenLeaksResult;
  /** Foreground Residency (RN-exclusive, additive) — share of the observed
   *  session that is foreground, from the shared AppState 'change' listener.
   *  Numbers-only. ALWAYS warms (AppState reports 'active' on launch). Pending
   *  until enough observed time / not wired. */
  foregroundResidency?: ForegroundResidencyResult;
  /** Background-Return Recovery (RN-exclusive, additive) — first-rAF resume
   *  latency after returning active (one-shot rAF per return, no standing
   *  loop). Absent until the app has backgrounded and returned once. */
  backgroundRecovery?: BackgroundRecoveryResult;
  /** Dimension-Change Churn (RN-exclusive, additive) — orientation/window
   *  change events per foreground hour, from the Dimensions 'change' listener.
   *  Numbers-only. Pending until enough foreground time / not wired. */
  dimensionChurn?: DimensionChurnResult;
  /** Appearance-Change Churn (RN-exclusive, additive) — system theme/appearance
   *  change events per foreground hour, from Appearance.addChangeListener.
   *  Numbers-only. Pending until enough foreground time / not wired. */
  appearanceChurn?: AppearanceChurnResult;
  /** Keyboard Transition Latency (RN-exclusive, additive) — p75 gap from a
   *  keyboard show/hide event to the next rAF, from Keyboard listeners.
   *  Numbers-only. Pending until ≥3 transitions / not wired. */
  keyboardLatency?: KeyboardLatencyResult;
  /** Unhandled-Error Rate (RN-exclusive, additive) — global JS errors per
   *  foreground hour, via a CHAINED ErrorUtils global handler (the host's
   *  previous handler is always called; nothing is suppressed). Numbers-only.
   *  Pending until warm / not wired. */
  unhandledErrors?: UnhandledErrorRateResult;
  /** Promise-Rejection Rate (RN-exclusive, additive) — unhandled promise
   *  rejections per foreground hour, via a PASSIVE 'unhandledrejection'
   *  listener where the host exposes it. Numbers-only. Pending until warm /
   *  absent where the event doesn't exist. */
  promiseRejections?: PromiseRejectionRateResult;
  rejectionPressure?: RejectionPressureResult;
  /** Heap Headroom (RN-exclusive, additive) — used/limit heap share.
   *  ENV-GATED (BOOSTHIS_HERMES_HEAP): ABSENT (omitted) when the flag is off.
   *  Numbers-only. */
  heapHeadroom?: HeapHeadroomResult;
  /** GC Pressure (RN-exclusive, additive) — lifetime collector-time share.
   *  ENV-GATED (BOOSTHIS_HERMES_GC): ABSENT when the flag is off OR the GC
   *  instrumented-stats fields are unavailable. */
  gcPressure?: GcPressureResult;
  /** GC Tax (RN-exclusive, additive) — recent collector-time share.
   *  ENV-GATED (BOOSTHIS_HERMES_GC): ABSENT when the flag is off OR the GC
   *  fields are unavailable. */
  gcTax?: GcTaxResult;
  /** Hermes Runtime availability (RN-exclusive, additive) — capability probe:
   *  is this process actually running Hermes? { present, measurable }. */
  hermesRuntime?: HermesRuntimeResult;
  /** JSI Capability (RN-exclusive, additive) — capability probe: does the
   *  runtime expose a trustworthy JSI sentinel? { present, measurable };
   *  measurable:0 when no trustworthy sentinel exists. */
  jsiCapability?: JsiCapabilityResult;
  /** AsyncStorage Latency (RN-exclusive, additive) — p75 op duration.
   *  ENV-GATED (BOOSTHIS_STORAGE_METER) AND only when the host already provides
   *  AsyncStorage: ABSENT otherwise. Numbers-only (no keys/values). */
  storageLatency?: StorageLatencyResult;
  /** AsyncStorage Failure Rate (RN-exclusive, additive) — op rejection share.
   *  ENV-GATED (BOOSTHIS_STORAGE_METER) AND only when AsyncStorage is present:
   *  ABSENT otherwise. Numbers-only. */
  storageFailures?: StorageFailureResult;
  /** Patch Lag (build exposure window, additive) — how old the running build
   *  is, in days, graded. Emitted ONLY when a build time is known (wired via
   *  the telemetry init options); ABSENT otherwise (honest absence, never a
   *  fabricated/warming reading). NEVER feeds the Speed composite. */
  patchLag?: PatchLagResult;
  /** Budget compliance, or null when there is no diagnosis yet. */
  budget:         BudgetCompliance | null;
  confidence:     ConfidenceLevel;
  /** Min mounts across scorable screens that backs `confidence` (0 = none). */
  confidenceMounts: number;
  /** Pre-derived confidence rating + caption so the in-app panel and the web
   *  mirror render the confidence tile without re-deriving anything. */
  confidenceRating:  AxisRating;
  confidenceCaption: string;
}

export function computeMeterAxes(
  diag: DiagnosisReport | null,
  frame: FrameStats,
  interaction: InteractionStatsLike,
  /** Scroll/list health from scrollSampler.getStats(). Defaults to an empty
   *  (pending) reading so existing 3-arg callers and tests stay valid. */
  scroll: ScrollStatsLike = {
    frameCount:   0,
    jankFraction: 0,
    blankEvents:  0,
    worstBlankPx: 0,
  },
  /** Rage-tap counters from useFidSampler.getFrustrationStats(). Defaults to an
   *  empty (pending) reading so existing callers and tests stay valid. The idle
   *  axis needs no extra arg — it reads the idle counters off `frame`. */
  rage: FrustrationStatsLike = { burstCount: 0, worstDelayMs: 0 },
  /** Network attempt aggregate from networkSampler.getStats(). Defaults to an
   *  empty (pending) reading so existing callers and tests stay valid. */
  network: NetworkStatsLike = {
    attemptCount:   0,
    completedCount: 0,
    failedCount:    0,
    timeoutCount:   0,
    stallCount:     0,
    p75Ms:          0,
    worstMs:        0,
  },
  /** Per-screen ordered mount-duration series (label-free) for the Baseline
   *  anomaly axis. Defaults to empty (pending) so existing callers/tests stay
   *  valid. Built by buildRouteSeries() from the screen events. */
  routeSeries: RouteSeriesLike[] = [],
  /** crashFree input: session crash count (crashReporter.crashCount()) +
   *  minutes observed since telemetry started. Defaults to empty (pending) so
   *  existing callers/tests stay valid — the axis then warms up on its own. */
  crashStats: CrashStatsLike = { crashes: 0, windowMin: 0 },
  /** Wall-clock now (epoch ms) used ONLY to age the build stamp for the Patch
   *  Lag axis. Defaults to Date.now() so existing callers/tests stay valid;
   *  tests pass an explicit value for deterministic ages. */
  now: number = Date.now(),
  /** What earlier runs of this app on this device banked — read ONCE here and
   *  handed down, so every axis in one snapshot answers from the same ledger
   *  rather than re-reading it seven times. Defaults to the live ledger;
   *  tests pass an explicit total. See watchHistory.ts. */
  banked: BankedWatch = bankedWatch(),
): MeterAxes {
  const confidenceMounts = leastScorableMounts(diag);
  // Both clocks are lower bounds on observed foreground time. The larger is the
  // honest denominator and can only shrink a projected rate, never inflate it.
  const eventForegroundMs = Math.max(observedForegroundMs(), frame.activeMs);
  // How long we actually watched this app now speaks HERE, to the weight of
  // the whole snapshot, instead of being graded as an axis the app's author
  // cannot change (docs/decisions/meter-verdicts-that-are-not-about-the-app.md).
  // It can only LOWER confidence, never raise it, and never to "none" — "none"
  // still means nothing is scored yet.
  const sampleConfidence = confidenceLevel(confidenceMounts);
  const watchCeiling = confidenceCeilingForWatchMs(eventForegroundMs);
  const confidence = weakerConfidence(sampleConfidence, watchCeiling);
  const watchLimited = confidence !== "none" && confidence !== sampleConfidence;
  const promiseRejections = readPromiseRejections(eventForegroundMs);
  return {
    backgroundWork:  readBackgroundWork() ?? undefined,
    upstreamCache:   readUpstreamCache() ?? undefined,
    aiCalls:        computeAiCalls(getAiCallStats()) ?? undefined,
    smoothness:     computeSmoothnessScore(frame),
    responsiveness: computeResponsivenessScore(interaction),
    stability:      computeStabilityScore(frame),
    scroll:         computeScrollHealth(scroll),
    // Frustration shares the frame sampler's foreground clock (activeMs) so its
    // per-minute rate uses the SAME denominator as Stability — never wall-clock.
    frustration:    computeFrustrationScore(rage, frame.activeMs),
    idle:           computeIdleEfficiency(frame),
    frameFloor:     computeFrameFloor(frame),
    network:        computeNetworkScore(network),
    baseline:       computeBaselineScore(routeSeries),
    // Resilience carries the background-suspend discount when there was one.
    // The samples themselves never reached routeSeries — perfMonitor withheld
    // them at record time (see backgroundSpans.ts) — so the ratio is honest;
    // these two numbers say so out loud rather than letting a tail quietly
    // improve. Attached ONLY when something was actually discounted: a field
    // claiming a discount that never happened is its own wrong number.
    resilience:     withBackgroundDiscounts(computeResilienceScore(routeSeries)),
    // Timer Health reads its own module state (outstanding-timer trend sampled
    // at the frame cadence); no per-call arg needed. Returns a pending reading
    // until enough samples span enough time / tracking is installed.
    timerHealth:    readTimerHealth(),
    eventLoopLag:   readEventLoopLag() ?? undefined,
    blockingAsync:  readBlockingAsync() ?? undefined,
    asyncSlowCallbacks: readAsyncSlowCallbacks() ?? undefined,
    // Memory Warnings reads its own module state (AppState 'memoryWarning'
    // count) against the shared foreground clock — the SAME activeMs
    // denominator Stability / Frustration use. Pending until installed + warm.
    memoryWarnings: readMemoryWarnings(eventForegroundMs) ?? undefined,
    // swallowedErrors reads its OWN module state (a ring of console.error
    // timestamps — never the message/args). Returns null while warming inside
    // the 5-minute min window → coerced to undefined so JSON.stringify OMITS
    // the axis (the server renders an absent expected axis as "warming up"),
    // exactly like the Python kit's read_extra_meters. Returns { measurable: 0 }
    // when the chain never installed so the tile explains itself.
    swallowedErrors: readSwallowedErrors() ?? undefined,
    // leakWatch reads its OWN module state (a ring of {ts, category} for leaks
    // classified from the SAME console.error chain swallowedErrors installs —
    // never the matched text/value/log line). Returns null while warming inside
    // its 5-minute min window → coerced to undefined so JSON.stringify OMITS the
    // axis ("warming up"), and { measurable: 0 } when the chain never installed.
    // Additive / display-only — NEVER feeds the Speed score.
    leakWatch:      readLeakWatch() ?? undefined,
    // devPosture reads its OWN module state, frozen at first read: whether the
    // app is still wearing its development clothes (debugFlag = __DEV__,
    // profilingOpen = remote JS debugging when knowable). EXPOSURE, never
    // safety — a clean tile means none of the development settings we can read
    // were on, not that the deployment is hardened. Additive / display-only —
    // NEVER feeds the Speed score. Always emits (__DEV__ is always readable).
    devPosture:     readDevPosture(),
    // liveConnections reads its OWN module state (the wrapped WebSocket /
    // EventSource constructors — timestamps and counts only, never a frame's
    // content). Returns null when the app opened no long-lived connection, or
    // while the first one is younger than the 30-second minimum window →
    // coerced to undefined so JSON.stringify OMITS the axis entirely. That
    // absence is the point: an app with no chat or live screen must show
    // NOTHING here rather than a tile full of zeros.
    liveConnections: readLiveConnections() ?? undefined,
    crashFree:      computeCrashFree(crashStats, banked),
    // frozenFrames + appHang read the SAME frame stats (frozenFrameCount /
    // hangCount / worstHangMs the sampler classified against AppState) and the
    // SAME activeMs foreground denominator — no per-call arg needed. Both stay
    // pending until warm; a frozen frame / hang surfaces immediately.
    frozenFrames:   computeFrozenFramesScore(frame, banked),
    appHang:        computeAppHangScore(frame, banked),
    // The six additive RN axes below each read their OWN module state (populated
    // by the kit's collectors — BoosthisProfiler commits + fid taps for
    // reRenders/navDeadTime, the Image interception/recordImage for imageWeight,
    // the MessageQueue spy for bridgeTraffic, the module-eval clock for
    // jsStartup, the per-screen-tagged timer wrappers for screenLeaks). No
    // per-call arg needed; each stays pending until warm / measurable.
    reRenders:      readReRenders(),
    imageWeight:    readImageWeight(),
    bridgeTraffic:  readBridgeTraffic(),
    jsStartup:      readJsStartup(),
    navDeadTime:    readNavDeadTime(),
    pressToScreen:  readPressToScreen(),
    screenLeaks:    readScreenLeaks() ?? undefined,
    // Lifecycle axes read their OWN module state (the shared AppState/Dimensions/
    // Appearance/Keyboard listeners). foregroundResidency ALWAYS warms; the
    // others warm on ordinary use or read pending when the API is unavailable —
    // exactly like memoryWarnings. Numbers-only.
    foregroundResidency: readForegroundResidency(banked),
    backgroundRecovery:  readBackgroundRecovery(),
    dimensionChurn:      readDimensionChurn(banked),
    appearanceChurn:     readAppearanceChurn(banked),
    keyboardLatency:     readKeyboardLatency(),
    // Error-hygiene axes read their OWN module state. unhandledErrors chains the
    // ErrorUtils global handler (never suppressing the host's); promiseRejections
    // taps the host's 'unhandledrejection' event where it exists. Both use the
    // shared foreground observation as the rate denominator.
    unhandledErrors:   readUnhandledErrors(eventForegroundMs, banked),
    promiseRejections,
    rejectionPressure: rejectionPressureFrom(promiseRejections),
    // Hermes heap/GC axes are ENV-GATED and INVASIVE: their readers return null
    // when the opt-in flag is off (or GC fields are unavailable) → coerced to
    // undefined so JSON.stringify OMITS the axis (ABSENT, never a fabricated 0).
    heapHeadroom: readHeapHeadroom() ?? undefined,
    gcPressure:   readGcPressure() ?? undefined,
    gcTax:        readGcTax() ?? undefined,
    // Capability probes: cheap, always-on. Report {present, measurable}; a
    // non-Hermes / no-JSI host reads present:0 or measurable:0 (never warming).
    hermesRuntime:    readHermesRuntime(),
    jsiCapability:    readJsiCapability(),
    // AsyncStorage axes are ENV-GATED AND only wired when the host already
    // provides AsyncStorage: their readers return null otherwise → OMITTED.
    storageLatency:   readStorageLatency() ?? undefined,
    storageFailures:  readStorageFailures() ?? undefined,
    // Patch Lag reads the build stamp wired via the telemetry init options and
    // ages it against `now`. Returns null (→ undefined, OMITTED by
    // JSON.stringify) when no build TIME is known — honest absence, never a
    // fabricated/warming reading. ADDITIVE: never feeds the Speed composite.
    patchLag:         computePatchLag(now) ?? undefined,
    budget:         diag ? computeBudgetCompliance(diag) : null,
    confidence,
    confidenceMounts,
    confidenceRating:  confidenceRatingFor(confidence),
    confidenceCaption: confidenceCaptionFor(confidence, watchLimited),
  };
}

/* ─── 5. Render Efficiency (DEV-DASHBOARD ONLY — never uploaded) ─────────
 * How busy React's commit phase is. Driven by <BoosthisProfiler> commits
 * captured in renderProfiler. React's <Profiler onRender> is a no-op in
 * release builds, so this has data ONLY in dev — it is deliberately NOT part
 * of computeMeterAxes (the uploaded payload) and stays on-device.
 *
 * Scored on the per-minute rate of UPDATE commits (re-renders): a calm screen
 * re-renders only in response to real input; a "render storm" re-renders dozens
 * of times a second on its own. Animations driven through React state (instead
 * of the native driver / Reanimated) are the classic offender this surfaces.
 * Mounts are necessary work and are NOT penalised. Pending until enough commits
 * are seen to be meaningful — same shape (linearScore + ratingFor + a pending
 * floor) as the other axis scorers above. */
export const RENDER_EFFICIENCY_THRESHOLDS = { good: 30, poor: 180 } as const satisfies AxisThresholds;

/** Minimum commits before the axis leaves "pending" — avoids scoring a screen
 *  on one or two stray commits. */
const RENDER_MIN_SAMPLES = 8;

/** Minimal shape consumed from renderProfiler.getStats(). Structural so this
 *  module stays decoupled from the render layer (mirrors InteractionStatsLike). */
export interface RenderStatsLike {
  sampleCount:   number;
  updateCount:   number;
  wastedCount:   number;
  updatesPerMin: number;
  /**
   * Positive evidence that React's profiler is compiled out in this build:
   * something was profiled and nothing was ever reported. Supplied by
   * renderProfiler.isOffInThisBuild(). Optional so an existing caller passing
   * a bare stats object keeps its old meaning — absent is "we have not
   * established that", not "the profiler is fine".
   */
  offInThisBuild?: boolean;
}

export interface RenderEfficiencyResult {
  /** 0–100, or null while pending. */
  score:         number | null;
  rating:        AxisRating;
  /** Re-renders per minute over the window, or null while pending. */
  updatesPerMin: number | null;
  /** Provably wasted re-renders (shallow-equal props) seen in the window. */
  wastedCount:   number;
  sampleCount:   number;
  /**
   * 1 when the reading could be taken, 0 when it could not. A declared
   * silence, not an empty one: an axis that cannot be read must say so and
   * say why, or a blind spot renders as a clean result. Same shape the
   * Re-render Storms axis already sends on the wire.
   */
  measurable:    0 | 1;
  /** Why the reading could not be taken, from the shared closed vocabulary in
   *  axisReasons.ts. Null whenever `measurable` is 1. The kit sends the CODE;
   *  the words are owned elsewhere. */
  reasonCode:    number | null;
}

export function computeRenderEfficiency(stats: RenderStatsLike): RenderEfficiencyResult {
  // Declared first, before any score, rating or caption: React's <Profiler
  // onRender> is a no-op in release builds, so this store stays empty there
  // for ever. An empty store presented as "pending" reads as a reading that
  // is still coming, and every other axis then reading 100 makes a blind spot
  // look like a clean result — which is exactly how a screen mounting 500
  // children at once went unseen. This is a platform limit we are not going
  // to defeat; the honest move is to name it.
  if (stats?.offInThisBuild === true && (stats?.sampleCount ?? 0) === 0) {
    return {
      score:         null,
      rating:        "not-available",
      updatesPerMin: null,
      wastedCount:   stats?.wastedCount ?? 0,
      sampleCount:   0,
      measurable:    0,
      reasonCode:    REASON_OFF_IN_THIS_BUILD,
    };
  }
  if (!stats || stats.sampleCount < RENDER_MIN_SAMPLES) {
    return {
      score:         null,
      rating:        "pending",
      updatesPerMin: null,
      wastedCount:   stats?.wastedCount ?? 0,
      sampleCount:   stats?.sampleCount ?? 0,
      measurable:    1,
      reasonCode:    null,
    };
  }
  const score = linearScore(
    stats.updatesPerMin,
    RENDER_EFFICIENCY_THRESHOLDS.good,
    RENDER_EFFICIENCY_THRESHOLDS.poor,
  );
  return {
    score,
    rating:        ratingFor(score),
    updatesPerMin: stats.updatesPerMin,
    wastedCount:   stats.wastedCount,
    sampleCount:   stats.sampleCount,
    measurable:    1,
    reasonCode:    null,
  };
}

const CONFIDENCE_ORDER: ConfidenceLevel[] = ["none", "low", "medium", "high"];

/** The ceiling watch time puts on confidence. NEVER "none": "none" means
 *  nothing is scored yet (the sample count's answer, and the condition the
 *  kits use to drop the confidence keys entirely), and a short watch is not
 *  that. A kit with no foreground clock at all reads 0 here and is capped at
 *  "low" rather than silently erasing the reading. */
export function confidenceCeilingForWatchMs(fgMs: number): ConfidenceLevel {
  const ms = typeof fgMs === "number" && fgMs > 0 ? fgMs : 0;
  if (ms < CONFIDENCE_WATCH_CUTOFFS_MS.medium) return "low";
  if (ms < CONFIDENCE_WATCH_CUTOFFS_MS.high) return "medium";
  return "high";
}

/** The weaker of two confidence levels. */
export function weakerConfidence(a: ConfidenceLevel, b: ConfidenceLevel): ConfidenceLevel {
  return CONFIDENCE_ORDER.indexOf(a) <= CONFIDENCE_ORDER.indexOf(b) ? a : b;
}
