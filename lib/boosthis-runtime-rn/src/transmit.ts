/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/** `safeTransmit()` — the single outbound chokepoint.
 *
 * Refuses to send if the payload, caller-supplied headers, or endpoint URL
 * query parameters trip the PII guard. Same contract as the Python
 * `boosthis.transmit.safe_transmit`.
 */

import { assertNoPII, checkNoPII, PIIDetectedError } from "./no-pii";
import { isRuntimeInert, _isRuntimeKilledInternal } from "./killSwitch";
import { resolveFetch, callFetch, NO_FETCH_MESSAGE } from "./fetch";

export interface SafeTransmitOptions {
  /** Optional fetch implementation (defaults to the global `fetch`). */
  fetchImpl?: typeof fetch;
  /** Caller-supplied HTTP headers forwarded to the remote endpoint. Header
   *  values are scanned for PII before transmission — do NOT place emails,
   *  tokens, or other sensitive identifiers in header values. */
  headers?: Record<string, string>;
  /** Optional AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** OPT-IN: allow the kit to arm its own AbortController on timeout-bounded
   *  calls (sign-in/claim), hard-cancelling a stalled attempt so the dead
   *  socket is freed before the retry. Default OFF — some RN runtimes throw
   *  synchronously on ANY signal-bearing fetch (a shipped incident), so the
   *  kit only rides a signal when the host vouches for its runtime. Wrong
   *  opt-ins self-heal: a sync throw downgrades back to the signal-free shape
   *  for the rest of the session. */
  allowAbortSignal?: boolean;
}

/** Scan caller-supplied header values for PII patterns.
 *
 * Header names are not checked against the JSON-payload denylist (HTTP header
 * names like "Content-Encoding" would produce false positives). Values are
 * checked using the same value-pattern scan applied to JSON string fields
 * (email, JWT, bearer, IPv4/v6, phone).
 */
function assertNoPIIInHeaders(
  headers: Record<string, string> | undefined,
): void {
  if (!headers) return;
  for (const [name, value] of Object.entries(headers)) {
    const hit = checkNoPII(value);
    if (hit !== null) {
      throw new PIIDetectedError(
        `$headers.${name}`,
        name,
        hit.matchedFragment,
      );
    }
  }
}

/** Scan URL query-parameter names and values for PII.
 *
 * Query-parameter names are developer-chosen keys and are checked the same way
 * as JSON field names (denylist + tokeniser). Values are checked with the
 * value-pattern scan (email, JWT, bearer, IPv4/v6, phone).
 *
 * A base-URL fallback is used so that relative paths (e.g. `/ingest?email=…`)
 * are always parsed and scanned — absolute URLs ignore the base entirely.
 * If the string is still unparseable the function fails closed: a URL we
 * cannot inspect cannot be certified PII-free.
 */
function assertNoPIIInUrl(url: string): void {
  let parsed: URL;
  try {
    // Fallback base ensures relative URLs are handled; absolute URLs ignore it.
    parsed = new URL(url, "https://boosthis.invalid");
  } catch {
    // Truly malformed URL string — fail closed.
    throw new PIIDetectedError("$url", "url", "~unparseable-url");
  }
  for (const [name, value] of parsed.searchParams) {
    // Check param name via the key-name guard (same as JSON field names).
    const nameHit = checkNoPII({ [name]: null });
    if (nameHit !== null) {
      throw new PIIDetectedError(
        `$url.query.${name}`,
        name,
        nameHit.matchedFragment,
      );
    }
    // Check param value via the value-pattern guard.
    const valueHit = checkNoPII(value);
    if (valueHit !== null) {
      throw new PIIDetectedError(
        `$url.query.${name}`,
        name,
        valueHit.matchedFragment,
      );
    }
  }
}

/**
 * POST a JSON payload to `endpoint`, AFTER verifying it contains no
 * PII-shaped fields. Also verifies caller-supplied headers and URL query
 * parameters. Throws `PIIDetectedError` if any channel would leak personal
 * data; the network call is then NEVER made.
 *
 * Honors the combined inert gate `isRuntimeInert()` — `BOOSTHIS_DISABLED=1`
 * OR a non-active server entitlement (revoked / unpaid / tampered / grace
 * expired). When inert, returns a synthetic 204 without touching the network,
 * so a server-side kill stops ALL outbound traffic through this chokepoint —
 * even direct `safeTransmit()` callers that didn't pre-check. The PII guard
 * still runs first even when inert, so a misbehaving caller can't smuggle PII
 * through the chokepoint by tripping the kill-switch. Privacy contract >
 * performance. (The entitlement check-in itself does NOT use this chokepoint —
 * it fetches directly — so the recovery path is never self-gated.)
 */
export async function safeTransmit(
  endpoint: string,
  payload: unknown,
  opts: SafeTransmitOptions = {},
): Promise<Response> {
  // PII guard runs unconditionally — inert mode is about silencing outbound
  // traffic, NOT relaxing the privacy contract.
  assertNoPII(payload);
  assertNoPIIInHeaders(opts.headers);
  assertNoPIIInUrl(endpoint);
  if (isRuntimeInert()) {
    return new Response(null, {
      status: 204,
      statusText: "Boosthis inert",
    });
  }
  try {
    const f = resolveFetch(opts.fetchImpl);
    if (!f) throw new Error(NO_FETCH_MESSAGE);
    const res = await callFetch(f, endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
      body: JSON.stringify(payload),
      signal: opts.signal,
    });
    noteUploadResponse(res);
    return res;
  } catch (err) {
    noteUploadRejected("unreachable");
    throw err;
  }
}

export type UploadFailReason =
  | "unauthorized"
  | "rejected"
  | "server-error"
  | "unreachable";

let lastUploadFailAtMs: number | null = null;
let lastUploadFailReason: UploadFailReason | null = null;
let droppedUploads = 0;
let lastAttemptFailed = false;

export function noteUploadAccepted(): void {
  try {
    lastAttemptFailed = false;
  } catch {
    /* status bookkeeping must never fail a request */
  }
}

export function noteUploadRejected(reason: UploadFailReason): void {
  try {
    lastUploadFailAtMs = Date.now();
    lastUploadFailReason = reason;
    droppedUploads += 1;
    lastAttemptFailed = true;
  } catch {
    /* status bookkeeping must never fail a request */
  }
}

export function noteUploadResponse(res: Response): boolean {
  try {
    if (res.ok) {
      noteUploadAccepted();
      return true;
    }
    noteUploadRejected(
      res.status === 401 || res.status === 403
        ? "unauthorized"
        : res.status >= 500
          ? "server-error"
          : "rejected",
    );
  } catch {
    /* status bookkeeping must never fail a request */
  }
  return false;
}

export function getLastUploadFailure(): {
  at: number;
  reason: UploadFailReason;
} | null {
  if (lastUploadFailAtMs === null || lastUploadFailReason === null) return null;
  return { at: lastUploadFailAtMs, reason: lastUploadFailReason };
}

export function getDroppedUploadCount(): number {
  return droppedUploads;
}

export function isLastUploadAttemptFailed(): boolean {
  return lastAttemptFailed;
}

export function _resetUploadFailureForTests(): void {
  lastUploadFailAtMs = null;
  lastUploadFailReason = null;
  droppedUploads = 0;
  lastAttemptFailed = false;
}

/**
 * @internal
 *
 * Variant of `safeTransmit` for Boosthis-runtime internal use only. Accepts a
 * pre-validated `authHeader` value (e.g. `"Bearer <deleteToken>"`) that is
 * added to the outbound request WITHOUT passing through the PII guard.
 *
 * SECURITY RATIONALE: the auth credential supplied here is always a
 * Boosthis-server-issued token (invite key or delete token), never user data.
 * Placing it in the public `opts.headers` would cause the bearer/JWT pattern
 * guard to block it. Using a separate parameter keeps the bypass narrow,
 * explicit, and invisible to the public `SafeTransmitOptions` interface.
 *
 * `internalHeaders` works the same way for additional server-issued
 * credentials (e.g. the `X-Boosthis-Install-Token` delete-token proof sent on
 * re-consent). Their header NAMES contain denylisted fragments like "token",
 * so routing them through the public `opts.headers` would trip the PII guard;
 * they are merged in here, after the guard, for the same narrow-bypass reason
 * as `authHeader`. The values are always Boosthis-issued tokens, never user data.
 *
 * `allowWhenLocked` narrows the inert gate to its KILLED-ONLY variant
 * (`_isRuntimeKilledInternal`): the env kill-switch, a non-active server
 * answer, and a lapsed grace window still silence the call, but the
 * ACTIVATION LOCK does not. It exists for exactly ONE caller — the
 * consent/registration path — because registration is the handshake that
 * LEADS to activation; gating it on the lock would deadlock every fresh
 * install. Never set it on any other call.
 *
 * NOT re-exported from `index.ts`. Host-app code cannot reach this function
 * through the package's public API surface.
 */
export async function _safeTransmitInternal(
  endpoint: string,
  payload: unknown,
  opts: SafeTransmitOptions,
  authHeader?: string,
  internalHeaders?: Record<string, string>,
  allowWhenLocked?: boolean,
): Promise<Response> {
  // All user-controlled inputs still go through the full PII guard.
  assertNoPII(payload);
  assertNoPIIInHeaders(opts.headers);
  assertNoPIIInUrl(endpoint);
  if (allowWhenLocked ? _isRuntimeKilledInternal() : isRuntimeInert()) {
    return new Response(null, {
      status: 204,
      statusText: "Boosthis inert",
    });
  }
  const f = resolveFetch(opts.fetchImpl);
  if (!f) throw new Error(NO_FETCH_MESSAGE);
  return callFetch(f, endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
      ...(authHeader ? { Authorization: authHeader } : {}),
      ...(internalHeaders ?? {}),
    },
    body: JSON.stringify(payload),
    signal: opts.signal,
  });
}
