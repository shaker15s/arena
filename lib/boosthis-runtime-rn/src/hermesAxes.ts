/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: Hermes runtime axes (React Native) ──────────────────────
 *
 * Five RN-exclusive, ADDITIVE, display-only meters about the Hermes JS engine.
 * Three are ENV-GATED and INVASIVE (they poll HermesInternal), so they are
 * ABSENT (not zero) unless the opt-in flag is set; two are cheap always-on
 * capability probes.
 *
 *   Env-gated on BOOSTHIS_HERMES_HEAP (absent when the flag is off):
 *     • heapHeadroom      — JS heap occupancy vs. the engine heap limit.
 *   Env-gated on BOOSTHIS_HERMES_GC (absent when the flag is off OR when the
 *   instrumented-stats GC fields aren't exposed by this Hermes version):
 *     • gcPressure        — share of time spent collecting since engine start.
 *     • gcTax             — the same share over a recent >=60 second window.
 *   Always-on capability probes (measurable:0 when the thing can't be observed):
 *     • hermesRuntime     — is this process actually running Hermes?
 *     • jsiCapability     — does the runtime expose a JSI sentinel?
 *
 * PIGGYBACK, NOT A NEW POLLER: the heap/GC checkpoints are captured by
 * sampleHermes(now), called from the EXISTING frame-sampler tick (like
 * sampleTimerCount). No new timer/loop is created. Sampling is a no-op unless
 * the corresponding env flag is set AND HermesInternal exposes the fields.
 *
 * HONESTY / INVARIANTS:
 *   • NEVER feed the composite Speed score (TTFF/TTI/FID). Display-only.
 *   • ENV OFF ⇒ ABSENT: the four polling axes return null (the caller omits
 *     them from the upload) when their flag is off — never a fabricated 0.
 *   • FIELDS ABSENT ⇒ GC axes ABSENT: if the Hermes version doesn't expose the
 *     GC-timing/count fields, gcPressure/gcTax stay null.
 *   • The capability probes report { measurable:0 } (uploaded) so the tile
 *     explains itself on a non-Hermes / no-JSI host instead of warming forever.
 *   • Numbers-only wire shapes throughout.
 *
 * GUEST-SAFETY: HermesInternal is read best-effort behind typeof guards; any
 * throw is swallowed and the axis reads pending. No host state is changed, no
 * API is wrapped. resetHermesSamples() is wired into telemetry.forget().
 */

import { linearScore, ratingFor, type AxisRating, type AxisThresholds } from "./axisScoring";
import { windowMinOf } from "./rateHonesty";
import { safeRun } from "./safe";
import { sayAfterStartupLine } from "./startAnnounce";

/* ─── Env gates ─────────────────────────────────────────────────────── */

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

/** Read an env flag from process.env or a global (mirrors runtimeFlags). */
function envFlag(name: string): boolean {
  try {
    if (typeof process !== "undefined" && process.env) {
      const v = process.env[name];
      if (typeof v === "string" && TRUE_VALUES.has(v.toLowerCase())) return true;
    }
    const g = globalThis as unknown as Record<string, string | boolean | undefined>;
    const gv = g[name];
    if (typeof gv === "boolean") return gv;
    if (typeof gv === "string" && TRUE_VALUES.has(gv.toLowerCase())) return true;
  } catch {
    /* best-effort */
  }
  return false;
}

export function heapMeterEnabled(): boolean {
  return envFlag("BOOSTHIS_HERMES_HEAP");
}
export function gcMeterEnabled(): boolean {
  return envFlag("BOOSTHIS_HERMES_GC");
}

/* ─── Thresholds ────────────────────────────────────────────────────── */

/** Percent of the engine heap limit in use. */
export const HEAP_HEADROOM_THRESHOLDS = { good: 60, poor: 90 } as const satisfies AxisThresholds;
/** Percent of wall-clock time spent collecting. Shared by lifetime and recent
 * collection readings because they are the same quantity over two windows. */
export const GC_PRESSURE_THRESHOLDS = { good: 1, poor: 10 } as const satisfies AxisThresholds;
export const GC_TAX_THRESHOLDS = GC_PRESSURE_THRESHOLDS;

/** A just-started engine is not yet an honest heap observation. */
const HEAP_MIN_ELAPSED_MS = 5_000;
/** Minimum GC observation window before the GC axes report (ms). */
const GC_MIN_WINDOW_MS = 60_000;
/** Cap on retained heap checkpoints (bounded memory). */
const HEAP_RING_CAP = 240;

/* ─── HermesInternal surface (all optional / version-dependent) ─────── */

interface HeapInfo {
  usedBytes?: number;
  totalBytes?: number;
  // Some Hermes versions use these instrumented-stats keys instead.
  js_allocatedBytes?: number;
  js_heapSize?: number;
}
interface HermesInternalLike {
  getHeapInfo?: () => HeapInfo;
  getInstrumentedStats?: () => Record<string, number>;
  hasPromise?: () => boolean;
}

function getHermes(): HermesInternalLike | null {
  try {
    const g = globalThis as unknown as { HermesInternal?: HermesInternalLike };
    const h = g.HermesInternal;
    if (h && typeof h === "object") return h;
  } catch {
    /* best-effort */
  }
  return null;
}

/* ─── Module state (checkpoints; populated only when enabled) ───────── */

interface HeapCheckpoint {
  t: number;      // monotonic ms
  usedMb: number;
  totalMb: number | null;
}
const heapCheckpoints: HeapCheckpoint[] = [];

interface GcCheckpoint {
  t: number;          // monotonic ms
  gcTimeMs: number;   // cumulative GC time (ms)
  gcCount: number;    // cumulative collections
}
let gcFirst: GcCheckpoint | null = null;
let gcLast: GcCheckpoint | null = null;
const gcCheckpoints: GcCheckpoint[] = [];

/** Throttle checkpoints to one per second (piggybacked on the frame tick). */
const HERMES_SAMPLE_THROTTLE_MS = 1_000;
let lastSampleAt = 0;

/** Read the used/total heap in bytes from whichever field this Hermes exposes.
 *  Returns null when no usable field is present. */
function readHeapBytes(h: HermesInternalLike): { used: number; total: number | null } | null {
  try {
    const info = typeof h.getHeapInfo === "function" ? h.getHeapInfo() : undefined;
    let used = info?.usedBytes ?? info?.js_allocatedBytes ?? info?.js_heapSize;
    let total = info?.totalBytes;
    if (typeof used !== "number") {
      const stats =
        typeof h.getInstrumentedStats === "function" ? h.getInstrumentedStats() : undefined;
      if (stats) {
        used = stats.js_allocatedBytes ?? stats.js_heapSize;
        total = total ?? stats.js_heapSize;
      }
    }
    if (typeof used !== "number" || used <= 0) return null;
    return { used, total: typeof total === "number" && total > 0 ? total : null };
  } catch {
    return null;
  }
}

/** Read cumulative GC time (ms) + collection count from instrumented stats.
 *  Returns null when the version doesn't expose usable GC fields. */
function readGcStats(h: HermesInternalLike): { gcTimeMs: number; gcCount: number } | null {
  try {
    const stats =
      typeof h.getInstrumentedStats === "function" ? h.getInstrumentedStats() : undefined;
    if (!stats) return null;
    // Hermes instrumented-stats key names vary by version; probe the common
    // ones. gcCPUTime/gc_totalTime are seconds on some builds → normalize to ms.
    const timeSec =
      stats.js_gcCPUTime ?? stats.js_totalGCTime ?? stats.gc_totalTime;
    const timeMs = stats.js_gcTimeMs ?? stats.js_totalGCTimeMs;
    const count = stats.js_numGCs ?? stats.js_numCollections ?? stats.gc_numCollections;
    let gcTimeMs: number | undefined;
    if (typeof timeMs === "number") gcTimeMs = timeMs;
    else if (typeof timeSec === "number") gcTimeMs = timeSec * 1000;
    if (typeof gcTimeMs !== "number" || typeof count !== "number") return null;
    if (gcTimeMs < 0 || count < 0) return null;
    return { gcTimeMs, gcCount: count };
  } catch {
    return null;
  }
}

/* ─── Missing runtime-source startup notice ─────────────────────────── */

type CauseProbe = () => string | null;
let heapCauseProbeForTests: CauseProbe | null = null;
let gcCauseProbeForTests: CauseProbe | null = null;
let sourceNoticeChecked = false;

function forcedCause(probe: CauseProbe): string | null {
  try {
    return probe();
  } catch {
    return null;
  }
}

/** Why the heap readers have no source, or null when Hermes is present. */
export function heapHeadroomMissingCause(): string | null {
  if (heapCauseProbeForTests) return forcedCause(heapCauseProbeForTests);
  return getHermes() === null ? "the app is not running on Hermes" : null;
}

/** Why the GC readers have no source, or null when its fields are readable.
 * A non-Hermes runtime is already covered by the heap/source part. */
export function gcTimingsMissingCause(): string | null {
  if (gcCauseProbeForTests) return forcedCause(gcCauseProbeForTests);
  const hermes = getHermes();
  if (hermes === null) return null;
  return readGcStats(hermes) === null
    ? "this Hermes build does not expose the GC timing and count fields"
    : null;
}

/** Pure wording builder: probing deliberately belongs to the caller. */
export function unreadableHermesSourcesLine(
  heapCause: string | null,
  gcCause: string | null,
): string | null {
  const parts: string[] = [];
  if (heapCause !== null) {
    parts.push(
      `heap headroom (${heapCause}): used and limit heap counters come from HermesInternal`,
    );
  }
  if (gcCause !== null) {
    parts.push(
      `garbage-collection pressure and tax (${gcCause}): cumulative garbage-collection time and collection count come from HermesInternal.getInstrumentedStats()`,
    );
  }
  if (parts.length === 0) return null;
  const tail =
    `. ${parts.length === 1 ? "That one meter stays" : "Those meters stay"}` +
    " absent for the life of this process; nothing else about Boosthis is affected.";
  if (parts.length === 1) {
    return `[boosthis] This React Native app cannot report ${parts[0]}${tail}`;
  }
  return (
    `[boosthis] This React Native app cannot report ${parts.length} of Boosthis's readings — ` +
    `${parts.join("; ")}${tail}`
  );
}

/** Judge all stable Hermes sources once per process and say at most one line. */
export function announceUnreadableHermesSources(): void {
  if (sourceNoticeChecked) return;
  sourceNoticeChecked = true;
  safeRun("hermes missing-source startup notice", () => {
    const line = unreadableHermesSourcesLine(
      heapHeadroomMissingCause(),
      gcTimingsMissingCause(),
    );
    if (line !== null) {
      safeRun("hermes missing-source startup notice output", () => {
        sayAfterStartupLine(line);
      });
    }
  });
}

/** Monotonic ms. */
function monoNow(): number {
  const p = (globalThis as unknown as { performance?: { now?: () => number } })
    .performance;
  return typeof p?.now === "function" ? p.now() : Date.now();
}

/**
 * Capture one Hermes heap/GC checkpoint at the caller's cadence (the frame
 * sampler tick). Throttled to one/second. Pure bookkeeping — NEVER throws.
 * No-op unless the corresponding env flag is set AND Hermes exposes the fields.
 */
export function sampleHermes(now: number): void {
  try {
    const wantHeap = heapMeterEnabled();
    const wantGc = gcMeterEnabled();
    if (!wantHeap && !wantGc) return;
    if (now - lastSampleAt < HERMES_SAMPLE_THROTTLE_MS) return;
    const h = getHermes();
    if (!h) return;
    lastSampleAt = now;
    if (wantHeap) {
      const bytes = readHeapBytes(h);
      if (bytes) {
        heapCheckpoints.push({
          t: now,
          usedMb: bytes.used / (1024 * 1024),
          totalMb: bytes.total != null ? bytes.total / (1024 * 1024) : null,
        });
        if (heapCheckpoints.length > HEAP_RING_CAP) heapCheckpoints.shift();
      }
    }
    if (wantGc) {
      const gc = readGcStats(h);
      if (gc) {
        const cp: GcCheckpoint = { t: now, gcTimeMs: gc.gcTimeMs, gcCount: gc.gcCount };
        gcCheckpoints.push(cp);
        // Keep the newest baseline that still provides a complete >=60s
        // window. This makes gcTax recent rather than a second lifetime mean.
        while (
          gcCheckpoints.length > 1 &&
          cp.t - gcCheckpoints[1].t >= GC_MIN_WINDOW_MS
        ) {
          gcCheckpoints.shift();
        }
        gcFirst = gcCheckpoints[0] ?? cp;
        gcLast = cp;
      }
    }
  } catch {
    /* best-effort */
  }
}

/* ─── Result shapes ─────────────────────────────────────────────────── */

export interface HeapHeadroomResult {
  score:      number;
  rating:     AxisRating;
  /** Heap occupancy (used/limit), as a percentage. */
  usedPct: number;
  usedMb:     number;
  limitMb:    number;
  elapsedMs:  number;
}

export interface GcPressureResult {
  score:      number;
  rating:     AxisRating;
  gcPct:      number;
  gcCount:    number;
  windowMin:  number;
}

export interface GcTaxResult {
  score:      number;
  rating:     AxisRating;
  gcPct:      number;
  gcCount:    number;
  windowMin:  number;
}

/** Capability-probe shapes — either a measurable verdict or {measurable:0}. */
export interface HermesRuntimeResult {
  /** 1 when Hermes is present, 0 when this is another engine. */
  present: 0 | 1;
  /** 1 when we could observe the engine at all. */
  measurable: 0 | 1;
  /** WHICH silence this axis has. Never a band: which engine is running is a
   *  fact, not a performance. "not-scored" says the answer is here and is
   *  deliberately never graded; "not-available" says the probe could not read
   *  the engine at all. Neither is "pending" — nothing further is coming. */
  rating: "not-scored" | "not-available";
}
export interface JsiCapabilityResult {
  /** 1 when a JSI sentinel is exposed, 0 when none is. */
  present: 0 | 1;
  measurable: 0 | 1;
  /** As above: a capability answered once, never scored — or, with no
   *  trustworthy sentinel to read, not available on this runtime. */
  rating: "not-scored" | "not-available";
}

/* ─── Readers (pure; never throw) ───────────────────────────────────── */

/** heapHeadroom — occupancy vs. the Hermes heap limit. */
export function readHeapHeadroom(): HeapHeadroomResult | null {
  try {
    if (!heapMeterEnabled()) return null;
    const withTotal = heapCheckpoints.filter((c) => c.totalMb != null && c.totalMb > 0);
    if (withTotal.length === 0) return null;
    const latest = withTotal[withTotal.length - 1];
    if (latest.t < HEAP_MIN_ELAPSED_MS) return null;
    const usedPct = Math.min(100, (latest.usedMb / (latest.totalMb as number)) * 100);
    const score = linearScore(
      usedPct,
      HEAP_HEADROOM_THRESHOLDS.good,
      HEAP_HEADROOM_THRESHOLDS.poor,
    );
    return {
      score,
      rating: ratingFor(score),
      usedPct: Math.round(usedPct * 10) / 10,
      usedMb: Math.round(latest.usedMb),
      limitMb: Math.round(latest.totalMb as number),
      elapsedMs: Math.round(latest.t),
    };
  } catch {
    return null;
  }
}

/** gcPressure — lifetime GC-time share. Warm until one collection exists. */
export function readGcPressure(): GcPressureResult | null {
  try {
    if (!gcMeterEnabled() || !gcLast || gcLast.gcCount < 1 || gcLast.t <= 0) return null;
    const gcPct = Math.min(100, (gcLast.gcTimeMs / gcLast.t) * 100);
    const score = linearScore(
      gcPct,
      GC_PRESSURE_THRESHOLDS.good,
      GC_PRESSURE_THRESHOLDS.poor,
    );
    return {
      score,
      rating: ratingFor(score),
      gcPct: Math.round(gcPct * 10) / 10,
      gcCount: Math.round(gcLast.gcCount),
      windowMin: windowMinOf(gcLast.t),
    };
  } catch {
    return null;
  }
}

/** gcTax — GC-time share between two counter reads at least 60 seconds apart. */
export function readGcTax(): GcTaxResult | null {
  try {
    if (!gcMeterEnabled()) return null;
    if (!gcFirst || !gcLast) return null;
    const windowMs = gcLast.t - gcFirst.t;
    if (windowMs < GC_MIN_WINDOW_MS) return null;
    const gcMs = Math.max(0, gcLast.gcTimeMs - gcFirst.gcTimeMs);
    const gcPct = Math.min(100, (gcMs / windowMs) * 100);
    const score = linearScore(
      gcPct,
      GC_TAX_THRESHOLDS.good,
      GC_TAX_THRESHOLDS.poor,
    );
    return {
      score,
      rating: ratingFor(score),
      gcPct: Math.round(gcPct * 10) / 10,
      gcCount: Math.max(0, Math.round(gcLast.gcCount - gcFirst.gcCount)),
      windowMin: windowMinOf(windowMs),
    };
  } catch {
    return null;
  }
}

/** hermesRuntime — always-on capability probe. Reports present:1 on Hermes,
 *  present:0 on another engine (measurable:1 either way, since we CAN tell). */
export function readHermesRuntime(): HermesRuntimeResult {
  try {
    const present = getHermes() != null ? 1 : 0;
    return { present, measurable: 1, rating: "not-scored" };
  } catch {
    return { present: 0, measurable: 0, rating: "not-available" };
  }
}

/** jsiCapability — always-on capability probe. A JSI sentinel is exposed by
 *  the new architecture (__turboModuleProxy) or by Hermes. When no trustworthy
 *  sentinel exists we report {measurable:0} so the tile explains itself. */
export function readJsiCapability(): JsiCapabilityResult {
  try {
    const g = globalThis as unknown as {
      __turboModuleProxy?: unknown;
      RN$Bridgeless?: boolean;
      HermesInternal?: unknown;
    };
    if (g.__turboModuleProxy != null || g.RN$Bridgeless === true) {
      return { present: 1, measurable: 1, rating: "not-scored" };
    }
    // Hermes always backs JSI, so its presence is a trustworthy sentinel too.
    if (g.HermesInternal != null) {
      return { present: 1, measurable: 1, rating: "not-scored" };
    }
    // No trustworthy sentinel — don't guess.
    return { present: 0, measurable: 0, rating: "not-available" };
  } catch {
    return { present: 0, measurable: 0, rating: "not-available" };
  }
}

/** Drop all Hermes checkpoints. Idempotent, never throws. Wired into
 *  telemetry.forget(). No host state was ever changed, so nothing to restore. */
export function resetHermesSamples(): void {
  heapCheckpoints.length = 0;
  gcFirst = null;
  gcLast = null;
  gcCheckpoints.length = 0;
  lastSampleAt = 0;
}

/** @internal test hooks — deterministic, no dependence on a real Hermes. */
export const _hermesInternals = {
  HEAP_HEADROOM_THRESHOLDS,
  GC_PRESSURE_THRESHOLDS,
  GC_TAX_THRESHOLDS,
  HEAP_MIN_ELAPSED_MS,
  GC_MIN_WINDOW_MS,
  /** Push a heap checkpoint (MB). */
  pushHeapForTests(usedMb: number, totalMb: number | null, t: number): void {
    heapCheckpoints.push({ t, usedMb, totalMb });
  },
  /** Set the GC first/last checkpoints directly. */
  setGcForTests(first: GcCheckpoint | null, last: GcCheckpoint | null): void {
    gcCheckpoints.length = 0;
    if (first) gcCheckpoints.push(first);
    if (last && last !== first) gcCheckpoints.push(last);
    gcFirst = first;
    gcLast = last;
  },
  setHeapCauseProbeForTests(probe: CauseProbe | null): void {
    heapCauseProbeForTests = probe;
  },
  setGcCauseProbeForTests(probe: CauseProbe | null): void {
    gcCauseProbeForTests = probe;
  },
  resetSourceNoticeForTests(): void {
    sourceNoticeChecked = false;
  },
  get heapCount(): number {
    return heapCheckpoints.length;
  },
  reset(): void {
    resetHermesSamples();
    heapCauseProbeForTests = null;
    gcCauseProbeForTests = null;
    sourceNoticeChecked = false;
  },
};
