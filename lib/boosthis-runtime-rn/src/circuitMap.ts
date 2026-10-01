/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: on-device circuit map ──────────────────────────────────
 *
 * A privacy-safe "navigation / interaction integrity" view that runs
 * ENTIRELY on-device and NEVER leaves the process. It reconstructs the
 * app's observed navigation graph from the perfMonitor event log and
 * surfaces three integrity problems no other perf tool names:
 *
 *   1. DEAD-END TAP        (kind: "dead-end-tap")
 *      A control the user pressed that produced nothing observable —
 *      no navigation, no network request, and no render commit within
 *      a short window. Usually a button wired to a no-op handler, a
 *      disabled control that still looks tappable, or a handler that
 *      silently early-returned. Flagged only on REPEAT (≥2× the same
 *      target) so a single deliberate no-op tap is never a finding.
 *
 *   2. ORPHAN SCREEN       (kind: "orphan-screen")
 *      A screen that mounted this session but has NO observed inbound
 *      navigation edge — the user got there, but the map can't explain
 *      how. Often a deep-link-only screen, or a nav push that wasn't
 *      instrumented. The session's entry screen is excluded (it legitimately
 *      has no inbound edge) and we only emit when at least one nav edge
 *      exists (otherwise there is simply no navigation data to reason over).
 *
 * ─────────────────────────────────────────────────────────────────────
 * TWO SOURCES. The graph is drawn from the perfMonitor event log — the
 * screens and edges the developer INSTRUMENTED — merged with the map the
 * root navigation observer draws on its own where the app mounts
 * <BoosthisNavigationObserver> (see navObserver.ts / pageMap.ts). Without
 * that root integration the second source is empty and every answer here is
 * exactly what it has always been.
 *
 *   3. UNREACHABLE REGISTERED SCREEN (kind: "unreachable-screen")
 *      A route the developer declared via registerNavigationMap() that the
 *      map has never recorded being reached — this launch, plus any earlier
 *      launch the device store kept. This is a PENDING/informational note,
 *      NOT a defect claim — a screen can be perfectly reachable and simply
 *      not visited. It only appears when a nav map was explicitly
 *      registered.
 *
 * ─────────────────────────────────────────────────────────────────────
 * PRIVACY: this module is consumed ONLY by the in-app dev UI
 * (CircuitMap in BoosthisEnginePanel). It has its OWN finding types and
 * its OWN rule map, and is deliberately NOT part of CrossCuttingFinding,
 * runNovelDetectors, computeMeterAxes, or SnapshotPayload — so screen and
 * control labels can never be swept into an upload. Nothing here is ever
 * transmitted; the graph is drawn locally for the developer's own eyes.
 * It also never touches the Speed score.
 * ───────────────────────────────────────────────────────────────────── */

import type { PerfEvent } from "./perfMonitor";
import type { RenderCommit } from "./renderProfiler";
import { getObservedGraph, type ObservedGraph } from "./pageMap";
import {
  MAX_PART_NAME,
  safeScreenName,
  warnPartNameRefusal,
} from "./partName";

export type CircuitFindingKind =
  | "dead-end-tap"
  | "orphan-screen"
  | "unreachable-screen"
  | "nav-loop"
  | "fanout-burst";

export interface CircuitFinding {
  kind:  CircuitFindingKind;
  /** On-device label (screen or control name). Never transmitted. */
  name:  string;
  /** Occurrences — dead taps for a target, or mounts for a screen. */
  count: number;
  /** Plain-English explanation shown to the developer. */
  hint:  string;
}

export interface CircuitNode {
  name:       string;
  /** Did we observe this screen this session (mounted or in a nav edge)? */
  reached:    boolean;
  /** Was this route declared via registerNavigationMap()? */
  registered: boolean;
  /** Distinct inbound navigation edges observed. */
  inbound:    number;
  /** Distinct outbound navigation edges observed. */
  outbound:   number;
}

export interface CircuitEdge {
  from:  string;
  to:    string;
  /** Times this edge was traversed this session. */
  count: number;
}

/**
 * A dead-end control, attached to the screen the event log says was showing
 * when it was pressed. `screen: null` means the log CANNOT say (nothing was
 * recorded before that press, or the event ring already dropped it) — that
 * press is never guessed at: it stays in the findings list only.
 * On-device only, like everything else in this module.
 */
export interface CircuitControlSite {
  /** Control label as instrumented (wrapPress / recordPress). */
  control: string;
  /** Screen showing when it was pressed, or null when the log cannot say. */
  screen:  string | null;
  /** Dead-end presses of this control on that screen. */
  count:   number;
}

/**
 * Which findings sit against which screen. Derived ENTIRELY from the findings
 * the detectors above already emit (plus the event log, for the two kinds
 * whose label is not itself a screen name) — no new detector, no new claim.
 */
export interface CircuitScreenFindings {
  screen: string;
  /** Deduped, in CircuitFindingKind declaration order. */
  kinds:  CircuitFindingKind[];
}

export interface CircuitMapReport {
  nodes:    CircuitNode[];
  edges:    CircuitEdge[];
  findings: CircuitFinding[];
  /** Dead-end presses split by the screen they happened on (or unattributed). */
  controls: CircuitControlSite[];
  /** Findings attached to a screen, so the drawn map can mark the node. */
  screenFindings: CircuitScreenFindings[];
}

/**
 * Local finding-kind → checklist rule map. Deliberately SEPARATE from the
 * panel's DETECTOR_RULE_MAP (which is keyed on transmitted finding kinds)
 * because circuit-map kinds are on-device-only. Both orphan and unreachable
 * screens point at the "unreachable-screen" rule (same class of problem:
 * a screen the map can't connect); dead-end taps get their own rule.
 */
export const CIRCUIT_RULE_MAP: Record<
  CircuitFindingKind,
  { ruleId: string; language: string }
> = {
  "dead-end-tap":       { ruleId: "dead-end-tap",            language: "react-native" },
  "orphan-screen":      { ruleId: "unreachable-screen",      language: "react-native" },
  "unreachable-screen": { ruleId: "unreachable-screen",      language: "react-native" },
  "nav-loop":           { ruleId: "rn-nav-loop-oscillation", language: "react-native" },
  "fanout-burst":       { ruleId: "rn-fanout-overload",      language: "react-native" },
};

/* ─── Optional registered navigation map (module-level registry) ─────────
 * Mirrors the setSnapshotSubmitter registry pattern: a single module-level
 * slot the host can populate once at boot. This module's own detectors read
 * it, and so does routeInventory.ts: the declared names are merged with
 * whatever a handed-over navigator reports and ride the snapshot's
 * `routeList` block, so the project page can show screens this session never
 * opened. The map's FINDINGS, edges, controls and per-screen attribution
 * stay on-device; only the screen NAMES travel, PII-screened, and
 * `setRouteListEnabled(false)` stops even those. */

let registeredRoutes: readonly string[] | null = null;

/**
 * Declare the app's known routes so the circuit map can flag routes that
 * were registered but never recorded as reached. Purely optional — without
 * it the "unreachable registered screen" note simply never appears.
 * Route names stay on-device (this registry is never read by any upload path).
 */
export function registerNavigationMap(routes: string[]): void {
  if (!Array.isArray(routes)) return;
  const cleaned: string[] = [];
  for (const raw of routes) {
    if (typeof raw !== "string") continue;
    const label = safeScreenName(raw);
    if (label !== null) cleaned.push(label);
    else warnPartNameRefusal(raw.trim().length > MAX_PART_NAME ? "too-long" : "invalid");
  }
  registeredRoutes = cleaned.length > 0 ? Array.from(new Set(cleaned)) : null;
}

/** Current registered routes, or null if none declared. */
export function getRegisteredNavigationMap(): readonly string[] | null {
  return registeredRoutes;
}

/** Test-only: clear the registered nav map between cases. */
export function _resetNavigationMapForTests(): void {
  registeredRoutes = null;
}

/* ─── Constants ──────────────────────────────────────────────────────── */

/** Window after a tap in which SOMETHING (nav/api/render) must happen for
 *  the tap to count as "did something". Empirically generous. */
const DEAD_END_WINDOW_MS = 700;
/** Small grace before the recorded press ts to absorb ordering jitter
 *  (a nav/api can start a hair before recordPress lands). */
const DEAD_END_GRACE_MS = 50;
/** Repeat threshold: a target must dead-end at least this many times to be
 *  flagged, so one deliberate no-op tap is never a finding. */
const DEAD_END_MIN_REPEAT = 2;

/** Nav-loop: minimum CONSECUTIVE alternating A⇄B edges before the bounce is
 *  flagged (A→B, B→A, A→B, B→A = 4). Below this it's just normal back-and-
 *  forth browsing. */
const NAV_LOOP_MIN_BOUNCES = 4;

/** Separator in a nav-loop finding's name (`A ⇄ B`). One constant so the
 *  builder below and the screen attribution that parses it back cannot drift. */
const NAV_LOOP_SEP = " ⇄ ";

/** Fan-out burst: how many API request STARTS inside one window flags a
 *  burst. Byte-parity with the server runtimes' circuit summary (6 in 1s). */
const FANOUT_WINDOW_MS = 1_000;
const FANOUT_MIN_STARTS = 6;

/* ─── Edge parsing ───────────────────────────────────────────────────── */

/** perfMonitor records nav events as `${from}→${to}`. Parse that back. */
export function parseNavEdge(name: string): { from: string; to: string } | null {
  const i = name.indexOf("→");
  if (i <= 0 || i >= name.length - 1) return null;
  const from = name.slice(0, i).trim();
  const to = name.slice(i + 1).trim();
  if (!from || !to) return null;
  return { from, to };
}

/* ─── Detector: dead-end taps ────────────────────────────────────────── */

/**
 * The individual presses that produced nothing observable, in log order.
 * Shared by the finding above (which groups them by control and applies the
 * repeat gate) and by the screen attribution below (which needs the press
 * TIMES, so a dead end can be attached to the screen it happened on). One
 * decision, one place — the two can never disagree about what is dead.
 */
function deadEndPresses(
  events: PerfEvent[],
  renderCommits: RenderCommit[],
): PerfEvent[] {
  if (renderCommits.length === 0) return []; // can't tell — suppress
  const presses = events.filter((e) => e.kind === "press");
  if (presses.length === 0) return [];

  // Start-times of "something happened" signals.
  const navStarts = events
    .filter((e) => e.kind === "nav")
    .map((e) => e.ts - e.durationMs);
  const apiStarts = events
    .filter((e) => e.kind === "api")
    .map((e) => e.ts - e.durationMs);
  const renderTimes = renderCommits.map((c) => c.ts);

  const inWindow = (times: number[], lo: number, hi: number): boolean =>
    times.some((t) => t >= lo && t <= hi);

  return presses.filter((p) => {
    const lo = p.ts - DEAD_END_GRACE_MS;
    const hi = p.ts + DEAD_END_WINDOW_MS;
    return !(
      inWindow(navStarts, lo, hi) ||
      inWindow(apiStarts, lo, hi) ||
      inWindow(renderTimes, lo, hi)
    );
  });
}

/**
 * A press whose tap produced no navigation, no API request, and no render
 * commit within DEAD_END_WINDOW_MS. Requires render commits to exist at all
 * (dev-only posture, exactly like the render-storm detector): if render
 * profiling isn't active we cannot distinguish "nothing rendered" from
 * "we weren't watching", so we suppress rather than false-alarm.
 */
export function detectDeadEndTaps(
  events: PerfEvent[],
  renderCommits: RenderCommit[] = [],
): CircuitFinding[] {
  const deadByTarget = new Map<string, number>();
  for (const p of deadEndPresses(events, renderCommits)) {
    deadByTarget.set(p.name, (deadByTarget.get(p.name) ?? 0) + 1);
  }

  const out: CircuitFinding[] = [];
  for (const [name, count] of deadByTarget) {
    if (count < DEAD_END_MIN_REPEAT) continue;
    out.push({
      kind: "dead-end-tap",
      name,
      count,
      hint:
        `"${name}" was tapped ${count}× but nothing happened within ` +
        `${DEAD_END_WINDOW_MS}ms — no navigation, no network request, and ` +
        `no re-render. That's a dead-end control: a button wired to a no-op ` +
        `handler, a disabled element that still looks tappable, or a handler ` +
        `that silently early-returned. Give it a real action, disable it ` +
        `visibly when it can't act, or remove it. (Only taps you instrument ` +
        `with wrapPress / recordPress are visible here.)`,
    });
  }
  return out;
}

/* ─── Detector: orphan screens ───────────────────────────────────────── */

/**
 * A screen that mounted but has no observed inbound navigation edge. The
 * session's first mounted screen is excluded (entry point), and we only
 * emit when at least one nav edge exists.
 *
 * Edges the ROOT navigation observer drew count as explanations too — if the
 * map can show how the user got there, this must not claim it cannot.
 */
export function detectOrphanScreens(
  events: PerfEvent[],
  observed: ObservedGraph = NO_OBSERVED,
): CircuitFinding[] {
  const mounts: string[] = [];
  const mountCount = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== "screen") continue;
    mounts.push(e.name);
    mountCount.set(e.name, (mountCount.get(e.name) ?? 0) + 1);
  }
  if (mounts.length === 0) return [];

  const inboundTargets = new Set<string>();
  let navEdgeCount = 0;
  for (const e of events) {
    if (e.kind !== "nav") continue;
    const edge = parseNavEdge(e.name);
    if (!edge) continue;
    navEdgeCount++;
    inboundTargets.add(edge.to);
  }
  for (const edge of observed.edges) {
    navEdgeCount++;
    inboundTargets.add(edge.to);
  }
  if (navEdgeCount === 0) return []; // no navigation data to reason over

  const entryScreen = mounts[0]; // first thing mounted this session
  const out: CircuitFinding[] = [];
  for (const [name, count] of mountCount) {
    if (name === entryScreen) continue;
    if (inboundTargets.has(name)) continue;
    out.push({
      kind: "orphan-screen",
      name,
      count,
      hint:
        `"${name}" was shown ${count}× this session but the map has no ` +
        `navigation edge leading into it — the user got there but we can't ` +
        `explain how. Usually a deep link, or a navigation push the map ` +
        `never saw. Mount <BoosthisNavigationObserver> once at the app root ` +
        `and every screen change records its own edge; failing that, call ` +
        `beginNav before router.push. Not a defect on its own; it just means ` +
        `the graph is incomplete for this screen.`,
    });
  }
  return out;
}

/* ─── Detector: unreachable registered screens ───────────────────────── */

/**
 * Routes declared via registerNavigationMap() that were never reached this
 * session (not mounted, not a nav source or destination). PENDING /
 * informational only — never a defect claim.
 */
export function detectUnreachableRegisteredScreens(
  events: PerfEvent[],
  routes: readonly string[] | null = registeredRoutes,
  observed: ObservedGraph = NO_OBSERVED,
): CircuitFinding[] {
  if (!routes || routes.length === 0) return [];

  const reached = new Set<string>();
  for (const e of events) {
    if (e.kind === "screen") {
      reached.add(e.name);
    } else if (e.kind === "nav") {
      const edge = parseNavEdge(e.name);
      if (edge) {
        reached.add(edge.from);
        reached.add(edge.to);
      }
    }
  }
  // A screen the root observer watched the user open HAS been reached, even
  // though no instrumented event exists for it.
  for (const node of observed.nodes) reached.add(node.label);

  const out: CircuitFinding[] = [];
  for (const route of routes) {
    if (reached.has(route)) continue;
    out.push({
      kind: "unreachable-screen",
      name: route,
      count: 0,
      hint:
        `"${route}" is a registered route the map has never recorded being ` +
        `reached. ` +
        `This is a pending note, not a defect — a screen can be perfectly ` +
        `reachable and simply not visited. If it stays unreached across many ` +
        `real sessions it may be genuinely orphaned (no code path navigates ` +
        `to it), which is worth a look.`,
    });
  }
  return out;
}

/* ─── Detector: navigation loops (A ⇄ B oscillation) ─────────────────── */

/**
 * A run of CONSECUTIVE navigation edges bouncing between the same two
 * screens (A→B, B→A, A→B, B→A …). That cadence is the signature of a
 * redirect fight: two guards/effects each convinced the user belongs on the
 * other screen (auth guard vs onboarding guard is the classic pair). Flagged
 * only at ≥NAV_LOOP_MIN_BOUNCES consecutive bounces so a person naturally
 * going back and forth once is never a finding.
 */
export function detectNavLoops(events: PerfEvent[]): CircuitFinding[] {
  const navEdges: { from: string; to: string }[] = [];
  for (const e of events) {
    if (e.kind !== "nav") continue;
    const edge = parseNavEdge(e.name);
    if (edge) navEdges.push(edge);
  }
  if (navEdges.length < NAV_LOOP_MIN_BOUNCES) return [];

  // Longest run of consecutive reversing edges, aggregated per screen pair.
  const bestByPair = new Map<string, number>();
  let runLen = 1;
  for (let i = 1; i < navEdges.length; i++) {
    const prev = navEdges[i - 1];
    const cur = navEdges[i];
    const reverses = cur.from === prev.to && cur.to === prev.from;
    runLen = reverses ? runLen + 1 : 1;
    if (runLen >= NAV_LOOP_MIN_BOUNCES) {
      // Canonical pair key (order-independent).
      const [a, b] = [cur.from, cur.to].sort();
      const key = `${a}${NAV_LOOP_SEP}${b}`;
      if (runLen > (bestByPair.get(key) ?? 0)) bestByPair.set(key, runLen);
    }
  }

  const out: CircuitFinding[] = [];
  for (const [name, count] of bestByPair) {
    out.push({
      kind: "nav-loop",
      name,
      count,
      hint:
        `The app bounced ${name.replace(NAV_LOOP_SEP, " → ")} → back, ${count}× in a ` +
        `row. That alternating cadence is almost always two navigation ` +
        `guards or effects fighting — each one convinced the user belongs ` +
        `on the other screen (auth guard vs onboarding guard is the classic ` +
        `pair). Every bounce is a full mount+unmount cycle, so this burns ` +
        `frames and can soft-lock the UI. Make one guard the single owner ` +
        `of the decision.`,
    });
  }
  return out;
}

/* ─── Detector: API fan-out bursts ───────────────────────────────────── */

/**
 * The densest 1s window of API request STARTS (start = ts − duration).
 * ≥FANOUT_MIN_STARTS starts inside one window means one user action fanned
 * out into a burst of parallel requests — a screen that fires a call per
 * list item, or an effect cascade re-triggering fetches. Thresholds are
 * byte-parity with the server runtimes' circuit summary.
 */
export function detectFanoutBursts(events: PerfEvent[]): CircuitFinding[] {
  const burst = computeFanoutBurst(events);
  if (!burst) return [];
  const { count, topName, distinct } = burst;

  return [
    {
      kind: "fanout-burst",
      name: topName,
      count,
      hint:
        `${count} network requests started inside one second (${distinct} ` +
        `distinct ${distinct === 1 ? "endpoint" : "endpoints"}, busiest: ` +
        `"${topName}"). One user action fanning out into a burst like this ` +
        `is usually a request-per-list-item pattern or an effect cascade ` +
        `re-triggering fetches. Batch the calls into one endpoint, cap ` +
        `concurrency, or lift the fetch above the list so it runs once.`,
    },
  ];
}

/**
 * The densest 1s window of API starts, or null when there isn't one. Split
 * out from the finding above because the screen attribution needs the window's
 * START TIME to say which screen was showing when the burst happened — and
 * both must be talking about the same burst.
 */
function computeFanoutBurst(
  events: PerfEvent[],
): { count: number; topName: string; distinct: number; startTs: number } | null {
  const apis = events
    .filter((e) => e.kind === "api")
    .map((e) => ({ start: e.ts - e.durationMs, name: e.name }))
    .sort((a, b) => a.start - b.start);
  if (apis.length < FANOUT_MIN_STARTS) return null;

  let best = 0;
  let bestLo = 0;
  let bestHi = 0;
  let lo = 0;
  for (let hi = 0; hi < apis.length; hi++) {
    while (apis[hi].start - apis[lo].start > FANOUT_WINDOW_MS) lo++;
    const count = hi - lo + 1;
    if (count > best) {
      best = count;
      bestLo = lo;
      bestHi = hi;
    }
  }
  if (best < FANOUT_MIN_STARTS) return null;

  // Most frequent request label inside the burst window (on-device only).
  const freq = new Map<string, number>();
  for (let i = bestLo; i <= bestHi; i++) {
    freq.set(apis[i].name, (freq.get(apis[i].name) ?? 0) + 1);
  }
  let topName = apis[bestLo].name;
  let topCount = 0;
  for (const [name, count] of freq) {
    if (count > topCount) {
      topName = name;
      topCount = count;
    }
  }

  return { count: best, topName, distinct: freq.size, startTs: apis[bestLo].start };
}

/* ─── Attribution: which screen was showing when ─────────────────────── */

interface ScreenMark {
  ts:     number;
  screen: string;
}

/**
 * Everything the event log can place in time about "which screen is the user
 * on": every recorded screen, plus the destination of every recorded
 * navigation. Ascending by ts. This is a READ of the log, not a new
 * observation — if the app never instruments a screen, the log cannot place
 * it and attribution below honestly returns null.
 */
function buildScreenTimeline(events: PerfEvent[]): ScreenMark[] {
  const marks: ScreenMark[] = [];
  for (const e of events) {
    if (e.kind === "screen") {
      marks.push({ ts: e.ts, screen: e.name });
    } else if (e.kind === "nav") {
      const edge = parseNavEdge(e.name);
      if (edge) marks.push({ ts: e.ts, screen: edge.to });
    }
  }
  // Stable sort (ES2019+, Hermes included): marks recorded in the same
  // millisecond keep log order, which is the order the device saw them.
  return marks.sort((a, b) => a.ts - b.ts);
}

/**
 * The last screen the timeline can place at or before `ts`, or null when the
 * log has nothing to say — nothing recorded yet, or the bounded event ring
 * already dropped it. Null is an answer ("cannot tell"), never a guess.
 */
function screenAtTime(timeline: ScreenMark[], ts: number): string | null {
  let lo = 0;
  let hi = timeline.length - 1;
  let best: string | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].ts <= ts) {
      best = timeline[mid].screen;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * Split the dead-end presses by the screen they happened on. Same repeat gate
 * as the finding (a control below it is in neither place), and the same
 * deadness decision — this only adds WHERE, from the log, never a new claim
 * about WHETHER a press was dead. A press the log cannot place keeps
 * `screen: null` and is shown as unattributed rather than attached to a guess.
 */
export function attributeDeadEndControls(
  events: PerfEvent[],
  renderCommits: RenderCommit[] = [],
): CircuitControlSite[] {
  const dead = deadEndPresses(events, renderCommits);
  if (dead.length === 0) return [];

  const totals = new Map<string, number>();
  for (const p of dead) totals.set(p.name, (totals.get(p.name) ?? 0) + 1);

  const timeline = buildScreenTimeline(events);
  const sites = new Map<string, CircuitControlSite>();
  for (const p of dead) {
    if ((totals.get(p.name) ?? 0) < DEAD_END_MIN_REPEAT) continue;
    const screen = screenAtTime(timeline, p.ts);
    const key = `${p.name}\u0000${screen ?? "\u0000unplaced"}`;
    const cur = sites.get(key);
    if (cur) cur.count += 1;
    else sites.set(key, { control: p.name, screen, count: 1 });
  }

  return Array.from(sites.values()).sort(
    (a, b) =>
      b.count - a.count ||
      a.control.localeCompare(b.control) ||
      (a.screen ?? "").localeCompare(b.screen ?? ""),
  );
}

/** `A ⇄ B` back to its two screens, or null if the name isn't that shape. */
function parseNavLoopPair(name: string): [string, string] | null {
  const parts = name.split(NAV_LOOP_SEP);
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  if (!a || !b) return null;
  return [a, b];
}

/**
 * Attach each finding to the screen(s) it is against, so the drawn map can
 * mark the node. Nothing new is detected here: orphan and unreachable
 * findings already NAME a screen, a nav loop names its pair, a fan-out burst
 * is placed by the log at its window start, and dead ends arrive already
 * attributed. A finding the log cannot place is simply not attached — it
 * stays in the findings list under the picture.
 */
export function attributeScreenFindings(
  events: PerfEvent[],
  findings: CircuitFinding[],
  controls: CircuitControlSite[],
): CircuitScreenFindings[] {
  const byScreen = new Map<string, Set<CircuitFindingKind>>();
  const add = (screen: string | null, kind: CircuitFindingKind): void => {
    if (!screen) return;
    const set = byScreen.get(screen) ?? new Set<CircuitFindingKind>();
    set.add(kind);
    byScreen.set(screen, set);
  };

  let timeline: ScreenMark[] | null = null;
  for (const f of findings) {
    switch (f.kind) {
      case "orphan-screen":
      case "unreachable-screen":
        add(f.name, f.kind);
        break;
      case "nav-loop": {
        const pair = parseNavLoopPair(f.name);
        if (pair) {
          add(pair[0], f.kind);
          add(pair[1], f.kind);
        }
        break;
      }
      case "fanout-burst": {
        // The finding's name is a REQUEST label, not a screen, so the burst is
        // placed by asking the log what was showing when its window started.
        const burst = computeFanoutBurst(events);
        if (burst) {
          timeline = timeline ?? buildScreenTimeline(events);
          add(screenAtTime(timeline, burst.startTs), f.kind);
        }
        break;
      }
      case "dead-end-tap":
        break; // placed per-press below, not by the control's name
    }
  }
  for (const c of controls) add(c.screen, "dead-end-tap");

  const ORDER: CircuitFindingKind[] = [
    "dead-end-tap",
    "orphan-screen",
    "unreachable-screen",
    "nav-loop",
    "fanout-burst",
  ];
  return Array.from(byScreen.entries())
    .map(([screen, kinds]) => ({
      screen,
      kinds: ORDER.filter((k) => kinds.has(k)),
    }))
    .sort((a, b) => a.screen.localeCompare(b.screen));
}

/* ─── Graph + report assembly ────────────────────────────────────────── */

/**
 * Build the observed navigation graph (nodes + weighted edges).
 *
 * Two sources, merged:
 *   - the INSTRUMENTED event log (`useBoosthis` mounts, `beginNav` edges),
 *     which is what this has always read;
 *   - the ROOT OBSERVER's accumulated on-device map, where the app mounts
 *     `<BoosthisNavigationObserver>` — screens and edges nobody instrumented.
 *
 * Where both saw the same edge, the count is the LARGER of the two rather
 * than their sum: they are two views of the same transitions, and adding
 * them would double-count every navigation an instrumented app makes.
 */
export function buildCircuitGraph(
  events: PerfEvent[],
  observed: ObservedGraph = NO_OBSERVED,
): {
  nodes: CircuitNode[];
  edges: CircuitEdge[];
} {
  const edgeCount = new Map<string, number>(); // "from→to" -> count
  const mounted = new Set<string>();
  const navSeen = new Set<string>();
  const inbound = new Map<string, Set<string>>();
  const outbound = new Map<string, Set<string>>();

  for (const e of events) {
    if (e.kind === "screen") {
      mounted.add(e.name);
    } else if (e.kind === "nav") {
      const edge = parseNavEdge(e.name);
      if (!edge) continue;
      navSeen.add(edge.from);
      navSeen.add(edge.to);
      const key = `${edge.from}→${edge.to}`;
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
      (inbound.get(edge.to) ?? inbound.set(edge.to, new Set()).get(edge.to)!).add(edge.from);
      (outbound.get(edge.from) ?? outbound.set(edge.from, new Set()).get(edge.from)!).add(edge.to);
    }
  }

  const routes = registeredRoutes ?? [];
  // Every screen this launch can already name for itself: mounted screens,
  // the endpoints of instrumented navigations, and the app's declared routes.
  const alreadyNamed = new Set<string>([...mounted, ...navSeen, ...routes]);
  const observedLabels = new Set<string>();
  for (const node of observed.nodes) observedLabels.add(node.label);
  for (const node of observed.nodes) navSeen.add(node.label);
  const mapKnows = (name: string): boolean =>
    observedLabels.has(name) || alreadyNamed.has(name);
  for (const edge of observed.edges) {
    // The accumulated map is CAPPED, and it holds the invariant that every
    // edge it hands out has both endpoints among its nodes. An endpoint that
    // is in NEITHER the map's node list nor anything this launch can name is
    // a screen the cap dropped: drawing it would make the node cap a number
    // the panel itself contradicts. (An endpoint the events or the declared
    // route list already name is a screen we know about either way — that
    // edge is kept, and its count still wins where the two halves disagree.)
    if (!mapKnows(edge.from) || !mapKnows(edge.to)) continue;
    navSeen.add(edge.from);
    navSeen.add(edge.to);
    const key = `${edge.from}→${edge.to}`;
    edgeCount.set(key, Math.max(edgeCount.get(key) ?? 0, edge.count));
    (inbound.get(edge.to) ?? inbound.set(edge.to, new Set()).get(edge.to)!).add(edge.from);
    (outbound.get(edge.from) ?? outbound.set(edge.from, new Set()).get(edge.from)!).add(edge.to);
  }

  const names = new Set<string>([...mounted, ...navSeen, ...routes]);

  const nodes: CircuitNode[] = Array.from(names)
    .sort()
    .map((name) => ({
      name,
      reached:    mounted.has(name) || navSeen.has(name),
      registered: routes.includes(name),
      inbound:    inbound.get(name)?.size ?? 0,
      outbound:   outbound.get(name)?.size ?? 0,
    }));

  const edges: CircuitEdge[] = Array.from(edgeCount.entries())
    .map(([key, count]) => {
      const edge = parseNavEdge(key)!;
      return { from: edge.from, to: edge.to, count };
    })
    .sort((a, b) => b.count - a.count);

  return { nodes, edges };
}

/**
 * Full on-device circuit-map report: graph + all integrity findings.
 * Transmits nothing.
 *
 * The third argument is the root observer's accumulated map. It defaults to
 * the live one so the panel sees the self-drawn graph; pass an explicit
 * `{ nodes: [], edges: [] }` for a pure, event-only report.
 */
export function buildCircuitMap(
  events: PerfEvent[],
  renderCommits: RenderCommit[] = [],
  observed: ObservedGraph = getObservedGraph(),
): CircuitMapReport {
  const { nodes, edges } = buildCircuitGraph(events, observed);
  const findings: CircuitFinding[] = [
    ...detectNavLoops(events),
    ...detectFanoutBursts(events),
    ...detectDeadEndTaps(events, renderCommits),
    ...detectOrphanScreens(events, observed),
    ...detectUnreachableRegisteredScreens(events, registeredRoutes, observed),
  ];
  const controls = attributeDeadEndControls(events, renderCommits);
  const screenFindings = attributeScreenFindings(events, findings, controls);
  return { nodes, edges, findings, controls, screenFindings };
}

/** An empty observed graph — the default for every pure detector below, so a
 *  caller that passes only events gets exactly today's answer. */
const NO_OBSERVED: ObservedGraph = { nodes: [], edges: [] };
