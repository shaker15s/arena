/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: the root navigation observer (on-device) ───────────────
 *
 * One opt-in mount point at the app root makes every screen change name
 * itself and produce an edge, with no change to any individual screen and no
 * `beginNav(from, to)` call.
 *
 * It has NO dependency on any navigation library. The host hands it whatever
 * it already has, and the observer recognises the shape:
 *
 *   React Navigation   a container (or a ref to one) exposing
 *                      `addListener("state", …)` + `getCurrentRoute()`.
 *   expo-router / any  a plain route string (a custom router's current
 *                      route) fed in as it changes.
 *   anything else      recognised as UNFAMILIAR and ignored — the app keeps
 *                      behaving exactly as it does today.
 *
 * Everything it touches is wrapped: an unfamiliar router, a container that
 * throws from `getCurrentRoute()`, or a listener that refuses to attach all
 * degrade to today's behaviour. The kit stays a guest that can never break
 * the host.
 *
 * WHAT A SCREEN CHANGE PRODUCES: the on-device screen map (`pageMap.ts`,
 * read by the in-app panel and by nothing else) AND one per-screen reading,
 * started here and completed when the screen is actually up
 * (`screenAutoReading.ts`). That reading is the same measurement
 * `useBoosthis()` has always produced, under the same screen name, and a
 * screen measured by hand is left to the hand-placed call rather than
 * measured twice. A screen name that may not travel is refused, never
 * replaced with a stand-in.
 * ───────────────────────────────────────────────────────────────────────── */

import { hydrateScreenMap, noteScreen } from "./pageMap";
import { armScreenReading } from "./screenAutoReading";
import {
  noteCircuitScreen,
  setCircuitNavigatorAttach,
} from "./screenCircuit";
// The press-to-screen reading is TOLD what this observer found, rather than
// reading it back: that module owns the join and is imported by this one, so
// an import in the other direction would close a cycle.
import { noteNavWiring } from "./navDeadTime";

/** What kind of router the observer managed to recognise. */
export type NavRouterKind =
  /** Nothing has been attached yet — the integration is not present. */
  | "not-mounted"
  /** A React Navigation container (or ref) the observer subscribed to. */
  | "react-navigation"
  /** Route strings fed in directly (expo-router, a custom router). */
  | "path-source"
  /** Something was handed over that the observer does not know how to read. */
  | "unfamiliar";

export interface NavObserverStatus {
  /** Is the root integration currently attached? */
  attached: boolean;
  /** Which router the observer recognised. */
  router: NavRouterKind;
  /** Screen changes this observer has recorded since it attached. */
  observedChanges: number;
}

let router: NavRouterKind = "not-mounted";

/**
 * The ONE place the router kind changes, so the press-to-screen reading
 * hears about it every time. A reading that can never be taken here has to
 * be able to say WHY, and the only module that knows why is this one.
 */
function setRouter(kind: NavRouterKind): void {
  router = kind;
  try {
    noteNavWiring(
      kind === "not-mounted"
        ? "none"
        : kind === "unfamiliar"
          ? "unrecognised"
          : "followed",
    );
  } catch {
    /* best-effort */
  }
}
/** A container subscription is live. */
let containerLive = false;
/** How many mounted route-value sources are live (one per mounted
 *  integration, so one unmounting never silences another). */
let routeSources = 0;
/** A route value was fed in by hand, with no mount to release it — the host
 *  is driving the map itself, so nothing can say when it stops. */
let looseValues = false;
let observedChanges = 0;
/** The last screen this observer reported. Kept so the circuit, switched on
 *  after the observer was already running, can open the screen the app is on
 *  instead of waiting for the next move. */
let lastScreenName: string | null = null;
let detach: (() => void) | null = null;
/** The container currently subscribed to, so the same one is never subscribed
 *  to twice — the kit can find a container for itself now, and an app that
 *  ALSO mounts the observer over the same container would otherwise have
 *  every screen change counted, read and reported twice. */
let subscribedTo: object | null = null;

/** Is anything actually drawing the map right now? */
function isAttached(): boolean {
  return containerLive || routeSources > 0 || looseValues;
}

/**
 * Say what is STILL drawing the map after something let go.
 *
 * An integration that has unmounted may not leave the status claiming the
 * root observer is running: the panel reads this line to tell a developer
 * whether the map is drawing itself, and a stale `attached` there is a
 * sentence we cannot support.
 */
function settleRouter(): void {
  if (containerLive) {
    setRouter("react-navigation");
  } else if (routeSources > 0 || looseValues) {
    setRouter("path-source");
  } else {
    setRouter("not-mounted");
  }
}

/* ─── Shape recognition (no library import, ever) ────────────────────── */

interface ReactNavigationLike {
  addListener(type: string, cb: () => void): unknown;
  getCurrentRoute(): { name?: unknown } | undefined;
}

/** Unwrap a React ref, then check for the two methods we actually call. */
function asReactNavigation(candidate: unknown): ReactNavigationLike | null {
  try {
    let target = candidate;
    if (
      target &&
      typeof target === "object" &&
      "current" in (target as Record<string, unknown>)
    ) {
      target = (target as { current: unknown }).current;
    }
    if (!target || typeof target !== "object") return null;
    const obj = target as Record<string, unknown>;
    if (
      typeof obj.addListener === "function" &&
      typeof obj.getCurrentRoute === "function"
    ) {
      return target as unknown as ReactNavigationLike;
    }
  } catch {
    // a getter that throws is an unfamiliar router, not a crash
  }
  return null;
}

/** Read the current screen name, or null when it cannot be read. */
function readCurrentName(nav: ReactNavigationLike): string | null {
  try {
    const route = nav.getCurrentRoute();
    const name = route?.name;
    return typeof name === "string" && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/* ─── Public surface ─────────────────────────────────────────────────── */

/**
 * Feed one screen change in directly. This is the expo-router / custom-router
 * path: the host passes the current route string whenever it changes and the
 * map draws itself from consecutive values.
 *
 * Safe to call from anywhere — it never throws.
 */
export function noteScreenChange(name: string): void {
  try {
    if (typeof name !== "string" || name.trim().length === 0) return;
    if (router === "not-mounted" || router === "unfamiliar") {
      setRouter("path-source");
    }
    // A value with no mount behind it is the host feeding the map by hand:
    // nothing will ever release it, so the status keeps saying so.
    if (routeSources === 0) looseValues = true;
    observedChanges++;
    lastScreenName = name;
    noteScreen(name);
    armScreenReading(name);
    // The circuit hangs off the SAME signal, so every path that tells the kit
    // where the app is — this one, the container subscription below, and an
    // Expo Router app feeding route values in — draws the same nodes and the
    // same edges. Inert unless the developer switched the circuit on.
    //
    // Told WHERE the value came from, because what arrives here may be a
    // resolved address (`usePathname()` hands over `/profile/sarah`, not
    // `profile/[user]`). The on-device screen map has always taken it as it
    // comes; a label that LEAVES the device may not, so the circuit screens
    // an address against the app's own route vocabulary and refuses what it
    // cannot find there.
    noteCircuitScreen(name, "resolved-path");
  } catch {
    // never break the host
  }
}

/**
 * Claim the route-VALUE path for one mounted integration and hand back the
 * release for it.
 *
 * Ownership is per mount and counted, so two mounted observers each hold
 * their own claim and one unmounting never silences the other. Releasing the
 * last claim returns the status to "nothing is drawing the map": a component
 * that has gone may not leave the panel saying the root observer is running.
 *
 * Never throws, and the release is idempotent.
 */
export function attachRouteSource(): () => void {
  try {
    routeSources++;
    if (router === "not-mounted" || router === "unfamiliar") {
      setRouter("path-source");
    }
  } catch {
    // never break the host
  }
  let released = false;
  return () => {
    try {
      if (released) return;
      released = true;
      if (routeSources > 0) routeSources--;
      settleRouter();
    } catch {
      // ignore
    }
  };
}

/**
 * Subscribe to a navigation container so screen changes record themselves.
 *
 * Returns a detach function ALWAYS — including when the container was not
 * recognised, in which case nothing was subscribed and calling it is a no-op.
 * Never throws.
 */
export function attachNavigationObserver(container: unknown): () => void {
  try {
    const nav = asReactNavigation(container);
    if (!nav) {
      // An unfamiliar or missing router is a recognised outcome, not an error:
      // the app behaves exactly as it does today.
      if (router === "not-mounted") setRouter("unfamiliar");
      return () => {};
    }

    // Already listening to this very container: hand back the subscription
    // that exists rather than opening a second one. Whichever caller asked
    // last holds the release, and the app's screen changes are still counted
    // exactly once.
    if (subscribedTo === (nav as unknown as object) && detach) {
      return detach;
    }

    void hydrateScreenMap();

    const onState = (): void => {
      const name = readCurrentName(nav);
      if (name === null) return;
      observedChanges++;
      lastScreenName = name;
      noteScreen(name);
      armScreenReading(name);
      noteCircuitScreen(name);
    };

    let unsubscribe: (() => void) | null = null;
    try {
      const result = nav.addListener("state", onState);
      if (typeof result === "function") unsubscribe = result as () => void;
    } catch {
      // The container refused the listener — treat it as unfamiliar rather
      // than pretending the map is being drawn.
      if (router === "not-mounted") setRouter("unfamiliar");
      return () => {};
    }

    setRouter("react-navigation");
    containerLive = true;
    subscribedTo = nav as unknown as object;

    // The screen already on display when we attached is the map's entry node.
    onState();

    detach = () => {
      try {
        unsubscribe?.();
      } catch {
        // ignore
      }
      containerLive = false;
      subscribedTo = null;
      settleRouter();
      detach = null;
    };
    return detach;
  } catch {
    return () => {};
  }
}

/** Is the root integration present, and what did it recognise? */
export function getNavObserverStatus(): NavObserverStatus {
  return { attached: isAttached(), router, observedChanges };
}

/**
 * True when the root integration is doing the work — the manual
 * `beginNav(from, to)` call is optional in this app. Apps that still call it
 * are unaffected: their edges keep arriving through the event log.
 */
export function isNavObserverActive(): boolean {
  return isAttached() && router !== "unfamiliar" && router !== "not-mounted";
}

// Hand this observer to the circuit, so a container the kit FINDS is
// subscribed to through exactly the same path as one the app hands over — and
// so the app's own hand-off can be seen to win. The wiring goes this way round
// because the import does: this module already names the circuit, and the
// circuit naming it back would be a cycle in a customer's bundle.
setCircuitNavigatorAttach({
  isActive: isNavObserverActive,
  attach: attachNavigationObserver,
  // What screen this observer last saw. The circuit asks at the moment it is
  // switched on, because an observer already running said it once, before
  // anything was listening, and will not say it again until the app moves.
  currentScreen: () => lastScreenName,
});

/** @internal test hook — detach and forget what was recognised. */
export function _resetNavObserverForTests(): void {
  try {
    detach?.();
  } catch {
    // ignore
  }
  detach = null;
  containerLive = false;
  subscribedTo = null;
  routeSources = 0;
  looseValues = false;
  setRouter("not-mounted");
  observedChanges = 0;
  lastScreenName = null;
}
