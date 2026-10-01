/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/** React Native snapshot reporting cadence, kept dependency-free so display
 * wording and cross-runtime guards can read the exact scheduler values. */
export const SNAPSHOT_FLUSH_MS = 60_000;

export function nextSnapshotDelayMs(sessionAgeMs: number): number {
  if (sessionAgeMs < 30_000) return 10_000;
  if (sessionAgeMs < 90_000) return 20_000;
  if (sessionAgeMs < 180_000) return 40_000;
  return SNAPSHOT_FLUSH_MS;
}

/** Honest wait phrase consumed by the in-app dashboard's warm-up hero. */
export const FIRST_REPORT_WAIT_TEXT =
  `first report arrives in about ${nextSnapshotDelayMs(0) / 1_000} seconds`;