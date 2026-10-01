/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * transportError — shared classification + sanitization of outbound transport
 * failures for the RN runtime.
 *
 * Extracted from `ui/account.ts` so the sign-in/account-link card AND the
 * exported `runNetworkSelfTest` diagnose a failure with the SAME wording. Pure
 * (no imports, no platform access) so it is safe to use from any module and in
 * tests. Nothing here logs or transmits — callers decide what to do with the
 * classified string.
 */

/**
 * Strip anything secret/PII-shaped out of a raw transport error message before
 * it is shown on a card, logged, or returned by the self-test, so surfacing the
 * underlying iOS/CFNetwork string can never leak the developer's email, a
 * bearer/session token, the install delete token, or a URL with a query string.
 * Network error messages are non-sensitive by construction (they describe the
 * socket, not the payload), but we sanitize + truncate defensively because we do
 * not control every runtime's wording — and once a HOST-provided `fetchImpl` is
 * in play a custom adapter could throw an error whose message embeds request
 * body/header values.
 */
export function sanitizeErrText(raw: string): string {
  let s = String(raw ?? "");
  // Drop full URLs (could carry a query string) — keep a marker so the shape
  // of the message still reads.
  s = s.replace(/https?:\/\/\S+/gi, "<url>");
  // Drop email addresses.
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<redacted>");
  // Drop long token-ish runs (session/delete tokens, JWTs) — 20+ unbroken
  // url-safe chars are never part of a human network message.
  s = s.replace(/[A-Za-z0-9_-]{20,}/g, "<redacted>");
  return s.replace(/\s+/g, " ").trim().slice(0, 80);
}

/**
 * Turn a transport failure into a short, human-readable cause so an on-card
 * error (or the self-test summary) tells us WHERE it died without needing the
 * device console. The shipped build previously returned "" for anything that
 * wasn't our own timeout or RN's "Network request failed", which hid the single
 * most common shipped-build failure: an iOS `NSURLError` (e.g. "The network
 * connection was lost", -1005) raised when CFNetwork reuses a stale keep-alive
 * socket — exactly the case where the startup consent call succeeds but a later
 * sign-in does not. We classify the common iOS/CFNetwork/web messages explicitly
 * AND, for anything still unrecognized, append a sanitized snippet of the raw
 * message so the next screenshot reveals the exact CFNetwork error instead of an
 * empty suffix.
 */
export function transportReason(err: unknown): string {
  try {
    const msg = err instanceof Error ? err.message : String(err ?? "");
    // NSURLErrorTimedOut (-1001) or our own race timer.
    if (/timed out|timeout|-1001/i.test(msg)) return " (timed out)";
    // NSURLErrorNetworkConnectionLost (-1005) — stale keep-alive reuse.
    if (/network connection was lost|connection was lost|-1005/i.test(msg))
      return " (connection dropped)";
    // callFetch's STATUS_0_MESSAGE — a transport surfaced a dead/dropped
    // socket as an HTTP "status 0" response. Same physical cause as -1005.
    if (/transport failed \(status 0\)/i.test(msg))
      return " (connection dropped)";
    // NSURLErrorCannotConnectToHost (-1004) / refused.
    if (/cannot connect to host|could not connect|connection refused|-1004/i.test(msg))
      return " (server unreachable)";
    // NSURLErrorCannotFindHost (-1003) / DNS.
    if (/cannot find host|could not be found|hostname.*not.*found|-1003/i.test(msg))
      return " (server not found)";
    // NSURLErrorNotConnectedToInternet (-1009).
    if (/not connected to the internet|offline|-1009/i.test(msg))
      return " (you're offline)";
    // TLS/SSL (-1200..-1206, NSURLErrorSecureConnectionFailed).
    if (/secure connection|ssl|\btls\b|certificate|-120[0-6]/i.test(msg))
      return " (secure-connection error)";
    // WebKit/Expo-web generic fetch failure.
    if (/load failed/i.test(msg)) return " (blocked by network)";
    // RN's generic transport failure.
    if (/network request failed/i.test(msg)) return " (no connection)";
    // NSURLErrorCancelled (-999) — only possible when the host OPTED IN to
    // the abort signal (fetch.ts `abortSignalOptIn`); our own timer rejects
    // first with "timed out", so this should stay rare. Classified so we'd
    // notice if it ever surfaces on its own.
    if (/cancell?ed|-999/i.test(msg)) return " (request cancelled)";
    // A local JS TypeError (calling undefined / an unbound native fetch), or our
    // own "no fetch implementation" / "fetch returned no response" markers — this
    // build has no usable network function, NOT a connectivity fault. This is the
    // class of error that previously read as a cryptic "undefined is not a
    // function" on shipped builds. It now also covers the Hermes/New-Arch
    // `instanceof` landmine ("right operand of 'instanceof' is not an object")
    // that expo/fetch hits when handed non-tuple headers — callFetch normalizes
    // headers to tuples to PREVENT it, so seeing this string means something
    // upstream still passed a web global to `instanceof`.
    if (
      /is not a function|not a constructor|no fetch implementation|no network function|fetch returned no response|right operand of 'instanceof'|not an object|not callable/i.test(
        msg,
      )
    )
      return " (network unavailable in this build)";
    // Unrecognized: surface a sanitized snippet so we learn the exact cause.
    const cleaned = sanitizeErrText(msg);
    if (cleaned) return ` (${cleaned})`;
  } catch {
    /* fall through to the empty suffix */
  }
  return "";
}
