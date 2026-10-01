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
// A leaf: scheduledJobs imports only no-pii and runtimeFlags, so naming it
// here closes no cycle. It is the REPORTING half of background work — named
// runs going to the dashboard — where everything else in this file is the
// aggregate READING. One call feeds both; see reportJobRun below.
import { reportJobRun } from "./scheduledJobs";

export const BACKGROUND_WORK_MIN_RUNS = 5;
export const BACKGROUND_FAIL_THRESHOLDS = { good: 1, poor: 20 } as const;
const MAX_NAMES = 20;
const RING_SIZE = 500;

export interface BackgroundWorkOptions {
  queuedAtMs?: number;
  attempt?: number;
  system?: string;
}

export interface BackgroundWorkResult {
  runs: number;
  jobNames: number;
  otherNames: number;
  failed: number;
  retried: number;
  retryWorst: number;
  overlaps: number;
  waitRuns: number;
  recurring: number;
  hostedRuns: number;
  manualRuns: number;
  attachedSystems: number;
  unattachedSystems: number;
  failPct: number | null;
  p95Ms: number | null;
  worstMs: number | null;
  waitP95Ms: number | null;
  missed: number | null;
  measurable: 0 | 1;
  score: number | null;
  rating: AxisRating;
}

const names = new Set<string>();
const foldedNames = new Set<string>();
const attached = new Set<string>();
const unattached = new Set<string>();
const active = new Map<string, number>();
let durations: number[] = [];
let waits: number[] = [];
let runs = 0;
let failed = 0;
let retried = 0;
let retryWorst = 1;
let overlaps = 0;
let manualRuns = 0;

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length > 0 && name.length <= 80 ? name : null;
}

function percentile(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]);
}

export function noteBackgroundSystemAttached(system: string): void {
  const name = cleanName(system);
  if (!name) return;
  attached.add(name);
  unattached.delete(name);
}

/** Publish a detected background-system blind spot instead of a clean zero. */
export function noteBackgroundSystemUnattached(system: string): void {
  const name = cleanName(system);
  if (name && !attached.has(name)) unattached.add(name);
}

export async function trackBackgroundWork<T>(
  nameValue: string,
  fn: () => Promise<T> | T,
  options: BackgroundWorkOptions = {},
): Promise<T> {
  const name = cleanName(nameValue);
  if (!name) return await fn();
  if (names.size < MAX_NAMES || names.has(name)) names.add(name);
  else foldedNames.add(name);
  const key = names.has(name) ? name : "other";
  const count = active.get(key) ?? 0;
  if (count > 0) overlaps++;
  active.set(key, count + 1);
  if (options.system) noteBackgroundSystemAttached(options.system);
  else manualRuns++;
  const attempt = Number.isFinite(options.attempt)
    ? Math.max(1, Math.floor(options.attempt!))
    : 1;
  if (attempt > 1) retried++;
  retryWorst = Math.max(retryWorst, attempt);
  const startedWall = Date.now();
  const started = globalThis.performance?.now?.() ?? startedWall;
  if (Number.isFinite(options.queuedAtMs) && options.queuedAtMs! <= startedWall) {
    waits.push(startedWall - options.queuedAtMs!);
    if (waits.length > RING_SIZE) waits.shift();
  }
  try {
    const result = await fn();
    runs++;
    // THE SAME RUN, TOLD TWICE, ON PURPOSE. The counters above are this
    // app's own aggregate reading and never leave with a name attached. The
    // line below files the run BY NAME for the project page's scheduled-jobs
    // band, which is what lets an owner see a nightly sync stop. A developer
    // who already calls this gets both with no further change.
    reportJobRun({
      job: name,
      durationMs: Math.max(0, Math.round(Date.now() - startedWall)),
      ok: true,
    });
    return result;
  } catch (error) {
    runs++;
    failed++;
    // A failed run is the one most worth reporting: a job that runs nightly
    // and fails nightly is punctual, and only the failure says so.
    reportJobRun({
      job: name,
      durationMs: Math.max(0, Math.round(Date.now() - startedWall)),
      ok: false,
    });
    throw error;
  } finally {
    const ended = globalThis.performance?.now?.() ?? Date.now();
    durations.push(Math.max(0, ended - started));
    if (durations.length > RING_SIZE) durations.shift();
    const next = (active.get(key) ?? 1) - 1;
    if (next > 0) active.set(key, next);
    else active.delete(key);
  }
}

export function readBackgroundWork(): BackgroundWorkResult | null {
  if (runs === 0 && unattached.size === 0) return null;
  const base = {
    runs,
    jobNames: names.size + (foldedNames.size > 0 ? 1 : 0),
    otherNames: foldedNames.size,
    failed,
    retried,
    retryWorst,
    overlaps,
    waitRuns: waits.length,
    recurring: 0,
    hostedRuns: 0,
    manualRuns,
    attachedSystems: attached.size,
    unattachedSystems: unattached.size,
    waitP95Ms: percentile(waits),
    missed: null,
  };
  if (runs < BACKGROUND_WORK_MIN_RUNS) {
    return {
      ...base, failPct: null, p95Ms: null, worstMs: null,
      measurable: 0, score: null, rating: "pending",
    };
  }
  const failPct = Math.round((failed / runs) * 1000) / 10;
  const score = linearScore(
    failPct,
    BACKGROUND_FAIL_THRESHOLDS.good,
    BACKGROUND_FAIL_THRESHOLDS.poor,
  );
  return {
    ...base,
    failPct,
    p95Ms: percentile(durations),
    worstMs: durations.length ? Math.round(Math.max(...durations)) : null,
    measurable: 1,
    score,
    rating: ratingFor(score),
  };
}

export function clearBackgroundWork(): void {
  names.clear();
  foldedNames.clear();
  attached.clear();
  unattached.clear();
  active.clear();
  durations = [];
  waits = [];
  runs = failed = retried = overlaps = manualRuns = 0;
  retryWorst = 1;
}

export const _backgroundWorkInternals = { reset: clearBackgroundWork };