/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * BoosthisTermsGate — the first-open "connect + agree" screen for the drop-in
 * surface, mirroring the standalone Boosthis app's first-launch gate.
 *
 * It shows the "Connect to your account" card on top (mandatory once the app is
 * registered, so the bubble is tied to the developer's dashboard) followed by
 * the Terms & Privacy box + acceptance checkbox. The full legal text lives only
 * on the hosted /terms page.
 *
 * Scope (important): this gates the BOOSTHIS surface only. It is rendered by
 * BoosthisDashboard the first time a developer/tester opens the Boosthis
 * dashboard or floating bubble inside a host app. It NEVER blocks the host
 * app's own UI or the host app's end users — they never see it.
 *
 * Drop-in constraints (works in ANY Expo / React Native app):
 *  - Pure react-native primitives only (View / Text / Pressable / ScrollView /
 *    Linking / Alert). No icon packs, no custom fonts, no theme provider.
 *  - Fully themeable via the optional `theme` prop; sensible dark defaults that
 *    match BoosthisDashboard.
 */
import React, { useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { DARK_THEME, type BoosthisDashboardTheme } from "./theme";
import { recordAcceptance } from "./consent";
import { BoosthisAccountCard } from "./BoosthisAccountCard";
import { getActiveTelemetryClient, resolveDashboardWebUrl } from "../telemetry";
import { BoosthisErrorBoundary } from "./BoosthisErrorBoundary";
import { BoosthisFatalFallback } from "./BoosthisFatalFallback";
import { safeAsync } from "../safe";

/**
 * Full hosted Terms & Privacy page. Uses the deployed API domain (the
 * api-server serves the combined document at /terms) with a public fallback so
 * the link works even if the host app hasn't wired an override.
 */
const TERMS_URL = `${(
  (globalThis as unknown as { process?: { env?: Record<string, string> } })
    .process?.env?.EXPO_PUBLIC_API_URL || "https://www.boosthis.com"
).replace(/\/+$/, "")}/terms`;

export interface BoosthisTermsGateProps {
  /** Called once the user accepts and acceptance has been persisted. */
  onAccept: () => void;
  /** Override any subset of the default dark theme colors. */
  theme?: Partial<BoosthisDashboardTheme>;
}

/**
 * Public terms gate. Self-wraps the implementation in an error boundary so a
 * render-time throw can NEVER escape to the host app — including when a host
 * renders <BoosthisTermsGate /> directly. On failure it shows a visible
 * "couldn’t load — try again" card (not a silent black void) so a developer who
 * opened the gate inside their host's modal can recover instead of being stuck.
 */
export function BoosthisTermsGate(props: BoosthisTermsGateProps) {
  return (
    <BoosthisErrorBoundary
      name="terms-gate"
      fallbackRender={(reset, error) => (
        <BoosthisFatalFallback
          theme={props.theme}
          onRetry={reset}
          error={error}
          webLoginUrl={resolveDashboardWebUrl()}
        />
      )}
    >
      <TermsGateInner {...props} />
    </BoosthisErrorBoundary>
  );
}

function TermsGateInner({ onAccept, theme }: BoosthisTermsGateProps) {
  const t: BoosthisDashboardTheme = { ...DARK_THEME, ...theme };
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);

  // Connecting the app to a dashboard account is mandatory — but only once the
  // app is actually registered (there is something to link). An unregistered
  // app still shows the sign-in form (plus a "not registered yet" status line)
  // and can proceed on terms alone, so a developer testing the bubble is never
  // hard-locked out of their own data before the app has registered.
  const client = getActiveTelemetryClient();
  const registered = !!(
    client?.installId &&
    client?.deleteToken &&
    client?.endpoint
  );
  const needsConnect = registered && !connected;
  const canAgree = checked && !needsConnect;

  const accept = async () => {
    if (!canAgree || busy) return;
    setBusy(true);
    // Only Boosthis-owned persistence is caught here; a failure is a real "save"
    // problem the developer should see. A throw from the host-provided onAccept
    // is the HOST's callback (like onRulePress) — we deliberately do NOT swallow
    // or mislabel it, so it surfaces to the host's own error handling.
    try {
      await recordAcceptance(client?.installId ?? null);
    } catch {
      setBusy(false);
      Alert.alert("Could not save", "Please try again.");
      return;
    }
    onAccept();
  };

  const decline = () => {
    Alert.alert(
      "Agreement required",
      "You must accept the Terms & Privacy before you can use Boosthis.",
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: t.background }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator
      >
        <Text style={[styles.kicker, { color: t.mutedForeground }]}>
          BOOSTHIS
        </Text>

        {/* Connect to your account — placed above the Terms box so the bubble is
            tied to the developer's dashboard before they enter. */}
        <BoosthisAccountCard theme={t} onConnectedChange={setConnected} />

        <Text style={[styles.title, { color: t.foreground }]}>
          Terms of Service & Privacy
        </Text>
        <Text style={[styles.intro, { color: t.mutedForeground }]}>
          Please review and accept before using Boosthis.
        </Text>

        <Text style={[styles.body, { color: t.mutedForeground }]}>
          Everything — liability, what Boosthis collects, AI suggestions, and
          project-key access — lives on the Terms & Conditions page. Open it and
          read it, then tick the box below to agree.
        </Text>

        <Pressable
          onPress={() => {
            // Opening the external Terms URL is best-effort: a synchronous throw
            // OR a rejected promise from Linking must never crash the gate (which
            // blocks the host app). safeAsync swallows both.
            safeAsync("terms-gate:open-url", () => Linking.openURL(TERMS_URL));
          }}
          style={[styles.readBtn, { borderColor: t.primary }]}
          hitSlop={8}
        >
          <Text style={[styles.readBtnText, { color: t.primary }]}>
            Read the full Terms & Conditions →
          </Text>
        </Pressable>
      </ScrollView>

      <View
        style={[
          styles.footer,
          { backgroundColor: t.card, borderColor: t.border },
        ]}
      >
        <Pressable
          onPress={() => setChecked((v) => !v)}
          style={styles.checkRow}
          hitSlop={8}
        >
          <View
            style={[
              styles.checkbox,
              {
                borderColor: checked ? t.primary : t.border,
                backgroundColor: checked ? t.primary : "transparent",
              },
            ]}
          >
            {checked ? (
              <Text style={[styles.checkmark, { color: t.background }]}>✓</Text>
            ) : null}
          </View>
          <Text style={[styles.checkLabel, { color: t.foreground }]}>
            I have read and agree to the Terms of Service & Privacy Policy.
          </Text>
        </Pressable>

        {needsConnect ? (
          <Text style={[styles.hint, { color: t.mutedForeground }]}>
            Sign in above to connect this app to your dashboard before
            continuing.
          </Text>
        ) : null}

        <Pressable
          onPress={accept}
          disabled={!canAgree || busy}
          style={[
            styles.agree,
            { backgroundColor: canAgree ? t.primary : t.secondary },
          ]}
        >
          <Text
            style={[
              styles.agreeText,
              { color: canAgree ? t.background : t.mutedForeground },
            ]}
          >
            {busy ? "Saving…" : "I Agree & Continue"}
          </Text>
        </Pressable>

        <Pressable onPress={decline} style={styles.declineBtn} hitSlop={8}>
          <Text style={[styles.declineText, { color: t.mutedForeground }]}>
            Decline
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 28, gap: 12 },
  kicker: { fontSize: 12, fontWeight: "600", letterSpacing: 2 },
  title: { fontSize: 26, fontWeight: "700" },
  intro: { fontSize: 14, marginBottom: 4 },
  body: { fontSize: 14, lineHeight: 21 },
  readBtn: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  readBtnText: { fontSize: 15, fontWeight: "600" },
  footer: { borderTopWidth: 1, padding: 16, gap: 12 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkmark: { fontSize: 15, fontWeight: "700", lineHeight: 18 },
  checkLabel: { fontSize: 14, fontWeight: "500", flex: 1 },
  hint: { fontSize: 12, lineHeight: 17, marginBottom: 2 },
  agree: { borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  agreeText: { fontSize: 16, fontWeight: "600" },
  declineBtn: { alignItems: "center", paddingVertical: 6 },
  declineText: { fontSize: 14, fontWeight: "500" },
});
