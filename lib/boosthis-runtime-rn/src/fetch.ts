/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * Centralized outbound-fetch resolution + invocation for the RN runtime.
 *
 * WHY THIS EXISTS — the "undefined is not a function" sign-in bug:
 * Every outbound call used to resolve its transport inline as
 * `opts.fetchImpl ?? fetch` and then call the result directly (`f(url, init)`),
 * sometimes wrapping it with `.catch()` / `Promise.race`. On a shipped
 * TestFlight build the in-app sign-in threw a *local* `TypeError: undefined is
 * not a function` (only visible once the diagnostic stopped masking unknown
 * errors). That happens when:
 *   - the bare global `fetch` reference is undefined / installed late in the
 *     host runtime, OR
 *   - `fetch` is a native binding that throws when called UNBOUND — extracting
 *     it to a local (`const f = fetch; f(...)`) loses `this === globalThis`, OR
 *   - a host-supplied `fetchImpl` returns a non-standard thenable (or nothing),
 *     so a later `.catch` on the result is itself `undefined`.
 *
 * This module makes all of that impossible:
 *   - `resolveFetch` returns the first value that is actually a function —
 *     a host-supplied impl, else the global `fetch` BOUND to `globalThis` — or
 *     `undefined`, so the caller can surface a CLEAR, classifiable error rather
 *     than a cryptic TypeError.
 *   - `callFetch` always returns a REAL `Promise<Response>`: it catches a
 *     synchronous throw from the impl, adopts any thenable / bare value via
 *     `Promise.resolve`, and rejects with a clear message when the result is not
 *     a usable Response. So `.catch` / `Promise.race` downstream can never be
 *     "undefined is not a function".
 *
 * ABORT SIGNAL — OPT-IN ONLY. By default no AbortController / no `signal` is
 * introduced here — bounding a stalled request stays the caller's job via
 * `Promise.race` against a timer (see `account.ts` / `killSwitch.ts`). That
 * on-device contract is deliberate: some RN runtimes throw synchronously when
 * fetch is handed an abort signal (a shipped incident proved every
 * signal-bearing request died on-device while signal-free calls succeeded).
 * A host that KNOWS its runtime tolerates signals can opt in via
 * `enableTelemetry({ fetchOptions: { allowAbortSignal: true } })`; the
 * account/sign-in path then hard-cancels a timed-out attempt so the dead
 * socket is freed before the retry. The opt-in is self-healing: if a
 * signal-bearing call throws synchronously (`isSyncTransportThrow`), the
 * caller downgrades back to the race-only shape for the rest of the session.
 *
 * XHR LAST-RESORT FALLBACK — some builds ship with a broken/absent `fetch`
 * (undefined global, or a host impl whose broken web globals make it throw
 * synchronously before any bytes are sent). When `XMLHttpRequest` exists,
 * `xhrFetch` is used as tier 3 in `resolveFetch`, and `callFetch` retries a
 * SYNCHRONOUS throw once through it. Only sync throws re-route: a sync throw
 * provably sent nothing (no duplicate-request risk), while real network
 * failures always reject asynchronously and must keep flowing to the normal
 * backoff-retry path — never onto XHR.
 *
 * HERMES-SAFE CALL SHAPE — why `callFetch` rewrites headers to tuples:
 * On Hermes / the New Architecture, web globals (`Headers`, `ReadableStream`,
 * …) are frequently UNDEFINED in a release bundle, so any `x instanceof Headers`
 * throws synchronously ("right operand of 'instanceof' is not an object").
 * Expo's URLSession transport (`expo/fetch`) — the reliable way around RN's
 * RCTNetworking XHR silently dropping responses on reused iOS sockets (the real
 * Rival sign-in bug) — normalizes its `headers` init with exactly that
 * `headers instanceof Headers` check. Handed a plain OBJECT (`{ "Content-Type":
 * … }`) it reaches the `instanceof` and crashes in ~1ms, before any network I/O;
 * handed an ARRAY of `[key, value]` tuples it returns at the earlier
 * `Array.isArray()` branch and never evaluates `instanceof`. So `callFetch`
 * converts object headers to tuples for EVERY outbound call (consent, samples,
 * auth, entitlement) — making a raw `expoFetch` passed as `fetchImpl` safe with
 * no host wrapper. Tuple headers are equally valid `HeadersInit` for the global
 * `fetch`, RN's XHR, and undici, so there is no regression. The body is left
 * untouched: the kit only ever sends a string (or no) body, which expo/fetch
 * handles at its `typeof === "string"` branch before any `instanceof
 * ReadableStream` check — never construct a stream/Blob body here. (And per the
 * incident's standing rule, this module itself never uses `instanceof` against a
 * web global — `toHeaderTuples` duck-types instead.)
 *
 * CONSUMER CONTRACT — if you pass your OWN transport as `fetchImpl`
 * (e.g. `enableTelemetry({ fetchOptions: { fetchImpl } })`, or the sign-in /
 * account-link path), it MUST behave like a minimal `fetch`:
 *   1. THROW (reject) on a transport failure — a dropped / reset / half-open
 *      socket, a DNS failure, or your own timeout. Never RESOLVE a synthetic
 *      "failure" object: the kit retries only on a throw, so a swallowed
 *      failure silently disables backoff-retry (this is exactly the Rival
 *      iOS/Hermes stall). A raw `XMLHttpRequest` shim must reject on
 *      `onerror` / `ontimeout` / `onabort`.
 *   2. Read the status ONLY when the response is complete — for an XHR shim,
 *      resolve at `readyState === 4` (DONE), never an earlier readyState, so a
 *      partial response can't be mistaken for a result.
 *   3. Bound each attempt with your OWN timer set BELOW the kit's per-attempt
 *      race (~8s) — e.g. `xhr.timeout = 6500` — so a stalled socket is
 *      abandoned by your shim first and the kit's retry gets a fresh one. Do
 *      NOT rely on an AbortController `signal` (some RN runtimes throw).
 *   4. Resolve a minimal Response-shaped object: at least
 *      `{ status: number, ok: boolean, json(): Promise<any>, text(): Promise<string> }`.
 *      `callFetch` duck-types any value with a numeric `status` as a Response,
 *      so anything less makes `res.status` / `res.json()` throw downstream.
 */

import { runKitOwnedCall } from "./kitOwnedCall";

export type FetchImpl = typeof fetch;

/** Marker message used when no callable fetch exists. Diagnostics classify it. */
export const NO_FETCH_MESSAGE =
  "boosthis: no fetch implementation available in this runtime";

/** Marker message when a transport reports HTTP status 0 (a dead/dropped
 *  socket surfaced as a "response"). The kit never uses `no-cors`, so a
 *  legitimate opaque status-0 response cannot occur — status 0 is ALWAYS a
 *  transport failure and must reject so backoff-retry fires. */
export const STATUS_0_MESSAGE = "boosthis: transport failed (status 0)";

/* ------------------------------------------------------------------------- *
 * Abort-signal opt-in (module flag, default OFF — see header note).
 * ------------------------------------------------------------------------- */

let abortOptIn = false;

/** Turn the abort-signal opt-in on/off. Wired by `enableTelemetry` from
 *  `fetchOptions.allowAbortSignal`; also flipped OFF automatically by the
 *  account path when a signal-bearing call throws synchronously (hostile
 *  runtime) so the rest of the session runs the proven race-only shape. */
export function setAbortSignalOptIn(v: boolean): void {
  abortOptIn = v === true;
}

/** Whether the host opted in to AbortController-based per-attempt cancel. */
export function abortSignalOptIn(): boolean {
  return abortOptIn;
}

/**
 * Tag + detect a SYNCHRONOUS transport throw. `callFetch` flattens sync throws
 * into rejections, so callers can't otherwise tell "the impl threw before any
 * bytes were sent" (safe to retry differently, e.g. signal-free or via XHR)
 * from a real network rejection. Tagging mutates the error object defensively
 * (guarded — a frozen/primitive throw simply stays untagged).
 */
function tagSyncThrow(err: unknown): unknown {
  try {
    if (err && (typeof err === "object" || typeof err === "function")) {
      (err as { boosthisSyncThrow?: boolean }).boosthisSyncThrow = true;
    }
  } catch {
    /* frozen error object — fine, it just stays untagged */
  }
  return err;
}

export function isSyncTransportThrow(err: unknown): boolean {
  try {
    return (
      !!err &&
      (typeof err === "object" || typeof err === "function") &&
      (err as { boosthisSyncThrow?: boolean }).boosthisSyncThrow === true
    );
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------------- *
 * XHR last-resort transport.
 * ------------------------------------------------------------------------- */

/** Per-attempt XHR timeout — deliberately BELOW the kit's ~8s outer race so a
 *  stalled socket is abandoned by the shim first and the retry gets a fresh
 *  one (see the module's CONSUMER CONTRACT note). */
export const XHR_TIMEOUT_MS = 6500;

/** Minimal structural XHR types — accessed via `globalThis` cast, NEVER the
 *  bare DOM global names: this source is also typechecked by DOM-less
 *  consumers (the api-server imports runtime sources with no `dom` lib). */
interface MinimalXhr {
  readyState: number;
  status: number;
  responseText: string | null;
  timeout: number;
  onreadystatechange: (() => void) | null;
  onerror: (() => void) | null;
  ontimeout: (() => void) | null;
  onabort: (() => void) | null;
  open(method: string, url: string, async: boolean): void;
  setRequestHeader(key: string, value: string): void;
  send(body?: string): void;
  abort(): void;
}

function xhrCtor(): (new () => MinimalXhr) | undefined {
  const g = globalThis as unknown as { XMLHttpRequest?: unknown };
  return typeof g.XMLHttpRequest === "function"
    ? (g.XMLHttpRequest as new () => MinimalXhr)
    : undefined;
}

/** True when an XHR constructor exists in this runtime. */
export function xhrAvailable(): boolean {
  return xhrCtor() !== undefined;
}

/**
 * Last-resort transport built on `XMLHttpRequest`, obeying this module's own
 * CONSUMER CONTRACT:
 *   1. rejects on `onerror` / `ontimeout` / `onabort` (never resolves a
 *      synthetic failure, so backoff-retry still fires),
 *   2. resolves ONLY at `readyState === 4` (DONE) — and a DONE status of 0 is
 *      a transport failure, not a response,
 *   3. bounds each attempt with `xhr.timeout = 6500` PLUS an independent hard
 *      timer calling `xhr.abort()` (RN's XHR timeout is unreliable on
 *      half-open sockets), both under the kit's ~8s outer race,
 *   4. resolves a minimal Response-shaped object (`status`/`ok`/`json`/`text`)
 *      that `callFetch` duck-types as a Response.
 * Exported for tests and available to hosts as an explicit `fetchImpl`.
 */
export function xhrFetch(url: string, init?: RequestInit): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const Ctor = xhrCtor();
    if (!Ctor) {
      reject(new Error(NO_FETCH_MESSAGE));
      return;
    }
    let xhr: MinimalXhr;
    try {
      xhr = new Ctor();
    } catch (err) {
      reject(err);
      return;
    }
    let settled = false;
    let hardTimer: ReturnType<typeof setTimeout> | undefined;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (hardTimer !== undefined) clearTimeout(hardTimer);
      fn();
    };
    try {
      const method = (init && init.method) || "GET";
      xhr.open(String(method), url, true);
      const tuples = toHeaderTuples(init ? init.headers : undefined);
      if (tuples) {
        for (const [k, v] of tuples) {
          try {
            xhr.setRequestHeader(k, v);
          } catch {
            /* an unsettable header (e.g. forbidden name) must not kill the call */
          }
        }
      }
      try {
        xhr.timeout = XHR_TIMEOUT_MS;
      } catch {
        /* some shims expose timeout as readonly — the hard timer still bounds us */
      }
      xhr.onreadystatechange = () => {
        // Resolve ONLY at DONE — an earlier readyState has a partial response.
        if (xhr.readyState !== 4) return;
        const status = xhr.status;
        if (typeof status !== "number" || status === 0) {
          settle(() => reject(new Error(STATUS_0_MESSAGE)));
          return;
        }
        const text = String(xhr.responseText ?? "");
        settle(() =>
          resolve({
            status,
            ok: status >= 200 && status < 300,
            json: () => Promise.resolve().then(() => JSON.parse(text) as unknown),
            text: () => Promise.resolve(text),
          } as unknown as Response),
        );
      };
      xhr.onerror = () =>
        settle(() => reject(new Error("boosthis: network request failed")));
      xhr.ontimeout = () =>
        settle(() => reject(new Error("boosthis: request timed out")));
      xhr.onabort = () =>
        settle(() => reject(new Error("boosthis: request timed out")));
      // Independent hard timer: on RN a half-open socket can stall without
      // ever firing `ontimeout`; abort() forces the socket free. The onabort
      // handler above settles the promise as a timeout.
      hardTimer = setTimeout(() => {
        try {
          xhr.abort();
        } catch {
          settle(() => reject(new Error("boosthis: request timed out")));
        }
      }, XHR_TIMEOUT_MS + 500);
      const body = init && typeof init.body === "string" ? init.body : undefined;
      xhr.send(body);
    } catch (err) {
      settle(() => reject(err));
    }
  });
}

/**
 * Resolve a callable fetch. Preference order:
 *   1. a host-supplied impl (the EXACT transport the app already uses), if it
 *      is actually a function;
 *   2. the global `fetch`, BOUND to `globalThis` so a native binding never
 *      throws when invoked from an extracted reference;
 *   3. `xhrFetch` — the XHR last-resort shim, when `XMLHttpRequest` exists in
 *      this runtime (a build with no usable `fetch` at all can still reach the
 *      server; RN always ships XHR — RN's own fetch is built on it);
 *   4. `undefined` — nothing callable exists, so callers must fail with a
 *      clear message instead of calling `undefined`.
 */
export function resolveFetch(provided?: unknown): FetchImpl | undefined {
  if (typeof provided === "function") return provided as FetchImpl;
  const g = globalThis as unknown as { fetch?: unknown };
  if (typeof g.fetch === "function") {
    return (g.fetch as FetchImpl).bind(globalThis) as FetchImpl;
  }
  if (xhrAvailable()) {
    return xhrFetch as unknown as FetchImpl;
  }
  return undefined;
}

/**
 * Convert a `HeadersInit` to an array of `[key, value]` tuples — the ONLY header
 * shape that is safe across every transport on Hermes/New-Arch (see the
 * "HERMES-SAFE CALL SHAPE" note above). A plain object handed to `expo/fetch`
 * trips its `headers instanceof Headers` normalizer, which throws synchronously
 * when `Headers` is undefined; tuples short-circuit at `Array.isArray()` first.
 *
 * Crucially this helper NEVER uses `instanceof` itself (that is the very landmine
 * we are dodging): an already-tuple array is returned as-is, a `Headers`-like
 * object is detected by duck-typing its `.forEach`, and the kit's normal case (a
 * plain object literal) is mapped via `Object.entries`. Returns `undefined`
 * unchanged so a header-less request stays header-less.
 */
export function toHeaderTuples(
  // Typed as `RequestInit["headers"]` (the exact value `callFetch` forwards)
  // rather than the bare `HeadersInit` global: `HeadersInit` is a DOM-lib name
  // that is absent when this source is typechecked by a DOM-less consumer (a
  // Node package that imports the runtime), whereas `RequestInit` resolves under
  // both the DOM lib and `@types/node`. Same shapes, no behavior change.
  headers: RequestInit["headers"] | undefined,
): [string, string][] | undefined {
  if (!headers) return undefined;
  if (Array.isArray(headers)) {
    // Already tuple form (or an iterable of pairs) — normalize values to strings.
    return headers.map(([k, v]) => [String(k), String(v)] as [string, string]);
  }
  // Web `Headers` instance — duck-typed (NEVER `instanceof`, undefined on
  // Hermes). `Object.entries` would return [] for it (values live internally),
  // so iterate via `forEach` to avoid silently dropping every header.
  const maybeHeaders = headers as {
    forEach?: (cb: (value: string, key: string) => void) => void;
  };
  if (typeof maybeHeaders.forEach === "function") {
    const out: [string, string][] = [];
    maybeHeaders.forEach((value, key) => out.push([String(key), String(value)]));
    return out;
  }
  // Plain object literal — the kit's normal case.
  return Object.entries(headers as Record<string, unknown>).map(
    ([k, v]) => [k, String(v)] as [string, string],
  );
}

/**
 * Invoke `f(url, init)` and normalize the outcome into a real
 * `Promise<Response>`. Guarantees:
 *   - object headers are rewritten to `[key, value]` tuples first so a raw
 *     `expo/fetch` (or any transport whose header normalizer uses `instanceof
 *     Headers`) is Hermes-safe — see the "HERMES-SAFE CALL SHAPE" note above,
 *   - a synchronous throw from `f` becomes a rejected Promise (never escapes
 *     synchronously into a `.catch`/`.race` that assumes a Promise),
 *   - a non-Promise / thenable return is adopted via `Promise.resolve`,
 *   - a result that is not a usable Response rejects with a clear message
 *     rather than letting a later `res.status` access throw,
 * so the returned value is ALWAYS a real Promise and downstream `.catch` /
 * `Promise.race` can never be "undefined is not a function".
 */
export function callFetch(
  f: FetchImpl,
  url: string,
  init: RequestInit,
): Promise<Response> {
  // Rewrite headers to Hermes-safe tuples without mutating the caller's `init`.
  const safeInit: RequestInit =
    init && init.headers
      ? { ...init, headers: toHeaderTuples(init.headers) }
      : init;
  return new Promise<Response>((resolve, reject) => {
    const adopt = (out: unknown) => {
      Promise.resolve(out).then((res) => {
        if (res && typeof (res as Response).status === "number") {
          // Status 0 is a dead/dropped socket surfaced as a "response" (the
          // kit never uses `no-cors`, so a legit opaque status-0 cannot
          // occur). Reject so fetchResilient's backoff-retry fires instead of
          // the caller mis-reading it as an HTTP error.
          if ((res as Response).status === 0) {
            reject(new Error(STATUS_0_MESSAGE));
          } else {
            resolve(res as Response);
          }
        } else {
          reject(new Error("boosthis: fetch returned no response"));
        }
      }, reject);
    };
    let out: unknown;
    try {
      // Marked as the KIT's own dispatch for exactly as long as it takes to
      // hand the request over: the automatic network wrapper sits on the same
      // global transport this call resolves, and Boosthis talking to Boosthis
      // is not the app's traffic (see kitOwnedCall.ts).
      out = runKitOwnedCall(() => f(url, safeInit));
    } catch (err) {
      // A SYNCHRONOUS throw provably sent no bytes. Two cases:
      //  - an abort signal was riding the init: some RN runtimes throw
      //    synchronously on any signal-bearing call. Reject with the throw
      //    TAGGED (`isSyncTransportThrow`) so the caller retries signal-free
      //    with its ORIGINAL transport — never re-route onto XHR here, or a
      //    signal-hostile runtime would silently migrate auth traffic onto
      //    the very stale-socket transport the kit is escaping.
      //  - no signal involved: the impl itself is broken (absent/broken web
      //    globals). Retry ONCE through the XHR last-resort shim when it
      //    exists and is a DIFFERENT transport; otherwise reject tagged.
      const hasSignal =
        !!safeInit && (safeInit as { signal?: unknown }).signal != null;
      if (
        !hasSignal &&
        (f as unknown) !== (xhrFetch as unknown) &&
        xhrAvailable()
      ) {
        adopt(runKitOwnedCall(() => xhrFetch(url, safeInit)));
        return;
      }
      reject(tagSyncThrow(err));
      return;
    }
    adopt(out);
  });
}
