/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/** Score thresholds, weights, and rating cutoffs.
 *
 * Identical to the Python `boosthis.thresholds` module so a "good" Python
 * route and a "good" React Native screen mean the same thing across the
 * stack. Source: Indeed Engineering — "Bringing Lighthouse to the App" (2026).
 */

export const SCORE_THRESHOLDS = {
  ttff: { good: 300, poor: 800 },
  tti: { good: 500, poor: 1500 },
  fid: { good: 50, poor: 150 },
} as const;

export const SCORE_WEIGHTS = {
  ttff: 0.25,
  tti: 0.45,
  fid: 0.3,
} as const;

export const RATING_CUTOFFS = {
  good: 85,
  needsWork: 60,
} as const;

export const RUNTIME_VERSION = "1.0.0-alpha.246" as const;

export type Rating = "good" | "needs-work" | "poor" | "pending";
