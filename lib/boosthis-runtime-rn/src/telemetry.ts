/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/** Opt-in telemetry client. Default: OFF.
 *
 * Preserves the v0.2.1 public API surface — `enableTelemetry(opts)`
 * returns a `TelemetryClient` that the host app owns and persists
 * (install_id + delete_token) via the supplied callbacks.
 *
 * Mirrors `lib/boosthis-py/boosthis/telemetry.py` in semantics: lazy
 * consent retry on first transmit if the initial consent failed.
 */

import { assertNoPII, checkNoPII, routeLabelHasPII, transmitLabelHasPII } from "./no-pii";
import {
  MAX_PART_NAME,
  safeScreenName,
  warnPartNameRefusal,
} from "./routeInventory";
// The screen map's SENDING boundary — labels and pairs of labels, nothing
// else, and only when the host opted in. `pageMap.ts` (the recorder) is not
// imported here on purpose: this file can only reach what that module is
// willing to hand out for the wire.
import { buildPageMapWire } from "./pageMapWire";
import {
  _safeTransmitInternal,
  noteUploadRejected,
  noteUploadResponse,
  type SafeTransmitOptions,
} from "./transmit";
export {
  noteUploadAccepted,
  noteUploadRejected,
  getLastUploadFailure,
  getDroppedUploadCount,
  isLastUploadAttemptFailed,
  _resetUploadFailureForTests,
  type UploadFailReason,
} from "./transmit";
import {
  resolveFetch,
  callFetch,
  setAbortSignalOptIn,
  NO_FETCH_MESSAGE,
} from "./fetch";
import { RUNTIME_VERSION } from "./thresholds";
import {
  collectorsReached,
  coverageFingerprint,
  coverageInventory,
  coveragePayload,
} from "./coverageInventory";
import { detectAppName, platform } from "./perfPlatform";
import { appVersionPayload, resolveAppVersion } from "./appVersionFacts";
import {
  setJobRunSubmitter,
  startJobRunAutoFlush,
  stopJobRunAutoFlush,
  installBackgroundTaskTracking,
  uninstallBackgroundTaskTracking,
  discoverBackgroundTasks,
  clearBufferedJobRuns,
  clearJobRhythmDeclarations,
  noteJobExpectationOutcomes,
  parseExpectationOutcomes,
  type JobRunReport,
  type JobExpectationReport,
} from "./scheduledJobs";
import { consentIdentity } from "./installIdentity";
import { getDailyReachTag, clearReachTag } from "./reachTag";
import { armWatchHistory, clearWatchHistory } from "./watchHistory";
import { isBoosthisDisabled } from "./runtimeFlags";
import {
  describeProjectKeySource,
  resolveProjectKeyDetailed,
  type ResolvedProjectKey,
} from "./projectKey";
import { watchFirstActivation } from "./activationNotice";
import {
  announceKitStart,
  beginStartAnnouncement,
  flushHeldRefusals,
  type BadgeState,
} from "./startAnnounce";
import { resolveBubbleVisibility } from "./bubbleVisibility";
import {
  getKitProject,
  parseKitProject,
  serializeKitProject,
  setKitProject,
} from "./projectIdentity";
import {
  isRuntimeInert,
  isActivated,
  chaseFirstActivation,
  checkEntitlementNow,
  clearEntitlementCache,
  setCoverageRefreshHook,
  startEntitlementCheckin,
  stopEntitlementCheckin,
  recordRegistrationOutcome,
  recordTransportError,
  readDropsFromResponse,
  noteServerDrops,
  _isRuntimeKilledInternal,
} from "./killSwitch";
import { safeAsync, safeRun } from "./safe";
import { announceUnreadableHermesSources } from "./hermesAxes";
import {
  checkRegistrationOnce,
  markRegistrationConfirmed,
  markRegistrationRefused,
  markRegistrationUnreachable,
} from "./registration";
import {
  clearAllCandidates,
  setCandidateSubmitter,
  setResolutionSubmitter,
} from "./candidateRules";
import { setProdSamplerConsent, type SampleMetadata } from "./perfProdSampler";
import { getBootKind, type BootKind } from "./perfBoot";
import { getDeviceTier, setDeviceTier, type DeviceTier } from "./deviceTier";
import {
  setSnapshotSubmitter,
  startSnapshotAutoUpload,
  stopSnapshotAutoUpload,
  type SnapshotPayload,
} from "./perfSnapshotUpload";
import {
  setSpanSubmitter,
  startSpanAutoFlush,
  stopSpanAutoFlush,
  clearBufferedSpans,
  MAX_SPAN_BATCH,
  type TraceSpan,
} from "./spanEmitter";
import {
  setCrashSubmitter,
  installCrashHandlers,
  uninstallCrashHandlers,
  type CrashReportPayload,
} from "./crashReporter";
import {
  installTimerTracking,
  uninstallTimerTracking,
} from "./timerHealth";
import {
  installFrameSampling,
  uninstallFrameSampling,
} from "./perfMonitor";
import {
  installMemoryWarningTracking,
  uninstallMemoryWarningTracking,
} from "./memoryWarnings";
import {
  installBridgeTracking,
  uninstallBridgeTracking,
} from "./bridgeTraffic";
import {
  installSwallowedErrorTracking,
  uninstallSwallowedErrorTracking,
} from "./swallowedErrors";
import {
  installLiveConnections,
  uninstallLiveConnections,
} from "./liveConnections";
import {
  installImageWeightTracking,
  refuseImageWeightTracking,
  uninstallImageWeightTracking,
  resetImageWeight,
} from "./imageWeight";
import {
  installMountCensus,
  uninstallMountCensus,
  resetMountCensus,
} from "./mountCensus";
import { resetReRenders } from "./reRenders";
import { resetNavDeadTime } from "./navDeadTime";
import {
  installNetworkAutoWrap,
  refuseNetworkAutoWrap,
  resetNetworkAutoWrap,
  type NetworkAutoWrapOptions,
} from "./networkAutoWrap";
import {
  enableScreenCircuit,
  disableScreenCircuit,
  setScreenCircuitSuppressed,
  _screenCircuitInternals,
  type ScreenCircuitOptions,
} from "./screenCircuit";
import { resetJsStartup } from "./jsStartup";
import {
  installLifecycleTracking,
  uninstallLifecycleTracking,
} from "./lifecycleAxes";
import {
  installUnhandledErrorTracking,
  refuseUnhandledErrorTracking,
  uninstallUnhandledErrorTracking,
  installPromiseRejectionTracking,
  refusePromiseRejectionTracking,
  uninstallPromiseRejectionTracking,
} from "./unhandledErrors";
import { resetHermesSamples } from "./hermesAxes";
import {
  installStorageTracking,
  uninstallStorageTracking,
} from "./storageLatency";
import { setBuildIdentity, clearBuildIdentity } from "./buildIdentity";
import {
  installAiCallWatch,
  setAiCallOwnEndpoint,
  uninstallAiCallWatch,
} from "./aiCalls";
import { setDeclaredAiEndpoints } from "./aiProviders";
import { clearBackgroundWork } from "./backgroundWork";
import { clearUpstreamCache } from "./upstreamCache";

export const DEFAULT_TELEMETRY_ENDPOINT = "https://www.boosthis.com/api";

/** One-shot guard so a registration refused for a non-UUID install id prints
 *  exactly ONE console line per process — never once per consent retry. The
 *  message below is FIXED and code-defined: it never echoes the install id,
 *  the endpoint, or any server-provided text (only the coarse
 *  `invalid_install_id` marker read off the body decides that we warn at all). */
let warnedInstallIdRejected = false;

/** Emit the one-time non-UUID-install-id warning. Fixed copy only; never
 *  throws (console is host-provided and may be patched/absent in a release
 *  bundle, so the whole call is guarded). */
function warnInstallIdRejectedOnce(): void {
  if (warnedInstallIdRejected) return;
  warnedInstallIdRejected = true;
  try {
    // eslint-disable-next-line no-console
    console.warn(
      "[boosthis] Registration rejected: this app's Boosthis install ID is " +
        "not a valid UUID. Generate a real UUID (e.g. uuidgen / " +
        "crypto.randomUUID()), persist it as the install ID, then restart.",
    );
  } catch {
    /* a missing/patched console must never break the host app */
  }
}

/** Test-only: reset the one-shot invalid-install-id warning guard. */
export function _resetInstallIdWarningForTests(): void {
  warnedInstallIdRejected = false;
}

/**
 * Resolve the `/api` base the runtime talks to, the way RevenueCat/Sentry/PostHog
 * do it: the production host is BAKED INTO the kit, and a host-supplied override is
 * honored ONLY when it is a real absolute http(s) URL. A blank, whitespace,
 * relative, or otherwise malformed `endpoint` (the classic "EXPO_PUBLIC_API_URL
 * placeholder" footgun that silently shipped a dead host into a release build and
 * produced "Couldn't reach Boosthis") can NEVER override the default — it falls
 * back to {@link DEFAULT_TELEMETRY_ENDPOINT}. Trailing slashes are trimmed so the
 * `${endpoint}/installs/consent` joins stay clean. Self-hosters pass a valid
 * absolute URL and it is used verbatim.
 */
export function resolveTelemetryEndpoint(raw: string | undefined): string {
  if (typeof raw !== "string") return DEFAULT_TELEMETRY_ENDPOINT;
  const trimmed = raw.trim();
  // Anchored, dependency-free parse (RN/Hermes `URL` is unreliable; a real login
  // must never depend on a polyfill). Require an absolute http(s) URL whose
  // authority carries NO query (`?`), fragment (`#`), whitespace, or slash, and
  // an optional query/fragment-free path. `new URL()` is intentionally avoided so
  // a broken runtime URL cannot wrongly reject a valid self-host endpoint.
  const m = /^(https?):\/\/([^/?#\s]+)(\/[^?#\s]*)?$/i.exec(trimmed);
  if (!m) return DEFAULT_TELEMETRY_ENDPOINT;
  const authority = m[2];
  // Reject embedded credentials (`https://user:pass@host`): the endpoint URL is
  // logged as a non-sensitive diagnostic, so it must never carry a secret.
  if (authority.includes("@")) return DEFAULT_TELEMETRY_ENDPOINT;
  // Legacy-host migration: the production host was renamed from
  // `boosten.replit.app` (now DEAD/404) to `www.boosthis.com`. An app or
  // self-host still pointing at the old name is rewritten so it reaches the live
  // server instead of failing with "Couldn't reach Boosthis".
  const host = /^boosten\.replit\.app$/i.test(authority)
    ? "www.boosthis.com"
    : authority;
  const path = (m[3] ?? "").replace(/\/+$/, "");
  return `${m[1].toLowerCase()}://${host}${path}`;
}

/** Longest display name the server stores (matches the `.max(60)` on the
 *  consent schema). We clamp client-side so a long auto-detected name is
 *  trimmed rather than rejected outright at ingest. */
const APP_NAME_MAX = 60;

/**
 * Decide the display name sent on consent, newest-friction-first:
 *   1. An explicit `opts.appName` the developer passed — used verbatim (only
 *      clamped), because they chose it on purpose.
 *   2. Otherwise a best-effort auto-detected name (Expo config / native app
 *      name) so the dashboard shows "Rival" instead of a churny install id with
 *      NO developer wiring at all.
 *   3. Otherwise `undefined` (the dashboard falls back to the id).
 *
 * The AUTO path is deliberately defensive: it clamps to {@link APP_NAME_MAX}
 * and DROPS the name entirely if it would trip the PII guard, so auto-detection
 * can never turn a working registration into a rejected one. An explicit name is
 * only clamped (the developer owns that value; the transmit guard still screens
 * it downstream exactly as before).
 */
export function resolveAppName(explicit: string | undefined): string | undefined {
  if (typeof explicit === "string" && explicit.trim()) {
    return explicit.trim().slice(0, APP_NAME_MAX);
  }
  let auto: string | undefined;
  try {
    auto = detectAppName();
  } catch {
    auto = undefined;
  }
  if (!auto) return undefined;
  const clamped = auto.slice(0, APP_NAME_MAX);
  // Drop rather than send anything the guard would reject — a tripping name
  // would fail the whole consent call, which must never happen just because we
  // tried to be helpful about the name.
  return checkNoPII({ appName: clamped }) === null ? clamped : undefined;
}

export interface TelemetryOptions {
  installId: string;
  endpoint?: string;
  packageVersion?: string;
  /** Optional friendly display name for this app, sent on consent so you can
   *  tell your installs apart in your own Boosthis dashboard (installIds churn
   *  per build; a stable name does not). Developer-authored metadata — never
   *  put a user's name, email, or any PII here; the server screens the value
   *  with the same best-effort PII guard as every other field and shows it only
   *  to you. Capped at 60 chars. Omit it and the dashboard just shows the id. */
  appName?: string;
  /** YOUR APP'S OWN VERSION — not this kit's, which travels separately as
   *  `packageVersion` and is never mixed with it.
   *
   *  YOU ALMOST CERTAINLY DO NOT NEED TO SET THIS. The kit reads the version
   *  out of the build on its own: `CFBundleShortVersionString` on iOS,
   *  `versionName` on Android, falling back to your app config's `version`.
   *  Shipping a new build is all it takes for Boosthis to record a release and
   *  compare it against the one before, with nothing declared.
   *
   *  Set it only when the build does not know the answer — an over-the-air
   *  JavaScript bundle shipped ahead of its binary is the real case. A version
   *  you state here is recorded as DECLARED and a version we read is recorded
   *  as READ FROM THE BUILD; the two are separate sources on every surface and
   *  never presented as each other.
   *
   *  Up to 60 characters of letters, digits, dot, dash, underscore and plus,
   *  starting alphanumeric. Anything else is dropped, and the build-read
   *  version is used instead. */
  appVersion?: string;
  /** Model hosts this app calls directly: hostnames or full URLs, merged with
   * BOOSTHIS_AI_ENDPOINTS (and Expo's public-prefixed equivalent), maximum
   * eight. Addresses stay on-device; snapshots carry only a fixed provider
   * code and aggregate numbers. */
  aiEndpoints?: string | readonly string[];
  fetchOptions?: SafeTransmitOptions;
  /** Previously-issued bearer token (e.g. restored from AsyncStorage on app
   *  launch). When absent the client will call /installs/consent to get one. */
  deleteToken?: string;
  /** Callback fired the first time the server issues a delete token, so the
   *  host app can persist it for the next launch. */
  onTokenIssued?: (token: string) => void;
  /** Previously-issued SELF-scoped read token (restored from storage on app
   *  launch). The server returns a read token only on the FIRST consent for an
   *  install (and a one-time backfill for pre-read-token installs); idempotent
   *  re-consent never re-returns it, so the host app must persist it via
   *  `onReadTokenIssued` and pass it back here to keep the dashboard's
   *  "Connect your AI" card populated across launches. */
  readToken?: string;
  /** Callback fired the first time the server issues a read token, so the host
   *  app can persist it for the next launch (parity with `onTokenIssued`). */
  onReadTokenIssued?: (token: string) => void;
  /** Project key issued from the account dashboard, authorizing this install
   *  to register. Sent as `Authorization: Bearer <inviteKey>` on the
   *  /installs/consent call. Registration is rejected without a valid key. */
  inviteKey?: string;
  /** Issues-only mode. When true, the client auto-submits privacy-safe
   *  rule-candidate signatures (no screen names, no values) but NEVER ships
   *  per-screen perf samples: `transmit()` becomes a no-op and the production
   *  sampler is never granted consent. Use this to honor an "issues only,
   *  no screen names" data contract. */
  issuesOnly?: boolean;
  /** OPT-IN per app, layered on top of `issuesOnly`. When true, the
   *  privacy-filtered perf SNAPSHOT (the full meter page the in-app dashboard
   *  shows — boot ladder, every axis/dial, per-route rows, per-screen
   *  diagnosis, summary) is uploaded EVEN in issues-only mode, so the
   *  developer's OWN AI (via the read-token-scoped "Connect your AI" flow /
   *  hosted MCP) can read it and suggest fixes while the app stays otherwise
   *  private. This does NOT turn on the raw per-route sampler firehose — that
   *  stays governed by `issuesOnly`; only the already-PII-filtered snapshot
   *  mirror is enabled. Defaults to false. The snapshot still passes the same
   *  `routeLabelHasPII` filter + `assertNoPII` guard before transmit, so only
   *  code-defined screen labels (never user PII, values, or source) leave the
   *  device. Has no effect in full mode (the snapshot already uploads). */
  shareMeterWithAI?: boolean;
  /** Explicit opt-in to send this app's SCREEN MAP — the screens the kit has
   *  seen opened, and the paths between them — alongside the snapshot it
   *  already uploads. Default false: nothing about navigation leaves the
   *  device unless you turn this on.
   *
   *  It carries screen LABELS ONLY: the same normalized screen labels already
   *  on every row and span, plus pairs of them with counts. There is no field
   *  on the wire for a control, a tap, a gesture or a coordinate, and no
   *  option adds one (see `pageMapWire.ts`).
   *
   *  It rides the snapshot's gates exactly — consent, kill-switch,
   *  entitlement and issues-only all apply, so in issues-only mode this sends
   *  nothing unless `shareMeterWithAI` is also on. */
  sendPageMap?: boolean;
  /** ON BY DEFAULT. The kit reports this app's network attempts by itself —
   *  wrapping `fetch` and `XMLHttpRequest` — so the Network axis measures an
   *  ordinary app without the developer writing a single call.
   *
   *  Pass `false` to refuse it. Nothing of this app's is then wrapped, and the
   *  Network reading SAYS it is switched off in this build rather than
   *  claiming to be warming up. `recordNetworkAttempt` /
   *  `measureNetworkAttempt` keep working for an app that refuses the wrapper
   *  and would rather report its own calls.
   *
   *  It reports EXACTLY what the manual API reports and nothing else: a
   *  duration and a coarse outcome bucket. There is no field anywhere in this
   *  path for a URL, host, path, header, body or status code, and the wrapper
   *  never reads one — the privacy contract of `recordNetworkAttempt` is
   *  unchanged, and `recordNetworkAttempt` / `measureNetworkAttempt` keep
   *  working exactly as before. A call you time yourself with
   *  `measureNetworkAttempt` is counted once: the wrapper stands down for the
   *  length of your window. `recordNetworkAttempt` is NOT de-duplicated — it
   *  arrives after the fact as a duration and an outcome word, which cannot
   *  say whether they belong to a call the wrapper just timed — so keep it
   *  for transports the kit cannot reach.
   *
   *  Pass `true` for the defaults, or `{ stallMs }` to have a completed call
   *  that took at least that long reported as a near-hang instead of a clean
   *  completion. */
  autoWrapNetwork?: boolean | NetworkAutoWrapOptions;
  /** OFF BY DEFAULT, and off for every install that does not ask.
   *
   *  Draws this app's CIRCUIT: each screen the app moves to becomes a node,
   *  moving between two screens becomes an edge, and every request made while
   *  a screen is on screen becomes an edge out of it. No `traceFetch` at any
   *  call site, and no navigator to hand over — the kit uses the screen-change
   *  signal it already raises and the transports it already wraps.
   *
   *  This reads more than the Network axis does, deliberately and only while
   *  it is on: a screen's route NAME, and each call's method and redacted
   *  path — the same label `traceFetch` has always produced. Never a query
   *  string, never a host, never a body, never a screen's params. The Network
   *  axis itself is unchanged and stays blind. The boundary is written down in
   *  `docs/decisions/rn-screen-circuit-boundary.md`.
   *
   *  `propagateTo` names the hosts that may receive the trace headers. Name
   *  none and none are written: a phone has no private network, so there is no
   *  safe default to inherit and a third-party host never sees a header.
   *
   *      traceScreens: { propagateTo: ["api.example.com"] }
   */
  traceScreens?: boolean | ScreenCircuitOptions;
  /** ON BY DEFAULT. Chains RN's `ErrorUtils` global handler to COUNT (never
   *  suppress) unhandled JavaScript errors, and attaches a passive
   *  'unhandledrejection' listener where the host exposes one.
   *
   *  The host's previous handler is ALWAYS called with the original `isFatal`
   *  flag, so RN's red-box / fatal behaviour and the app's own crash reporter
   *  are untouched; a count is the only thing observed, never the error, its
   *  message or its stack.
   *
   *  Pass `false` to refuse it. Nothing is chained, the app's handler is left
   *  exactly as it was, and the Unhandled-errors and Promise-rejections
   *  readings SAY they are switched off in this build. */
  trackUnhandledErrors?: boolean;
  /** ON BY DEFAULT. Measures image overfetch — how much bigger a decoded image
   *  is than the box it is painted in — by intercepting `React.createElement`
   *  and the automatic JSX runtime for RN `<Image>` elements, chaining
   *  `onLoad` and `onLayout`.
   *
   *  Every wrapper delegates byte-identically to the app's own handlers and
   *  returns their exact value; four numbers per image are read and nothing
   *  about the image itself.
   *
   *  Pass `false` to refuse it. Nothing is intercepted and the Image Weight
   *  reading SAYS it is switched off in this build. `recordImage()` keeps
   *  working for an app that would rather report the sizes itself. */
  trackImageWeight?: boolean;
  /** Coarse, privacy-safe device capability bucket (e.g. derived from
   *  expo-device's `deviceYearClass`). Attached to every perf sample as
   *  metadata so the maintainer can segment perf by tier. Defaults to
   *  "unknown" — Boosthis never guesses a tier from screen size. */
  deviceTier?: DeviceTier;
  /** OPT-IN per app. When true, the privacy-safe crash reporter additionally
   *  captures a PII-scrubbed first message line (`summary`) and sanitized stack
   *  `frames` (function + file BASENAME + line/col) for each crash. Defaults to
   *  false: crash reporting is still ALWAYS-ON for a registered app, but in the
   *  default mode each crash carries only the error type, a hashed signature, a
   *  redacted top frame, and a bucketed count — never source, values, or PII. */
  crashDetails?: boolean;
  /** Tamper-evidence signal (Rung 2). The host wires this from
   *  `boosthisConfig.integrity`, which `boosthis verify .` writes after rehashing
   *  the shipped kit manifest. It is forwarded on the entitlement check-in so a
   *  reported MISMATCH (or a canonical-hash divergence the server detects) can
   *  flip the install to `tampered`. Never PII — only a status enum and an opaque
   *  manifest hash. Absent when the developer hasn't run `boosthis verify`. */
  integrity?: { status: "ok" | "mismatch"; manifestHash?: string | null } | null;
  /** Build TIME of the running bundle, epoch ms (e.g. from expo-constants /
   *  EAS build metadata). Powers the additive "Patch Lag" meter, which reports
   *  how OLD this build is — its exposure window — and NOTHING more (it never
   *  implies the app is patched/safe). Must be a finite PAST epoch-ms value;
   *  a non-finite or future value is dropped. When omitted there is no build
   *  object and no patchLag axis — honest absence. Never feeds the Speed score. */
  buildTimeMs?: number;
  /** Commit SHA of the running bundle (short 7 or full 40 lowercase hex, e.g.
   *  from expo-constants / EAS metadata). Developer-authored, never PII: it must
   *  be a 7–40 char hex SHA (lowercased); anything else is dropped. Optional
   *  context for the build object; a commit alone does NOT emit the patchLag
   *  axis (the age needs `buildTimeMs`). */
  buildCommit?: string;
}

/**
 * Closed set of privacy-safe metadata keys. Any key outside this type is
 * stripped by `filterMetadata` before it reaches the wire — callers cannot
 * sneak PII through arbitrary metadata fields. Mirrors the OpenAPI
 * `SampleMetadata` schema (which is also closed with `additionalProperties: false`).
 */
export interface ClosedSampleMetadata {
  startType?: "cold" | "warm" | "hot" | "unknown";
  deviceTier?: DeviceTier;
}

export interface TelemetrySample {
  routeLabel: string;
  durationMs: number;
  rating: "good" | "needs-work" | "poor";
  ruleId?: string;
  /** Closed enum bucket — only `startType` and `deviceTier` are accepted.
   *  Any other keys are stripped before transmit; values not in the known
   *  enum set are coerced to "unknown" so host-provided strings can never
   *  carry PII off device. */
  metadata?: SampleMetadata | null;
}

/** Privacy-safe rule-candidate signature, auto-submitted by the
 *  runtime when telemetry is on. Shape must match the OpenAPI
 *  `CandidateSignature` schema. NEVER carries screen names or values. */
export interface CandidateSignaturePayload {
  signature: string;
  kind: string;
  severityBucket: "low" | "med" | "high";
  countBucket: string;
  occurrences: number;
}

/** Privacy-safe fix-resolution signal, auto-submitted by the runtime
 *  when a rule's severity improves on-device (a fix was applied). Shape
 *  must match the OpenAPI `Resolution` schema. NEVER carries code, diffs,
 *  screen names, or values — only the rule kind + before→after rating. */
export interface ResolutionPayload {
  ruleId: string;
  kind: string;
  beforeRating: "good" | "needs-work" | "poor";
  afterRating: "good" | "needs-work" | "poor";
  occurrences: number;
  // Privacy-safe "circumstances" the fix was proven under (bucketed severity +
  // bucketed count). Optional — older servers ignore them; the community rule
  // book uses them to weight a proven fix toward similar pages. No raw values.
  severityBucket?: "low" | "med" | "high";
  countBucket?: string;
}

export interface TelemetryClient {
  readonly installId: string;
  readonly endpoint: string;
  readonly enabled: boolean;
  /** True when this client only ships privacy-safe issue/fix signals (no
   *  per-screen samples). The dev-only MCP read-access card is hidden in this
   *  mode because the live-data endpoints have no per-screen samples to read. */
  readonly issuesOnly: boolean;
  readonly deleteToken: string | null;
  /** SELF-scoped read token for this install, or null until consent has issued
   *  one (or it was restored via `opts.readToken`). The dev-only dashboard
   *  "Connect your AI" card surfaces this so a developer can let their own AI
   *  read this app's live bubble over the hosted MCP. It can ONLY read this
   *  install's own data — it cannot forget or ingest. */
  readonly readToken: string | null;
  /** The fetch implementation this client uses for ALL its network calls —
   *  `opts.fetchOptions.fetchImpl` if the host configured one, else undefined
   *  (meaning the global `fetch`). The in-app account card reads this so its
   *  sign-in / link calls go through the EXACT same transport as the telemetry
   *  consent call. This matters because consent provably reaches the server on
   *  devices where a sign-in using the bare global `fetch` does not: if the host
   *  wired a custom fetch adapter for telemetry, auth must use it too, or it
   *  silently fails on-device. */
  readonly fetchImpl?: typeof fetch;
  /** WHICH project key this app reports under, where that key came from, and a
   *  masked tail (never the key itself) — so the in-app panel can answer "why
   *  is my new key empty?" on the device instead of leaving the developer to
   *  guess. See projectKey.ts. */
  readonly projectKey: ResolvedProjectKey;
  /** The EFFECTIVE full-telemetry mode right now: code config (`issuesOnly:
   *  false`) OR the dashboard "Full telemetry" directive learned from consent.
   *  The in-app account card reads this so its telemetry toggle can fall back
   *  to the kit's current mode when the claim response omits `fullTelemetry`
   *  (older servers, or a re-claim that doesn't re-echo it). */
  readonly fullTelemetryEffective: boolean;
  /** Whether ANYTHING that feeds the web dashboard is being uploaded right now:
   *  effective full mode, OR — only while the server has not answered OFF —
   *  the explicit `shareMeterWithAI` opt-in or the server "connect your AI"
   *  directive. An explicit dashboard OFF vetoes both of those. When this is
   *  false on a REGISTERED
   *  install, the app runs, renders live local meters, and uploads nothing — so
   *  the dashboard it is supposed to feed stays empty and nothing says so. The
   *  in-app account card reads this to show the "Nothing is being uploaded"
   *  notice (F3). Mirrors the same gate `transmitSnapshot` rides. */
  readonly dashboardSharingActive: boolean;
  /** True when the server directive said sharing OFF and the kit applied it in
   *  memory but could NOT confirm it durable (the write failed even after a
   *  retry). The session stays closed regardless, but the OFF may not survive
   *  a relaunch — the in-app account card surfaces this so the developer knows
   *  the kit could not persist their OFF, rather than the failure being
   *  swallowed. See .agents/memory/phone-kit-sharing-posture.md. */
  readonly sharingOffNotDurable: boolean;
  /** Apply the dashboard "Full telemetry" directive IN-SESSION — the SAME
   *  code path postConsent() runs when the consent response carries
   *  `fullTelemetry`. The account card calls this after its own successful
   *  toggle POST so the new mode takes effect immediately (no relaunch): ON
   *  forces full mode for the session (raw sampler + snapshot mirror); OFF
   *  reverts to the code-configured mode. Never overrides
   *  disable()/forget()/BOOSTHIS_DISABLED — those always win. Resolves when the
   *  directive's DURABLE write has settled (an OFF that could not be persisted
   *  latches `sharingOffNotDurable`); the in-memory directive applies before
   *  the promise is created, so callers that do not care may ignore it. */
  applyServerFullTelemetry(on: boolean): Promise<void>;
  consent(): Promise<number>;
  transmit(samples: readonly TelemetrySample[]): Promise<number>;
  /** Auto-submit recurring perf signatures. The runtime calls this on
   *  its own from `candidateRules.ingestFindings` whenever a new
   *  signature crosses the local recurrence threshold. The host app
   *  never has to invoke it manually. */
  transmitCandidates(
    signatures: readonly CandidateSignaturePayload[],
  ): Promise<number>;
  /** Auto-submit fix-resolution signals. The runtime calls this on its
   *  own from `candidateRules.ingestFindings` whenever a previously-seen
   *  rule's severity improves. The host app never invokes it manually. */
  transmitResolutions(
    resolutions: readonly ResolutionPayload[],
  ): Promise<number>;
  /** Upload ONE full perf-engine snapshot — the whole state the in-app
   *  bubble renders — so the web dashboard can mirror it. It carries screen
   *  labels, so it uploads only when the snapshot mirror is allowed: full mode,
   *  OR issues-only with the explicit `shareMeterWithAI` opt-in OR the server
   *  directive (set once the developer connects an AI from the web dashboard) —
   *  and never once the dashboard "Full telemetry" answer is OFF, which vetoes
   *  both opt-ins. Plain issues-only mode with neither, and disabled state, are
   *  a no-op. The
   *  runtime calls this on a flush cadence via the snapshot auto-uploader; the
   *  host never invokes it manually. */
  transmitSnapshot(snapshot: SnapshotPayload): Promise<number>;
  /** Auto-submit privacy-safe crash reports. The runtime calls this on its own
   *  from the crash reporter when the host app throws an uncaught error, an
   *  unhandled rejection, or a Boosthis-internal render error. Like
   *  `transmitCandidates`/`transmitResolutions` it is ALWAYS-ON for a registered
   *  app (NOT gated by enable/disable or issues-only) — only `BOOSTHIS_DISABLED`
   *  and `forget()` stop it. The host app never invokes it manually. */
  transmitCrashes(crashes: readonly CrashReportPayload[]): Promise<number>;
  /** Auto-submit privacy-safe full-stack trace spans (one root span per
   *  outbound `traceFetch` call). Like the snapshot mirror they carry
   *  code-defined route labels, so they ride the SAME gate: off by default,
   *  on in full mode or once the developer connects an AI, and off again the
   *  moment the dashboard answers OFF. The runtime calls
   *  this on a flush cadence via the span auto-flusher; the host never invokes
   *  it manually. */
  transmitSpans(spans: readonly TraceSpan[]): Promise<number>;
  /** Auto-submit finished runs of this app's BACKGROUND WORK, and any rhythm
   *  the app stated in its own code. Like crashes, this is ALWAYS-ON for a
   *  registered app: a job's name is written in source, the four facts per run
   *  carry nothing of what the job did, and a job that stops running is
   *  exactly what an owner needs told whatever else is switched off. Only
   *  `BOOSTHIS_DISABLED` and `forget()` stop it. The runtime calls this on a
   *  flush cadence; the host never invokes it manually. */
  transmitJobRuns(
    runs: readonly JobRunReport[],
    expectations: readonly JobExpectationReport[],
  ): Promise<number>;
  disable(): void;
  enable(): void;
  forget(): Promise<number>;
}

/** The most recently enabled telemetry client, if any. Lets dev-only UI (the
 *  kit dashboard's MCP read-access card) surface the install id + read token so
 *  the developer can wire their MCP server, without the host app threading the
 *  client through props. Null until enableTelemetry() runs. */
let activeTelemetryClient: TelemetryClient | null = null;

/** Returns the most recently enabled telemetry client, or null if telemetry was
 *  never enabled. Used by the in-app dashboard to show MCP read credentials. */
export function getActiveTelemetryClient(): TelemetryClient | null {
  return activeTelemetryClient;
}

/** Whether THIS app asked for its screen map to be uploaded (`sendPageMap`).
 *  False until enableTelemetry() runs, and false for every app that never
 *  asked — the default. Read by the on-device panel so its sentence about
 *  where the map goes follows the switch instead of being typed once; it is
 *  the host's request, not a promise that an upload happened (consent, the
 *  kill switch, entitlement and issues-only all still decide that). */
let pageMapSendRequested = false;
/** Kick the "is this install on file?" probe using whatever identity this app
 *  is currently holding. Called by the in-app dashboard so the verdict it
 *  renders is the SERVER's answer rather than a guess from the credential this
 *  launch happens to hold. Fire-and-forget, self-throttled to once every 30s
 *  while the answer is still missing, and never throws into the host app. */
export function askRegistration(): void {
  try {
    const client = activeTelemetryClient;
    void checkRegistrationOnce({
      endpoint: client?.endpoint ?? null,
      installId: client?.installId ?? null,
      projectKey: client?.projectKey?.key ?? null,
      fetchImpl: client?.fetchImpl,
    });
  } catch {
    /* a probe must never destabilize a render */
  }
}

/**
 * Apply the dashboard "Full telemetry" directive to the active telemetry client
 * IN-SESSION, using the SAME directive-apply path the consent response uses
 * (`serverFullTelemetry` → `setProdSamplerConsent`/`syncSnapshotUpload`). The
 * in-app account card calls this right after its own successful telemetry-toggle
 * POST so the new mode takes effect immediately with no relaunch and no code
 * change. A no-op (returns false) when telemetry was never enabled — there is no
 * client to apply it to. Never throws: it delegates to the client method, whose
 * gates already honor disable()/forget()/BOOSTHIS_DISABLED.
 */
export function applyServerFullTelemetry(on: boolean): boolean {
  const client = activeTelemetryClient;
  if (!client) return false;
  client.applyServerFullTelemetry(on);
  return true;
}

/**
 * Crash-safe resolver for the developer's WEB dashboard (`/app`) URL, derived
 * from the active telemetry endpoint (or the built-in default). This is the
 * escape hatch the fatal-fallback cards use to always offer a working web
 * sign-in path even when the in-app dashboard render has crashed — so a render
 * bug in the kit can NEVER leave a developer with no way to log in. Never
 * throws: every failure falls back to the public dashboard URL.
 */
export function resolveDashboardWebUrl(): string {
  try {
    const client = activeTelemetryClient;
    const endpoint =
      client?.endpoint ||
      DEFAULT_TELEMETRY_ENDPOINT ||
      "https://www.boosthis.com/api";
    return endpoint.replace(/\/api\/?$/, "").replace(/\/+$/, "") + "/dashboard";
  } catch {
    return "https://www.boosthis.com/dashboard";
  }
}

/**
 * Strip every metadata key that is not in the closed privacy-safe set.
 * Called before every transmit so callers cannot sneak PII through
 * arbitrary metadata fields. Also validates enum values so a bad startType
 * or deviceTier cannot reach the server.
 */
function filterMetadata(
  meta: Record<string, unknown> | ClosedSampleMetadata | null | undefined,
): ClosedSampleMetadata | null {
  if (meta == null) return null;
  const out: ClosedSampleMetadata = {};
  const st = (meta as Record<string, unknown>).startType;
  if (st === "cold" || st === "warm" || st === "hot" || st === "unknown") {
    out.startType = st;
  }
  const dt = (meta as Record<string, unknown>).deviceTier;
  if (dt === "low" || dt === "mid" || dt === "high" || dt === "unknown") {
    out.deviceTier = dt as DeviceTier;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** UUID shape accepted for a persisted rotation id (any RFC-4122 version —
 *  the server's consent schema validates with the same breadth). */
const ROTATION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mirrors the server's consent-time installId validation (zod `.uuid()` — any
 *  8-4-4-4-12 hex layout, case-insensitive; uppercase and the nil UUID pass).
 *  Consent is deliberately fire-safe, so a wrong-shaped id would otherwise be
 *  refused SERVER-side (HTTP 400 `invalid_install_id`) long after the developer
 *  stopped looking. Validating here fails loud at the one moment they ARE
 *  looking. The CLI (`boosthis init-rn`) mints real UUIDs, so the config-written
 *  path is unaffected. Same loose rules the node/web/java/go kits ship. */
const INSTALL_ID_SHAPE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Dependency-free UUIDv4 generator for the self-healing reinstall recovery.
 * Hermes has no crypto.randomUUID, and the kit must stay zero-dependency, so
 * this uses Math.random — which is fine HERE because the rotated install id is
 * an IDENTIFIER, not an authenticator ("install ids are identifiers, not
 * authenticators" is a server-side invariant): every capability still rides
 * the server-minted delete/read tokens. Exported for tests.
 */
export function generateRotationInstallId(): string {
  let out = "";
  for (const c of "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx") {
    if (c === "x") out += ((Math.random() * 16) | 0).toString(16);
    else if (c === "y") out += (((Math.random() * 4) | 0) + 8).toString(16);
    else out += c;
  }
  return out;
}

/**
 * PHONE-CATEGORY PRE-CONTACT DEFAULT — the sharing posture of a brand-new
 * install in the window before the server has ever answered. Identical in all
 * four phone kits (React Native, Swift, Flutter, Android/Kotlin) and held there
 * by the phone-kit sharing parity guard. It matches the server's day-one
 * default so the kit never states a second, contradictory answer.
 * See .agents/memory/phone-kit-sharing-posture.md.
 *
 * This kit expresses the posture through `issuesOnly` (its inverse): omitting
 * the option leaves the install in the shared posture, and an explicit
 * `issuesOnly: true` is the host's pre-contact opt-out. Either way the server's
 * directive still wins in BOTH directions after first contact, and nothing can
 * leave the device before then — every upload path also requires the delete
 * token minted by the consent answer.
 */
export const PRE_CONTACT_FULL_TELEMETRY_DEFAULT = true;

/** Which of the three badge states the startup line should report. Read from
 *  the same resolver the launcher itself uses, so the line and the badge can
 *  never tell different stories. Never throws. */
function badgeStateForStartupLine(): BadgeState {
  try {
    if (isBoosthisDisabled()) return "switched-off";
  } catch {
    return "switched-off";
  }
  try {
    return resolveBubbleVisibility() ? "visible" : "hidden-by-setting";
  } catch {
    return "visible";
  }
}

export function enableTelemetry(opts: TelemetryOptions): TelemetryClient {
  // Say ONE ungated line the moment the kit is switched on — before the key is
  // resolved and before any registration. It is the anchor for every
  // diagnosis: no line means this call never ran, and nothing about keys,
  // networks or previews matters until it does. Never silenced by a quiet
  // mode, a privacy setting or a switched-off badge; it reveals only a
  // four-character tail of a key the developer already holds.
  // The badge state the startup line announces — reused by the activation
  // notice below so the two can never tell different stories about the bubble.
  let badgeState: BadgeState = "visible";
  try {
    // Claim the line BEFORE a single key is read, so any refusal the resolve
    // below produces is held back and printed after it. The anchor line is
    // always the first thing a developer sees.
    beginStartAnnouncement();
    badgeState = badgeStateForStartupLine();
    announceKitStart(resolveProjectKeyDetailed(opts.inviteKey).key, badgeState);
  } catch {
    // evidence is never allowed to block measurement — but never swallow a
    // refusal that was only waiting for a line that is no longer coming.
    try {
      flushHeldRefusals();
    } catch {
      /* nothing more can be said */
    }
  }
  // Immediately after the existing startup line, explain any stable Hermes
  // sources this runtime lacks. The function latches the judgement as well as
  // the output, and the startup channel holds it if the anchor line is pending.
  announceUnreadableHermesSources();
  if (!opts.installId || typeof opts.installId !== "string") {
    throw new Error("enableTelemetry requires opts.installId (UUIDv4 string)");
  }
  if (!INSTALL_ID_SHAPE.test(opts.installId)) {
    throw new Error(
      "enableTelemetry: opts.installId must be a UUID (8-4-4-4-12 hex, e.g. crypto.randomUUID()) — the server rejects any other shape at registration, so the install would silently never appear",
    );
  }
  // Past the point where this call can be refused, so the kit really is
  // starting: watch for the one silence a developer cannot interpret — an
  // install that registered but has not been confirmed yet, whose bubble is
  // therefore legitimately absent.
  try {
    watchFirstActivation(badgeState);
  } catch {
    // evidence is never allowed to block measurement
  }
  const endpoint = resolveTelemetryEndpoint(opts.endpoint);
  // Configure before the watcher lands: even a request sent synchronously by
  // later startup wiring must see the declarations and must refuse Boosthis's
  // own API host. RN fetch sits on XHR, so aiCalls patches ONLY that lower
  // transport (patching fetch as well would count one request twice).
  setDeclaredAiEndpoints(opts.aiEndpoints);
  setAiCallOwnEndpoint(endpoint);
  installAiCallWatch();
  const packageVersion = opts.packageVersion ?? RUNTIME_VERSION;
  const fetchOptions = opts.fetchOptions ?? {};
  // OPT-IN abort signal (default OFF): only when the host explicitly vouches
  // that its runtime tolerates signal-bearing fetch does the account path arm
  // an AbortController on timeouts. See fetch.ts header for the full contract
  // (self-healing downgrade on a synchronous signal throw).
  if (fetchOptions.allowAbortSignal === true) {
    setAbortSignalOptIn(true);
  }
  const issuesOnly = opts.issuesOnly ?? !PRE_CONTACT_FULL_TELEMETRY_DEFAULT;
  // The privacy-filtered snapshot (the full meter page) uploads whenever we are
  // in full mode OR the snapshot mirror is allowed in issues-only mode. Two
  // things can allow it: (1) the developer's explicit `shareMeterWithAI` opt-in
  // (set in code), or (2) the SERVER DIRECTIVE — the consent response's
  // `shareMeterWithAI` flag, which the server sets true once the developer has
  // connected an AI from the web dashboard ("Connect AI"). Either way this is
  // the ONLY thing it turns on: the raw per-route sampler firehose stays
  // governed by the EFFECTIVE full mode (code config OR the separate dashboard
  // "Full telemetry" directive — see effectiveFullMode() below), never by
  // shareMeterWithAI — so share-only issues-only ships the PII-filtered
  // snapshot mirror but never the raw stream. It cannot survive an explicit
  // dashboard OFF either: it is compiled into the app and could not be
  // withdrawn without a release, so the owner's answer vetoes it.
  const explicitShareMeterWithAI = opts.shareMeterWithAI ?? false;
  // Off unless the host says otherwise. There is no server directive that
  // turns this on: the screen map is the host's decision alone.
  const sendPageMap = opts.sendPageMap ?? false;
  // Remembered for the on-device panel, which must not promise a map never
  // leaves the device when the host has asked for it to be sent.
  pageMapSendRequested = sendPageMap;
  // Server directive, learned from the consent response. Starts false; flips to
  // true (and never back) once consent reports the developer connected an AI. It
  // can ONLY turn the snapshot mirror ON — it never re-enables the raw sampler,
  // and never overrides disable()/forget()/BOOSTHIS_DISABLED. Because it is
  // sticky AND server-set, an explicit dashboard OFF vetoes it outright;
  // otherwise "an AI was connected once" would outlive the owner's decision.
  let serverShareMeterWithAI = false;
  // SECOND server directive: the dashboard "Full telemetry" switch. Unlike
  // serverShareMeterWithAI this one follows BOTH edges and is a THREE-STATE
  // value:
  //   • null  = the server has not told us yet — honour the code-configured
  //             mode (`issuesOnly`) until first contact.
  //   • true  = ON  — force full mode for the session (raw sampler + snapshot
  //             mirror), even when the code shipped issuesOnly: true (preserves
  //             the documented contract).
  //   • false = OFF — force issues-only for the session, even when the code
  //             shipped full mode (fixes the defect where a dashboard "turn it
  //             off" was silently ignored).
  // It is the ONLY server directive allowed to enable the raw sampler, and it
  // still never overrides disable()/forget()/BOOSTHIS_DISABLED — those always
  // win. Initialised to null (NOT false) so it never fabricates an OFF the
  // server never sent.
  let serverFullTelemetry: boolean | null = null;
  // Set true when a server directive of OFF was applied in memory but could NOT
  // be confirmed durable (the write failed even after a retry). The session
  // stays closed regardless — `serverFullTelemetry` already holds the OFF — but
  // the NEXT launch would restore nothing, read it as "not asked yet", and
  // resume screen-bearing uploads under the pre-contact "share" default. So the
  // failure latches every screen-bearing gate shut and is surfaced on the
  // client (`sharingOffNotDurable`) so the in-app panel can say so, rather than
  // being swallowed the way the fire-and-forget write used to.
  // See .agents/memory/phone-kit-sharing-posture.md.
  let directivePersistFailedOff = false;

  /** Single source of truth for "are we in full mode right now": before the
   *  server has spoken (`serverFullTelemetry === null`) the code config
   *  (`issuesOnly: false`) wins; after first contact the server directive wins
   *  in BOTH directions (ON forces full, OFF forces issues-only). Gates the raw
   *  per-route channel everywhere — transmit(), both setProdSamplerConsent
   *  sites, and the snapshot-mirror allowance — so the directive can never
   *  enable one gate but not another. */
  function effectiveFullMode(): boolean {
    // A known OFF we could not persist keeps the session closed — never fall
    // back to the pre-contact default after a known OFF.
    if (directivePersistFailedOff) return false;
    return serverFullTelemetry === null ? !issuesOnly : serverFullTelemetry;
  }

  /** SAY IT ONCE when this project's dashboard directive contradicts what the
   *  installed code asked for.
   *
   *  The server wins in both directions and always has; that is deliberate
   *  and this warning does not dispute it. What it ends is a developer
   *  reading their own source, seeing the mode they set, and believing it
   *  while the switch on their project's page quietly says otherwise. BOTH
   *  values are named, so the line is actionable without first opening the
   *  dashboard to find out what it currently says.
   *
   *  One wording in every kit that warns — see
   *  lib/telemetry-mode-contract.json, which is also where a kit that does
   *  NOT warn has to write down why. */
  let telemetryModeContradictionAnnounced = false;
  function noteTelemetryModeContradiction(): void {
    if (telemetryModeContradictionAnnounced) return;
    // Nothing to contradict until the server has actually answered: before
    // first contact the code's setting is the only one there is.
    if (serverFullTelemetry === null) return;
    const requested = issuesOnly ? "reduced" : "full";
    const effective = effectiveFullMode() ? "full" : "reduced";
    if (requested === effective) return;
    telemetryModeContradictionAnnounced = true;
    try {
      // NAMES THE ANSWER, NEVER THE SWITCH'S POSITION. A disconnected or
      // removed project is answered with the sharing directives withdrawn
      // while its switch may still be ON, so a line quoting that switch
      // would be false exactly where a developer most needs it. The kit
      // knows what it was told; it does not know why.
      console.warn(
        `[boosthis] telemetry mode: your code asked for ${requested} telemetry, but this project's server answer is ${effective}, so ${effective} is what is in force. The server answer wins in both directions: the "Full telemetry" switch on the project's page sets it, and a disconnected or removed project is answered with reduced until it is reconnected. Change it there, or drop the code setting so the two agree.`,
      );
    } catch {
      /* a host that replaced console must not break telemetry */
    }
  }
  // Host-provided device tier (optional). Defaults to "unknown" when unset —
  // Boosthis never guesses a tier from screen size.
  if (opts.deviceTier) setDeviceTier(opts.deviceTier);

  let enabled = true;
  let deleteToken: string | null = opts.deleteToken ?? null;
  // SELF-scoped read token, restored from storage if the host persisted one.
  // The server only returns it on first consent (or one-time backfill), so we
  // hold onto it across the session and let the host persist it for relaunch.
  let readToken: string | null = opts.readToken ?? null;

  // ─── WHICH PROJECT KEY DOES THIS APP REPORT UNDER? ────────────────────────
  // A phone app added to a codebase that already reports under another key
  // used to inherit that key in silence — it registered inside somebody else's
  // project and no surface said so. A React-Native-specific key now wins over
  // whatever the app passes in code, so the setup can put this runtime on its
  // own project WITHOUT the app author editing their own source. See
  // projectKey.ts for the precedence every kit shares.
  const projectKey: ResolvedProjectKey = resolveProjectKeyDetailed(
    opts.inviteKey,
  );
  const inviteKey: string | null = projectKey.key;
  if (projectKey.overrodeShared) {
    // Silent overrides are the same class of bug as silent inheritance: say it
    // once, in one ungated line, and never print any part of either key.
    try {
      console.warn(
        "[boosthis] This app is registering under its React Native project " +
          "key, not the key passed in code (" +
          describeProjectKeySource(projectKey) +
          ", ending " +
          (projectKey.display ?? "?") +
          ").",
      );
    } catch {
      /* a host with no console must never break registration */
    }
  }

  // ─── SELF-HEALING REINSTALL RECOVERY (identity rotation) ──────────────────
  // A reinstalled/rebuilt app keeps its host-baked installId but loses its
  // stored tokens, so its tokenless re-consent gets the idempotent orphan
  // response ("already_registered_no_token") forever — historically the kit
  // just sat locked until the owner pressed Repair in the dashboard. Because a
  // FRESH registration with a valid invite key is already permitted (that is
  // exactly what a brand-new install does), the kit can recover on its own:
  // mint a brand-new random installId, persist the mapping in KIT-OWNED
  // storage (keyed by the baked id, so relaunches that re-pass the baked id
  // keep resolving to the rotated identity), and re-register under the new
  // identity. Server capability is UNCHANGED — no new endpoint, no weakened
  // proof rule ("install ids are identifiers, not authenticators" holds: the
  // rotation needs the same invite key any fresh install needs, and the old
  // row's credentials stay dead). The old row simply goes dormant; the
  // dashboard's Repair banner points at it until the owner Removes it.
  //
  // Guard rails:
  //   • fires ONLY on the orphan status, with an invite key in hand, and with
  //     no tokens (a Repair-window response carries tokens and takes the
  //     normal adoption path — rotation can never race an owner's Repair);
  //   • at most ONE rotation per session (no retry loops);
  //   • a persisted mapping is adopted only if it is UUID-shaped;
  //   • forget() erases the mapping (leave nothing Boosthis-shaped behind).
  let activeInstallId = opts.installId;
  let rotatedThisSession = false;
  const rotationStoreKey = `boosthis:rotatedInstallId:${opts.installId}`;
  // The server's "Full telemetry" directive, PERSISTED in kit-owned storage so
  // it survives a relaunch. Without this the three-state value would reset to
  // null on every launch, and a relaunch holding a host-persisted delete token
  // would upload screen-bearing samples under the PRE-CONTACT default before
  // the fresh consent answer landed — silently overriding an owner who had
  // turned sharing off. The three ported phone kits persist their directive in
  // their own store; this is the React Native equivalent, and the phone-kit
  // sharing parity guard holds all four to it. Keyed by the BAKED install id
  // (like the rotation mapping) so it survives an identity rotation.
  const fullTelemetryStoreKey = `boosthis:fullTelemetry:${opts.installId}`;
  // ─── THE KIT REMEMBERS ITS OWN CREDENTIALS ────────────────────────────────
  // The server issues a delete token (and a self-scoped read token) exactly
  // once per install. Historically this kit handed them to the host app via
  // callbacks and kept NOTHING itself, so an app whose install guide never
  // wired that persistence came back tokenless on every relaunch, hit the
  // "already registered, no token" answer, rotated to a fresh identity — and
  // filled the dashboard with a brand-new project per launch. Every back-end
  // kit already persists its own delete token in its own store; this is the
  // React Native equivalent. A host-supplied token still WINS (the host owns
  // its storage), forget() still erases these, and rotation still only fires
  // when the install is genuinely credential-less.
  // THE HOST APP'S OWN VERSION, AS LAST TOLD TO THE SERVER. A phone app's
  // version changes when the person updates the app — a new process, a
  // credential already in the store, and therefore no registration. Without a
  // remembered value there is nothing to compare the new build against, so the
  // update would be invisible and the release it should produce would never be
  // recorded. Keyed by the BAKED install id, like the two above, so it survives
  // an identity rotation.
  const appVersionStoreKey = `boosthis:appVersion:${opts.installId}`;
  const deleteTokenStoreKey = `boosthis:installToken:${opts.installId}`;
  const readTokenStoreKey = `boosthis:readToken:${opts.installId}`;
  // The server is the only authority for the developer's project name. Keep
  // its sanitised display identity beside the credentials so the dashboard can
  // still name the project immediately after an app restart.
  const projectStoreKey = `project:${opts.installId}`;

  // ERASURE IS FINAL — the guard that makes it so. Credential writes are
  // fire-and-forget and a consent response can land AFTER forget() has run, so
  // both paths carry the generation they were scheduled under. forget() bumps
  // the generation (invalidating everything already in flight) and drains the
  // write chain before it removes the keys, so a late write can never
  // resurrect a token the user asked us to erase.
  let credentialGeneration = 0;
  let credentialWrites: Promise<void> = Promise.resolve();

  /** Persist a credential the server just issued. Best-effort and silent —
   *  storage failure must never break a registration that already succeeded
   *  (the host callback has the value too). Writes are serialized and skipped
   *  outright if forget() ran after this one was scheduled. */
  function persistCredential(key: string, value: string): void {
    const scheduledAt = credentialGeneration;
    credentialWrites = credentialWrites.then(async () => {
      if (scheduledAt !== credentialGeneration) return; // erased meanwhile
      try {
        await platform().storage.set(key, value);
      } catch {
        /* best-effort */
      }
    });
    safeAsync("telemetry.persistCredential", async () => {
      await credentialWrites;
    });
  }

  /** (Re)install the kill-switch heartbeat config for the CURRENT identity.
   *  startEntitlementCheckin captures installId by value, so every identity
   *  change (persisted-rotation adoption, in-session rotation) must repoint
   *  it — otherwise the heartbeat knocks with the old id + the new token and
   *  the activation lock never releases. Safe to call repeatedly. */
  function installCheckinConfig(): void {
    startEntitlementCheckin({
      endpoint,
      installId: activeInstallId,
      getToken: () => deleteToken ?? readToken,
      kitVersion: packageVersion,
      integrity: opts.integrity ?? null,
      fetchImpl: fetchOptions.fetchImpl,
    });
  }

  // Adopt a previously-persisted rotation BEFORE the first network call so a
  // rotated install keeps its post-rotation identity across relaunches (the
  // host keeps passing the baked id forever — the mapping lives in kit-owned
  // storage). AsyncStorage is async, so every outbound path awaits this
  // one-shot promise; after it settles the await is a no-op microtask.
  // Did THIS launch read its own identity state back out of the store? The
  // proof the mechanism works, and the one thing a store that calls itself
  // durable and never restores is failing to do. Set by the restores below,
  // read once when the consent body is built.
  let identityRestored = false;
  // The host app's version the server has already been told about, restored
  // from the store by the same block below. `null` means "we have never told
  // it", which is not the same as "it has not changed".
  let lastAppVersionSent: string | null = null;
  const storageReady: Promise<void> = (async () => {
    try {
      const stored = await platform().storage.get(rotationStoreKey);
      if (
        typeof stored === "string" &&
        ROTATION_UUID_RE.test(stored) &&
        stored !== opts.installId
      ) {
        activeInstallId = stored;
        identityRestored = true;
        installCheckinConfig();
      }
    } catch {
      /* storage failure — continue with the baked id (fail-open) */
    }
    // Restore the PERSISTED server directive from the previous launch, so a
    // relaunch resumes the last answer the server actually gave instead of
    // falling back to the pre-contact default. Only the two values we write
    // are honoured; anything else leaves the value three-state (null), which
    // means "not asked yet" and defers to the pre-contact default until the
    // fresh consent answer lands. Both gates are recomputed here because the
    // synchronous init below has already armed them from the pre-contact
    // default — the restore must be able to CLOSE them again.
    try {
      const storedDirective = await platform().storage.get(
        fullTelemetryStoreKey,
      );
      if (storedDirective === "1" || storedDirective === "0") {
        serverFullTelemetry = storedDirective === "1";
        if (enabled && !isRuntimeInert()) {
          setProdSamplerConsent(effectiveFullMode());
        }
        syncSnapshotUpload();
        // A directive carried over from the last launch contradicts the code
        // exactly as loudly as a fresh one does, and this is the path a
        // relaunched app takes — so the developer is told here too.
        noteTelemetryModeContradiction();
      }
    } catch {
      /* storage failure — stay pre-contact until the server answers */
    }
    // Restore the kit's OWN credentials from the previous launch, so a
    // relaunch re-consents as the SAME install instead of arriving tokenless
    // and rotating into a duplicate project. A token the host passed in wins:
    // the host owns its storage and may hold a newer value.
    try {
      if (!deleteToken) {
        const storedToken = await platform().storage.get(deleteTokenStoreKey);
        if (typeof storedToken === "string" && storedToken.length > 0) {
          deleteToken = storedToken;
          // The credential that stops the next launch rotating into a
          // duplicate. Reading it back IS this install keeping its identity.
          identityRestored = true;
        }
      }
      // A delete token only exists because the SERVER minted it, so holding
      // one — restored or passed in — is a confirmed answer that this install
      // is on file. Its ABSENCE is not the opposite answer: that is the whole
      // point of the three-outcome verdict, so nothing is marked when it is
      // missing.
      if (deleteToken) markRegistrationConfirmed();
      if (!readToken) {
        const storedRead = await platform().storage.get(readTokenStoreKey);
        if (typeof storedRead === "string" && storedRead.length > 0) {
          readToken = storedRead;
        }
      }
      const storedProject = parseKitProject(
        await platform().storage.get(projectStoreKey),
      );
      if (storedProject) {
        setKitProject(storedProject.name, storedProject.code);
      }
      // The host app's version as it was when we last told the server. Read
      // back before any consent is built, so the comparison below is against
      // what the SERVER holds rather than against nothing.
      const storedAppVersion = await platform().storage.get(appVersionStoreKey);
      if (typeof storedAppVersion === "string" && storedAppVersion.length > 0) {
        lastAppVersionSent = storedAppVersion;
      }
    } catch {
      /* storage failure — fall through; a keyed install can still register */
    }
  })();

  /** Raw POST that bypasses the PII guard. Use ONLY for payloads whose
   *  shape we control end-to-end and which are known to legitimately
   *  contain a denylist-named field (e.g. `deleteToken` for /installs/forget).
   *  The PII guard tokenizes field names, so "deleteToken" matches the
   *  "token" denylist entry — correct in general, but the privacy contract
   *  must not block the GDPR right-to-erasure flow. */
  async function rawPost(
    url: string,
    payload: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    // Resolve the fetch per-call (host adapter, else bound global, else none)
    // and route through `callFetch` so an unbound/missing fetch surfaces as a
    // clear rejection instead of a raw "undefined is not a function".
    const f = resolveFetch(fetchOptions.fetchImpl);
    if (!f) throw new Error(NO_FETCH_MESSAGE);
    return callFetch(f, url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(fetchOptions.headers ?? {}),
        ...extraHeaders,
      },
      body: JSON.stringify(payload),
      signal: fetchOptions.signal,
    });
  }

  // Consent requests that have been sent but not yet settled. forget() lets
  // them land (briefly) before it erases: the token an in-flight consent is
  // about to be issued is the only credential that can erase the row that
  // same consent just created on the server. Anything that arrives after the
  // erasure is dropped by the generation guard inside postConsentInner.
  const consentsInFlight = new Set<Promise<number>>();
  const CONSENT_SETTLE_MS = 250;

  // Consent runs before the first screen or app network call. Re-read on the
  // kit's existing upload paths and re-consent only when that answer changes.
  // No timer is added; checks and refreshes are both tightly bounded.
  let lastCoverageSent: string | null = null;
  let coverageRefreshes = 0;
  let coverageCheckedAt = 0;
  const MAX_COVERAGE_REFRESHES = 6;
  const COVERAGE_REFRESH_GAP_MS = 60_000;

  /** `ignoreGap` is for the one check a registration owes its own joiners: it
   *  happens once, immediately after that registration settles, and the
   *  throttle exists to space out repeated polling, not to swallow it. */
  function maybeRefreshCoverage(ignoreGap = false): void {
    try {
      if (!enabled || isBoosthisDisabled()) return;
      if (coverageRefreshes >= MAX_COVERAGE_REFRESHES) return;
      const now = Date.now();
      if (!ignoreGap && now - coverageCheckedAt < COVERAGE_REFRESH_GAP_MS) {
        return;
      }
      const fingerprint = coverageFingerprint(
        coverageInventory(),
        collectorsReached(),
      );
      // Spend the throttle window only on a check that could actually judge
      // something. Before the first consent has been answered there is nothing
      // to compare against, and a check that closed the window on that
      // no-answer would silence the real comparison for the next minute.
      if (lastCoverageSent === null || fingerprint === lastCoverageSent) return;
      coverageCheckedAt = now;
      coverageRefreshes++;
      void postConsent().catch(() => {
        /* inventory refresh is always best-effort */
      });
    } catch {
      /* a coverage read must never disturb the host */
    }
  }

  // ONE REGISTRATION PER LAUNCH. While this install holds no credential, every
  // path that asks for consent — the eager first-consent, an explicit
  // client.consent(), any of the lazy upload paths, a coverage refresh — is
  // asking for the same thing: the single registration that creates the row.
  // They share one request.
  //
  // Two concurrent tokenless posts do not merely waste a round trip. They race
  // on the server: the loser is answered `already_registered_no_token`, which
  // is the exact marker that triggers the kit's own rotation below. A
  // double-fire in one launch could therefore mint a second install id and file
  // a second row for one phone — the churn this guard exists to stop.
  //
  // Once a delete token exists the coalescing stops: those are re-consents
  // against a row the server de-duplicates by install id, and a coverage
  // refresh must never be answered by an older in-flight body that predates
  // the change it is reporting.
  let registrationInFlight: Promise<number> | null = null;

  function postConsent(): Promise<number> {
    if (!deleteToken && registrationInFlight) return registrationInFlight;
    return startConsent(!deleteToken);
  }

  /** Starts a consent POST. `claimsRegistration` marks it as THE registration
   *  for this launch, so concurrent callers join it instead of racing it. The
   *  rotation re-consent passes false: it runs inside the registration that is
   *  already holding the slot, and joining itself would deadlock. */
  function startConsent(claimsRegistration: boolean): Promise<number> {
    const inFlight = postConsentInner();
    consentsInFlight.add(inFlight);
    if (claimsRegistration) registrationInFlight = inFlight;
    const done = () => {
      consentsInFlight.delete(inFlight);
      if (registrationInFlight === inFlight) registrationInFlight = null;
    };
    // Bookkeeping must never raise an unhandled rejection of its own — the
    // caller still receives the original promise, error and all.
    inFlight.then(done, done);
    if (claimsRegistration) {
      // A caller that JOINED this registration never got a request of its
      // own, and the body it is answered from was written before it asked: a
      // collector armed in between is not in it. What we recorded as sent is
      // what actually travelled, so the difference is real and unreported.
      // Hand it to the ordinary coverage check — same cap, same gap, same
      // best-effort — now that the registration has issued a token to send it
      // with, rather than leaving it until some upload path happens to run.
      const startedAt = credentialGeneration;
      inFlight.then(
        (status) => {
          // Only a registration the server ACCEPTED has a row to update and a
          // token to update it with. postConsentInner answers with the HTTP
          // status, and with 0 for any call it abandoned — including one this
          // launch's erasure stopped — so anything outside 2xx is not one.
          if (status < 200 || status >= 300) return;
          // forget() works through several awaits of its own, and for that
          // whole stretch `deleteToken` and `enabled` are still truthy. The
          // generation moves at the START of erasure, so it is the only
          // question that is already answered here.
          if (startedAt !== credentialGeneration) return;
          if (!deleteToken) return;
          maybeRefreshCoverage(true);
        },
        () => {
          /* a registration that failed has nothing to refresh */
        },
      );
    }
    return inFlight;
  }

  async function postConsentInner(): Promise<number> {
    // Remember which erasure generation this request belongs to — captured
    // BEFORE the first await, so a forget() that starts while this call is
    // still settling storage is still counted as "after". If forget() runs
    // while this is in flight, the answer must be dropped whole: adopting its
    // tokens (or rotating on its orphan marker) would put Boosthis-shaped
    // state back on a device the user just erased.
    const consentGeneration = credentialGeneration;
    // Adopt any persisted rotation before the first network call — a rotated
    // install must knock with its post-rotation identity, not the baked id.
    await storageReady;
    // Storage settling is an await like any other, and on a cold start a slow
    // one: a forget() can complete inside it. Posting anyway would create a
    // row on the server whose token this process has already been told to
    // drop — a registration made after erasure that nothing left here can
    // erase, because no credential for it would ever be held. The answer
    // being discarded later is not enough; the request must not be sent.
    if (consentGeneration !== credentialGeneration) return 0;
    // ACTIVATION LOCK precondition: registration needs SOME credential — an
    // invite key (fresh registration / handshake) or an already-issued install
    // token (re-consent). A keyless, tokenless copy has nothing the server
    // would accept, so don't even build a request for it: the kit stays
    // locked and silent. This is what makes a copied-around kit inert.
    if (!inviteKey && !deleteToken && !readToken) {
      recordRegistrationOutcome(projectKey.declined ? "no-key-chosen" : "none");
      return 0;
    }
    let res: Response;
    // Display name (metadata): an explicit `opts.appName` if the developer set
    // one, else a best-effort auto-detected name (Expo config / native app name)
    // so the dashboard shows a friendly name instead of a churny install id with
    // zero wiring. The auto path clamps + drops a guard-tripping name so it can
    // never break consent; the PII guard in _safeTransmitInternal still screens
    // the value before it leaves the device.
    const displayName = resolveAppName(opts.appName);
    const inventory = coverageInventory();
    // WHAT THIS REQUEST WILL CARRY, read before it is sent. The coverage we
    // record as reported has to be the coverage in this body: a collector that
    // starts while the request is in flight is not in it, and reading the
    // inventory again when the answer lands would file that collector as
    // already reported and suppress the re-consent that would have told the
    // server about it. It matters more now that a second caller can JOIN this
    // registration instead of posting its own.
    const sentCoverage = coverageFingerprint(inventory, collectorsReached());
    // Read once, for the same reason: the body below and the value we remember
    // as "told" must be the same string, or an update that lands mid-flight is
    // filed as already reported and never travels.
    const sentAppVersion = resolveAppVersion(opts.appVersion)?.version ?? null;
    try {
      res = await _safeTransmitInternal(
        `${endpoint}/installs/consent`,
        {
          installId: activeInstallId,
          // React Native says it is React Native. This kit and the Node
          // back-end kit both used to register under a shared "js", which left
          // the dashboard unable to tell a member of the public's phone from a
          // customer's back end. Each now names itself; the server still
          // ACCEPTS "js" forever, so an older kit in the field keeps working.
          runtime: "rn",
          packageVersion,
          // WHAT THIS BUILD'S CODE ASKED FOR — never what is in effect. The
          // server's own switch still wins in both directions and nothing here
          // changes that; sending this is what lets the owner's page show the
          // two answers side by side, instead of describing a code setting it
          // has never been told. See lib/telemetry-mode-contract.json.
          telemetryMode: issuesOnly ? "reduced" : "full",
          // OUR version is `packageVersion` above. THEIRS is the block below,
          // and the two are never the same field, never merged, and never
          // shown as one another. Until this shipped, a phone app's release
          // history was empty for every customer we had, because the only
          // version string on the wire was one of our own releases.
          //
          // Read out of the native build with nobody declaring anything
          // (`CFBundleShortVersionString` / `versionName`), or stated by the
          // app itself through `appVersion`. The word for which of those it
          // was travels with it — see appVersionFacts.ts. An app whose version
          // cannot be read sends no block at all rather than ours.
          ...appVersionPayload(opts.appVersion),
          ...(displayName ? { appName: displayName } : {}),
          // WHERE THIS KIT KEEPS ITS INSTALL ID, and whether the next launch
          // will still be this install. A closed word from the server's own
          // vocabulary — never a path, never a module name. Sent on every
          // consent, including the re-consent that follows a rotation, so the
          // answer is dated by the launch that gave it.
          //
          // This is the difference between a project seeing a growing fleet of
          // healthy installs it cannot explain and a project being told its
          // app relaunches as somebody new every time. See installIdentity.ts
          // for why the source word is `store` even though the host bakes the
          // starting id.
          identity: consentIdentity(identityRestored),
          ...coveragePayload(inventory),
        },
        fetchOptions,
        inviteKey ? `Bearer ${inviteKey}` : undefined,
        // Proof of control for the one-time read-token backfill. On re-consent
        // of an install created before read tokens existed, the server only
        // mints + returns a self-scoped read token when the caller proves it
        // owns the install by presenting the delete token. The Authorization
        // header already carries the invite key, so the delete token rides in a
        // dedicated header. Omitted on first consent (no delete token yet) — the
        // server's fresh-register path mints the read token unconditionally.
        deleteToken ? { "X-Boosthis-Install-Token": deleteToken } : undefined,
        // Registration is the handshake that LEADS to activation — it must be
        // allowed through the lock (but never through a kill/grace-expiry).
        true,
      );
    } catch (err) {
      // Match v0.2.1 semantics: network/transport failures return 0
      // instead of propagating. PII failures still propagate because
      // they indicate a programming bug, not a transient error.
      //
      // Capture the transport error FIRST so the "stayed inactive" line can name
      // it — a broken certificate store or blocked egress shows up here and
      // nowhere else, and it is the whole reason this signal exists. Kit-owned
      // string; it never reaches any outbound payload.
      recordTransportError(err);
      recordRegistrationOutcome("unreachable");
      // We could not reach Boosthis at all, so we do not KNOW whether this
      // install is on file. "Cannot tell", never "not registered".
      markRegistrationUnreachable();
      return 0;
    }
    if (res.ok) {
      lastCoverageSent = sentCoverage;
      // The version this body carried is now the version the server holds.
      // Remembered across launches so the NEXT build of the app — a different
      // process, with the credential already in the store — can see that it is
      // different and say so. Best-effort: a store that refuses only costs one
      // extra consent on the next launch.
      if (sentAppVersion && sentAppVersion !== lastAppVersionSent) {
        lastAppVersionSent = sentAppVersion;
        persistCredential(appVersionStoreKey, sentAppVersion);
      }
      // The orphan marker (F1) rides a 200, so the success outcome must NOT be
      // recorded until we have read the body and ruled it out — filing a
      // credential-less orphan as a registration is exactly the silent dead end
      // this guards against. `orphanDeadEnd` is set below when the marker
      // survives rotation; on that path we record "orphan" (F2) and skip the
      // activation handshake instead of clearing the failure state.
      let orphanDeadEnd = false;
      // forget() ran while this consent was in flight. Adopt nothing, persist
      // nothing, rotate nothing — erasure is final, and a late answer must not
      // hand this device a credential back.
      if (consentGeneration !== credentialGeneration) return 0;
      try {
        const body = (await res.json()) as {
          deleteToken?: unknown;
          readToken?: unknown;
          shareMeterWithAI?: unknown;
          fullTelemetry?: unknown;
          status?: unknown;
          projectName?: unknown;
          projectCode?: unknown;
        };
        // Reading the body is itself an await, and on a slow device it is a
        // long one. A forget() that completed while those bytes were being
        // parsed must still win, so the generation is checked AGAIN here —
        // after the last await before anything is adopted, persisted or
        // rotated. Checking only before the read left a window in which
        // erasure was announced and a credential arrived anyway.
        if (consentGeneration !== credentialGeneration) return 0;
        // WHICH PROJECT this key belongs to. The developer-authored name is
        // re-sanitised on arrival and persisted as display-only local state.
        // Older servers omit both fields; that must not blank a known project.
        if (body?.projectName != null || body?.projectCode != null) {
          setKitProject(body.projectName, body.projectCode);
          persistCredential(
            projectStoreKey,
            serializeKitProject(getKitProject()),
          );
        }
        // Adopt any server-issued delete token and — critically — notify the
        // host whenever the VALUE changes, not just the first time one is
        // issued. A copy of the app can come back holding a STALE persisted
        // token (reinstall, or a host that regenerated its installId while
        // keeping old storage); the server then mints fresh credentials
        // (fresh registration, or an owner-approved repair re-issue). If the
        // host is only told on first issuance, it keeps re-persisting the
        // stale token and every relaunch is broken again — so fire on change.
        const issued = typeof body?.deleteToken === "string" ? body.deleteToken : null;
        if (issued) {
          const changed = issued !== deleteToken;
          deleteToken = issued;
          // Keep our own copy FIRST — the host callback is optional wiring and
          // an app that never wired it must still survive a relaunch.
          if (changed) persistCredential(deleteTokenStoreKey, issued);
          if (changed) opts.onTokenIssued?.(issued);
        }
        // Capture the SELF-scoped read token. The server returns it only on the
        // first consent (or a one-time backfill / repair re-issue), so we keep
        // whatever we already have if this re-consent omits it — and tell the
        // host to persist it whenever the value changes (same rationale as the
        // delete token above).
        const readIssued = typeof body?.readToken === "string" ? body.readToken : null;
        if (readIssued) {
          const changed = readIssued !== readToken;
          readToken = readIssued;
          if (changed) persistCredential(readTokenStoreKey, readIssued);
          if (changed) opts.onReadTokenIssued?.(readIssued);
        }
        // SELF-HEALING REINSTALL RECOVERY: the server says this install id is
        // already registered but we hold NO tokens — the reinstall-lockout
        // signature (a Repair-window win would have carried fresh tokens and
        // been adopted above). With an invite key in hand, rotate to a fresh
        // identity and re-register — exactly what a brand-new install would
        // do, just without the developer editing code. One rotation per
        // session, ever (rotatedThisSession blocks any further recursion).
        if (
          body?.status === "already_registered_no_token" &&
          !deleteToken &&
          !readToken &&
          inviteKey &&
          !rotatedThisSession
        ) {
          rotatedThisSession = true;
          const freshId = generateRotationInstallId();
          try {
            await platform().storage.set(rotationStoreKey, freshId);
          } catch {
            /* best-effort: an unpersisted rotation still heals this session */
          }
          // That write is an await too. If erasure landed during it, stop here:
          // re-registering now would put this device back on file under a
          // brand-new id, moments after the user was told it had been removed.
          if (consentGeneration !== credentialGeneration) return 0;
          activeInstallId = freshId;
          // The heartbeat captured the OLD id by value — repoint it BEFORE
          // re-registering, or the post-consent activation check-in would
          // knock with the old id + the new token and stay locked.
          installCheckinConfig();
          // Not postConsent(): this runs INSIDE the consent that holds this
          // launch's registration slot, so joining it would await this very
          // call. Start the rotation's own POST directly — the outer promise
          // keeps the slot until the rotation settles, so no other path can
          // begin a second registration in the meantime.
          return startConsent(false);
        }
        // The orphan dead end. The marker is STILL here after rotation has run
        // (or rotation could not run — no invite key), and we hold no tokens.
        // This is NOT a registration: filing it as one would leave an install
        // that looks connected, uploads nothing, and never explains itself.
        // Record the "orphan" outcome (which fires the one-shot F2 line) and
        // stop — never loop. Falling through to the success path below would
        // clear the failure and run the activation handshake as if it worked.
        if (
          body?.status === "already_registered_no_token" &&
          !deleteToken &&
          !readToken
        ) {
          orphanDeadEnd = true;
          recordRegistrationOutcome("orphan");
        }
        // Server directive: the developer connected an AI from the web
        // dashboard, so auto-enable the PII-filtered snapshot mirror (even in
        // issues-only mode) so their own AI can read the meter. Rising-edge
        // only — it never turns the mirror off and never touches the raw
        // sampler. syncSnapshotUpload() wires the submitter immediately so the
        // next auto/manual flush ships the snapshot.
        if (body?.shareMeterWithAI === true && !serverShareMeterWithAI) {
          serverShareMeterWithAI = true;
          syncSnapshotUpload();
        }
        // Dashboard "Full telemetry" directive — BOTH edges. ON forces full
        // mode for the session; OFF forces issues-only for the session. The
        // first boolean the server sends flips the three-state
        // `serverFullTelemetry` off its initial null, so from then on the
        // server wins in BOTH directions.
        // CRITICAL: the sampler-consent recompute is gated on `enabled` and
        // the kill-switch, because postConsent() also fires lazily from the
        // ALWAYS-ON channels (candidates/crashes) even after disable() — the
        // directive must never override disable()/forget()/BOOSTHIS_DISABLED.
        // When disabled, the flag is still recorded so a later enable()
        // recomputes the correct effective mode. syncSnapshotUpload()
        // self-guards on the same conditions.
        if (typeof body?.fullTelemetry === "boolean") {
          // Await the durable write: a known OFF must have its persistence
          // outcome settled (and its latch set on failure) before consent
          // returns, so the caller does not observe a session that looks
          // uncommitted while an OFF the next launch would drop is in flight.
          await adoptServerFullTelemetry(body.fullTelemetry);
        }
      } catch {
        // ignore malformed body — server health is the source of truth
      }
      // Adopting the body awaited again (the durable full-telemetry write), so
      // the erasure question has to be asked once more before anything else
      // happens on this path. What follows is not bookkeeping: it tells the
      // rest of the kit this install is confirmed on file and starts chasing
      // activation. On an erased device that is a kit talking about an install
      // it no longer has any credential for.
      if (consentGeneration !== credentialGeneration) return 0;
      // An orphan dead end is NOT a successful registration — leave the "orphan"
      // failure recorded above and do not run the handshake as if it worked.
      if (!orphanDeadEnd) {
        // A completed handshake clears any prior lock hint (harmless on a
        // synthetic "killed" 204 — getLockHint() is gated off while inert).
        recordRegistrationOutcome(null);
        // The server ACCEPTED this registration, so it now has this install on
        // file. That is a confirmed server answer, not a guess from the
        // credential this process happens to be holding.
        markRegistrationConfirmed();
        // A successful registration means the server knows this install — run
        // the entitlement handshake NOW so the ACTIVATION LOCK releases this
        // session instead of at the next heartbeat tick. Fire-and-forget and
        // self-guarded; the check-in config is guaranteed installed because
        // postConsent only ever runs after enableTelemetry() wired it up.
        if (!isActivated()) {
          safeAsync("entitlement.now", () => checkEntitlementNow());
          // ...and keep asking on the bounded ladder. The launch-time chase may
          // already have run itself out while registration was still in flight
          // (slow storage, slow network, a late consent answer), and without a
          // restart the single check above would be the last word until the
          // ordinary heartbeat — the silent wait this whole path exists to end.
          chaseFirstActivation();
        }
      }
    } else if (res.status === 401 || res.status === 403) {
      // Registration was refused on auth grounds. Derive a COARSE, on-device-
      // only failure category so the locked dashboard can hint at why — we read
      // only the machine-readable `error` code, never echoing any server text.
      // A revoked/replaced key gets its own hint; anything else is "rejected".
      // Non-auth statuses (5xx, etc.) intentionally leave the hint untouched.
      let failure: "key-revoked" | "key-paused" | "key-unknown" | "key-rejected" =
        "key-rejected";
      try {
        const body = (await res.json()) as { error?: unknown };
        failure =
          body?.error === "invite_key_revoked"
            ? "key-revoked"
            : body?.error === "plan_required" || body?.error === "account_closure_pending"
              ? "key-paused"
              : body?.error === "invite_key_unknown"
                ? "key-unknown"
                : "key-rejected";
      } catch {
        // non-JSON body (e.g. a proxy error page) — fall back to the generic hint
      }
      recordRegistrationOutcome(failure);
      // The key was refused outright, so this app cannot be on file under it.
      // A definite negative — the one case where "not registered" is honest.
      markRegistrationRefused();
    } else if (res.status === 400) {
      // Registration was refused on SHAPE grounds. The only 400 the kit acts on
      // is the machine-readable `invalid_install_id` marker (this app's install
      // id is not a UUID). We read ONLY that marker — never the server's
      // `detail` text, the id, or any other response value — and derive a
      // fixed, code-defined outcome + console line from it. Every other 400 is
      // left alone (the hint stays untouched, exactly like a 5xx).
      //
      // NOTE: no retry is scheduled for this case. Re-knocking with the SAME
      // bad id can never succeed; the rejected-registration retry loop stays
      // reserved for 401/403 key rejection, which a server-side rekey CAN fix.
      let invalidInstallId = false;
      try {
        const body = (await res.json()) as { error?: unknown };
        invalidInstallId = body?.error === "invalid_install_id";
      } catch {
        // non-JSON body (e.g. a proxy error page) — not our marker; ignore.
      }
      if (invalidInstallId) {
        warnInstallIdRejectedOnce();
        recordRegistrationOutcome("install-id-rejected");
        // The server refused the identity itself, so it is definitely not on
        // file.
        markRegistrationRefused();
      }
    }
    return res.status;
  }

  /** Whether the PII-filtered snapshot mirror (and the trace spans that share
   *  its gate) may upload right now.
   *
   *  An explicit server OFF is a HARD VETO here, not merely one input. Both
   *  payloads carry screen labels gathered from the customer's END USERS, and
   *  the dashboard "Full telemetry" switch is the control their own app-store
   *  privacy declaration rests on — so when the owner turns it off, nothing
   *  screen-bearing may keep flowing. Neither opt-in may outlive that answer:
   *  `explicitShareMeterWithAI` is shipped in the app's code and cannot be
   *  withdrawn without a release, and `serverShareMeterWithAI` is sticky and set
   *  by the server itself the moment an AI is connected. All four phone kits
   *  hold this same rule (see .agents/memory/phone-kit-sharing-posture.md).
   *
   *  Before first contact (`serverFullTelemetry === null`) both opt-ins still
   *  ADD the mirror on top of the code-configured mode, and an in-code false is
   *  still never a veto over a server ON. Always gated off when the runtime is
   *  disabled or the emergency kill-switch is set. */
  function effectiveSnapshotUploadAllowed(): boolean {
    if (!enabled || isBoosthisDisabled()) return false;
    if (serverFullTelemetry === false) return false;
    return (
      effectiveFullMode() || explicitShareMeterWithAI || serverShareMeterWithAI
    );
  }

  /** Single source of truth for wiring the snapshot submitter + auto-upload
   *  timer. Clearing the submitter (not just stopping the timer) is required
   *  because uploadPerfSnapshotNow() calls the submitter DIRECTLY, bypassing the
   *  timer — so a stale submitter would leak a full snapshot on a manual flush
   *  even after the timer stops. Used at init, enable(), disable(), and after a
   *  consent response flips the server directive on. */
  function syncSnapshotUpload(): void {
    if (effectiveSnapshotUploadAllowed()) {
      setSnapshotSubmitter((snap) => client.transmitSnapshot(snap));
      startSnapshotAutoUpload();
      // Trace spans carry code-defined route labels too, so they share the
      // exact same allow-gate as the snapshot mirror: nothing span-shaped is
      // retained or shipped on a private app until sharing is authorized.
      setSpanSubmitter((spans) => client.transmitSpans(spans));
      startSpanAutoFlush();
    } else {
      setSnapshotSubmitter(null);
      stopSnapshotAutoUpload();
      setSpanSubmitter(null);
      stopSpanAutoFlush();
    }
  }

  /** Record the server's "Full telemetry" directive. ONE path for both places
   *  the directive can arrive (the consent response and the explicit
   *  applyServerFullTelemetry call) so the value can never be adopted without
   *  also being persisted. A no-op when unchanged; otherwise it flips the
   *  three-state value, writes it to kit-owned storage so the next launch
   *  resumes it, and recomputes BOTH gates. The sampler recompute is gated on
   *  `enabled` + the kill-switch so this never overrides
   *  disable()/forget()/BOOSTHIS_DISABLED; syncSnapshotUpload() self-guards on
   *  the same conditions. When disabled the flag is still recorded so a later
   *  enable() recomputes the correct effective mode. */
  function adoptServerFullTelemetry(on: boolean): Promise<void> {
    if (typeof on !== "boolean" || on === serverFullTelemetry) {
      return Promise.resolve();
    }
    serverFullTelemetry = on;
    // A known server ON ALWAYS wins and is never overridden by an in-code or
    // pre-contact preference — and that includes a stale OFF latch. So clear the
    // not-durable-OFF latch the moment an ON is adopted in memory, BEFORE the
    // durable write is even attempted. Otherwise a failed OFF followed by an ON
    // whose write also cannot be confirmed would leave the session forced OFF
    // forever (effectiveFullMode() short-circuits on the latch). A non-durable
    // ON is safe: the next launch simply falls back to the pre-contact default.
    // See .agents/memory/phone-kit-sharing-posture.md.
    if (on) directivePersistFailedOff = false;
    // Both answers are now known. Said once per session, naming the code's
    // request and what is actually in force.
    noteTelemetryModeContradiction();
    // Apply in memory FIRST so the session already reflects the directive, then
    // make it DURABLE. An OFF must not be lost: a fire-and-forget write that
    // fails (or the app dying right after) leaves the next launch with no
    // stored value, which reads as "not asked yet" and resumes screen-bearing
    // uploads under the pre-contact "share" default — silently overriding an
    // owner who switched sharing off. So the write is awaited and retried once;
    // if it still cannot be stored we KEEP THE SESSION CLOSED and surface the
    // failure rather than trusting a memory-only OFF a restart would drop. The
    // in-memory recompute below happens immediately; the returned promise lets
    // async callers (the consent response, the client method) AWAIT the durable
    // write so a known OFF's persistence outcome is settled before they return.
    const durable = persistFullTelemetryDurable(on);
    if (enabled && !isRuntimeInert()) {
      setProdSamplerConsent(effectiveFullMode());
    }
    syncSnapshotUpload();
    return durable;
  }

  /** Persist the server "Full telemetry" directive with an AWAITED write and
   *  ONE retry, verifying the value landed by reading it back. On an OFF that
   *  cannot be confirmed durable, latch the session closed
   *  (`directivePersistFailedOff`) so it never falls back to the pre-contact
   *  default, and recompute both gates. An ON that cannot persist is harmless
   *  to the owner's OFF invariant (the default is already share), so it is not
   *  latched — but a confirmed write in either direction clears a prior latch.
   *  Never throws: storage is host-provided and may be absent. */
  async function persistFullTelemetryDurable(on: boolean): Promise<void> {
    const want = on ? "1" : "0";
    let persisted = false;
    // The stored directive is Boosthis-shaped state, so it erases like a
    // credential: join the same serialized write chain and carry the same
    // generation. forget() awaits that chain BEFORE it removes the keys, so a
    // write still in flight cannot land after the removal and hand the next
    // launch a directive from a connection the user has erased. Checked per
    // attempt, because the retry is another await erasure can complete inside.
    const scheduledAt = credentialGeneration;
    const write = credentialWrites.then(async () => {
      for (let attempt = 0; attempt < 2 && !persisted; attempt++) {
        if (scheduledAt !== credentialGeneration) return; // erased meanwhile
        try {
          await platform().storage.set(fullTelemetryStoreKey, want);
          const readBack = await platform().storage.get(fullTelemetryStoreKey);
          persisted = readBack === want;
        } catch {
          /* try again on the next loop, then give up */
        }
      }
    });
    // Keep the shared chain non-rejecting; the caller still awaits this write.
    credentialWrites = write.catch(() => {});
    await write;
    // Erased while we waited: forget() owns every gate now, and the value we
    // were asked to make durable no longer describes anything on file.
    if (scheduledAt !== credentialGeneration) return;
    // Only act if the in-memory directive is STILL this value — a newer
    // directive may have superseded it while the write was in flight.
    if (serverFullTelemetry !== on) return;
    if (!on && !persisted) {
      directivePersistFailedOff = true;
      // Recompute the gates: the raw sampler and the snapshot mirror must both
      // stay closed for a known OFF we could not make durable.
      if (enabled && !isRuntimeInert()) setProdSamplerConsent(effectiveFullMode());
      syncSnapshotUpload();
    } else if (persisted && directivePersistFailedOff) {
      directivePersistFailedOff = false;
      if (enabled && !isRuntimeInert()) setProdSamplerConsent(effectiveFullMode());
      syncSnapshotUpload();
    }
  }

  const client: TelemetryClient = {
    get installId() { return activeInstallId; },
    get endpoint() { return endpoint; },
    get enabled() { return enabled && !isRuntimeInert(); },
    get issuesOnly() { return issuesOnly; },
    get deleteToken() { return deleteToken; },
    get readToken() { return readToken; },
    get fetchImpl() { return fetchOptions.fetchImpl; },
    get projectKey() { return projectKey; },
    get fullTelemetryEffective() { return effectiveFullMode(); },
    get dashboardSharingActive() { return effectiveSnapshotUploadAllowed(); },
    get sharingOffNotDurable() { return directivePersistFailedOff; },

    applyServerFullTelemetry(on: boolean) {
      // Same single path as the consent-response directive-apply, so an
      // out-of-band directive is persisted for the next launch too. Returns the
      // durable-write promise so a caller can await an OFF's persistence
      // outcome; the in-memory directive is already applied synchronously.
      return adoptServerFullTelemetry(on);
    },

    async consent() {
      // Registration is the handshake that LEADS to activation, so it must be
      // allowed through the ACTIVATION LOCK — gating it on the full inert
      // check deadlocks every fresh install (locked → consent refused → no
      // token → check-in can't run → never activates). The killed-only gate
      // still silences a real kill: the env kill-switch, a non-active server
      // answer, and a lapsed grace window. The transport applies the same
      // narrowed gate via `allowWhenLocked` inside postConsent, and a copied
      // kit with no credential is still refused by postConsent's precondition.
      if (!enabled || _isRuntimeKilledInternal()) return 0;
      return postConsent();
    },

    async transmit(samples) {
      maybeRefreshCoverage();
      if (!enabled || isRuntimeInert() || samples.length === 0) return 0;
      // A rotated install must upload under its post-rotation identity —
      // adopt any persisted rotation before building the payload. This also
      // restores the PERSISTED server directive, which is why the full-mode
      // gate below is read AFTER the await: on a relaunch holding a persisted
      // delete token there is no consent round-trip to wait for, so reading
      // the gate first would ship screen-bearing samples under the
      // pre-contact default and silently override an owner's OFF.
      await storageReady;
      // Per-screen samples (they carry screen names) only leave the device in
      // effective full mode: code-configured full, OR the dashboard "Full
      // telemetry" directive. Plain issues-only ships only candidate
      // signatures.
      if (!effectiveFullMode()) return 0;
      // Lazy consent — if the host never managed to capture a delete_token
      // (e.g. offline at enable() time) retry now before the server 401s us.
      if (!deleteToken) {
        await postConsent();
      }
      // Race re-check: caller may have flipped `disable()` while we
      // were awaiting consent above. Honor the latest intent before
      // any bytes leave the device.
      if (!enabled || isRuntimeInert()) return 0;
      // …and re-read the SHARING gate too. The consent answer we just awaited
      // is itself the owner's directive: a tokenless install can learn "off"
      // in that very round-trip, and shipping this batch anyway would spend
      // the owner's OFF on the first thing they wanted stopped.
      if (!effectiveFullMode()) return 0;
      if (!deleteToken) return 0;
      // Match v0.2.1 batch cap. Larger batches are silently truncated;
      // the host can call transmit() repeatedly to drain its queue.
      const batch = samples.length > 100 ? samples.slice(0, 100) : samples;
      // Build the enriched batch with two hardening measures:
      //
      // 1. routeLabel is truncated to 100 chars. Labels are code-defined
      //    screen names (e.g. "OrderDetail") that must never carry user content;
      //    truncation bounds incidental PII exposure if a caller erroneously
      //    embeds dynamic data.
      //
      // 2. metadata is stripped to ONLY the two privacy-safe buckets
      //    (startType + deviceTier). The schema advertises a closed set, but
      //    the original spread let callers sneak arbitrary key/value pairs into
      //    the upload. Picking known keys explicitly enforces the closed-bucket
      //    promise: no arbitrary host metadata can ever leave the device.
      // Allowed enum sets for the two closed metadata buckets. Any value
      // outside these sets is coerced to "unknown" so host-provided strings
      // (which may be PII) can never reach the outbound payload.
      const BOOT_KINDS = new Set<string>(["cold", "warm", "hot", "unknown"]);
      const DEVICE_TIERS = new Set<string>(["low", "mid", "high", "unknown"]);
      const normStartType = (v: unknown): BootKind =>
        typeof v === "string" && BOOT_KINDS.has(v) ? (v as BootKind) : getBootKind();
      const normDeviceTier = (v: unknown): DeviceTier =>
        typeof v === "string" && DEVICE_TIERS.has(v) ? (v as DeviceTier) : getDeviceTier();

      const enriched = batch
        .map((s) => {
          const rawMeta = s.metadata ?? {};
          return {
            ...s,
            routeLabel: s.routeLabel,
            metadata: {
              // Enum-normalized: only allowed values pass; any host-provided
              // string outside the enum (e.g. a user name) is replaced with
              // the runtime-observed value so PII never leaves device.
              startType: normStartType(rawMeta.startType),
              deviceTier: normDeviceTier(rawMeta.deviceTier),
              // All other keys are intentionally omitted (closed-bucket policy).
            },
          };
        })
        .filter((s) => {
          if (safeScreenName(s.routeLabel) === null) {
            warnPartNameRefusal(
              s.routeLabel.length > MAX_PART_NAME ? "too-long" : "invalid",
            );
            return false;
          }
          // Drop samples whose routeLabel contains high-risk PII patterns
          // (UUID, long numeric ID) that the general assertNoPII cannot catch
          // without false-positiving on the UUID-shaped installId field.
          return routeLabelHasPII(s.routeLabel) === null;
        });
      if (enriched.length === 0) return 0;
      const payload = {
        installId: activeInstallId,
        packageVersion,
        samples: enriched,
      };
      assertNoPII(payload);
      try {
        const res = await _safeTransmitInternal(
          `${endpoint}/samples`,
          payload,
          fetchOptions,
          `Bearer ${deleteToken}`,
        );
        // Off the hot path: read the reply's honesty fields (dropped rows the
        // server refused). Fire-and-forget — never awaited, never fails an
        // upload; absence of the fields is a no-op (older server).
        void readDropsFromResponse(res);
        return noteUploadResponse(res) ? enriched.length : 0;
      } catch {
        noteUploadRejected("unreachable");
        return 0;
      }
    },

    async transmitCandidates(signatures) {
      // Always-on for registered apps: issue-candidate reporting is NOT
      // gated by the user-facing enable/disable toggle. Once an app has
      // registered (invited now, public later) it reports automatically.
      // Only the emergency kill-switch (BOOSTHIS_DISABLED) or erasure
      // (forget(), which clears the delete token) can stop it. The
      // server-authority kill-switch (isRuntimeInert) also silences it.
      if (isRuntimeInert() || signatures.length === 0) return 0;
      // Adopt any persisted identity rotation before building the payload.
      await storageReady;
      // Lazy consent — same retry policy as transmit(). If the consent
      // call still fails we drop the batch; the runtime keeps the
      // signature locally and will retry on the next observation.
      if (!deleteToken) {
        await postConsent();
      }
      // Race re-check: the emergency kill-switch may have flipped while
      // the consent call was in flight; forget() may have cleared the
      // token (caught by the next guard). disable() no longer stops
      // issues — they are always-on for registered apps.
      if (isRuntimeInert()) return 0;
      if (!deleteToken) return 0;
      const batch = signatures.length > 50 ? signatures.slice(0, 50) : signatures;
      // Anonymous per-day reach tag (strictly optional): random noise that
      // rotates every calendar day, never derived from any identifier. The
      // server hashes it to one bit of a coarse reach sketch and drops the
      // raw value. Fail-safe — undefined just means no reach signal.
      const reachTag = await getDailyReachTag();
      const payload = {
        installId: activeInstallId,
        packageVersion,
        signatures: batch,
        ...(reachTag ? { reachTag } : {}),
      };
      // Defense in depth — the signatures are constructed by Boosthis
      // itself from kind+bucket+count, so they can't carry user data,
      // but the PII guard still runs in case a future detector kind
      // accidentally embeds a name.
      assertNoPII(payload);
      try {
        const res = await _safeTransmitInternal(
          `${endpoint}/candidates`,
          payload,
          fetchOptions,
          `Bearer ${deleteToken}`,
        );
        // Read the reply's dropped-row fields off the hot path (see transmit()).
        void readDropsFromResponse(res);
        return noteUploadResponse(res) ? batch.length : 0;
      } catch {
        noteUploadRejected("unreachable");
        return 0;
      }
    },

    async transmitResolutions(resolutions) {
      // Always-on for registered apps: fix-resolution reporting is NOT
      // gated by the user-facing enable/disable toggle, exactly like
      // transmitCandidates. Only the emergency kill-switch
      // (BOOSTHIS_DISABLED) or erasure (forget()) can stop it. The
      // server-authority kill-switch (isRuntimeInert) also silences it.
      if (isRuntimeInert() || resolutions.length === 0) return 0;
      // Adopt any persisted identity rotation before building the payload.
      await storageReady;
      // Lazy consent — same retry policy as transmitCandidates().
      if (!deleteToken) {
        await postConsent();
      }
      // Race re-check: the emergency kill-switch may have flipped while
      // the consent call was in flight; forget() may have cleared the
      // token (caught by the next guard). disable() no longer stops fix
      // signals — they are always-on for registered apps.
      if (isRuntimeInert()) return 0;
      if (!deleteToken) return 0;
      const batch =
        resolutions.length > 50 ? resolutions.slice(0, 50) : resolutions;
      const payload = {
        installId: activeInstallId,
        packageVersion,
        resolutions: batch,
      };
      // Defense in depth — resolutions are built by Boosthis itself from
      // rule kind + bucketed rating, so they can't carry user data, but
      // the PII guard still runs in case a future kind embeds a name.
      assertNoPII(payload);
      try {
        const res = await _safeTransmitInternal(
          `${endpoint}/resolutions`,
          payload,
          fetchOptions,
          `Bearer ${deleteToken}`,
        );
        // Read the reply's dropped-row fields off the hot path (see transmit()).
        void readDropsFromResponse(res);
        return noteUploadResponse(res) ? batch.length : 0;
      } catch {
        noteUploadRejected("unreachable");
        return 0;
      }
    },

    async transmitSnapshot(snapshot) {
      maybeRefreshCoverage();
      // The snapshot carries screen labels, so by default it rides the optional
      // full-detail channel (off in issues-only mode). Two scoped exceptions let
      // the already-PII-filtered snapshot mirror upload in issues-only mode: the
      // developer's explicit `shareMeterWithAI` opt-in, OR the server directive
      // (set once they connect an AI from the web dashboard). Both exceptions
      // end the moment the dashboard answers OFF. Either way it is
      // still gated off when disabled or killed, and still runs the
      // routeLabelHasPII filter + assertNoPII below.
      if (!enabled || isRuntimeInert()) return 0;
      // Adopt any persisted identity rotation — and the persisted server
      // directive — before reading the gate (see transmit() for why the order
      // matters on a relaunch that already holds a delete token).
      await storageReady;
      if (!effectiveSnapshotUploadAllowed()) return 0;
      // Lazy consent — mirror transmit(): if the host never captured a delete
      // token (e.g. offline at enable() time) retry now before the server 401s.
      if (!deleteToken) {
        await postConsent();
      }
      // Race re-check: caller may have flipped disable()/forget() while the
      // consent call was in flight. Honor the latest intent before sending.
      if (!enabled || isRuntimeInert()) return 0;
      // The awaited consent answer may itself have said OFF — re-read the gate
      // (see transmit()) so a tokenless install cannot spend the owner's OFF on
      // its first snapshot.
      if (!effectiveSnapshotUploadAllowed()) return 0;
      if (!deleteToken) return 0;
      // Filter every label field in the snapshot before the PII guard runs.
      // Screen names, route-row keys, and cross-cutting finding names are
      // code-defined identifiers, but a developer could accidentally pass a
      // user-derived string. Drop any entry whose label contains a PII pattern.
      const safeRows = snapshot.rows.filter((r) => routeLabelHasPII(r.key) === null);
      const safeScreens = snapshot.screens.filter(
        (s) => routeLabelHasPII(s.screen) === null,
      );
      const safeCrossCutting = snapshot.crossCutting.filter(
        (f) => routeLabelHasPII(f.name) === null,
      );
      // Rebuild summary from safeScreens so it never names a dropped screen.
      const safeScreenNames = new Set(safeScreens.map((s) => s.screen));
      const summary =
        typeof snapshot.summary === "string" &&
        safeScreenNames.has(snapshot.summary)
          ? snapshot.summary
          : typeof snapshot.summary === "string" &&
              routeLabelHasPII(snapshot.summary) === null
            ? snapshot.summary
            : "";
      // The screen list is a NEW way for labels to reach the wire, so it is
      // re-audited here rather than trusted from where it was built. An entry
      // that fails is DROPPED, never redacted into something that would read
      // as a screen. `total` is left alone deliberately: it states how many
      // the merge held, so a shortened list still reads as "at least".
      const safeRouteList = snapshot.routeList
        ? {
            ...snapshot.routeList,
            entries: snapshot.routeList.entries.filter(
              (e) => routeLabelHasPII(e.label) === null,
            ),
          }
        : undefined;
      // The control census carries no entries from THIS runtime (it has no
      // control identity to carry), but the screen is written as if it did,
      // so the day one arrives it is audited rather than trusted. A handle
      // must BE a handle — a shape no label, name or value can satisfy —
      // and a destination goes through the same guard every label does.
      const safeControlCensus = snapshot.controlCensus
        ? {
            ...snapshot.controlCensus,
            entries: snapshot.controlCensus.entries.filter(
              (e) =>
                typeof e.handle === "string" &&
                /^c[0-9a-z]{1,8}$/.test(e.handle) &&
                (e.to === undefined || routeLabelHasPII(e.to) === null),
            ),
          }
        : undefined;
      const sanitizedSnapshot = {
        ...snapshot,
        rows: safeRows,
        screens: safeScreens,
        crossCutting: safeCrossCutting,
        summary,
        ...(safeRouteList ? { routeList: safeRouteList } : {}),
        ...(safeControlCensus ? { controlCensus: safeControlCensus } : {}),
      };
      // The screen map rides THIS upload — same gates, same back-off, same
      // batching, no round trip of its own — and only when the host asked
      // for it. A sibling of `snapshot` rather than a field inside it,
      // because the snapshot is stored as sent and this is screened and
      // stored separately.
      const pageMap = sendPageMap ? buildPageMapWire() : null;
      const payload = {
        installId: activeInstallId,
        packageVersion,
        capturedAt: sanitizedSnapshot.capturedAt,
        snapshot: sanitizedSnapshot,
        ...(pageMap ? { pageMap } : {}),
      };
      assertNoPII(payload);
      try {
        const res = await _safeTransmitInternal(
          `${endpoint}/snapshots`,
          payload,
          fetchOptions,
          `Bearer ${deleteToken}`,
        );
        // Read the reply's dropped-row fields off the hot path (see transmit()).
        void readDropsFromResponse(res);
        return noteUploadResponse(res) ? 1 : 0;
      } catch {
        noteUploadRejected("unreachable");
        return 0;
      }
    },

    async transmitCrashes(crashes) {
      // Always-on for registered apps: crash reporting is NOT gated by the
      // user-facing enable/disable toggle or issues-only mode, exactly like
      // transmitCandidates/transmitResolutions. The DEFAULT payload carries no
      // screen names or values (error type + hashed signature + redacted frame
      // + bucketed count), so it is privacy-safe even in issues-only mode. Only
      // the emergency kill-switch (BOOSTHIS_DISABLED) or erasure (forget(),
      // which clears the delete token) can stop it. The server-authority
      // kill-switch (isRuntimeInert) also silences it.
      if (isRuntimeInert() || crashes.length === 0) return 0;
      // Adopt any persisted identity rotation before building the payload.
      await storageReady;
      // Lazy consent — same retry policy as transmitCandidates().
      if (!deleteToken) {
        await postConsent();
      }
      // Race re-check: the kill-switch may have flipped or forget() cleared the
      // token while the consent call was in flight.
      if (isRuntimeInert()) return 0;
      if (!deleteToken) return 0;
      const batch = crashes.length > 50 ? crashes.slice(0, 50) : crashes;
      const payload = {
        installId: activeInstallId,
        packageVersion,
        crashes: batch,
      };
      // Defense in depth — each crash is scrubbed + PII-guarded on-device by the
      // crash reporter (summary dropped if it trips the guard, paths reduced to
      // basenames), so this guard should never fire, but it runs anyway to honor
      // the privacy contract for the whole payload before it leaves the device.
      assertNoPII(payload);
      try {
        const res = await _safeTransmitInternal(
          `${endpoint}/crashes`,
          payload,
          fetchOptions,
          `Bearer ${deleteToken}`,
        );
        // Read the reply's dropped-row fields off the hot path (see transmit()).
        void readDropsFromResponse(res);
        return noteUploadResponse(res) ? batch.length : 0;
      } catch {
        noteUploadRejected("unreachable");
        return 0;
      }
    },

    async transmitJobRuns(runs, expectations) {
      // Always-on for a registered app, on the same terms as crashes: only
      // the kill-switch or erasure silences it. A job name is code-defined
      // and screened on the way in, and a run carries no field describing
      // what the job did.
      if (isRuntimeInert()) return 0;
      if (runs.length === 0 && expectations.length === 0) return 0;
      // Adopt any persisted identity rotation before building the payload.
      await storageReady;
      // Lazy consent — same retry policy as the other always-on channels.
      if (!deleteToken) {
        await postConsent();
      }
      // Race re-check: the kill-switch may have flipped, or forget() cleared
      // the token, while the consent call was in flight.
      if (isRuntimeInert()) return 0;
      if (!deleteToken) return 0;
      const payload = {
        installId: activeInstallId,
        packageVersion,
        runs,
        ...(expectations.length > 0 ? { expectations } : {}),
      };
      // Defence in depth: each name was screened by jobName() before it was
      // ever buffered, so this should never fire — it runs anyway, because
      // the whole-payload guard is the contract.
      assertNoPII(payload);
      try {
        const res = await _safeTransmitInternal(
          `${endpoint}/job-runs`,
          payload,
          fetchOptions,
          `Bearer ${deleteToken}`,
        );
        const delivered = noteUploadResponse(res);
        // ONE read of this reply, because it carries two things: the
        // dropped-row fields every upload answers with, and what the server
        // did with any rhythm this batch declared. Reading the body twice
        // would give the second reader nothing.
        try {
          const body = await (
            res as { json?: () => Promise<unknown> } | null
          )?.json?.();
          noteServerDrops(body);
          const outcomes = parseExpectationOutcomes(body);
          // `undefined` is a server that said nothing about declarations —
          // an older one — and leaves every declaration open on purpose.
          if (outcomes) noteJobExpectationOutcomes(outcomes);
        } catch {
          /* no body, not JSON, unreadable — nothing to record, by contract */
        }
        // A delivered batch with no runs in it — a rhythm stated before the
        // first run ever happened — still counts as reaching Boosthis, so the
        // declaration is not sent again for ever.
        return delivered ? Math.max(runs.length, 1) : 0;
      } catch {
        noteUploadRejected("unreachable");
        return 0;
      }
    },

    async transmitSpans(spans) {
      // Trace spans carry code-defined route labels, so they ride the SAME
      // gate as the snapshot mirror: off by default, on in full mode or once
      // the developer connects an AI (explicit `shareMeterWithAI` opt-in OR the
      // server directive) — and off again once the dashboard answers OFF.
      // Still gated off when disabled or killed.
      if (!enabled || isRuntimeInert() || spans.length === 0) return 0;
      // Adopt any persisted identity rotation — and the persisted server
      // directive — before reading the gate (see transmit() for why the order
      // matters on a relaunch that already holds a delete token).
      await storageReady;
      if (!effectiveSnapshotUploadAllowed()) return 0;
      // Lazy consent — mirror transmitSnapshot(): retry consent if the host
      // never captured a delete token before the server 401s.
      if (!deleteToken) {
        await postConsent();
      }
      // Race re-check: caller may have flipped disable()/forget() while the
      // consent call was in flight. Honor the latest intent before sending.
      if (!enabled || isRuntimeInert()) return 0;
      // The awaited consent answer may itself have said OFF — re-read the gate
      // (see transmit()) so a tokenless install cannot spend the owner's OFF on
      // its first batch of spans.
      if (!effectiveSnapshotUploadAllowed()) return 0;
      if (!deleteToken) return 0;
      // Drop any span whose label carries a PII pattern. RN span labels are
      // produced as "METHOD /path" by spanLabel(), so they legitimately contain
      // one structural space. Use transmitLabelHasPII — the same guard as Node
      // and web span uploads — which allows that single structural space while
      // still blocking UUID, long numeric id, email, JWT, and any other
      // whitespace-bearing labels ("GET /orders/873451", "Checkout Jane Doe").
      const safe = spans.filter((s) => transmitLabelHasPII(s.routeLabel) === null);
      const batch =
        safe.length > MAX_SPAN_BATCH ? safe.slice(0, MAX_SPAN_BATCH) : safe;
      if (batch.length === 0) return 0;
      const payload = {
        installId: activeInstallId,
        packageVersion,
        spans: batch,
      };
      // Defense in depth — the per-label filter above already dropped any
      // PII-bearing span, but run the whole-payload guard before it leaves.
      assertNoPII(payload);
      try {
        const res = await _safeTransmitInternal(
          `${endpoint}/spans`,
          payload,
          fetchOptions,
          `Bearer ${deleteToken}`,
        );
        // Read the reply's dropped-row fields off the hot path (see transmit()).
        void readDropsFromResponse(res);
        return noteUploadResponse(res) ? batch.length : 0;
      } catch {
        noteUploadRejected("unreachable");
        return 0;
      }
    },

    disable() {
      // disable() now ONLY stops the optional full-detail perf samples.
      // Issue + fix reporting (candidates + resolutions) is always-on for
      // registered apps and is intentionally NOT turned off here — that
      // channel can only be stopped by the emergency kill-switch
      // (BOOSTHIS_DISABLED) or by erasure (forget()). The candidate +
      // resolution submitters therefore stay registered.
      enabled = false;
      // Revoke production sampler consent so no buffered or future
      // full-detail samples can be flushed after the developer opts out.
      setProdSamplerConsent(false);
      // The screen circuit is opt-in full detail too — and the most invasive
      // of it, being the one reading that looks at a URL at all. Held down
      // rather than forgotten, so enable() puts back exactly what the setup
      // asked for.
      setScreenCircuitSuppressed(true);
      // Snapshots are part of the same optional full-detail channel, so clear
      // the submitter AND stop the auto-uploader when the developer opts out.
      // `enabled` is already false above, so syncSnapshotUpload() resolves to the
      // cleared state (clearing the submitter — not just the timer — is required
      // because uploadPerfSnapshotNow() calls it directly).
      syncSnapshotUpload();
    },
    enable() {
      enabled = true;
      // Let the circuit act again if the setup asked for one. Nothing is
      // turned ON here that was never configured: this only lifts the hold
      // disable() put on it.
      setScreenCircuitSuppressed(false);
      // Re-enables the optional full-detail samples. The issue + fix
      // submitters are always-on for registered apps, so they are already
      // registered; re-registering here is idempotent and harmless.
      setCandidateSubmitter((signatures) => client.transmitCandidates(signatures));
      setResolutionSubmitter((resolutions) =>
        client.transmitResolutions(resolutions),
      );
      // Set production sampler consent from the EFFECTIVE mode (code config OR
      // the dashboard "Full telemetry" directive) so a disable→enable cycle
      // restores the sampler in full mode — and in effective issues-only mode
      // it actively REVOKES any prior consent so no screen-bearing samples
      // can leave, even if this client was previously a full-telemetry one.
      setProdSamplerConsent(effectiveFullMode());
      // Restore the snapshot mirror on a disable→enable cycle whenever it is
      // allowed to upload — full mode, or issues-only with the explicit
      // `shareMeterWithAI` opt-in OR the server directive. Plain issues-only
      // with neither never ships screen-bearing snapshots. syncSnapshotUpload()
      // also clears any stale submitter left by a prior full-mode client.
      syncSnapshotUpload();
    },

    async forget() {
      // Local state is wiped unconditionally — even if the client was
      // never granted a delete token, "forget" must leave nothing
      // Boosthis-shaped on the device behind it. Storage is best-effort
      // and never throws.
      // Erase under the CURRENT identity (a rotated install must forget its
      // post-rotation row), then drop the persisted rotation mapping itself —
      // it is Boosthis-shaped state and must not survive erasure.
      //
      // FIRST: invalidate every credential write and every consent answer that
      // is already in flight, then wait for any write that had already started.
      // Without this, a token issued a moment ago could be written back to
      // storage after the keys below were removed, and the next launch would
      // quietly re-use a credential the user asked us to erase.
      // Let a consent that is ALREADY in flight land first, briefly. The token
      // it is about to receive is the only thing that can erase the row that
      // consent just created — dropping it would leave an unreachable row
      // behind. Bounded, because erasure must never hang on the network.
      if (consentsInFlight.size > 0) {
        await Promise.race([
          Promise.allSettled([...consentsInFlight]),
          new Promise((resolve) => setTimeout(resolve, CONSENT_SETTLE_MS)),
        ]);
      }
      credentialGeneration += 1;
      await storageReady;
      await credentialWrites.catch(() => {});
      try {
        await platform().storage.remove(rotationStoreKey);
      } catch {
        /* best-effort — never let storage failure block erasure */
      }
      // The persisted sharing directive is Boosthis-shaped state too — erasure
      // must not leave the next launch resuming a directive from a connection
      // that no longer exists.
      try {
        await platform().storage.remove(fullTelemetryStoreKey);
      } catch {
        /* best-effort — never let storage failure block erasure */
      }
      // The kit's own credential copies are Boosthis-shaped state too —
      // erasure must not leave a token behind that a relaunch would re-use.
      try {
        await platform().storage.remove(deleteTokenStoreKey);
      } catch {
        /* best-effort — never let storage failure block erasure */
      }
      try {
        await platform().storage.remove(readTokenStoreKey);
      } catch {
        /* best-effort — never let storage failure block erasure */
      }
      try {
        await platform().storage.remove(projectStoreKey);
      } catch {
        /* best-effort — never let storage failure block erasure */
      }
      // Stop the server-authority kill-switch heartbeat — erasure means the
      // kit must stop phoning home entirely.
      stopEntitlementCheckin();
      // Erase the persisted entitlement cache and RE-ENGAGE the activation
      // lock: after forget() this copy of the kit is indistinguishable from a
      // never-connected one and must not run until a fresh handshake.
      await clearEntitlementCache();
      setCandidateSubmitter(null);
      setResolutionSubmitter(null);
      setSnapshotSubmitter(null);
      setCrashSubmitter(null);
      stopSnapshotAutoUpload();
      // Tear down the span mirror too: stop the flusher, unwire the submitter
      // (making enqueueSpan inert), and drop any buffered spans.
      setSpanSubmitter(null);
      stopSpanAutoFlush();
      clearBufferedSpans();
      // Tear down the crash handlers (restoring the host's previous global
      // handler) and erase any persisted pending crashes. Always-on channels
      // are stopped only by forget() or the kill-switch, so this is the place.
      await uninstallCrashHandlers();
      // Background work is an always-on channel too, so erasure is the only
      // thing that stops it: unwire the submitter, stop the flusher, drop
      // every buffered run and every stated rhythm, and take the wrapper back
      // off the host's own `defineTask`.
      setJobRunSubmitter(null);
      stopJobRunAutoFlush();
      clearBufferedJobRuns();
      clearJobRhythmDeclarations();
      uninstallBackgroundTaskTracking();
      // Restore the host's original global timers and drop all Timer Health
      // state — erasure must leave nothing Boosthis-shaped wrapping the host.
      uninstallTimerTracking();
      // Stop the always-on frame sampler (and its AppState listener) — erasure
      // must leave nothing Boosthis-shaped ticking on the device.
      uninstallFrameSampling();
      // Remove the AppState "memoryWarning" listener too — erasure must leave
      // nothing Boosthis-shaped listening on the device.
      uninstallMemoryWarningTracking();
      // Restore the MessageQueue spy and React.createElement, and drop all
      // additive-RN-axis state — erasure must leave nothing Boosthis-shaped
      // wrapping the host. (Screen-leaks per-screen tagging is cleared inside
      // uninstallTimerTracking above.)
      uninstallBridgeTracking();
      // Restore the host's console.error — erasure must leave nothing Boosthis-
      // shaped chained onto the host's logging.
      uninstallSwallowedErrorTracking();
      // Put the app's own WebSocket/EventSource constructors back and drop
      // every tracked connection — erasure must leave nothing Boosthis-shaped
      // wrapping the host's transports.
      uninstallLiveConnections();
      // THE ORDER OF THE NEXT TWO IS LOAD-BEARING. Image Weight and the mount
      // census wrap the SAME functions — React.createElement and the
      // automatic JSX runtime's jsx/jsxs/jsxDEV — and the census went on
      // SECOND, so what it holds as "the host's own function" is Image
      // Weight's wrapper. Taken off in install order, the census's restore
      // would put that wrapper BACK: erasure would leave the host Boosthis-
      // shaped, and a later enable would stack a second interception over the
      // resurrected one, counting every element twice from then on. Last in,
      // first out.
      //
      // Put React's own createElement / JSX runtime back and drop every
      // counted container — erasure must leave nothing Boosthis-shaped
      // wrapping the host's element creation.
      uninstallMountCensus();
      resetMountCensus();
      // ...and only now the interception that went on underneath it.
      uninstallImageWeightTracking();
      resetImageWeight();
      resetReRenders();
      resetNavDeadTime();
      resetJsStartup();
      // Stand the optional transport wrappers down. They are made inert
      // rather than unwound: by now the host may have wrapped OUR wrapper,
      // and restoring a captured original would throw the host's own layer
      // away. Nothing Boosthis-shaped reports another attempt after this.
      resetNetworkAutoWrap();
      // The circuit holds a journey, an open screen and a settle timer. An
      // erasure keeps nothing of any of them, and the switch goes back off:
      // a kit that was forgotten must not still be drawing a map.
      _screenCircuitInternals.reset();
      // Remove the lifecycle/device listeners (AppState/Dimensions/Appearance/
      // Keyboard) — erasure must leave nothing Boosthis-shaped listening.
      uninstallLifecycleTracking();
      // Restore the host's ErrorUtils global handler and remove the passive
      // 'unhandledrejection' listener — erasure must leave nothing Boosthis-
      // shaped chained onto the host's error/rejection paths.
      uninstallUnhandledErrorTracking();
      uninstallPromiseRejectionTracking();
      // Restore the wrapped AsyncStorage methods and drop the Hermes heap/GC
      // checkpoints — erasure must leave nothing Boosthis-shaped wrapping the
      // host or buffered on the device.
      uninstallStorageTracking();
      // Restore the app's original XHR methods and erase the aggregate AI-call
      // counters. The watcher never patches fetch separately: RN's fetch
      // already travels through this same send point.
      uninstallAiCallWatch();
      resetHermesSamples();
      // Drop the wired build stamp (Patch Lag meter source) — erasure must
      // leave nothing Boosthis-shaped, including the build identity, behind.
      clearBuildIdentity();
      clearBackgroundWork();
      clearUpstreamCache();
      await clearAllCandidates();
      // Erase the anonymous daily reach tag too — erasure must leave
      // nothing Boosthis-shaped on the device.
      await clearReachTag();
      // And the banked watch ledger: a window earned across earlier runs is
      // as much "behind" as a cached credential is, and erasure must leave
      // no record that this app was ever watched. The next launch starts
      // from nothing banked. See watchHistory.ts.
      await clearWatchHistory();
      // Erasure must leave nothing Boosthis-shaped behind: drop the SELF-scoped
      // read token from memory too (it is a local secret, no network call needed).
      readToken = null;
      if (!deleteToken) {
        enabled = false;
        setProdSamplerConsent(false);
        return 0;
      }
      // Kill-switch honors silence even on erasure: when BOOSTHIS_DISABLED
      // is set the runtime must not touch the network at all. We still
      // clear the in-memory token + disable the client locally so the
      // host app's state matches the user's intent.
      if (isBoosthisDisabled()) {
        deleteToken = null;
        enabled = false;
        setProdSamplerConsent(false);
        return 204;
      }
      // GDPR right-to-erasure: bypass safeTransmit because the
      // PII guard would (correctly, in general) reject the
      // server-issued `deleteToken` field. The payload shape is
      // fixed and contains only the install_id + the token we are
      // returning — no user data. See rawPost() for the rationale.
      const token = deleteToken;
      try {
        const res = await rawPost(`${endpoint}/installs/forget`, {
          installId: activeInstallId,
          deleteToken: token,
        });
        deleteToken = null;
        enabled = false;
        // Revoke production sampler consent on forget so any buffered
        // samples are dropped and no further samples can be sent.
        setProdSamplerConsent(false);
        return res.status;
      } catch {
        return 0;
      }
    },
  };

  // Wire the build stamp (Patch Lag meter source) from the init options. The
  // setter validates both fields independently and drops anything malformed —
  // a finite PAST epoch-ms buildTimeMs and a 7–40 char hex buildCommit. When
  // neither is valid it stays absent, so there is no build object and no
  // patchLag axis (honest absence). This is display-only and never feeds the
  // Speed score. Cleared again by forget().
  setBuildIdentity(
    { buildTimeMs: opts.buildTimeMs, buildCommit: opts.buildCommit },
    Date.now(),
  );

  // Self-register the auto-submitter the moment telemetry is enabled.
  // Host apps don't have to wire anything — `ingestFindings` will fire
  // this for any signature that crosses the local recurrence threshold.
  // On disable()/forget() we clear it again so opt-out is immediate.
  setCandidateSubmitter((signatures) => client.transmitCandidates(signatures));
  setResolutionSubmitter((resolutions) =>
    client.transmitResolutions(resolutions),
  );

  // Coverage freshness rides the ALWAYS-ON entitlement check-in (launch, the
  // activation chase, every app open, then the heartbeat) as well as the
  // gated uploads. Without it a private app — no samples, no snapshot — would
  // report the inventory it had at boot and never correct it, so a screen
  // timed or a network call made a moment later would leave the project page
  // reading "not reporting" forever. Change-only and hard-capped inside the
  // hook; cleared by forget() with the rest of the check-in state.
  setCoverageRefreshHook(maybeRefreshCoverage);

  // Self-register the crash reporter and install the global crash handlers
  // ONCE. Like candidates/resolutions, crash reporting is always-on for a
  // registered app — so the handlers stay installed across disable()/enable()
  // and are only torn down by forget(). installCrashHandlers is idempotent (it
  // never re-chains the global handler), so a repeat enableTelemetry() call just
  // refreshes the detailed-mode flag. The detailed (summary + frames) channel
  // is opt-in per app via opts.crashDetails; default off ships only the
  // privacy-safe minimal fingerprint.
  setCrashSubmitter((crashes) => client.transmitCrashes(crashes));
  installCrashHandlers({ detailed: opts.crashDetails ?? false });

  // Self-register the background-work reporter and start watching the app's
  // own scheduled work. Always-on for a registered app, for the same reasons
  // as crash reporting, and torn down only by forget().
  //
  // `installBackgroundTaskTracking` wraps `TaskManager.defineTask` so every
  // Expo background task this app defines is timed as the OS runs it, with
  // the app changing nothing. `discoverBackgroundTasks` then asks the
  // platform what it already has registered from an earlier launch — which is
  // how "this app schedules no background work" becomes a reading somebody
  // took rather than a silence. Both are best-effort and no-ops outside Expo.
  setJobRunSubmitter((runs, expectations) =>
    client.transmitJobRuns(runs, expectations),
  );
  installBackgroundTaskTracking();
  startJobRunAutoFlush();
  void discoverBackgroundTasks();

  // Install the Timer Health tracker: wrap the global set/clear timers ONLY to
  // count outstanding timers (the leak-trend signal). Best-effort and fully
  // guest-safe — every wrapper delegates to the captured original and returns
  // its exact value, all bookkeeping is try/catch'd, and any failure falls back
  // to NOT tracking (the axis then reads pending) so the host's timers are never
  // left broken. Idempotent; torn down only by forget() (restoring originals).
  // The outstanding count is sampled at the existing frame cadence (no new
  // poller) — see FrameSampler.tick → sampleTimerCount().
  installTimerTracking();

  // Start the rAF frame sampler — the source of the Smoothness, Stability,
  // Frame Floor, Frozen Frames, App Hang and Idle Efficiency axes, and the tick
  // the Timer Health / Hermes checkpoints ride on. Started HERE, at kit boot,
  // because a measurement must never depend on a display surface: it used to be
  // started only by the in-app dashboard's mount effect, so an app that hid the
  // bubble (or simply never opened the panel) reported every frame-derived
  // meter as "warming up" forever. Observe unconditionally, draw conditionally.
  // Idempotent + guest-safe (a host without requestAnimationFrame just doesn't
  // sample); torn down only by forget().
  installFrameSampling();

  // Attach the AppState "memoryWarning" listener (RN-exclusive device signal:
  // how often the OS asks the app to free memory before an OOM kill). Best-
  // effort + fully guest-safe — if AppState is missing or wiring throws it
  // stays OFF and the axis reads pending; the host is never touched. Idempotent;
  // torn down only by forget() (removing the subscription).
  installMemoryWarningTracking();

  // Install the Bridge Traffic tracker: on the OLD architecture, chain the
  // MessageQueue spy to count JS↔native calls (calls/min). On the NEW arch
  // (Bridgeless/JSI) it records newArch and installs nothing (JSI is invisible
  // from JS). Best-effort + guest-safe — the spy chains any existing spy, its
  // counter is try/catch'd, and any failure falls back to NOT tracking (axis
  // reads pending). Idempotent; torn down only by forget() (restoring the spy).
  installBridgeTracking();

  // Install the Swallowed Errors tracker (PORT of the Python kit's Near-Miss
  // Rate): CHAIN console.error to count host-logged errors the app survived
  // (timestamps only — never the message/args), scoring near misses per hour.
  // Fully guest-safe — the wrapper calls the host's console.error FIRST, byte-
  // identically, returns its exact result, re-entrancy-guards so Boosthis's own
  // logging is never counted, and any failure falls back to NOT tracking (axis
  // reads measurable:0). Idempotent; torn down only by forget() (restoring the
  // host's console.error).
  installSwallowedErrorTracking();

  // Install the Live Connections watcher: wrap the app's own WebSocket (and
  // EventSource, when the app polyfilled one) so a chat socket, presence
  // channel or streamed answer is seen for what it is — a connection that
  // lives for minutes, which every other reading here is blind to. The real
  // constructor is always called and its instance always returned; our
  // listeners are ADDED alongside the app's, never in place of them, and they
  // read nothing but the clock. Idempotent; torn down by forget().
  installLiveConnections();

  // Install the Image Weight tracker: a DEFAULT-ON, fully-guarded
  // React.createElement interception for RN <Image> that chains onLoad
  // (decoded size) + onLayout (displayed box) to measure decode-vs-display
  // overfetch. Every wrapper delegates byte-identically to host handlers and
  // returns their exact value; any failure falls back to relying on manual
  // recordImage() calls (axis reads pending). Release-safe. Idempotent; torn
  // down only by forget() (restoring the original createElement).
  //
  // `trackImageWeight: false` refuses it: nothing is intercepted and the axis
  // says it is switched off in this build rather than warming up for ever.
  if (opts.trackImageWeight === false) {
    safeRun("imageWeightRefused", () => {
      refuseImageWeightTracking();
    });
  } else {
    // Written as a statement, not an inline arrow expression: the teardown-order
    // guard in mountCensus.test.ts reads THIS file and locates the call by its
    // literal text, so that Image Weight going on before the mount census (and
    // coming off after it) stays checkable.
    safeRun("imageWeight", () => {
      installImageWeightTracking();
    });
  }

  // Install the mount census: the same guarded React.createElement + automatic
  // JSX runtime interception, counting the direct children handed to a scroll
  // container. This is the release-safe half of the render story — React's
  // <Profiler onRender> is a no-op in production, so a screen that mounts an
  // entire API batch in one commit is invisible to every other render-side
  // reading there. Reads a count, a container type name and the screen label
  // the kit already holds; nothing about the person using the app and no prop
  // value of any child. Every wrapper delegates byte-identically and returns
  // the host's exact value. Idempotent; torn down only by forget().
  installMountCensus();

  // Read back what EARLIER runs of this app on this device watched, before
  // the listeners below start adding to it. Seven of this kit's readings are
  // per-hour rates, and a phone app is used in bursts of a few minutes: a
  // window earned inside one run is a window they never reach, so each run
  // banks what it watched and the next launch adds it in. Asynchronous and
  // deliberately not awaited — a reading taken before it lands simply has
  // nothing banked, which is the pre-ledger behaviour and never a fabricated
  // total. Scoped to the project key, so a ledger earned under another
  // project is dropped rather than pooled. Erased by forget().
  // See docs/decisions/rate-window-earned-across-sessions.md.
  safeAsync("watchHistoryArm", () => armWatchHistory({ projectKey: inviteKey }));

  // Attach the lifecycle/device listeners (foreground residency, background-
  // return recovery, dimension/appearance churn, keyboard transition latency).
  // All are RN's own event subscriptions — no new poller, nothing that keeps
  // the app awake or fires while backgrounded. Best-effort + guest-safe: each
  // subscription is feature-detected independently, every handler is wrapped so
  // a throw can't reach the host's dispatch, and any missing API just leaves
  // that axis pending. Idempotent; every listener removed only by forget().
  installLifecycleTracking();

  // Chain the RN ErrorUtils global handler to COUNT (never suppress) unhandled
  // JS errors — the host's previous handler is ALWAYS called with the original
  // isFatal flag, so RN's red-box / fatal behaviour and the host's crash
  // reporter are unchanged. Best-effort + guest-safe; if ErrorUtils is missing
  // the axis reads pending. Idempotent; restored only by forget().
  //
  // DEFAULT-ON. `trackUnhandledErrors: false` refuses it: nothing is chained,
  // the app's own handler is untouched, and the axis says it is switched off
  // in this build. The same switch governs the passive rejection listener
  // installed below — they are one collector with two surfaces.
  if (opts.trackUnhandledErrors === false) {
    safeRun("unhandledErrorsRefused", () => {
      refuseUnhandledErrorTracking();
    });
  } else {
    safeRun("unhandledErrors", () => {
      installUnhandledErrorTracking();
    });
  }

  // Automatic network attempt reporting — DEFAULT-ON. Wraps `fetch` and
  // `XMLHttpRequest` to report the same two values the manual API accepts (a
  // duration and a coarse outcome) and nothing else; no URL, host or status
  // is read at any point. Every wrapper calls the host's original and returns
  // its exact value. Re-asserted on the reporting cadence so a host shim
  // installed later cannot switch it off, and one attempt is reported once
  // however many of OUR layers see it — including a call the host times
  // itself with `measureNetworkAttempt`. `recordNetworkAttempt` is not
  // de-duplicated against it: it arrives after the fact as a duration and an
  // outcome word, which cannot say which request they belong to, so it is for
  // transports the kit cannot reach.
  //
  // `autoWrapNetwork: false` refuses it: no transport of this app's is
  // touched, and the axis says it is switched off in this build rather than
  // showing a reader "measuring…" for something nobody ever started.
  // The circuit, if it was asked for — settled BEFORE the transports are
  // wrapped, because the wrappers read the switch as they install and the
  // XHR half only puts its `open` wrapper on while the switch is on.
  if (opts.traceScreens === true || typeof opts.traceScreens === "object") {
    safeRun("screenCircuit", () =>
      enableScreenCircuit(
        typeof opts.traceScreens === "object" ? opts.traceScreens : {},
      ),
    );
  } else {
    // SETTLED, not merely left alone. This call is the whole statement of what
    // the developer wants wired, so a configuration that does not ask for the
    // circuit must turn one off that an earlier call switched on — otherwise
    // spans, URL reads and trace headers keep running under a setup whose own
    // documentation says they are off. Absent and `false` are the same answer
    // to that question.
    safeRun("screenCircuitOff", () => disableScreenCircuit());
  }

  if (opts.autoWrapNetwork === false) {
    safeRun("networkAutoWrapRefused", () => refuseNetworkAutoWrap());
  } else {
    safeRun("networkAutoWrap", () =>
      installNetworkAutoWrap(
        typeof opts.autoWrapNetwork === "object" ? opts.autoWrapNetwork : {},
      ),
    );
  }

  // Attach a PASSIVE 'unhandledrejection' listener WHERE THE HOST EXPOSES IT
  // (many RN runtimes don't). Never calls preventDefault — the host's rejection
  // handling is untouched; we only tally. Best-effort + guest-safe; absent when
  // the event doesn't exist. Idempotent; removed only by forget().
  // Governed by the same `trackUnhandledErrors` switch as the error chain.
  if (opts.trackUnhandledErrors === false) {
    safeRun("promiseRejectionsRefused", () => refusePromiseRejectionTracking());
  } else {
    safeRun("promiseRejections", () => installPromiseRejectionTracking());
  }

  // Attach the AsyncStorage latency/failure wrappers — ENV-GATED
  // (BOOSTHIS_STORAGE_METER) AND only when the host ALREADY provides
  // AsyncStorage (never adds the dependency). Each wrapper calls the host's
  // original, returns its exact promise, and observes on a non-mutating copy so
  // the host's rejection is never swallowed. Best-effort + guest-safe; ABSENT
  // when the flag is off or AsyncStorage isn't installed. Removed only by
  // forget() (restoring the originals).
  installStorageTracking();

  // Set production sampler consent from the EFFECTIVE mode now that the host
  // app has explicitly opted in by calling enableTelemetry(). This is the only
  // code path that allows perfProdSampler to flush to the network. We set
  // consent explicitly (not just grant) so effective issues-only mode actively
  // REVOKES any stale consent left by a previous full-telemetry client —
  // sampler global consent state survives across enableTelemetry() calls, so a
  // full→issues transition without an intervening disable()/forget() must
  // still result in the sampler being off. At init the server directive is
  // still unknown (false), so this resolves to the code config; a consent
  // response reporting fullTelemetry:true re-grants consent moments later.
  setProdSamplerConsent(effectiveFullMode());

  // Self-register the snapshot mirror uploader. It uploads in full mode, OR in
  // issues-only mode when the snapshot mirror is allowed — the developer's
  // explicit `shareMeterWithAI` opt-in, or the server directive once they
  // connect an AI (the snapshot is PII-filtered before transmit; the raw
  // sampler stays off either way). Plain issues-only with neither never ships
  // screen-bearing snapshots. syncSnapshotUpload() also clears any stale
  // submitter left by a prior full-mode client (the global submitter survives
  // across enableTelemetry() calls). disable()/forget()/BOOSTHIS_DISABLED stop it.
  syncSnapshotUpload();

  // Start the server-authority kill-switch heartbeat (Rung 1). The token is
  // read lazily (consent issues it after this point), the fetch is bounded by a
  // Promise.race timer (never an AbortController), and every async step is
  // self-guarded so it can never crash the host. When the server resolves a
  // non-active entitlement, the kit goes inert via isRuntimeInert(). Runs in
  // every mode (full + issues-only) — a registered app must stay killable.
  // Installed via installCheckinConfig() so the heartbeat always points at the
  // CURRENT identity: the storageReady restore and the in-session rotation
  // both re-install it with the rotated id (startEntitlementCheckin is safe to
  // call repeatedly — it replaces the config + timer).
  installCheckinConfig();

  // FRESH-INSTALL ACTIVATION HANDSHAKE. A brand-new install has an invite key
  // but no install token yet, so the launch check-in above cannot run
  // (checkEntitlementNow returns null without a token) and the ACTIVATION
  // LOCK would never release. And while locked, no measuring happens, so the
  // lazy consent retries inside the transmit channels never fire either —
  // without this eager registration a fresh install deadlocks forever.
  // postConsent rides the killed-only transport gate (allowWhenLocked), its
  // precondition keeps a credential-less copied kit silent, and its success
  // path runs checkEntitlementNow() so the lock releases this session.
  // Fire-and-forget and crash-safe; offline failure just retries next launch.
  if (!deleteToken && !readToken && inviteKey) {
    safeAsync("telemetry.firstConsent", () => postConsent());
  }

  // A NEW BUILD OF THE HOST APP IS A NEW RELEASE, AND NOBODY DECLARES IT.
  //
  // The registration above fires only while this install holds no credential,
  // which is right: one registration per install, not one per launch. But the
  // launch that matters for a release is the one AFTER the person updates the
  // app — same install, same stored token, a version string the server has
  // never seen. Nothing above would tell it, so an app could ship ten
  // versions and its release history would stay empty.
  //
  // So: once, on a launch that already holds a credential, compare the version
  // read out of THIS build against the one we last told the server (restored
  // from the store) and re-consent when they differ. Bounded by construction —
  // at most one extra consent per launch, and only on a launch where the app
  // itself changed. An install with no readable version, or one whose version
  // is unchanged, posts nothing at all.
  safeAsync("telemetry.appVersionCheckin", async () => {
    await storageReady;
    if (!enabled || isBoosthisDisabled()) return;
    if (!deleteToken && !readToken) return; // the registration above owns this
    const current = resolveAppVersion(opts.appVersion)?.version ?? null;
    if (!current || current === lastAppVersionSent) return;
    await postConsent();
  });

  activeTelemetryClient = client;
  return client;
}

export function isPageMapSendEnabled(): boolean {
  return pageMapSendRequested;
}
