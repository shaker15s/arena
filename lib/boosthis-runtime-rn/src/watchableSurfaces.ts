/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* Boosthis shared watchable-surface vocabulary (React Native copy).
 *
 * The source of truth is lib/watchable-surfaces.json. The repository guard
 * fails the build if these literal, sorted lists disagree with that file.
 */

export const WATCHABLE_SURFACES = [
  "background-jobs",
  "database-work",
  "non-http-entry-points",
  "outbound-calls",
  "request-handling",
  "response-caching",
  "serverless-handlers",
] as const;

export const SURFACE_GAP_REASONS = [
  "attach-refused",
  "host-cannot-expose",
  "no-adapter-yet",
  "not-wrapped",
] as const;

export type WatchableSurface = (typeof WATCHABLE_SURFACES)[number];
export type SurfaceGapReason = (typeof SURFACE_GAP_REASONS)[number];

export interface SurfaceGap {
  surface: WatchableSurface;
  reason: SurfaceGapReason;
  detected: number;
}

export interface CoverageInventory {
  watched: WatchableSurface[];
  unwatched: SurfaceGap[];
}