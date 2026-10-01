/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: axis scoring leaf ───────────────────────────────────────
 *
 * The 0-100 scale every additive axis is scored on, the word that scale maps
 * to, and the shape of the band it is scored against. Nothing else.
 *
 * WHY THIS IS ITS OWN MODULE. These three things used to live in
 * meterAxes.ts, which is also the module that ASSEMBLES a snapshot — it
 * imports every axis module to collect their readings. Every axis module
 * needs the scoring helpers, so every axis module imported the thing that
 * collects it, and the kit's module graph held one strongly-connected
 * component of fourteen files. Metro reports each of those as a require
 * cycle, in the customer's own build output, before they have measured
 * anything.
 *
 * Cycles are also legal but treacherous: a module inside one can be handed a
 * partially-initialised neighbour at evaluation time, and a value read then
 * is `undefined` with nothing thrown and nothing logged. These modules are on
 * the kit's hot path.
 *
 * So the helpers moved down here, where they belong: nothing about a
 * piecewise-linear score needs to know what an axis is. This file must import
 * NOTHING — not from an axis module, not from anywhere in the kit. That is
 * what keeps the graph acyclic by construction rather than by care, and
 * scripts/src/__tests__/kit-module-cycles.test.ts fails the build if a cycle
 * comes back.
 *
 * meterAxes.ts re-exports all three, so every existing importer — inside the
 * kit and out of it — keeps working unchanged.
 */

/**
 * A rating band, or one of the three silences an axis can report instead of a
 * score. Only "pending" means a score is still coming: "not-available" says
 * this device or engine cannot take the reading at all, and "not-scored" says
 * the reading is real and deliberately never graded. One word for all three
 * left a permanent answer looking like a wait. An unrecognised word from a
 * newer kit degrades to the pending styling, which is safe.
 */
export type AxisRating =
  | "good"
  | "needs-work"
  | "poor"
  | "pending"
  | "not-available"
  | "not-scored";

/**
 * The shape of a band an axis is scored against: the value at or below which
 * the reading scores 100, and the value at or above which it scores 0 — the
 * two numbers {@link linearScore} interpolates between. Lower is better, so
 * `good` is always the smaller of the two.
 *
 * Declared here rather than beside any one axis because it is the argument
 * shape of the helper, not a fact about a meter.
 */
export interface AxisThresholds {
  readonly good: number;
  readonly poor: number;
}

/**
 * An axis band whose two constants are the wrong way round.
 *
 * A band is a pair of CONSTANTS in our own source: `good` is the value at or
 * below which a reading scores 100, `poor` the value at or above which it
 * scores 0. `good` below `poor` is what makes the interpolation mean
 * anything, so a pair that is equal or reversed is a typo in the kit — never
 * something a customer's app did.
 *
 * This runtime had no guard at all: an inverted band divided by zero or by a
 * negative span and published whatever fell out. The Node helper had one and
 * answered 100, which is worse — a meter wired backwards reported perfect
 * health on every install for ever. Both refuse now, with the same words.
 *
 * The throw is the BACKSTOP, not the guard. scripts' axis-band-inversion gate
 * reads the declared constants out of every shipped kit and fails the release
 * before an inverted pair can reach anybody.
 */
export class InvertedAxisBandError extends Error {
  readonly good: number;
  readonly poor: number;
  constructor(good: number, poor: number) {
    super(`${INVERTED_BAND_MESSAGE} (good=${good}, poor=${poor})`);
    this.name = "InvertedAxisBandError";
    this.good = good;
    this.poor = poor;
  }
}

/** The leading words every runtime uses when it refuses an inverted band, so
 *  the same mistake is recognisable whichever kit reported it. */
export const INVERTED_BAND_MESSAGE =
  "boosthis: inverted axis band, good must be below poor";

/** Piecewise-linear score: 100 at/below `good`, 0 at/above `poor`, linear
 *  between. Mirrors perfDiagnose's `linearScore` so every axis reads on the
 *  same 0-100 / 85-60 scale the speed score uses (lower input = better). A
 *  misconfigured band (poor <= good, or either end not a finite number)
 *  REFUSES — see {@link InvertedAxisBandError}. */
export function linearScore(value: number, good: number, poor: number): number {
  if (!Number.isFinite(good) || !Number.isFinite(poor) || poor <= good) {
    throw new InvertedAxisBandError(good, poor);
  }
  if (value <= good) return 100;
  if (value >= poor) return 0;
  return Math.round(100 * (1 - (value - good) / (poor - good)));
}

/** Map a 0-100 axis score onto the shared Lighthouse-style rating bands. */
export function ratingFor(score: number): AxisRating {
  return score >= 85 ? "good" : score >= 60 ? "needs-work" : "poor";
}
