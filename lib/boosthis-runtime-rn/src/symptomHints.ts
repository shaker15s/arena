/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * symptomHints — proactive, no-source-read "what's probably wrong" pairing for
 * the `what_should_i_look_at_next` triage tool.
 *
 * WHY THIS EXISTS (and why it's honest): Boosthis never reads the developer's
 * source, so it cannot *know* which rule a slow route violates. What it CAN see
 * is the timing SHAPE of a route (its percentiles / spike ratio / rating). That
 * shape is a strong prior on the *class* of cause:
 *
 *   • a route that is consistently slow (tight spread, p99≈p50) is almost always
 *     doing steady, avoidable work on every request — sequential awaits, an
 *     N+1, a missing index, no caching, heavy synchronous work.
 *   • a route whose tail blows up (p99 ≫ p50) is spiky — GC pauses, event-loop
 *     stalls, cold starts, retry storms, CPU-bound bursts.
 *
 * So this module maps the timing shape → a small set of the rule ids most
 * commonly behind that shape, plus a `next_step` that tells the AI to CONFIRM
 * with `match_rules_for_code` on the real handler source (which the developer's
 * own AI *can* read) and then `get_rule` for the fix. It is a prior, never a
 * diagnosis — the copy says so.
 *
 * This is the React-Native source of truth; `lib/boosthis-runtime-node` and
 * `lib/boosthis-py` mirror it. The rule ids below are asserted to exist in the
 * RN checklist by `symptomHints.test.ts`.
 */

export type Symptom = "steady-slow" | "spiky-tail" | "unknown";

/** Timing shape of one route/screen — the only inputs used to classify. Every
 *  field is a number/rating derived from measured latency; NO source, labels,
 *  or values are consulted. */
export interface SymptomStats {
  worstRating?: "good" | "needs-work" | "poor";
  p50Ms?: number;
  p99Ms?: number;
  /** p99/p50 when the caller pre-computed it; otherwise derived from p50/p99. */
  spikeRatio?: number | null;
}

/**
 * Symptom → the rule ids most commonly behind that latency shape (RN pack).
 * Kept deliberately small (≤8) and ranked most-likely-first so the AI has a
 * short, high-signal list to confirm — not the whole rule book.
 */
export const SYMPTOM_HINTS: Record<Symptom, readonly string[]> = {
  // Consistently slow screen load — steady per-render work to cut.
  "steady-slow": [
    "screen-load-budget-500ms-p75",
    "per-item-fetch-waterfall",
    "main-thread-sync-work",
    "eager-hydration-blocks-first-paint",
    "heavy-asset-preload",
    "client-refetch-no-cache",
    "oversized-thumbnail-fetch",
    "un-cached-image-spike",
  ],
  // Intermittent jank / tail spikes — bursty work, not steady load.
  "spiky-tail": [
    "frame-budget-16-67ms",
    "animated-js-driver-jank",
    "console-log-blocks-jsthread",
    "flatlist-virtualization-config",
    "inline-callbacks-break-memo",
    "scroll-event-throttle",
    "masked-layer-overdraw",
    "background-render-leak",
  ],
  // Rated slow but the shape can't be classified (no percentile spread) — a
  // general blend of the most common causes to confirm.
  unknown: [
    "screen-load-budget-500ms-p75",
    "main-thread-sync-work",
    "per-item-fetch-waterfall",
    "frame-budget-16-67ms",
    "flatlist-virtualization-config",
  ],
};

/** Fixed prose — makes clear this is a prior to confirm, never a diagnosis. */
export const NEXT_STEP =
  "These are the rule ids most commonly behind this latency shape — a prior, " +
  "not a confirmed diagnosis. Call boosthis.match_rules_for_code on this " +
  "route's handler source to see which actually apply, then boosthis.get_rule " +
  "for the fix.";

const SPIKY_RATIO = 4;

/**
 * Classify a route's timing shape. Returns null when the route is healthy
 * (good / unrated) so callers attach NO nudge to fast routes.
 */
export function classifySymptom(s: SymptomStats): Symptom | null {
  const rating = s.worstRating;
  if (rating == null || rating === "good") return null;
  let ratio: number | undefined;
  if (typeof s.spikeRatio === "number" && isFinite(s.spikeRatio)) {
    ratio = s.spikeRatio;
  } else if (
    typeof s.p99Ms === "number" &&
    typeof s.p50Ms === "number" &&
    s.p50Ms > 0
  ) {
    ratio = s.p99Ms / s.p50Ms;
  }
  if (ratio === undefined) return "unknown";
  return ratio >= SPIKY_RATIO ? "spiky-tail" : "steady-slow";
}

export interface NudgeFields {
  symptom: Symptom;
  candidate_rule_ids: readonly string[];
  next_step: string;
}

/**
 * Build the nudge fields to spread onto a triage row, or `{}` for a healthy
 * route. Attach these AFTER the PII filter — they are shipped constants (enum +
 * rule ids + fixed prose), so the guard must never drop a row over them.
 */
export function nudgeFields(s: SymptomStats): NudgeFields | Record<string, never> {
  const symptom = classifySymptom(s);
  if (!symptom) return {};
  return {
    symptom,
    candidate_rule_ids: SYMPTOM_HINTS[symptom],
    next_step: NEXT_STEP,
  };
}
