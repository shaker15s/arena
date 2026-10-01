/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: the self-drawing screen map (on-device) ────────────────
 *
 * The circuit map can only draw what the developer instrumented: a screen
 * exists where `useBoosthis(name)` was added, and an edge exists where
 * `beginNav(from, to)` was called. This module is the other half — the screens
 * and edges the ROOT navigation observer discovers on its own, accumulated
 * across launches on this device under hard caps.
 *
 * It is deliberately a separate store from the perfMonitor event log:
 *
 *   - the event log rides the UPLOAD path (rows, p50/p95). Auto-recording
 *     every screen change there would silently put new data on the wire.
 *   - the map must survive relaunches and stay bounded, which is a different
 *     lifetime from a session's event ring.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PRIVACY. Path-shaped labels have their volatile segments collapsed to
 * ":id" before they are kept, so a per-record route cannot fill the map with
 * identifiers.
 *
 * This module itself uploads nothing. It hands its contents out in three
 * places and no others: `circuitMap.ts` (the in-app panel's graph), the
 * panel's completeness line, and — only when the host opted in with
 * `sendPageMap` — `pageMapWire.ts`, which turns the graph into the bounded,
 * label-only shape that may ride the snapshot upload. It is never read by
 * transmit / safeTransmit / computeMeterAxes / SnapshotPayload.
 *
 * What may never travel, from here or anywhere: the control that was tapped,
 * the gesture, a coordinate, an accessibility label. The wire has no field
 * for one. See docs/page-map-wire-contract.md.
 *
 * COST: recording is in-memory only. The write is coalesced onto the same
 * debounced flush the perf monitor already uses (30s), never per navigation.
 * ───────────────────────────────────────────────────────────────────────── */

import { platform } from "./perfPlatform";
import {
  MAX_PART_NAME,
  safeScreenName,
  warnPartNameRefusal,
} from "./partName";

const STORAGE_KEY = "boosthis.pageMap.v1";

/** Cap on distinct screens kept. Beyond it the least-visited screen goes. */
export const MAX_MAP_NODES = 200;
/** Cap on distinct edges kept. Beyond it the least-traversed edge goes. */
export const MAX_MAP_EDGES = 400;
/** Cap on the serialized map written to the device store. */
export const MAX_MAP_STORED_BYTES = 16 * 1024;
/** Same cadence the perf monitor already persists on — no new rhythm. */
const FLUSH_DEBOUNCE_MS = 30 * 1000;
/** Separator between the two halves of an edge key. Matches `parseNavEdge`. */
const EDGE_SEP = "\u2192"; // →

/**
 * Normalize an observed screen label.
 *
 * A React Navigation `route.name` is already a code-defined identifier and
 * passes through untouched. An expo-router pathname is not: `/team/user/42`
 * would put one node per id in the map. Path-shaped labels therefore have
 * their volatile segments collapsed to ":id" — the same rule the web kit
 * applies — and the query string / fragment is never read.
 */
export function normalizeScreenLabel(name: string): string | null {
  return safeScreenName(name);
}

interface Counted {
  count: number;
  /** Monotonic recency stamp — the tie-break when counts are equal. */
  seq: number;
}

let nodes = new Map<string, Counted>();
let edges = new Map<string, Counted>();
let seq = 0;
let truncated = false;
let prevLabel: string | null = null;
let dirty = false;
let hydrated = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * How the accumulated map is being kept. Five distinguishable answers — an
 * unsaved map, a map that cannot be kept, and a map whose store will not say,
 * must never look alike:
 *
 *  - `not-saved-yet`  nothing has been written OR read back yet, so whether
 *                     this map is being kept is not yet known.
 *  - `stored`         the map is in a store that keeps data — either the last
 *                     write reached it, or this launch read an earlier
 *                     launch's map back out of it.
 *  - `memory-only`    the device store is the in-process fallback (no
 *                     AsyncStorage installed) — the map dies with the process.
 *  - `unavailable`    the store exists but rejected the write.
 *  - `unknown`        a host-supplied store that does not say whether it
 *                     keeps anything. We do not guess on its behalf.
 */
export type ScreenMapPersistence =
  | "not-saved-yet"
  | "stored"
  | "memory-only"
  | "unavailable"
  | "unknown";

let persistence: ScreenMapPersistence = "not-saved-yet";

export interface ScreenMapStats {
  /** Distinct screens the map holds (accumulated across launches). */
  screenCount: number;
  /** Distinct edges between those screens. */
  edgeCount: number;
  /** Total screen opens counted. */
  visitCount: number;
  /** True when a cap evicted something — the map is showing a subset. */
  truncated: boolean;
  /** Whether the accumulated map is actually being kept. */
  persistence: ScreenMapPersistence;
}

export interface ObservedGraph {
  nodes: { label: string; count: number }[];
  edges: { from: string; to: string; count: number }[];
}

/* ─── Recording (hot path — in memory only) ──────────────────────────── */

function bump(map: Map<string, Counted>, key: string): void {
  const rec = map.get(key);
  seq++;
  if (rec) {
    rec.count++;
    rec.seq = seq;
  } else {
    map.set(key, { count: 1, seq });
  }
}

function weakest(map: Map<string, Counted>): string | null {
  let worstKey: string | null = null;
  let worst: Counted | null = null;
  for (const [key, rec] of map) {
    if (
      !worst ||
      rec.count < worst.count ||
      (rec.count === worst.count && rec.seq < worst.seq)
    ) {
      worst = rec;
      worstKey = key;
    }
  }
  return worstKey;
}

function dropEdgesTouching(label: string): void {
  for (const key of Array.from(edges.keys())) {
    const sep = key.indexOf(EDGE_SEP);
    if (sep < 0) continue;
    if (key.slice(0, sep) === label || key.slice(sep + 1) === label) {
      edges.delete(key);
    }
  }
}

/** Forget a screen the caps dropped, everywhere it could still be named.
 *
 *  Dropping the node is not enough. `prevLabel` is the screen the NEXT change
 *  draws its edge FROM, and a screen can be evicted the moment it is first
 *  opened (a one-off among 200 well-travelled screens is the weakest thing on
 *  the map). Left alone, the next change would draw an edge out of a screen
 *  the map no longer holds, and no later eviction would remove it — the panel
 *  would draw an edge to a node it cannot show. */
function forgetDroppedScreens(): void {
  if (prevLabel !== null && !nodes.has(prevLabel)) prevLabel = null;
  for (const key of Array.from(edges.keys())) {
    const sep = key.indexOf(EDGE_SEP);
    if (
      sep <= 0 ||
      sep >= key.length - 1 ||
      !nodes.has(key.slice(0, sep)) ||
      !nodes.has(key.slice(sep + 1))
    ) {
      edges.delete(key);
    }
  }
}

function enforceCaps(): void {
  let droppedNode = false;
  while (nodes.size > MAX_MAP_NODES) {
    const key = weakest(nodes);
    if (key === null) break;
    nodes.delete(key);
    dropEdgesTouching(key);
    truncated = true;
    droppedNode = true;
  }
  while (edges.size > MAX_MAP_EDGES) {
    const key = weakest(edges);
    if (key === null) break;
    edges.delete(key);
    truncated = true;
  }
  // Only walks the edges when a screen actually went — the hot path pays
  // nothing until a cap bites.
  if (droppedNode) forgetDroppedScreens();
}

/**
 * Record one observed screen change. Consecutive duplicates are ignored, so a
 * screen never links to itself. In-memory only — the write is debounced onto
 * the flush cadence the kit already runs on.
 *
 * Guarded: recording must never crash the host app.
 */
export function noteScreen(name: string): void {
  try {
    const label = normalizeScreenLabel(name);
    if (label === null) {
      warnPartNameRefusal(
        typeof name === "string" && name.trim().length > MAX_PART_NAME
          ? "too-long"
          : "invalid",
      );
      return;
    }
    if (label === prevLabel) return;
    const from = prevLabel;
    prevLabel = label;
    bump(nodes, label);
    if (from !== null) bump(edges, from + EDGE_SEP + label);
    enforceCaps();
    dirty = true;
    scheduleFlush();
    announce(label);
  } catch {
    // the map must never break the host app
  }
}

/* ─── Telling a reading which screen it happened on ──────────────────── */

type ScreenChangeListener = (label: string) => void;
const screenListeners = new Set<ScreenChangeListener>();

/**
 * Be told when the app settles on a screen.
 *
 * Both navigation paths — React Navigation's `state` event and a host calling
 * `noteScreenChange()` itself — arrive here, and both arrive AFTER the commit
 * that mounted the screen. A reading taken during that render therefore
 * cannot name its own screen by asking; it has to be told, which is what this
 * is for.
 *
 * Returns the unsubscribe. Never throws, and a listener that throws is
 * contained here rather than reaching the host's navigation.
 */
export function subscribeScreenChange(fn: ScreenChangeListener): () => void {
  try {
    screenListeners.add(fn);
  } catch {
    return () => {};
  }
  return () => {
    try {
      screenListeners.delete(fn);
    } catch {
      /* ignore */
    }
  };
}

function announce(label: string): void {
  for (const fn of screenListeners) {
    try {
      fn(label);
    } catch {
      // a listener's fault is never the host's problem
    }
  }
}

/* ─── Reading ────────────────────────────────────────────────────────── */

/**
 * The screen the app is on right now, as last observed, or null when no
 * screen change has been seen yet.
 *
 * Null is a real answer and not a placeholder: before the navigation observer
 * has reported anything — a cold start, a host that never attached it — the
 * kit genuinely does not know which screen it is on, and a caller that
 * attributes a reading to a screen must be able to say so rather than invent
 * a name. Already normalized (`normalizeScreenLabel`), so a caller never
 * receives a path carrying an id.
 */
export function currentScreenLabel(): string | null {
  return prevLabel;
}

/** Map size + honesty flags. Read by the panel's completeness line. */
export function getScreenMapStats(): ScreenMapStats {
  let visits = 0;
  for (const rec of nodes.values()) visits += rec.count;
  return {
    screenCount: nodes.size,
    edgeCount: edges.size,
    visitCount: visits,
    truncated,
    persistence,
  };
}

/** The accumulated graph, busiest first. ON-DEVICE ONLY. */
export function getObservedGraph(): ObservedGraph {
  const nodeList = Array.from(nodes.entries())
    .map(([label, rec]) => ({ label, count: rec.count }))
    .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1));
  const edgeList: ObservedGraph["edges"] = [];
  for (const [key, rec] of edges) {
    const sep = key.indexOf(EDGE_SEP);
    if (sep <= 0 || sep >= key.length - 1) continue;
    // Only ever an edge between two screens the map still holds: handing out
    // an endpoint the node list dropped would put a screen back on the panel
    // that the cap says is gone.
    if (!nodes.has(key.slice(0, sep)) || !nodes.has(key.slice(sep + 1))) {
      continue;
    }
    edgeList.push({
      from: key.slice(0, sep),
      to: key.slice(sep + 1),
      count: rec.count,
    });
  }
  edgeList.sort((a, b) => b.count - a.count || (a.from < b.from ? -1 : 1));
  return { nodes: nodeList, edges: edgeList };
}

/* ─── Persistence (coalesced, never per navigation) ──────────────────── */

/** One derivation of "how is this map being kept", shared by the write path
 *  and the read-back path so the two can never disagree about the same store.
 *  A host store that declares nothing stays `unknown` — never guessed for. */
function describeStore(durable: boolean | undefined): ScreenMapPersistence {
  if (durable === true) return "stored";
  if (durable === false) return "memory-only";
  return "unknown";
}

interface StoredMap {
  v: 1;
  t: boolean;
  n: [string, number][];
  e: [string, string, number][];
}

/**
 * UTF-8 byte length of a string, counted by hand.
 *
 * The cap is a promise about BYTES on the device, and `String.length` counts
 * UTF-16 units: a screen named in Arabic, Japanese or emoji would be measured
 * at a third to a half of what it actually writes, so the stored map could sit
 * well over the cap while the code believed it was inside it. `TextEncoder` is
 * not assumed (Hermes does not always carry one) and this only ever runs on
 * the flush path, never on the navigation hot path.
 */
function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        n += 4; // surrogate PAIR — one 4-byte code point
        i++;
      } else {
        n += 3; // lone surrogate — replacement character
      }
    } else n += 3;
  }
  return n;
}

function serialize(): { json: string; shed: boolean } {
  const graph = getObservedGraph();
  let n = graph.nodes.map((x): [string, number] => [x.label, x.count]);
  let e = graph.edges.map((x): [string, string, number] => [
    x.from,
    x.to,
    x.count,
  ]);
  let shed = false;
  const render = (): string =>
    JSON.stringify({ v: 1, t: truncated || shed, n, e } satisfies StoredMap);
  let json = render();
  // Both lists are busiest-first, so dropping from the tail sheds the weakest.
  while (utf8Bytes(json) > MAX_MAP_STORED_BYTES && e.length > 0) {
    e = e.slice(0, e.length - Math.max(1, Math.ceil(e.length / 8)));
    shed = true;
    json = render();
  }
  while (utf8Bytes(json) > MAX_MAP_STORED_BYTES && n.length > 1) {
    n = n.slice(0, Math.max(1, n.length - Math.max(1, Math.ceil(n.length / 8))));
    shed = true;
    json = render();
  }
  return { json, shed };
}

/** Arm the debounced write. O(1) once armed — the navigation path never waits
 *  on the device store. */
function scheduleFlush(): void {
  if (flushTimer) return;
  try {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushScreenMap();
    }, FLUSH_DEBOUNCE_MS);
  } catch {
    // no timers here — the map stays in memory for this launch
  }
}

/** Write the accumulated map now. Safe to call repeatedly; a map that has not
 *  changed writes nothing. */
export async function flushScreenMap(): Promise<void> {
  try {
    if (!dirty) return;
    if (nodes.size === 0) return;
    const { json, shed } = serialize();
    if (shed) truncated = true;
    const store = platform().storage;
    await store.set(STORAGE_KEY, json);
    persistence = describeStore(store.persistent);
    dirty = false;
  } catch {
    // A store that refused the write must SAY so, not look saved.
    persistence = "unavailable";
  }
}

/**
 * Read what earlier launches drew and MERGE it into whatever this launch has
 * already seen (counts add), so the map grows rather than being replaced.
 * Idempotent — a second call is a no-op.
 */
export async function hydrateScreenMap(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await platform().storage.get(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<StoredMap> | null;
    if (!parsed || parsed.v !== 1) return;
    if (Array.isArray(parsed.n)) {
      for (const entry of parsed.n) {
        if (!Array.isArray(entry)) continue;
        const [label, count] = entry;
        if (typeof label !== "string" || !label) continue;
        if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) {
          continue;
        }
        seq++;
        const rec = nodes.get(label);
        if (rec) rec.count += Math.floor(count);
        else nodes.set(label, { count: Math.floor(count), seq });
      }
    }
    if (Array.isArray(parsed.e)) {
      for (const entry of parsed.e) {
        if (!Array.isArray(entry)) continue;
        const [from, to, count] = entry;
        if (typeof from !== "string" || !from) continue;
        if (typeof to !== "string" || !to) continue;
        if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) {
          continue;
        }
        // Never resurrect an edge whose screens the caps already dropped.
        if (!nodes.has(from) || !nodes.has(to)) continue;
        seq++;
        const key = from + EDGE_SEP + to;
        const rec = edges.get(key);
        if (rec) rec.count += Math.floor(count);
        else edges.set(key, { count: Math.floor(count), seq });
      }
    }
    if (parsed.t === true) truncated = true;
    // A map that came BACK is a map that was kept: saying "not saved yet"
    // here would describe a demonstrably kept map as an unknown. The store
    // still decides HOW it is kept — a host store that will not say whether
    // it keeps anything stays "unknown" rather than being guessed for.
    persistence = describeStore(platform().storage.persistent);
    enforceCaps();
  } catch {
    // Corrupt or unreadable — start from what this launch can see.
  }
}

/** @internal test hook — drop the accumulated map (memory AND device store)
 *  so no test inherits another's map. */
export async function _resetScreenMapForTests(): Promise<void> {
  nodes = new Map<string, Counted>();
  edges = new Map<string, Counted>();
  seq = 0;
  truncated = false;
  prevLabel = null;
  dirty = false;
  hydrated = false;
  persistence = "not-saved-yet";
  if (flushTimer) {
    try {
      clearTimeout(flushTimer);
    } catch {
      // ignore
    }
    flushTimer = null;
  }
  try {
    await platform().storage.remove(STORAGE_KEY);
  } catch {
    // ignore
  }
}
