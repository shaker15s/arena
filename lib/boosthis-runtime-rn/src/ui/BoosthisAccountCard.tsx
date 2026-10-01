/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * BoosthisAccountCard — "Connect to your account" surface inside the drop-in
 * Boosthis dashboard.
 *
 * The developer signs into their Boosthis dashboard account (the SAME account as
 * the web `/app` and standalone app) and links THIS install directly, so the app
 * appears in their dashboard without the invite key having to match in three
 * places. Two separable steps:
 *   1. SIGN IN — needs only the API endpoint (always resolvable), so the
 *      email/password form is shown REGARDLESS of registration state. This is
 *      why the card no longer "vanishes" before an app has registered.
 *   2. LINK — claiming THIS install into the account needs proof of control:
 *      the install's delete token (issued at registration), sent to
 *      `POST /installs/{installId}/claim`. Until the app is registered (no
 *      delete token yet) there is nothing to claim, so linking is deferred and
 *      a clear status line explains it will happen automatically once telemetry
 *      registers the app. The security model is unchanged — a guessed install id
 *      can never be claimed without its delete token.
 *
 * The email/password form is a developer surface — mount the dashboard behind
 * your own dev gate, the same as the "Connect your AI" card.
 */
import React, { useEffect, useState } from "react";
import {
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  applyServerFullTelemetry,
  DEFAULT_TELEMETRY_ENDPOINT,
  getActiveTelemetryClient,
  resolveDashboardWebUrl,
} from "../telemetry";
import { clearAcceptance } from "./consent";
import { describeProjectKeySource } from "../projectKey";
import type { RegistrationVerdict } from "../registration";
import { safeAsync } from "../safe";
import { useInstallIdRejected } from "../hooks/useEntitlement";
import { RUNTIME_VERSION } from "../thresholds";
import { BoosthisSpinner } from "./BoosthisSpinner";
import type { BoosthisDashboardTheme } from "./theme";
import {
  AccountError,
  claimInstall,
  claimInstallResult,
  clearStoredAccount,
  getStoredAccount,
  login,
  logout,
  resendLoginOtp,
  setInstallTelemetry,
  verifyLoginOtp,
  type StoredAccount,
} from "./account";

/** The dashboard's quiet-failure notice kind, or null when there is nothing to say.
 *  Ordered EXACTLY like the sibling kits' compute_panel_notice (Ruby is the
 *  reference): the server rejecting the id outright outranks "never
 *  registered", which outranks "registered but nothing is being uploaded".
 *
 *  Pure + exported so the mapping can be asserted without rendering. The copy
 *  the dashboard renders for each kind is fixed and code-defined — no server text,
 *  key, token, endpoint, or install id ever reaches it.
 *
 *    install-id-not-uuid → null here (the rejected status ROW owns that copy).
 *    not-registered      → registered:false, so nothing is being sent at all.
 *    sharing-off         → registered but nothing feeds the dashboard. */
export function computeAccountNotice(state: {
  installIdRejected: boolean;
  registered: boolean;
  sharingActive: boolean;
  /** Boosthis's own answer to "is this install on file?". Absent means the
   *  caller has none yet (older call sites), which is treated as unanswered. */
  registrationVerdict?: RegistrationVerdict;
  lastUploadAttemptFailed?: boolean;
}): "not-registered" | "registration-unknown" | "sharing-off" | "uploads-failing" | null {
  if (state.installIdRejected) return null;
  const verdict = state.registrationVerdict ?? "unknown";
  // Boosthis SAID no. The one case where "nothing is being sent" is honest.
  if (verdict === "unregistered") return "not-registered";
  if (verdict === "unknown") {
    // Unanswered. On-device state may fill the gap ONLY here — a launch
    // holding a server-minted delete token knows something real — but it can
    // never turn an unanswered question into a definite negative.
    if (!state.registered) return "registration-unknown";
  }
  if (!state.sharingActive) return "sharing-off";
  if (state.lastUploadAttemptFailed) return "uploads-failing";
  return null;
}

export function BoosthisAccountCard({
  theme: t,
  onConnectedChange,
  onSignedOut,
}: {
  theme: BoosthisDashboardTheme;
  /**
   * Optional: report VERIFIED link state up to a host gate (fires true only
   * after a successful install claim, not on mere sign-in). The first-open
   * Terms + Connect screen uses this to require connection before entering.
   */
  onConnectedChange?: (connected: boolean) => void;
  /**
   * Optional: fires after a sign-out completes (local creds + terms acceptance
   * already cleared). The dashboard uses it to swap back to the first-open
   * gate so the whole flow (sign-in → telemetry → terms) runs again.
   */
  onSignedOut?: () => void;
}) {
  const client = getActiveTelemetryClient();
  const installId = client?.installId ?? null;
  const deleteToken = client?.deleteToken ?? null;
  // Use the SAME fetch adapter the telemetry client uses for consent, so a
  // host-configured fetch (or RN's global one) is used identically. Consent
  // reaches the server on-device; a sign-in using a different transport may not.
  const fetchImpl = client?.fetchImpl;
  // Sign-in only needs an endpoint; fall back to the default so the form works
  // even before telemetry has been enabled. Linking still requires the install
  // id + delete token below, which only a registered app holds.
  // Use `||` (not `??`) plus a literal fallback so an empty string OR an
  // undefined DEFAULT (possible under a release-build circular-import init order)
  // can never leave `endpoint` undefined — `endpoint.replace(...)` below would
  // otherwise throw at render and collapse the whole sign-in card.
  const endpoint =
    client?.endpoint ||
    DEFAULT_TELEMETRY_ENDPOINT ||
    "https://www.boosthis.com/api";
  // Whether THIS install can actually be claimed yet (proof of control present).
  const canLink = !!(installId && deleteToken);
  // WHICH project key this app reports under. A phone app added to a codebase
  // that already reported under another key used to inherit it in silence, so
  // the developer's new key stayed empty with no explanation anywhere. The
  // masked tail (last four characters) is enough to tell two keys apart on a
  // device; the key itself is never rendered.
  const projectKey = client?.projectKey ?? null;
  // The web dashboard lives at /app on the SAME host as the /api endpoint, so a
  // developer who hasn't created an account yet can be sent straight there to
  // make one (we can't say "no account exists" from a sign-in attempt without
  // leaking which emails are registered). Resolved via the shared crash-safe
  // helper so it can never throw at render.
  const dashboardUrl = resolveDashboardWebUrl();

  // Registration was refused because this app's install id is not a UUID
  // (server 400 + the `invalid_install_id` marker). Subscribed so the card
  // flips to the rejected state the moment the consent path resolves it — a
  // moment after first paint — instead of sitting on the ordinary
  // "isn't registered yet" line, which reads as normal and is what made this
  // failure look like "Boosthis is broken". A plain boolean: the copy is fixed
  // and code-defined, and no server or developer string is ever rendered.
  const installIdRejected = useInstallIdRejected();

  const [account, setAccount] = useState<StoredAccount | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);
  // Pending email-code (OTP) step: after a correct password the server emails
  // a 6-digit code and returns a challenge token. While set, the card shows
  // the code-entry form instead of the password form.
  const [otp, setOtp] = useState<{
    challengeToken: string;
    email: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  // Full-telemetry toggle state. `null` until a successful claim tells us the
  // current override (the claim response's `fullTelemetry`, or the kit's
  // current effective mode as a fallback). Only rendered once linked, so the
  // developer's tap has the delete token + session it needs to POST the change.
  const [telemetryOn, setTelemetryOn] = useState<boolean | null>(null);
  const [telemetryBusy, setTelemetryBusy] = useState(false);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getStoredAccount()
      .then((a) => {
        if (alive) {
          setAccount(a);
          setLoaded(true);
        }
      })
      .catch(() => {
        // Storage read failed — still mark loaded so the card renders its
        // sign-in form instead of hanging on a null (blank) state forever.
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Report VERIFIED link state up to a host gate (the first-open Terms + Connect
  // screen requires a successful link before it lets the user into the
  // dashboard). Reporting on `account` alone would unlock the gate for a merely
  // signed-in user whose claim later fails (stale session, 404/409, network).
  useEffect(() => {
    onConnectedChange?.(linked);
  }, [linked, onConnectedChange]);

  // Reset verified-link state whenever the identity we would link changes (a
  // new sign-in, or the active telemetry client / install swapping under us), so
  // a stale `linked: true` from a prior install/account can never keep a host
  // gate unlocked before the NEW claim is verified. The claim effect below then
  // re-establishes it only on a fresh successful claim.
  useEffect(() => {
    setLinked(false);
    // A new identity means the prior install's telemetry state no longer
    // applies; re-initialize from the fresh claim below.
    setTelemetryOn(null);
    setTelemetryError(null);
  }, [account?.token, installId, deleteToken]);

  // Once signed in on a registered install, silently (re-)link this install to
  // the account so the server claim stays in sync without a manual tap. The
  // claim is idempotent server-side, so re-running it on reopen is safe. Until
  // the app is registered (no delete token), this is a no-op — there is nothing
  // to claim — and no error is shown. Errors on a registered app ARE surfaced
  // (not swallowed) so the gate stays locked with a clear reason; a stale
  // session (401 reason "session") drops the stored account so the sign-in
  // form returns. A stale INSTALL credential (401 reason "install_token",
  // AccountError code "stale_install") deliberately does NOT drop the account:
  // the session is fine — the fix is a dashboard Repair + relaunch, and the
  // message below tells the developer exactly that.
  useEffect(() => {
    if (!(account && installId && deleteToken)) return;
    let alive = true;
    claimInstallResult(endpoint, account.token, installId, deleteToken, fetchImpl)
      .then((result) => {
        if (!alive) return;
        setLinked(result.linked);
        if (result.linked) {
          // Initialize the telemetry toggle from the claim response's current
          // override, falling back to the kit's current effective mode when the
          // server omits it (older server, or a re-claim that doesn't re-echo).
          setTelemetryOn(
            typeof result.fullTelemetry === "boolean"
              ? result.fullTelemetry
              : (getActiveTelemetryClient()?.fullTelemetryEffective ?? false),
          );
        } else {
          setError("Couldn’t link this app. Tap “Link this app” to retry.");
        }
      })
      .catch(async (err) => {
        if (err instanceof AccountError && err.code === "unauthorized") {
          try {
            await clearStoredAccount();
          } catch {
            // best-effort: clearing local creds must never crash the gate
          }
          if (!alive) return;
          setAccount(null);
          setLinked(false);
          setError("Your session expired. Please sign in again.");
        } else {
          if (!alive) return;
          setLinked(false);
          setError(
            err instanceof AccountError
              ? err.message
              : "Couldn’t link this app. Try again.",
          );
        }
      });
    return () => {
      alive = false;
    };
  }, [account, installId, deleteToken, endpoint, fetchImpl]);

  // Wait for the stored-account read before rendering so we don't flash the
  // signed-out form for a developer who is actually already signed in.
  if (!loaded) return null;

  const link = async (token: string) => {
    if (!installId || !deleteToken) return;
    const ok = await claimInstall(
      endpoint,
      token,
      installId,
      deleteToken,
      fetchImpl,
    );
    setLinked(ok);
  };

  const onConnect = async () => {
    setError(null);
    setInfo(null);
    const e = email.trim();
    if (!e || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      const result = await login(endpoint, e, password, fetchImpl);
      if (result.status === "otp-required") {
        // Password OK — the server emailed a 6-digit code. Show the
        // code-entry step; nothing is signed in yet.
        setOtp({ challengeToken: result.challengeToken, email: e });
        setCode("");
        setPassword("");
      } else {
        setAccount(result.account);
        setPassword("");
        // Linking happens automatically via the effect above once `account` is
        // set AND the app is registered (has a delete token). On an
        // unregistered app the developer stays signed in and it links itself
        // later.
      }
    } catch (err) {
      const msg =
        err instanceof AccountError
          ? err.message
          : "Something went wrong. Please try again.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const onVerifyCode = async () => {
    if (!otp) return;
    setError(null);
    setInfo(null);
    if (code.length !== 6) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setBusy(true);
    try {
      const acct = await verifyLoginOtp(
        endpoint,
        otp.challengeToken,
        code,
        otp.email,
        fetchImpl,
      );
      setOtp(null);
      setCode("");
      setAccount(acct);
    } catch (err) {
      if (err instanceof AccountError && err.code === "challenge_expired") {
        // Dead challenge (expired or too many wrong tries) — back to the
        // password form for a fresh sign-in.
        setOtp(null);
        setCode("");
        setError(err.message);
      } else {
        setError(
          err instanceof AccountError
            ? err.message
            : "Something went wrong. Please try again.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const onResendCode = async () => {
    if (!otp) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await resendLoginOtp(endpoint, otp.challengeToken, fetchImpl);
      setCode("");
      setInfo("We sent a new code. Only the newest one works.");
    } catch (err) {
      if (err instanceof AccountError && err.code === "challenge_expired") {
        setOtp(null);
        setCode("");
        setError(err.message);
      } else {
        setError(
          err instanceof AccountError
            ? err.message
            : "Couldn't send a new code. Please try again.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const onBackToSignIn = () => {
    setOtp(null);
    setCode("");
    setError(null);
    setInfo(null);
  };

  const onRelink = async () => {
    if (!account || !canLink) return;
    setError(null);
    setBusy(true);
    try {
      await link(account.token);
    } catch (err) {
      if (err instanceof AccountError && err.code === "unauthorized") {
        // Stale session — drop it so the form returns for a fresh sign-in.
        // clearStoredAccount is best-effort: a rejection must not escape this
        // async onPress into the host.
        try {
          await clearStoredAccount();
        } catch {
          // local creds may already be gone — ignore
        }
        setAccount(null);
        setLinked(false);
      }
      setError(
        err instanceof AccountError ? err.message : "Linking failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const onToggleTelemetry = async () => {
    // Only actionable once linked (we need the session + delete token) and not
    // mid-flight. `telemetryOn` is guaranteed non-null here because the toggle
    // only renders after a successful claim initialized it.
    if (!account || !canLink || !installId || !deleteToken) return;
    if (telemetryBusy || telemetryOn === null) return;
    const next = !telemetryOn;
    setTelemetryError(null);
    setTelemetryBusy(true);
    try {
      const applied = await setInstallTelemetry(
        endpoint,
        account.token,
        installId,
        deleteToken,
        next,
        fetchImpl,
      );
      setTelemetryOn(applied);
      // Apply IMMEDIATELY in-session via the kit's existing directive-apply
      // path (the same functions postConsent uses for serverFullTelemetry) so
      // the new mode takes effect with no relaunch and no code change.
      applyServerFullTelemetry(applied);
    } catch (err) {
      // Short, friendly, never a raw dump. AccountError codes are mapped in
      // account.ts to already-friendly messages; a non-AccountError gets a
      // generic line.
      setTelemetryError(
        err instanceof AccountError
          ? err.message
          : "Couldn’t change telemetry. Try again.",
      );
    } finally {
      setTelemetryBusy(false);
    }
  };

  const onDisconnect = async () => {
    setBusy(true);
    // Remote logout is best-effort; we always clear local creds + reset state
    // afterwards. Neither step may throw out of this handler — it's an async
    // onPress, so a rejection would surface as an unhandled rejection at the
    // host root.
    try {
      if (account) await logout(endpoint, account.token, fetchImpl);
    } catch {
      // ignore — fall through to local sign-out below
    }
    try {
      await clearStoredAccount();
    } catch {
      // best-effort — local creds may already be gone
    }
    // Owner requirement (Jul 2026): signing out of the kit restarts the WHOLE
    // gate flow. Wipe the local terms acceptance so the next open shows the
    // full sign-in → telemetry → terms gate again.
    try {
      await clearAcceptance();
    } catch {
      // best-effort — the gate re-check will still run via onSignedOut
    }
    setAccount(null);
    setLinked(false);
    setError(null);
    setBusy(false);
    // Notify the surface AFTER local state settles; a throw from this
    // host-provided callback must never escape this async onPress.
    try {
      onSignedOut?.();
    } catch {
      // never throw into the host
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={[styles.title, { color: t.foreground }]}>
        Connect to your account
      </Text>
      <Text style={[styles.sub, { color: t.mutedForeground }]}>
        Sign in to link this app to your Boosthis dashboard. It then shows up
        under your account automatically — no project-key matching needed.
      </Text>

      {/* Always-visible registration status, so it's never ambiguous why the
          app may not be linked yet. A non-UUID install id outranks both normal
          states: the server refused the registration outright, so showing
          "registered" or the calm "not registered yet" line would be wrong. */}
      {installIdRejected ? (
        <View style={[styles.statusRow, { borderColor: t.border }]}>
          <View style={[styles.dot, { backgroundColor: t.poor }]} />
          <Text style={[styles.statusText, { color: t.poor }]}>
            Registration rejected — install ID must be a UUID. Mint a real UUID
            and restart.
          </Text>
        </View>
      ) : canLink ? (
        <View style={[styles.statusRow, { borderColor: t.border }]}>
          <View style={[styles.dot, { backgroundColor: t.good }]} />
          <Text style={[styles.statusText, { color: t.mutedForeground }]}>
            This app is registered with Boosthis.
          </Text>
        </View>
      ) : (
        <View style={[styles.statusRow, { borderColor: t.border }]}>
          <View style={[styles.dot, { backgroundColor: t.mutedForeground }]} />
          <Text style={[styles.statusText, { color: t.mutedForeground }]}>
            This app isn’t registered with Boosthis yet. You can still sign in
            now — it links to your account automatically once telemetry is
            enabled and the app registers.
          </Text>
        </View>
      )}

      {/* WHICH project key this app reports under — the answer to "why is my
          new key empty?", on the device, without the developer guessing. */}
      {projectKey ? (
        <View style={[styles.statusRow, { borderColor: t.border }]}>
          <View
            style={[
              styles.dot,
              { backgroundColor: projectKey.key ? t.mutedForeground : t.needsWork },
            ]}
          />
          <Text
            style={[
              styles.statusText,
              { color: projectKey.key ? t.mutedForeground : t.needsWork },
            ]}
          >
            {projectKey.key
              ? `Reporting under project key ending ${projectKey.display} — ${describeProjectKeySource(projectKey)}.`
              : "No project key set for React Native, so this app cannot register on its own."}
          </Text>
        </View>
      ) : null}

      {account ? (
        <View>
          <View style={styles.signedInRow}>
            <View style={[styles.dot, { backgroundColor: t.good }]} />
            <Text style={[styles.signedIn, { color: t.foreground }]}>
              Signed in as {account.email}
            </Text>
          </View>
          {canLink ? (
            linked ? (
              <View>
                <View style={[styles.linkedRow, { borderColor: t.border }]}>
                  <View style={[styles.dot, { backgroundColor: t.good }]} />
                  <Text style={[styles.linkedText, { color: t.good }]}>
                    This app is linked to your account.
                  </Text>
                </View>
                {telemetryOn !== null ? (
                  <View style={[styles.telemetryRow, { borderColor: t.border }]}>
                    <View style={styles.telemetryTextCol}>
                      <Text
                        style={[styles.telemetryLabel, { color: t.foreground }]}
                      >
                        Full telemetry
                      </Text>
                      <Text
                        style={[styles.telemetrySub, { color: t.mutedForeground }]}
                      >
                        Upload the complete meter picture so your dashboard and
                        AI can see performance. Off = private mode.
                      </Text>
                      {telemetryError ? (
                        <Text style={[styles.error, { color: t.poor }]}>
                          {telemetryError}
                        </Text>
                      ) : null}
                    </View>
                    <TouchableOpacity
                      disabled={telemetryBusy}
                      onPress={onToggleTelemetry}
                      hitSlop={8}
                      style={[
                        styles.telemetryToggle,
                        {
                          borderColor: telemetryOn ? t.primary : t.border,
                          backgroundColor: telemetryOn ? t.primary : t.secondary,
                          opacity: telemetryBusy ? 0.6 : 1,
                        },
                      ]}
                    >
                      {telemetryBusy ? (
                        <BoosthisSpinner
                          color={telemetryOn ? t.background : t.mutedForeground}
                        />
                      ) : (
                        <Text
                          style={[
                            styles.telemetryToggleText,
                            {
                              color: telemetryOn
                                ? t.background
                                : t.mutedForeground,
                            },
                          ]}
                        >
                          {telemetryOn ? "ON" : "OFF"}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ) : (
              <Text style={[styles.sub, { color: t.mutedForeground }]}>
                Tap “Link this app” to connect this install.
              </Text>
            )
          ) : (
            <Text style={[styles.sub, { color: t.mutedForeground }]}>
              Waiting for this app to register with Boosthis — it’ll link to your
              account automatically. No further action needed.
            </Text>
          )}
          {error ? (
            <Text style={[styles.error, { color: t.poor }]}>{error}</Text>
          ) : null}
          <View style={styles.buttonRow}>
            {canLink ? (
              <TouchableOpacity
                disabled={busy}
                onPress={onRelink}
                style={[
                  styles.button,
                  { backgroundColor: t.primary, opacity: busy ? 0.6 : 1 },
                ]}
              >
                {busy ? (
                  <BoosthisSpinner color={t.background} />
                ) : (
                  <Text style={[styles.buttonText, { color: t.background }]}>
                    {linked ? "Re-link this app" : "Link this app"}
                  </Text>
                )}
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              disabled={busy}
              onPress={onDisconnect}
              style={[styles.ghostButton, { borderColor: t.border }]}
            >
              <Text style={[styles.ghostButtonText, { color: t.mutedForeground }]}>
                Sign out
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : otp ? (
        <View>
          <Text style={[styles.sub, { color: t.mutedForeground }]}>
            We emailed a 6-digit code to {otp.email}. Enter it below to finish
            signing in. The code expires after 10 minutes.
          </Text>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D+/g, "").slice(0, 6))}
            placeholder="123456"
            placeholderTextColor={t.mutedForeground}
            keyboardType="number-pad"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={6}
            editable={!busy}
            style={[
              styles.input,
              styles.codeInput,
              { color: t.foreground, borderColor: t.border, backgroundColor: t.secondary },
            ]}
          />
          {info ? (
            <Text style={[styles.info, { color: t.good }]}>{info}</Text>
          ) : null}
          {error ? (
            <Text style={[styles.error, { color: t.poor }]}>{error}</Text>
          ) : null}
          <TouchableOpacity
            disabled={busy}
            onPress={onVerifyCode}
            style={[
              styles.button,
              { backgroundColor: t.primary, opacity: busy ? 0.6 : 1 },
            ]}
          >
            {busy ? (
              <BoosthisSpinner color={t.background} />
            ) : (
              <Text style={[styles.buttonText, { color: t.background }]}>
                Verify code
              </Text>
            )}
          </TouchableOpacity>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              disabled={busy}
              onPress={onResendCode}
              style={[styles.ghostButton, { borderColor: t.border }]}
            >
              <Text style={[styles.ghostButtonText, { color: t.mutedForeground }]}>
                Resend code
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={busy}
              onPress={onBackToSignIn}
              style={[styles.ghostButton, { borderColor: t.border }]}
            >
              <Text style={[styles.ghostButtonText, { color: t.mutedForeground }]}>
                Back
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={t.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            editable={!busy}
            style={[
              styles.input,
              { color: t.foreground, borderColor: t.border, backgroundColor: t.secondary },
            ]}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={t.mutedForeground}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            style={[
              styles.input,
              { color: t.foreground, borderColor: t.border, backgroundColor: t.secondary },
            ]}
          />
          {error ? (
            <Text style={[styles.error, { color: t.poor }]}>{error}</Text>
          ) : null}
          <TouchableOpacity
            disabled={busy}
            onPress={onConnect}
            style={[
              styles.button,
              { backgroundColor: t.primary, opacity: busy ? 0.6 : 1 },
            ]}
          >
            {busy ? (
              <BoosthisSpinner color={t.background} />
            ) : (
              <Text style={[styles.buttonText, { color: t.background }]}>
                {canLink ? "Sign in & link this app" : "Sign in"}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() =>
              safeAsync("account-card:open-dashboard", () =>
                Linking.openURL(dashboardUrl),
              )
            }
            hitSlop={8}
            style={styles.createRow}
          >
            <Text style={[styles.createText, { color: t.mutedForeground }]}>
              Prefer your browser?{" "}
              <Text style={{ color: t.primary }}>
                Log in or create an account on the web →
              </Text>
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Always-visible kit version stamp. Makes a rebuild self-verifying: if a
          fresh build still shows an OLD version here, the kit update did not
          actually land in the bundle (stale Metro/EAS cache). */}
      <Text style={[styles.version, { color: t.mutedForeground }]}>
        Boosthis kit v{RUNTIME_VERSION}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  title: { fontSize: 14, fontWeight: "600", marginBottom: 2 },
  sub: { fontSize: 11, marginBottom: 12 },
  signedIn: { fontSize: 13, fontWeight: "600", flex: 1 },
  signedInRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  createRow: { marginTop: 12, alignItems: "center" },
  createText: { fontSize: 12, textAlign: "center" },
  statusRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 12,
  },
  statusText: { fontSize: 11, flex: 1, lineHeight: 16 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 10,
  },
  button: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  buttonText: { fontSize: 14, fontWeight: "700" },
  buttonRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  ghostButton: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  ghostButtonText: { fontSize: 13, fontWeight: "600" },
  linkedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  linkedText: { fontSize: 12, fontWeight: "600" },
  telemetryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderTopWidth: 1,
    paddingTop: 12,
    marginTop: 4,
    marginBottom: 8,
  },
  telemetryTextCol: { flex: 1 },
  telemetryLabel: { fontSize: 13, fontWeight: "600", marginBottom: 2 },
  telemetrySub: { fontSize: 11, lineHeight: 16 },
  telemetryToggle: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 14,
    minWidth: 56,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  telemetryToggleText: { fontSize: 13, fontWeight: "700", letterSpacing: 1 },
  error: { fontSize: 12, marginBottom: 8 },
  info: { fontSize: 12, marginBottom: 8 },
  codeInput: {
    textAlign: "center",
    letterSpacing: 8,
    fontSize: 18,
    fontWeight: "700",
  },
  version: {
    fontSize: 10,
    textAlign: "center",
    marginTop: 12,
    opacity: 0.7,
  },
});
