/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * Boosthis snapshot store — persistent perf checkpoints + regression diff.
 *
 * Why this exists:
 *   The raw perfMonitor only ever holds the CURRENT session's events.
 *   Once you reload, restart the dev server, or clear the buffer, all
 *   prior numbers are gone — meaning a regression that crept in three
 *   commits ago is invisible. This module fixes that by letting you
 *   "snapshot" a report at any point and persist it under a label.
 *   Then any later report can be diff'd against any saved snapshot to
 *   surface per-screen regressions/improvements with a delta.
 *
 * Why kept separate from perfMonitor:
 *   perfMonitor is the hot path (records every event). Snapshot
 *   storage is cold path (user-triggered Save / Compare). Splitting
 *   them keeps the monitor lean and lets the snapshot module evolve
 *   its schema (versioned `v` field) without touching event capture.
 *
 * Storage layout (AsyncStorage via the perfPlatform shim):
 *   - rival.boosthis.snapshots.index.v1  → JSON array of SnapshotMeta
 *   - rival.boosthis.snapshot.<id>.v1    → JSON of PerfSnapshot (full)
 *   The split keeps the index cheap to load (small) so the dev/perf
 *   screen can list snapshots without rehydrating their full payloads.
 *   Hard-cap at MAX_SNAPSHOTS to bound disk usage; oldest evicted
 *   first so users don't have to manually prune.
 */

import { platform } from "./perfPlatform";
import {
  computeOverallScore,
  type DiagnosisReport,
  type ScreenDiagnosis,
  type ScreenPattern,
} from "./perfDiagnose";

const SNAPSHOTS_INDEX_KEY = "boosthis.snapshots.index.v1";
const SNAPSHOT_KEY_PREFIX = "boosthis.snapshot.";   // append `<id>.v1`
const SNAPSHOT_KEY_SUFFIX = ".v1";

/** Hard cap on persisted snapshots — cheap insurance against runaway disk use. */
export const MAX_SNAPSHOTS = 20;

/** Minimal row payload kept inside a snapshot. Mirrors the perfMonitor
 *  ReportRow but typed independently so a future schema change to the
 *  monitor doesn't silently invalidate stored snapshots. */
export interface SnapshotRow {
  key:   string;
  count: number;
  p50:   number;
  p95:   number;
  max:   number;
  /** Spread stats (optional — absent in snapshots saved by older runtimes). */
  p99?:  number;
  stdev?: number;
}

/** What we persist for each snapshot. Keep small + flat — JSON serialized. */
export interface PerfSnapshot {
  v:           1;
  id:          string;
  label:       string;
  savedAt:     number;
  platform:    string;
  totalEvents: number;
  rows:        SnapshotRow[];
  /** Per-screen pattern + total ms — flat for cheap diffing. */
  diagnoses:   { screen: string; pattern: ScreenPattern; totalMs: number }[];
  summary:     string;
}

/** Lightweight metadata cached in the index for the listing UI. */
export interface SnapshotMeta {
  id:          string;
  label:       string;
  savedAt:     number;
  platform:    string;
  totalEvents: number;
  /** How many screens were classified non-snappy at snapshot time —
   *  useful as a quick "health" score in the listing. */
  slowScreens: number;
  /** Composite 0–100 perf score at snapshot time. Lets the dashboard plot
   *  a score-over-time sparkline without re-diagnosing every snapshot.
   *  Optional for backwards compatibility with snapshots saved by
   *  earlier runtimes. */
  score?: number;
}

/** A single screen's regression/improvement vs a previous snapshot. */
export interface SnapshotDelta {
  key:        string;
  prevP95:    number;
  currP95:    number;
  /** Positive = slower (regression). Negative = faster (improvement). */
  deltaMs:    number;
  deltaPct:   number;
}

/** A screen whose Boosthis pattern classification changed. */
export interface PatternChange {
  screen:       string;
  prevPattern:  ScreenPattern;
  currPattern:  ScreenPattern;
}

export interface SnapshotDiff {
  prev:           SnapshotMeta;
  curr:           SnapshotMeta;
  regressions:    SnapshotDelta[];   // sorted worst (highest +deltaMs) first
  improvements:   SnapshotDelta[];   // sorted best (most negative deltaMs) first
  newScreens:     string[];
  goneScreens:    string[];
  patternChanges: PatternChange[];
  summary:        string;
}

/* ─── Internal helpers ─────────────────────────────────────────────── */

function snapshotKey(id: string): string {
  return SNAPSHOT_KEY_PREFIX + id + SNAPSHOT_KEY_SUFFIX;
}

async function loadIndex(): Promise<SnapshotMeta[]> {
  try {
    const raw = await platform().storage.get(SNAPSHOTS_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m): m is SnapshotMeta =>
      m && typeof m.id === "string" && typeof m.savedAt === "number"
    );
  } catch {
    return [];
  }
}

async function saveIndex(index: SnapshotMeta[]): Promise<void> {
  // We intentionally let this throw. saveSnapshot needs to know if the
  // index write failed so it can roll back the per-snapshot payload —
  // otherwise the user gets a "saved!" UX while the snapshot silently
  // disappears from the list after reload (orphaned payload, no index).
  await platform().storage.set(SNAPSHOTS_INDEX_KEY, JSON.stringify(index));
}

/** Generate an id that's monotonic-by-time so listings sort naturally. */
function newSnapshotId(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

/* ─── Public API: save / list / load / delete ──────────────────────── */

/** Shape we accept from perfMonitor.getReport() — narrowed so this
 *  module doesn't import perfMonitor and create a circular dep. */
export interface ReportLike {
  startedAt:   number;
  totalEvents: number;
  platform:    string;
  rows:        { key: string; count: number; p50: number; p95: number; max: number; p99?: number; stdev?: number }[];
  diagnosis:   DiagnosisReport;
}

export async function saveSnapshot(report: ReportLike, label?: string): Promise<SnapshotMeta> {
  const id = newSnapshotId();
  const savedAt = Date.now();
  const finalLabel = (label ?? "").trim() || `Snapshot ${new Date(savedAt).toLocaleString()}`;

  // Strip down to the SnapshotRow shape — drop `last` (volatile) and
  // any unexpected fields. This is what survives schema drift.
  const rows: SnapshotRow[] = report.rows.map((r) => ({
    key: r.key, count: r.count, p50: r.p50, p95: r.p95, max: r.max,
    ...(typeof r.p99 === "number" ? { p99: r.p99 } : {}),
    ...(typeof r.stdev === "number" ? { stdev: r.stdev } : {}),
  }));
  const diagnoses = report.diagnosis.screens.map((s: ScreenDiagnosis) => ({
    screen:  s.screen,
    pattern: s.pattern,
    totalMs: s.totalMs,
  }));
  const slowScreens = diagnoses.filter((d) => d.pattern !== "snappy").length;
  // A composite that has not earned itself scores 0 with rating
  // "insufficient-data". Storing that 0 turns an absence into a number the
  // moment it is read back — the saved snapshot would list "0/100" for a
  // session that simply had nothing to judge, which is the worst reading of
  // all. The field is optional precisely so it can be missing here.
  const overall = computeOverallScore(report.diagnosis);

  const snapshot: PerfSnapshot = {
    v: 1, id, label: finalLabel, savedAt,
    platform: report.platform,
    totalEvents: report.totalEvents,
    rows, diagnoses,
    summary: report.diagnosis.summary,
  };

  try {
    await platform().storage.set(snapshotKey(id), JSON.stringify(snapshot));
  } catch {
    // If the per-snapshot write fails, don't add to the index — keeps
    // the listing honest (no ghost rows pointing at missing payloads).
    throw new Error("Failed to persist snapshot");
  }

  const meta: SnapshotMeta = {
    id, label: finalLabel, savedAt,
    platform: report.platform,
    totalEvents: report.totalEvents,
    slowScreens,
    ...(overall.rating === "insufficient-data" ? {} : { score: overall.score }),
  };

  // Update index, evicting oldest if over cap.
  const index = await loadIndex();
  index.unshift(meta);   // newest first
  while (index.length > MAX_SNAPSHOTS) {
    const evicted = index.pop();
    if (evicted) {
      try { await platform().storage.remove(snapshotKey(evicted.id)); } catch {}
    }
  }
  try {
    await saveIndex(index);
  } catch (e) {
    // Index write failed — roll back the per-snapshot payload we just
    // wrote so we don't leave an orphan on disk and so the caller's
    // failure UI accurately reflects "nothing was saved."
    try { await platform().storage.remove(snapshotKey(id)); } catch {}
    throw new Error("Failed to persist snapshot index");
  }
  return meta;
}

export async function listSnapshots(): Promise<SnapshotMeta[]> {
  return loadIndex();
}

export async function loadSnapshot(id: string): Promise<PerfSnapshot | null> {
  try {
    const raw = await platform().storage.get(snapshotKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PerfSnapshot;
    if (parsed?.v !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function deleteSnapshot(id: string): Promise<void> {
  try { await platform().storage.remove(snapshotKey(id)); } catch {}
  const index = await loadIndex();
  await saveIndex(index.filter((m) => m.id !== id));
}

export async function clearAllSnapshots(): Promise<void> {
  const index = await loadIndex();
  await Promise.all(index.map((m) =>
    platform().storage.remove(snapshotKey(m.id)).catch(() => {})
  ));
  await saveIndex([]);
}

/* ─── Diff + chronic-pattern analysis (pure) ───────────────────────── */

/** Materiality threshold — we only flag a key as a regression /
 *  improvement when its p95 changed by AT LEAST this much in BOTH
 *  absolute and relative terms. Filters out measurement noise. */
const MIN_DELTA_MS  = 30;    // 30ms is roughly the floor at which a user starts to notice
const MIN_DELTA_PCT = 0.10;  // 10% — anything less is likely jitter, not a real shift

/**
 * Pure diff between two snapshots. No I/O. The caller decides which
 * two to compare (typical: latest vs prior, or latest vs a labeled
 * baseline like "pre-refactor").
 */
export function diffSnapshots(prev: PerfSnapshot, curr: PerfSnapshot): SnapshotDiff {
  const prevByKey = new Map(prev.rows.map((r) => [r.key, r]));
  const currByKey = new Map(curr.rows.map((r) => [r.key, r]));

  const regressions: SnapshotDelta[] = [];
  const improvements: SnapshotDelta[] = [];
  const newScreens: string[] = [];
  const goneScreens: string[] = [];

  for (const [key, c] of currByKey) {
    const p = prevByKey.get(key);
    if (!p) {
      // Only call out NEW screens that are non-trivial (≥2 samples) so
      // we don't spam the diff with one-off events from this session.
      if (c.count >= 2 && c.p95 >= 50) newScreens.push(key);
      continue;
    }
    const deltaMs = c.p95 - p.p95;
    const base    = Math.max(p.p95, 1);  // avoid /0; tiny baselines are unreliable anyway
    const deltaPct = deltaMs / base;
    if (Math.abs(deltaMs) >= MIN_DELTA_MS && Math.abs(deltaPct) >= MIN_DELTA_PCT) {
      const entry: SnapshotDelta = { key, prevP95: p.p95, currP95: c.p95, deltaMs, deltaPct };
      if (deltaMs > 0) regressions.push(entry);
      else             improvements.push(entry);
    }
  }
  for (const [key] of prevByKey) {
    if (!currByKey.has(key)) goneScreens.push(key);
  }

  // Pattern changes — only call out screens where the BUCKET shifted
  // (e.g. snappy → sync block). Same-pattern screens that just got
  // faster/slower are already covered by the delta arrays.
  const prevPatternByScreen = new Map(prev.diagnoses.map((d) => [d.screen, d.pattern]));
  const patternChanges: PatternChange[] = [];
  for (const c of curr.diagnoses) {
    const prevPattern = prevPatternByScreen.get(c.screen);
    if (prevPattern && prevPattern !== c.pattern) {
      patternChanges.push({ screen: c.screen, prevPattern, currPattern: c.pattern });
    }
  }

  regressions.sort((a, b) => b.deltaMs - a.deltaMs);
  improvements.sort((a, b) => a.deltaMs - b.deltaMs);

  // Headline: prefer worst regression, else best improvement, else "no material change".
  const summary =
    regressions.length > 0
      ? `${regressions.length} regression${regressions.length === 1 ? "" : "s"} — worst: ${regressions[0].key} +${Math.round(regressions[0].deltaMs)}ms`
      : improvements.length > 0
      ? `${improvements.length} improvement${improvements.length === 1 ? "" : "s"} — best: ${improvements[0].key} ${Math.round(improvements[0].deltaMs)}ms`
      : "No material change vs previous snapshot";

  return {
    prev:  metaFromSnapshot(prev),
    curr:  metaFromSnapshot(curr),
    regressions, improvements,
    newScreens, goneScreens,
    patternChanges,
    summary,
  };
}

function metaFromSnapshot(s: PerfSnapshot): SnapshotMeta {
  return {
    id: s.id, label: s.label, savedAt: s.savedAt,
    platform: s.platform, totalEvents: s.totalEvents,
    slowScreens: s.diagnoses.filter((d) => d.pattern !== "snappy").length,
  };
}

/** A screen that's been classified the same NON-snappy pattern across
 *  many snapshots — i.e. a chronic problem we keep diagnosing but not
 *  fixing. Surfacing these is more useful than a fresh diagnosis on
 *  every run because it filters out one-off noise. */
export interface ChronicPattern {
  screen:       string;
  pattern:      ScreenPattern;
  occurrences:  number;
  /** Most recent savedAt where this pattern was observed. */
  lastSeenAt:   number;
}

/**
 * Find screens that have been diagnosed with the SAME non-snappy
 * pattern across N or more of the most recent snapshots. Pure.
 *
 * Pass snapshots ordered newest-first (which is the index order from
 * listSnapshots → loadSnapshot). The caller controls the window.
 */
export function findChronicPatterns(
  snapshots: PerfSnapshot[],
  minOccurrences = 3,
): ChronicPattern[] {
  // Tally (screen, pattern) across all snapshots.
  const tally = new Map<string, { count: number; lastSeenAt: number }>();
  for (const snap of snapshots) {
    for (const d of snap.diagnoses) {
      if (d.pattern === "snappy") continue;
      const key = d.screen + "::" + d.pattern;
      const cur = tally.get(key);
      if (cur) {
        cur.count += 1;
        cur.lastSeenAt = Math.max(cur.lastSeenAt, snap.savedAt);
      } else {
        tally.set(key, { count: 1, lastSeenAt: snap.savedAt });
      }
    }
  }
  const out: ChronicPattern[] = [];
  for (const [key, v] of tally) {
    if (v.count < minOccurrences) continue;
    const sep = key.indexOf("::");
    out.push({
      screen:      key.slice(0, sep),
      pattern:     key.slice(sep + 2) as ScreenPattern,
      occurrences: v.count,
      lastSeenAt:  v.lastSeenAt,
    });
  }
  // Worst offenders first (most occurrences, then most recent).
  out.sort((a, b) => b.occurrences - a.occurrences || b.lastSeenAt - a.lastSeenAt);
  return out;
}
