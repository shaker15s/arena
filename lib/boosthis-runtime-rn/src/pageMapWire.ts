/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/** The ONE place the accumulated screen map may become something that travels.
 *
 * `pageMap.ts` records; this module decides what — if anything — leaves the
 * device. Keeping the boundary in its own file is deliberate: there is a
 * single function to read when you want to know what a Boosthis app sends
 * about its own screens, and a single import for a test to point at.
 *
 * WHAT TRAVELS: screen labels, and pairs of screen labels with a count. The
 * labels are the SAME normalized screen labels that already ride every perf
 * row and every trace span (`normalizeScreenLabel`), and they go through the
 * same server-side screen on arrival.
 *
 * WHAT NEVER TRAVELS, and cannot be made to by any option: the control that
 * was tapped, the gesture that moved someone, a coordinate, an element's text
 * or its accessibility label. The kit knows some of those — the circuit map
 * joins a tap to the screen change it caused so the on-device panel can show
 * it — and the shape below has nowhere to put them. That structural
 * non-transmission is the point, not an oversight; see
 * docs/page-map-wire-contract.md.
 *
 * OFF BY DEFAULT. Nothing here runs unless the host passes
 * `sendPageMap: true`, and the server ignores the field unless it too is
 * switched on.
 */

import { getObservedGraph, getScreenMapStats } from "./pageMap";
import { MAX_PART_NAME, safeScreenName } from "./partName";

/** Wire version. Bumped only for a shape change; the server refuses any
 *  other value rather than guessing. */
export const PAGE_MAP_WIRE_VERSION = 1 as const;
/** Hard caps. These MUST match `@workspace/api-zod`'s `pageMapWire.ts` — the
 *  server rejects the whole map rather than trimming it. */
export const PAGE_MAP_WIRE_MAX_NODES = 200;
export const PAGE_MAP_WIRE_MAX_EDGES = 400;
export const PAGE_MAP_WIRE_MAX_LABEL_CHARS = MAX_PART_NAME;
/** UTF-8 BYTES, not string length: a non-ASCII label costs up to four bytes
 *  per character, so counting characters would break the promise quietly. */
export const PAGE_MAP_WIRE_MAX_BYTES = 24 * 1024;

export interface PageMapWireNode {
  label: string;
  /** Times this screen was opened. A floor — see below. */
  opens: number;
}

export interface PageMapWireEdge {
  from: string;
  to: string;
  /** Times this path was walked. A floor. */
  count: number;
}

export interface PageMapWire {
  v: typeof PAGE_MAP_WIRE_VERSION;
  nodes: PageMapWireNode[];
  edges: PageMapWireEdge[];
  /** True when this map is a SUBSET of what the device saw — either the
   *  on-device store evicted something, or the trimming below dropped
   *  something to fit. The server keeps this so the page can say so. */
  truncated: boolean;
}

/**
 * What the on-device panel may say about where this map goes.
 *
 * The panel used to promise, flatly, that nothing in the circuit-map card is
 * ever uploaded. That sentence was true of every part of the card and is
 * still true of the part that matters most — a tap, a control, a gesture and
 * a coordinate cannot travel at all. It stopped being true of the SCREENS and
 * the paths between them the moment a host could switch the upload on, so the
 * sentence is derived from the switch rather than typed once and left.
 *
 * Both branches are exact about the half that never moves: promising less
 * than the truth about controls would be as wrong as promising more.
 */
export function screenMapTravelLine(sendOn: boolean): string {
  return sendOn
    ? "Screen names and the paths between them go to your Boosthis project when an upload is allowed — taps, controls and findings never leave this device"
    : "Stays on this device — nothing here is ever uploaded";
}

/** UTF-8 length of a serialized value. Hermes has `TextEncoder` on modern
 *  React Native; where it does not, over-report rather than under-report. */
function byteLength(json: string): number {
  try {
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(json).length;
    }
  } catch {
    /* fall through */
  }
  return json.length * 4;
}

/**
 * The map as it would travel, or `null` when there is nothing to send.
 *
 * DROPS RATHER THAN GROWS. Over any cap the least-travelled paths go first
 * (the graph arrives busiest-first), then the least-visited screens, and the
 * result is marked `truncated`. A map is never sent over its byte ceiling and
 * never split across uploads: the next upload carries the whole map again,
 * and the server's newest-wins rule makes that correct rather than additive.
 */
export function buildPageMapWire(): PageMapWire | null {
  const graph = getObservedGraph();
  const fits = (label: string): boolean => safeScreenName(label) !== null;

  let dropped = false;

  let nodes: PageMapWireNode[] = [];
  for (const n of graph.nodes) {
    if (!fits(n.label)) {
      dropped = true;
      continue;
    }
    nodes.push({ label: n.label, opens: n.count });
  }
  if (nodes.length > PAGE_MAP_WIRE_MAX_NODES) {
    nodes = nodes.slice(0, PAGE_MAP_WIRE_MAX_NODES);
    dropped = true;
  }
  if (nodes.length === 0) return null;

  const kept = new Set(nodes.map((n) => n.label));
  let edges: PageMapWireEdge[] = [];
  for (const e of graph.edges) {
    // Both ends must be screens that survived. An edge to a dropped screen
    // would put that screen back on the server's drawing.
    if (!kept.has(e.from) || !kept.has(e.to)) {
      dropped = true;
      continue;
    }
    edges.push({ from: e.from, to: e.to, count: e.count });
  }
  if (edges.length > PAGE_MAP_WIRE_MAX_EDGES) {
    edges = edges.slice(0, PAGE_MAP_WIRE_MAX_EDGES);
    dropped = true;
  }

  const stats = getScreenMapStats();
  const build = (): PageMapWire => ({
    v: PAGE_MAP_WIRE_VERSION,
    nodes,
    edges,
    truncated: dropped || stats.truncated,
  });

  // Fit the byte ceiling: paths first (the screens are the more valuable half
  // and are what the navigation layer needs to show anything at all), then
  // screens. Halving rather than one-at-a-time keeps this bounded on a map
  // that is far over.
  let wire = build();
  while (byteLength(JSON.stringify(wire)) > PAGE_MAP_WIRE_MAX_BYTES) {
    if (edges.length > 0) {
      edges = edges.slice(0, Math.floor(edges.length / 2));
      dropped = true;
    } else if (nodes.length > 1) {
      nodes = nodes.slice(0, Math.floor(nodes.length / 2));
      dropped = true;
    } else {
      // One screen whose label alone will not fit. Send nothing rather than
      // something malformed.
      return null;
    }
    wire = build();
  }
  return wire;
}
