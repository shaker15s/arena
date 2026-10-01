/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * BoosthisFatalFallback — the VISIBLE fallback for the kit's full-screen
 * surfaces (the dashboard body and the first-open terms/connect gate).
 *
 * Background: BoosthisErrorBoundary is the SDK→host safety net. For the floating
 * launcher bubble the right failure mode is to silently disappear. But the
 * dashboard and the terms gate are full-screen surfaces the developer has
 * deliberately opened — usually inside the host's own modal — so a silent `null`
 * fallback leaves them staring at a black void with the host's modal chrome
 * still around it: it looks broken, gives no hint what happened, and there's no
 * way to recover. This component replaces that void with a small, themed card
 * that says Boosthis hit a snag and offers a "Try again" that resets the
 * boundary so the surface re-mounts.
 *
 * Two extra affordances make a crash recoverable AND diagnosable:
 *  - "Log in on the web →" (when `webLoginUrl` is supplied) opens the developer's
 *    web dashboard so they can ALWAYS sign in even if the in-app sign-in card is
 *    what crashed. A render bug in the kit must never strand a developer with no
 *    way to log in.
 *  - A short diagnostic line (when `error` is supplied) shows the error's name +
 *    first message line so a release build — where the boundary logs nothing —
 *    is no longer blind. This is ON-DEVICE ONLY: it is rendered locally and is
 *    never persisted, uploaded, or transmitted (no stack is shown), consistent
 *    with the privacy contract.
 *
 * Drop-in constraints: pure react-native primitives, fully themeable, with
 * sensible dark defaults matching the rest of the kit. The retry/open handlers
 * are wrapped in safeRun/safeAsync so even a misbehaving reset or a rejected
 * Linking call can never escape to the host.
 */
import React from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { safeAsync, safeRun } from "../safe";
import { DARK_THEME, type BoosthisDashboardTheme } from "./theme";

/**
 * Reduce a caught error to a single short, on-device-only line: its name plus
 * the FIRST line of its message, capped in length, with NO stack. Defensive
 * (never throws) because it runs inside a fallback that exists precisely because
 * something already went wrong. Returns null when there is nothing useful.
 */
function summarizeError(error: unknown): string | null {
  try {
    if (error == null) return null;
    let name = "Error";
    let msg = "";
    if (error instanceof Error) {
      name = error.name || "Error";
      msg = error.message || "";
    } else if (typeof error === "string") {
      msg = error;
    } else {
      msg = String(error);
    }
    const firstLine = msg.split("\n")[0].trim();
    const combined = firstLine ? `${name}: ${firstLine}` : name;
    return combined.length > 160 ? combined.slice(0, 159) + "…" : combined;
  } catch {
    return null;
  }
}

export function BoosthisFatalFallback({
  theme,
  onRetry,
  message,
  title,
  error,
  webLoginUrl,
  inline = false,
}: {
  theme?: Partial<BoosthisDashboardTheme>;
  /** Clears the boundary error so the surface re-mounts. */
  onRetry?: () => void;
  /** Optional override for the explanatory body line. */
  message?: string;
  /** Optional override for the card title. */
  title?: string;
  /**
   * The caught error, used to render an on-device-only diagnostic line (name +
   * first message line, no stack). Never persisted, uploaded, or transmitted.
   */
  error?: unknown;
  /**
   * When provided, renders a "Log in on the web →" link that opens this URL — an
   * always-available sign-in escape hatch even if the in-app sign-in card is the
   * thing that crashed.
   */
  webLoginUrl?: string;
  /**
   * Inline mode drops the full-screen centering wrapper so the card can embed
   * inside a scrolling layout (e.g. as a single failed card within the
   * dashboard) instead of taking over the whole surface.
   */
  inline?: boolean;
}) {
  const t: BoosthisDashboardTheme = { ...DARK_THEME, ...theme };
  const detail = summarizeError(error);

  const card = (
    <View
      style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}
    >
      <Text style={[styles.kicker, { color: t.mutedForeground }]}>BOOSTHIS</Text>
      <Text style={[styles.title, { color: t.foreground }]}>
        {title ?? "This screen couldn’t load"}
      </Text>
      <Text style={[styles.body, { color: t.mutedForeground }]}>
        {message ??
          "Boosthis hit a snag opening this screen. Your app is unaffected — you can try again."}
      </Text>
      {onRetry ? (
        <Pressable
          onPress={() => safeRun("fatal-fallback:retry", onRetry)}
          style={[styles.btn, { backgroundColor: t.primary }]}
          hitSlop={8}
        >
          <Text style={[styles.btnText, { color: t.background }]}>Try again</Text>
        </Pressable>
      ) : null}
      {webLoginUrl ? (
        <Pressable
          onPress={() =>
            safeAsync("fatal-fallback:web-login", () =>
              Linking.openURL(webLoginUrl),
            )
          }
          style={styles.linkWrap}
          hitSlop={8}
        >
          <Text style={[styles.link, { color: t.primary }]}>
            Log in on the web →
          </Text>
        </Pressable>
      ) : null}
      {detail ? (
        <Text
          selectable
          style={[styles.detail, { color: t.mutedForeground, borderColor: t.border }]}
        >
          {detail}
        </Text>
      ) : null}
    </View>
  );

  if (inline) return card;
  return (
    <View style={[styles.root, { backgroundColor: t.background }]}>{card}</View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 8,
  },
  kicker: { fontSize: 12, fontWeight: "600", letterSpacing: 2 },
  title: { fontSize: 18, fontWeight: "700" },
  body: { fontSize: 14, lineHeight: 21 },
  btn: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 8,
  },
  btnText: { fontSize: 15, fontWeight: "700" },
  linkWrap: { alignItems: "center", paddingVertical: 10 },
  link: { fontSize: 14, fontWeight: "700" },
  detail: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
});
