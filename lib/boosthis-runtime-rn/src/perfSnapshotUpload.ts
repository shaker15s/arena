/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: full perf-snapshot mirror ───────────────────────────────
 *
 * Captures the SAME rich engine state the in-app Boosthis bubble renders
 * (boot ladder + frame meters + per-route rows + per-screen diagnosis) into
 * one bounded, privacy-safe payload and uploads it to the web dashboard so
 * `/app` can mirror the bubble exactly.
 *
 * This is distinct from the production sampler (perfProdSampler.ts), which
 * ships only per-screen ttff/tti/fid time-series. A snapshot is the WHOLE
 * engine state at a moment in time — one row per install on the server,
 * upserted, so storage stays bounded no matter how often a device reports.
 *
 * Privacy: the payload carries only timings, ratings, route/screen labels,
 * diagnosis patterns + Boosthis-authored hint strings — never source code,
 * values, per-event metadata, or user data. Every upload still passes the
 * shared PII guard (assertNoPII) in telemetry.transmitSnapshot before any
 * bytes leave the device. Field names here are deliberately chosen to clear
 * the PII denylist (e.g. `screen` is not denied; no `*name`/`*token` fields).
 */

import { perfMonitor, frameSampler, buildRouteSeries, type FrameStats } from "./perfMonitor";
import { scrollSampler } from "./scrollSampler";
import {
  assertNetworkAutoWrap,
  networkCoverageFields,
} from "./networkAutoWrap";
import { networkSampler } from "./networkSampler";
import { getBootScore, type BootScoreBreakdown } from "./perfBoot";
import type {
  PerfRow,
  ScreenDiagnosis,
  CrossCuttingFinding,
} from "./perfDiagnose";
import { computeMeterAxes, type MeterAxes } from "./meterAxes";
import { readBuildInfo, type BuildInfo } from "./buildIdentity";
import { crashCount, crashWindowMin, crashWindowMs } from "./crashReporter";
import { lifecycleRunWatch } from "./lifecycleAxes";
import { unhandledErrorRunCount } from "./unhandledErrors";
import {
  bankAndMaybePersist,
  bankedWatch,
  registerWatchSampler,
  type RunWatch,
} from "./watchHistory";
import {
  routeListForSnapshot,
} from "./routeInventory";
import {
  controlCensusForSnapshot,
  type ControlCensusReport,
} from "./controlCensus";
import { type RouteListReport } from "./routeInventory";
import { getInteractionStats, getFrustrationStats } from "./hooks/useFidSampler";
import { RUNTIME_VERSION } from "./thresholds";
import { isBoosthisDisabled } from "./runtimeFlags";
import {
  noteTimerArmed,
  noteTimerFired,
  noteWorkPending,
  noteWorkSettled,
  readDeviceFactsBlock,
  DEVICE_FACTS_KEY,
} from "./deviceFacts";
import {
  SNAPSHOT_FLUSH_MS,
  nextSnapshotDelayMs,
} from "./reportingCadence";
export {
  SNAPSHOT_FLUSH_MS,
  nextSnapshotDelayMs,
  FIRST_REPORT_WAIT_TEXT,
} from "./reportingCadence";

/** Caps keep the uploaded payload bounded regardless of session length. The
 *  bubble itself only shows the worst handful of each, so these are generous. */
export const MAX_SNAPSHOT_ROWS = 60;
export const MAX_SNAPSHOT_SCREENS = 30;
export const MAX_SNAPSHOT_CROSSCUTTING = 30;

/**
 * Turbo first-run ramp: the delay until the NEXT perf-snapshot upload, based
 * purely on how long this session/process has been alive. A freshly installed
 * kit fills its dashboard tiles in seconds instead of a full minute by
 * uploading denser early, then relaxing to the steady SNAPSHOT_FLUSH_MS.
 *
 *   age < 30s   -> 10s
 *   age < 90s   -> 20s
 *   age < 180s  -> 40s
 *   otherwise   -> SNAPSHOT_FLUSH_MS (60s)
 *
 * Stateless and age-driven ON PURPOSE: a skipped/empty upload (hasData()===
 * false) must NOT burn a ramp step, so the delay is derived from wall-clock
 * session age rather than an upload counter. At most 4 uploads land in the
 * first 70s (0s, +10s, +20s, +40s → 70s), well under the server's 60 ingest
 * req/min budget. This changes ONLY how soon existing data reaches the server;
 * it touches no honesty gate — count-based gates simply clear sooner because
 * sampling density is unchanged but reporting is denser early.
 */
/**
 * The bounded, privacy-safe mirror of the in-app bubble. Mirrors the shape
 * the EnginePanel builds from perfMonitor.getReport() + getBootScore() +
 * frameSampler.getStats(). The server stores this verbatim as jsonb and the
 * web dashboard renders it with the same 4-tier colour scale.
 */
export interface SnapshotPayload {
  /** Date.now() at capture time. */
  capturedAt: number;
  /** Runtime version that produced the snapshot (lockstep with thresholds). */

  runtimeVersion: string;
  /** Platform name (ios | android | web) — same source the report uses. */

  platform: string;
  /** Session start (Date.now()) — lets the web show session age. */

  startedAt: number;
  /** Total perf events observed this session. */

  totalEvents: number;
  /** Boot ladder + composite boot score. */

  boot: BootScoreBreakdown;
  /** Rolling JS frame-timing window (jank meters). */

  frame: FrameStats;
  /** Per-route aggregate rows (capped, worst-first as computed). */

  rows: PerfRow[];
  /** Per-screen diagnosis ladders (capped, slowest-first). */

  screens: ScreenDiagnosis[];
  /** Cross-cutting findings (slow press/nav/api, novel detectors; capped). */

  crossCutting: CrossCuttingFinding[];
  /** One-line headline summary from the diagnoser. */

  summary: string;
  /** Cold/warm/hot launch classification at report time, if known. */

  bootKind: "cold" | "warm" | "hot" | "unknown" | null;
  /** Additive on-device meter axes (Smoothness, Responsiveness/INP, Stability,
   *  Scroll, Frustration, Idle efficiency, Network reliability, On-Budget %,
   *  Confidence) computed by the SHARED computeMeterAxes helper — the same one
   *  the in-app dashboard uses — and uploaded so the web mirror (/app + /admin)
   *  and the drop-in kit can DISPLAY them without recomputing (no react-native
   *  on the server, zero drift). These never feed the shared speed composite. */

  axes: MeterAxes;
  /** Build identity (Patch Lag meter source) — the running build's commit SHA
   *  and/or build time, wired via the telemetry init options (e.g. from
   *  expo-constants / EAS metadata). Included ONLY when a component is known;
   *  OMITTED entirely on the honest-absence path (never fabricated). Additive:
   *  it never touches the Speed composite; the server ages it into the patchLag
   *  axis the web mirror renders. */

  build?: BuildInfo;
  /** What this PHONE PLATFORM allows, as observed — never what the OS says
   *  about itself. A closed, yes/no set plus the raw OS and version the
   *  server derives a band from. Pooled per platform on arrival, so nothing
   *  here is about this app, this device or its owner. Omitted entirely when
   *  there is nothing observed to say. See deviceFacts.ts. */

  [DEVICE_FACTS_KEY]?: Record<string, number | string>;
  /** The app's WHOLE screen list, as the navigator's own configuration
   *  describes it — so the map can draw screens nobody has opened, marked
   *  "not seen". Always present in a kit that has the feature, including
   *  when the answer is "no configuration was handed over" (`unsupported`)
   *  or "switched off" (`off`). Absence means a kit too old to know the
   *  question, which the map words as "nothing yet" — never a claim that the
   *  app has no other screens. */

  routeList?: RouteListReport;
  /**
   * Who asked for this reading. Set to `"on-demand"` ONLY by {@link readNow},
   * and omitted by every other path — the timer's uploads are what an absent
   * field has always meant.
   *
   * It is a fact about WHO ASKED, not about what was measured: pressing the
   * button in an app somebody has been using produces a reading with a real
   * window behind it and is marked on-demand all the same. The server pairs
   * this with `totalEvents` to decide whether a reading covers any usage.
   */

  readingTrigger?: ReadingTrigger;
  /** What this kit can say about the CONTROLS on a screen. Always present in
   *  a kit that has the feature; its answer today is `no-identity` — this
   *  kit sees that a control was pressed and not which one. Absence means a
   *  kit too old to know the question, which is a different fact. See
   *  `controlCensus.ts`. */

  controlCensus?: ControlCensusReport;
}

/**
 * The one value that says a developer ASKED for this reading rather than the
 * timer taking it. Named so the build guard can check the declaration in
 * lib/on-demand-reading-coverage.json against this kit's own bytes in both
 * directions — see docs/on-demand-reading-contract.md.
 */
export const READING_TRIGGER_ON_DEMAND = "on-demand" as const;

/** Who asked for this reading. Absent means the same as `"scheduled"`. */
export type ReadingTrigger = "on-demand" | "scheduled";

/**
 * What THIS RUN has watched and counted, gathered from the four sensors that
 * hold it: the frame sampler, the lifecycle listener, the error hook and the
 * crash reporter.
 *
 * This is the one place that can see all four, which is why the ledger asks
 * for the reading rather than importing them — `watchHistory.ts` has to stay
 * a leaf, under its users rather than among them.
 *
 * Live values only. Every reader that consumes the ledger ADDS the bank to
 * what it can see itself, so banking a pooled figure would compound it once
 * per write.
 */
function currentRunWatch(): RunWatch {
  const frame = frameSampler.getStats();
  const lifecycle = lifecycleRunWatch();
  // A collector that never attached reports nothing, and nothing banks as
  // zero — an unwatched run's silence is not evidence of a clean one.
  const errors = unhandledErrorRunCount();
  return {
    foregroundMs: lifecycle.foregroundMs,
    observedMs: lifecycle.observedMs,
    frameActiveMs: typeof frame.activeMs === "number" ? frame.activeMs : 0,
    crashWatchMs: crashWindowMs(),
    hangs: typeof frame.hangCount === "number" ? frame.hangCount : 0,
    frozenFrames:
      typeof frame.frozenFrameCount === "number" ? frame.frozenFrameCount : 0,
    unhandledErrors: errors ?? 0,
    crashes: crashCount(),
    dimensionChanges: lifecycle.dimensionChanges,
    appearanceChanges: lifecycle.appearanceChanges,
  };
}

// Hand the ledger its reader as soon as this module is loaded, which is
// before any snapshot is taken and before the app can reach the background —
// the transition an app may never come back from, and the one that has to
// flush what this run watched.
registerWatchSampler(currentRunWatch);

/**
 * Build the snapshot from the SAME sources the in-app bubble uses. Pure
 * read — does not mutate any engine state. Caps every unbounded array.
 */
export async function capturePerfSnapshot(): Promise<SnapshotPayload> {
  const report = await perfMonitor.getReport();
  const frame = frameSampler.getStats();
  const scroll = scrollSampler.getStats();
  // Re-assert the optional transport wrappers before reading their counts.
  // A host shim installed after us would otherwise have switched automatic
  // reporting off for the rest of the session, silently: this is the cadence
  // the kit already runs, and re-asserting here costs two identity checks
  // when nothing has moved. A no-op for an app that refused.
  assertNetworkAutoWrap();
  // Coverage travels only where we HAVE a coverage claim. A zero is read as
  // positive evidence that nobody wired this axis up; a refusal travels as
  // itself. The only reading with no claim to make is one from a kit that
  // never started, where the host may be reporting attempts by hand.
  const network = { ...networkSampler.getStats(), ...networkCoverageFields() };
  // Label-free per-screen mount series for the Baseline anomaly axis — only
  // ordered durations leave buildRouteSeries(), never the route key.
  const routeSeries = buildRouteSeries(await perfMonitor.getEvents());
  // Single wall-clock anchor so the top-level build age and the patchLag axis
  // age are measured against the SAME instant (no drift within one snapshot).
  const now = Date.now();
  // Build identity for the Patch Lag meter, aged against `now`. null (→ the
  // field is omitted below) on the honest-absence path when nothing is known.
  const build = readBuildInfo(now);
  // What this phone platform was observed to allow. Pure read of counters the
  // lifecycle listener and this loop already maintain — no native call, no
  // I/O, nothing that could touch the interface thread.
  const deviceFacts = readDeviceFactsBlock();
  const routeList = routeListForSnapshot();
  const controlCensus = controlCensusForSnapshot();
  // Bank what this run has watched before reading the total back, so a
  // snapshot taken an hour into a session is not competing with a ledger
  // entry written in its first minute. Writes are throttled inside; a
  // backgrounding flushes immediately on its own.
  bankAndMaybePersist(currentRunWatch(), now);
  // Read the ledger ONCE for the whole snapshot, so all seven rate axes
  // answer from the same banked window rather than seven slightly different
  // ones. See docs/decisions/rate-window-earned-across-sessions.md.
  const banked = bankedWatch(now);
  return {
    capturedAt: now,
    runtimeVersion: RUNTIME_VERSION,
    platform: report.platform,
    startedAt: report.startedAt,
    totalEvents: report.totalEvents,
    boot: getBootScore(),
    frame,
    rows: report.rows.slice(0, MAX_SNAPSHOT_ROWS),
    screens: report.diagnosis.screens.slice(0, MAX_SNAPSHOT_SCREENS),
    crossCutting: report.diagnosis.crossCutting.slice(
      0,
      MAX_SNAPSHOT_CROSSCUTTING,
    ),
    summary: report.diagnosis.summary,
    bootKind: report.diagnosis.bootKind ?? null,
    // Computed from the FULL diagnosis (before the per-screen cap above) and the
    // same frame + interaction sources the in-app panel reads, so the uploaded
    // axes match the dashboard exactly. Confidence keys off min-mounts across
    // ALL scorable screens, which the cap would otherwise distort.
    axes: computeMeterAxes(
      report.diagnosis,
      frame,
      getInteractionStats(),
      scroll,
      getFrustrationStats(),
      network,
      routeSeries,
      // crashFree (universal): crashes captured this session + minutes observed
      // since the crash hook was installed. Numbers only — no crash detail
      // reaches the axis. timerHealth reads its own module state internally.
      { crashes: crashCount(), windowMin: crashWindowMin() },
      // Same wall-clock anchor as the top-level build object so the patchLag
      // axis age matches build.buildAgeMs exactly within one snapshot.
      now,
      // What earlier runs of this app on this device banked. Read once above
      // so every rate axis in this snapshot answers from the same window.
      banked,
    ),
    // Only-if-present: omit the whole `build` object on the honest-absence path
    // (readBuildInfo returned null), never a fabricated stamp.
    ...(build ? { build } : {}),
    // Same rule for the platform-facts block: a block with a platform and no
    // observed fact is not an observation, and sending one would have the
    // record dating an answer it does not hold.
    ...(deviceFacts ? { [DEVICE_FACTS_KEY]: deviceFacts } : {}),
    // The screen list is read HERE, when a snapshot asks — never at start-up —
    // so handing the kit a navigator costs the app nothing, never delays the
    // first screen, and a navigator that mounts late still answers.
    ...(routeList ? { routeList } : {}),
    // The control census says, in the same words on the same wire as the
    // browser kit, what this runtime can see of a screen's controls. Today
    // that is nothing, and saying so is the point — an absent block would
    // read as a kit too old to have been asked.
    ...(controlCensus ? { controlCensus } : {}),
  };
}

/** Don't upload an empty snapshot — keeps the web from showing a blank row
 *  for an app that hasn't recorded anything yet. */
function hasData(s: SnapshotPayload): boolean {
  return (
    s.totalEvents > 0 ||
    s.rows.length > 0 ||
    s.boot.rating !== "insufficient-data"
  );
}

export type SnapshotSubmitter = (payload: SnapshotPayload) => Promise<number>;

let submitter: SnapshotSubmitter | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let active = false;
let inFlight = false;
/** Wall-clock anchor for the turbo ramp — set when the loop starts, so each
 *  scheduled delay is derived from real session age (see nextSnapshotDelayMs).
 *  Stateless w.r.t. uploads: a skipped/empty tick cannot burn a ramp step. */
let loopStartedAt = 0;

/** Wired by enableTelemetry() so the runtime owns the upload transport. */
export function setSnapshotSubmitter(fn: SnapshotSubmitter | null): void {
  submitter = fn;
}

async function tick(): Promise<number> {
  if (!submitter || isBoosthisDisabled() || inFlight) return 0;
  inFlight = true;
  // This upload is happening anyway. Watching whether the platform lets it
  // FINISH once the app is backgrounded is the whole of the "does pending
  // work run?" observation — nothing is started, delayed or retried to
  // answer it. See deviceFacts.ts.
  const work = noteWorkPending();
  noteTimerFired();
  try {
    const snap = await capturePerfSnapshot();
    if (!hasData(snap)) return 0;
    return await submitter(snap);
  } catch {
    return 0;
  } finally {
    noteWorkSettled(work);
    inFlight = false;
  }
}

/** Capture + upload one snapshot right now (e.g. on app background, or from
 *  a dev panel "sync now" button). No-op when telemetry isn't wired. */
export function uploadPerfSnapshotNow(): Promise<number> {
  return tick();
}

/** What a read-now attempt did, in a shape a developer can print. Closed set
 *  of outcomes — a caller learns something whichever way it went. */
export interface ReadNowResult {
  /** Did a reading reach Boosthis? */
  sent: boolean;
  /** Why not, when it did not. One of a closed set, never free prose:
   *  `not-started` (the kit was never switched on, sharing is off, or the kill
   *  switch is set), `already-reading` (one is in flight), `refused` (the
   *  server did not take it), `failed` (the upload threw). Null when sent. */
  reason: "not-started" | "already-reading" | "refused" | "failed" | null;
  /** How many perf events this reading had behind it. 0 is the normal answer
   *  for a freshly installed kit and is exactly why the reading is marked. */
  measuredRequests: number;
}

/**
 * TAKE A READING NOW, from an app nobody has used yet.
 *
 * The ordinary snapshot, captured the ordinary way, stamped as asked-for and
 * handed to the SAME submitter the timer uses. Nothing is measured differently
 * and nothing is invented.
 *
 * A phone app has always launched and always rendered by the time anyone can
 * ask, so the boot ladder, the frame window, the device facts and the build
 * are genuine readings from the first second. What needs a person tapping
 * things — the interaction meters, per-screen timings — is simply absent,
 * which is how every Boosthis surface already words it.
 *
 * The one thing it does that the timer does not is skip {@link hasData}. That
 * gate exists so a quiet app does not pay for a content-free tick every
 * interval; it is precisely wrong for the one upload a developer asked for.
 *
 * Never throws. See docs/on-demand-reading-contract.md.
 */
export async function readNow(): Promise<ReadNowResult> {
  if (!submitter || isBoosthisDisabled()) {
    return { sent: false, reason: "not-started", measuredRequests: 0 };
  }
  if (inFlight) {
    return { sent: false, reason: "already-reading", measuredRequests: 0 };
  }
  inFlight = true;
  // Same observation the ordinary tick makes: this upload is happening
  // anyway, and whether the platform lets it FINISH is the whole of the
  // "does pending work run?" reading. Nothing extra is started to answer it.
  const work = noteWorkPending();
  let measuredRequests = 0;
  try {
    const snap: SnapshotPayload = {
      ...(await capturePerfSnapshot()),
      readingTrigger: READING_TRIGGER_ON_DEMAND,
    };
    measuredRequests = snap.totalEvents;
    const shipped = await submitter(snap);
    return shipped > 0
      ? { sent: true, reason: null, measuredRequests }
      : { sent: false, reason: "refused", measuredRequests };
  } catch {
    return { sent: false, reason: "failed", measuredRequests };
  } finally {
    noteWorkSettled(work);
    inFlight = false;
  }
}

/** Start the periodic capture+upload loop. Idempotent. */
export function startSnapshotAutoUpload(): void {
  if (active) return;
  active = true;
  // Ship one snapshot IMMEDIATELY so a freshly-allowed mirror — e.g. the instant
  // a developer connects an AI (server `shareMeterWithAI` directive) or sets the
  // explicit `shareMeterWithAI` opt-in — lands on the dashboard within seconds
  // instead of waiting a full SNAPSHOT_FLUSH_MS interval. Before this, a short
  // session right after connecting an AI could close before the first tick ever
  // fired, leaving nothing on the server for the AI to read. tick() is
  // self-guarding (no-ops without a submitter, when disabled, or while another
  // upload is in flight) and hasData() still skips an empty snapshot, so the
  // periodic loop below stays the backstop and no spurious empty row is created.
  void tick();
  loopStartedAt = Date.now();
  const loop = (): void => {
    if (!active) return;
    // Turbo ramp: schedule the NEXT tick by session age, then settle to the
    // steady SNAPSHOT_FLUSH_MS once the ramp window has elapsed. The delay is
    // derived from wall-clock age (not an upload count), so a skipped/empty
    // tick can't burn a ramp step. Every existing guard inside tick() (empty-
    // snapshot skip, in-flight guard, kill-switch/disabled check) is untouched.
    const delay = nextSnapshotDelayMs(Date.now() - loopStartedAt);
    // Tell the platform-facts sensor when this ALREADY-scheduled tick is
    // due, so a tick that was due mid-background and never arrived can be
    // told apart from one that was never armed.
    noteTimerArmed(Date.now() + delay);
    timer = setTimeout(() => {
      void tick().finally(() => {
        if (active) loop();
      });
    }, delay);
  };
  loop();
}

/** Stop the periodic loop and drop the submitter reference's schedule. */
export function stopSnapshotAutoUpload(): void {
  active = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** Introspection for tests. */
export const _snapshotInternals = {
  hasData,
  isAutoRunning: () => active,
  flushMs: () => SNAPSHOT_FLUSH_MS,
  /** The turbo ramp step for a given session age — lets tests assert the
   *  scheduler reverts to the steady interval after the turbo window. */
  nextDelayMs: nextSnapshotDelayMs,
  /** True when a submitter is installed. uploadPerfSnapshotNow() calls the
   *  submitter directly, so a non-null submitter in plain issues-only mode is a
   *  privacy leak — this lets tests assert the submitter is cleared. */
  hasSubmitter: () => submitter !== null,
};
