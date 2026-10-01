/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/** Public barrel for `boosthis-runtime`.
 *
 * Three layers:
 *  1. Hooks — what app authors call from screens.
 *  2. Engine — perfMonitor, longSession, frameSampler, perfBoot, snapshots.
 *  3. Privacy + telemetry — assertNoPII, safeTransmit, enableTelemetry.
 *
 * The diagnoser (`diagnose`, `runNovelDetectors`, `computeScreenScore`,
 * `computeOverallScore`) is also exported so the in-app dashboard and the
 * AI integration can render reports without re-implementing logic.
 */

// Hooks
export { useBoosthis, usePerfTracker, usePhaseTracker } from "./hooks/useBoosthis";
export {
  useFidSampler,
  getSessionFid,
  getInteractionStats,
  _resetSessionFidForTests,
  _simulateTouchForTests,
} from "./hooks/useFidSampler";
export type { UseFidSamplerResult, InteractionStats } from "./hooks/useFidSampler";
export { useLongSessionDiagnostic } from "./hooks/useLongSessionDiagnostic";
export { resolveBubbleVisibility } from "./bubbleVisibility";

// Engine — event store + timers
export {
  perfMonitor,
  longSession,
  frameSampler,
  makeScreenTimer,
  normalizeApiPath,
} from "./perfMonitor";
export type { PerfEvent, PerfEventKind, FrameStats } from "./perfMonitor";

// Engine — boot ladder
export {
  BOOT_START,
  markBoot,
  getBootScore,
  getBootKind,
  isFirstLaunch,
  confirmFirstLaunch,
  classifyBootKind,
} from "./perfBoot";
export type { BootPhase, BootScoreBreakdown, BootKind } from "./perfBoot";

// Engine — novel detectors
export {
  detectGhostMounts,
  detectThunderingHerd,
  detectStrandedIntervals,
  detectRenderStorms,
  computePerceptionScore,
  runNovelDetectors,
  NAV_ANIMATION_MASK_MS,
  RENDER_STORM_WINDOW_MS,
  RENDER_STORM_MIN,
} from "./perfNovelDetectors";

// Circuit map — ON-DEVICE navigation / interaction integrity view. Its
// FINDINGS never enter the upload path (separate types, not part of
// CrossCuttingFinding / computeMeterAxes / SnapshotPayload).
//
// Its DECLARED screen names do now travel, under the screen-list switch:
// registerNavigationMap’s list merges with whatever a handed-over navigator
// reports and rides the snapshot’s `routeList` block, so the map can draw the
// app’s whole shape rather than only the screens this session opened. See
// routeInventory.ts.
export {
  buildCircuitMap,
  buildCircuitGraph,
  detectDeadEndTaps,
  detectOrphanScreens,
  detectUnreachableRegisteredScreens,
  attributeDeadEndControls,
  attributeScreenFindings,
  parseNavEdge,
  registerNavigationMap,
  getRegisteredNavigationMap,
  CIRCUIT_RULE_MAP,
  _resetNavigationMapForTests,
} from "./circuitMap";
export type {
  CircuitMapReport,
  CircuitFinding,
  CircuitFindingKind,
  CircuitNode,
  CircuitEdge,
  CircuitControlSite,
  CircuitScreenFindings,
} from "./circuitMap";
// Drawing the circuit map: a pure, bounded layout over the report above. Also
// on-device only — coordinates are computed for the in-app panel and never
// leave the device.
export {
  layoutCircuitMap,
  MAP_MAX_NODES,
  MAP_MAX_EDGES,
  MAP_MAX_LANES,
  MAP_MAX_THICKNESS,
} from "./circuitMapLayout";
export type {
  CircuitMapLayout,
  MapNode,
  MapEdge,
  MapNodeState,
} from "./circuitMapLayout";

// The whole screen list — hand the kit your navigator’s screen CONFIGURATION
// (a static-API navigator, or a linking config) and it lists the app’s screens
// itself, so the map draws screens nobody has opened yet (marked "not seen",
// never "dead"). A running container ref is refused: it knows only the
// navigators that have mounted, so it cannot prove it holds the whole tree —
// those apps declare their screens with registerNavigationMap() instead.
// Declared screens and navigator-read screens merge, neither overwriting the
// other. Switchable off.
export {
  registerNavigator,
  setRouteListEnabled,
  routeListEnabled,
  routeListReport,
  readNavigatorRoutes,
  safeScreenName,
  routeListForSnapshot,
  MAX_ROUTE_LIST_ENTRIES,
  RN_ROUTE_SOURCE_WORDS,
  _resetRouteInventoryForTests,
} from "./routeInventory";
export type {
  NavigatorRead,
  RNRouteSource,
  RouteListEntry,
  RouteListOrigin,
  RouteListReport,
  RouteListStatus,
} from "./routeInventory";

// Control census — the same question the browser kit asks its rendered page:
// what controls are on this screen? This runtime's honest answer today is
// `no-identity`: its touch observation carries a timestamp and nothing else,
// so it sees THAT a control was pressed and not WHICH. The block still
// travels saying so, because an absent block would read as a kit too old to
// have been asked.
export {
  controlCensusReport,
  controlCensusForSnapshot,
  controlCensusEnabled,
  setControlCensusEnabled,
  controlCensusPanelText,
  controlCensusStatusLine,
  CONTROL_CENSUS_STATUS_WORDS,
  CONTROL_CENSUS_NO_IDENTITY_SENTENCE,
  CONTROL_KIND_WORDS,
  CONTROL_LEADS_WORDS,
  CONTROL_CENSUS_BOUND_WORDS,
  _resetControlCensusForTests,
} from "./controlCensus";
export type {
  ControlCensusReport,
  ControlCensusEntry,
  ControlCensusStatus,
  ControlCensusBound,
  ControlKind,
  ControlLeads,
} from "./controlCensus";

// The self-drawing screen map — ONE opt-in mount point at the app root makes
// every screen change name itself and produce an edge, with no per-screen work
// and no beginNav() call. It adds NO dependency on any navigation library: an
// app without one, or with a router the observer does not recognise, behaves
// exactly as it does today.
//
// ON-DEVICE ONLY, like the circuit map it feeds: the accumulated screens and
// edges are read by the in-app panel and by nothing else. Nothing new goes on
// the wire because this is mounted.
export { BoosthisNavigationObserver } from "./BoosthisNavigationObserver";
export type { BoosthisNavigationObserverProps } from "./BoosthisNavigationObserver";
export {
  attachNavigationObserver,
  noteScreenChange,
  getNavObserverStatus,
  isNavObserverActive,
  _resetNavObserverForTests,
} from "./navObserver";
export type { NavObserverStatus, NavRouterKind } from "./navObserver";
export {
  getScreenMapStats,
  getObservedGraph,
  normalizeScreenLabel,
  hydrateScreenMap,
  flushScreenMap,
  MAX_MAP_NODES,
  MAX_MAP_EDGES,
  MAX_MAP_STORED_BYTES,
  _resetScreenMapForTests,
} from "./pageMap";
export type {
  ScreenMapStats,
  ScreenMapPersistence,
  ObservedGraph,
} from "./pageMap";

// Engine — render profiler (DEV-DASHBOARD ONLY; React Profiler is inert in
// release builds, so this records nothing in production and never uploads).
export { renderProfiler } from "./renderProfiler";
export type { RenderCommit, RenderStats, RenderPhase } from "./renderProfiler";
export { BoosthisProfiler } from "./BoosthisProfiler";
export type { BoosthisProfilerProps } from "./BoosthisProfiler";
export { useRenderGuard } from "./hooks/useRenderGuard";

// Engine — snapshots
export {
  saveSnapshot,
  listSnapshots,
  loadSnapshot,
  deleteSnapshot,
  clearAllSnapshots,
  diffSnapshots,
  findChronicPatterns,
  MAX_SNAPSHOTS,
} from "./perfSnapshots";
export type {
  SnapshotRow,
  PerfSnapshot,
  SnapshotMeta,
  SnapshotDelta,
  PatternChange,
  SnapshotDiff,
  ReportLike,
  ChronicPattern,
} from "./perfSnapshots";

// Engine — diagnoser
export {
  buildBaselineSnapshot,
  computeScreenScore,
  computeOverallScore,
  diagnose,
  diagnoseLongSession,
} from "./perfDiagnose";
export type {
  PerfRow,
  PhaseEntry,
  ScreenPattern,
  ScreenDiagnosis,
  CrossCuttingFinding,
  BaselineSnapshot,
  DiagnosisReport,
  ScreenScoreBreakdown,
  LongSessionSample,
  LongSessionPattern,
  LongSessionGrowth,
  LongSessionReport,
} from "./perfDiagnose";

// Engine — prod sampler
export { recordProdSample, flushProdSamples, _prodSamplerInternals } from "./perfProdSampler";
export type {
  PerfSample,
  RecordSampleInput,
  SampleMetadata,
  ScreenReadingSource,
} from "./perfProdSampler";

// A screen reading nobody had to ask for: the navigation observer measures
// each screen it sees, and stands down for a screen measured by hand.
export {
  armScreenReading,
  noteHostScreenReading,
  scoreScreenReading,
  getScreenReadingCounts,
  describeScreenReadingCounts,
  hasOpenScreenReading,
  SCREEN_ARRIVAL_CAP_MS,
  _resetScreenAutoReadingForTests,
  _screenAutoReadingInternals,
} from "./screenAutoReading";
export type { ScreenReadingCounts, ScreenReadingScore } from "./screenAutoReading";

// Which screen a reading was taken on (and the one wording for "none was").
export {
  currentScreen,
  describeScreenAttribution,
  NO_SCREEN_WORDING,
} from "./screenAttribution";

// Device tier (host-provided, privacy-safe capability bucket)
export { setDeviceTier, getDeviceTier } from "./deviceTier";
export type { DeviceTier } from "./deviceTier";

// Engine — full snapshot mirror (uploaded to the web dashboard so /app can
// mirror the in-app bubble: boot ladder + frame meters + rows + diagnosis)
export {
  capturePerfSnapshot,
  setSnapshotSubmitter,
  startSnapshotAutoUpload,
  stopSnapshotAutoUpload,
  uploadPerfSnapshotNow,
  readNow,
  READING_TRIGGER_ON_DEMAND,
  _snapshotInternals,
  MAX_SNAPSHOT_ROWS,
  MAX_SNAPSHOT_SCREENS,
  MAX_SNAPSHOT_CROSSCUTTING,
  SNAPSHOT_FLUSH_MS,
  nextSnapshotDelayMs,
  FIRST_REPORT_WAIT_TEXT,
} from "./perfSnapshotUpload";
export type {
  SnapshotPayload,
  SnapshotSubmitter,
  ReadNowResult,
  ReadingTrigger,
} from "./perfSnapshotUpload";

// Platform adapter
export { platform, setPerfPlatform } from "./perfPlatform";
export type { PerfPlatform, PerfStorage } from "./perfPlatform";

// Privacy guard
export { assertNoPII, checkNoPII, PIIDetectedError, PII_DENYLIST } from "./no-pii";

// Outbound chokepoint
export { safeTransmit } from "./transmit";
export type { SafeTransmitOptions } from "./transmit";

// Full-stack trace tag (Stage 1: propagation). Mint an id at a user action
// with newTraceId(), carry it to the next hop with traceHeaders(id).
export {
  TRACE_HEADER,
  TRACE_ID_RE,
  isValidTraceId,
  newTraceId,
  sanitizeTraceId,
  traceHeaders,
} from "./trace";

// Full-stack trace causality (Stage 3: span parentage). A span carries its own
// identity and the identity of the call that caused it, so the waterfall nests
// and the view can name the hop RESPONSIBLE for the end-to-end time — not
// merely the longest one. `traceFetch` mints one per call; wrap
// several calls in `runInSpan` to name a common caller for all of them.
export {
  PARENT_HEADER,
  SPAN_ID_RE,
  isValidSpanId,
  newSpanId,
  sanitizeSpanId,
  adoptParentSpanId,
  currentSpanId,
  beginSpan,
  runInSpan,
} from "./spanScope";
export type { SpanHandle } from "./spanScope";

// Full-stack trace tag (Stage 2: span emission). `traceFetch` is a drop-in
// `fetch` that propagates the trace id AND buffers one privacy-safe root span
// per outbound request. Spans ride the same allow-gate as the snapshot mirror
// (nothing span-shaped leaves — or is even retained — until an AI is connected).
export {
  traceFetch,
  flushSpansNow,
  spanLabel,
  rateSpanDuration,
  _spanInternals,
} from "./spanEmitter";
export type {
  TraceSpan,
  SpanLayer,
  SpanRating,
  SpanSubmitter,
} from "./spanEmitter";

// THE SCREEN CIRCUIT — the same graph, drawn without a line of trace code.
// `traceFetch` above needs the developer to edit every call site, which is why
// a phone app that followed the setup guide to the letter had a blank circuit
// for ever. With `traceScreens` in enableTelemetry(), each screen the app
// moves to becomes a node, moving between two becomes an edge, and every call
// the transports already wrapped becomes a child of the screen it came from.
//
// OFF UNLESS ASKED, on its own switch, because a span carries a route label
// and the Network axis is published as reading no URL, host, path or status:
// see docs/decisions/rn-screen-circuit-boundary.md. With the switch absent
// nothing about this kit's behaviour differs. Exported here for an app that
// wants to drive it directly, and for the status the panel reads.
export {
  enableScreenCircuit,
  disableScreenCircuit,
  isScreenCircuitOn,
  getScreenCircuitStatus,
  closeOpenCircuitScreen,
  resumeCircuitScreen,
  SCREEN_LABEL_PREFIX,
  MAX_SPANS_PER_JOURNEY,
} from "./screenCircuit";
export type {
  ScreenCircuitOptions,
  ScreenCircuitStatus,
} from "./screenCircuit";

// The ungated startup line, and the refusal of a value that cannot be a
// project key. See .agents/memory/kit-startup-announcement.md.
export {
  announceKitStart,
  announceProjectKey,
  findProjectKeyProblem,
  kitStartupLine,
  projectKeyRefusalLine,
  projectKeyTail,
  warnProjectKeyRefused,
  _resetStartAnnounceForTests,
} from "./startAnnounce";
export type { BadgeState, ProjectKeyProblem } from "./startAnnounce";

// Telemetry (opt-in)
export { enableTelemetry, DEFAULT_TELEMETRY_ENDPOINT } from "./telemetry";
export type { TelemetryOptions, TelemetryClient, TelemetrySample } from "./telemetry";
export {
  AI_PROVIDERS,
  DECLARED_PROVIDER_CODE,
  MAX_DECLARED_AI_ENDPOINTS,
  aiProviderCode,
  normaliseDeclaredEndpoint,
  setDeclaredAiEndpoints,
  declaredAiEndpointCount,
} from "./aiProviders";
export {
  installAiCallWatch,
  uninstallAiCallWatch,
  getAiCallStats,
} from "./aiCalls";
export {
  coverageInventory,
  coverageFingerprint,
} from "./coverageInventory";
export type {
  CoverageInventory,
  SurfaceGap,
} from "./coverageInventory";

// Which project key does THIS runtime report under? A codebase can hold one
// key per language; `resolveProjectKey` is what the generated wiring passes to
// `enableTelemetry`, so a React-Native-specific key beats the shared one
// without the app author editing their own source. See projectKey.ts.
export {
  resolveProjectKey,
  resolveProjectKeyDetailed,
  describeProjectKeySource,
  maskProjectKey,
  RN_RUNTIME_NAME,
} from "./projectKey";
export type {
  ProjectKeyConfig,
  ProjectKeySource,
  ResolvedProjectKey,
} from "./projectKey";

// Display-only identity returned by consent. The project name is sanitised,
// persisted by telemetry and rendered as Text by the dashboard.
export {
  PROJECT_LABEL,
  PROJECT_UNNAMED_TEXT,
  PROJECT_UNKNOWN_TEXT,
  SCORE_CAPTION,
  getKitProject,
  projectDisplay,
} from "./projectIdentity";
export type { KitProject } from "./projectIdentity";

// On-device "can this build reach Boosthis?" probe. Crash-safe; goes through the
// kit's Hermes-safe transport and surfaces a wired-vs-global divergence.
export { runNetworkSelfTest } from "./networkSelfTest";
export type {
  NetworkSelfTestOptions,
  NetworkSelfTestResult,
  SelfTestProbe,
} from "./networkSelfTest";

// Thresholds & version
export {
  SCORE_THRESHOLDS,
  SCORE_WEIGHTS,
  RATING_CUTOFFS,
  RUNTIME_VERSION,
} from "./thresholds";
export type { Rating } from "./thresholds";

// Additive meter axes (RN-only, on-device — these ENRICH the dashboard and
// must NOT alter the shared TTFF/TTI/FID composite or its server buckets).
export {
  SMOOTHNESS_THRESHOLDS,
  RESPONSIVENESS_THRESHOLDS,
  STABILITY_THRESHOLDS,
  SCROLL_THRESHOLDS,
  NETWORK_THRESHOLDS,
  AI_CALL_MIN_SAMPLES,
  AI_FAIL_PCT_THRESHOLDS,
  CONFIDENCE_CUTOFFS,
  RENDER_EFFICIENCY_THRESHOLDS,
  computeSmoothnessScore,
  computeResponsivenessScore,
  computeStabilityScore,
  computeScrollHealth,
  computeNetworkScore,
  computeAiCalls,
  computeBudgetCompliance,
  confidenceLevel,
  computeMeterAxes,
  computeRenderEfficiency,
  computeCrashFree,
} from "./meterAxes";
export type {
  AxisRating,
  SmoothnessResult,
  ResponsivenessResult,
  StabilityResult,
  ScrollHealthResult,
  ScrollStatsLike,
  NetworkStatsLike,
  NetworkResult,
  AiCallsResult,
  BudgetCompliance,
  ConfidenceLevel,
  InteractionStatsLike,
  MeterAxes,
  RenderStatsLike,
  RenderEfficiencyResult,
  CrashStatsLike,
  CrashFreeResult,
} from "./meterAxes";
export type {
  AsyncSlowCallbacksResult,
  BlockingAsyncResult,
  EventLoopLagResult,
  TimerHealthResult,
  ScreenLeaksResult,
} from "./timerHealth";
export type { ReRendersResult } from "./reRenders";
export type { ImageWeightResult } from "./imageWeight";
export type { BridgeTrafficResult } from "./bridgeTraffic";
export type { JsStartupResult } from "./jsStartup";
export type { NavDeadTimeResult, PressToScreenResult } from "./navDeadTime";

// Additive RN axes — six new collectors (thresholds + host-facing helpers).
// The compute is done inside computeMeterAxes (each reads its own module
// state); these exports let hosts wire the optional manual sources + read the
// bands. All display-only — none feed the TTFF/TTI/FID composite.
export {
  RE_RENDERS_THRESHOLDS,
  readReRenders,
} from "./reRenders";
export {
  IMAGE_WEIGHT_THRESHOLDS,
  recordImage,
  readImageWeight,
} from "./imageWeight";
export {
  BRIDGE_TRAFFIC_THRESHOLDS,
  detectNewArch,
  readBridgeTraffic,
} from "./bridgeTraffic";
export {
  JS_STARTUP_THRESHOLDS,
  markFirstRender,
  readJsStartup,
} from "./jsStartup";
export {
  NAV_DEAD_TIME_THRESHOLDS,
  PRESS_TO_SCREEN_THRESHOLDS,
  NAV_JOIN_BOUND_MS,
  readNavDeadTime,
  readPressToScreen,
} from "./navDeadTime";
export {
  ASYNC_RATE_MIN_WINDOW_MS,
  ASYNC_SLOW_CALLBACK_THRESHOLD_MS,
  ASYNC_SLOW_CALLBACK_THRESHOLDS,
  BLOCKING_ASYNC_BLOCK_THRESHOLD_MS,
  BLOCKING_ASYNC_THRESHOLDS,
  EVENT_LOOP_LAG_MIN_SAMPLES,
  EVENT_LOOP_LAG_RING_CAP,
  EVENT_LOOP_LAG_THRESHOLDS,
  SCREEN_LEAKS_THRESHOLDS,
  readAsyncSlowCallbacks,
  readBlockingAsync,
  readEventLoopLag,
  readScreenLeaks,
} from "./timerHealth";

// Network reliability — field-capable axis sampler + host-reporting helpers.
// Host code reports its own request outcomes (counts/durations only, no URLs
// or labels) via recordNetworkAttempt / measureNetworkAttempt.
export {
  networkSampler,
  recordNetworkAttempt,
  getNetworkStats,
  measureNetworkAttempt,
} from "./networkSampler";
export type { NetworkStats, NetworkOutcome } from "./networkSampler";

// OPT-IN automatic reporting for the same axis. Reports EXACTLY what the
// manual API above reports — a duration and a coarse outcome bucket, never a
// URL, host or status — so an ordinary app measures its own network without
// the developer writing the calls. Normally switched on through
// `autoWrapNetwork` in enableTelemetry(); exported here for an app that wants
// to control it directly, and for the coverage read the panel draws.
export {
  installNetworkAutoWrap,
  assertNetworkAutoWrap,
  isNetworkAutoWrapped,
  networkCoverageFields,
  readTransportCoverage,
  resetNetworkAutoWrap,
  wrapNetworkFetch,
} from "./networkAutoWrap";
export type {
  NetworkAutoWrapOptions,
  TransportCoverage,
  TransportName,
  TransportState,
} from "./networkAutoWrap";

export {
  trackBackgroundWork,
  noteBackgroundSystemAttached,
  noteBackgroundSystemUnattached,
  readBackgroundWork,
} from "./backgroundWork";
export type {
  BackgroundWorkOptions,
  BackgroundWorkResult,
} from "./backgroundWork";
// Background work REPORTED BY NAME, which is what puts a phone app's
// scheduled work on the project page's scheduled-jobs band. `trackBackgroundWork`
// above already files each run it measures, and an app using Expo's own
// background APIs reports without calling anything at all. What is exported
// here is the deliberate half: stating how often a job SHOULD run, which is
// the only thing lateness is ever judged against, and reading back what this
// kit found so the on-device panel can say "we looked, and there is none".
export {
  expectEvery,
  reportJobRun,
  scheduledJobsFound,
  // What the kit itself can answer about lateness, using the allowance
  // Boosthis confirmed rather than arithmetic of its own.
  missedAfterMs,
  overdueDeclaredJobs,
  MAX_JOB_NAME,
} from "./scheduledJobs";
export type { JobRunReport, JobExpectationReport } from "./scheduledJobs";
export {
  classifyUpstreamCache,
  readUpstreamCache,
} from "./upstreamCache";
export type {
  UpstreamCacheResult,
  UpstreamCacheVerdict,
} from "./upstreamCache";

// Scroll / list health — field-capable axis sampler + drop-in consumer hook
export { scrollSampler } from "./scrollSampler";
export type { ScrollStats } from "./scrollSampler";
export { useScrollHealth } from "./hooks/useScrollHealth";
export type {
  UseScrollHealthResult,
  ScrollHealthHandlers,
} from "./hooks/useScrollHealth";

// Global kill-switch
export { isBoosthisDisabled } from "./runtimeFlags";

/* ── Server-authority kill-switch (Rung 1 of kit protection) ──────────────
 * `isRuntimeInert()` is the combined gate every Boosthis hot path consults:
 * true ⇒ do nothing (revoked/unpaid/tampered/grace-expired, or the env kill).
 * Use the `useRuntimeInert()` hook in UI so it re-renders when the gate flips. */
export {
  isRuntimeInert,
  isActivated,
  getEntitlementStatus,
  getEntitlementMessage,
  getEntitlementGateKind,
  isInstallIdRejected,
  subscribeEntitlement,
  startEntitlementCheckin,
  stopEntitlementCheckin,
  forceEntitlementCheck,
  type EntitlementStatus,
  type EntitlementGateKind,
  type EntitlementCheckinConfig,
} from "./killSwitch";
export {
  useRuntimeInert,
  useEntitlementGate,
  useInstallIdRejected,
} from "./hooks/useEntitlement";

// Candidate rules (recurring perf signatures; auto-submitted when telemetry is on)
export {
  ingestFindings,
  listCandidateRules,
  listSurfaceable,
  promoteCandidateLocal,
  clearAllCandidates,
  setCandidateSubmitter,
  setResolutionSubmitter,
  signatureFor,
} from "./candidateRules";
export type {
  CandidateRule,
  CandidateStatus,
  CandidateSubmitter,
  ResolutionSubmitter,
} from "./candidateRules";

// Drop-in dashboard UI (visual viewer for the host app's own perf numbers)
export { BoosthisDashboard } from "./ui/BoosthisDashboard";
export type { BoosthisDashboardProps } from "./ui/BoosthisDashboard";
export type { BoosthisDashboardTheme } from "./ui/theme";
export { DARK_THEME, ratingColor } from "./ui/theme";

// Drop-in rich engine surface — the SAME panel the Boosthis app renders
// (boot ladder, novel detectors, candidate rules, score sparkline, snapshots).
export { BoosthisEnginePanel } from "./ui/BoosthisEnginePanel";
export type {
  BoosthisEnginePanelProps,
  DetectorRuleLink,
} from "./ui/BoosthisEnginePanel";
export { BoosthisLauncher } from "./ui/BoosthisLauncher";
export type {
  BoosthisLauncherProps,
  BoosthisLauncherCorner,
} from "./ui/BoosthisLauncher";

// SDK→host safety net. Wraps every Boosthis UI surface so a render-time throw
// can never crash the host app; exported for host apps wrapping custom surfaces.
export { BoosthisErrorBoundary } from "./ui/BoosthisErrorBoundary";
export type { BoosthisErrorBoundaryProps } from "./ui/BoosthisErrorBoundary";

// Terms & Privacy gate for the drop-in surface ("agree before using Boosthis").
// BoosthisDashboard renders this automatically on first open; exported here for
// host apps that want to gate a custom Boosthis surface or reset acceptance.
export { BoosthisTermsGate } from "./ui/BoosthisTermsGate";
export type { BoosthisTermsGateProps } from "./ui/BoosthisTermsGate";
export {
  TERMS_VERSION,
  getAcceptance,
  hasAcceptedCurrentTerms,
  recordAcceptance,
  clearAcceptance,
} from "./ui/consent";
export type { TermsAcceptance } from "./ui/consent";

// Re-export checklist for consumers
export {
  BOOSTHIS_CHECKLIST,
  CHECKLIST_COUNT,
  CHECKLIST_VERSION,
  getChecklistEntry,
  listChecklistIds,
} from "boosthis-checklist";
export type { BoosthisChecklistEntry } from "boosthis-checklist";
