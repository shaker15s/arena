/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: laying the on-device circuit map out for drawing ───────
 *
 * `circuitMap.ts` reconstructs WHAT the app's navigation graph is. This
 * module decides WHERE to draw it: a deterministic, pure layout over a
 * CircuitMapReport, producing node boxes and edge lines in a canvas
 * coordinate space that BoosthisEnginePanel renders with plain react-native
 * Views (no SVG, no drawing library, no new dependency).
 *
 * Rules this file lives by:
 *
 *   • PURE — the report is read, never mutated, and the same report always
 *     lays out identically. The panel re-runs this on its normal 2s refresh,
 *     so it must also be cheap: everything here is O(nodes + edges) over a
 *     BOUNDED selection, never over the whole graph.
 *
 *   • BOUNDED — a big app cannot make the panel expensive or unreadable. At
 *     most MAP_MAX_NODES boxes and MAP_MAX_EDGES arrows are drawn, in at most
 *     MAP_MAX_LANES rows; when anything is left out, `subsetNote` says so in
 *     words rather than the picture quietly lying about the app's size.
 *
 *   • NO NEW CLAIMS — every node state and every badge is derived from
 *     findings the detectors already emitted, or from the report's own
 *     attribution. Nothing here observes anything, and nothing here is ever
 *     transmitted (see the privacy note at the top of circuitMap.ts).
 * ───────────────────────────────────────────────────────────────────── */

import type {
  CircuitFindingKind,
  CircuitMapReport,
  CircuitNode,
} from "./circuitMap";

/* ─── Geometry constants (canvas units = density-independent pixels) ─── */

export const MAP_NODE_W = 104;
export const MAP_NODE_H = 38;
/** Gaps between boxes across a lane and between lanes. */
const MAP_H_GAP = 20;
const MAP_V_GAP = 42;
/** Breathing room around the whole drawing. */
const MAP_PAD = 6;

/** Most boxes drawn. Beyond this the picture stops being readable on a phone
 *  and starts being a cost — the note says what was left out. */
export const MAP_MAX_NODES = 12;
/** Most arrows drawn, for the same reason. */
export const MAP_MAX_EDGES = 18;
/** Most rows. A deeper graph folds its tail into the last lane (the arrows
 *  stay correct; only the vertical position is squashed) so the card cannot
 *  grow without bound. */
export const MAP_MAX_LANES = 5;
/** Thinnest / thickest arrow. A travelled-once edge is 1; the step up is
 *  visible at a glance and then saturates, so one runaway edge cannot draw a
 *  bar across the card. */
export const MAP_MIN_THICKNESS = 1;
export const MAP_MAX_THICKNESS = 4;

/* ─── Types ──────────────────────────────────────────────────────────── */

/**
 * The four looks a box can have. They are deliberately four, not three:
 *
 *   clean               reached, nothing against it
 *   flagged             reached, a finding against it (dead-end control,
 *                       nav loop, request burst)
 *   no-inbound          reached, but no observed edge leads into it — the map
 *                       cannot explain how the user got there
 *   declared-unreached  declared via registerNavigationMap() and never
 *                       recorded as reached. INFORMATIONAL, not a defect.
 *                       "Reached" spans everything the map holds — this
 *                       launch, plus any earlier launches the device store
 *                       kept — so it is never worded as a session claim.
 *
 * Precedence when more than one applies is that order (a screen that is both
 * orphaned and has a dead-end control draws as flagged); nothing is lost,
 * because `findingKinds` keeps every kind and the findings list below the
 * picture is unchanged.
 */
export type MapNodeState =
  | "clean"
  | "flagged"
  | "no-inbound"
  | "declared-unreached";

export interface MapNode {
  name:  string;
  state: MapNodeState;
  /** Box position in canvas coordinates (top-left). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Every finding kind against this screen, in report order. */
  findingKinds: CircuitFindingKind[];
  /** Dead-end controls the log placed ON this screen. */
  controls: { control: string; count: number }[];
  /** Navigations recorded from this screen back to itself (drawn as a badge,
   *  since a line from a box to itself is not readable at this size). */
  selfNav: number;
  /** Distinct inbound / outbound edges, straight from the report. */
  inbound:  number;
  outbound: number;
  /** Declared via registerNavigationMap(). */
  registered: boolean;
}

export interface MapEdge {
  from:  string;
  to:    string;
  /** Times this edge was travelled — what the thickness encodes. */
  count: number;
  /** Line midpoint + geometry for a rotated 1-dimensional View. */
  midX:     number;
  midY:     number;
  length:   number;
  angleDeg: number;
  thickness: number;
  /** Arrowhead centre, just inside the destination box's edge. */
  headX: number;
  headY: number;
  /** The reverse edge was also observed (drawn offset so both are visible). */
  bothWays: boolean;
}

export interface CircuitMapLayout {
  /** Canvas size. The panel scrolls horizontally if it is wider than the card. */
  width:  number;
  height: number;
  nodes: MapNode[];
  edges: MapEdge[];
  /** What the report held, vs what is drawn. */
  totalNodes: number;
  totalEdges: number;
  /** Screens the report says were actually reached — this launch plus any
   *  earlier launch the device store kept. Never a session-only claim. */
  reached: number;
  /** Routes declared via registerNavigationMap() (0 = none declared), and how
   *  many of those the map has never recorded being reached. */
  declared:          number;
  declaredUnreached: number;
  /** Plain sentence naming what the picture leaves out; "" when it is whole. */
  subsetNote: string;
  /** Dead-end controls the event log could NOT place on a screen. These are
   *  never attached to a guessed box — the panel names them instead. */
  unattributedControls: { control: string; count: number }[];
}

/* ─── Layout ─────────────────────────────────────────────────────────── */

const FLAGGING_KINDS: CircuitFindingKind[] = [
  "dead-end-tap",
  "nav-loop",
  "fanout-burst",
];

function stateOf(node: CircuitNode, kinds: CircuitFindingKind[]): MapNodeState {
  if (!node.reached) return "declared-unreached";
  if (kinds.some((k) => FLAGGING_KINDS.includes(k))) return "flagged";
  // "no inbound edge" is taken from the orphan-screen FINDING, never from
  // `inbound === 0` — the detector already excludes the session's entry
  // screen (which legitimately has nothing leading into it) and stays quiet
  // when there is no navigation data to reason over at all.
  if (kinds.includes("orphan-screen")) return "no-inbound";
  return "clean";
}

/** Where a line from `box`'s centre toward (tx, ty) crosses the box border. */
function borderPoint(
  box: { x: number; y: number; w: number; h: number },
  tx: number,
  ty: number,
): { x: number; y: number } {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx === 0 ? Number.POSITIVE_INFINITY : box.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Number.POSITIVE_INFINITY : box.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/**
 * Lay a circuit-map report out for drawing. Pure: the report is only read.
 */
export function layoutCircuitMap(report: CircuitMapReport): CircuitMapLayout {
  const reportNodes = report.nodes ?? [];
  const reportEdges = report.edges ?? [];
  const screenFindings = report.screenFindings ?? [];
  const reportControls = report.controls ?? [];

  const kindsByScreen = new Map<string, CircuitFindingKind[]>();
  for (const s of screenFindings) kindsByScreen.set(s.screen, s.kinds);

  const controlsByScreen = new Map<string, { control: string; count: number }[]>();
  const unattributedControls: { control: string; count: number }[] = [];
  for (const c of reportControls) {
    if (c.screen === null) {
      unattributedControls.push({ control: c.control, count: c.count });
      continue;
    }
    const list = controlsByScreen.get(c.screen) ?? [];
    list.push({ control: c.control, count: c.count });
    controlsByScreen.set(c.screen, list);
  }

  // Traffic through each screen, and same-screen navigations (drawn as a
  // badge rather than a line — a self-arrow is unreadable at this size).
  const traffic = new Map<string, number>();
  const selfNav = new Map<string, number>();
  for (const e of reportEdges) {
    if (e.from === e.to) {
      selfNav.set(e.from, (selfNav.get(e.from) ?? 0) + e.count);
      continue;
    }
    traffic.set(e.from, (traffic.get(e.from) ?? 0) + e.count);
    traffic.set(e.to, (traffic.get(e.to) ?? 0) + e.count);
  }

  const ranked = reportNodes.map((node) => {
    const kinds = kindsByScreen.get(node.name) ?? [];
    return {
      node,
      kinds,
      state: stateOf(node, kinds),
      weight: traffic.get(node.name) ?? 0,
    };
  });

  // Selection order: a screen with something wrong with it is never the box
  // we drop, then the busiest, then alphabetical so the picture is stable
  // between refreshes. Declared-but-never-reached routes come last — they are
  // an overlay on the real map, not competition for its space.
  const problemRank = (s: MapNodeState): number =>
    s === "flagged" ? 0 : s === "no-inbound" ? 1 : 2;
  const reachedRanked = ranked
    .filter((r) => r.state !== "declared-unreached")
    .sort(
      (a, b) =>
        problemRank(a.state) - problemRank(b.state) ||
        b.weight - a.weight ||
        a.node.name.localeCompare(b.node.name),
    );
  const unreachedRanked = ranked
    .filter((r) => r.state === "declared-unreached")
    .sort((a, b) => a.node.name.localeCompare(b.node.name));

  const chosen = [...reachedRanked, ...unreachedRanked].slice(0, MAP_MAX_NODES);
  const drawnNames = new Set(chosen.map((c) => c.node.name));

  // Only edges with both ends on the picture can be drawn as a line.
  const drawableEdges = reportEdges.filter(
    (e) => e.from !== e.to && drawnNames.has(e.from) && drawnNames.has(e.to),
  );
  const chosenEdges = [...drawableEdges]
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.from.localeCompare(b.from) ||
        a.to.localeCompare(b.to),
    )
    .slice(0, MAP_MAX_EDGES);

  /* ── Lanes: breadth-first depth over the edges actually drawn ── */

  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const e of chosenEdges) {
    const list = adjacency.get(e.from) ?? [];
    list.push(e.to);
    adjacency.set(e.from, list);
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  }

  const depth = new Map<string, number>();
  const order: string[] = []; // discovery order, used for within-lane order
  const walkFrom = (root: string): void => {
    if (depth.has(root)) return;
    depth.set(root, 0);
    order.push(root);
    const queue = [root];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i];
      const d = depth.get(cur)!;
      for (const next of adjacency.get(cur) ?? []) {
        if (depth.has(next)) continue;
        depth.set(next, d + 1);
        order.push(next);
        queue.push(next);
      }
    }
  };
  const reachedChosen = chosen.filter((c) => c.state !== "declared-unreached");
  // Entry points first (nothing drawn leads into them), then anything left
  // over — a pure cycle has no indegree-0 node, so it seeds itself.
  for (const c of reachedChosen) {
    if ((indegree.get(c.node.name) ?? 0) === 0) walkFrom(c.node.name);
  }
  for (const c of reachedChosen) walkFrom(c.node.name);

  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);

  const laneOf = new Map<string, number>();
  for (const c of chosen) {
    const raw =
      c.state === "declared-unreached"
        ? // Declared-but-never-reached routes sit on their own bottom row —
          // the overlay reads as "these are off the map", which is what they are.
          (depth.size > 0 ? maxDepth + 1 : 0)
        : (depth.get(c.node.name) ?? 0);
    laneOf.set(c.node.name, Math.min(raw, MAP_MAX_LANES - 1));
  }

  const laneMembers: string[][] = [];
  const pushTo = (lane: number, name: string): void => {
    while (laneMembers.length <= lane) laneMembers.push([]);
    laneMembers[lane].push(name);
  };
  // Discovery order keeps a parent's children next to each other; anything
  // the walk never reached follows in selection order.
  const placed = new Set<string>();
  for (const name of order) {
    if (!drawnNames.has(name) || placed.has(name)) continue;
    placed.add(name);
    pushTo(laneOf.get(name)!, name);
  }
  for (const c of chosen) {
    if (placed.has(c.node.name)) continue;
    placed.add(c.node.name);
    pushTo(laneOf.get(c.node.name)!, c.node.name);
  }

  const widestLane = laneMembers.reduce((m, l) => Math.max(m, l.length), 0);
  const width =
    widestLane === 0
      ? 0
      : MAP_PAD * 2 + widestLane * MAP_NODE_W + (widestLane - 1) * MAP_H_GAP;
  const height =
    laneMembers.length === 0
      ? 0
      : MAP_PAD * 2 +
        laneMembers.length * MAP_NODE_H +
        (laneMembers.length - 1) * MAP_V_GAP;

  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  laneMembers.forEach((members, lane) => {
    const laneWidth =
      members.length * MAP_NODE_W + (members.length - 1) * MAP_H_GAP;
    const startX = Math.round((width - laneWidth) / 2);
    members.forEach((name, i) => {
      boxes.set(name, {
        x: startX + i * (MAP_NODE_W + MAP_H_GAP),
        y: MAP_PAD + lane * (MAP_NODE_H + MAP_V_GAP),
        w: MAP_NODE_W,
        h: MAP_NODE_H,
      });
    });
  });

  const nodes: MapNode[] = chosen.map((c) => {
    const box = boxes.get(c.node.name)!;
    return {
      name:  c.node.name,
      state: c.state,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      findingKinds: c.kinds,
      controls: controlsByScreen.get(c.node.name) ?? [],
      selfNav: selfNav.get(c.node.name) ?? 0,
      inbound:  c.node.inbound,
      outbound: c.node.outbound,
      registered: c.node.registered,
    };
  });

  /* ── Arrows ── */

  const edgeKeys = new Set(chosenEdges.map((e) => `${e.from}\u0000${e.to}`));
  const edges: MapEdge[] = chosenEdges.map((e) => {
    const a = boxes.get(e.from)!;
    const b = boxes.get(e.to)!;
    const bothWays = edgeKeys.has(`${e.to}\u0000${e.from}`);
    let p1 = borderPoint(a, b.x + b.w / 2, b.y + b.h / 2);
    let p2 = borderPoint(b, a.x + a.w / 2, a.y + a.h / 2);

    if (bothWays) {
      // Two arrows between the same pair would sit exactly on top of each
      // other. Nudge each one off the centre line, to the LEFT of its own
      // direction of travel — so the two directions land on opposite sides
      // and a bounce is visible AS two arrows. (Taking the perpendicular of
      // this edge's own direction is what makes the two disagree; an extra
      // name-order sign would cancel it back out.)
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy) || 1;
      const ox = (-dy / len) * 3;
      const oy = (dx / len) * 3;
      p1 = { x: p1.x + ox, y: p1.y + oy };
      p2 = { x: p2.x + ox, y: p2.y + oy };
    }

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy);
    const ux = length === 0 ? 0 : dx / length;
    const uy = length === 0 ? 0 : dy / length;
    return {
      from:  e.from,
      to:    e.to,
      count: e.count,
      midX: (p1.x + p2.x) / 2,
      midY: (p1.y + p2.y) / 2,
      length,
      angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
      thickness: Math.min(
        MAP_MAX_THICKNESS,
        MAP_MIN_THICKNESS + Math.max(0, e.count - 1),
      ),
      headX: p2.x - ux * 3,
      headY: p2.y - uy * 3,
      bothWays,
    };
  });

  /* ── What the picture leaves out, in words ── */

  const hiddenNodes = reportNodes.length - nodes.length;
  const hiddenEdges = reportEdges.filter((e) => e.from !== e.to).length - edges.length;
  const parts: string[] = [];
  if (hiddenNodes > 0) {
    parts.push(
      `${nodes.length} of ${reportNodes.length} screens (flagged ones first, then the busiest)`,
    );
  }
  if (hiddenEdges > 0) {
    const totalDrawable = reportEdges.filter((e) => e.from !== e.to).length;
    parts.push(`${edges.length} of ${totalDrawable} navigations (most travelled first)`);
  }
  const subsetNote = parts.length === 0 ? "" : `Drawing ${parts.join(" and ")}.`;

  return {
    width,
    height,
    nodes,
    edges,
    totalNodes: reportNodes.length,
    totalEdges: reportEdges.length,
    reached: reportNodes.filter((n) => n.reached).length,
    declared: reportNodes.filter((n) => n.registered).length,
    declaredUnreached: reportNodes.filter((n) => n.registered && !n.reached).length,
    subsetNote,
    unattributedControls,
  };
}
