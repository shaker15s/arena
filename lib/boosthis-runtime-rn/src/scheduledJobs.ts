/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * BACKGROUND WORK A PHONE APP SCHEDULES — the work that runs when nobody is
 * looking at the screen.
 *
 * WHY THIS EXISTS. Every other reading this kit takes happens while somebody
 * is waiting: a screen, a touch, a call out to an API. A phone app's
 * background work — a sync, a prefetch, an upload that finishes after the app
 * is closed — was invisible, and the scheduled-jobs band on the project page
 * was empty for every React Native project. An empty band reads as "this app
 * has no background work", which for a phone app is almost never true. A job
 * that quietly stops running is one of the commonest ways a working app stops
 * doing its job, and on a phone we could not see one at all.
 *
 * WHAT IS REPORTED, AND NOTHING ELSE. Four facts per run: the job's own name,
 * how long ago it finished, how long it took, and whether it succeeded. There
 * is no field for arguments, payload, result or error detail — not here, not
 * on the wire, and nowhere on the server to put them. The server stores a
 * day's counts per job. A job's contents are the customer's business.
 *
 * TIME IS RELATIVE ON PURPOSE. A run reports an AGE, never a wall-clock time.
 * A phone whose clock is wrong — and a phone that has been asleep for six
 * hours — can therefore never file a run under the wrong day.
 *
 * NOBODY HAS TO DECLARE A JOB. `expo-task-manager` already knows every task
 * the app defined; this module wraps `TaskManager.defineTask` so a task's runs
 * are timed as they happen, and asks `getRegisteredTasksAsync()` what the
 * platform has on file. An app using Expo's own background APIs reports its
 * jobs with no code change at all. `trackJob` is there for work the platform
 * does not own — a Headless JS handler, a sync the app kicks off itself.
 *
 * A RHYTHM IS ALWAYS DELIBERATE. Lateness is judged against a rhythm, and the
 * only rhythm here is one the app STATES through `expectEvery`. Expo's
 * `minimumInterval` is deliberately not read as one: it is a floor the OS may
 * ignore for hours, so treating it as a promise would call almost every iOS
 * app late. See docs/decisions/background-fetch-interval-is-not-a-rhythm.md.
 *
 * THE KIT IS A GUEST, AND THIS ONE RUNS ON A PHONE. Nothing here blocks the
 * interface thread: a wrapped task's own work is awaited by the platform as it
 * always was, the measurement is two clock reads around it, and the upload is
 * the same deferred `fetch` every other reading in this kit rides. A wrapped
 * task re-raises the host's error untouched after recording the failure.
 *
 * THIS FILE IS THE FINDING HALF. What happens to a run once it exists — the
 * buffer, the upload, the declared rhythm and the server's answer to it —
 * lives in `jobReporter.ts`, the one module in this kit that owns the job
 * wire. The reporting API is re-exported here so the rest of the kit, and
 * every app that already imports it, sees no move.
 */

import {
  jobName,
  markJobsDiscovered,
  noteJobSeen,
  reportJobRun,
  stopJobRunAutoFlush,
  _resetJobReporterForTests,
} from "./jobReporter";

export {
  EXPECTATION_REVALIDATE_MS,
  JOB_FLUSH_MS,
  MAX_BUFFERED_JOB_RUNS,
  MAX_JOB_EXPECTATIONS,
  MAX_JOB_MS,
  MAX_JOB_NAME,
  MAX_JOB_NAME_LEN,
  MAX_JOB_RUN_BATCH,
  clearBufferedJobRuns,
  clearJobRhythmDeclarations,
  declareJobRhythm,
  expectEvery,
  flushJobRunsNow,
  jobName,
  missedAfterMs,
  noteJobExpectationOutcomes,
  overdueDeclaredJobs,
  parseExpectationOutcomes,
  pendingJobExpectationCount,
  pendingJobRunCount,
  reportJobRun,
  scheduledJobsFound,
  setJobRunSubmitter,
  startJobRunAutoFlush,
  stopJobRunAutoFlush,
} from "./jobReporter";
export type {
  JobExpectationOutcome,
  JobExpectationReport,
  JobRunReport,
  JobRunSubmitter,
} from "./jobReporter";

/** Reset every piece of session state. Tests only. */
export function _resetScheduledJobsForTests(): void {
  _resetJobReporterForTests();
  stopJobRunAutoFlush();
  uninstallBackgroundTaskTracking();
  taskManagerForTests = null;
}

// ── Expo's own background work, measured without being asked ────────────────

/** The `expo-task-manager` module, or null when the app does not use it. Read
 *  lazily, exactly like every other optional Expo dependency this kit
 *  touches, so a bare React Native app never sees a missing module. */
interface TaskManagerModule {
  defineTask?: (name: string, fn: unknown) => unknown;
  getRegisteredTasksAsync?: () => Promise<unknown>;
}

/**
 * A stand-in module, for tests only.
 *
 * `expo-task-manager` belongs to an Expo APP, not to this package, so under
 * vitest — where `require` is Node's own and resolves from this directory —
 * it genuinely cannot be found. Every behavioural rule below (a task's runs
 * being timed, a failure being re-raised untouched, teardown giving the host
 * its own function back) would otherwise be untestable off a phone, which is
 * the one place nobody can run them by hand. The require SITE itself is held
 * to Metro's resolution by the platform-access census, so this seam cannot
 * hide a module name Metro would fail on.
 */
let taskManagerForTests: TaskManagerModule | null = null;

export function _setTaskManagerForTests(mod: unknown): void {
  taskManagerForTests = (mod as TaskManagerModule | null) ?? null;
}

function taskManager(): TaskManagerModule | null {
  if (taskManagerForTests) return taskManagerForTests;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-task-manager");
    return (mod?.default ?? mod) ?? null;
  } catch {
    return null;
  }
}

/**
 * The function we replaced, so it can be put back EXACTLY as it was.
 *
 * Two references, deliberately. `rawDefineTask` is the host's own function
 * object, which is what teardown writes back: restoring a `.bind()` copy
 * would hand the host a function it never wrote, and anything comparing by
 * identity — including this kit's own next install — would report a wrapper
 * still in place. `callDefineTask` is the bound copy this module actually
 * calls, so `this` is still the module even though the property has moved.
 */
let rawDefineTask: ((name: string, fn: unknown) => unknown) | null = null;
let callDefineTask: ((name: string, fn: unknown) => unknown) | null = null;
let patchedDefineTask: ((name: string, fn: unknown) => unknown) | null = null;

/**
 * Time every Expo task the app defines from now on.
 *
 * `TaskManager.defineTask(name, fn)` is how every Expo background API — a
 * background fetch, a location update, a background task — names the function
 * the OS will call. Wrapping it once catches all of them, with the app
 * changing nothing.
 *
 * The wrapper OWNS THE ATTEMPT and hands the host's own result and errors
 * straight back. It survives a task that returns a value, a task that returns
 * a promise, and a task that throws synchronously.
 *
 * Idempotent: a second call while already installed does nothing, so a kit
 * restarted mid-session never stacks two wrappers on one function.
 */
export function installBackgroundTaskTracking(): void {
  if (rawDefineTask !== null) return;
  const TM = taskManager();
  const define = TM?.defineTask;
  if (typeof define !== "function") return;
  rawDefineTask = define as (name: string, fn: unknown) => unknown;
  callDefineTask = define.bind(TM) as (name: string, fn: unknown) => unknown;
  const original = callDefineTask;
  patchedDefineTask = function boosthisDefineTask(name: string, fn: unknown) {
    const job = jobName(name);
    if (!job || typeof fn !== "function") return original(name, fn);
    noteJobSeen(job);
    const hostTask = fn as (...args: unknown[]) => unknown;
    const wrapped = function boosthisTask(this: unknown, ...args: unknown[]) {
      const startedAt = Date.now();
      let out: unknown;
      try {
        out = hostTask.apply(this, args);
      } catch (err) {
        reportJobRun({ job, durationMs: Date.now() - startedAt, ok: false });
        throw err;
      }
      if (out && typeof (out as Promise<unknown>).then === "function") {
        return (out as Promise<unknown>).then(
          (value) => {
            reportJobRun({
              job,
              durationMs: Date.now() - startedAt,
              ok: true,
            });
            return value;
          },
          (err: unknown) => {
            reportJobRun({
              job,
              durationMs: Date.now() - startedAt,
              ok: false,
            });
            throw err;
          },
        );
      }
      reportJobRun({ job, durationMs: Date.now() - startedAt, ok: true });
      return out;
    };
    return original(name, wrapped);
  };
  try {
    (TM as { defineTask?: unknown }).defineTask = patchedDefineTask;
  } catch {
    // A frozen module is not a reason to fail: leave the host untouched.
    rawDefineTask = null;
    callDefineTask = null;
    patchedDefineTask = null;
  }
}

/**
 * Put `defineTask` back.
 *
 * Restores ONLY when what is currently installed is still ours. Another
 * wrapper layered on top after us owns the slot, and overwriting it would
 * silently uninstall somebody else's instrumentation — interceptions come off
 * last-in-first-out or not at all.
 */
export function uninstallBackgroundTaskTracking(): void {
  const TM = taskManager();
  if (!TM || rawDefineTask === null) {
    rawDefineTask = null;
    callDefineTask = null;
    patchedDefineTask = null;
    return;
  }
  try {
    if ((TM as { defineTask?: unknown }).defineTask === patchedDefineTask)
      (TM as { defineTask?: unknown }).defineTask = rawDefineTask;
  } catch {
    /* nothing to restore onto */
  }
  rawDefineTask = null;
  callDefineTask = null;
  patchedDefineTask = null;
}

/**
 * Ask the platform what background work it already has on file for this app.
 *
 * A task registered by a previous launch is not defined again this launch, so
 * without this a job would stay unknown until the OS happened to run it —
 * which on iOS can be days. Discovery is what lets the kit say "we looked" at
 * all, which is the difference between an app with no background work and an
 * app we cannot see into.
 *
 * Never throws. Resolves false when `expo-task-manager` is not installed, in
 * which case nothing was looked at and nothing is claimed.
 */
export async function discoverBackgroundTasks(): Promise<boolean> {
  const TM = taskManager();
  const list = TM?.getRegisteredTasksAsync;
  if (typeof list !== "function") return false;
  try {
    const tasks = await list.call(TM);
    if (!Array.isArray(tasks)) return false;
    for (const t of tasks) {
      const job = jobName((t as { taskName?: unknown })?.taskName);
      if (job) noteJobSeen(job);
    }
    markJobsDiscovered();
    return true;
  } catch {
    return false;
  }
}
