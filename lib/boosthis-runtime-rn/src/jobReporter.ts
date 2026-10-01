/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * THE REPORTING HALF OF A PHONE APP'S BACKGROUND WORK.
 *
 * `scheduledJobs.ts` FINDS the work — it wraps `TaskManager.defineTask` and
 * asks the platform what it already has on file. This module is what gets a
 * finished run, and a rhythm the app stated, off the device: the buffer, the
 * upload, the declaration and the server's answer to it.
 *
 * Split out because the two halves fail differently and are read by different
 * people. Discovery is Expo's business and breaks when Expo changes; this is
 * the wire, and it is held to the same rules as every other kit that reports a
 * job — one reporter per kit, a batch that stands down rather than being sent
 * empty, a name screened before it is ever buffered, and a declared rhythm
 * that LEAVES the kit instead of being kept in a map nobody else can see.
 *
 * WHAT A DECLARATION IS FOR. Lateness is judged against a rhythm, and the only
 * rhythm here is one the app STATES through `expectEvery`. The kit does not
 * judge against the number on that line: it judges against the rhythm Boosthis
 * says it kept, which is not always the same — the stored unit is whole
 * minutes, and an owner can change or switch off a watch from the dashboard.
 * A declaration that cannot be delivered is said out loud rather than quietly
 * treated as though the job were watched.
 */

import { jobNameHasPII } from "./no-pii";
import { isBoosthisDisabled } from "./runtimeFlags";

/** One finished run, exactly as it goes on the wire. */
export interface JobRunReport {
  job: string;
  /** How long BEFORE the upload the run finished. */
  finishedAgoMs: number;
  durationMs: number;
  ok: boolean;
}

/** A rhythm the app STATED, as it goes on the wire. */
export interface JobExpectationReport {
  job: string;
  everyMs: number;
}

/** What the server answered about one declaration it was sent. */
export interface JobExpectationOutcome {
  job: string;
  stored: boolean;
  /** The rhythm IN FORCE, in whole minutes — the stored unit. */
  everyMinutes?: number;
  /** How much lateness Boosthis allows on top of it, in whole minutes. */
  graceMinutes?: number;
  reason?: string;
}

/** What a caller hands in. The instant is captured here and turned into an age
 *  only at flush, so a run that waits in the buffer does not drift younger. */
interface BufferedRun {
  job: string;
  finishedAtMs: number;
  durationMs: number;
  ok: boolean;
}

/** A rhythm this app stated, and what became of it. */
interface Declaration {
  /** What the app ASKED for. Kept so the kit knows a declaration is
   *  outstanding — never the number lateness is judged against. */
  requestedEveryMs: number;
  /** The rhythm the SERVER says it kept, in milliseconds. Null until an
   *  answer arrives. */
  statedEveryMs: number | null;
  /** Rhythm PLUS the grace the server allows, in milliseconds: the whole
   *  allowance, taken from the answer rather than derived here. */
  statedAllowanceMs: number | null;
  /** True once a send carrying this value reached Boosthis. */
  delivered: boolean;
  /** When the answer we are holding arrived, so it can be asked about again. */
  answeredAtMs: number | null;
}

/** Server accepts at most 50 runs per batch. */
export const MAX_JOB_RUN_BATCH = 50;
/** Nothing unbounded lives in a phone app's memory. Oldest go first. */
export const MAX_BUFFERED_JOB_RUNS = 200;
/** The server's own ceiling on a job name. */
export const MAX_JOB_NAME = 80;
/** What THIS kit enforces on a job name. The same number — said separately
 *  because a message explaining a refusal must quote the limit the reader has
 *  just hit, not the other end's. */
export const MAX_JOB_NAME_LEN = MAX_JOB_NAME;
/** How often finished runs are uploaded. */
export const JOB_FLUSH_MS = 30_000;
/** A run older than a week is refused by the server; never buffer one. */
export const MAX_JOB_MS = 604_800_000;
/** The most jobs one project may declare a rhythm for. */
export const MAX_JOB_EXPECTATIONS = 20;
/** How long an answer stands before the kit asks again. An owner who corrects
 *  an interval, widens the grace or switches a watch off has no other way to
 *  reach a phone that is already running. */
export const EXPECTATION_REVALIDATE_MS = 6 * 60 * 60_000;

/** What actually sends a batch. Set by the telemetry client; null means
 *  nothing is authorised to upload, so runs stay in memory and are dropped
 *  oldest-first rather than queued for ever. */
export type JobRunSubmitter = (
  runs: readonly JobRunReport[],
  expectations: readonly JobExpectationReport[],
) => Promise<number>;

let submitter: JobRunSubmitter | null = null;
let buffer: BufferedRun[] = [];
let declarations = new Map<string, Declaration>();
let lastRunAt = new Map<string, number>();
let flushTimer: ReturnType<typeof setInterval> | null = null;
/** Every job name this kit has seen run or discovered this session. Powers the
 *  panel's own answer about what it found, and is how "we looked and found
 *  none" is told apart from "we never looked". */
let seenJobs = new Set<string>();
/** True once the platform has actually been asked what it has registered. An
 *  empty `seenJobs` means nothing at all until this is true. */
let discovered = false;

export function setJobRunSubmitter(fn: JobRunSubmitter | null): void {
  submitter = fn;
}

export function pendingJobRunCount(): number {
  return buffer.length;
}

export function clearBufferedJobRuns(): void {
  buffer = [];
}

export function clearJobRhythmDeclarations(): void {
  declarations = new Map();
}

/** Record a job name this kit knows about. Called by the discovery half and
 *  by every reported run. */
export function noteJobSeen(job: string): void {
  seenJobs.add(job);
}

/** Say that the platform has now actually been asked. */
export function markJobsDiscovered(): void {
  discovered = true;
}

/**
 * WHAT THIS KIT KNOWS ABOUT THIS APP'S BACKGROUND WORK — including the answer
 * "we looked, and there is none".
 *
 * `looked` is the field that matters. An app with no background work and a kit
 * that never got as far as asking produce the same empty list, and they are
 * completely different facts: one is a finished reading, the other is silence.
 */
export function scheduledJobsFound(): { looked: boolean; jobs: string[] } {
  return { looked: discovered, jobs: [...seenJobs].sort() };
}

/** Reset every piece of reporting state. Tests only. */
export function _resetJobReporterForTests(): void {
  buffer = [];
  declarations = new Map();
  lastRunAt = new Map();
  seenJobs = new Set();
  discovered = false;
  submitter = null;
  saidCauses.clear();
  stopJobRunAutoFlush();
}

/**
 * A job name this kit is willing to send, or null.
 *
 * Refused rather than repaired: a name trimmed into something else is a
 * different job, and two jobs whose names agree for their first 80 characters
 * would silently become one row. A name carrying an address, a token or an id
 * is refused outright — a job name is written in code, and one built from a
 * value is the way a person's data would reach a page.
 */
export function jobName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_JOB_NAME_LEN) return null;
  if (jobNameHasPII(trimmed) !== null) return null;
  return trimmed;
}

/** Why a name was refused, in the developer's terms and quoting THIS kit's
 *  own limit. A message quoting the other end's number sends somebody off to
 *  write a name this kit will drop in silence. */
function whyJobNameRefused(name: unknown): string {
  if (typeof name !== "string") return "a job name has to be a string.";
  const trimmed = name.trim();
  if (!trimmed) return "the name is empty.";
  if (trimmed.length > MAX_JOB_NAME_LEN)
    return (
      `the name is ${trimmed.length} characters and a job name here must be ${MAX_JOB_NAME_LEN} or fewer. ` +
      `It is refused rather than shortened, because two names cut to the same ${MAX_JOB_NAME_LEN} characters would be filed as one job.`
    );
  const tag = jobNameHasPII(trimmed);
  if (tag !== null)
    return (
      `the name looks like it was built from a value (${tag}) rather than written in code. ` +
      `A job name reaches a page, so an id, a token or an address inside one is refused.`
    );
  return "the name was refused by this kit's own screen.";
}

// ── Saying so, out loud, once ───────────────────────────────────────────────

const saidCauses = new Set<string>();

/**
 * Say, once per cause per process, that a declaration did not do what the
 * caller asked.
 *
 * Every one of these was a silent `return`: the app stated a rhythm, nothing
 * happened, and the page went on saying nobody had declared one. On a phone
 * there is no server log to read afterwards, so the console at the moment of
 * the call is the only place this can be said.
 */
export function sayDeclarationOnce(cause: string, message: string): void {
  if (saidCauses.has(cause)) return;
  saidCauses.add(cause);
  try {
    console.warn(message);
  } catch {
    // A broken console must never take the host down.
  }
}

/**
 * State how often a job SHOULD run.
 *
 * WHERE THE DECLARATION GOES. It is SENT — queued now and delivered with the
 * next job upload, including an upload carrying no runs at all. It has to be:
 * Boosthis is the only side still there when the app is the thing that has
 * stopped, and a rhythm kept in a map on the phone is a rhythm nobody can
 * judge a missing run against.
 *
 * Never throws: this runs inside the host's own module scope, often at import
 * time, and a guest never fails its host.
 */
export function expectEvery(name: string, everyMs: number): void {
  try {
    const shown = typeof name === "string" ? `"${name.trim().slice(0, 40)}"` : "that job";
    if (isBoosthisDisabled()) {
      sayDeclarationOnce(
        "disabled",
        `[boosthis] Boosthis is switched off in this app, so the rhythm declared for ${shown} was not sent and that job is NOT being watched. ` +
          `Nothing here is broken — turn Boosthis back on and the declaration travels with the next upload.`,
      );
      return;
    }
    const job = jobName(name);
    if (!job) {
      sayDeclarationOnce(
        "name",
        `[boosthis] Boosthis did not take the rhythm declared for ${shown}, so that job is NOT being watched: ${whyJobNameRefused(name)}`,
      );
      return;
    }
    if (
      typeof everyMs !== "number" ||
      !Number.isFinite(everyMs) ||
      everyMs < 1000 ||
      everyMs > 365 * 24 * 60 * 60_000
    ) {
      sayDeclarationOnce(
        "interval",
        `[boosthis] Boosthis did not take the rhythm declared for ${shown}, so that job is NOT being watched: expectEvery() wants how often the job runs in MILLISECONDS, between one second and a year, and was given ${String(everyMs)}.`,
      );
      return;
    }
    const rounded = Math.round(everyMs);
    if (!declarations.has(job) && declarations.size >= MAX_JOB_EXPECTATIONS) {
      sayDeclarationOnce(
        "too_many",
        `[boosthis] This app has already declared a rhythm for ${MAX_JOB_EXPECTATIONS} jobs, so ${shown} is NOT being watched. ` +
          `Declare the ones that matter — a name built from a value (an id, a tenant, a date) is the usual reason for running out.`,
      );
      return;
    }
    if (rounded < 60_000) {
      // Not refused — CHANGED. Boosthis keeps a rhythm in whole minutes, so a
      // sub-minute declaration is watched at one minute. Said here because
      // this is the moment the developer's own number stops being the number
      // in force.
      sayDeclarationOnce(
        "sub_minute",
        `[boosthis] Boosthis keeps a job's rhythm in whole minutes, so the ${rounded}ms declared for ${shown} will be kept as every 1 minute, plus the lateness Boosthis allows on top. ` +
          `Nothing is refused for being short: the job is watched against the rhythm Boosthis confirms, not against the number on this line.`,
      );
    }
    declareJobRhythm(job, rounded);
  } catch {
    // A reporting failure must never surface as an application failure.
  }
}

/**
 * Hand a rhythm to the thing that ships it.
 *
 * The one entry point for a declaration reaching the wire: `expectEvery` does
 * the talking, this does the queueing. Re-stating the same value is free — it
 * collapses onto the entry already held, and once Boosthis has answered the
 * kit stops re-sending it until the answer is old enough to ask about again.
 */
export function declareJobRhythm(job: string, everyMs: number): void {
  const existing = declarations.get(job);
  if (existing && existing.requestedEveryMs === everyMs) return;
  // A CHANGED declaration has to travel again, even if an earlier one was
  // already delivered: the server judges lateness against what it holds, and
  // what it holds would otherwise be last week's rhythm for ever.
  declarations.set(job, {
    requestedEveryMs: everyMs,
    statedEveryMs: null,
    statedAllowanceMs: null,
    delivered: false,
    answeredAtMs: null,
  });
}

/** Declarations that still have to travel: never sent, or holding an answer
 *  old enough to be asked about again. */
function outstandingDeclarations(now: number): JobExpectationReport[] {
  const out: JobExpectationReport[] = [];
  for (const [job, d] of declarations) {
    const stale =
      d.answeredAtMs !== null && now - d.answeredAtMs >= EXPECTATION_REVALIDATE_MS;
    if (!d.delivered || stale) out.push({ job, everyMs: d.requestedEveryMs });
  }
  return out;
}

/** How many declared rhythms Boosthis has not answered about yet. A job in
 *  this count is a job that is not being watched YET — kept apart from a
 *  declaration Boosthis answered and REFUSED, which is watched never. */
export function pendingJobExpectationCount(): number {
  let n = 0;
  for (const d of declarations.values()) if (d.answeredAtMs === null) n += 1;
  return n;
}

/**
 * Read the declaration outcomes out of an upload reply body.
 *
 * `undefined` means the reply said NOTHING about declarations — an older
 * server, a body that is not an object, a missing field. Deliberately
 * different from `[]`, which is a server that answered about none of them.
 */
export function parseExpectationOutcomes(
  body: unknown,
): JobExpectationOutcome[] | undefined {
  try {
    if (!body || typeof body !== "object") return undefined;
    const raw = (body as Record<string, unknown>).expectations;
    if (!Array.isArray(raw)) return undefined;
    const out: JobExpectationOutcome[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      if (typeof rec.job !== "string" || rec.job.length === 0) continue;
      const outcome: JobExpectationOutcome = {
        job: rec.job,
        stored: rec.stored === true,
      };
      if (typeof rec.everyMinutes === "number" && Number.isFinite(rec.everyMinutes))
        outcome.everyMinutes = rec.everyMinutes;
      if (typeof rec.graceMinutes === "number" && Number.isFinite(rec.graceMinutes))
        outcome.graceMinutes = rec.graceMinutes;
      if (typeof rec.reason === "string") outcome.reason = rec.reason;
      out.push(outcome);
    }
    return out;
  } catch {
    return undefined;
  }
}

/**
 * Record what one upload answered about the declarations it carried.
 *
 * The ONLY place the in-force rhythm and allowance are written. A job the
 * server did not mention keeps its declaration open and is asked about again:
 * an older server that knows nothing of declarations answers nothing, and its
 * silence must not be read as a yes.
 */
export function noteJobExpectationOutcomes(
  outcomes: readonly JobExpectationOutcome[],
): void {
  try {
    const now = Date.now();
    for (const o of outcomes) {
      if (!o || typeof o.job !== "string") continue;
      const d = declarations.get(o.job);
      if (!d) continue;
      d.answeredAtMs = now;
      if (o.stored === true) {
        const every =
          typeof o.everyMinutes === "number" && o.everyMinutes > 0
            ? o.everyMinutes * 60_000
            : null;
        const grace =
          typeof o.graceMinutes === "number" && o.graceMinutes > 0
            ? o.graceMinutes * 60_000
            : 0;
        // Both halves of the allowance come out of the ANSWER. The kits'
        // own 1.5-interval factor is the right rule for a cadence a kit
        // learned by itself, and the wrong one here: Boosthis judges a
        // declared job by the rhythm it stored plus the grace it chose, and
        // a second opinion computed on the phone is the disagreement this
        // whole path exists to remove.
        d.statedEveryMs = every;
        d.statedAllowanceMs = every === null ? null : every + grace;
        continue;
      }
      // Refused, by name and for a stated reason. The declaration stops being
      // outstanding — asking again every half minute would neither change the
      // answer nor stop being wrong — but the job is NOT watched, and the one
      // place that can say so is here.
      d.statedEveryMs = null;
      d.statedAllowanceMs = null;
      sayDeclarationOnce(
        `refused:${typeof o.reason === "string" ? o.reason : "unknown"}`,
        `[boosthis] Boosthis did not keep the rhythm declared for "${o.job}", so that job is NOT being watched` +
          (typeof o.reason === "string" && o.reason ? `: ${o.reason}.` : ".") +
          ` Its runs are still recorded; only lateness goes unjudged.`,
      );
    }
  } catch {
    // Reading an answer must never break an upload.
  }
}

/**
 * How long a job may stay silent before its next run counts as missed, or
 * null when nothing is in force.
 *
 * THE SINGLE PLACE that decides this. Only a rhythm Boosthis confirmed
 * produces a number: this kit never learns a cadence of its own from a phone
 * app's runs — a phone sleeps, and a cadence learned through an OS that
 * defers work for hours would call almost every app late. So there is exactly
 * one answer here, and it is the server's.
 */
export function missedAfterMs(job: string): number | null {
  return declarations.get(job)?.statedAllowanceMs ?? null;
}

/**
 * Declared jobs whose silence has passed the allowance in force.
 *
 * What the kit itself can answer about lateness, for a developer asking on
 * the device. Boosthis derives the same fact from the record it holds, which
 * is the answer that survives the app not running at all; this is the local
 * view of it, and both read the same allowance.
 */
export function overdueDeclaredJobs(nowMs: number = Date.now()): string[] {
  const out: string[] = [];
  for (const job of declarations.keys()) {
    const allowance = missedAfterMs(job);
    if (allowance === null) continue;
    const last = lastRunAt.get(job);
    if (last === undefined) continue;
    if (nowMs - last > allowance) out.push(job);
  }
  return out.sort();
}

/**
 * File one finished run.
 *
 * Never throws and never waits on the network. A run with an unusable name, an
 * impossible duration or an age past the server's ceiling is dropped here
 * rather than taking a batch of good runs down with it on arrival.
 */
export function reportJobRun(run: {
  job: string;
  durationMs: number;
  ok: boolean;
  /** When it finished. Defaults to now. */
  finishedAtMs?: number;
}): void {
  try {
    if (isBoosthisDisabled()) return;
    const job = jobName(run?.job);
    if (!job) return;
    const durationMs = Math.round(run.durationMs);
    if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > MAX_JOB_MS)
      return;
    if (typeof run.ok !== "boolean") return;
    const finishedAtMs =
      typeof run.finishedAtMs === "number" && Number.isFinite(run.finishedAtMs)
        ? run.finishedAtMs
        : Date.now();
    seenJobs.add(job);
    const last = lastRunAt.get(job);
    if (last === undefined || finishedAtMs > last) lastRunAt.set(job, finishedAtMs);
    buffer.push({ job, finishedAtMs, durationMs, ok: run.ok });
    // Oldest first: on a phone the newest runs are the ones a developer is
    // looking at, and an unbounded buffer is a leak in an app that may stay
    // alive for days.
    if (buffer.length > MAX_BUFFERED_JOB_RUNS)
      buffer = buffer.slice(buffer.length - MAX_BUFFERED_JOB_RUNS);
  } catch {
    /* a reporting failure must never surface as an application failure */
  }
}

/** Send whatever is buffered now. Resolves with the number of runs delivered. */
export async function flushJobRunsNow(): Promise<number> {
  const send = submitter;
  const now = Date.now();
  const declared = outstandingDeclarations(now);
  if (!send) return 0;
  // Stands down rather than sending an empty batch: nothing to report is not
  // a message. See docs/decisions/job-liveness-evidence.md — an upload with
  // no runs and nothing to declare would turn the job path into a heartbeat.
  if (buffer.length === 0 && declared.length === 0) return 0;
  const taken = buffer.slice(0, MAX_JOB_RUN_BATCH);
  const runs: JobRunReport[] = [];
  for (const r of taken) {
    const finishedAgoMs = now - r.finishedAtMs;
    // A run that aged past the server's ceiling while it waited is dropped,
    // not clamped: a clamped age would file a week-old run under today.
    if (finishedAgoMs < 0 || finishedAgoMs > MAX_JOB_MS) continue;
    runs.push({
      job: r.job,
      finishedAgoMs,
      durationMs: r.durationMs,
      ok: r.ok,
    });
  }
  // Removed from the buffer BEFORE the send, including the ones that aged
  // out: a batch that fails is a batch lost, and retrying for ever on a phone
  // is how a buffer becomes a leak.
  buffer = buffer.slice(taken.length);
  if (runs.length === 0 && declared.length === 0) return 0;
  try {
    const sent = await send(runs, declared);
    // A declaration is only marked delivered once a send actually succeeded.
    // A failed upload leaves it outstanding so the next flush carries it
    // again — otherwise a rhythm would be stated once, lost to a dropped
    // connection, and never judged.
    if (sent > 0 || runs.length === 0) {
      for (const { job } of declared) {
        const d = declarations.get(job);
        if (d) d.delivered = true;
      }
    }
    return sent;
  } catch {
    return 0;
  }
}

/**
 * The kit's own clock for job reporting.
 *
 * Runs whether or not the app is doing any work. That is the whole point: the
 * process whose declared job has STOPPED reports no runs at all, so anything
 * gated on the app's own work is silent in exactly the case this feature
 * exists for — the declaration would never be delivered, and a correction an
 * owner made on the dashboard would never reach a running app.
 */
export function startJobRunAutoFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setInterval(() => {
    void flushJobRunsNow();
  }, JOB_FLUSH_MS);
  // Never hold a Node test process open. React Native's timers have no
  // unref; the optional call is what makes the same module safe in both.
  (flushTimer as unknown as { unref?: () => void })?.unref?.();
}

export function stopJobRunAutoFlush(): void {
  if (flushTimer === null) return;
  clearInterval(flushTimer);
  flushTimer = null;
}
