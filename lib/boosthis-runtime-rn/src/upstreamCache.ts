/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
// From the leaf, never through meterAxes: meterAxes imports THIS module to
// assemble the axis, so taking its re-export back would close a require cycle
// and Metro prints that in the customer's build output.
import { linearScore, ratingFor, type AxisRating } from "./axisScoring";

export type UpstreamCacheVerdict = "hit" | "miss" | "stale" | "bypass";

export const UPSTREAM_CACHE_HEADERS = [
  "x-vercel-cache",
  "cf-cache-status",
  "x-nextjs-cache",
  "cache-status",
  "x-cache",
] as const;

export const UPSTREAM_CACHE_MIN_VERDICTS = 5;
export const UPSTREAM_CACHE_THRESHOLDS = { good: 90, poor: 40 } as const;

export interface UpstreamCacheResult {
  hitPct: number | null;
  checked: number;
  hits: number;
  misses: number;
  stale: number;
  bypass: number;
  score: number | null;
  rating: AxisRating;
}

let hits = 0;
let misses = 0;
let stale = 0;
let bypass = 0;

function cacheStatus(raw: string): UpstreamCacheVerdict | null {
  const params = (raw.split(",")[0] ?? "").split(";").slice(1);
  for (const part of params) {
    const value = part.trim().toLowerCase();
    if (value === "hit") return "hit";
    if (value === "fwd=stale" || value === "fwd=request") return "stale";
    if (value === "fwd=bypass" || value === "fwd=method") return "bypass";
    if (
      value === "fwd=miss" ||
      value === "fwd=uri-miss" ||
      value === "fwd=vary-miss"
    ) return "miss";
  }
  return null;
}

export function classifyUpstreamCache(
  read: (name: string) => string | null | undefined,
): UpstreamCacheVerdict | null {
  for (const name of UPSTREAM_CACHE_HEADERS) {
    let raw: string | null | undefined;
    try {
      raw = read(name);
    } catch {
      continue;
    }
    if (typeof raw !== "string" || raw.length === 0 || raw.length > 120) continue;
    const value = raw.trim().toUpperCase();
    if (name === "cache-status") return cacheStatus(raw);
    if (name === "x-cache") {
      const word = value.split(/[\s,]+/)[0];
      if (word === "HIT") return "hit";
      if (word === "MISS") return "miss";
      if (word === "REFRESHHIT") return "stale";
      if (word === "ERROR") return "bypass";
      continue;
    }
    if (value === "HIT" || value === "PRERENDER") return "hit";
    if (value === "MISS") return "miss";
    if (
      value === "STALE" ||
      value === "EXPIRED" ||
      value === "UPDATING" ||
      value === "REVALIDATED"
    ) return "stale";
    if (value === "BYPASS" || value === "DYNAMIC" || value === "IGNORED") {
      return "bypass";
    }
  }
  return null;
}

/** Observe only the dependency's fixed cache-verdict headers; no value is kept. */
export function noteUpstreamCacheResponse(response: unknown): void {
  try {
    const headers = (response as {
      headers?: { get?: (name: string) => string | null };
    } | null)?.headers;
    if (!headers || typeof headers.get !== "function") return;
    const verdict = classifyUpstreamCache((name) => headers.get!(name));
    if (verdict === "hit") hits++;
    else if (verdict === "miss") misses++;
    else if (verdict === "stale") stale++;
    else if (verdict === "bypass") bypass++;
  } catch {
    /* request observation must never affect the host */
  }
}

export function readUpstreamCache(): UpstreamCacheResult | null {
  const cacheable = hits + misses + stale;
  const checked = cacheable + bypass;
  if (checked === 0) return null;
  if (cacheable < UPSTREAM_CACHE_MIN_VERDICTS) {
    return {
      hitPct: null, checked, hits, misses, stale, bypass,
      score: null, rating: "pending",
    };
  }
  const hitPct = Math.round(((hits + stale) / cacheable) * 100);
  const score = linearScore(
    UPSTREAM_CACHE_THRESHOLDS.good - hitPct,
    0,
    UPSTREAM_CACHE_THRESHOLDS.good - UPSTREAM_CACHE_THRESHOLDS.poor,
  );
  return { hitPct, checked, hits, misses, stale, bypass, score, rating: ratingFor(score) };
}

export function clearUpstreamCache(): void {
  hits = misses = stale = bypass = 0;
}

export const _upstreamCacheInternals = {
  note(verdict: UpstreamCacheVerdict): void {
    if (verdict === "hit") hits++;
    else if (verdict === "miss") misses++;
    else if (verdict === "stale") stale++;
    else bypass++;
  },
  reset: clearUpstreamCache,
};