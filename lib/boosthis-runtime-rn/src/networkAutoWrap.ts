/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: automatic network attempt reporting (ON BY DEFAULT) ──────
 *
 * ON BY DEFAULT since 1.0.0-alpha.227, and refusable with
 * `autoWrapNetwork: false`. It shipped switched off, which made the sentence
 * below true of almost every install: an opt-in nobody opts into is not a
 * choice, it is a default. The reasoning, and the guest-safety line a
 * collector that starts itself has to hold, are recorded in
 * docs/decisions/rn-collectors-that-start-themselves.md.
 *
 * The Network axis is report-only by design: the host calls
 * `recordNetworkAttempt` / `measureNetworkAttempt` and the kit never sees a
 * URL, host, path or status. That contract is right and this file does not
 * touch it — everything below reports exactly what the manual API reports, a
 * duration and a coarse outcome bucket, and nothing else is read off the
 * request at any point.
 *
 * What it changes is who has to write the call. Wiring a transport by hand is
 * work an ordinary app never gets round to, so the axis stayed unmeasured for
 * almost everyone and the only thing the dashboard could ever show was an
 * honest silence. Opting in here reports the ordinary app's traffic without
 * the developer writing anything.
 *
 * THREE THINGS A REAL APP DOES THAT A NAIVE WRAPPER GETS WRONG
 * ------------------------------------------------------------
 * 1. It has more than one transport. React Native's own `fetch` is built on
 *    XMLHttpRequest, and a global `fetch` a shim or a native-stack transport
 *    has been installed over bypasses XHR entirely. Watching one of them
 *    measures half an app and calls it the whole, so BOTH globals are
 *    wrapped. A transport the app imports and calls directly (`expo/fetch`,
 *    a native SDK's own client) touches neither global and cannot be reached
 *    from here at all — the app hands it over with `wrapNetworkFetch`, and
 *    the claims we publish say exactly that rather than implying we found it
 *    ourselves.
 *
 * 2. It installs its own global fetch shim, often AFTER the kit started. A
 *    wrapper that installs once is simply switched off at that moment, quietly
 *    and for the rest of the session. So installation is re-assertable: the
 *    kit checks whether the global is still the function it installed and, if
 *    not, wraps whatever is there now. It never assumes it is the only wrapper
 *    or the outermost one.
 *
 * 3. Those two together mean one request can pass through several counting
 *    layers — ours over the host's over ours, and the fetch layer down into
 *    the XHR layer underneath it. Every layer reporting the attempt would
 *    inflate the app's own numbers, and an inflated attempt count makes a
 *    stall rate look better than it is. Two rules keep it at one report:
 *      - a layer stands down while another of ours is handing the request
 *        over (the synchronous depth below), which covers a transport that
 *        calls straight through — RN's fetch into XHR, a shim that delegates
 *        at once;
 *      - a global-fetch wrapper of ours reports ONLY while it is the one
 *        currently installed on the global. Re-asserting over a host shim
 *        leaves the older wrapper buried in the chain, and that shim may well
 *        await something before calling it, by which time the synchronous
 *        depth is long closed. A buried wrapper therefore delegates in
 *        silence for the rest of the session — but it raises the depth around
 *        that delegation, because the transport it hands the request to is
 *        underneath the layer that IS timing it, and the closed window would
 *        otherwise leave that transport free to time it a second time.
 *    A host that times the call itself with `measureNetworkAttempt` stands
 *    ITS timer down for ours — but only for the request we can be SHOWN to
 *    have measured: the promise we handed back, or an attempt that began
 *    inside its window, settled with it and ended the same way. A request
 *    that merely overlapped never suppresses the caller's reading, because
 *    dropping a reading is how an absence becomes a number. The association
 *    rule, and the two failures either side of it, are set out in
 *    networkSampler.ts.
 *    `recordNetworkAttempt` is not de-duplicated at all: it arrives as a
 *    duration and an outcome word after the fact, with nothing in it that
 *    could say whether it is the call we just timed or a second one on a
 *    transport we never saw. It records exactly what it is handed — so it is
 *    for transports the kit cannot reach, and the published copy says that
 *    rather than promising a de-duplication we have no way to perform.
 *
 * What cannot be reached is reported rather than ignored: a transport that is
 * present and could not be wrapped is counted, so an unwatchable call shows up
 * as a gap in coverage instead of quietly reducing to a measured zero.
 */

import { isBoosthisDisabled } from "./runtimeFlags";
import { isKitOwnedDispatch } from "./kitOwnedCall";
import {
  circuitTraceHeaders,
  isScreenCircuitOn,
  noteCircuitCall,
  noteCircuitCallStarted,
  type CircuitCallContext,
} from "./screenCircuit";
import { isBoosthisWrapper, markBoosthisWrapper } from "./wrapperChain";
import {
  markAutomaticPromise,
  noteAutomaticAttempt,
  networkSampler,
  type NetworkOutcome,
} from "./networkSampler";

/** The transports this kit knows how to reach from JavaScript. */
export type TransportName = "fetch" | "xhr";

/**
 * What became of one transport.
 *
 *   watching    — wrapped; its attempts reach the axis.
 *   absent      — this app does not have it at all. Not a gap: there is
 *                 nothing here to miss.
 *   unreachable — present, and the kit could not wrap it. THIS is the gap,
 *                 and it is counted rather than folded into the measured
 *                 figure, because calls made through it are invisible to us
 *                 and a total that silently omits them is a wrong number.
 *   not-wrapped — automatic reporting is off. The host may well be reporting
 *                 these attempts by hand; the kit simply is not.
 */
export type TransportState =
  | "watching"
  | "absent"
  | "unreachable"
  | "not-wrapped";

export interface TransportCoverage {
  /** How many transports the kit is reporting attempts from. */
  watching: number;
  /** How many are present and out of reach — the calls we cannot see. */
  unwatched: number;
  /** Per transport, for the panel and for tests. */
  transports: { name: TransportName; state: TransportState }[];
}

export interface NetworkAutoWrapOptions {
  /**
   * Completed attempts at or above this many milliseconds are reported as a
   * near-hang ("stall") rather than "ok" — the silent-drop class the axis
   * exists to catch. Omit it and a completed call is always "ok".
   */
  stallMs?: number;
}

/* ─── The one-attempt-one-report rule ──────────────────────────────────── */

/**
 * How many of OUR fetch layers are dispatching right now.
 *
 * Synchronous by construction: raised immediately before the call into the
 * next layer and lowered as soon as that call returns. That span is exactly
 * when a transport hands the request to whatever is underneath it — when RN's
 * fetch creates and sends its XMLHttpRequest, and when a host shim calls
 * through to the fetch we wrapped earlier. Anything our layers see inside that
 * span belongs to the attempt already being timed, so they stand down.
 *
 * Nothing is carried across an `await`, which is the point: a flag that
 * outlived the dispatch would suppress an unrelated request that merely
 * started while an earlier one was still in the air.
 */
let dispatchDepth = 0;

/**
 * Should this layer stand down WITHOUT spending anything?
 *
 * Two positive facts about this instant:
 *   - an attempt of ours is already being timed further up the stack,
 *   - the request is the KIT's own upload, which is not this app's traffic
 *     and must never put evidence under the app's Network axis.
 *
 * Asked before the caller-owned credit below, so neither of these burns one.
 */
function alreadyCounting(): boolean {
  return dispatchDepth > 0 || isKitOwnedDispatch();
}

/*
 * Our wrappers mark themselves through the shared wrapper-chain contract
 * (`markBoosthisWrapper`), which does two jobs at once: re-asserting never
 * wraps one of ours a second time, and ANOTHER meter of ours sitting under
 * this one — the AI call watcher, which is on `send` before we get there —
 * can still see that it is called on every request rather than reporting
 * itself blind the moment we install. Both marks are non-enumerable.
 */

function nowMs(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

/* ─── Installation state ───────────────────────────────────────────────── */

let enabled = false;
let stallMs = 0;
/**
 * The host asked us NOT to watch its transports (`autoWrapNetwork: false`).
 *
 * A separate fact from `enabled === false`, and the distinction is the whole
 * point of it: a kit that never started and a kit the app switched off are
 * both "not enabled", and only one of them is something the reader should be
 * told. This flag is set positively, by the start path, when the host passed
 * the refusal — so the axis can say it is off in this build instead of
 * pretending to warm up for ever.
 */
let hostRefused = false;
/** Least time between two activity-driven re-asserts. Two identity checks are
 *  cheap, but the cadence they ride is the app's own event rate. */
const REASSERT_MIN_GAP_MS = 5_000;
/** When the last activity-driven re-assert ran; 0 means never. */
let lastAssertAt = 0;
/** The exact function we last put on the global, so we can tell whether we
 *  are still there or whether the host has installed something over us. */
let installedFetch: unknown = null;
const state: Record<TransportName, TransportState> = {
  fetch: "not-wrapped",
  xhr: "not-wrapped",
};

/** Report one attempt, in the SAME two values the manual API accepts. */
function report(startedAt: number, outcome: NetworkOutcome): void {
  const settledAt = nowMs();
  const durationMs = settledAt - startedAt;
  const banked: NetworkOutcome =
    outcome === "ok" && stallMs > 0 && durationMs >= stallMs
      ? "stall"
      : outcome;
  networkSampler.record({ durationMs, outcome: banked });
  // Declared at the settle, with the window we actually measured, so a host
  // that wrapped THIS request in `measureNetworkAttempt` can recognise its
  // own call rather than stand down for whatever else was in the air.
  noteAutomaticAttempt({ startedAt, settledAt, outcome: banked });
}

/* ─── The circuit, when the developer switched it on ───────────────────── */

/**
 * Everything below this comment and above the fetch section is inert unless
 * `traceScreens` is set. It is deliberately gathered in one place, reads
 * NOTHING while the switch is off, and hands what it reads to
 * `screenCircuit.ts` rather than to the Network axis: the axis keeps receiving
 * the same two values it always did (how long, how it ended) and stays blind
 * to the URL, the host, the path and the status. See
 * `docs/decisions/rn-screen-circuit-boundary.md`.
 */

interface CircuitAttempt {
  method: string;
  url: string;
  startedAt: number;
  /** The screen and journey this request was DISPATCHED from, taken here and
   *  carried to the settle: a call started on one screen that lands after the
   *  app moved belongs to the screen that made it. */
  from: CircuitCallContext | null;
}

/** Read the method and URL out of a `fetch` call's arguments, duck-typed —
 *  never `instanceof Request`/`URL`, both of which are undefined on some RN
 *  runtimes. */
function readFetchCall(args: unknown[]): { method: string; url: string } | null {
  const input = args[0];
  const init = (args[1] ?? undefined) as { method?: unknown } | undefined;
  let url: string | null = null;
  if (typeof input === "string") url = input;
  else if (input && typeof input === "object") {
    const anyInput = input as { href?: unknown; url?: unknown };
    if (typeof anyInput.href === "string") url = anyInput.href;
    else if (typeof anyInput.url === "string") url = anyInput.url;
  }
  if (url === null || url.length === 0) return null;
  const rawMethod =
    init?.method ??
    (input && typeof input === "object"
      ? (input as { method?: unknown }).method
      : undefined) ??
    "GET";
  return { method: String(rawMethod).toUpperCase(), url };
}

/** Return a copy of the fetch arguments carrying the trace headers, leaving
 *  the app's own headers in place. Any failure returns the ORIGINAL arguments:
 *  a request we could not add a header to still has to go out exactly as the
 *  app wrote it. */
function withTraceHeaders(
  args: unknown[],
  headers: Array<[string, string]>,
): unknown[] {
  try {
    const input = args[0];
    const init = (args[1] ?? undefined) as Record<string, unknown> | undefined;
    const merged = new Map<string, [string, string]>();
    const take = (h: unknown): void => {
      if (!h) return;
      if (Array.isArray(h)) {
        for (const e of h) {
          if (Array.isArray(e) && e.length >= 2) {
            merged.set(String(e[0]).toLowerCase(), [String(e[0]), String(e[1])]);
          }
        }
        return;
      }
      const anyH = h as { forEach?: (cb: (v: string, k: string) => void) => void };
      if (typeof anyH.forEach === "function") {
        anyH.forEach((v, k) => merged.set(String(k).toLowerCase(), [String(k), String(v)]));
        return;
      }
      for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
        merged.set(k.toLowerCase(), [k, String(v)]);
      }
    };
    if (input && typeof input === "object") take((input as { headers?: unknown }).headers);
    take(init?.headers);
    for (const [k, v] of headers) merged.set(k.toLowerCase(), [k, v]);
    return [input, { ...(init ?? {}), headers: [...merged.values()] }, ...args.slice(2)];
  } catch {
    return args;
  }
}

/** Where an XHR's method and URL wait between `open` and `send`. A symbol, so
 *  it cannot collide with anything the app keeps on its own requests. */
const CIRCUIT_CALL = Symbol("boosthis.circuitCall");

/** The status a settled fetch answered with, read without touching the body. */
function statusOf(value: unknown): number | null {
  const code = (value as { status?: unknown } | null)?.status;
  return typeof code === "number" ? code : null;
}

/* ─── fetch ────────────────────────────────────────────────────────────── */

type AnyFetch = (...args: unknown[]) => unknown;

/**
 * Where a wrapper sits.
 *
 *   global   — installed on `globalThis.fetch`. Reports only while it IS the
 *              installed one: once the host has wrapped it and we have
 *              re-asserted on top, this copy is buried in the chain and the
 *              layer above is already timing the attempt. It cannot rely on
 *              the synchronous depth to notice, because a host shim is free
 *              to await something before calling through — and for the same
 *              reason it re-opens that depth while it delegates, so the
 *              transport underneath does not time the attempt instead.
 *   handover — an implementation the app handed us with `wrapNetworkFetch`.
 *              It owns its own transport and is the only layer on it, so it
 *              always reports (subject to the ordinary stand-down rules).
 */
type WrapperRole = "global" | "handover";

function makeFetchWrapper(inner: AnyFetch, role: WrapperRole): AnyFetch {
  const wrapper = function boosthisFetch(this: unknown, ...args: unknown[]) {
    // Never change what the app does. Every path below returns the inner
    // call's exact value and rethrows its exact error.
    if (!enabled || isBoosthisDisabled()) {
      // Nothing of ours is counting anywhere, so the call passes through
      // exactly as the app wrote it.
      return inner.apply(this, args);
    }
    if (
      alreadyCounting() ||
      (role === "global" && wrapper !== installedFetch)
    ) {
      // Stand down: this attempt is already being accounted for — by a layer
      // of ours above, or because it is the kit's own upload.
      //
      // But the hand-over below is still OURS, and that is the part a plain
      // delegation gets wrong. A host shim is free to await before calling
      // the copy of us it captured, and by then the outer layer's dispatch
      // window has long closed. RN's fetch underneath then sends an
      // XMLHttpRequest through the layer below, which sees nothing holding
      // the attempt open and times the very request we stood down FOR: one
      // request, two readings on the axis and two calls on the circuit.
      // Hold the window here instead, for exactly as long as the call into
      // the next layer takes — the same synchronous rule, applied on the
      // path that delegates in silence.
      dispatchDepth++;
      try {
        return inner.apply(this, args);
      } finally {
        dispatchDepth--;
      }
    }
    const startedAt = nowMs();
    // The circuit, if the developer switched it on. Read on ITS OWN clock
    // (`Date.now()`), because the span it produces is placed against the
    // journey's wall-clock start — a start taken on one clock and an end on
    // another is how every real reading gets thrown away.
    let attempt: CircuitAttempt | null = null;
    let callArgs = args;
    if (isScreenCircuitOn()) {
      try {
        const call = readFetchCall(args);
        if (call) {
          const from = noteCircuitCallStarted();
          attempt = { ...call, startedAt: Date.now(), from };
          const headers = circuitTraceHeaders(call.url, from);
          if (headers) callArgs = withTraceHeaders(args, headers);
        }
      } catch {
        // The request goes out exactly as the app wrote it.
        attempt = null;
        callArgs = args;
      }
    }
    const settle = (status: number | null, threw: boolean): void => {
      if (!attempt) return;
      const a = attempt;
      attempt = null;
      noteCircuitCall(
        {
          method: a.method,
          url: a.url,
          startedAt: a.startedAt,
          settledAt: Date.now(),
          status,
          threw,
        },
        a.from,
      );
    };
    let out: unknown;
    dispatchDepth++;
    try {
      out = inner.apply(this, callArgs);
    } catch (e) {
      // A transport that throws synchronously never made a request in the
      // ordinary sense, but the app asked for one and did not get it — which
      // is the loud-failure bucket exactly as the manual API reports it.
      dispatchDepth--;
      report(startedAt, "error");
      settle(null, true);
      throw e;
    }
    dispatchDepth--;
    const p = out as Promise<unknown> | null;
    if (!p || typeof p.then !== "function") {
      settle(null, false);
      return out;
    }
    // Watch it settle WITHOUT replacing it. Handing back `p.then(...)` would
    // have returned a different object from the one the transport made, and
    // anything the transport hung on its own promise — an abort handle, a
    // `cancel`, a progress property — is gone from that copy. (A subclass
    // usually survives `then`: Symbol.species decides, and a subclass is free
    // to point it back at plain `Promise`. The app's own properties never
    // survive it.) The app gets its own promise back; the stamp is one
    // non-enumerable, symbol-keyed property ON that promise, so a host
    // awaiting exactly this one in `measureNetworkAttempt` still knows our
    // measurement is of its own request. We never hold a reference to the
    // response body.
    //
    // The observer swallows what it sees rather than rethrowing: this
    // derived promise is ours and nobody will handle its rejection, while the
    // app's copy still rejects exactly as the transport rejected it.
    markAutomaticPromise(p);
    p.then(
      (value) => {
        report(startedAt, "ok");
        settle(statusOf(value), false);
      },
      () => {
        report(startedAt, "error");
        settle(null, true);
      },
    );
    return out;
  } as AnyFetch;
  return markBoosthisWrapper(wrapper, inner, "network");
}

/**
 * Put our wrapper back on top of whatever `fetch` is now.
 *
 * Called on a cadence rather than once, because the failure this exists to
 * survive is a host shim installed after us: at that moment our wrapper is
 * still in the chain (the host captured it) but it is no longer the entry
 * point, and if the host instead captured the ORIGINAL we have been switched
 * off altogether. Wrapping the current function restores reporting either way,
 * and the dispatch-depth rule above stops the resulting stack of layers
 * reporting the same attempt more than once.
 */
function assertFetch(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  const current = g.fetch;
  if (typeof current !== "function") {
    state.fetch = "absent";
    installedFetch = null;
    return;
  }
  if (current === installedFetch) {
    state.fetch = "watching";
    return;
  }
  try {
    const wrapped = makeFetchWrapper(current as AnyFetch, "global");
    g.fetch = wrapped;
    installedFetch = wrapped;
    state.fetch = "watching";
  } catch {
    // A non-writable global is a transport we can see and cannot watch.
    state.fetch = "unreachable";
    installedFetch = null;
  }
}

/* ─── XMLHttpRequest ───────────────────────────────────────────────────── */

interface XhrLike {
  send: (...args: unknown[]) => unknown;
  addEventListener?: (type: string, fn: () => void) => void;
}

/**
 * Positive evidence that a send of this app's went out and we could not see
 * how it ended: no `addEventListener` on the request, or the listeners were
 * refused. Sticky, because it is a fact about this runtime that does not stop
 * being true on the next re-assert — and because "we wrapped it" is worthless
 * to a reader if nothing the wrapper sees can ever be reported. Once it is
 * set the transport reads `unreachable`, which is a COUNTED gap, rather than
 * `watching`, which would claim attempts are reaching the axis.
 */
let xhrUnobservable = false;

function assertXhr(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  const ctor = g.XMLHttpRequest as
    | { prototype: XhrLike & Record<string, unknown> }
    | undefined;
  const proto = ctor?.prototype;
  if (!proto || typeof proto.send !== "function") {
    state.xhr = "absent";
    return;
  }
  if (xhrUnobservable) {
    // Present, wrappable, and we have watched a send we could not follow to
    // its end. Reporting that as "watching" would be a false coverage claim.
    state.xhr = "unreachable";
    return;
  }
  if (typeof proto.addEventListener !== "function") {
    // A request object with no way to hear how it ended. We could put a
    // wrapper on `send`, and it could never report a single outcome — which
    // is a transport out of reach, not a transport we are watching.
    state.xhr = "unreachable";
    return;
  }
  // Only `open` is given the method and the URL, and only the circuit needs
  // them. Wrapped ONLY while the switch is on, so an app that never asked for
  // a circuit has exactly the prototype it had before — and wrapped BEFORE the
  // early return below, so switching the circuit on after the send wrapper is
  // already installed still reaches it on the next re-assert.
  if (isScreenCircuitOn() && !isBoosthisWrapper(proto.open, "network")) {
    const originalOpen = proto.open as
      | ((...a: unknown[]) => unknown)
      | undefined;
    if (typeof originalOpen === "function") {
      const open = function (this: Record<symbol, unknown>, ...args: unknown[]) {
        try {
          const url = String(args[1] ?? "");
          this[CIRCUIT_CALL] =
            url.length > 0
              ? { method: String(args[0] ?? "GET").toUpperCase(), url }
              : undefined;
        } catch {
          // ignore — an app that will not take a property still gets its call
        }
        return originalOpen.apply(this, args);
      };
      markBoosthisWrapper(open, originalOpen, "network");
      try {
        proto.open = open;
      } catch {
        // The prototype will not take it; the circuit simply sees no XHR.
      }
    }
  }
  if (isBoosthisWrapper(proto.send, "network")) {
    state.xhr = "watching";
    return;
  }
  const originalSend = proto.send;
  const send = function (this: XhrLike, ...args: unknown[]) {
    if (!enabled || isBoosthisDisabled() || alreadyCounting()) {
      return originalSend.apply(this, args);
    }
    if (typeof this.addEventListener !== "function") {
      // This request went out and we will never hear how it ended. Say so:
      // an unwatchable send counted as coverage is exactly the silent
      // reduction to a measured figure this work exists to stop.
      xhrUnobservable = true;
      state.xhr = "unreachable";
      return originalSend.apply(this, args);
    }
    const startedAt = nowMs();
    // Same two-clock rule as the fetch path: the axis keeps its own clock, the
    // circuit takes wall-clock stamps, and the two never meet.
    let attempt: CircuitAttempt | null = null;
    if (isScreenCircuitOn()) {
      try {
        const rec = (this as unknown as Record<symbol, unknown>)[CIRCUIT_CALL] as
          | { method: string; url: string }
          | undefined;
        if (rec && typeof rec.url === "string") {
          const from = noteCircuitCallStarted();
          attempt = {
            method: rec.method,
            url: rec.url,
            startedAt: Date.now(),
            from,
          };
          const headers = circuitTraceHeaders(rec.url, from);
          const setHeader = (
            this as unknown as {
              setRequestHeader?: (k: string, v: string) => void;
            }
          ).setRequestHeader;
          if (headers && typeof setHeader === "function") {
            for (const [k, v] of headers) {
              try {
                setHeader.call(this, k, v);
              } catch {
                // A header the request refuses is one header, not a failure.
              }
            }
          }
        }
      } catch {
        attempt = null;
      }
    }
    let done = false;
    const finish = (outcome: NetworkOutcome) => {
      if (done) return;
      done = true;
      report(startedAt, outcome);
      if (attempt) {
        const a = attempt;
        attempt = null;
        try {
          const raw = (this as unknown as { status?: unknown }).status;
          // An XHR that errored, was aborted or timed out reports status 0 —
          // a call that never got an answer at all, which is exactly what
          // `threw` means on the fetch path.
          const code = typeof raw === "number" && raw > 0 ? raw : null;
          noteCircuitCall(
            {
              method: a.method,
              url: a.url,
              startedAt: a.startedAt,
              settledAt: Date.now(),
              status: code,
              threw: code === null,
            },
            a.from,
          );
        } catch {
          // never break the host
        }
      }
    };
    try {
      this.addEventListener("load", () => finish("ok"));
      this.addEventListener("error", () => finish("error"));
      this.addEventListener("abort", () => finish("error"));
      this.addEventListener("timeout", () => finish("timeout"));
    } catch {
      // Refused. Same fact as above, reached a different way: the send goes
      // out and its end is invisible to us, so the transport is counted as a
      // gap rather than reported as watched.
      xhrUnobservable = true;
      state.xhr = "unreachable";
      return originalSend.apply(this, args);
    }
    // Raised around the handover exactly as the fetch layer does it, and for
    // the same reason: a second copy of this wrapper underneath us (a doubled
    // prototype, or RN's fetch calling down into XHR) sees that this attempt
    // is already being timed and stands down. Deliberately NOT a mark on the
    // request object — an XHR instance is reusable, and a permanent mark would
    // count its first send and silently drop every later one.
    dispatchDepth++;
    try {
      return originalSend.apply(this, args);
    } catch (e) {
      finish("error");
      throw e;
    } finally {
      dispatchDepth--;
    }
  };
  markBoosthisWrapper(send, originalSend, "network");
  try {
    proto.send = send as XhrLike["send"];
    state.xhr = "watching";
  } catch {
    // Present, and the prototype will not take the wrapper.
    state.xhr = "unreachable";
  }
}

/* ─── Public surface ───────────────────────────────────────────────────── */

/**
 * Switch on automatic attempt reporting. Safe to call more than once; each
 * call re-asserts the wrappers rather than stacking a new one.
 */
export function installNetworkAutoWrap(
  opts: NetworkAutoWrapOptions = {},
): TransportCoverage {
  enabled = true;
  hostRefused = false;
  stallMs =
    typeof opts.stallMs === "number" && opts.stallMs > 0 ? opts.stallMs : 0;
  return assertNetworkAutoWrap();
}

/**
 * Record that this app asked us not to watch its transports.
 *
 * Wraps nothing and reads nothing — it only writes down the refusal, so the
 * Network axis can state it. An app that switches a default-on collector off
 * is entitled to have that shown as the reason its tile is empty, rather than
 * being left with a meter that says it is still measuring.
 */
export function refuseNetworkAutoWrap(): void {
  enabled = false;
  hostRefused = true;
}

/** Did this app switch automatic reporting off? Positive evidence only. */
export function isNetworkAutoWrapRefused(): boolean {
  return hostRefused;
}

/**
 * Re-assert the wrappers and read back what is covered.
 *
 * Idempotent and cheap — two identity checks when nothing has moved — so it
 * can ride the reporting cadence the kit already runs. A no-op before the kit
 * starts, and for an app that refused.
 */
export function assertNetworkAutoWrap(): TransportCoverage {
  if (!enabled || isBoosthisDisabled()) return readTransportCoverage();
  assertFetch();
  assertXhr();
  return readTransportCoverage();
}

/**
 * Re-assert on the cadence the kit's own measurement already runs on.
 *
 * The snapshot capture re-asserts too, but an app that does not share
 * snapshots never captures one, and the failure this exists to survive — a
 * host shim installed over us minutes after launch — would then go unnoticed
 * for the rest of the session in exactly the mode that has no other cadence.
 * So the kit's event flush calls this as well: it runs whenever the app is
 * being measured at all, in every telemetry mode.
 *
 * Throttled, because that cadence follows the app's own activity rather than
 * a clock, and does nothing whatsoever before the kit starts or for an app
 * that refused.
 */
export function assertNetworkAutoWrapSoon(): void {
  if (!enabled) return;
  const now = nowMs();
  if (lastAssertAt !== 0 && now - lastAssertAt < REASSERT_MIN_GAP_MS) return;
  lastAssertAt = now;
  assertNetworkAutoWrap();
}

/** Is automatic reporting switched on for this app? */
export function isNetworkAutoWrapped(): boolean {
  return enabled;
}

/**
 * Measure a transport the kit cannot reach on its own.
 *
 * The two wrappers above sit on the global `fetch` and on
 * `XMLHttpRequest.prototype.send`, which is every request RN's own `fetch`
 * makes and every library built on either of them. An implementation the app
 * IMPORTS and calls directly — `fetch` from `expo/fetch`, a native SDK's own
 * client — never touches those globals, so nothing the kit installs on a
 * global can see it. There is no honest way to wrap a binding inside someone
 * else's module; the app has to hand it over.
 *
 * So: one line at the import site, and those calls are measured on the same
 * terms as every other — a duration and a coarse outcome, no URL, host or
 * status, counted once even when this transport ends up calling through a
 * wrapped global underneath.
 *
 *   import { fetch as expoFetch } from "expo/fetch";
 *   export const fetch = wrapNetworkFetch(expoFetch);
 *
 * Returns the SAME function when automatic reporting is off or the argument
 * is already one of ours, so wrapping twice is not counting twice.
 */
export function wrapNetworkFetch<T>(impl: T): T {
  if (typeof impl !== "function") return impl;
  if (isBoosthisWrapper(impl, "network")) return impl;
  return makeFetchWrapper(
    impl as unknown as AnyFetch,
    "handover",
  ) as unknown as T;
}

/**
 * What the kit can and cannot see, as counts.
 *
 * `unwatched` counts only transports this app HAS and this kit could not
 * reach — positive evidence of a gap, never an inference from silence. A
 * transport the app does not have is not a gap, and while automatic reporting
 * is off nothing is claimed either way: the host may be reporting every one of
 * these attempts by hand.
 */
export function readTransportCoverage(): TransportCoverage {
  const names: TransportName[] = ["fetch", "xhr"];
  const transports = names.map((name) => ({ name, state: state[name] }));
  return {
    watching: transports.filter((t) => t.state === "watching").length,
    unwatched: transports.filter((t) => t.state === "unreachable").length,
    transports,
  };
}

/**
 * The coverage fields to PUBLISH on a network reading — and nothing at all
 * while automatic reporting is off.
 *
 * `watching: 0` is not a neutral number downstream: it is read as positive
 * evidence that nobody wired this axis up, and the surfaces say so in as many
 * words. That is exactly right when automatic reporting is ON and found no
 * transport to wrap, and quite wrong when it is off, because the original
 * report-only API is still there and the host may be calling it on every
 * request. With nothing to claim we send no field, and the reader gets the
 * generic "nothing observed yet" rather than a fact we do not have.
 */
export function networkCoverageFields(): {
  watching?: number;
  unwatchedClients?: number;
  refused?: boolean;
} {
  // The refusal travels on its own, without a coverage claim beside it. "We
  // watched nothing" and "we were told not to watch" are different sentences,
  // and only the second one is the app's own doing.
  if (hostRefused) return { refused: true };
  if (!enabled) return {};
  const c = readTransportCoverage();
  return { watching: c.watching, unwatchedClients: c.unwatched };
}

/**
 * Stand every installed layer down and forget what was installed.
 *
 * Deliberately does NOT try to put the host's original functions back. By the
 * time this runs the host may have wrapped our wrapper, and restoring a
 * captured original would then throw away the host's own layer — breaking the
 * app to tidy up after ourselves. An inert wrapper that delegates and returns
 * the exact value costs an identity check per call and cannot damage anything.
 */
export function resetNetworkAutoWrap(): void {
  enabled = false;
  // Erasure leaves NO claim behind, including the claim that this app refused.
  // The next start decides again.
  hostRefused = false;
  stallMs = 0;
  installedFetch = null;
  dispatchDepth = 0;
  lastAssertAt = 0;
  xhrUnobservable = false;
  state.fetch = "not-wrapped";
  state.xhr = "not-wrapped";
}
