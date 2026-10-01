/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: long-lived connection watcher (React Native) ─────────────
 *
 * The phone half of the Live Connections axis, and the sibling of the browser
 * and Node modules of the same name. Chat, presence, live dashboards,
 * notifications and streamed AI answers all hold ONE connection open for
 * minutes. Every other reading this kit takes is about something that started
 * and finished, so an app whose socket died twenty minutes ago looks exactly
 * as healthy as one whose socket is busy.
 *
 * WHAT IS WATCHED. The app's own `WebSocket` (and `EventSource`, when the app
 * has polyfilled one) constructor, wrapped guest-safely: the real constructor
 * is always called, its instance is always returned, and every listener we add
 * is added ON TOP of the app's own.
 *
 * PRIVACY. Counts, timestamps and durations only. A message's arrival is
 * counted; its content is never read, never measured, never stored — the
 * handler we add looks at nothing but the clock. The address is folded into a
 * 32-bit number the moment it is seen, kept only to recognise a reconnect to
 * the same place, and never uploaded.
 *
 * PHONE-SPECIFIC HONESTY. A backgrounded app has its sockets suspended by the
 * OS; that silence is not a fault and this module never judges it, because the
 * quiet verdict is only ever asked about connections the app itself still
 * holds open in the foreground.
 */

import { ratingFor, linearScore, type AxisRating } from "./axisScoring";
// Type-only: the row shape the diagnose pass collects. Importing the type
// (never the module) keeps one shape for every cross-cutting finding and
// adds no runtime edge between these two files.
import type { CrossCuttingFinding } from "./perfDiagnose";

import { earnedPerHour, earnedPerMin, windowMinOf } from "./rateHonesty";
/* ── Judgement constants — identical in the browser and Node kits ───────── */

/** Silence past this makes an open connection "quiet" and worth asking about. */
export const LIVECONN_QUIET_MS = 30_000;
/** Activity gaps needed before a connection's rhythm is known well enough to
 *  judge a silence against. Below this the reading abstains. */
export const LIVECONN_CADENCE_MIN_GAPS = 5;
/** Silence beyond this multiple of the connection's own typical gap is a stop,
 *  not a rest. */
export const LIVECONN_DEAD_GAP_MULTIPLE = 6;
/** A new connection to the same endpoint within this of the last one ending is
 *  a reconnect. */
export const LIVECONN_RECONNECT_LINK_MS = 60_000;
/** Window the reconnect-storm test looks back over. */
export const LIVECONN_STORM_WINDOW_MS = 60_000;
/** Reconnects inside that window before it counts as a storm. */
export const LIVECONN_STORM_THRESHOLD = 5;
/** Median reconnect gap below which there is no real back-off. */
export const LIVECONN_STORM_BACKOFF_MS = 2_000;
/** Minimum observation before the axis reports anything at all. Deliberately
 *  SHORTER than the earned-rate window (rateHonesty.ts): what this axis mostly
 *  reports — sockets open, dropped, quiet, never closed — is counted, not
 *  projected, and a dropped connection must be visible the moment it happens.
 *  Only the per-hour and per-minute fields wait for the longer window. */
export const LIVECONN_MIN_WINDOW_MS = 30_000;
/** How old an open connection must be to count toward "never closed". */
export const LIVECONN_LEAK_AGE_MS = 5 * 60_000;
/** How many such connections make "never closed" the likelier story. On a
 *  phone this is a much smaller number than on a server — a handset holding
 *  four sockets at once is already unusual. */
export const LIVECONN_LEAK_MIN_OPEN = 4;
/** Connections opened per screen change before "it reconnects every time you
 *  move" is the honest reading. */
export const LIVECONN_PER_SCREEN_RATIO = 0.8;
/** Screen changes needed before that ratio means anything. */
export const LIVECONN_PER_SCREEN_MIN = 5;
/** How soon after a screen change a new connection is CAUSED BY it. A screen
 *  that rebuilds its socket does so as it mounts; anything later is ordinary
 *  app behaviour. Without this window the test degrades into "connections ever
 *  opened ÷ screens ever changed", which faults an app that opened four feeds
 *  at launch and then moved through five screens without reconnecting once. */
export const LIVECONN_PER_SCREEN_WINDOW_MS = 5_000;
/** Unexpected disconnects per hour at or below which a connection is behaving
 *  normally — a phone changes network constantly, and a client that reopens
 *  immediately is not broken. The score and the wording of the caption read
 *  this one number, so the words can never name a fault the rating forgives. */
export const LIVECONN_DROPS_OK_PER_HOUR = 0.5;

const MAX_TRACKED = 100;
const MAX_GAPS = 64;
const MAX_REOPEN_STAMPS = 32;

interface Conn {
  endpoint: number;
  openedAt: number;
  lastSeenAt: number;
  gaps: number[];
  messages: number;
  closedAt: number | null;
  clean: boolean;
}

/** The reported axis wire shape. Nullable fields are OMITTED, never zeroed —
 *  a zero would be a claim we measured something we could not. */
export interface LiveConnectionsReading {
  /** Null while a term of the score depends on a rate the window has not
    *  earned. The counts beside it are still real — see rateHonesty.ts. */
  score: number | null;
  rating: AxisRating;
  caption: string;
  open: number;
  peakOpen: number;
  opened: number;
  closed: number;
  drops: number;
  reconnects: number;
  reconnectsPerHour: number | null;
  medianLifeMs: number;
  longestMs: number;
  stormCount: number;
  quiet: number;
  stalled: number;
  undecided: number;
  neverClosed: number;
  perScreen: number;
  windowMin: number;
  measurable: 1;
  flowMeasurable: 1;
  msgsPerMin: number | null;
}

let installed = false;
let observedAny = false;
let firstSeenAt = 0;
const conns: Conn[] = [];
const reopens = new Map<number, number[]>();
const lastEnd = new Map<number, number>();

let opened = 0;
let closed = 0;
let drops = 0;
let reconnects = 0;
let messages = 0;
let peakOpen = 0;
let stormPeak = 0;
/** Screen changes seen, and how many of them were FOLLOWED BY a new connection
 *  — the two halves of the "it rebuilds the socket on every screen" shape. */
let screenChanges = 0;
let screensFollowedByOpen = 0;
/** The screen change still waiting to be answered by a connection. Null before
 *  the first one — so nothing opened at launch is ever blamed on a screen
 *  change — and null again once one connection has answered it, so a screen
 *  that opens three sockets counts once. */
let pendingScreenAt: number | null = null;

let realWebSocket: unknown = null;
let realEventSource: unknown = null;
let now: () => number = () => Date.now();

function fold(input: unknown): number {
  let h = 0x811c9dc5;
  try {
    const s = String(input ?? "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
  } catch {
    return 0;
  }
  return h >>> 0;
}

function med(values: number[]): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

function medGap(ascending: number[]): number {
  if (ascending.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < ascending.length; i++) {
    gaps.push(ascending[i]! - ascending[i - 1]!);
  }
  return med(gaps);
}

function openCount(): number {
  let n = 0;
  for (const c of conns) if (c.closedAt === null) n++;
  return n;
}

function noteReopen(endpoint: number, at: number): void {
  let stamps = reopens.get(endpoint);
  if (!stamps) {
    if (reopens.size >= MAX_TRACKED) return;
    stamps = [];
    reopens.set(endpoint, stamps);
  }
  stamps.push(at);
  const cutoff = at - LIVECONN_STORM_WINDOW_MS;
  while (stamps.length > 0 && stamps[0]! < cutoff) stamps.shift();
  while (stamps.length > MAX_REOPEN_STAMPS) stamps.shift();
  if (
    stamps.length >= LIVECONN_STORM_THRESHOLD &&
    medGap(stamps) < LIVECONN_STORM_BACKOFF_MS &&
    stamps.length > stormPeak
  ) {
    stormPeak = stamps.length;
  }
}

function open(endpoint: number): Conn | null {
  const at = now();
  if (!observedAny) {
    observedAny = true;
    firstSeenAt = at;
  }
  opened++;
  if (
    pendingScreenAt !== null &&
    at - pendingScreenAt <= LIVECONN_PER_SCREEN_WINDOW_MS
  ) {
    screensFollowedByOpen++;
    pendingScreenAt = null;
  }
  const prev = lastEnd.get(endpoint);
  if (prev !== undefined && at - prev <= LIVECONN_RECONNECT_LINK_MS) {
    reconnects++;
    noteReopen(endpoint, at);
  }
  if (conns.length >= MAX_TRACKED) {
    const idx = conns.findIndex((c) => c.closedAt !== null);
    if (idx >= 0) conns.splice(idx, 1);
    else return null;
  }
  const conn: Conn = {
    endpoint,
    openedAt: at,
    lastSeenAt: at,
    gaps: [],
    messages: 0,
    closedAt: null,
    clean: false,
  };
  conns.push(conn);
  const live = openCount();
  if (live > peakOpen) peakOpen = live;
  return conn;
}

function activity(conn: Conn): void {
  const at = now();
  const gap = at - conn.lastSeenAt;
  if (gap > 0) {
    conn.gaps.push(gap);
    if (conn.gaps.length > MAX_GAPS) conn.gaps.shift();
  }
  conn.lastSeenAt = at;
  conn.messages++;
  messages++;
}

function close(conn: Conn, clean: boolean): void {
  try {
    if (conn.closedAt !== null) return;
    const at = now();
    conn.closedAt = at;
    conn.clean = clean;
    closed++;
    if (!clean) drops++;
    lastEnd.set(conn.endpoint, at);
  } catch {
    /* bookkeeping never disturbs the host */
  }
}

/** A screen change. Called from the kit's existing screen tracker — no new
 *  navigation listener, so an app using any router is covered identically. */
export function noteLiveConnectionScreenChange(): void {
  try {
    if (!installed) return;
    screenChanges++;
    // Now waiting to see whether this screen brings its own connection. Only
    // one opened inside the window that follows counts as caused by it.
    pendingScreenAt = now();
  } catch {
    /* best-effort */
  }
}

/* ── Wrapping the app's own transports ────────────────────────────────────*/

type Ctor = new (...args: unknown[]) => Record<string, unknown>;

function wrap(
  holder: Record<string, unknown>,
  key: string,
  /** Which close-event field carries the "was this clean" answer. */
  reader: (ev: unknown) => boolean,
): unknown | null {
  try {
    const Real = holder[key];
    if (typeof Real !== "function") return null;
    const RealCtor = Real as unknown as Ctor;

    const Wrapped = function BoosthisLiveConnection(
      this: unknown,
      ...args: unknown[]
    ): Record<string, unknown> {
      const instance = new RealCtor(...args);
      try {
        const conn = open(fold(args[0]));
        if (conn) {
          const add = (instance as { addEventListener?: unknown })
            .addEventListener;
          if (typeof add === "function") {
            // Listeners ADDED, never replaced: the app's own onmessage /
            // onclose keep working exactly as they did, and ours sees only
            // that an event happened.
            (add as (t: string, f: () => void) => void).call(
              instance,
              "message",
              () => {
                try {
                  activity(conn);
                } catch {
                  /* never disturb the app's handler */
                }
              },
            );
            (add as (t: string, f: (e: unknown) => void) => void).call(
              instance,
              "close",
              (ev: unknown) => {
                try {
                  close(conn, reader(ev));
                } catch {
                  /* ignore */
                }
              },
            );
            (add as (t: string, f: () => void) => void).call(
              instance,
              "error",
              () => {
                try {
                  close(conn, false);
                } catch {
                  /* ignore */
                }
              },
            );
          }
        }
      } catch {
        /* the app always gets its connection */
      }
      return instance;
    } as unknown as Ctor;

    copyStatics(RealCtor, Wrapped);
    holder[key] = Wrapped;
    return RealCtor;
  } catch {
    return null;
  }
}

/** Keep a wrapped constructor indistinguishable from the real one:
 *  `instanceof`, the readyState constants and any static the app reads must
 *  all still work, or wrapping it would itself be the bug. */
function copyStatics(from: Ctor, to: Ctor): void {
  try {
    to.prototype = from.prototype;
    for (const k of Object.getOwnPropertyNames(from)) {
      if (k === "prototype" || k === "name" || k === "length") continue;
      const d = Object.getOwnPropertyDescriptor(from, k);
      if (d) Object.defineProperty(to, k, d);
    }
  } catch {
    /* a static we cannot copy is not worth failing over */
  }
}

/** A server-sent stream needs its own lifecycle, not the socket one.
 *
 *  It RECONNECTS BY ITSELF and keeps the SAME object: on a lost connection it
 *  fires `error` with the state back at CONNECTING, waits its retry interval,
 *  then fires `open` again — usually forever, at a fixed interval, with no
 *  back-off of its own. One object is therefore a whole SERIES of connections,
 *  and a watcher that counted constructor calls would see a stream that opened
 *  once and never dropped: exactly the green-while-broken reading this axis
 *  exists to prevent. So each life is its own record — ended on the error,
 *  started again on the next `open` — which puts an auto-retrying stream into
 *  the drop, reconnect and storm counts like any other client, and keeps the
 *  reconnected stream in the census of what is open right now.
 *
 *  There is also no close EVENT in the standard, so the app's own `close()` is
 *  wrapped: only that counts as a goodbye. Without it an explicitly closed
 *  stream would sit in the census as open, and later be judged quiet or dead. */
function wrapEventSource(
  holder: Record<string, unknown>,
  key: string,
): unknown | null {
  try {
    const Real = holder[key];
    if (typeof Real !== "function") return null;
    const RealCtor = Real as unknown as Ctor;

    const Wrapped = function BoosthisLiveStream(
      this: unknown,
      ...args: unknown[]
    ): Record<string, unknown> {
      const instance = new RealCtor(...args);
      try {
        const endpoint = fold(args[0]);
        let live = open(endpoint);
        const add = (instance as { addEventListener?: unknown })
          .addEventListener;
        if (typeof add === "function") {
          const on = add as (t: string, f: (e: unknown) => void) => void;
          // The first `open` belongs to the record made above; every later one
          // is the platform having reconnected the stream on its own.
          on.call(instance, "open", () => {
            try {
              if (!live || live.closedAt !== null) live = open(endpoint);
            } catch {
              /* never disturb the app's handler */
            }
          });
          on.call(instance, "message", () => {
            try {
              if (live && live.closedAt === null) activity(live);
            } catch {
              /* ignore */
            }
          });
          // `error` is the only signal a stream gives when a life ends, and it
          // means one of two things: given up for good, or about to retry.
          // Neither was asked for by the app, so both end this life as a drop;
          // they differ only in whether an `open` follows.
          on.call(instance, "error", () => {
            try {
              if (live && live.closedAt === null) close(live, false);
            } catch {
              /* ignore */
            }
          });
        }
        const realClose = (instance as { close?: unknown }).close;
        if (typeof realClose === "function") {
          const shut = realClose as () => void;
          (instance as Record<string, unknown>).close = function (
            this: unknown,
          ) {
            try {
              if (live && live.closedAt === null) close(live, true);
            } catch {
              /* ignore */
            }
            return shut.call(this);
          };
        }
      } catch {
        /* the app always gets its stream */
      }
      return instance;
    } as unknown as Ctor;

    copyStatics(RealCtor, Wrapped);
    holder[key] = Wrapped;
    return RealCtor;
  } catch {
    return null;
  }
}

/** Start watching. Idempotent; never throws. */
export function installLiveConnections(): void {
  try {
    if (installed) return;
    installed = true;
    const g = globalThis as unknown as Record<string, unknown>;
    // A WebSocket close carries `wasClean`. React Native's implementation sets
    // it false for a dropped socket and true for a goodbye, which is exactly
    // the distinction the axis needs.
    realWebSocket = wrap(g, "WebSocket", (ev) => {
      const clean = (ev as { wasClean?: unknown } | null)?.wasClean;
      return clean !== false;
    });
    // EventSource is not part of React Native; it is watched only when the app
    // brought its own polyfill. It retries by itself on one object and has no
    // close event at all, so it gets its own lifecycle rather than the socket
    // one — see wrapEventSource.
    realEventSource = wrapEventSource(g, "EventSource");
  } catch {
    /* an app whose transports cannot be wrapped is simply not measured */
  }
}

/** Put the app's own constructors back and forget everything. Idempotent. */
export function uninstallLiveConnections(): void {
  try {
    const g = globalThis as unknown as Record<string, unknown>;
    if (realWebSocket) g.WebSocket = realWebSocket;
    if (realEventSource) g.EventSource = realEventSource;
  } catch {
    /* ignore */
  }
  realWebSocket = null;
  realEventSource = null;
  installed = false;
  resetLiveConnections();
}

/** Drop all counters without unwrapping. */
export function resetLiveConnections(): void {
  conns.length = 0;
  reopens.clear();
  lastEnd.clear();
  observedAny = false;
  firstSeenAt = 0;
  opened = 0;
  closed = 0;
  drops = 0;
  reconnects = 0;
  messages = 0;
  peakOpen = 0;
  stormPeak = 0;
  screenChanges = 0;
  screensFollowedByOpen = 0;
  pendingScreenAt = null;
}

/* ── Reading ──────────────────────────────────────────────────────────────*/

function judge(at: number): { quiet: number; stalled: number; undecided: number } {
  let quiet = 0;
  let stalled = 0;
  let undecided = 0;
  for (const c of conns) {
    if (c.closedAt !== null) continue;
    const silence = at - c.lastSeenAt;
    if (silence < LIVECONN_QUIET_MS) continue;
    quiet++;
    if (c.gaps.length < LIVECONN_CADENCE_MIN_GAPS) {
      // Nothing ever arrived regularly enough to learn a rhythm, which is what
      // an app with no heartbeat gives us. Abstain — a guess here would be
      // indistinguishable from a measurement to the person reading it.
      undecided++;
      continue;
    }
    const typical = med(c.gaps);
    if (typical <= 0) {
      undecided++;
      continue;
    }
    if (silence > typical * LIVECONN_DEAD_GAP_MULTIPLE) stalled++;
  }
  return { quiet, stalled, undecided };
}

function caption(s: {
  open: number;
  drops: number;
  dropsNamed: boolean;
  dropsUnjudged: boolean;
  stalled: number;
  undecided: number;
  storm: number;
  neverClosed: number;
  perScreen: number;
}): string {
  if (s.storm > 0) {
    return `${s.storm} reconnects in a minute with no widening gap \u2014 add back-off`;
  }
  if (s.stalled > 0) {
    return `${s.stalled} open but silent past its own rhythm \u2014 likely dead`;
  }
  if (s.perScreen === 1) {
    return "a new connection opens on almost every screen change";
  }
  if (s.neverClosed > 0) {
    return `${s.neverClosed} connections open for minutes and never closed`;
  }
  if (s.undecided > 0) {
    return `${s.undecided} quiet, and nothing arrives regularly enough to tell dead from resting`;
  }
  if (s.dropsNamed) {
    return `${s.open} open \u00b7 ${s.drops} dropped without a goodbye`;
  }
  if (s.dropsUnjudged) {
    // The drops are named; the verdict on them is not, because the window has
    // not earned the rate that verdict would rest on.
    return `${s.open} open \u00b7 ${s.drops} dropped \u2014 too early to say whether that is a normal rate`;
  }
  if (s.drops > 0) {
    // Stated, and NOT as a fault: this is the rate the score gives full marks
    // to, so calling it a fault would leave the words and the rating at odds.
    return `${s.open} open \u00b7 ${s.drops} brief drops, within the normal rate`;
  }
  return `${s.open} open \u00b7 none dropped`;
}

/** Score a connection reading against its band. Delegates to the kit's one
 *  checked scorer — this was a private copy of the interpolation with no band
 *  check in it, so a reversed pair reached a published verdict unrefused. */
function linear(value: number, good: number, poor: number): number {
  return linearScore(value, good, poor);
}

/**
 * The current reading, or null when there is nothing honest to say — this app
 * opened no long-lived connection, or the first one is younger than the
 * minimum window. An app with no realtime feature shows NOTHING here.
 */
export function readLiveConnections(): LiveConnectionsReading | null {
  try {
    if (!installed || !observedAny) return null;
    const at = now();
    const elapsed = Math.max(0, at - firstSeenAt);
    if (elapsed < LIVECONN_MIN_WINDOW_MS) return null;
    // The window as it really is. Rounding thirty seconds up to "1m observed"
    // would put a minute we never watched into the caption and the payload.
    const windowMin = windowMinOf(elapsed);
    const hours = elapsed / 3_600_000;

    const live = conns.filter((c) => c.closedAt === null);
    const ended = conns.filter((c) => c.closedAt !== null);
    const lives = ended.map((c) => (c.closedAt as number) - c.openedAt);
    let longestMs = 0;
    for (const c of conns) {
      const life = (c.closedAt ?? at) - c.openedAt;
      if (life > longestMs) longestMs = life;
    }

    const v = judge(at);
    const storm = stormPeak >= LIVECONN_STORM_THRESHOLD ? stormPeak : 0;
    const aged = live.filter((c) => at - c.openedAt >= LIVECONN_LEAK_AGE_MS).length;
    const neverClosed =
      live.length >= LIVECONN_LEAK_MIN_OPEN && aged >= LIVECONN_LEAK_MIN_OPEN
        ? aged
        : 0;
    // A connection opened for nearly every screen change is the "it reconnects
    // when you move" shape — a boolean, because the ratio itself is noisy and
    // the fix is the same at any value above the line. Both halves are
    // attributed: the numerator counts screen changes ANSWERED by a new
    // connection, never connections in general, so feeds opened at launch and
    // connections opened mid-screen are not blamed on navigation.
    const perScreen =
      screenChanges >= LIVECONN_PER_SCREEN_MIN &&
      screensFollowedByOpen / screenChanges >= LIVECONN_PER_SCREEN_RATIO
        ? 1
        : 0;

    // A quarter of this score is a per-hour drop rate, so until the window
    // has earned that projection there is no honest score to publish: a
    // substituted zero would rate a short look with real drops as healthy.
    // The counts, the window and every directly observed fault below are
    // reported either way — only the judgement waits.
    const dropsPerHour = earnedPerHour(drops, elapsed);
    // Drops are the one fault with an honest tolerance, so the caption and the
    // rating have to agree about where that tolerance ends.
    const dropsNamed =
      dropsPerHour !== null && drops > 0 && dropsPerHour > LIVECONN_DROPS_OK_PER_HOUR;
    const dropsUnjudged = dropsPerHour === null && drops > 0;
    const score =
      dropsPerHour === null
        ? null
        : Math.round(
            0.35 * linear(dropsPerHour, LIVECONN_DROPS_OK_PER_HOUR, 12) +
              0.3 * (v.stalled === 0 ? 100 : v.stalled === 1 ? 40 : 0) +
              0.2 * (storm === 0 ? 100 : 0) +
              0.15 * (neverClosed === 0 && perScreen === 0 ? 100 : 0),
          );

    // A reading that NAMES a problem may not also rate "good" — see the same
    // rule, and the same reasoning, in the browser kit. Kept identical so one
    // client behaving one way is judged one way on both ends.
    const namesAProblem =
      storm > 0 || v.stalled > 0 || perScreen === 1 || neverClosed > 0 || dropsNamed;
    const banded = score === null ? "pending" : ratingFor(score);
    const rating: AxisRating =
      namesAProblem && banded === "good" ? "needs-work" : banded;

    return {
      score,
      rating,
      caption: caption({
        open: live.length,
        drops,
        dropsNamed,
        dropsUnjudged,
        stalled: v.stalled,
        undecided: v.undecided,
        storm,
        neverClosed,
        perScreen,
      }),
      open: live.length,
      peakOpen,
      opened,
      closed,
      drops,
      reconnects,
      reconnectsPerHour: earnedPerHour(reconnects, elapsed),
      medianLifeMs: Math.round(med(lives)),
      longestMs: Math.round(longestMs),
      stormCount: storm,
      quiet: v.quiet,
      stalled: v.stalled,
      undecided: v.undecided,
      neverClosed,
      perScreen,
      windowMin,
      measurable: 1,
      // Both transports the phone kit watches deliver whole messages, so the
      // rate is genuinely knowable here — unlike a raw upgraded socket on the
      // server, which only yields bytes.
      flowMeasurable: 1,
      msgsPerMin: earnedPerMin(messages, elapsed),
    };
  } catch {
    return null;
  }
}

/** The findings this watcher raises, each naming a DIFFERENT fix. Read from
 *  the same counters the axis reports, so the tile and the issue list can
 *  never tell a developer two different stories. */
export function collectLiveConnectionFindings(): CrossCuttingFinding[] {
  const out: CrossCuttingFinding[] = [];
  try {
    if (!installed || !observedAny) return out;
    const at = now();
    if (stormPeak >= LIVECONN_STORM_THRESHOLD) {
      out.push({
        kind: "reconnect-storm",
        name: "realtime",
        p95: LIVECONN_STORM_WINDOW_MS,
        count: stormPeak,
        hint: "The app reconnected repeatedly with no widening gap between attempts.",
      });
    }
    const v = judge(at);
    if (v.stalled > 0) {
      out.push({
        kind: "connection-stalled",
        name: "realtime",
        p95: LIVECONN_QUIET_MS,
        count: v.stalled,
        hint: "A connection is open but has gone silent far past its own rhythm.",
      });
    }
    const live = conns.filter((c) => c.closedAt === null);
    const aged = live.filter((c) => at - c.openedAt >= LIVECONN_LEAK_AGE_MS).length;
    if (live.length >= LIVECONN_LEAK_MIN_OPEN && aged >= LIVECONN_LEAK_MIN_OPEN) {
      out.push({
        kind: "connection-leak",
        name: "realtime",
        p95: LIVECONN_LEAK_AGE_MS,
        count: aged,
        hint: "Long-lived connections are piling up and nothing is closing them.",
      });
    }
    if (
      screenChanges >= LIVECONN_PER_SCREEN_MIN &&
      screensFollowedByOpen / screenChanges >= LIVECONN_PER_SCREEN_RATIO
    ) {
      out.push({
        kind: "reconnect-per-screen",
        name: "realtime",
        p95: 0,
        count: screensFollowedByOpen,
        hint: "A new connection is opened almost every time the screen changes.",
      });
    }
  } catch {
    return out;
  }
  return out;
}

/* ── Test seams ───────────────────────────────────────────────────────────*/

export function _setLiveConnectionsClockForTests(fn: (() => number) | null): void {
  now = fn ?? (() => Date.now());
}

export const _liveConnectionsInternals = {
  open,
  close,
  activity,
  judge,
  markInstalled(on: boolean): void {
    installed = on;
  },
};
