/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: remote kill-switch / entitlement client ─────────────────
 *
 * Rung 1 of the kit-protection design (suggestions/kit-protection-killswitch.md).
 *
 * The honest ceiling: code shipped inside an app binary can't be made
 * un-editable or self-deleting. So — exactly like RevenueCat / Sentry /
 * Mapbox — the *value* lives on the server and the kit only ever asks "am I
 * still entitled?". When the server says anything other than "active" the kit
 * goes fully INERT: no bubble, no dashboard, no measuring, no telemetry of any
 * kind (samples / candidates / resolutions / crashes / snapshots), no
 * fix/community fetch. The dev's own AI can't undo it because the decision
 * lives on the server, not in these files.
 *
 * Offline policy = GRACE (the owner's choice). The kit caches the last
 * confirmed-"active" answer and keeps working offline for `graceSeconds`
 * (7 days). It dies the moment it (a) learns of a non-active status — that
 * answer is sticky immediately, even across launches — or (b) the grace window
 * lapses with no successful re-check.
 *
 * ACTIVATION LOCK (Rung 0, owner's order): the kit SHIPS LOCKED. A copy that
 * has NEVER completed a successful server handshake (an entitlement check-in,
 * which itself requires invite-key registration) is fully inert — no
 * dashboard, no measuring, no telemetry — and silent (no key ⇒ nothing leaves
 * the process, so the privacy contract is intact). "Activated" is represented
 * by the PRESENCE of a persisted entitlement cache: any valid cached answer
 * (even a revoked one) proves a handshake once completed, so already-
 * registered installs upgrade seamlessly and keep the normal GRACE model.
 * Pre-hydration and a failed/corrupt cache read are treated as LOCKED
 * (fail-closed — a registered, online app unlocks at the immediate launch
 * check-in). `forget()` wipes the cache, so erasure re-locks the kit.
 * A tamperer deleting the cache only LOCKS their copy — strictly worse.
 *
 * CRITICAL invariants:
 *  - `isRuntimeInert()` is SYNCHRONOUS (UI render + perfMonitor hot path call
 *    it). It reads an in-memory flag hydrated asynchronously from cache.
 *  - The check-in itself MUST bypass the inert gate (it is the recovery path —
 *    if it were gated, a revoked install could never learn it was restored).
 *  - The check-in fetch bounds itself with a Promise.race timer, NEVER an
 *    AbortController signal (some RN runtimes throw on `signal`).
 *  - This module imports ONLY perfPlatform / runtimeFlags / no-pii / safe — it
 *    must never import perfMonitor / telemetry / transmit (those import IT), so
 *    there is no import cycle.
 */

import { platform } from "./perfPlatform";
import { isBoosthisDisabled } from "./runtimeFlags";
import { checkNoPII } from "./no-pii";
import { safeAsync } from "./safe";
import { resolveFetch, callFetch } from "./fetch";

/** The wire entitlement states. Mirrors the server's `EntitlementCheckResponse`
 *  status enum. "paused" is the calm variant of the owner's dashboard
 *  Disconnect pause (wire-only — nothing is deleted, Reconnect restores it);
 *  the kit goes inert on it exactly like "revoked". */
export type EntitlementStatus =
  | "active"
  | "revoked"
  | "unpaid"
  | "tampered"
  | "paused";

/** Storage key for the cached last-good answer. Versioned so the shape can
 *  evolve without misreading an old record. */
const CACHE_KEY = "boosthis.entitlement.v1";

/** Default offline grace if the server answer omits one. 7 days — matches the
 *  server's `GRACE_SECONDS`. Only used as a fallback; the server is canonical. */
const DEFAULT_GRACE_SECONDS = 7 * 24 * 60 * 60;

/** Hard ceiling on a cached grace window. The server only ever sends 7 days,
 *  so any larger value is corrupt or tampered (e.g. a cache hand-edited to
 *  10^15 to pin the kit "active" forever offline). Clamp to 30 days so a
 *  tampered grace can never indefinitely defeat the kill-switch. */
const MAX_GRACE_SECONDS = 30 * 24 * 60 * 60;

/** Clock-jitter tolerance for a cache whose `checkedAt` sits in the future.
 *  Small skew (NTP correction) is treated as "just checked"; a larger future
 *  offset means a rolled-back clock or an edited cache, so the active answer is
 *  treated as suspect and we force a fresh check-in (go inert) rather than
 *  letting a future timestamp keep an active cache alive forever. */
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/** How often the periodic check-in runs once started. 6h is plenty given a
 *  7-day grace window, and keeps battery/bandwidth cost negligible. */
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Network timeout for a single check-in. */
const DEFAULT_TIMEOUT_MS = 8000;

interface EntitlementCache {
  status: EntitlementStatus;
  /** ms-epoch when the server confirmed this answer. */
  checkedAt: number;
  graceSeconds: number;
  /** High-water mark: the maximum wall-clock time (ms-epoch) ever OBSERVED for
   *  this active answer. Persisted and monotonically non-decreasing, so a later
   *  clock rollback across a process restart can't shrink the proven elapsed
   *  time. Absent on legacy caches (treated as `checkedAt`). */
  maxSeenWallMs?: number;
}

/* ─── In-memory state (the synchronous source of truth for the gate) ──── */

// Entitlement default: "active" — but the ACTIVATION LOCK below means the kit
// still does nothing until a persisted handshake is found (or one completes).
let memStatus: EntitlementStatus = "active";
let memInert = false;
let memMessage: string | null = null;
let hydrated = false;
let hydrating: Promise<void> | null = null;

/** ACTIVATION LOCK state (tri-state):
 *  - `null`  — pre-hydration: unknown ⇒ treated as LOCKED (fail-closed; the
 *    hydrate is ms-scale so an activated app unlocks almost immediately).
 *  - `false` — hydration found NO valid cache (never handshaken, cache wiped by
 *    `forget()`, or storage unreadable) ⇒ LOCKED until a check-in succeeds.
 *  - `true`  — a completed server handshake was proven (valid persisted cache,
 *    or a live server answer this run) ⇒ the normal entitlement/grace model
 *    governs. Any valid cached answer counts, even a non-active one — a
 *    revoked install is activated-but-killed, and must keep heartbeating so
 *    it can learn it was restored. */
let memActivated: boolean | null = null;

/** Fixed, code-defined notice the dashboard shows while locked. */
const LOCKED_MESSAGE =
  "Boosthis is locked. Connect this app to Boosthis with your project key to activate it.";

/** Coarse, on-device-derived reason the most recent registration attempt did
 *  not activate this install. In-memory ONLY — NEVER persisted and NEVER added
 *  to any outbound payload; it exists purely to let the locked dashboard show a
 *  plain-English hint about WHY the kit is still locked. Set by the consent path
 *  via `recordRegistrationOutcome`; `null` means no failure recorded (or a
 *  registration since succeeded). */
export type RegistrationFailure =
  | "none" // no invite key or install token wired in — nothing to register with
  | "no-key-chosen"
  | "key-revoked"
  | "key-paused"
  | "key-unknown"
  | "key-rejected" // server rejected the invite key (unknown / not accepted)
  // server refused the registration because this app's install id is not a
  // UUID (HTTP 400 + the machine-readable `invalid_install_id` marker). Unlike
  // the key categories this can NEVER fix itself by retrying — the id has to
  // change in the app — so the kit records it and shows it, but never re-knocks
  // on a timer for it.
  | "install-id-rejected"
  // this install id already belongs to another copy of the app and THIS copy
  // holds none of its credentials (the server's 200 + `already_registered_no_token`
  // marker), and self-heal rotation has already run once without clearing it.
  // Filing it as a registration would leave an install that looks connected,
  // uploads nothing, and never explains itself — so it is a failure category.
  | "orphan"
  | "unreachable"; // could not reach the Boosthis server at all

let memRegFailure: RegistrationFailure | null = null;

/** The kit's own KIT-OWNED CLASSIFICATION of the last transport failure, as a
 *  ready-to-append parenthetical (e.g. " (the certificate store rejected the
 *  connection)"). This is NEVER the caught error's raw message — a TLS/proxy/
 *  HTTP-client error string can embed the request URL, a credential-bearing URL
 *  or remote-supplied prose, so it must not reach this log line. It is the
 *  single most useful thing the "stayed inactive" line below can add for the
 *  unreachable case — a broken certificate store or a blocked egress shows up
 *  HERE and nowhere else. In-memory only; never persisted or transmitted. */
let memTransportError: string | null = null;

/** Turn a caught transport error into a KIT-OWNED parenthetical for the "stayed
 *  inactive" line. The error's message and type name are read for MATCHING ONLY
 *  — the message is NEVER emitted, in whole or in part; only a fixed kit phrase
 *  or (as a last resort) the sanitised type/class name is. First match wins.
 *  Guest-safe: never throws, never allocates unboundedly, never makes a network
 *  call; a null/odd error object yields "" (no parenthetical). */
function classifyTransportError(err: unknown): string {
  try {
    // Read message + type/class name, lowercased, for MATCHING ONLY.
    const rawMsg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
    // Cap EACH input before it is copied or case-converted, so a pathological
    // message can never drive unbounded work inside a host's process.
    const msg = String(rawMsg ?? "").slice(0, 512).toLowerCase();
    const typeName =
      err instanceof Error && err.name ? err.name : (err as { name?: unknown })?.name;
    const type = typeof typeName === "string" ? typeName.slice(0, 128).toLowerCase() : "";
    const hay = `${msg} ${type}`;

    const has = (needle: string): boolean => hay.indexOf(needle) !== -1;

    // First match wins; emit a FIXED, kit-owned phrase.
    if (
      has("certificate") ||
      has("tls") ||
      has("ssl") ||
      has("x509") ||
      has("self signed") ||
      has("self-signed") ||
      has("unable to verify") ||
      has("certificate_verify_failed") ||
      has("sslhandshake") ||
      has("trust anchor") ||
      has("unable to get local issuer")
    )
      return " (the certificate store rejected the connection)";
    if (
      has("getaddrinfo") ||
      has("name or service not known") ||
      has("enotfound") ||
      has("unknownhost") ||
      has("nodename nor servname") ||
      has("no such host") ||
      has("failed to resolve") ||
      has("dns")
    )
      return " (the API host name did not resolve)";
    if (has("econnrefused") || has("connection refused"))
      return " (the connection was refused)";
    if (has("etimedout") || has("timeout") || has("timed out"))
      return " (the connection timed out)";
    if (has("proxy")) return " (a proxy rejected the connection)";
    if (
      has("enetunreach") ||
      has("network is unreachable") ||
      has("no route to host")
    )
      return " (the network was unreachable)";

    // No match: emit the error's TYPE/CLASS NAME ONLY (never the message),
    // sanitised by dropping every character outside [A-Za-z0-9_.], truncated to
    // 60 chars. Empty sanitised name ⇒ no parenthetical at all.
    const rawName =
      err instanceof Error && err.name
        ? err.name
        : typeof (err as { name?: unknown })?.name === "string"
          ? (err as { name: string }).name
          : "";
    const safeName = String(rawName ?? "").replace(/[^A-Za-z0-9_.]/g, "").slice(0, 60);
    return safeName ? ` (${safeName})` : "";
  } catch {
    // Guest-safe: a null/odd error object must never throw.
    return "";
  }
}

/** One-shot guard so the "stayed inactive" line prints EXACTLY ONE line per
 *  process — never once per consent retry. Distinct from the invalid-install-id
 *  one-shot in telemetry.ts (that case has its own fixed copy + test), so any
 *  single failure scenario still yields one line total. */
let inactiveWarned = false;

/** Record the kit's own last transport error so the "stayed inactive" line can
 *  name it for the unreachable case. The caught error is CLASSIFIED at record
 *  time into a fixed kit-owned parenthetical — its raw message never survives
 *  this call, so no URL, credential or server prose can reach the log line. A
 *  nullish/odd/unclassifiable error clears it. In-memory only. */
export function recordTransportError(err: unknown): void {
  const detail = classifyTransportError(err);
  memTransportError = detail === "" ? null : detail;
}

/** [why, what to do] for the one-shot "stayed inactive" line. Derived from the
 *  coarse outcome category ONLY — never from server text, the project key, the
 *  endpoint, or the install id. Substance mirrors the sibling kits (Ruby's
 *  registration_failure_hint). */
export function registrationFailureHint(
  failure: RegistrationFailure,
): [string, string] {
  switch (failure) {
    case "orphan":
      return [
        "this install id already belongs to another copy of the app, and this copy holds none of its credentials",
        "Unset BOOSTHIS_INSTALL_ID (or give this copy its own fresh UUID) and restart.",
      ];
    case "unreachable": {
      // The kit's own last recorded transport error is where a broken
      // certificate store or blocked egress actually shows up; without it the
      // developer is left guessing. `memTransportError` is ALREADY a fixed
      // kit-owned parenthetical (classifyTransportError) — never the caught
      // error's raw message — so no URL, key or server prose can leak here.
      const detail = memTransportError ?? "";
      return [
        `it could not reach the Boosthis API from this process${detail}`,
        "Check outbound HTTPS and certificate trust from this app, then restart.",
      ];
    }
    case "key-revoked":
      return [
        "its project key has been revoked",
        "A revoked key never works again. Mint a new project key in your Boosthis dashboard, put it in this app, then relaunch the app.",
      ];
    case "key-paused":
      return [
        "its project key is paused by a billing problem on the account",
        "Settle the account in your Boosthis dashboard and the same key starts working again. Nothing has been revoked.",
      ];
    case "key-unknown":
      return [
        "its project key was not recognised",
        "Check it is the current key, pasted whole, with no stray spaces, and that it belongs to this project.",
      ];
    case "key-rejected":
      return [
        "its project key wasn't accepted",
        "Copy a current project key from your Boosthis dashboard into this app, then relaunch the app.",
      ];
    case "none":
      return [
        "no project key is wired into this app",
        "Without one this app measures itself and never appears on your Boosthis dashboard. Copy a project key from your Boosthis Setup page into this app, then relaunch the app.",
      ];
    case "no-key-chosen":
      return [
        "this app is set to run with no project key",
        "That is a deliberate setting: this app measures itself and never appears on your Boosthis dashboard. Nothing is being sent.",
      ];
    default:
      return [
        "the server refused the registration",
        "Retry later; if it keeps happening, check the project key in your Boosthis dashboard.",
      ];
  }
}

export function getRegistrationRefusalSentence(): string | null {
  try {
    if (memRegFailure === null || memRegFailure === "install-id-rejected") return null;
    const [why, fix] = registrationFailureHint(memRegFailure);
    return `Boosthis stayed inactive because ${why}. ${fix}`;
  } catch {
    return null;
  }
}

export function getRegistrationFailure(): RegistrationFailure | null {
  return memRegFailure;
}

/** EXACTLY ONE line per process when a registration attempt did NOT go through.
 *  Silence is the wrong answer here: a kit that cannot register looks identical
 *  to a healthy one — same silent process, same absent numbers — so the
 *  developer looks in the wrong place for hours. This is the one place the kit
 *  says so out loud.
 *
 *  Deliberately NOT gated on any debug flag: a debug flag only helps someone who
 *  already suspects the kit; this exists for the one who does not. Written to
 *  the runtime's standard error stream via console.warn (RN/Node route it to
 *  stderr) — NOT console.error, which the kit's own swallowed-errors meter
 *  chains and would otherwise count this line as a host error. The whole call
 *  is guarded: a missing/patched console must never break the host app. Carries
 *  no project key, no token, no URL and no server-supplied text. */
function warnStayedInactiveOnce(failure: RegistrationFailure): void {
  if (inactiveWarned) return;
  inactiveWarned = true;
  try {
    const [why, fix] = registrationFailureHint(failure);
    // eslint-disable-next-line no-console
    console.warn(`[boosthis] Boosthis stayed inactive because ${why}. ${fix}`);
  } catch {
    /* a missing/patched console must never break the host app */
  }
}

/** Test-only: reset the one-shot "stayed inactive" guard + transport error so a
 *  suite can assert the line fires once. */
export function _resetInactiveWarningForTests(): void {
  inactiveWarned = false;
  memTransportError = null;
}

/* ─── "Boosthis dropped some of the measurements this app sent" ──────────────
 *
 * WHY THIS LIVES HERE. The upload endpoints answer 202 and then quietly discard
 * individual rows they can't store: a route label the shared privacy guard
 * refuses, a span past the per-trace cap, a snapshot entry whose name is
 * rejected. Until now the kit read that 202 as unqualified success, so a
 * developer whose every route label was being thrown away saw a healthy app, no
 * output, and a dashboard silently missing data. That is the SAME failure the
 * "stayed inactive" line above exists to end — a kit that looks fine while doing
 * nothing useful — so it borrows the same one-shot-per-process, ungated,
 * stderr-via-console.warn, never-throws latch style, kept in this one file.
 *
 * CONTRACT (identical in every kit):
 *  - Read `dropped` + `droppedByCause` from an upload reply. Their ABSENCE
 *    (older server, non-JSON body, unreadable body) means "nothing to report":
 *    no warning, no crash, no guessing.
 *  - Warn EXACTLY ONCE per process per cause, naming the cause and the fix.
 *  - Keep a cumulative count + the causes seen, so the in-app panel can show the
 *    size of the hole in the same words the web page uses.
 *  - Nothing here may ever fail an upload or reach the host's request path.
 *  - Nothing is uploaded. The warning is local output only.
 */

/** Why the server threw a row away. Mirrors the server's `DropCause`; any cause
 *  key this kit does not know is counted in the total and named nowhere — the
 *  kit must never invent an explanation for something it cannot read. */
export type DropCause =
  | "labelRejected"
  | "traceCapReached"
  | "snapshotEntryFiltered";

const DROP_CAUSE_KEYS: readonly DropCause[] = [
  "labelRejected",
  "traceCapReached",
  "snapshotEntryFiltered",
];

/** Short cause text — the same words the project's web page uses, so the in-app
 *  view and the dashboard never tell two different stories. */
const DROP_CAUSE_TEXT: Record<DropCause, string> = {
  labelRejected: "route names the privacy guard refused",
  traceCapReached: "spans past the 20-span limit",
  snapshotEntryFiltered: "snapshot entries the privacy guard refused",
};

/** What the developer changes to stop it. Second sentence of the warning. */
const DROP_CAUSE_FIX: Record<DropCause, string> = {
  labelRejected: "Name routes in code, the way GET /orders is written.",
  traceCapReached:
    "A trace keeps its first 20 spans — measure fewer steps per request, or split a very long trace.",
  snapshotEntryFiltered:
    "Name screens in code, never from what a person typed or an id.",
};

function finiteDropCount(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return 0;
  return Math.floor(v);
}

// Cumulative for the life of the process: it is the size of the hole in the
// dashboard, so a later clean upload does not erase it.
let droppedRows = 0;
const seenDropCauses = new Set<DropCause>();
const warnedDropCauses = new Set<DropCause>();

/** How many rows the server has refused since this process started. */
export function getDroppedRowCount(): number {
  return droppedRows;
}

/** The status/panel figure: `"6 — route names the privacy guard refused; spans
 *  past the 20-span limit"`. Empty string when nothing has been dropped, so a
 *  healthy app (and an older server) shows nothing at all — no row, no heading. */
export function droppedRowsSummary(): string {
  if (droppedRows <= 0) return "";
  const causes = DROP_CAUSE_KEYS.filter((c) => seenDropCauses.has(c)).map(
    (c) => DROP_CAUSE_TEXT[c],
  );
  return causes.length > 0
    ? `${droppedRows} \u2014 ${causes.join("; ")}`
    : String(droppedRows);
}

/** Emit the one-shot line for a cause on the standard error stream, ungated and
 *  never repeated — same reasoning as `warnStayedInactiveOnce`: this exists for
 *  the developer who does not yet suspect the kit, so a debug flag would only
 *  reach the one who already does. console.warn (not console.error, which the
 *  swallowed-errors meter chains). The whole call is guarded — a patched console
 *  must never take the host down. */
function warnDropCauseOnce(cause: DropCause, count: number): void {
  if (warnedDropCauses.has(cause)) return;
  warnedDropCauses.add(cause);
  try {
    // eslint-disable-next-line no-console
    console.warn(
      `[boosthis] Boosthis dropped ${count} of the measurements this app sent: ` +
        `${DROP_CAUSE_TEXT[cause]}. ${DROP_CAUSE_FIX[cause]}`,
    );
  } catch {
    /* a missing/patched console must never break the host app */
  }
}

/**
 * Record what one upload reply said, and warn once per cause. Safe to call with
 * anything — a reply without the fields, a string, null: only a body that
 * actually reports a positive `dropped` changes any state or prints anything.
 * Never throws — telling someone about a dropped row must not break an upload.
 */
export function noteServerDrops(body: unknown): void {
  try {
    if (!body || typeof body !== "object") return;
    const rec = body as Record<string, unknown>;
    const total = finiteDropCount(rec.dropped);
    if (total <= 0) return;
    droppedRows += total;
    const raw = rec.droppedByCause;
    if (raw && typeof raw === "object") {
      const causes = raw as Record<string, unknown>;
      for (const cause of DROP_CAUSE_KEYS) {
        const n = finiteDropCount(causes[cause]);
        if (n <= 0) continue;
        seenDropCauses.add(cause);
        warnDropCauseOnce(cause, n);
      }
    }
  } catch {
    /* a broken reply body must never break an upload */
  }
}

/** Minimal shape of a fetch Response, so this works with any fetch impl or a
 *  test double without referencing DOM types (RN source has no dom lib). */
interface JsonReadable {
  json?: () => Promise<unknown>;
}

/**
 * Read an upload reply's body off the hot path and record what it says.
 * Fire-and-forget: the caller does NOT await it, so a slow or unreadable body
 * can never slow an upload. Reads the body already in hand after the response
 * returned — nothing here touches the host's own request handling.
 */
export async function readDropsFromResponse(res: unknown): Promise<void> {
  try {
    const r = res as JsonReadable | null;
    if (!r || typeof r.json !== "function") return;
    noteServerDrops(await r.json());
  } catch {
    /* no body, not JSON, already consumed — nothing to report, by contract */
  }
}

/** Test-only: forget every drop and every drop warn-once latch, next to the
 *  "stayed inactive" reset above, so a suite can assert the line fires once. */
export function _resetDropReportForTests(): void {
  droppedRows = 0;
  seenDropCauses.clear();
  warnedDropCauses.clear();
}

/** For a cached/confirmed ACTIVE answer: when it was confirmed (ms-epoch) and
 *  its clamped grace window. These let `isRuntimeInert()` lazily expire a
 *  long-running OFFLINE process the moment its grace lapses — without them an
 *  app that booted within grace and then never reconnected could outlive the
 *  7-day window forever. A fresh server "active" answer resets them; any
 *  non-active status clears them (grace is irrelevant — inert is then sticky). */
let memCheckedAt: number | null = null;
let memGraceSeconds: number = DEFAULT_GRACE_SECONDS;

/** Monotonic anchor for grace expiry, so a *wall-clock rollback* can't freeze
 *  the age and keep an offline kit alive past its window. At each active
 *  confirmation we capture the wall-clock age at that instant (`memInitialAgeMs`,
 *  >= 0) plus a monotonic timestamp (`memMonoAt`, from `platform().now()` —
 *  `performance.now()` where available). The effective age is then the MAX of
 *  the wall-clock delta and `memInitialAgeMs + monotonic-elapsed`, so rolling
 *  the device clock backward only ever makes the kit expire SOONER, never later.
 *  `memMonoAt` is in-memory only (never persisted): the monotonic clock resets
 *  each process launch, and the cross-launch age is re-anchored from the
 *  persisted `checkedAt` at hydration. */
let memInitialAgeMs = 0;
let memMonoAt: number | null = null;

/** Persisted high-water mark for grace expiry, so a clock rollback across a
 *  *process restart* can't keep an offline kit alive (the monotonic anchor only
 *  covers a single run; it resets to 0 each launch). `memMaxSeenWall` is the max
 *  wall-clock time (ms-epoch) ever observed for the current active answer. It is
 *  seeded from the persisted `maxSeenWallMs` at hydration and advanced + re-
 *  persisted on every offline check-in, so honest offline usage records the
 *  passage of real time. The effective age folds in `memMaxSeenWall - checkedAt`,
 *  so once the device has WITNESSED enough wall time, rolling the clock back on a
 *  later launch can't undo that. Residual (accepted, attestation deferred): an
 *  app NEVER launched during the grace window then opened once with a forged
 *  clock, and hand-editing the persisted cache JSON, remain unprovable locally —
 *  the kit's real authority is the server, which re-asserts on the next reach. */
let memMaxSeenWall: number | null = null;

/* ─── Check-in configuration (installed by enableTelemetry) ───────────── */

export interface EntitlementCheckinConfig {
  /** API origin + base path, e.g. "https://www.boosthis.com/api". */
  endpoint: string;
  installId: string;
  /** Lazy getter — the token is issued by consent AFTER enableTelemetry runs,
   *  so we read the latest value on every check-in (read OR delete token). */
  getToken: () => string | null;
  /** The kit RUNTIME_VERSION, reported for admin visibility. */
  kitVersion: string;
  /** Tamper-evidence signal (Rung 2), forwarded from the host's
   *  `boosthisConfig.integrity` (written by `boosthis verify .`). Loosely typed
   *  because it originates in untyped JSON; `postCheckin` validates the status
   *  enum and only ever sends `{status, manifestHash}` on the wire. A reported
   *  MISMATCH (or a canonical-hash divergence the server detects) can flip the
   *  install to `tampered`. Absent/null when the dev hasn't run `boosthis verify`. */
  integrity?: { status?: string; manifestHash?: string | null } | null;
  fetchImpl?: typeof fetch;
  intervalMs?: number;
  timeoutMs?: number;
}

let config: EntitlementCheckinConfig | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/** Minimum spacing between FORCED on-open entitlement checks. The dashboard /
 *  bubble opening is a user-driven enforcement edge (VAULT contract), but a
 *  user who opens and closes the UI repeatedly must not hammer the server, so
 *  a forced check runs at most once per this window. The periodic 6h heartbeat
 *  and the unconditional launch check are unaffected — this throttle governs
 *  only the on-open path. */
const FORCE_CHECK_THROTTLE_MS = 60 * 1000;

/** Monotonic timestamp (ms, from `monoNow()`) of the last forced on-open check
 *  we actually dispatched, or null if none this run. In-memory only. */
let lastForcedCheckAt: number | null = null;

/* ─── Change subscription (lets the UI re-render when the gate flips) ──── */

const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* a listener throwing must never break the kit */
    }
  }
}

/**
 * Subscribe to inert-state changes. Returns an unsubscribe function. On first
 * subscription this also kicks a lazy hydrate so a host that renders Boosthis
 * UI without calling enableTelemetry still respects a cached kill from a
 * previous launch. Used by the `useRuntimeInert()` hook.
 */
export function subscribeEntitlement(listener: () => void): () => void {
  listeners.add(listener);
  if (!hydrated) safeAsync("entitlement.hydrate", () => hydrateEntitlement());
  return () => {
    listeners.delete(listener);
  };
}

/* ─── The synchronous gate ────────────────────────────────────────────── */

/**
 * The single combined gate every hot path consults. True ⇒ the kit must do
 * NOTHING. The global env kill-switch always wins; the ACTIVATION LOCK (never
 * handshaken ⇒ locked) comes next; the entitlement state is the server-
 * controlled lever on top of both.
 */
export function isRuntimeInert(): boolean {
  return (
    isBoosthisDisabled() ||
    memActivated !== true ||
    memInert ||
    activeGraceExpired()
  );
}

/** How the kit UI should present the current gate. Distinct from the boolean
 *  `isRuntimeInert()` measuring gate: measuring/uploads are ALWAYS off when
 *  inert, but the owner's UX requirement is that a REVOKED or UNPAID project is
 *  shown as VISIBLY LOCKED (a blocking overlay + a still-visible launcher
 *  bubble that opens straight to it), not silently gone.
 *
 *  - "none"    — not inert (or the env kill-switch, which must stay a SILENT
 *                total off-switch): render normally / render nothing.
 *  - "hidden"  — inert, but the kit must vanish rather than show a lock overlay
 *                (env kill-switch, tampered, grace-expired offline). The
 *                launcher bubble hides. NOT the never-checked-in case.
 *  - "unregistered" — running, but no check-in has ever succeeded. The bubble
 *                DRAWS and opens on the dashboard's own "Not registered yet"
 *                verdict (see docs/kit-bubble-draw-contract.md). Nothing is
 *                measured or uploaded in this state — that gate is `inert`.
 *  - "revoked" — the account owner revoked this project's access. Blocking
 *                overlay; the bubble stays visible and opens straight to it.
 *  - "unpaid"  — the account's subscription is unpaid/frozen. Same visible-lock
 *                treatment with payment-oriented copy.
 *  - "paused"  — the owner paused (reversible) — calm blocking notice; bubble
 *                stays visible so the dev sees WHY the kit stopped. */
export type EntitlementGateKind =
  | "none"
  | "unregistered"
  | "hidden"
  | "revoked"
  | "unpaid"
  | "paused";

/**
 * Classify how the kit UI should present the gate (see `EntitlementGateKind`).
 * SYNCHRONOUS — UI render calls it. The env kill-switch always resolves to
 * "hidden" (it must stay a silent, total off-switch — never a visible overlay).
 */
export function getEntitlementGateKind(): EntitlementGateKind {
  // The global env kill-switch is a silent, total off-switch — never a visible
  // lock overlay. It also outranks a stale server status still in memory.
  if (isBoosthisDisabled()) return "hidden";
  // Not inert ⇒ nothing to gate.
  if (!isRuntimeInert()) return "none";
  // Never handshaken (ACTIVATION LOCK). This is NOT one of the silent states:
  // the bubble draws and opens on the dashboard's own "Not registered yet"
  // verdict, which is the only readable explanation a developer gets when the
  // check-in cannot complete at all. Measuring/uploading stay gated on `inert`.
  if (memActivated !== true) return "unregistered";
  // A confirmed/cached non-active server status drives the visible lock states.
  switch (memStatus) {
    case "revoked":
      return "revoked";
    case "unpaid":
      return "unpaid";
    case "paused":
      return "paused";
    // "active" here means the grace window lapsed offline (activeGraceExpired):
    // there is no server verdict to explain, so vanish rather than assert a
    // reason. "tampered" also hides (no user-facing overlay copy is defined).
    default:
      return "hidden";
  }
}

/**
 * @internal Killed-only variant of the gate: TRUE when the env kill-switch, a
 * non-active server answer, or a lapsed grace window silences the kit — but
 * NOT when the kit is merely LOCKED (never activated). Used ONLY by the
 * consent/registration transmit path via `_safeTransmitInternal`'s internal
 * `allowWhenLocked` flag: registration is the step that LEADS to activation,
 * so gating it on the lock would deadlock every fresh install. A killed
 * install stays silenced here too — only the check-in itself may still phone
 * home (it is the recovery path). Not re-exported from `index.ts`.
 */
export function _isRuntimeKilledInternal(): boolean {
  if (isBoosthisDisabled()) return true;
  // A real server answer — revoked / unpaid / paused / tampered. Sticky, and
  // registration is not a way around it.
  if (memStatus !== "active") return memInert;
  // Inert under an ACTIVE answer can only be a grace window that ran out. That
  // term is the one that can trap an install for good, because registration is
  // the only way back and this gate stands in front of it: an install holding
  // NO credential cannot check in either (the check-in needs the token it has
  // not got), so refusing its registration leaves nothing that could ever
  // clear the state. A lapsed grace therefore silences the install that EARNED
  // it, and no other — which is what the comment above has always claimed.
  if (!(memInert || activeGraceExpired())) return false;
  return hasInstallCredential();
}

/** True once this copy of the kit has proven a completed server handshake
 *  (valid persisted entitlement cache, or a live answer this run). */
export function isActivated(): boolean {
  return memActivated === true;
}

/** Clamp a grace window into a safe band: 0 / NaN / negative ⇒ the 7-day
 *  default; absurdly large (corrupt or tampered) ⇒ the 30-day hard ceiling, so
 *  a poisoned grace can never indefinitely pin the kit alive. */
function clampGrace(graceSeconds: number): number {
  let g = graceSeconds;
  if (!(g > 0)) g = DEFAULT_GRACE_SECONDS;
  if (g > MAX_GRACE_SECONDS) g = MAX_GRACE_SECONDS;
  return g;
}

/** Read a monotonic clock (`performance.now()` where available, else
 *  `Date.now()`), never throwing — the synchronous gate must stay crash-proof. */
function monoNow(): number {
  try {
    return platform().now();
  } catch {
    return Date.now();
  }
}

/** Record the timing for a confirmed/cached ACTIVE answer: its confirmation
 *  instant (ms-epoch), clamped grace window, the wall-clock age at THIS moment,
 *  and a monotonic anchor. Keeping both clocks lets `activeGraceExpired()`
 *  defeat a wall-clock rollback (see the `memMonoAt` note). */
function recordActiveTiming(
  checkedAt: number,
  graceSeconds: number,
  maxSeenWallMs?: number,
): void {
  memCheckedAt = checkedAt;
  memGraceSeconds = clampGrace(graceSeconds);
  memInitialAgeMs = Math.max(0, Date.now() - checkedAt);
  memMonoAt = monoNow();
  // Seed the high-water mark from the persisted value (or `checkedAt` for a
  // fresh/legacy answer). Deliberately NOT raised to `Date.now()` here — the
  // current clock is already captured by the wall-clock delta, and leaving the
  // advance to the offline check-in keeps the persist path the single writer
  // (avoids a hydrate-vs-server-answer write race on the cache record).
  memMaxSeenWall =
    typeof maxSeenWallMs === "number" && maxSeenWallMs > checkedAt
      ? maxSeenWallMs
      : checkedAt;
}

/** Drop the active-grace timing — called whenever the answer is non-active or a
 *  cache is rejected as suspect (grace is then irrelevant; inert is sticky). */
function clearActiveTiming(): void {
  memCheckedAt = null;
  memMonoAt = null;
  memInitialAgeMs = 0;
  memMaxSeenWall = null;
}

/** True iff we are holding an ACTIVE answer whose grace window has now lapsed.
 *  Evaluated lazily on every gate read so a long-running offline process flips
 *  inert the instant the window passes, even with no successful re-check.
 *
 *  The effective age is the MAX of three clocks:
 *    - wall-clock delta `Date.now() - memCheckedAt`,
 *    - monotonic age `memInitialAgeMs + (monoNow() - memMonoAt)` (in-process), and
 *    - high-water age `memMaxSeenWall - memCheckedAt` (across restarts).
 *  Taking the max means rolling the device clock BACKWARD (or holding it) can
 *  only make the kit expire sooner, never later: the monotonic anchor closes the
 *  in-process rollback and the persisted high-water mark closes the rollback-
 *  across-restart bypass. A future `checkedAt` (within the hydrate tolerance)
 *  still reads as "not yet expired" rather than wrapping negative. */
function activeGraceExpired(): boolean {
  if (memStatus !== "active" || memCheckedAt === null) return false;
  const wallAgeMs = Date.now() - memCheckedAt;
  const monoAgeMs =
    memMonoAt === null
      ? Number.NEGATIVE_INFINITY
      : memInitialAgeMs + (monoNow() - memMonoAt);
  const highWaterAgeMs =
    memMaxSeenWall === null
      ? Number.NEGATIVE_INFINITY
      : memMaxSeenWall - memCheckedAt;
  const ageMs = Math.max(wallAgeMs, monoAgeMs, highWaterAgeMs);
  if (ageMs < 0) return false;
  return ageMs > memGraceSeconds * 1000;
}

/** If an active grace window has lapsed while we were unable to reconfirm,
 *  make the inert flip sticky and notify subscribers so the UI re-renders.
 *  Called from the offline branches of the check-in. */
function maybeExpireActiveGrace(): void {
  if (!memInert && activeGraceExpired()) {
    memInert = true;
    notify();
  }
}

/** Advance + re-persist the high-water wall marker for an active answer. Called
 *  from the OFFLINE check-in branches so honest usage records the passage of
 *  real wall time. Only writes when the clock has moved FORWARD past the marker
 *  (a backward/held clock has nothing new to record and must not shrink it), so
 *  a later rollback + restart can't undo proven elapsed time. Awaited but fully
 *  guarded — a storage failure is non-fatal (the in-memory marker already
 *  advanced). No-op for a non-active answer (its inert state is already sticky). */
async function bumpAndPersistMaxSeenWall(): Promise<void> {
  if (memStatus !== "active" || memCheckedAt === null) return;
  const now = Date.now();
  if (memMaxSeenWall !== null && now <= memMaxSeenWall) return;
  memMaxSeenWall = now;
  try {
    const cache: EntitlementCache = {
      status: "active",
      checkedAt: memCheckedAt,
      graceSeconds: memGraceSeconds,
      maxSeenWallMs: memMaxSeenWall,
    };
    await platform().storage.set(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* non-fatal: the in-memory high-water mark already advanced */
  }
}

/** Offline check-in handler: advance the persisted high-water marker (proves
 *  elapsed time across a later clock rollback + restart), then expire a lapsed
 *  grace window. Used by every "couldn't reconfirm" branch of the check-in. */
async function onOfflineCheckin(): Promise<void> {
  await bumpAndPersistMaxSeenWall();
  maybeExpireActiveGrace();
}

/** Last known entitlement status (cached). For the dashboard's inert message. */
export function getEntitlementStatus(): EntitlementStatus {
  return memStatus;
}

/** Human-readable reason for the current non-active status, if any. While the
 *  ACTIVATION LOCK holds (never handshaken), returns the fixed locked notice —
 *  the env kill-switch is deliberately not surfaced here (it must stay a
 *  silent, total off-switch). */
export function getEntitlementMessage(): string | null {
  if (!isBoosthisDisabled() && memActivated !== true && !memInert) {
    return LOCKED_MESSAGE;
  }
  return memMessage;
}

/** Record the coarse outcome of a registration (consent) attempt so the locked
 *  dashboard can hint at WHY the kit isn't active yet. Pass `null` on success to
 *  clear a prior failure. In-memory only; never persisted or transmitted.
 *  Notifies subscribers so a lock screen already on-screen re-renders once the
 *  category is known (it typically resolves a moment after first paint). */
export function recordRegistrationOutcome(
  failure: RegistrationFailure | null,
): void {
  // Any non-null failure category means the kit did not activate — say so once,
  // out loud, so a broken install is not indistinguishable from a healthy one.
  // (`install-id-rejected` has its own fixed line + test in telemetry.ts; it
  // still routes here for the hint state, but its own one-shot owns the print.)
  if (failure !== null && failure !== "install-id-rejected") {
    warnStayedInactiveOnce(failure);
  }
  if (memRegFailure === failure) return;
  memRegFailure = failure;
  notify();
}

/** True when the LAST registration attempt was refused because this app's
 *  install id is not a UUID (HTTP 400 + the `invalid_install_id` marker).
 *
 *  Deliberately UNGATED (unlike `getLockHint()`, which only speaks while the
 *  ACTIVATION LOCK holds): this is a developer-wiring mistake the kit must show
 *  plainly on its account card even if some other state would otherwise make
 *  the card look normal. Returns a boolean only — the UI copy that consumes it
 *  is fixed and code-defined, and no server-provided text ever reaches it. */
export function isInstallIdRejected(): boolean {
  return memRegFailure === "install-id-rejected";
}

/** A short, plain-English hint at the most likely reason the kit is locked, or
 *  null when there's nothing useful to add. Gated EXACTLY like the lock branch
 *  of `getEntitlementMessage` — it only ever appears while the ACTIVATION LOCK
 *  holds (never handshaken), never on a server kill/pause and never under the
 *  env kill-switch. Returns fixed, code-defined strings only: it NEVER echoes
 *  the invite key, endpoint, or any server-provided text. */
export function getLockHint(): string | null {
  if (isBoosthisDisabled() || memActivated === true || memInert) return null;
  switch (memRegFailure) {
    case "key-revoked":
    case "key-paused":
    case "key-unknown":
    case "key-rejected":
    case "no-key-chosen":
      return getRegistrationRefusalSentence();
    case "install-id-rejected":
      return (
        "Registration rejected — install ID must be a UUID. Mint a real UUID " +
        "and restart."
      );
    case "orphan":
      return getRegistrationRefusalSentence();
    case "unreachable":
      return (
        "Couldn't reach Boosthis to activate this app. Check this device's " +
        "internet connection, then relaunch."
      );
    case "none":
      return getRegistrationRefusalSentence();
    default:
      return null;
  }
}

/* ─── Hydration from cache ────────────────────────────────────────────── */

function applyCache(cache: EntitlementCache): void {
  // A valid persisted answer proves a handshake once completed — even a
  // non-active one (an activated-but-killed install must keep heartbeating).
  memActivated = true;
  memStatus = cache.status;
  if (cache.status !== "active") {
    // A non-active answer is sticky immediately, even offline / across launches.
    memInert = true;
    clearActiveTiming();
    return;
  }
  // Cached "active": honour the grace window, defending against a tampered or
  // clock-skewed cache. A future `checkedAt` (clock rollback or hand-edited
  // cache) must NOT extend an active answer indefinitely.
  let checkedAt = cache.checkedAt;
  const ageMs = Date.now() - checkedAt;
  if (ageMs < 0) {
    // checkedAt is in the future. Tolerate small jitter as "just checked";
    // treat a larger future offset as suspect → force a re-check (go inert).
    if (-ageMs <= CLOCK_SKEW_TOLERANCE_MS) {
      checkedAt = Date.now();
    } else {
      memInert = true;
      clearActiveTiming();
      return;
    }
  }
  // Record the (clamped) active timing — incl. the monotonic anchor and the
  // persisted high-water wall marker — so the gate can lazily expire a long-
  // running offline process the instant its grace lapses, even if the wall clock
  // is rolled back within the run OR across a restart.
  recordActiveTiming(checkedAt, cache.graceSeconds, cache.maxSeenWallMs);
  memInert = activeGraceExpired();
}

/**
 * Read the cached last-good answer into the in-memory gate. Idempotent — runs
 * its real work at most once. No valid cache ⇒ the ACTIVATION LOCK stays
 * engaged (fail-closed: never-handshaken copies must not run). Never throws.
 */
export function hydrateEntitlement(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydrating) return hydrating;
  hydrating = (async () => {
    // Until proven otherwise this copy is LOCKED. A valid cache (below) or a
    // later successful check-in flips it.
    let activated = false;
    try {
      const raw = await platform().storage.get(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<EntitlementCache>;
        if (
          parsed &&
          (parsed.status === "active" ||
            parsed.status === "revoked" ||
            parsed.status === "unpaid" ||
            parsed.status === "tampered" ||
            parsed.status === "paused") &&
          typeof parsed.checkedAt === "number"
        ) {
          applyCache({
            status: parsed.status,
            checkedAt: parsed.checkedAt,
            graceSeconds:
              typeof parsed.graceSeconds === "number"
                ? parsed.graceSeconds
                : DEFAULT_GRACE_SECONDS,
            maxSeenWallMs:
              typeof parsed.maxSeenWallMs === "number"
                ? parsed.maxSeenWallMs
                : undefined,
          });
          activated = true;
        }
      }
      // No cache (or corrupt) ⇒ LOCKED. Nothing to apply.
    } catch {
      // Storage unreadable ⇒ LOCKED (fail-closed). A registered, online app
      // still unlocks in-memory at the immediate launch check-in; a
      // never-connected copy stays inert, which is the owner's intent.
    } finally {
      // Never DOWNGRADE: a live server answer may have activated the kit while
      // the (slower) storage read was in flight.
      if (memActivated !== true) memActivated = activated;
      hydrated = true;
      notify();
    }
  })();
  return hydrating;
}

/* ─── The check-in (recovery path — never gated by inert) ──────────────── */

function applyServerAnswer(
  status: EntitlementStatus,
  graceSeconds: number,
  message: string | null,
): void {
  // Compare EFFECTIVE state (incl. lazy grace expiry AND the activation lock),
  // so both a recovery from an expired-active window back to fresh-active and
  // the first-ever unlock still notify the UI.
  const wasInert = isRuntimeInert();
  // Also compare how the gate must be PRESENTED. The first answer a
  // never-confirmed install ever gets can be a non-active one (revoked,
  // unpaid, paused, tampered): that leaves the inert boolean unchanged at
  // true, while the screen goes from "never handshaken, show nothing" to a
  // visible lock. A subscriber told only about the boolean would go on waiting
  // for an answer that has already arrived.
  const wasKind = getEntitlementGateKind();
  // …and whether the handshake itself completed. A first "tampered" answer
  // changes neither the boolean nor the presented kind (both stay hidden and
  // inert), yet it IS the answer this install was waiting for — a subscriber
  // never told would go on waiting for something that already happened.
  const wasActivated = memActivated === true;
  // A live server answer IS a completed handshake — it releases the lock
  // (even a non-active answer: activated-but-killed, keeps heartbeating).
  memActivated = true;
  memStatus = status;
  memMessage = status === "active" ? null : message;
  if (status === "active") {
    // Fresh confirmation — reset the grace clock + monotonic anchor to now.
    recordActiveTiming(Date.now(), graceSeconds);
    memInert = false;
  } else {
    memInert = true;
    clearActiveTiming();
  }
  if (
    !wasActivated ||
    isRuntimeInert() !== wasInert ||
    getEntitlementGateKind() !== wasKind
  ) {
    notify();
  }
}

/** POST the check-in, bounded by a Promise.race timer (NO AbortController). */
async function postCheckin(
  cfg: EntitlementCheckinConfig,
  token: string,
): Promise<Response | null> {
  const f = resolveFetch(cfg.fetchImpl);
  // No usable fetch in this build → return null (no server status to apply),
  // exactly like an offline tick. The check-in must never throw or call
  // undefined() on a transport problem; the caller's normal offline-grace logic
  // (onOfflineCheckin) still decides cached state, so a lapsed active grace can
  // still expire — this is "no server answer applied", NOT "never flips state".
  if (!f) return null;
  const url = `${cfg.endpoint.replace(/\/$/, "")}/entitlements/check`;
  const body: {
    installId: string;
    kitVersion: string;
    integrity?: { status: "ok" | "mismatch"; manifestHash?: string };
  } = { installId: cfg.installId, kitVersion: cfg.kitVersion };
  // Fold in the tamper-evidence block, but only as the exact server schema
  // shape: validate the status enum and forward an opaque manifest hash if one
  // is present (dropping any extra fields the host's config JSON may carry, e.g.
  // kitVersion). An invalid/absent signal is simply omitted (fail-open).
  const integ = cfg.integrity;
  if (integ && (integ.status === "ok" || integ.status === "mismatch")) {
    body.integrity = {
      status: integ.status,
      ...(typeof integ.manifestHash === "string" && integ.manifestHash
        ? { manifestHash: integ.manifestHash }
        : {}),
    };
  }
  // Defence-in-depth: this payload is fully code-defined, but run it through
  // the shared PII guard anyway so the privacy contract holds for every
  // outbound call. A hit means abort the send (never throw).
  if (checkNoPII(body)) return null;
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), timeoutMs),
  );
  const req = callFetch(f, url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  }).catch(() => null);
  return Promise.race([req, timeout]);
}

/**
 * Run ONE check-in using the installed config. Returns the resolved status, or
 * null when the check couldn't complete (no config/token, offline, timeout,
 * non-OK response). A null result deliberately leaves the cached state intact —
 * only an explicit server answer changes it (fail-open / sticky-kill).
 *
 * NOTE: intentionally NOT gated by `isRuntimeInert()` — this is the path by
 * which a revoked install learns it has been restored.
 */
export async function checkEntitlementNow(): Promise<EntitlementStatus | null> {
  // The global env kill-switch silences everything, including phoning home.
  if (isBoosthisDisabled()) return null;
  const cfg = config;
  if (!cfg) return null;
  const token = cfg.getToken();
  if (!token) return null; // not registered yet — the kit stays LOCKED
  // Coverage freshness rides this always-on check-in (launch, the activation
  // chase, every app open, then the heartbeat) rather than an upload: sample
  // and snapshot uploads are off in the default issues-only mode, and what a
  // kit could NOT watch is a fact about the app either way. The hook is
  // change-only and hard-capped inside telemetry; a screen timed or a network
  // call made after launch is what moves it.
  try {
    coverageRefresh?.();
  } catch {
    // a coverage update must never disturb an entitlement check
  }
  try {
    const res = await postCheckin(cfg, token);
    if (!res || !res.ok) {
      if (res?.status === 401) {
        try {
          const refusal = (await res.json()) as {
            error?: unknown;
            detail?: unknown;
            reason?: unknown;
          };
          if (refusal?.error === "credentials_cut") {
            const reason = refusal.reason;
            const status: EntitlementStatus =
              reason === "revoked" ||
              reason === "unpaid" ||
              reason === "tampered" ||
              reason === "paused"
                ? reason
                : "revoked";
            const message =
              typeof refusal.detail === "string" ? refusal.detail : null;
            applyServerAnswer(status, DEFAULT_GRACE_SECONDS, message);
            try {
              const cache: EntitlementCache = {
                status,
                checkedAt: Date.now(),
                graceSeconds: DEFAULT_GRACE_SECONDS,
              };
              await platform().storage.set(CACHE_KEY, JSON.stringify(cache));
            } catch {
              /* cache write failure is non-fatal — in-memory state already applied */
            }
            hydrated = true;
            return status;
          }
        } catch {
          /* unreadable refusal body falls through to offline handling */
        }
      }
      // Unreachable / unauthorized / 429 → keep the cached answer, but advance
      // the high-water marker (records real elapsed time) and, if the active
      // grace window has now lapsed while we couldn't reconfirm, go inert.
      await onOfflineCheckin();
      return null;
    }
    const data = (await res.json()) as {
      status?: string;
      graceSeconds?: number;
      message?: string | null;
    };
    const status = data.status;
    if (
      status !== "active" &&
      status !== "revoked" &&
      status !== "unpaid" &&
      status !== "tampered" &&
      status !== "paused"
    ) {
      return null; // unexpected shape — don't act on it
    }
    const graceSeconds =
      typeof data.graceSeconds === "number"
        ? data.graceSeconds
        : DEFAULT_GRACE_SECONDS;
    applyServerAnswer(status, graceSeconds, data.message ?? null);
    // Persist the authoritative answer as the new last-good cache. A fresh
    // "active" confirmation reseeds the high-water marker to now (the grace clock
    // restarts); non-active answers don't need it (inert is sticky).
    try {
      const now = Date.now();
      const cache: EntitlementCache = {
        status,
        checkedAt: now,
        graceSeconds,
        ...(status === "active" ? { maxSeenWallMs: now } : {}),
      };
      await platform().storage.set(CACHE_KEY, JSON.stringify(cache));
    } catch {
      /* cache write failure is non-fatal — in-memory state already applied */
    }
    hydrated = true;
    return status;
  } catch {
    // Treat an unexpected throw like an offline result: keep the cache, advance
    // the high-water marker, and still let a lapsed active grace expire.
    await onOfflineCheckin();
    return null; // never let a check-in throw into the host
  }
}

/**
 * Trigger a FRESH server entitlement check — the on-open / cold-start
 * enforcement edge of the VAULT contract. Unlike the cached synchronous gate,
 * this always attempts to reconfirm with the server (subject to the throttle
 * below); it does NOT short-circuit on a cache-satisfied "active" answer.
 *
 * Non-blocking: fire-and-forget and fully self-guarded (never throws into the
 * host, no AbortController, the underlying fetch is Promise.race-bounded). The
 * verdict is applied by `checkEntitlementNow()` when it lands, flipping the
 * synchronous gate + notifying subscribers so any open UI re-renders (a
 * dashboard opening right as a revoked verdict arrives is closed/refused by
 * the existing inert semantics — the launcher hides on `isRuntimeInert()`).
 *
 * Offline / unreachable stays UNCHANGED: `checkEntitlementNow()` keeps the
 * cached answer + grace window on a network failure, so a transient outage can
 * never brick a paying app — EXCEPT a sticky revoked/killed answer, which the
 * cache already holds inert across launches.
 *
 * @param force When true (cold start / init), bypass the throttle and always
 *   dispatch. When false/omitted (on-open), dispatch at most once per
 *   `FORCE_CHECK_THROTTLE_MS` so repeated open/close can't hammer the server.
 */
export function forceEntitlementCheck(force = false): void {
  // The global env kill-switch silences everything, including phoning home.
  if (isBoosthisDisabled()) return;
  // No installed check-in config (host renders UI before enableTelemetry) ⇒
  // nothing to ask; a later launch check-in / heartbeat covers it.
  if (!config) return;
  if (!force) {
    const now = monoNow();
    if (
      lastForcedCheckAt !== null &&
      now - lastForcedCheckAt < FORCE_CHECK_THROTTLE_MS
    ) {
      return; // throttled — a forced check ran within the window
    }
    lastForcedCheckAt = now;
  } else {
    // A forced (launch) check resets the throttle window so an on-open check
    // immediately after cold start doesn't fire a redundant second knock.
    lastForcedCheckAt = monoNow();
  }
  safeAsync("entitlement.force", () => checkEntitlementNow());
}

/* ─── Lifecycle (called by enableTelemetry / forget) ──────────────────── */

/**
 * Install the check-in config and start the heartbeat: hydrate the cache, run
 * an immediate check-in, then poll on an interval. Safe to call repeatedly —
 * it replaces any prior config and timer. All async work is fire-and-forget
 * and self-guarded so it can never crash the host.
 */
/* ─── Chasing the FIRST confirmation ──────────────────────────────────── */

/**
 * Delays for the short ladder of extra checks a NEVER-CONFIRMED install runs.
 * Roughly 45 seconds in five knocks, front-loaded.
 *
 * WHY (live customer install, Aug 2026): until the server confirms an install
 * the activation lock keeps the bubble hidden and the kit inert — and the only
 * things that ever asked again were the launch check, the next foreground, and
 * the 6-hourly heartbeat. So a confirmation that was not ready at that first
 * moment left a correct install dark for the whole of a first sitting;
 * measured at 22 minutes on the project that reported it.
 *
 * Deliberately bounded and self-cancelling: it stops the instant the install
 * is confirmed, and a still-unconfirmed install is left to the ordinary edges
 * rather than knocking forever.
 */
const ACTIVATION_CHASE_DELAYS_MS = [1_500, 3_000, 6_000, 12_000, 24_000];

let chaseTimer: ReturnType<typeof setTimeout> | null = null;
let chaseStep = 0;
let chasing = false;

function stopActivationChase(): void {
  if (chaseTimer !== null) {
    try {
      clearTimeout(chaseTimer);
    } catch {
      /* nothing to do */
    }
    chaseTimer = null;
  }
  chaseStep = 0;
  chasing = false;
}

function scheduleActivationChase(): void {
  if (chaseStep >= ACTIVATION_CHASE_DELAYS_MS.length) {
    stopActivationChase();
    return;
  }
  const delay = ACTIVATION_CHASE_DELAYS_MS[chaseStep++];
  try {
    chaseTimer = setTimeout(() => {
      chaseTimer = null;
      if (isBoosthisDisabled() || !config || isActivated()) {
        stopActivationChase();
        return;
      }
      safeAsync("entitlement.chase", async () => {
        await checkEntitlementNow();
        if (isActivated()) stopActivationChase();
        else scheduleActivationChase();
      });
    }, delay);
    // Don't keep a Node/test process alive just to chase a confirmation.
    (chaseTimer as unknown as { unref?: () => void }).unref?.();
  } catch {
    stopActivationChase();
  }
}

/**
 * Ask again, a few times, while this install has never been confirmed.
 *
 * Idempotent and cheap: it does nothing for an install that is already
 * confirmed (every returning app), and a knock made before the credential
 * exists costs no request at all — `checkEntitlementNow()` returns immediately
 * without one, and the ladder simply carries on until registration has minted
 * it.
 */
export function chaseFirstActivation(): void {
  if (isBoosthisDisabled()) return;
  if (!config) return;
  if (chasing) return;
  if (isActivated()) return;
  chasing = true;
  chaseStep = 0;
  scheduleActivationChase();
}

/**
 * Does this install actually hold a credential yet — i.e. did registration
 * succeed?
 *
 * The waiting notice speaks in the first person about being REGISTERED, so it
 * may only speak once that is true. An install whose registration failed or
 * has not answered yet is a different state with its own single line, and two
 * contradictory explanations are worse than one.
 */
export function hasInstallCredential(): boolean {
  if (credentialForTests !== undefined) return credentialForTests !== null;
  if (!config) return false;
  try {
    const token = config.getToken();
    return typeof token === "string" && token !== "";
  } catch {
    return false; // a throwing getter is treated as "no credential"
  }
}

let credentialForTests: string | null | undefined = undefined;

/** @internal test hook — stand in for a registration that has (not) landed. */
export function _setInstallCredentialForTests(
  token: string | null | undefined,
): void {
  credentialForTests = token;
}

export function startEntitlementCheckin(cfg: EntitlementCheckinConfig): void {
  config = cfg;
  stopTimer();
  stopActivationChase();
  // Cold start / init is an unconditional enforcement edge (VAULT contract):
  // hydrate the cache, then run a FRESH check-in regardless of what the cache
  // says (not cache-satisfied). Seed the on-open throttle window so the first
  // user open right after launch doesn't fire a redundant second knock.
  lastForcedCheckAt = monoNow();
  safeAsync("entitlement.start", async () => {
    await hydrateEntitlement();
    await checkEntitlementNow();
  });
  const interval = cfg.intervalMs ?? DEFAULT_INTERVAL_MS;
  timer = setInterval(() => {
    safeAsync("entitlement.tick", () => checkEntitlementNow());
  }, interval);
  // Don't keep a Node/test process alive just for the heartbeat.
  (timer as unknown as { unref?: () => void }).unref?.();
  // A never-confirmed install gets a short ladder of extra knocks on top of
  // the launch check, so the bubble appears seconds after the server is ready
  // rather than at the next foreground or the next heartbeat.
  chaseFirstActivation();
}

function stopTimer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Stop the heartbeat and drop the config. Called from `forget()`. */
export function stopEntitlementCheckin(): void {
  stopTimer();
  stopActivationChase();
  config = null;
  lastForcedCheckAt = null;
  coverageRefresh = null;
}

/* ─── Coverage freshness (always-on) ──────────────────────────────────── */
// This module may never import telemetry (it is the enforcement floor every
// other module leans on), so the refresh arrives as a registered callback.
// It rides the check-in because that is the one path that runs for a
// registered install in EVERY mode — the sample and snapshot uploads are off
// by default, and "what we could not watch" is a fact about the app either
// way. Cleared by forget() along with the rest of the check-in state.
let coverageRefresh: (() => void) | null = null;

/** Register (or clear with null) the telemetry client's change-only coverage
 *  refresh. Bounded and throttled inside the hook itself. */
export function setCoverageRefreshHook(fn: (() => void) | null): void {
  coverageRefresh = fn;
}

/**
 * Erase the persisted entitlement cache and RE-LOCK the kit. Called from
 * `forget()` — erasure must leave nothing Boosthis-shaped behind, and a copy
 * without a proven handshake must not run (the ACTIVATION LOCK re-engages
 * exactly as on a never-connected install). Best-effort, never throws.
 */
export async function clearEntitlementCache(): Promise<void> {
  const wasInert = isRuntimeInert();
  memActivated = false;
  memStatus = "active";
  memInert = false;
  memMessage = null;
  memRegFailure = null; // a stale hint would mislead after forget() re-locks
  clearActiveTiming();
  memGraceSeconds = DEFAULT_GRACE_SECONDS;
  hydrated = true; // the (now empty) state IS the truth — don't rehydrate over it
  hydrating = null;
  try {
    await platform().storage.remove(CACHE_KEY);
  } catch {
    /* storage failure is non-fatal — the in-memory lock is already engaged */
  }
  if (isRuntimeInert() !== wasInert) notify();
}

/* ─── Test helpers ────────────────────────────────────────────────────── */

/** Reset ALL module state to first-run defaults (pre-hydration ⇒ LOCKED). */
export function _resetEntitlementForTests(): void {
  stopTimer();
  stopActivationChase();
  config = null;
  lastForcedCheckAt = null;
  memActivated = null;
  memStatus = "active";
  memInert = false;
  memMessage = null;
  memRegFailure = null;
  memCheckedAt = null;
  memGraceSeconds = DEFAULT_GRACE_SECONDS;
  memInitialAgeMs = 0;
  memMonoAt = null;
  memMaxSeenWall = null;
  memTransportError = null;
  inactiveWarned = false;
  hydrated = false;
  hydrating = null;
  coverageRefresh = null;
  listeners.clear();
}

/** Force the in-memory gate (bypasses cache/network) for assertions. */
export function _setEntitlementStateForTests(
  status: EntitlementStatus,
  inert: boolean,
  message: string | null = null,
): void {
  // Forcing a state implies an activated kit — the lock has its own tests.
  memActivated = true;
  memStatus = status;
  memInert = inert;
  memMessage = message;
  // Clear the grace timing so the forced `inert` boolean is authoritative and
  // `activeGraceExpired()` can't override it in either direction.
  memCheckedAt = null;
  memGraceSeconds = DEFAULT_GRACE_SECONDS;
  memInitialAgeMs = 0;
  memMonoAt = null;
  memMaxSeenWall = null;
  hydrated = true;
  notify();
}
