/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * Ask the navigator for the whole screen list — phone side.
 *
 * The map can only draw screens somebody has opened. A React Navigation app
 * written with the static API already holds the whole list: the navigator's
 * own configuration names every screen registered on it and every screen
 * inside the navigators nested under it, whether or not anyone has been
 * there. This module asks for that configuration, so the map can show the
 * app's whole shape with the screens nobody has reached marked as not seen.
 *
 * **What a container ref cannot answer.** React Navigation's running state —
 * `getRootState()` — is deliberately NOT used here. Its `routeNames` is the
 * registration list of the navigators that have MOUNTED; a nested navigator
 * nobody has opened yet contributes nothing at all, and there is no way from
 * the outside to tell a plain screen from an unmounted navigator holding ten
 * more. Reading it would produce a list that is sometimes the whole app and
 * sometimes a fraction of it, with nothing to say which — and the page it
 * feeds says "the whole app". So a container ref is answered `unsupported`,
 * and nothing is carried from it.
 *
 * Three rules, the same as every other kit:
 *
 * * **Ask, never read.** This reads the navigator configuration the developer
 *   handed over. It does not read source, walk the app directory, or parse a
 *   bundle.
 * * **Nothing rather than a guess.** A configuration we do not recognise —
 *   and a source that cannot prove it holds the WHOLE tree — loses the whole
 *   read. A half list drawn as a whole map is a lie the reader cannot see.
 * * **A quiet screen is "not seen", never "dead".** Nothing here judges a
 *   screen for being unvisited.
 *
 * The labels are bare screen NAMES ("Home", "OrderDetail") — the same strings
 * this kit files its screen rows under — because the map joins the two by
 * label. They are deliberately not paths: a route list written in a
 * vocabulary the rows do not share would join with nothing.
 */

import { getRegisteredNavigationMap } from "./circuitMap";
import {
  MAX_PART_NAME,
  safeScreenName,
  warnPartNameRefusal,
  _resetPartNameWarningsForTests,
} from "./partName";

/**
 * The one rule for what a part of the app is called lives in a LEAF module
 * (`partName.ts`), because both halves of this kit need it: the screen a
 * timing is filed under and the screens this list records. Holding it here
 * made the page map import the inventory, which closed a require cycle
 * Metro prints in the customer's own build output. Re-exported so nothing
 * that already took it from this module had to change.
 */
export {
  MAX_PART_NAME,
  safeScreenName,
  warnPartNameRefusal,
  _resetPartNameWarningsForTests,
};

/** Navigator families this kit can ask. The server holds the same closed
 *  list; a name added here and not there is refused on arrival. */
export const RN_ROUTE_SOURCE_WORDS = ["react-navigation"] as const;
export type RNRouteSource = (typeof RN_ROUTE_SOURCE_WORDS)[number];

/** How many entries may travel. A larger app still reports its `total`, so a
 *  reader says "at least this many" rather than believing the cap. */
export const MAX_ROUTE_LIST_ENTRIES = 200;

export type RouteListStatus = "read" | "unsupported" | "unreadable" | "off";
export type RouteListOrigin = "framework" | "declared" | "both";

export interface RouteListEntry {
  label: string;
  from: RouteListOrigin;
}

export interface RouteListReport {
  status: RouteListStatus;
  source?: RNRouteSource;
  entries: RouteListEntry[];
  /** How many the merge held BEFORE the cap. */
  total: number;
}

export interface NavigatorRead {
  status: Exclude<RouteListStatus, "off">;
  source?: RNRouteSource;
  labels: string[];
}

let navigatorHandle: unknown = null;
let enabled = true;

/**
 * Hand the kit your navigator's own screen configuration so it can list the
 * app's screens itself.
 *
 * A reference assignment and nothing else — nothing is walked here, so this
 * costs the app nothing at start-up and never sits in front of the first
 * screen. The walk happens when a snapshot asks for one.
 *
 * What answers: anything carrying a `screens` map — React Navigation's static
 * API navigator, or a linking configuration.
 *
 * ```tsx
 * const RootStack = createNativeStackNavigator({
 *   screens: { Home: HomeScreen, Orders: { screen: OrdersScreen } },
 * });
 * registerNavigator(RootStack);          // or registerNavigator(linking.config)
 * ```
 *
 * A `useNavigationContainerRef()` container ref is accepted without error but
 * answers `unsupported`: its running state can only show the navigators that
 * have already mounted, and a list that is sometimes whole and sometimes a
 * fraction cannot be drawn as an app's route table. Dynamic-API apps declare
 * their screens with `registerNavigationMap()` instead, which is carried as
 * declared rather than read.
 */
export function registerNavigator(ref: unknown): void {
  try {
    navigatorHandle = ref ?? null;
  } catch {
    // a hand-off must never break the host app
  }
}

/** Switch the whole screen list off. Switched off, the block still travels
 *  saying `off`, so the server can tell a developer who turned it off from a
 *  kit too old to have it. */
export function setRouteListEnabled(on: boolean): void {
  enabled = on !== false;
}

export function routeListEnabled(): boolean {
  return enabled;
}

export function _resetRouteInventoryForTests(): void {
  navigatorHandle = null;
  enabled = true;
  _resetPartNameWarningsForTests();
}

// ── Labels ───────────────────────────────────────────────────────────────────


// ── Reading a navigator ──────────────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return (typeof v === "object" || typeof v === "function") && v !== null;
}

/**
 * Read every screen a handed-over navigator configuration registers.
 *
 * `read`        — a configuration that names the WHOLE registered tree.
 * `unsupported` — nothing here could be asked, or the only thing on offer is
 *                 a container ref, whose running state cannot prove it holds
 *                 every registered screen.
 * `unreadable`  — a configuration we recognised, in a shape we did not.
 */
export function readNavigatorRoutes(ref: unknown): NavigatorRead {
  if (ref === null || ref === undefined) {
    return { status: "unsupported", labels: [] };
  }
  try {
    if (!isObj(ref)) return { status: "unsupported", labels: [] };
    const screens = screensMapOf(ref);
    if (screens === undefined) {
      // A container ref is a real navigator and still cannot answer this
      // question: see the note at the top of this file. Answered as "cannot
      // be asked" rather than "unreadable", because nothing is broken and
      // no version change will fix it.
      return { status: "unsupported", labels: [] };
    }
    if (!isObj(screens) || Array.isArray(screens)) {
      return { status: "unreadable", source: "react-navigation", labels: [] };
    }
    const labels: string[] = [];
    if (!walkScreenConfig(screens, labels, 0)) {
      return { status: "unreadable", source: "react-navigation", labels: [] };
    }
    return { status: "read", source: "react-navigation", labels };
  } catch {
    // Never into the host app.
    return { status: "unreadable", labels: [] };
  }
}

/**
 * Every word the app's OWN route vocabulary is written in: each segment of
 * every screen name the navigator configuration registers, plus every screen
 * the developer declared through `registerNavigationMap`.
 *
 * This is a SCREEN, not a report. It exists so a route value fed in by hand
 * can be checked against names the developer wrote before any of it travels,
 * and nothing derived from it is ever uploaded — which is why it deliberately
 * ignores `routeListEnabled()`. Switching the screen LIST off says "do not
 * send my route table"; it cannot mean "stop checking what you do send".
 *
 * Lower-cased, because a match here decides whether a label is allowed to
 * travel and `Orders` and `orders` are the same word for that question.
 */
export function knownRouteSegments(): ReadonlySet<string> {
  const out = new Set<string>();
  const add = (label: string): void => {
    for (const raw of label.split("/")) {
      const seg = raw.trim();
      if (seg.length > 0) out.add(seg.toLowerCase());
    }
  };
  try {
    for (const label of readNavigatorRoutes(navigatorHandle).labels) add(label);
  } catch {
    // A navigator we cannot read contributes nothing, and refusing is the
    // safe direction here.
  }
  try {
    for (const raw of getRegisteredNavigationMap() ?? []) {
      const label = safeScreenName(raw);
      if (label) add(label);
    }
  } catch {
    // same
  }
  return out;
}

/**
 * Find the screen map on whatever was handed over.
 *
 * `undefined` means there is no configuration here to read — which includes
 * a container ref, deliberately. A `screens` present but not an object is
 * returned as-is so the caller can call it unreadable rather than silently
 * treating a wrong-shaped configuration as an absent one.
 */
function screensMapOf(handle: Record<string, unknown>): unknown {
  if ("screens" in handle) return handle.screens;
  const config = handle.config;
  if (isObj(config) && "screens" in config) return config.screens;
  return undefined;
}

/**
 * Walk a static screen map and every navigator nested inside it.
 *
 * The KEYS are the registered screen names — every screen the navigator
 * knows, including the ones nobody has opened, which is exactly what this
 * feature exists to read. A value is walked only to reach the screens nested
 * under it; what the value IS (a component, a path string, a descriptor) is
 * the developer's business, and only a value shaped like nothing React
 * Navigation accepts loses the read.
 */
function walkScreenConfig(
  screens: Record<string, unknown>,
  out: string[],
  depth: number,
): boolean {
  if (depth > 10) return false;
  for (const name of Object.keys(screens)) {
    const label = safeScreenName(name);
    if (label && !out.includes(label)) out.push(label);
    const value = screens[name];
    // A component (function or class), a linking path, or "nothing declared
    // here" are all leaves. React Navigation accepts each of them.
    if (
      value === null ||
      value === undefined ||
      typeof value === "function" ||
      typeof value === "string"
    ) {
      continue;
    }
    if (!isObj(value)) return false;
    const nested = screensMapOf(value as Record<string, unknown>);
    if (nested === undefined) continue;
    if (!isObj(nested) || Array.isArray(nested)) return false;
    if (!walkScreenConfig(nested, out, depth + 1)) return false;
  }
  return true;
}

// ── The merged answer ────────────────────────────────────────────────────────

/**
 * The whole screen list: what the navigator said, merged with what the
 * developer declared through `registerNavigationMap`, each entry saying where
 * it came from. Neither list overwrites the other — a screen in both is
 * marked `both`.
 */
export function routeListReport(
  declared: readonly string[] | null = getRegisteredNavigationMap(),
): RouteListReport {
  if (!routeListEnabled()) return { status: "off", entries: [], total: 0 };
  const read = readNavigatorRoutes(navigatorHandle);
  const origin = new Map<string, RouteListOrigin>();
  for (const label of read.labels) {
    if (!origin.has(label)) origin.set(label, "framework");
  }
  for (const raw of declared ?? []) {
    const label = safeScreenName(raw);
    if (!label) continue;
    origin.set(label, origin.has(label) ? "both" : "declared");
  }
  const all = [...origin.keys()].sort();
  const entries = all
    .slice(0, MAX_ROUTE_LIST_ENTRIES)
    .map((label) => ({ label, from: origin.get(label) as RouteListOrigin }));
  const report: RouteListReport = {
    status: read.status,
    entries,
    total: all.length,
  };
  if (read.source) report.source = read.source;
  return report;
}

/**
 * The block a snapshot carries.
 *
 * A kit that HAS this feature always says something, even when the answer is
 * "nothing was handed over": that is `unsupported`, an answer the page can
 * word. Carrying nothing at all is reserved for a kit too old to know the
 * question — which is a different fact, and the only way the server can tell
 * the two apart. The single exception is a throw, where the honest answer is
 * that this kit could not produce a block at all.
 */
export function routeListForSnapshot(): RouteListReport | undefined {
  try {
    return routeListReport(getRegisteredNavigationMap());
  } catch {
    return undefined;
  }
}
