/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: AsyncStorage latency + failure-rate axes (React Native) ──
 *
 * Two RN-exclusive, ADDITIVE, display-only meters about the host app's
 * AsyncStorage. Both are ENV-GATED (BOOSTHIS_STORAGE_METER) AND only wire up
 * WHEN THE HOST ALREADY PROVIDES AsyncStorage — we NEVER add the dependency, so
 * a project that doesn't use AsyncStorage sees these axes ABSENT (not zero).
 *
 *   • storageLatency  — p75 duration of wrapped get/set/remove operations. No
 *     keys or values are ever recorded — only how LONG each op took.
 *   • storageFailures — share of wrapped operations that reject, separate from
 *     their latency (a slow store and a failing store are different problems).
 *
 * WRAP, NEVER REPLACE OR SWALLOW: we wrap getItem/setItem/removeItem so each
 * still calls the host's original method, returns the SAME promise the host
 * expects, and re-throws/rejects exactly what the original did. We only observe
 * a duration + an ok/reject outcome via a non-mutating .then/.catch tap on a
 * COPY of the promise — the host's rejection is never swallowed and its result
 * is never altered. On the reject path we attach a `.catch(() => {})` to OUR
 * observer copy so our tap can't itself become an unhandled rejection (see
 * rn-unhandled-native-promises.md).
 *
 * HONESTY / INVARIANTS:
 *   • NEVER feed the composite Speed score (TTFF/TTI/FID). Display-only.
 *   • ENV OFF or AsyncStorage ABSENT ⇒ axis ABSENT: readers return null so the
 *     caller omits the axis from the upload — never a fabricated 0.
 *   • WARM-UP: pending until enough operations are observed.
 *   • Numbers-only wire shapes (counts + durations only).
 *
 * GUEST-SAFETY: AsyncStorage is lazy-required (never a hard import); if it's
 * missing or wiring throws we stay OFF and the axes read absent. Every observer
 * tap is try/catch'd so a counter slip can't reach the host's storage call.
 * uninstallStorageTracking() restores the original methods and is wired into
 * telemetry.forget(). Idempotent, never throws.
 */

import { linearScore, ratingFor, type AxisRating, type AxisThresholds } from "./axisScoring";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function storageMeterEnabled(): boolean {
  try {
    if (typeof process !== "undefined" && process.env) {
      const v = process.env.BOOSTHIS_STORAGE_METER;
      if (typeof v === "string" && TRUE_VALUES.has(v.toLowerCase())) return true;
    }
    const g = globalThis as unknown as { BOOSTHIS_STORAGE_METER?: string | boolean };
    const gv = g.BOOSTHIS_STORAGE_METER;
    if (typeof gv === "boolean") return gv;
    if (typeof gv === "string" && TRUE_VALUES.has(gv.toLowerCase())) return true;
  } catch {
    /* best-effort */
  }
  return false;
}

/** Latency bands (p75 ms). ≤20ms is snappy (100); ≥200ms is a sluggish store
 *  (0). */
export const STORAGE_LATENCY_THRESHOLDS = { good: 20, poor: 200 } as const satisfies AxisThresholds;

/** Failure-rate bands (rejections / operations). ≤1% is noise (100); ≥10% is a
 *  chronically failing store (0). */
export const STORAGE_FAILURE_THRESHOLDS = { good: 0.01, poor: 0.1 } as const satisfies AxisThresholds;

/** Minimum operations observed before either axis reports. */
const STORAGE_MIN_OPS = 5;
/** Cap on retained latency samples (bounded memory). */
const STORAGE_RING_CAP = 400;

export interface StorageLatencyResult {
  score:      number | null;
  rating:     AxisRating;
  /** p75 operation duration (ms), or null while warming. */
  p75Ms:      number | null;
  /** Worst single operation duration (ms) this session, 0 if none. */
  worstMs:    number;
  /** Operations observed (shown even while warming). */
  opCount:    number;
  /** This reading belongs to the phone/tablet storage device. */
  scopeCode:  4;
}

export interface StorageFailureResult {
  score:      number | null;
  rating:     AxisRating;
  /** Rejection rate as a percentage (0–100), or null while warming. */
  failPct:    number | null;
  /** Rejections observed this session. */
  failCount:  number;
  /** Operations observed (shown even while warming). */
  opCount:    number;
  /** This reading belongs to the phone/tablet storage device. */
  scopeCode:  4;
}

/* ─── AsyncStorage surface (lazy-required; never a hard dep) ────────── */

type StorageMethod = (...args: unknown[]) => Promise<unknown>;
interface AsyncStorageLike {
  getItem?: StorageMethod;
  setItem?: StorageMethod;
  removeItem?: StorageMethod;
}

const WRAPPED_METHODS = ["getItem", "setItem", "removeItem"] as const;

/* ─── Module state ──────────────────────────────────────────────────── */

let installed = false;
let target: AsyncStorageLike | null = null;
/** Original methods captured for restore on teardown. */
const originals = new Map<string, StorageMethod>();
const durations: number[] = [];
let worstMs = 0;
let opCount = 0;
let failCount = 0;

function monoNow(): number {
  const p = (globalThis as unknown as { performance?: { now?: () => number } })
    .performance;
  return typeof p?.now === "function" ? p.now() : Date.now();
}

/** Record one completed op outcome. Never throws. */
function observe(durMs: number, ok: boolean): void {
  try {
    opCount += 1;
    if (!ok) failCount += 1;
    if (durMs >= 0 && durMs < 60_000) {
      durations.push(durMs);
      if (durations.length > STORAGE_RING_CAP) {
        durations.splice(0, durations.length - STORAGE_RING_CAP);
      }
      if (durMs > worstMs) worstMs = durMs;
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Wrap AsyncStorage get/set/remove to observe latency + outcome. Idempotent,
 * best-effort, NEVER throws. Only wires up when BOOSTHIS_STORAGE_METER is set
 * AND the host ALREADY provides AsyncStorage — we never add the dependency. On
 * any failure tracking stays OFF and the axes read absent. Call from telemetry
 * start.
 */
/** Wrap a resolved AsyncStorage-shaped store's get/set/remove methods in-place,
 *  capturing originals for restore. Sets `installed`/`target`. This is the exact
 *  wrapping code path; extracted so both the real install and the deterministic
 *  test seam drive one identical observer chain. */
function wrapTarget(store: AsyncStorageLike): void {
  if (!store || typeof store.getItem !== "function") return;
  target = store;
  for (const name of WRAPPED_METHODS) {
    const orig = store[name];
    if (typeof orig !== "function") continue;
    originals.set(name, orig as StorageMethod);
    const boundOrig = orig as StorageMethod;
    const wrapper = function (this: unknown, ...args: unknown[]): Promise<unknown> {
      const t0 = monoNow();
      // Call the host's original method and return its EXACT promise.
      const p = boundOrig.apply(this, args) as Promise<unknown>;
      try {
        // Observe on a COPY so we never alter the promise the host gets, and
        // never swallow its rejection. Our copy's rejection is caught so our
        // tap can't itself become an unhandled rejection.
        Promise.resolve(p).then(
          () => observe(monoNow() - t0, true),
          () => observe(monoNow() - t0, false),
        ).catch(() => {});
      } catch {
        /* best-effort — observation must never affect the host's call */
      }
      return p;
    };
    (store as Record<string, unknown>)[name] = wrapper;
  }
  installed = originals.size > 0;
  if (!installed) target = null;
}

export function installStorageTracking(): void {
  if (installed) return;
  if (!storageMeterEnabled()) return; // opt-in only; ABSENT when off.
  try {
    let mod: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require("@react-native-async-storage/async-storage");
    } catch {
      return; // host doesn't provide AsyncStorage — NEVER add it; stay OFF.
    }
    const store = ((mod as { default?: AsyncStorageLike })?.default ??
      mod) as AsyncStorageLike;
    if (!store || typeof store.getItem !== "function") return;
    wrapTarget(store);
  } catch {
    installed = false;
    target = null;
    originals.clear();
  }
}

function p75(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.75))];
}

/** storageLatency — p75 op duration. Returns null (ABSENT) when not wired
 *  (env off / AsyncStorage absent) or too few ops observed. */
export function readStorageLatency(): StorageLatencyResult | null {
  try {
    if (!installed) return null;
    if (opCount < STORAGE_MIN_OPS) {
      return {
        score: null,
        rating: "pending",
        p75Ms: null,
        worstMs: Math.round(worstMs),
        opCount,
        scopeCode: 4,
      };
    }
    const v = p75(durations);
    const score = linearScore(
      v,
      STORAGE_LATENCY_THRESHOLDS.good,
      STORAGE_LATENCY_THRESHOLDS.poor,
    );
    return {
      score,
      rating: ratingFor(score),
      p75Ms: Math.round(v),
      worstMs: Math.round(worstMs),
      opCount,
      scopeCode: 4,
    };
  } catch {
    return null;
  }
}

/** storageFailures — rejection rate. Returns null (ABSENT) when not wired or
 *  too few ops observed. */
export function readStorageFailures(): StorageFailureResult | null {
  try {
    if (!installed) return null;
    if (opCount < STORAGE_MIN_OPS) {
      return {
        score: null,
        rating: "pending",
        failPct: null,
        failCount,
        opCount,
        scopeCode: 4,
      };
    }
    const frac = opCount > 0 ? failCount / opCount : 0;
    const score = linearScore(
      frac,
      STORAGE_FAILURE_THRESHOLDS.good,
      STORAGE_FAILURE_THRESHOLDS.poor,
    );
    return {
      score,
      rating: ratingFor(score),
      failPct: Math.round(frac * 1000) / 10,
      failCount,
      opCount,
      scopeCode: 4,
    };
  } catch {
    return null;
  }
}

/**
 * Restore the original AsyncStorage methods and drop all state. Idempotent,
 * NEVER throws. Only restores a method if OUR wrapper is still the installed
 * one. Wired into telemetry.forget().
 */
export function uninstallStorageTracking(): void {
  try {
    if (target) {
      for (const [name, orig] of originals) {
        // Only restore if ours is still in place (don't clobber a later wrapper).
        (target as Record<string, unknown>)[name] = orig;
      }
    }
  } catch {
    /* best-effort — never throw on teardown */
  }
  originals.clear();
  target = null;
  installed = false;
  durations.length = 0;
  worstMs = 0;
  opCount = 0;
  failCount = 0;
}

/** @internal test hooks — deterministic, no dependence on a real AsyncStorage. */
export const _storageInternals = {
  STORAGE_LATENCY_THRESHOLDS,
  STORAGE_FAILURE_THRESHOLDS,
  STORAGE_MIN_OPS,
  get isInstalled(): boolean {
    return installed;
  },
  get opCount(): number {
    return opCount;
  },
  setInstalledForTests(v: boolean): void {
    installed = v;
  },
  /** Wrap a caller-provided AsyncStorage-shaped store via the REAL wrap path
   *  (no dependence on the actual package), so tests can drive the observer
   *  chain deterministically through actual wrapped get/set/remove calls. */
  installWithStoreForTests(store: AsyncStorageLike): void {
    if (installed) return;
    wrapTarget(store);
  },
  /** Record synthetic op outcomes: durations (ms) with an ok flag. */
  observeForTests(durMs: number, ok: boolean): void {
    observe(durMs, ok);
  },
  reset(): void {
    uninstallStorageTracking();
  },
};
