/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * account — in-app "Connect to your account" flow for the drop-in Boosthis kit.
 *
 * Why this exists: historically an app only showed up in a developer's dashboard
 * if the SAME invite key was used at signup AND in `enableTelemetry()` AND in the
 * MCP config. When those drifted, the app silently vanished from the dashboard.
 * This module lets the developer instead sign into their dashboard account from
 * inside the Boosthis bubble and link THIS install directly (server-side
 * `installs.accountId`), so ownership no longer depends on key matching.
 *
 * Transport: plain `fetch` against the same `/api` base the telemetry client
 * already targets. These calls are deliberately NOT routed through the telemetry
 * PII guard (`safeTransmit`) — they carry the developer's OWN credentials (email,
 * password, session + install delete token) on purpose; they are auth, not
 * telemetry, and must never be redacted or dropped by the privacy denylist.
 *
 * Persistence: the session token is stored via the runtime's platform storage
 * adapter (`platform().storage` — AsyncStorage on RN, localStorage on web,
 * in-memory in tests), the SAME adapter the Terms gate uses. A host that wants
 * keychain-grade storage can route the adapter through `configurePlatform()`.
 * The token is a secret (it is the account session Bearer), so it is only ever
 * stored here and sent as `Authorization: Bearer <token>` — never logged.
 */
import { platform } from "../perfPlatform";
import {
  resolveFetch,
  callFetch,
  abortSignalOptIn,
  setAbortSignalOptIn,
  isSyncTransportThrow,
  type FetchImpl,
} from "../fetch";
import { sanitizeErrText, transportReason } from "../transportError";

const STORAGE_KEY = "boosthis:account:v1";

export interface StoredAccount {
  /** Account session Bearer token (raw). Treated as a secret. */
  token: string;
  /** The account's email, shown in the "Signed in as …" line. */
  email: string;
}

/**
 * A network/auth failure with a stable `code` the UI maps to a friendly line.
 * Codes: `network` (transport), `invalid_credentials` (401 on login),
 * `unauthorized` (401 on claim — stale session), `not_found` (404),
 * `already_claimed` (409), `rate_limited` (429), `server` (anything else).
 */
export class AccountError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AccountError";
    this.code = code;
  }
}

export async function getStoredAccount(): Promise<StoredAccount | null> {
  try {
    const raw = await platform().storage.get(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.token === "string" &&
      typeof parsed.email === "string"
    ) {
      return parsed as StoredAccount;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveStoredAccount(account: StoredAccount): Promise<void> {
  await platform().storage.set(STORAGE_KEY, JSON.stringify(account));
}

export async function clearStoredAccount(): Promise<void> {
  await platform().storage.remove(STORAGE_KEY);
}

/** Join an `/api` base with a leading-slash path, tolerating a trailing slash. */
function joinUrl(endpoint: string, path: string): string {
  return endpoint.replace(/\/+$/, "") + path;
}

/**
 * Diagnostic log for the sign-in / account-link flow. Deliberately ALWAYS-ON
 * (not `__DEV__`-gated) because the failures we need to chase happen in shipped
 * TestFlight/release builds, where `__DEV__` is false. It logs only the Boosthis
 * endpoint URL and the transport error message. The error message is run through
 * `sanitizeErrText` first: although a transport error is non-sensitive by
 * construction (it describes the socket, not the payload), the kit now uses a
 * HOST-PROVIDED fetch adapter, and a custom adapter could in theory throw an
 * error whose message embeds request body/header values (email, password,
 * session/delete token). Sanitizing here keeps that out of the release console,
 * exactly as the on-card message is sanitized. Wrapped so a logging failure can
 * never crash the host app.
 */
function signinLog(step: string, url: string, err?: unknown): void {
  try {
    const reason = err
      ? `: ${sanitizeErrText(err instanceof Error ? err.message : String(err))}`
      : "";
    // eslint-disable-next-line no-console
    console.log(`[boosthis] ${step} -> ${url}${reason}`);
  } catch {
    /* diagnostics must never crash the host */
  }
}

/* `sanitizeErrText` + `transportReason` now live in `../transportError` so the
 * sign-in card and the exported `runNetworkSelfTest` classify failures
 * identically. They are imported at the top of this file. */

/**
 * Wrap `fetch` with a timeout so a stalled connection fails in bounded time
 * instead of hanging the sign-in button indefinitely. Marginal mobile links
 * (weak signal) routinely stall a socket without ever erroring; without this the
 * developer just sees an endless spinner.
 *
 * IMPORTANT — AbortController/signal is OPT-IN, default OFF. Passing
 * `signal: controller.signal` to `fetch` throws immediately on some React
 * Native runtimes: on a shipped build we observed EVERY signal-bearing request
 * die on-device ("Could not reach Boosthis"), never leaving the phone, while
 * the signal-FREE telemetry/consent call to the SAME host on the SAME device
 * succeeded. So BY DEFAULT we bound the wait with `Promise.race` against a
 * timer — the exact signal-free shape the working consent path uses — and the
 * underlying fetch is left to settle (its result/error swallowed so it can
 * never surface as an unhandled promise rejection).
 *
 * When the host opts in (`enableTelemetry({ fetchOptions: { allowAbortSignal:
 * true } })` → `abortSignalOptIn()`), each attempt additionally rides a fresh
 * AbortController and a timer win calls `abort()`, so the dead socket is freed
 * before the retry instead of lingering in the pool. Self-healing: if a
 * signal-bearing call throws SYNCHRONOUSLY (`isSyncTransportThrow` — the
 * hostile-runtime signature; nothing was sent), the opt-in is permanently
 * downgraded for this session (`setAbortSignalOptIn(false)`) and the attempt
 * immediately retries signal-free, so a wrong opt-in costs one sync throw,
 * never a broken sign-in.
 */
// `FetchImpl`, `resolveFetch`, and `callFetch` are shared with consent + the
// kill-switch via `../fetch`. `resolveFetch` returns the host-wired adapter (so
// auth uses the EXACT transport that consent proves works on-device), else the
// global `fetch` BOUND to globalThis, else `undefined` (callers below surface a
// clear error). `callFetch` guarantees a real Promise<Response> so the
// `.catch`/`Promise.race` shapes here can never be "undefined is not a function"
// even for a host fetch impl that returns a non-standard thenable.

/** Arm a fresh AbortController onto a COPY of `init`, if the runtime has one.
 *  Everything is guarded: a missing/broken AbortController simply returns
 *  `null` and the caller runs the signal-free shape. */
function tryArmAbort(
  init: RequestInit,
): { init: RequestInit; abort: () => void } | null {
  try {
    const g = globalThis as unknown as {
      AbortController?: new () => { signal: unknown; abort: () => void };
    };
    if (typeof g.AbortController !== "function") return null;
    const controller = new g.AbortController();
    return {
      init: { ...init, signal: controller.signal as AbortSignal },
      abort: () => {
        try {
          controller.abort();
        } catch {
          /* cancelling must never crash the timeout path */
        }
      },
    };
  } catch {
    return null;
  }
}

/** One race of `callFetch` against a timer. `onTimerWin` (when provided) fires
 *  as the timer wins — the opt-in abort hook that frees the dead socket. */
async function raceWithTimer(
  f: FetchImpl,
  url: string,
  init: RequestInit,
  ms: number,
  onTimerWin?: () => void,
): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        if (onTimerWin) onTimerWin();
      } catch {
        /* abort failures must never mask the timeout */
      }
      reject(new Error("boosthis: request timed out"));
    }, ms);
  });
  // `callFetch` ALWAYS returns a real Promise (it catches a synchronous throw,
  // adopts any thenable/bare return, and rejects on a non-Response), so the
  // `.catch` swallow and `Promise.race` below can never themselves throw
  // "undefined is not a function".
  const fetchPromise = callFetch(f, url, init);
  // If the timer wins the race the fetch may still settle later; swallow it so
  // a late network error never becomes an unhandled rejection (RN LogBox).
  fetchPromise.catch(() => {});
  try {
    return await Promise.race([fetchPromise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function fetchWithTimeout(
  f: FetchImpl,
  url: string,
  init: RequestInit,
  ms = 8000,
): Promise<Response> {
  if (abortSignalOptIn()) {
    const armed = tryArmAbort(init);
    if (armed) {
      try {
        return await raceWithTimer(f, url, armed.init, ms, armed.abort);
      } catch (err) {
        if (isSyncTransportThrow(err)) {
          // Hostile runtime: the signal-bearing call threw before anything
          // was sent. Downgrade the opt-in for the rest of the session and
          // fall through to the proven signal-free shape RIGHT NOW — the
          // wrong opt-in costs one sync throw, never a failed sign-in.
          setAbortSignalOptIn(false);
        } else {
          throw err;
        }
      }
    }
  }
  return raceWithTimer(f, url, init, ms);
}

/**
 * `fetchWithTimeout` plus bounded exponential-backoff retries. A marginal mobile
 * link (iOS Low Power Mode, weak 4G) routinely lets ONE request through and then
 * stalls the next: we observed an app's automatic registration call succeed and
 * the very next sign-in tap, a few seconds later, never leave the phone — the
 * radio had briefly stalled — surfacing as "Could not reach Boosthis" even
 * though the address, the server, and the build were all correct. A single retry
 * was not enough to ride out that kind of stall, so we retry a few times with
 * growing gaps, giving the radio time to recover between attempts. Each attempt
 * uses a tighter timeout than a healthy call needs (a real login answers in well
 * under a second) so a dead socket fails fast and frees up the next attempt.
 *
 * Only the transport throw (or timeout abort) is retried; HTTP status codes
 * (401/409/429/5xx) are returned to the caller unretried so auth and validation
 * errors stay fast and exact. Safe for these endpoints: login is naturally
 * retryable and the claim is idempotent server-side.
 */
// Growing gaps between attempts. The first retry is the important one for the
// iOS "network connection was lost" (-1005) case: it fires AFTER a short pause,
// by which time CFNetwork has evicted the dead pooled socket and opens a fresh
// connection. Longer later gaps ride out a transient radio stall. Kept modest
// so a user-facing sign-in fails (or succeeds) in a reasonable window.
const RETRY_BACKOFFS_MS = [1000, 3000, 6000];

async function fetchResilient(
  f: FetchImpl,
  url: string,
  initFactory: () => RequestInit,
  perAttemptTimeoutMs = 8000,
): Promise<Response> {
  let lastErr: unknown;
  // attempt 0 is the first try; each later attempt waits its backoff first, so
  // there are `1 + RETRY_BACKOFFS_MS.length` total attempts. A FRESH RequestInit
  // is built per attempt (never a reused object) so no native runtime can choke
  // on a request body/headers already consumed by a prior failed attempt.
  for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_BACKOFFS_MS[attempt - 1]),
      );
    }
    try {
      return await fetchWithTimeout(f, url, initFactory(), perAttemptTimeoutMs);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * The two possible outcomes of a successful password check:
 *   - `signed-in`   — the server returned a session token directly (it does
 *     this when the code email could not be sent, so an email-provider outage
 *     never locks a developer out). The account is already persisted.
 *   - `otp-required` — the server emailed a 6-digit code and returned a
 *     challenge token. The UI must collect the code and call
 *     {@link verifyLoginOtp} with the challenge token to finish signing in.
 */
export type LoginResult =
  | { status: "signed-in"; account: StoredAccount }
  | { status: "otp-required"; challengeToken: string; email: string };

/**
 * Sign in with email + password against `POST /auth/login`. The login endpoint
 * returns the SAME generic 401 for unknown-email and wrong-password (no
 * account enumeration), which we surface as a single "invalid credentials"
 * message. A correct password normally answers with an email-code challenge
 * (`otpRequired: true` + a challenge token) rather than a session — see
 * {@link LoginResult}; only when the code email could not be sent does the
 * server fail open and return the session token directly.
 */
export async function login(
  endpoint: string,
  email: string,
  password: string,
  fetchImpl?: FetchImpl,
): Promise<LoginResult> {
  const f = resolveFetch(fetchImpl);
  const url = joinUrl(endpoint, "/auth/login");
  signinLog("sign-in request", url);
  if (!f) {
    signinLog("sign-in NO FETCH", url);
    throw new AccountError(
      "network",
      "Couldn't reach Boosthis to sign in (no network function available in this build). Check your connection.",
    );
  }
  let res: Response;
  try {
    res = await fetchResilient(f, url, () => ({
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ email, password }),
    }));
  } catch (err) {
    signinLog("sign-in transport FAILED", url, err);
    throw new AccountError(
      "network",
      `Couldn't reach Boosthis to sign in${transportReason(err)}. Check your connection.`,
    );
  }

  if (res.status === 401) {
    throw new AccountError("invalid_credentials", "Wrong email or password.");
  }
  if (res.status === 429) {
    throw new AccountError("rate_limited", "Too many attempts. Try again later.");
  }
  if (!res.ok) {
    throw new AccountError("server", "Login failed. Please try again.");
  }

  let body: {
    token?: unknown;
    account?: { email?: unknown };
    otpRequired?: unknown;
    challengeToken?: unknown;
  };
  try {
    body = (await res.json()) as {
      token?: unknown;
      account?: { email?: unknown };
      otpRequired?: unknown;
      challengeToken?: unknown;
    };
  } catch {
    throw new AccountError("server", "Login failed. Please try again.");
  }

  // Second step required: the server emailed a 6-digit code and returned a
  // challenge token instead of a session. Nothing is persisted yet — the
  // challenge token grants no access by itself.
  if (body.otpRequired === true && typeof body.challengeToken === "string") {
    signinLog("sign-in code emailed", url);
    return {
      status: "otp-required",
      challengeToken: body.challengeToken,
      email,
    };
  }

  const token = typeof body.token === "string" ? body.token : null;
  const acctEmail =
    typeof body.account?.email === "string" ? body.account.email : email;
  if (!token) {
    throw new AccountError("server", "Login failed. Please try again.");
  }

  const account: StoredAccount = { token, email: acctEmail };
  await saveStoredAccount(account);
  return { status: "signed-in", account };
}

/**
 * Finish a code-challenged sign-in: submit the emailed 6-digit code together
 * with the challenge token from {@link login} to `POST /auth/login/otp`. On
 * success the session is persisted and the stored account returned. Error
 * codes the UI maps: `invalid_code` (wrong code — the developer can retry),
 * `challenge_expired` (dead/expired/attempt-capped challenge — the UI must
 * drop back to the password form), `rate_limited`, `network`, `server`.
 */
export async function verifyLoginOtp(
  endpoint: string,
  challengeToken: string,
  code: string,
  fallbackEmail: string,
  fetchImpl?: FetchImpl,
): Promise<StoredAccount> {
  const f = resolveFetch(fetchImpl);
  const url = joinUrl(endpoint, "/auth/login/otp");
  signinLog("code verify request", url);
  if (!f) {
    signinLog("code verify NO FETCH", url);
    throw new AccountError(
      "network",
      "Couldn't reach Boosthis to verify the code (no network function available in this build). Check your connection.",
    );
  }
  let res: Response;
  try {
    res = await fetchResilient(f, url, () => ({
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ challengeToken, code }),
    }));
  } catch (err) {
    signinLog("code verify transport FAILED", url, err);
    throw new AccountError(
      "network",
      `Couldn't reach Boosthis to verify the code${transportReason(err)}. Check your connection.`,
    );
  }

  if (res.status === 401) {
    throw new AccountError(
      "invalid_code",
      "That code isn't right. Check the newest email we sent and try again.",
    );
  }
  if (res.status === 400) {
    throw new AccountError(
      "challenge_expired",
      "That code has expired. Sign in again to get a new one.",
    );
  }
  if (res.status === 429) {
    throw new AccountError("rate_limited", "Too many attempts. Try again later.");
  }
  if (!res.ok) {
    throw new AccountError("server", "Couldn't verify the code. Please try again.");
  }

  let body: { token?: unknown; account?: { email?: unknown } };
  try {
    body = (await res.json()) as {
      token?: unknown;
      account?: { email?: unknown };
    };
  } catch {
    throw new AccountError("server", "Couldn't verify the code. Please try again.");
  }
  const token = typeof body.token === "string" ? body.token : null;
  const acctEmail =
    typeof body.account?.email === "string"
      ? body.account.email
      : fallbackEmail;
  if (!token) {
    throw new AccountError("server", "Couldn't verify the code. Please try again.");
  }

  const account: StoredAccount = { token, email: acctEmail };
  await saveStoredAccount(account);
  return account;
}

/**
 * Ask the server to email a fresh 6-digit code for a pending sign-in
 * (`POST /auth/login/otp/resend`). Resends are capped server-side (3 per
 * challenge) and never extend the challenge's 10-minute expiry. Error codes:
 * `challenge_expired` (drop back to the password form), `send_failed` (the
 * email couldn't be sent right now), `rate_limited`, `network`, `server`.
 */
export async function resendLoginOtp(
  endpoint: string,
  challengeToken: string,
  fetchImpl?: FetchImpl,
): Promise<void> {
  const f = resolveFetch(fetchImpl);
  const url = joinUrl(endpoint, "/auth/login/otp/resend");
  signinLog("code resend request", url);
  if (!f) {
    signinLog("code resend NO FETCH", url);
    throw new AccountError(
      "network",
      "Couldn't reach Boosthis to resend the code (no network function available in this build). Check your connection.",
    );
  }
  let res: Response;
  try {
    res = await fetchResilient(f, url, () => ({
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ challengeToken }),
    }));
  } catch (err) {
    signinLog("code resend transport FAILED", url, err);
    throw new AccountError(
      "network",
      `Couldn't reach Boosthis to resend the code${transportReason(err)}. Check your connection.`,
    );
  }

  if (res.ok) return;
  if (res.status === 400) {
    throw new AccountError(
      "challenge_expired",
      "That sign-in attempt has expired. Sign in again to get a new code.",
    );
  }
  if (res.status === 429) {
    throw new AccountError(
      "rate_limited",
      "Too many resend requests. Please wait a moment.",
    );
  }
  if (res.status === 502) {
    throw new AccountError(
      "send_failed",
      "We couldn't send a new code right now. Try again in a few minutes.",
    );
  }
  throw new AccountError("server", "Couldn't resend the code. Please try again.");
}

/**
 * The parsed outcome of a successful install claim. `linked` is the claim
 * result; `fullTelemetry` is the server's CURRENT full-telemetry override for
 * this install when the claim response carries it (a newer server), else
 * `undefined` — the caller then falls back to the kit's current effective mode
 * to initialize the in-app telemetry toggle.
 */
export interface ClaimResult {
  linked: boolean;
  fullTelemetry?: boolean;
}

/**
 * Link this install to the signed-in account via
 * `POST /installs/{installId}/claim`, returning the parsed {@link ClaimResult}
 * (link state + the optional current `fullTelemetry` override). Proof of control
 * is the install's DELETE token (the read token is intentionally rejected by the
 * server). Throws an {@link AccountError} on any non-200.
 */
export async function claimInstallResult(
  endpoint: string,
  token: string,
  installId: string,
  deleteToken: string,
  fetchImpl?: FetchImpl,
): Promise<ClaimResult> {
  const f = resolveFetch(fetchImpl);
  const url = joinUrl(
    endpoint,
    `/installs/${encodeURIComponent(installId)}/claim`,
  );
  signinLog("account-link request", url);
  if (!f) {
    signinLog("account-link NO FETCH", url);
    throw new AccountError(
      "network",
      "Couldn't reach Boosthis to link this app (no network function available in this build). Check your connection.",
    );
  }
  let res: Response;
  try {
    res = await fetchResilient(f, url, () => ({
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "x-boosthis-install-token": deleteToken,
      },
    }));
  } catch (err) {
    signinLog("account-link transport FAILED", url, err);
    throw new AccountError(
      "network",
      `Couldn't reach Boosthis to link this app${transportReason(err)}. Check your connection.`,
    );
  }

  if (res.status === 200) {
    try {
      const body = (await res.json()) as {
        linked?: unknown;
        fullTelemetry?: unknown;
      };
      return {
        linked: body?.linked === true,
        fullTelemetry:
          typeof body?.fullTelemetry === "boolean"
            ? body.fullTelemetry
            : undefined,
      };
    } catch {
      // A 200 with an unreadable body still means the link succeeded.
      return { linked: true };
    }
  }
  if (res.status === 401) {
    // The claim route rejects with 401 for TWO distinct causes and tags them
    // with a machine-readable `reason`: "session" (the account session is
    // dead — signing in again helps) vs "install_token" (this copy of the app
    // is holding an out-of-date connection credential — signing in again does
    // NOT help; the fix is pressing Repair in the dashboard, then relaunching
    // the app). Older servers omit `reason`; treat that as a session failure
    // (the pre-existing behavior).
    let reason: string | null = null;
    try {
      const body = (await res.json()) as { reason?: unknown };
      reason = typeof body?.reason === "string" ? body.reason : null;
    } catch {
      // Unreadable body — fall through to the session-expired default.
    }
    if (reason === "install_token") {
      throw new AccountError(
        "stale_install",
        "You're signed in, but this copy of the app is holding an out-of-date connection. Open your Boosthis dashboard, press Repair on this app, then fully close and relaunch it.",
      );
    }
    throw new AccountError(
      "unauthorized",
      "Your session expired. Sign in again.",
    );
  }
  if (res.status === 404) {
    throw new AccountError(
      "not_found",
      "This app isn't registered yet. Make sure telemetry is enabled.",
    );
  }
  if (res.status === 409) {
    throw new AccountError(
      "already_claimed",
      "This app is already linked to a different account.",
    );
  }
  if (res.status === 429) {
    throw new AccountError("rate_limited", "Too many attempts. Try again later.");
  }
  throw new AccountError("server", "Linking failed. Please try again.");
}

/**
 * Backwards-compatible wrapper over {@link claimInstallResult}: returns just the
 * boolean link state, so the silent re-link effect and existing callers keep
 * their exact signature. New code that also needs the current `fullTelemetry`
 * override (the in-app telemetry toggle) uses {@link claimInstallResult}.
 */
export async function claimInstall(
  endpoint: string,
  token: string,
  installId: string,
  deleteToken: string,
  fetchImpl?: FetchImpl,
): Promise<boolean> {
  const result = await claimInstallResult(
    endpoint,
    token,
    installId,
    deleteToken,
    fetchImpl,
  );
  return result.linked;
}

/**
 * Flip the server's full-telemetry override for this install via
 * `POST /installs/{installId}/telemetry`. Auth is the SAME proof the claim
 * uses — the account session Bearer PLUS the install's DELETE token — so only a
 * signed-in developer who controls this install can change it. Returns the
 * server's new `fullTelemetry` state on 200; throws an {@link AccountError}
 * whose `code` the card maps to a short friendly line otherwise:
 *   • `plan_limit` (402)         → "Full telemetry is a Pro plan feature."
 *   • `project_paused` (403)     → "This project is paused."
 *   • `stale_install` (401 install_token) → repair-needed line
 *   • `unauthorized` (401 session)        → session-expired line
 *   • `already_claimed` (409), `rate_limited` (429), `network`, `server`.
 */
export async function setInstallTelemetry(
  endpoint: string,
  token: string,
  installId: string,
  deleteToken: string,
  fullTelemetry: boolean,
  fetchImpl?: FetchImpl,
): Promise<boolean> {
  const f = resolveFetch(fetchImpl);
  const url = joinUrl(
    endpoint,
    `/installs/${encodeURIComponent(installId)}/telemetry`,
  );
  signinLog("telemetry-toggle request", url);
  if (!f) {
    signinLog("telemetry-toggle NO FETCH", url);
    throw new AccountError(
      "network",
      "Couldn't reach Boosthis to change telemetry (no network function available in this build). Check your connection.",
    );
  }
  let res: Response;
  try {
    res = await fetchResilient(f, url, () => ({
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-boosthis-install-token": deleteToken,
      },
      body: JSON.stringify({ fullTelemetry }),
    }));
  } catch (err) {
    signinLog("telemetry-toggle transport FAILED", url, err);
    throw new AccountError(
      "network",
      `Couldn't reach Boosthis to change telemetry${transportReason(err)}. Check your connection.`,
    );
  }

  if (res.status === 200) {
    try {
      const body = (await res.json()) as { fullTelemetry?: unknown };
      // Trust the server's echo; fall back to the requested value on an
      // unreadable body (a 200 still means the change was applied).
      return typeof body?.fullTelemetry === "boolean"
        ? body.fullTelemetry
        : fullTelemetry;
    } catch {
      return fullTelemetry;
    }
  }
  if (res.status === 401) {
    // Same two-cause split as the claim route: "install_token" means this copy
    // is holding a stale connection (Repair + relaunch), NOT a dead session.
    let reason: string | null = null;
    try {
      const body = (await res.json()) as { reason?: unknown };
      reason = typeof body?.reason === "string" ? body.reason : null;
    } catch {
      // Unreadable body — fall through to the session-expired default.
    }
    if (reason === "install_token") {
      throw new AccountError(
        "stale_install",
        "This copy of the app needs a repair before it can change telemetry. Open your Boosthis dashboard, press Repair on this app, then relaunch it.",
      );
    }
    throw new AccountError(
      "unauthorized",
      "Your session expired. Sign in again.",
    );
  }
  if (res.status === 402) {
    throw new AccountError(
      "plan_limit",
      "Full telemetry is a Pro plan feature.",
    );
  }
  if (res.status === 403) {
    throw new AccountError("project_paused", "This project is paused.");
  }
  if (res.status === 409) {
    throw new AccountError(
      "already_claimed",
      "This app is linked to a different account.",
    );
  }
  if (res.status === 429) {
    throw new AccountError("rate_limited", "Too many attempts. Try again later.");
  }
  throw new AccountError("server", "Couldn't change telemetry. Please try again.");
}

/**
 * Log out: best-effort revoke the server session, then always clear local
 * storage so the UI returns to the signed-out state even if the network call
 * fails.
 */
export async function logout(
  endpoint: string,
  token: string,
  fetchImpl?: FetchImpl,
): Promise<void> {
  const f = resolveFetch(fetchImpl);
  if (f) {
    try {
      await fetchWithTimeout(f, joinUrl(endpoint, "/auth/logout"), {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
    } catch {
      // ignore — local clear below is what matters for the UI
    }
  }
  await clearStoredAccount();
}
