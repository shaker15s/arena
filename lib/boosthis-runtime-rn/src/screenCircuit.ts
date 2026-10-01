/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/** BOOSTHIS_SCREEN_CIRCUIT_V1 — a phone app's circuit, drawn from the screens
 *  it moves between and the calls those screens make.
 *
 *  WHY THIS EXISTS. Circuit lens and the project map are built from spans and
 *  their parent links. Until now the only thing in this kit that produced a
 *  span was a hand-written `traceFetch` at a call site, so an app that
 *  followed the setup guide to the letter produced none, for ever, and its
 *  circuit was blank however much the app was used. Meanwhile the kit already
 *  knew both halves of the graph: the screen the app is on, and every request
 *  it makes. Nothing joined them. This does.
 *
 *  WHAT IT DRAWS.
 *    - Each screen the app moves to is a NODE: one span, `layer:"rn"`,
 *      `routeLabel:"screen:<RouteName>"`, `kind:"handler"` — the shared
 *      vocabulary's word for "the work between something arriving and the
 *      answer going back; the span that CONTAINS the others", which is what a
 *      screen is.
 *    - Moving from one screen to the next is an EDGE: the new screen span's
 *      parent is the previous screen's span.
 *    - Every call made while a screen is current is a CHILD of that screen:
 *      one span, `kind:"http"`, parented to the screen span.
 *
 *  OFF UNLESS ASKED. Nothing here runs until the developer writes
 *  `traceScreens` in the setup call they already write. With it absent, this
 *  module is inert: no span, no header, and the blind Network axis reads
 *  exactly what it read before — see
 *  `docs/decisions/rn-screen-circuit-boundary.md`, which is the settled
 *  boundary this code is held to.
 *
 *  A JOURNEY, NOT A SESSION. One trace holds a bounded run of screens and
 *  their calls. It ends at the server's own per-trace row cap, at the shared
 *  ten-minute elapsed bound, or when the app goes away — and the next screen
 *  starts a fresh one. A trace that ran for a week would be refused a row at
 *  a time on arrival, with the newest work the part that never lands.
 */

// The part-name bound comes from the LEAF that owns it, never from the
// inventory that re-exports it: this module is reached from the network
// wrapper and the nav observer, and pulling the inventory's own imports in
// behind it is how a require cycle lands in a customer's build output.
import { MAX_PART_NAME } from "./partName";
// The same guard the upload runs over every label, run HERE so a node the
// transmit screen would drop is never given children. See noteCircuitScreen.
import { transmitLabelHasPII } from "./no-pii";
import { isBoosthisDisabled } from "./runtimeFlags";
import {
  enqueueSpan,
  rateSpanDuration,
  spanLabel,
  type TraceSpan,
} from "./spanEmitter";
import { newSpanId, PARENT_HEADER } from "./spanScope";
import {
  ELAPSED_HEADER,
  MAX_TRACE_ELAPSED_MS,
  newTraceId,
  TRACE_HEADER,
} from "./trace";
import { outcomeForStatus } from "./spanWork";
import {
  detectNavigationContainer,
  stopDetectingNavigationContainer,
  type NavDetectSeam,
} from "./navContainerDetect";
import {
  setTracePropagation,
  resetTracePropagationPolicy,
  shouldPropagateToUrl,
  tracePropagationSummary,
} from "./tracePropagation";
import { knownRouteSegments } from "./routeInventory";

/** The prefix that makes a span a screen NODE rather than a call. The server
 *  knows this shape — see `checkRouteLabel` — and the project map strips it to
 *  meet the per-screen timings measured under the same plain name. */
export const SCREEN_LABEL_PREFIX = "screen:";

/** The shape a screen name must have to travel, mirroring the server's
 *  `STRUCTURAL_SCREEN_NODE_RE` exactly. A name that does not match is REFUSED
 *  here and counted, never sent: a label the server would drop is a screen
 *  silently missing from the app's own map. */
const SCREEN_NAME_RE =
  /^[A-Za-z0-9[\]()][A-Za-z0-9[\]._:/()-]*(?: [A-Za-z0-9[\]()][A-Za-z0-9[\]._:/()-]*)*$/;

/** Route-FILE syntax — `[id]`, `[...rest]`, `(tabs)` — which a developer
 *  writes and an address bar never contains. */
const ROUTE_MARKER_RE = /^(?:\[[^[\]]*\]|\([^()]*\))$/;

/**
 * Where a screen name came from, because the two sources are not the same
 * kind of fact:
 *
 *   `route-name`     the navigator's own name for the screen — `Home`,
 *                    `profile/[user]`, `(tabs)/index`. Code the developer
 *                    wrote, which is what the published disclosure promises
 *                    is all that travels.
 *   `resolved-path`  the address the app is actually AT, as `usePathname()`
 *                    hands it over: `/profile/sarah`, `/orders/7781`. The
 *                    same route, with the values filled in.
 */
export type ScreenNameSource = "route-name" | "resolved-path";

/**
 * May this resolved address travel as a screen label?
 *
 * Only when every segment of it is a word the app's own route vocabulary
 * already contains, or route-file syntax. `/profile/[user]` and, in an app
 * that declared its screens, `/settings/notifications` do; `/profile/sarah`
 * and `/orders/7781` do not — and the difference cannot be read off the
 * shape, because `sarah` and `settings` are the same shape. So the question
 * is asked of the developer's OWN list rather than of a grammar.
 *
 * A name that fails is REFUSED whole and counted, never trimmed down to the
 * part we recognised: half an address is still an address, and a node nobody
 * can name is worse than a node that is missing.
 */
function addressIsRouteVocabulary(name: string): boolean {
  const segs = name
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segs.length === 0) return false;
  const known = knownRouteSegments();
  if (known.size === 0) return false;
  return segs.every(
    (s) => ROUTE_MARKER_RE.test(s) || known.has(s.toLowerCase()),
  );
}

/** The server stores at most this many spans per (trace, install). A journey
 *  that reached it would have its newest rows refused, so the kit closes the
 *  journey instead and the next screen opens a fresh one. */
export const MAX_SPANS_PER_JOURNEY = 20;

/** How long a screen may stay quiet before it counts as settled. */
export const SCREEN_SETTLE_IDLE_MS = 1_500;
/** And the ceiling, for a screen that never goes quiet at all. */
export const SCREEN_SETTLE_MAX_MS = 15_000;

export interface ScreenCircuitOptions {
  /**
   * Hosts that may receive the trace headers. A bare host
   * (`api.example.com`) or a leading-dot suffix (`.example.com`); at most 64;
   * `none` switches it off. NOTHING is propagated unless named — a phone has
   * no private network, so there is no safe default to inherit.
   */
  propagateTo?: readonly string[] | string;
}

/** Who is actually feeding the circuit its screen changes. */
export type NavigatorSource =
  /** Nothing has answered yet. */
  | "none"
  /** The app mounted the observer or handed a container over itself, and that
   *  subscription is the one reporting. */
  | "explicit"
  /** Nothing was handed over, so the kit found the container and subscribed to
   *  it through the same observer. */
  | "detected";

export interface ScreenCircuitStatus {
  /** Is the switch on? */
  on: boolean;
  /** How the navigation container was found, if it was, and which of the two
   *  hand-offs is the one reporting screens. */
  navigator: { seam: NavDetectSeam; found: boolean; source: NavigatorSource };
  /** Screens turned into nodes. */
  screens: number;
  /** Calls hung off a screen. */
  calls: number;
  /** Screen names refused for their shape — counted, because a screen missing
   *  from the map with nothing saying why is the fault this work removed. */
  refusedNames: number;
  /** Calls that arrived with no screen open. Counted, never invented: a call
   *  with no screen is not a call from the last screen we happened to see. */
  callsWithoutScreen: number;
  /** Spans this kit declined to emit because the journey was full. */
  overJourneyCap: number;
  /** Journeys started. */
  journeys: number;
  /** What the kit will do with the trace headers, in one line. */
  propagation: string;
}

/* ─── The observer, without a cycle ─────────────────────────────────────── */

/** What the circuit needs from the navigation observer to use a container it
 *  found for itself. */
export interface CircuitNavigatorAttach {
  /** Is something the app mounted already reporting screen changes? */
  isActive: () => boolean;
  /** Subscribe to this container; hands back the release. */
  attach: (container: unknown) => () => void;
  /** The screen that observer last reported, if it has reported one. An
   *  observer that attached BEFORE the switch was thrown announced the screen
   *  on display once, to nobody, and will not say it again until the finger
   *  moves — so the circuit asks. */
  currentScreen?: () => string | null;
}

/**
 * The observer hands itself in at load.
 *
 * It has to be this way round. The observer already imports this module (every
 * screen change it sees is fed to the circuit), so naming it at the top of
 * this file would close a cycle in the graph the kit ships — and a `require`
 * inside a function, which is the usual way out, does not exist in every
 * environment this code is loaded in.
 */
let navigatorAttach: CircuitNavigatorAttach | null = null;

export function setCircuitNavigatorAttach(
  attach: CircuitNavigatorAttach | null,
): void {
  navigatorAttach = attach;
}

/** Read the screen a container is showing right now and open it, if it can be
 *  read at all. Duck-typed through a React ref, exactly as the observer reads
 *  the same object — and silent when it cannot be read. */
function seedCurrentScreen(container: unknown): void {
  try {
    let target = container as Record<string, unknown> | null;
    if (target && typeof target === "object" && "current" in target) {
      target = (target as { current: Record<string, unknown> | null }).current;
    }
    const read = target?.getCurrentRoute;
    if (typeof read !== "function") return;
    const route = (read as () => { name?: unknown } | undefined).call(target);
    const name = route?.name;
    if (typeof name === "string") noteCircuitScreen(name);
  } catch {
    // A getter that throws is an unfamiliar router, not a crash.
  }
}

/**
 * Take up an observer the app mounted BEFORE the switch was thrown.
 *
 * This is the ordinary wiring, not an edge case: an app that mounts the
 * observer in its tree and calls enableTelemetry() from an effect has both
 * already happened by the time the circuit starts. That observer announced
 * the screen on display once, to nobody, and will not say it again until the
 * finger moves — and nothing new will be registered for detection to find.
 * Left alone, the status would say nothing answered, the first screen of the
 * journey would be missing, every call made on it would be counted as having
 * no screen, and the SECOND screen would look like the root.
 */
function adoptActiveObserver(): boolean {
  try {
    const observer = navigatorAttach;
    if (!observer || !observer.isActive()) return false;
    navigatorSource = "explicit";
    containerFound = true;
    seam = "handed-over";
    const name = observer.currentScreen?.() ?? null;
    if (typeof name === "string") noteCircuitScreen(name);
    return true;
  } catch {
    // An observer that cannot answer is one the circuit does not use.
    return false;
  }
}

/* ─── State ─────────────────────────────────────────────────────────────── */

let on = false;
/**
 * Held down by `disableTelemetry()` while the developer's configuration still
 * asks for the circuit.
 *
 * Separate from `on` because the two answer different questions: `on` is what
 * the setup ASKED for, and this is whether the app is currently allowed to
 * act on it. Keeping them apart is what lets a disable→enable cycle put the
 * circuit back exactly as configured, the way it already does for the
 * optional perf samples — and what stops a `disable()` from leaving spans,
 * URL reads and trace headers running on a switch the developer believes
 * they have just turned off.
 */
let suppressed = false;

/** May the circuit act right now — asked for, not held down, not killed. */
function active(): boolean {
  return on && !suppressed && !isBoosthisDisabled();
}
let seam: NavDetectSeam = "none";
let containerFound = false;
let navigatorSource: NavigatorSource = "none";
let stopDetect: (() => void) | null = null;
let detachDetected: (() => void) | null = null;

/** @internal One trace's worth of work. Exported only so a dispatch context
 *  can name the journey a request belongs to. */
export interface Journey {
  traceId: string;
  startedAt: number;
  /** Rows counted against the server's per-trace cap — INCLUDING the row a
   *  screen reserves the moment it opens. */
  spans: number;
}

/** @internal The screen the app is on. Exported only for the dispatch
 *  context; nothing outside this module reads its fields. */
export interface OpenScreen {
  name: string;
  label: string;
  spanId: string;
  parentSpanId: string | null;
  arrivedAt: number;
  startOffsetMs: number;
  emitted: boolean;
  inFlight: number;
  settleTimer: ReturnType<typeof setTimeout> | null;
  /** The journey this screen belongs to, held so a screen that closes after
   *  the journey rolled over still writes to the trace it was opened in. */
  journey: Journey;
}

let journey: Journey | null = null;
let screen: OpenScreen | null = null;
let previousScreenSpanId: string | null = null;
/** The screen the app was on when it went away, kept so coming back reopens
 *  that node rather than hanging later calls off a journey that has ended.
 *  A return to the SAME route raises no navigation event, so nothing else
 *  would ever say the app is there again. */
let resumeName: string | null = null;

let screens = 0;
let calls = 0;
let refusedNames = 0;
let callsWithoutScreen = 0;
let overJourneyCap = 0;
let journeys = 0;

function nowMs(): number {
  return Date.now();
}

function clampOffset(ms: number): number {
  return Math.max(0, Math.min(MAX_TRACE_ELAPSED_MS, Math.round(ms)));
}

/** Emit one span against the journey it belongs to — which is the journey the
 *  work STARTED in, never whichever one happens to be current when it
 *  finishes. */
function emitOn(j: Journey, span: TraceSpan): void {
  if (j.spans >= MAX_SPANS_PER_JOURNEY) {
    overJourneyCap += 1;
    return;
  }
  j.spans += 1;
  enqueueSpan(span);
}

/** Start a fresh journey, rooted now. */
function openJourney(at: number): void {
  journey = { traceId: newTraceId(), startedAt: at, spans: 0 };
  previousScreenSpanId = null;
  journeys += 1;
}

/** Should the journey in hand carry the screen about to open? */
function journeyStillGood(at: number): boolean {
  if (journey === null) return false;
  if (at - journey.startedAt >= MAX_TRACE_ELAPSED_MS) return false;
  // Keep two rows spare: the screen about to open, and at least one call
  // under it. A journey whose last row is a screen with nothing beneath it
  // draws a node with no edges, which is the least useful thing we can send.
  return journey.spans + 2 <= MAX_SPANS_PER_JOURNEY;
}

/** Emit the open screen's own span, once. Called when the screen settles, or
 *  when the app leaves it — whichever happens first. The calls made under it
 *  keep pointing at the same span id either way, because a span's children do
 *  not have to arrive after it. */
function closeScreen(at: number): void {
  const s = screen;
  if (!s || s.emitted) return;
  s.emitted = true;
  if (s.settleTimer) {
    clearTimeout(s.settleTimer);
    s.settleTimer = null;
  }
  const durationMs = Math.max(0, at - s.arrivedAt);
  // No cap check and no increment: the screen's row was RESERVED when it
  // opened. A node whose children filled the journey while it was still
  // settling would be dropped here, and every call under it would point at a
  // parent that never arrived — a circuit of orphans is worse than no circuit.
  enqueueSpan({
    traceId: s.journey.traceId,
    layer: "rn",
    routeLabel: s.label,
    durationMs,
    startOffsetMs: s.startOffsetMs,
    rating: rateSpanDuration(durationMs),
    spanId: s.spanId,
    parentSpanId: s.parentSpanId,
    // A screen is the containing unit of work — the app's own code answering
    // an arrival. `ok` because the screen was reached: whether the calls under
    // it worked is each call's own outcome, and rolling them up here would
    // make one failed image request read as a broken screen.
    kind: "handler",
    outcome: "ok",
  });
  screens += 1;
}

function armSettle(s: OpenScreen): void {
  if (s.settleTimer) clearTimeout(s.settleTimer);
  const sinceArrival = nowMs() - s.arrivedAt;
  const remaining = Math.max(0, SCREEN_SETTLE_MAX_MS - sinceArrival);
  const wait = Math.min(SCREEN_SETTLE_IDLE_MS, remaining);
  const timer = setTimeout(() => {
    try {
      if (screen === s && !s.emitted) {
        if (s.inFlight > 0 && nowMs() - s.arrivedAt < SCREEN_SETTLE_MAX_MS) {
          // Still working. A screen is settled when it stops asking for
          // things, not when a fixed clock runs out.
          armSettle(s);
          return;
        }
        closeScreen(nowMs());
      }
    } catch {
      // never break the host
    }
  }, wait);
  // Never hold the app open waiting for a measurement to settle.
  (timer as unknown as { unref?: () => void }).unref?.();
  s.settleTimer = timer;
}

/* ─── The screen-change signal ──────────────────────────────────────────── */

/**
 * One screen change, from the signal the kit already raises for its own map.
 *
 * Every navigation path the kit supports arrives here: the mounted observer
 * subscribed to a React Navigation container, the route value an Expo Router
 * app feeds in, and the container this kit found for itself. The circuit does
 * not care which — it cares that the app moved.
 *
 * Never throws.
 */
export function noteCircuitScreen(
  name: unknown,
  source: ScreenNameSource = "route-name",
): void {
  try {
    if (!active()) return;
    if (typeof name !== "string") return;
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    const label = SCREEN_LABEL_PREFIX + trimmed;
    // An ADDRESS rather than a name: either the source says so, or it is
    // written like one. A leading slash is the belt on the braces — whatever
    // fed it in, `/profile/sarah` is where the app IS, not what the developer
    // called the screen, and the disclosure promises only the latter travels.
    const address =
      trimmed.startsWith("/") ||
      (source === "resolved-path" && trimmed.includes("/"));
    if (
      label.length > MAX_PART_NAME ||
      !SCREEN_NAME_RE.test(trimmed) ||
      (address && !addressIsRouteVocabulary(trimmed)) ||
      // The shape is not the whole rule. The last gate before an upload
      // screens the VALUES a shape cannot see — an email, a token, a real
      // id sitting in a screen name — and it runs on the server too. A node
      // either of them would drop may never be opened: its calls would be
      // sent naming a parent that never arrives, which is a hole in the map
      // with nothing saying why. Refuse it here, once, and count it.
      transmitLabelHasPII(label) !== null
    ) {
      refusedNames += 1;
      return;
    }
    if (screen !== null && screen.name === trimmed) return;

    const at = nowMs();
    closeScreen(at);
    const leaving = screen;
    if (leaving) previousScreenSpanId = leaving.spanId;

    if (!journeyStillGood(at)) openJourney(at);

    const j = journey!;
    const next: OpenScreen = {
      name: trimmed,
      label,
      spanId: newSpanId(),
      // The edge. A screen's parent is the screen the app came FROM, which is
      // what makes a run of screens a path rather than a pile of nodes.
      parentSpanId: previousScreenSpanId,
      arrivedAt: at,
      startOffsetMs: clampOffset(at - j.startedAt),
      emitted: false,
      inFlight: 0,
      settleTimer: null,
      journey: j,
    };
    // Reserve the node's row now, before any call under it can spend one. A
    // screen is only settled later, and the parent of everything beneath it
    // may not be the row the cap refuses.
    j.spans += 1;
    screen = next;
    armSettle(next);
  } catch {
    // never break the host
  }
}

/* ─── Calls ─────────────────────────────────────────────────────────────── */

/**
 * Where a request was dispatched FROM, taken at dispatch and never re-read.
 *
 * A call started on Home that lands after the app moved to Details is Home's
 * call: reading the current screen when the promise settles would parent it to
 * wherever the finger got to, and after a journey rolls over it would parent
 * it into a different trace entirely.
 */
export interface CircuitCallContext {
  /** @internal */ readonly journey: Journey;
  /** @internal */ readonly screen: OpenScreen;
}

/**
 * A request is about to go out. Hands back the screen and journey it belongs
 * to — or null when the circuit is off or no screen is open — and keeps the
 * screen from being called settled while it is still fetching what it needs.
 */
export function noteCircuitCallStarted(): CircuitCallContext | null {
  try {
    if (!active()) return null;
    // A call dispatched after the app came back, on a host that never told us
    // it had: the screen this request is being made from is the one the app
    // left, so reopen it rather than counting the call as having no screen.
    if (screen === null && resumeName !== null) resumeCircuitScreen();
    const s = screen;
    if (!s) return null;
    s.inFlight += 1;
    armSettle(s);
    return { journey: s.journey, screen: s };
  } catch {
    return null;
  }
}

export interface CircuitCall {
  method: string;
  url: string;
  /** Wall-clock start, in the same `Date.now()` domain as everything here. */
  startedAt: number;
  /** Wall-clock settle. */
  settledAt: number;
  /** The status the call answered with, if the transport gave us one. */
  status?: number | null;
  /** True when the call never got an answer at all. */
  threw?: boolean;
}

/**
 * One completed request, hung off the screen it was made from.
 *
 * Called from exactly the place the Network axis is told about the same
 * attempt, which is what makes "one request, one span" true through every
 * layer the wrapper may be stacked in: the layer that reports is the layer
 * that counts, and the kit's own uploads are stood down on before either.
 *
 * Never throws.
 */
export function noteCircuitCall(
  call: CircuitCall,
  from: CircuitCallContext | null,
): void {
  try {
    if (!active()) return;
    const s = from?.screen ?? null;
    if (s) {
      s.inFlight = Math.max(0, s.inFlight - 1);
      // Only the screen still on display has a settle timer worth re-arming;
      // one the app has already left is closed and done.
      if (s === screen) armSettle(s);
    }
    if (!from || !s) {
      // A call dispatched with no screen open is not a call from whichever
      // screen we saw last. It is counted and left out.
      callsWithoutScreen += 1;
      return;
    }
    const j = from.journey;
    const label = spanLabel(call.method, call.url);
    if (label === null) return;
    const durationMs = Math.max(0, call.settledAt - call.startedAt);
    emitOn(j, {
      traceId: j.traceId,
      layer: "rn",
      routeLabel: label,
      durationMs,
      startOffsetMs: clampOffset(call.startedAt - j.startedAt),
      rating: rateSpanDuration(durationMs),
      spanId: newSpanId(),
      parentSpanId: s.spanId,
      kind: "http",
      outcome: outcomeForStatus(call.status ?? null, call.threw === true),
    });
    calls += 1;
  } catch {
    // never break the host
  }
}

/* ─── Propagation ───────────────────────────────────────────────────────── */

/**
 * The trace headers for a request about to go out, or null.
 *
 * Null for every destination the developer did not name, and null when the
 * switch is off — and null means the request goes out byte-identical to the
 * one the app wrote.
 */
export function circuitTraceHeaders(
  url: unknown,
  from?: CircuitCallContext | null,
): Array<[string, string]> | null {
  try {
    if (!active()) return null;
    // The dispatch context when the caller has one: the headers a request
    // carries must name the same parent the span will be filed under.
    const s = from?.screen ?? screen;
    const j = from?.journey ?? journey;
    if (!s || j === null) return null;
    if (!shouldPropagateToUrl(url)) return null;
    return [
      [TRACE_HEADER, j.traceId],
      [PARENT_HEADER, s.spanId],
      [ELAPSED_HEADER, String(clampOffset(nowMs() - j.startedAt))],
    ];
  } catch {
    return null;
  }
}

/* ─── The switch ────────────────────────────────────────────────────────── */

/**
 * Switch the circuit on.
 *
 * Idempotent, and safe to call before anything navigates: the first screen the
 * app reports opens the first journey.
 */
export function enableScreenCircuit(
  opts: ScreenCircuitOptions | true = true,
): ScreenCircuitStatus {
  const options: ScreenCircuitOptions = opts === true ? {} : opts || {};
  on = true;
  // An explicit ask lifts any hold a previous `disableTelemetry()` left: this
  // call IS the configuration, and it says the circuit is wanted.
  suppressed = false;
  setTracePropagation(options.propagateTo);
  // The app's own observer, if it is already running, answers before any
  // discovery does — and it is the one case discovery cannot reach.
  adoptActiveObserver();
  try {
    stopDetect?.();
    stopDetect = detectNavigationContainer((container, result) => {
      // The app's observer was adopted at the switch. A registration after
      // that is the same navigation it is already reporting, and the status
      // keeps saying how the circuit actually reached the app.
      if (navigatorSource === "explicit") return;
      seam = result.seam;
      containerFound = true;
      try {
        const observer = navigatorAttach;
        if (!observer) return;
        // The app's own hand-off WINS. A mounted observer is already reporting
        // every screen change through the same signal, and a second
        // subscription to the same container would only say it twice.
        if (observer.isActive()) {
          navigatorSource = "explicit";
          // The screen already on display is the journey's entry node. That
          // observer announced it before the circuit was listening and will
          // not say it again until the finger moves, so a run that started
          // on Home would otherwise draw its first edge out of nowhere.
          seedCurrentScreen(container);
          return;
        }
        detachDetected = observer.attach(container);
        navigatorSource = "detected";
      } catch {
        // An app whose navigation library is something we have never seen
        // behaves exactly as it does today, and the status says nothing
        // answered.
      }
    });
  } catch {
    // never break the host
  }
  return getScreenCircuitStatus();
}

/** Switch it off and let go of everything it was holding. */
export function disableScreenCircuit(): void {
  on = false;
  // Nothing is held down once nothing is asked for: a hold that outlived the
  // configuration it was put on would silence the NEXT switch-on.
  suppressed = false;
  try {
    if (screen?.settleTimer) clearTimeout(screen.settleTimer);
  } catch {
    // ignore
  }
  screen = null;
  journey = null;
  previousScreenSpanId = null;
  resumeName = null;
  try {
    stopDetect?.();
  } catch {
    // ignore
  }
  stopDetect = null;
  try {
    // Only our own subscription goes: an observer the app mounted itself is
    // not ours to detach.
    detachDetected?.();
  } catch {
    // ignore
  }
  detachDetected = null;
  stopDetectingNavigationContainer();
  seam = "none";
  containerFound = false;
  navigatorSource = "none";
  resetTracePropagationPolicy();
}

export function isScreenCircuitOn(): boolean {
  return active();
}

/**
 * Hold the circuit down without forgetting it was asked for — what
 * `disableTelemetry()` does, and what `enableTelemetry()` on the same client
 * undoes.
 *
 * Held down, the kit behaves exactly as it does with the switch off: no
 * screen nodes, no call spans, no URL read for a label, and no trace header
 * on any request. The open screen is flushed and its journey ended on the way
 * down, so nothing is left dangling for a resume hours later to adopt.
 */
export function setScreenCircuitSuppressed(down: boolean): void {
  try {
    const next = down === true;
    if (next === suppressed) return;
    suppressed = next;
    // `closeOpenCircuitScreen` reads `on`, not `active()`, precisely so this
    // last flush can still go out as the gate closes.
    if (next) closeOpenCircuitScreen();
  } catch {
    // never break the host
  }
}

/**
 * Flush the screen in hand, so a journey interrupted by the app going away
 * still has its last node — and END the journey with it. Called from the same
 * places the kit already flushes on the way out.
 *
 * Emitting the node is not enough on its own. An app comes back to the screen
 * it left, and a return to a route it never left raises no navigation event,
 * so a kit that only closed the node would hang every later call off a span it
 * has already sent, inside a trace whose clock has been running since before
 * the phone went into a pocket — and the ten-minute elapsed bound would clamp
 * the whole background stretch into it. The journey ends here; the screen's
 * NAME is kept, so the app's return reopens it as the entry node of a fresh
 * one.
 */
export function closeOpenCircuitScreen(): void {
  try {
    if (!on) return;
    const leaving = screen;
    closeScreen(nowMs());
    if (leaving) resumeName = leaving.name;
    screen = null;
    journey = null;
    previousScreenSpanId = null;
  } catch {
    // ignore
  }
}

/**
 * The app came back. Reopen the screen it left on, as the entry node of a
 * fresh journey — the node the navigator would hand us if the finger had
 * moved, which on a return to the same route it never does.
 *
 * Idempotent, and inert while a screen is already open: a return that DID
 * change screen is reported by the navigation signal itself, and that signal
 * is the one that decides what the app is looking at.
 */
export function resumeCircuitScreen(): void {
  try {
    if (!active()) return;
    if (screen !== null) return;
    const name = resumeName;
    if (name === null) return;
    resumeName = null;
    // Through the ordinary signal, so the name is screened, the row reserved
    // and the settle armed by exactly the code a navigation runs.
    noteCircuitScreen(name);
  } catch {
    // ignore
  }
}

/** Who the status SAYS is feeding the circuit.
 *
 * Derived, not stored, for the one case a stored answer gets wrong: an app
 * that feeds route values in by hand (Expo Router, a custom router) has no
 * container to find and hands nothing over, so nothing ever set the field —
 * while screens were arriving the whole time. */
function reportedNavigatorSource(): NavigatorSource {
  if (navigatorSource !== "none") return navigatorSource;
  try {
    return navigatorAttach?.isActive() === true ? "explicit" : "none";
  } catch {
    return "none";
  }
}

export function getScreenCircuitStatus(): ScreenCircuitStatus {
  return {
    on,
    navigator: {
      seam,
      found: containerFound,
      source: reportedNavigatorSource(),
    },
    screens,
    calls,
    refusedNames,
    callsWithoutScreen,
    overJourneyCap,
    journeys,
    propagation: tracePropagationSummary(),
  };
}

/** @internal test hook. */
export const _screenCircuitInternals = {
  currentTraceId: (): string | null => journey?.traceId ?? null,
  currentScreenSpanId: (): string | null => screen?.spanId ?? null,
  spansThisJourney: (): number => journey?.spans ?? 0,
  reset: (): void => {
    disableScreenCircuit();
    screens = 0;
    calls = 0;
    refusedNames = 0;
    callsWithoutScreen = 0;
    overJourneyCap = 0;
    journeys = 0;
  },
};
