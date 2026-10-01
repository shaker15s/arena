/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * ── The watched time a restart may not erase ──────────────────────────────
 *
 * Seven readings in this kit are RATES — events per hour. A rate may not be
 * published until the observation window has earned the projection
 * (`rateHonesty.ts`: five minutes for a per-hour figure, a twelvefold ceiling
 * on any extrapolation). That rule is correct and does not move here.
 *
 * What moves is the window's SCOPE. Until this file existed, the window had to
 * be earned inside ONE run of the app, and a phone app is used in bursts of a
 * few minutes: our own app's longest recent session is 278 seconds. Every one
 * of those seven axes therefore stayed pending permanently on every phone, no
 * matter how much we measured, because the device threw away everything it had
 * watched each time the app closed.
 *
 * So the device banks it. Each run writes what it watched and what it counted
 * into this app's own store; the next launch reads it back and adds it to what
 * it can see itself. The rate is earned from the total.
 *
 * This is the same answer, for the same reasons, that the Node kit's crash
 * history gives for `crashFree`
 * (`lib/boosthis-runtime-node/src/crashDelivery.ts`), and the reasoning is
 * recorded once in `docs/decisions/rate-window-earned-across-sessions.md`.
 *
 * WHAT THIS FILE IS NOT ALLOWED TO DO:
 *
 *   • It never crosses an app, a device or a project. The store lives inside
 *     ONE app's own sandbox on ONE device, and the ledger is stamped with the
 *     project it was earned under and dropped whole when that changes.
 *   • It holds NUMBERS only — durations and counts. No label, no address, no
 *     identifier, nothing a person could be read out of.
 *   • It decides nothing about liveness. Whether an install is running is
 *     still answered by that install's own arrivals, per install, unchanged.
 *   • It is a LEAF. Nothing here imports an axis, a reader or the module that
 *     assembles them — a shared helper that lives among its users is how a
 *     module cycle starts.
 *
 * ── The obligation lists this store joins, and the ones it does not ───────
 *
 * A new place that keeps a measurement has to be walked against every
 * hand-kept list that carries a data obligation, because none of them is
 * derived and all of them stay green while a new store is missing from them.
 * Walked here once, so the next reader is not left guessing which omissions
 * were decided and which were forgotten:
 *
 *   • ERASURE — JOINED. `forget()` calls `clearWatchHistory()` alongside the
 *     credentials and the reach tag: erasure leaves nothing Boosthis-shaped
 *     on the device, and a banked window is as much "behind" as a cached
 *     token is.
 *   • RETENTION — JOINED, and it is the window above. Every read prunes to
 *     the last 24 hours and to a bounded ring, so nothing here outlives the
 *     window a surface says it covers. There is no sweep to register,
 *     because nothing survives a read that the window no longer covers.
 *   • THE SERVER'S EXPORT, CLOSURE, PURGE AND REMOVAL MAP — NOT JOINED, and
 *     the reason is that this is not a server store. No table is added, no
 *     row of ours holds any of it, and the customer's own export already
 *     contains everything we hold. A list that says what OUR database does
 *     with a row has nothing to say about a file in the customer's app
 *     sandbox that we can neither read nor delete.
 *   • THE WIRE ALLOWLIST — NOT JOINED, because no new field travels. The
 *     pooled figures ride the numeric snapshot fields the seven axes already
 *     send (`windowMin`, `runsInWindow`, `observedMin`), each already
 *     allowlisted and already enforced as a plain number.
 *   • THE PUBLISHED COLLECTION DISCLOSURE — NOT JOINED, deliberately. It
 *     states what the kit SENDS, and what is sent is unchanged in kind:
 *     durations and counts, already covered. The one device-side store the
 *     terms do name — the daily reach tag — is named because it is an
 *     identifier that could in principle follow a device. This one holds no
 *     identifier at all, exactly like the page map's own local store, which
 *     is likewise not separately disclosed.
 */

import { platform } from "./perfPlatform";

/* ─── The window ───────────────────────────────────────────────────── */

/**
 * How far back a banked window reaches: 24 hours.
 *
 * A window has to be stated, because both ways of not stating one are wrong.
 * A window that covers only the current run vanishes at exactly the moment it
 * matters — that is the defect this file exists to fix. A window that covers
 * all of history condemns an app for hangs it fixed a month ago and can never
 * read clean again.
 *
 * Twenty-four hours is long enough that ordinary phone use earns it — a
 * handful of four-minute sessions clears the five-minute minimum easily — and
 * short enough that a day of health answers for yesterday's trouble. Every
 * surface that renders one of these readings says which window it covers.
 *
 * Deliberately the same number as the Node kit's `CRASH_HISTORY_WINDOW_MS`:
 * two kits quoting different windows for the same `crashFree` axis would be
 * one product with two answers.
 */
export const WATCH_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Bound the ring. An app relaunched in a tight loop may not grow this store
 * without limit. Overflow is COUNTED, so a reading says "at least N runs"
 * rather than quietly under-reporting how many it spans.
 */
const MAX_HISTORY_RUNS = 48;

/** Don't write more often than this. The banked figures move by seconds; the
 *  store is on the interface thread's storage and this is not worth a write
 *  per frame. A background transition flushes immediately regardless. */
const MIN_WRITE_GAP_MS = 10_000;

const STORAGE_KEY = "boosthis.watchHistory.v1";

/* ─── What one run banked ──────────────────────────────────────────── */

/**
 * One run's contribution, in the two clocks and the six counts the seven
 * rate axes are built from.
 *
 * Two clocks, not one, because the axes genuinely read two: the frame
 * sampler's confirmed-foreground `activeMs` (appHang, frozenFrames,
 * unhandledErrors) and the AppState listener's own foreground clock
 * (dimensionChurn, appearanceChurn, foregroundResidency). They are measured
 * by different sensors and either can be absent while the other runs, so
 * folding them into one number would hand an axis a window its own sensor
 * never watched.
 */
export interface RunWatch {
  /** Lifecycle foreground ms — the AppState clock. */
  foregroundMs: number;
  /** Lifecycle OBSERVED ms — foreground plus bounded background. The
   *  denominator of the residency share, which is why it banks separately. */
  observedMs: number;
  /** Frame-sampler confirmed-foreground ms. */
  frameActiveMs: number;
  /** Time the crash hook has been installed and watching. */
  crashWatchMs: number;
  hangs: number;
  frozenFrames: number;
  unhandledErrors: number;
  crashes: number;
  dimensionChanges: number;
  appearanceChanges: number;
}

/** Short keys on disk: this file is rewritten every few minutes for the life
 *  of the app, and the long names above would be most of its bytes. */
interface RunEntry {
  /** Run identity — the run's own start (wall clock). */
  r: number;
  /** When this entry was last refreshed (wall clock). Ages out of the window
   *  on this stamp, so a run that ended yesterday stops counting today. */
  t: number;
  fg: number;
  ob: number;
  fa: number;
  cw: number;
  hg: number;
  fz: number;
  er: number;
  cr: number;
  dm: number;
  ap: number;
}

interface HistoryFile {
  /** Which project these runs were watched under. A ledger earned under a
   *  different project key is not this project's evidence, and is dropped
   *  whole rather than pooled. */
  k: string;
  runs: RunEntry[];
  /** Entries that fell off the RING (not out of the window). */
  dropped: number;
}

/* ─── What a reader gets back ──────────────────────────────────────── */

/**
 * The banked total from EARLIER runs inside the window. The current run is
 * deliberately excluded: its live values are in memory, they are newer than
 * anything on disk, and adding both would count this run twice.
 */
export interface BankedWatch {
  /** The window these totals cover (ms). */
  windowMs: number;
  /** False when no history could be read at all — a first launch, a store
   *  that does not persist, an unreadable file, a different project. The
   *  caller then has only this run and must not pretend otherwise. */
  recorded: boolean;
  /** Earlier runs of this app inside the window. More than zero means a
   *  reading spans a restart, which a per-run reading can never show. */
  runs: number;
  /** True when older runs fell off the ring, so `runs` is a floor. */
  runsAtLeast: boolean;
  foregroundMs: number;
  observedMs: number;
  frameActiveMs: number;
  crashWatchMs: number;
  hangs: number;
  frozenFrames: number;
  unhandledErrors: number;
  crashes: number;
  dimensionChanges: number;
  appearanceChanges: number;
}

/** Nothing banked. Returned wherever the history cannot be read, so every
 *  caller gets the same shape and the pre-banking behaviour falls straight
 *  out of it: add zero to this run and the reading is what it always was. */
export const NO_BANKED_WATCH: BankedWatch = Object.freeze({
  windowMs: WATCH_HISTORY_WINDOW_MS,
  recorded: false,
  runs: 0,
  runsAtLeast: false,
  foregroundMs: 0,
  observedMs: 0,
  frameActiveMs: 0,
  crashWatchMs: 0,
  hangs: 0,
  frozenFrames: 0,
  unhandledErrors: 0,
  crashes: 0,
  dimensionChanges: 0,
  appearanceChanges: 0,
});

/* ─── State ────────────────────────────────────────────────────────── */

/** The in-memory mirror. Storage here is asynchronous and a reading is taken
 *  synchronously, so the file is read ONCE at start-up and answered from
 *  memory afterwards. Null until `armWatchHistory()` has resolved — which is
 *  what `recorded: false` reports, and why an early reading is this run's
 *  alone rather than a fabricated total. */
let mirror: HistoryFile | null = null;
/** This run's identity, and the key it is being watched under. */
let runId = 0;
let projectScope = "";
let armed = false;
let lastWriteAt = 0;
let writing = false;
/** Reads the live counters for this run. Registered by the module that can
 *  see all of them; absent in a kit whose snapshot path never started. */
let sampler: (() => RunWatch | null) | null = null;

/* ─── Helpers ──────────────────────────────────────────────────────── */

function n(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * A short, non-reversible fingerprint of the project key, so the ledger can
 * tell "still the same project" from "somebody rotated the key" without the
 * key itself ever reaching the store. FNV-1a, 32 bits, hex — an equality
 * marker and nothing more: it identifies no person, and it cannot be read
 * back into the key it came from.
 */
export function watchScopeOf(projectKey: string | null | undefined): string {
  const s = typeof projectKey === "string" ? projectKey : "";
  if (s === "") return "";
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function parseFile(raw: string, scope: string): HistoryFile {
  const empty: HistoryFile = { k: scope, runs: [], dropped: 0 };
  try {
    const o = JSON.parse(raw) as Partial<HistoryFile> | null;
    if (!o || typeof o !== "object" || !Array.isArray(o.runs)) return empty;
    // A ledger earned under another project is not this project's evidence.
    // Dropped whole rather than migrated: the runs really did happen, but not
    // here, and pooling them would be the one crossing this file forbids.
    if (typeof o.k === "string" && o.k !== scope) return empty;
    const runs: RunEntry[] = [];
    for (const e of o.runs) {
      const r = e as Partial<RunEntry> | null;
      if (!r || typeof r !== "object") continue;
      const id = n(r.r);
      const at = n(r.t);
      if (id <= 0 || at <= 0) continue;
      runs.push({
        r: id,
        t: at,
        fg: n(r.fg),
        ob: n(r.ob),
        fa: n(r.fa),
        cw: n(r.cw),
        hg: n(r.hg),
        fz: n(r.fz),
        er: n(r.er),
        cr: n(r.cr),
        dm: n(r.dm),
        ap: n(r.ap),
      });
    }
    return {
      k: scope,
      runs,
      dropped: n(o.dropped),
    };
  } catch {
    return empty;
  }
}

/** Drop what the window no longer covers, then bound the ring. Ageing OUT of
 *  the window is not an omission — the reading does not claim to cover it.
 *  Falling off the RING is, and is counted. */
function prune(file: HistoryFile, now: number): HistoryFile {
  const from = now - WATCH_HISTORY_WINDOW_MS;
  let runs = file.runs.filter((e) => e.t >= from && e.t <= now + 60_000);
  let dropped = file.dropped;
  if (runs.length > MAX_HISTORY_RUNS) {
    // Newest kept: the oldest evidence is the least relevant to a
    // current-health reading, and it is the half already closest to ageing
    // out of the window on its own.
    runs = runs.slice(-MAX_HISTORY_RUNS);
    dropped += file.runs.length - runs.length;
  }
  return { k: file.k, runs, dropped };
}

async function persist(): Promise<void> {
  if (!mirror || writing) return;
  writing = true;
  try {
    lastWriteAt = Date.now();
    await platform().storage.set(STORAGE_KEY, JSON.stringify(mirror));
  } catch {
    /* a ledger that cannot be written simply reports nothing banked next
       launch; it never breaks the host app */
  } finally {
    writing = false;
  }
}

/* ─── The public surface ───────────────────────────────────────────── */

/**
 * Register the reader for this run's live counters.
 *
 * Kept as a registration rather than an import so this file stays a leaf: the
 * counters live in the frame sampler, the lifecycle listener, the error hooks
 * and the crash reporter, and importing all four here would put a shared
 * helper in the middle of the graph it is supposed to sit under.
 */
export function registerWatchSampler(fn: (() => RunWatch | null) | null): void {
  sampler = fn;
}

/**
 * Read the history back, once, and start banking this run.
 *
 * `projectKey` scopes the ledger. Passing nothing scopes it to the empty
 * string, which is a perfectly good scope for a kit that has not been given a
 * key yet — it simply will not pool with a run that HAS one.
 */
export async function armWatchHistory(opts?: {
  projectKey?: string | null;
  now?: number;
}): Promise<void> {
  const now = n(opts?.now) || Date.now();
  projectScope = watchScopeOf(opts?.projectKey);
  runId = now;
  armed = true;
  try {
    const raw = await platform().storage.get(STORAGE_KEY);
    mirror = prune(
      raw === null ? { k: projectScope, runs: [], dropped: 0 } : parseFile(raw, projectScope),
      now,
    );
  } catch {
    // Unreadable is not empty, but for a caller it comes to the same thing:
    // there is nothing to add, and `recorded` stays false until something is
    // actually banked.
    mirror = { k: projectScope, runs: [], dropped: 0 };
  }
}

/** Has the ledger been read back yet? Exposed so a caller can tell "nothing
 *  banked" from "not asked yet" without inspecting the mirror. */
export function watchHistoryArmed(): boolean {
  return armed && mirror !== null;
}

/**
 * Bank what this run has watched so far.
 *
 * Idempotent and monotonic in effect: the current run has exactly one entry
 * and it is REPLACED, never appended to, so calling this on every snapshot
 * and again on every backgrounding cannot inflate anything.
 */
export function bankRunWatch(w: RunWatch, now: number = Date.now()): void {
  if (!mirror || !armed) return;
  try {
    const entry: RunEntry = {
      r: runId,
      t: now,
      fg: n(w.foregroundMs),
      ob: n(w.observedMs),
      fa: n(w.frameActiveMs),
      cw: n(w.crashWatchMs),
      hg: n(w.hangs),
      fz: n(w.frozenFrames),
      er: n(w.unhandledErrors),
      cr: n(w.crashes),
      dm: n(w.dimensionChanges),
      ap: n(w.appearanceChanges),
    };
    const others = mirror.runs.filter((e) => e.r !== runId);
    mirror = prune({ k: mirror.k, runs: [...others, entry], dropped: mirror.dropped }, now);
  } catch {
    /* never let bookkeeping break a reading */
  }
}

/**
 * Bank NOW, and write it out immediately.
 *
 * Called on the way to the background, which is the transition an app may
 * never come back from: everything measured since the last write is lost if
 * this does not run, and on a four-minute session that is most of it.
 */
export function flushWatchNow(now: number = Date.now()): void {
  if (!mirror || !armed) return;
  try {
    const w = sampler ? sampler() : null;
    if (w) bankRunWatch(w, now);
    void persist();
  } catch {
    /* best-effort */
  }
}

/** Bank, and write only if the write gap has elapsed. The cadence path. */
export function bankAndMaybePersist(w: RunWatch, now: number = Date.now()): void {
  bankRunWatch(w, now);
  if (now - lastWriteAt >= MIN_WRITE_GAP_MS) void persist();
}

/**
 * What EARLIER runs of this app banked inside the window.
 *
 * The current run is excluded — its live counters are what the caller already
 * holds, and they are newer than anything written here.
 */
export function bankedWatch(now: number = Date.now()): BankedWatch {
  if (!mirror) return NO_BANKED_WATCH;
  try {
    const from = now - WATCH_HISTORY_WINDOW_MS;
    const earlier = mirror.runs.filter((e) => e.r !== runId && e.t >= from);
    if (earlier.length === 0) {
      // Nothing banked, but the ledger WAS read: `recorded` stays false all
      // the same. A caller may only say "we have looked back" when there is
      // something behind the claim.
      return NO_BANKED_WATCH;
    }
    let fg = 0, ob = 0, fa = 0, cw = 0, hg = 0, fz = 0, er = 0, cr = 0, dm = 0, ap = 0;
    for (const e of earlier) {
      fg += e.fg; ob += e.ob; fa += e.fa; cw += e.cw;
      hg += e.hg; fz += e.fz; er += e.er; cr += e.cr; dm += e.dm; ap += e.ap;
    }
    return {
      windowMs: WATCH_HISTORY_WINDOW_MS,
      recorded: true,
      runs: earlier.length,
      runsAtLeast: mirror.dropped > 0,
      foregroundMs: fg,
      observedMs: ob,
      frameActiveMs: fa,
      crashWatchMs: cw,
      hangs: hg,
      frozenFrames: fz,
      unhandledErrors: er,
      crashes: cr,
      dimensionChanges: dm,
      appearanceChanges: ap,
    };
  } catch {
    return NO_BANKED_WATCH;
  }
}

/**
 * Erase the ledger.
 *
 * Wired into `forget()` alongside every other store this kit keeps: erasure
 * leaves nothing Boosthis-shaped behind on the device, and a banked window is
 * as much "behind" as a cached credential is.
 */
export async function clearWatchHistory(): Promise<void> {
  mirror = null;
  armed = false;
  runId = 0;
  lastWriteAt = 0;
  try {
    await platform().storage.remove(STORAGE_KEY);
  } catch {
    /* best-effort */
  }
}

/** Test seam. Never imported by shipping code. */
export const _watchHistoryInternals = {
  STORAGE_KEY,
  MAX_HISTORY_RUNS,
  MIN_WRITE_GAP_MS,
  reset(): void {
    mirror = null;
    armed = false;
    runId = 0;
    projectScope = "";
    lastWriteAt = 0;
    writing = false;
    sampler = null;
  },
  runId(): number {
    return runId;
  },
  scope(): string {
    return projectScope;
  },
  entries(): number {
    return mirror ? mirror.runs.length : -1;
  },
  async persistNow(): Promise<void> {
    await persist();
  },
};
