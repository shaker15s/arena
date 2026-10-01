/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
// From the leaf, never through meterAxes: meterAxes imports THIS module to
// assemble the axis, so taking its re-export back would close a require cycle
// and Metro prints that in the customer's build output.
import { linearScore, ratingFor, type AxisRating } from "./axisScoring";
import type { PromiseRejectionRateResult } from "./unhandledErrors";

export const REJECTION_PRESSURE_THRESHOLDS = { good: 0, poor: 5 } as const;

export interface RejectionPressureResult {
  lateHandled: null;
  unhandled: number | null;
  perHour: number | null;
  score: number | null;
  rating: AxisRating;
  measurable?: 0;
  reasonCode?: number;
}

/** Hermes exposes the shared rejection quantity but not reliable late handling. */
export function rejectionPressureFrom(
  source: PromiseRejectionRateResult,
): RejectionPressureResult {
  if (source.measurable === 0) {
    return {
      lateHandled: null,
      unhandled: null,
      perHour: null,
      score: null,
      rating: "not-available",
      measurable: 0,
      reasonCode: source.reasonCode,
    };
  }
  if (source.perHour === null) {
    return {
      lateHandled: null,
      unhandled: source.count,
      perHour: null,
      score: null,
      rating: "pending",
    };
  }
  const score = linearScore(
    source.perHour,
    REJECTION_PRESSURE_THRESHOLDS.good,
    REJECTION_PRESSURE_THRESHOLDS.poor,
  );
  return {
    lateHandled: null,
    unhandled: source.count,
    perHour: source.perHour,
    score,
    rating: ratingFor(score),
  };
}