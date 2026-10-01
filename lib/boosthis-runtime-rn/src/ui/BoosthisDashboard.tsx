/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * BoosthisDashboard — a drop-in performance dashboard screen.
 *
 * This is the visual viewer the Boosthis mobile app shows (score gauge,
 * breakdown, budgets), packaged as a single self-contained component so any
 * host app can render its OWN live performance numbers without rebuilding the
 * UI.
 *
 * Design constraints (so it drops into ANY Expo / React Native app):
 *  - Pure react-native primitives only (View / Text / ScrollView). No icon
 *    packs, no custom fonts, no navigation, no theme provider required.
 *  - Reads data only from this runtime: `usePerfTracker` for the current
 *    screen mount, `getSessionFid()` for first-input delay, and the shared
 *    score thresholds. Nothing leaves the device.
 *  - Fully themeable via the optional `theme` prop; sensible dark defaults.
 *
 * Usage (host app — e.g. a tab or a screen):
 *
 *   import { BoosthisDashboard } from "@workspace/boosthis-runtime-rn";
 *
 *   export default function PerfTab() {
 *     return <BoosthisDashboard appName="Rival" subtitle="React Native" />;
 *   }
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useBoosthis } from "../hooks/useBoosthis";
import { getSessionFid } from "../hooks/useFidSampler";
import { perfMonitor } from "../perfMonitor";
import { FIRST_REPORT_WAIT_TEXT } from "../reportingCadence";
import {
  askRegistration,
  getDroppedUploadCount,
  getLastUploadFailure,
  getActiveTelemetryClient,
  isLastUploadAttemptFailed,
  resolveDashboardWebUrl,
  type UploadFailReason,
} from "../telemetry";
import {
  computeScreenScore,
  type ScreenScoreBreakdown,
} from "../perfDiagnose";
import {
  RATING_CUTOFFS,
  SCORE_THRESHOLDS,
  SCORE_WEIGHTS,
  type Rating,
} from "../thresholds";

import {
  BoosthisEnginePanel,
  type DetectorRuleLink,
} from "./BoosthisEnginePanel";
import { BoosthisErrorBoundary } from "./BoosthisErrorBoundary";
import { BoosthisFatalFallback } from "./BoosthisFatalFallback";
import { safeAsync } from "../safe";
import { identityPanelNotice } from "../installIdentity";
import { runNetworkSelfTest } from "../networkSelfTest";
import {
  DARK_THEME,
  ratingColor,
  type BoosthisDashboardTheme,
} from "./theme";
import {
  BoosthisAccountCard,
  computeAccountNotice,
} from "./BoosthisAccountCard";
import { hasAcceptedCurrentTerms } from "./consent";
import { BoosthisTermsGate } from "./BoosthisTermsGate";
import {
  useLockHint,
  useEntitlementGate,
  useInstallIdRejected,
} from "../hooks/useEntitlement";
import {
  getEntitlementMessage,
  getRegistrationFailure,
  getRegistrationRefusalSentence,
} from "../killSwitch";
import {
  getKitProject,
  INSTALL_ID_LABEL,
  INSTALL_ID_UNKNOWN_TEXT,
  PROJECT_LABEL,
  projectDisplay,
  SCORE_CAPTION,
} from "../projectIdentity";
import {
  getRegistrationVerdict,
  subscribeRegistration,
} from "../registration";

export type { BoosthisDashboardTheme };

/**
 * Full hosted Terms & Privacy page (the api-server serves the combined document
 * at /terms). Uses the deployed API domain with a public fallback so the link
 * works even if the host app hasn't wired an EXPO_PUBLIC_API_URL override.
 */
const TERMS_URL = `${(
  (globalThis as unknown as { process?: { env?: Record<string, string> } })
    .process?.env?.EXPO_PUBLIC_API_URL || "https://www.boosthis.com"
).replace(/\/+$/, "")}/terms`;

export interface BoosthisDashboardProps {
  /** App name shown in the header (e.g. "Rival"). Defaults to "Boosthis". */
  appName?: string;
  /** Small line under the title. Defaults to "React Native Performance". */
  subtitle?: string;
  /**
   * Screen label this dashboard reports for. Defaults to "dashboard".
   * The dashboard measures its OWN mount time as the live sample.
   */
  screenName?: string;
  /** Override any subset of the default dark theme colors. */
  theme?: Partial<BoosthisDashboardTheme>;
  /**
   * Called when the user taps a detector finding that maps to a checklist rule.
   * Wire this to your navigation. Omit to render findings as non-tappable.
   */
  onRulePress?: (link: DetectorRuleLink) => void;
}

/**
 * Live headline state. The headline reports the host app's WORST measured
 * screen — the slowest real screen the user actually navigated — rather than the
 * dashboard panel's own mount time (which is always near-instant and would pin
 * the score at 100 regardless of how the app performs). A single good number can
 * then never hide a slow screen sitting one tap away.
 */
interface HeadlineState {
  /** Worst real screen's composite score, or null until a screen is measured. */
  score: number | null;
  /** Name of the worst screen, for context under the gauge. */
  worstName: string | null;
  /** Worst screen's TTFF / TTI, plus the app-wide session FID. */
  ttffMs: number | null;
  ttiMs: number | null;
  fidMs: number | null;
  /** How many real screens have enough data to score. */
  scoredScreens: number;
}

/** WHAT HAPPENS TO THE SELF-SCOPED PAIR WHEN THIS INSTALL IS REPLACED.
 *
 *  The `install_id` + `read_token` the connect card shows are pinned to ONE
 *  install. An app that cannot carry its stored identity across a launch — a
 *  fresh build, a wiped simulator, an ordinary dev loop — registers a NEW
 *  install every time, and the pair the developer pasted into their AI tool
 *  goes on resolving: HTTP 200, the same snapshot, frozen at the moment that
 *  install stopped reporting. It reads exactly like a live app whose numbers
 *  happen not to be moving, which is how a real integration spent a morning
 *  reading a nine-o'clock install while ten later ones measured fine.
 *
 *  NAMED AND LOCATED, NOT MINTED. The durable credential is account-wide and
 *  issuing one needs a signed-in dashboard session, which this card does not
 *  have and must not ask a device for. So it says exactly which button issues
 *  it, where that button is, and what to pass instead.
 *
 *  Exported so the card's promise can be pinned by a test rather than re-read
 *  by eye. */
export const DURABLE_CREDENTIAL_TITLE = "Survives a new install id";
export const DURABLE_CREDENTIAL_BODY =
  "The pair above is pinned to THIS install. If the app registers a new " +
  "install id — a fresh build, or any launch that can't carry its stored " +
  "identity — it keeps answering with this install's last stored numbers " +
  "instead of today's, and nothing about the reply looks out of date. For a " +
  "credential that survives that, open the Boosthis dashboard on the web and " +
  "press “Connect AI once” — its own section on the dashboard home page, " +
  "above Your Projects — then pass the account_token it issues instead of " +
  "install_id + read_token. One key covers every project you own. It is not " +
  "tied to an install id and always reads whichever install reported most " +
  "recently.";

const EMPTY_HEADLINE: HeadlineState = {
  score: null,
  worstName: null,
  ttffMs: null,
  ttiMs: null,
  fidMs: null,
  scoredScreens: 0,
};

function scoreRating(score: number): Rating {
  if (score >= RATING_CUTOFFS.good) return "good";
  if (score >= RATING_CUTOFFS.needsWork) return "needs-work";
  return "poor";
}

function valueRating(value: number | null, good: number, poor: number): Rating {
  if (value === null) return "pending";
  if (value <= good) return "good";
  if (value <= poor) return "needs-work";
  return "poor";
}

function MetricRow({
  label,
  value,
  good,
  poor,
  weight,
  t,
}: {
  label: string;
  value: number | null;
  good: number;
  poor: number;
  weight: number;
  t: BoosthisDashboardTheme;
}) {
  const rating = valueRating(value, good, poor);
  const color = ratingColor(rating, t);
  const barWidth =
    value === null
      ? 0
      : Math.min(100, Math.max(0, 100 * (1 - (value - good) / (poor - good))));

  return (
    <View style={[styles.metricRow, { borderBottomColor: t.border }]}>
      <View style={styles.metricLeft}>
        <Text style={[styles.metricLabel, { color: t.mutedForeground }]}>{label}</Text>
        <Text style={[styles.metricWeight, { color: t.mutedForeground }]}>×{weight}</Text>
      </View>
      <View style={styles.metricRight}>
        <Text style={[styles.metricValue, { color }]}>
          {value === null ? "—" : `${value}ms`}
        </Text>
        <View style={[styles.metricBar, { backgroundColor: t.secondary }]}>
          <View
            style={[
              styles.metricBarFill,
              { width: `${value === null ? 0 : barWidth}%`, backgroundColor: color },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * Public dashboard entry point (see BoosthisDashboard below). On first open it
 * shows a one-time Connect + Terms gate — the "Connect to your account" card
 * (mandatory once the app is registered) above a Terms & Privacy box with an
 * affirmative "I agree" tap. Once the developer/tester accepts the current
 * TERMS_VERSION it never shows again and the bubble opens straight to the
 * dashboard. The full legal document lives on the hosted /terms page — the gate
 * only links to it. Acceptance is versioned and shared with the standalone app,
 * so an app that already agreed at launch is not re-prompted. This gate concerns
 * ONLY the Boosthis surface — it never blocks the host app's own UI or end users.
 */
/**
 * Public entry. Wraps the entire dashboard (terms gate + body) in an error
 * boundary so a render-time throw anywhere inside Boosthis can NEVER reach the
 * host app's root and crash it. On failure it shows a visible "couldn’t load —
 * try again" card (not a silent black void) so a developer who opened the
 * dashboard inside their host's modal can recover instead of being stuck.
 * Boosthis renders its UI inside an app it does not control, so this SDK→host
 * net is mandatory.
 */
export function BoosthisDashboard(props: BoosthisDashboardProps) {
  return (
    <BoosthisErrorBoundary
      name="dashboard"
      fallbackRender={(reset, error) => (
        <BoosthisFatalFallback
          theme={props.theme}
          onRetry={reset}
          error={error}
          webLoginUrl={resolveDashboardWebUrl()}
        />
      )}
    >
      <DashboardGate {...props} />
    </BoosthisErrorBoundary>
  );
}

/** Full-cover BLOCKING lock overlay shown when the server-authority kill-switch
 *  has rendered the kit inert (revoked / unpaid / paused / tampered / activation
 *  lock / grace-expired). It fully replaces the dashboard body, so NONE of the
 *  meters render behind it and no tap can reach them — the block is inherent in
 *  swapping the whole subtree, and the opaque dark scrim (RN's cheap blur
 *  approximation — NO native deps) makes it read as a deliberate lock. Plain RN
 *  primitives only so it renders even when the rest of the dashboard can't.
 *
 *  Copy is closed and friendly with no server internals, keyed off the gate
 *  KIND (see `getEntitlementGateKind`):
 *   - revoked → "Access revoked" (owner revoked; contact them). No action.
 *   - unpaid  → "Payment required" (renew at boosthis.com). No embedded payment.
 *   - paused  → calmer reversible-pause notice (owner Reconnects).
 *   - hidden  → the generic locked/off notice (also covers the ACTIVATION LOCK,
 *     where the on-device lock hint explains WHY). */
function BoosthisDisabledNotice({
  theme,
}: {
  theme?: Partial<BoosthisDashboardTheme>;
}) {
  const t: BoosthisDashboardTheme = { ...DARK_THEME, ...theme };
  const detail = getEntitlementMessage();
  const gate = useEntitlementGate();
  // Coarse, on-device-derived hint at WHY the ACTIVATION LOCK is holding (no key
  // set / key rejected / key revoked / server unreachable). Subscribed so it
  // appears the moment the consent path resolves the category — a moment after
  // first paint. Null unless genuinely locked-not-killed, so it never shows on a
  // revoked / paused / owner-killed app.
  const hint = useLockHint();

  let title: string;
  let body: string;
  if (gate === "revoked") {
    title = "Access revoked";
    body =
      "This project's Boosthis access was revoked by the account owner. " +
      "Contact the owner if you think this is a mistake.";
  } else if (gate === "unpaid") {
    title = "Payment required";
    body =
      "The Boosthis subscription for this account is unpaid. Ask the account " +
      "owner to renew it at boosthis.com to restore access.";
  } else if (gate === "paused") {
    title = "Boosthis is paused";
    body =
      detail ??
      "The owner has paused this app from the Boosthis dashboard. " +
        "Nothing was deleted — press Reconnect there to resume.";
  } else {
    title = "Boosthis is disabled";
    body =
      detail ??
      "This app's Boosthis access has been turned off by the owner. " +
        "Contact your Boosthis administrator to restore it.";
  }

  return (
    <View
      // A blocking overlay: absolute full-cover with an opaque dark scrim so
      // nothing renders/reads behind it. `pointerEvents="auto"` (the default)
      // means it also absorbs every tap — no interaction passes through.
      accessibilityLabel="Boosthis locked"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        // Opaque dark scrim (RN's dependency-free blur approximation).
        backgroundColor: t.background,
      }}
    >
      <Text
        style={{
          color: t.foreground,
          fontSize: 17,
          fontWeight: "700",
          marginBottom: 8,
          textAlign: "center",
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: t.mutedForeground,
          fontSize: 13,
          lineHeight: 19,
          textAlign: "center",
        }}
      >
        {body}
      </Text>
      {hint ? (
        <Text
          style={{
            color: t.mutedForeground,
            fontSize: 12,
            lineHeight: 18,
            marginTop: 12,
            textAlign: "center",
          }}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Inline banner shown when the server refused this app's registration because
 * its install ID is not a UUID (HTTP 400 + the `invalid_install_id` marker).
 *
 * Without it the dashboard looks completely normal — meters measuring, card
 * "awaiting registration" — which is exactly how this failure got read as
 * "Boosthis is broken". The copy is FIXED and code-defined: no server text, no
 * install id, and no developer-provided string is ever rendered here. Plain RN
 * primitives only (View/Text), so it renders even when nothing else can.
 */
function InstallIdRejectedNotice({ t }: { t: BoosthisDashboardTheme }) {
  const rejected = useInstallIdRejected();
  if (!rejected) return null;
  return (
    <View
      accessibilityLabel="Boosthis registration rejected"
      style={[
        styles.card,
        { backgroundColor: t.card, borderColor: t.poor },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: t.poor }]}>
        Registration rejected
      </Text>
      <Text style={[styles.sectionSub, { color: t.mutedForeground }]}>
        Registration rejected — install ID must be a UUID. Mint a real UUID and
        restart.
      </Text>
    </View>
  );
}

/**
 * WILL THIS APP STILL BE THIS INSTALL AFTER A RELAUNCH?
 *
 * The kit keeps its install id — and the credentials that stop it minting a
 * new one — in device storage, and the package that supplies that storage is
 * an OPTIONAL peer dependency. An app that does not have it keeps running on
 * an in-memory map, so every relaunch registers as somebody new and the
 * dashboard fills with installs nobody can account for. Nothing about that
 * looks broken from here unless this card says so.
 *
 * Silent when the store is durable: the panel does not narrate a healthy
 * state. Fixed, code-defined copy — no server text, no path, no module of the
 * host's ever renders here.
 */
function IdentityPersistenceNotice({ t }: { t: BoosthisDashboardTheme }) {
  const notice = identityPanelNotice();
  if (!notice) return null;
  // "Cannot tell" is not a failure and must never borrow the failure tone.
  const tone = notice.kind === "memory" ? t.poor : t.needsWork;
  return (
    <View
      accessibilityLabel="Boosthis install identity"
      style={[styles.card, { backgroundColor: t.card, borderColor: tone }]}
    >
      <Text style={[styles.sectionTitle, { color: tone }]}>{notice.title}</Text>
      <Text
        style={[
          styles.sectionSub,
          styles.verdictBody,
          { color: t.mutedForeground },
        ]}
      >
        {notice.body}
      </Text>
    </View>
  );
}

/** Headline reporting verdict. Local meters can look healthy while nothing has
 *  ever reached Boosthis, so this must sit above (never below) the score. */
function ReportingVerdictNotice({ t }: { t: BoosthisDashboardTheme }) {
  const installIdRejected = useInstallIdRejected();
  const client = getActiveTelemetryClient();
  // Ask Boosthis whether this install is on file, and re-render when the
  // answer lands. The probe is fire-and-forget and self-throttled, so a
  // dashboard that is open for a while asks at most once every 30s.
  const [, bumpVerdict] = React.useState(0);
  React.useEffect(() => {
    askRegistration();
    return subscribeRegistration(() => bumpVerdict((n) => n + 1));
  }, []);
  const verdict = getRegistrationVerdict();
  const notice = computeAccountNotice({
    installIdRejected,
    registered: !!client?.deleteToken,
    sharingActive: !!client?.dashboardSharingActive,
    registrationVerdict: verdict,
    lastUploadAttemptFailed:
      isLastUploadAttemptFailed() && getLastUploadFailure() !== null,
  });
  if (!notice) return null;

  // "Cannot tell" is not a failure, so it never borrows the failure tone.
  const tone =
    notice === "not-registered" || notice === "uploads-failing"
      ? t.poor
      : t.needsWork;
  const title =
    notice === "not-registered"
      ? "Not registered yet"
      : notice === "registration-unknown"
        ? "Can't check right now"
        : notice === "uploads-failing"
          ? "Uploads are not getting through"
          : "Nothing is being uploaded";
  const uploadFailure = getLastUploadFailure();
  const body =
    notice === "not-registered"
      ? getRegistrationRefusalSentence() ?? "This app has not registered with Boosthis, so nothing is being sent. Check the project key and this app's outbound network access, then relaunch the app."
      : notice === "registration-unknown"
        ? "Boosthis could not be reached to confirm whether this app is registered, so this panel cannot say either way yet. This is not a failed install and it does not mean anything stopped \u2014 it settles by itself once the check goes through. Do not change the install line's id while this is showing."
        : notice === "uploads-failing" && uploadFailure
          ? `This app is registered and sharing is on, but the last batch of measurements did not reach Boosthis, so your dashboard is missing the most recent data. ${uploadFailText(uploadFailure.reason)}.${getDroppedUploadCount() > 0 ? ` Uploads lost: ${getDroppedUploadCount()}.` : ""}`
          : "This app is registered, but sharing is off: these meters stay on this screen and your Boosthis dashboard stays empty. Turn sharing on there, or start the kit with shareMeterWithAI: true.";
  const failure = getRegistrationFailure();
  const reasonBody = getRegistrationRefusalSentence();
  if (
    reasonBody &&
    (failure === "none" ||
      failure === "no-key-chosen" ||
      failure === "orphan" ||
      failure === "key-revoked" ||
      failure === "key-paused" ||
      failure === "key-unknown" ||
      failure === "key-rejected")
  ) {
    return (
      <View accessibilityLabel="Boosthis reporting status" style={[styles.card, { borderColor: t.poor, backgroundColor: t.secondary }]}>
        <Text style={[styles.sectionTitle, { color: t.poor }]}>
          {failure === "no-key-chosen" ? "Running with no project key" : failure === "none" ? "No project key" : "Not registered yet"}
        </Text>
        <Text style={[styles.sectionSub, styles.verdictBody, { color: t.mutedForeground }]}>{reasonBody}</Text>
        <Text style={[styles.sectionSub, styles.verdictBody, { color: t.mutedForeground }]}>{INSTALL_ID_LABEL}: {client?.installId || INSTALL_ID_UNKNOWN_TEXT}</Text>
      </View>
    );
  }

  return (
    <View
      accessibilityLabel="Boosthis reporting status"
      style={[styles.card, { borderColor: tone, backgroundColor: t.secondary }]}
    >
      <Text style={[styles.sectionTitle, { color: tone }]}>{title}</Text>
      <Text style={[styles.sectionSub, styles.verdictBody, { color: t.mutedForeground }]}>
        {body}
      </Text>
      {/* WHICH INSTALL this verdict is about. Without it a developer comparing
          this screen with their dashboard — and an assisting AI reading a bad
          verdict — has no way to tell which id was judged, and the usual
          reaction is to change it, which mints a SECOND install. */}
      <Text style={[styles.sectionSub, styles.verdictBody, { color: t.mutedForeground }]}>
        {INSTALL_ID_LABEL}: {client?.installId || INSTALL_ID_UNKNOWN_TEXT}
      </Text>
    </View>
  );
}

function uploadFailText(reason: UploadFailReason): string {
  if (reason === "unauthorized") return "Refused — credentials rejected";
  if (reason === "rejected") return "Refused — batch rejected";
  if (reason === "server-error") return "Boosthis failed to store it";
  return "No answer — timed out or unreachable";
}
/** Terms-gate dispatcher (the real dashboard body is DashboardBody). */
function DashboardGate(props: BoosthisDashboardProps) {
  // null = still reading storage; false = must accept; true = accepted.
  const [accepted, setAccepted] = useState<boolean | null>(null);
  // Server-authority kill-switch (Rung 1): when the owner revokes/suspends this
  // app (or the offline grace lapses) the dashboard must not render its meters.
  //
  // The gate KIND, not the coarse inert flag: "unregistered" (never checked in)
  // is inert too, but it is the one inert state with something to READ. It goes
  // through to the ordinary body, whose headline verdict is the kit's own "Not
  // registered yet" notice with the reason when one is known. Nothing is
  // measured or uploaded there — that stays gated on inert, untouched.
  const gateKind = useEntitlementGate();
  const blocked = gateKind !== "none" && gateKind !== "unregistered";

  // Bumps to force a re-read of the acceptance (set on sign-out).
  const [gateEpoch, setGateEpoch] = useState(0);

  useEffect(() => {
    let alive = true;
    // Keyed to the CURRENT installId: a fresh install (new installId) does not
    // inherit an old acceptance — the full gate flow runs again.
    hasAcceptedCurrentTerms(getActiveTelemetryClient()?.installId ?? null)
      .then((ok) => {
        if (alive) setAccepted(ok);
      })
      .catch(() => {
        // Storage read failed — fall back to showing the gate (require an
        // explicit agreement) rather than hanging on the null loading state.
        if (alive) setAccepted(false);
      });
    return () => {
      alive = false;
    };
  }, [gateEpoch]);

  // Kill-switch wins over everything, including the terms gate.
  if (blocked) return <BoosthisDisabledNotice theme={props.theme} />;

  // Brief storage check — render nothing rather than flash the gate then hide it.
  if (accepted === null) return null;

  // First open (or terms revised): require an affirmative agreement before the
  // dashboard is shown. The gate persists acceptance itself, then calls onAccept.
  if (!accepted) {
    return (
      <BoosthisTermsGate theme={props.theme} onAccept={() => setAccepted(true)} />
    );
  }

  return (
    <DashboardBody
      {...props}
      onSignedOut={() => {
        // Sign-out restarts the WHOLE gate flow (owner requirement, Jul 2026):
        // acceptance was already cleared by the account card; flip back to the
        // gate and force a fresh storage read.
        setAccepted(false);
        setGateEpoch((n) => n + 1);
      }}
    />
  );
}

function DashboardBody({
  appName = "Boosthis",
  subtitle = "React Native Performance",
  screenName = "dashboard",
  theme,
  onRulePress,
  onSignedOut,
}: BoosthisDashboardProps & {
  /** Internal (DashboardGate → body): fires after the account card signs out
   *  so the gate dispatcher can swap back to the first-open gate flow. */
  onSignedOut?: () => void;
}) {
  const t = useMemo<BoosthisDashboardTheme>(
    () => ({ ...DARK_THEME, ...theme }),
    [theme],
  );
  // Feed the engine (snapshots, detectors, diagnose) with real events. The
  // dashboard is itself a screen, but the headline reports the host app's WORST
  // measured screen (this panel excluded), so a fast dashboard can never mask a
  // slow one. Re-derived on a light interval from the in-memory perf report.
  useBoosthis(screenName);

  const [headline, setHeadline] = useState<HeadlineState>(EMPTY_HEADLINE);
  // One-tap "Test connection": proves this build can actually reach Boosthis —
  // works even in a release/TestFlight build with no console. `testing` guards
  // against double-taps; `testSummary` mirrors the Alert inline so the result
  // stays visible after the Alert is dismissed.
  const [testing, setTesting] = useState(false);
  const [testSummary, setTestSummary] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const compute = async () => {
      try {
        const report = await perfMonitor.getReport();
        const fid = getSessionFid();
        let worst: { name: string; b: ScreenScoreBreakdown } | null = null;
        let scored = 0;
        for (const s of report.diagnosis.screens) {
          if (s.screen === screenName) continue; // skip the dashboard's own screen
          const b = computeScreenScore(s, fid ?? undefined);
          if (b.rating === "insufficient-data") continue;
          scored += 1;
          if (worst === null || b.score < worst.b.score) {
            worst = { name: s.screen, b };
          }
        }
        if (cancelled) return;
        setHeadline(
          worst === null
            ? { ...EMPTY_HEADLINE, fidMs: fid }
            : {
                score: worst.b.score,
                worstName: worst.name,
                ttffMs: worst.b.ttffMs,
                ttiMs: worst.b.ttiMs,
                fidMs: worst.b.fidMs ?? fid,
                scoredScreens: scored,
              },
        );
      } catch {
        // Best-effort; keep the last good headline.
      }
    };
    void compute();
    const id = setInterval(compute, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [screenName]);

  const { score, worstName, ttffMs, ttiMs, fidMs, scoredScreens } = headline;
  const rating = score !== null ? scoreRating(score) : "pending";
  const rColor = ratingColor(rating, t);
  const ratingLabel =
    rating === "good"
      ? "GOOD"
      : rating === "needs-work"
        ? "NEEDS WORK"
        : rating === "poor"
          ? "POOR"
          : "MEASURING";

  const budgets = [
    {
      label: "Worst screen P75 target",
      value: "500ms",
      ok: ttiMs === null || ttiMs < 500,
    },
    {
      label: "Score floor",
      value: "60 / 100",
      ok: score === null || score >= 60,
    },
  ];

  // Dev-only: surface the SELF-scoped read credentials so a developer can let
  // their OWN AI read this app's full live performance picture over Boosthis's
  // hosted MCP server (every live tool + boosthis.snapshot). Gated on __DEV__,
  // full-details telemetry being on, and a read token having been issued. Never
  // rendered in production builds. The read token is read-only and scoped to
  // THIS install: it can read only this app's own data and cannot forget or
  // ingest — far safer to surface than the delete token the card used to show.
  const isDev = (globalThis as { __DEV__?: boolean }).__DEV__ === true;
  const tele = isDev ? getActiveTelemetryClient() : null;
  const mcpCreds =
    tele && tele.enabled && !tele.issuesOnly && tele.readToken
      ? {
          installId: tele.installId,
          readToken: tele.readToken,
          // Hosted MCP lives next to the API (…/api → …/mcp).
          mcpUrl: tele.endpoint.replace(/\/api\/?$/, "") + "/mcp",
        }
      : null;
  // Paste-ready MCP server config. The per-call install_id + read_token are NOT
  // baked in here — they are passed as tool ARGUMENTS so the hosted server never
  // holds this install's creds in module state (the cross-leak guarantee).
  const mcpConfigSnippet = mcpCreds
    ? [
        "{",
        '  "mcpServers": {',
        '    "boosthis": {',
        `      "url": "${mcpCreds.mcpUrl}",`,
        '      "headers": { "Authorization": "Bearer <YOUR_INVITE_KEY>" }',
        "    }",
        "  }",
        "}",
      ].join("\n")
    : null;

  // Run the credential-free /healthz probe through the kit's real transport.
  // `runNetworkSelfTest` never throws or rejects and its `summary` is already
  // sanitized (no URL/token/email can leak), but we still wrap the whole handler
  // in safeAsync so a bad transport state can never bubble to the host app.
  const onTestConnection = () => {
    if (testing) return;
    setTesting(true);
    setTestSummary(null);
    safeAsync("dashboard:self-test", async () => {
      try {
        const result = await runNetworkSelfTest();
        setTestSummary(result.summary);
        Alert.alert("Boosthis connection", result.summary);
      } finally {
        setTesting(false);
      }
    });
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: t.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Registration-rejected banner (non-UUID install ID). Self-wrapped in
          its own boundary so a failure in this small notice degrades to
          nothing instead of collapsing the whole dashboard into the fatal
          fallback — a silent null is the right degrade for an inline strip. */}
      <BoosthisErrorBoundary name="install-id-notice">
        <InstallIdRejectedNotice t={t} />
      </BoosthisErrorBoundary>

      {/* The reporting verdict leads. A green local score must never appear
          before the warning that the app is not feeding Boosthis. */}
      <BoosthisErrorBoundary name="reporting-verdict">
        <ReportingVerdictNotice t={t} />
      </BoosthisErrorBoundary>

      {/* An app that cannot keep its install id looks perfectly healthy on
          every other line of this panel. It belongs beside the reporting
          verdict, not buried with the credentials it invalidates. */}
      <BoosthisErrorBoundary name="identity-persistence">
        <IdentityPersistenceNotice t={t} />
      </BoosthisErrorBoundary>

      {/* Hero */}
      <View style={[styles.heroCard, { backgroundColor: t.card, borderColor: t.border }]}>
        <View style={styles.heroHeader}>
          <Text style={[styles.heroTitle, { color: t.foreground }]}>{appName}</Text>
          <Text style={[styles.heroSub, { color: t.mutedForeground }]}>{subtitle}</Text>
        </View>

        <Text style={[styles.projectLine, { color: t.mutedForeground }]}>
          {PROJECT_LABEL}: {projectDisplay(getKitProject())}
        </Text>

        <View style={styles.gaugeWrapper}>
          <Text style={[styles.scoreNumber, { color: rColor }]}>
            {score === null ? "—" : score}
          </Text>
          <Text style={[styles.scoreOutOf, { color: t.mutedForeground }]}>/ 100</Text>
        </View>

        <Text style={[styles.scoreCaption, { color: t.mutedForeground }]}>
          {SCORE_CAPTION}
        </Text>

        <View
          style={[
            styles.ratingBadge,
            { backgroundColor: rColor + "1a", borderColor: rColor + "55" },
          ]}
        >
          <View style={[styles.ratingDot, { backgroundColor: rColor }]} />
          <Text style={[styles.ratingText, { color: rColor }]}>{ratingLabel}</Text>
        </View>

        <Text style={[styles.mountMs, { color: t.mutedForeground }]}>
          {score === null
            ? `measuring — open a few screens; ${FIRST_REPORT_WAIT_TEXT}`
            : `worst of ${scoredScreens} screen${
                scoredScreens === 1 ? "" : "s"
              }${worstName ? ` · ${worstName}` : ""}`}
        </Text>
      </View>

      {/* Breakdown */}
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.sectionTitle, { color: t.foreground }]}>Score breakdown</Text>
        <Text style={[styles.sectionSub, { color: t.mutedForeground }]}>
          worst screen{worstName ? ` · ${worstName}` : ""} · lower is better
        </Text>
        <MetricRow
          label="TTFF"
          value={ttffMs}
          good={SCORE_THRESHOLDS.ttff.good}
          poor={SCORE_THRESHOLDS.ttff.poor}
          weight={SCORE_WEIGHTS.ttff}
          t={t}
        />
        <MetricRow
          label="TTI"
          value={ttiMs}
          good={SCORE_THRESHOLDS.tti.good}
          poor={SCORE_THRESHOLDS.tti.poor}
          weight={SCORE_WEIGHTS.tti}
          t={t}
        />
        <MetricRow
          label="FID"
          value={fidMs}
          good={SCORE_THRESHOLDS.fid.good}
          poor={SCORE_THRESHOLDS.fid.poor}
          weight={SCORE_WEIGHTS.fid}
          t={t}
        />
        <Text style={[styles.formulaHint, { color: t.mutedForeground }]}>
          score = TTFF×{SCORE_WEIGHTS.ttff} + TTI×{SCORE_WEIGHTS.tti} + FID×
          {SCORE_WEIGHTS.fid} · good≥{RATING_CUTOFFS.good} · needs-work≥
          {RATING_CUTOFFS.needsWork}
        </Text>
      </View>

      {/* Budgets */}
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.sectionTitle, { color: t.foreground }]}>Budgets</Text>
        {budgets.map((row, i) => (
          <View
            key={row.label}
            style={[
              styles.budgetRow,
              {
                borderBottomColor: t.border,
                borderBottomWidth: i < budgets.length - 1 ? 1 : 0,
              },
            ]}
          >
            <View style={styles.budgetLeft}>
              <View
                style={[
                  styles.budgetDot,
                  { backgroundColor: row.ok ? t.good : t.needsWork },
                ]}
              />
              <Text style={[styles.budgetLabel, { color: t.foreground }]}>{row.label}</Text>
            </View>
            <Text style={[styles.budgetValue, { color: t.mutedForeground }]}>{row.value}</Text>
          </View>
        ))}
      </View>

      {/* Connection — a one-tap "can this build reach Boosthis?" probe. Useful
          in a release/TestFlight build where there is no console to inspect. */}
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Text style={[styles.sectionTitle, { color: t.foreground }]}>Connection</Text>
        <Text style={[styles.sectionSub, { color: t.mutedForeground }]}>
          Check that this build can reach Boosthis. Sends no data — just a health
          ping through the same transport telemetry uses.
        </Text>
        <Pressable
          onPress={onTestConnection}
          disabled={testing}
          hitSlop={8}
          style={[
            styles.testButton,
            {
              borderColor: t.border,
              backgroundColor: t.secondary,
              opacity: testing ? 0.6 : 1,
            },
          ]}
        >
          <Text style={[styles.testButtonText, { color: t.foreground }]}>
            {testing ? "Testing…" : "Test connection"}
          </Text>
        </Pressable>
        {testSummary ? (
          <Text style={[styles.testStatus, { color: t.mutedForeground }]}>
            {testSummary}
          </Text>
        ) : null}
      </View>

      {/* Rich engine surface — SAME component the Boosthis app renders. Its
          cards carry their own horizontal margin, so cancel the ScrollView
          padding here to keep them flush with the cards above. */}
      <View style={styles.enginePanelWrap}>
        {/* BoosthisEnginePanel self-wraps in its own error boundary (shows a
            "Diagnostics unavailable" card on failure), so no extra boundary is
            needed here. */}
        <BoosthisEnginePanel theme={t} onRulePress={onRulePress} />
      </View>

      {mcpCreds ? (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[styles.sectionTitle, { color: t.foreground }]}>
            Connect your AI · dev only
          </Text>
          <Text style={[styles.sectionSub, { color: t.mutedForeground }]}>
            Let your own AI read this app&apos;s full live performance picture
            over Boosthis&apos;s hosted MCP server. The read token is read-only
            and scoped to THIS app — it can&apos;t change or delete anything.
            Long-press any value to copy it.
          </Text>
          <Text style={[styles.credLabel, { color: t.mutedForeground }]}>
            install_id
          </Text>
          <Text selectable style={[styles.credValue, { color: t.foreground }]}>
            {mcpCreds.installId}
          </Text>
          <Text style={[styles.credLabel, { color: t.mutedForeground }]}>
            read_token · read-only · dies with this install
          </Text>
          <Text selectable style={[styles.credValue, { color: t.foreground }]}>
            {mcpCreds.readToken}
          </Text>
          <Text style={[styles.credLabel, { color: t.mutedForeground }]}>
            MCP server config — paste into your AI tool
          </Text>
          <Text
            selectable
            style={[
              styles.credValue,
              styles.codeBlock,
              { color: t.foreground, borderColor: t.border },
            ]}
          >
            {mcpConfigSnippet}
          </Text>
          <Text style={[styles.sectionSub, { color: t.mutedForeground, marginTop: 10 }]}>
            Then ask your AI to call boosthis.snapshot with the install_id and
            read_token above to read the whole picture — or any boosthis.* live
            tool for a single meter.
          </Text>
          {/* The credential that outlives this install id. See
              DURABLE_CREDENTIAL_BODY for why this card names it rather than
              minting one. */}
          <Text style={[styles.credLabel, { color: t.mutedForeground, marginTop: 10 }]}>
            {DURABLE_CREDENTIAL_TITLE}
          </Text>
          <Text style={[styles.sectionSub, { color: t.mutedForeground }]}>
            {DURABLE_CREDENTIAL_BODY}
          </Text>
        </View>
      ) : null}

      <Text style={[styles.privacyNote, { color: t.mutedForeground }]}>
        Measured on this device. Nothing leaves the phone.
      </Text>

      {/* "Connect to your account" — links this install to the developer's
          dashboard account via account login + the install's delete token (no
          project-key matching needed). The sign-in form is always shown (even
          before the app registers); a status line explains registration state,
          and linking completes automatically once a delete token exists. */}
      <View style={styles.accountFallback}>
        <BoosthisErrorBoundary
          name="account-card"
          fallbackRender={(reset, error) => (
            <BoosthisFatalFallback
              theme={theme}
              onRetry={reset}
              error={error}
              webLoginUrl={resolveDashboardWebUrl()}
              inline
              title="Sign-in card couldn’t load"
              message="Boosthis couldn’t load the in-app sign-in card. You can still log in on the web."
            />
          )}
        >
          <BoosthisAccountCard theme={t} onSignedOut={onSignedOut} />
        </BoosthisErrorBoundary>
      </View>

      {/* A persistent link to the full Terms & Conditions page, always reachable
          here after the one-time first-open agreement. */}
      <Pressable
        onPress={() => {
          // Best-effort: a synchronous throw OR a rejected promise from Linking
          // must never crash the dashboard (and the host). safeAsync swallows both.
          safeAsync("dashboard:open-terms", () => Linking.openURL(TERMS_URL));
        }}
        hitSlop={8}
        style={styles.termsLinkWrap}
      >
        <Text style={[styles.termsLink, { color: t.mutedForeground }]}>
          Terms &amp; Conditions
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  enginePanelWrap: { marginHorizontal: -16 },
  heroCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    marginBottom: 12,
    alignItems: "center",
  },
  heroHeader: { width: "100%", marginBottom: 12 },
  heroTitle: { fontSize: 24, fontWeight: "700", letterSpacing: -0.5 },
  heroSub: { fontSize: 12, marginTop: 2 },
  projectLine: { width: "100%", fontSize: 12, marginBottom: 8 },
  gaugeWrapper: { flexDirection: "row", alignItems: "flex-end", marginBottom: 12 },
  scoreNumber: { fontSize: 64, fontWeight: "800", letterSpacing: -2, lineHeight: 68 },
  scoreOutOf: { fontSize: 16, fontWeight: "500", marginBottom: 12, marginLeft: 4 },
  scoreCaption: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginBottom: 12,
  },
  ratingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 100,
    borderWidth: 1,
    marginBottom: 6,
  },
  ratingDot: { width: 6, height: 6, borderRadius: 3 },
  ratingText: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  mountMs: { fontSize: 12 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: "600", marginBottom: 2 },
  sectionSub: { fontSize: 11, marginBottom: 12 },
  verdictBody: { marginBottom: 0, lineHeight: 16 },
  metricRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  metricLeft: { flexDirection: "row", alignItems: "center", gap: 6, width: 80 },
  metricLabel: { fontSize: 12, fontWeight: "600", letterSpacing: 0.5 },
  metricWeight: { fontSize: 10 },
  metricRight: { flex: 1, alignItems: "flex-end", gap: 4 },
  metricValue: { fontSize: 13, fontWeight: "700", letterSpacing: -0.3 },
  metricBar: { height: 3, width: 80, borderRadius: 2, overflow: "hidden" },
  metricBarFill: { height: "100%", borderRadius: 2 },
  formulaHint: { fontSize: 10, marginTop: 10, textAlign: "center", lineHeight: 14 },
  budgetRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
  },
  budgetLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  budgetDot: { width: 8, height: 8, borderRadius: 4 },
  budgetLabel: { fontSize: 13 },
  budgetValue: { fontSize: 13, fontWeight: "600" },
  testButton: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  testButtonText: { fontSize: 13, fontWeight: "600", letterSpacing: 0.3 },
  testStatus: { fontSize: 11, marginTop: 10, lineHeight: 16 },
  privacyNote: { fontSize: 11, textAlign: "center", marginTop: 4 },
  accountFallback: { marginTop: 16 },
  termsLinkWrap: { alignItems: "center", paddingVertical: 14 },
  termsLink: {
    fontSize: 12,
    fontWeight: "500",
    textDecorationLine: "underline",
    letterSpacing: 0.3,
  },
  credLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5, marginTop: 10 },
  credValue: { fontSize: 12, marginTop: 2 },
  codeBlock: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    lineHeight: 18,
  },
});
