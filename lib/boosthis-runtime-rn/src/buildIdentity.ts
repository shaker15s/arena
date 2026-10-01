/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: build identity (Patch Lag meter source) ──────────────────
 *
 * The RN "Patch Lag" meter reports how OLD the running build is — its
 * exposure window — so a developer can see at a glance that a device is still
 * running a weeks-stale bundle. It is ADDITIVE and DISPLAY-ONLY: it never
 * feeds the composite Speed score (TTFF/TTI/FID), exactly like every other
 * axis in meterAxes.ts.
 *
 * HONEST SCOPE (React Native): the build stamp comes from the telemetry init
 * options ONLY — the developer passes `buildTimeMs` / `buildCommit` (e.g. from
 * expo-constants / EAS build metadata). There is NO env source (a phone has no
 * process env), NO platform auto-detection, and NO fallback: when the app
 * never supplies a build time, there is simply no build object and no patchLag
 * axis. Honest absence — never a fabricated / warming reading.
 *
 * PRIVACY / INVARIANTS:
 *   • The commit is a lowercase hex short/long SHA — never a branch name, URL,
 *     or anything user-derived. Anything that isn't 7–40 hex chars is rejected.
 *   • The build time must be a FINITE PAST epoch-ms value; a future or
 *     non-finite time is rejected (a device clock skew must not fabricate a
 *     negative age).
 *   • buildAgeMs is captured relative to `now` at snapshot time and clamped ≥0.
 *   • Nothing here ever throws into the host — the setter validates and drops
 *     bad input silently, so a mis-wired build stamp can never break the app.
 */

/** Lowercase-hex git SHA, short (7) through full (40). */
const COMMIT_RE = /^[0-9a-f]{7,40}$/;

/** Largest plausible epoch-ms build time — a sanity ceiling so a seconds value
 *  passed by mistake (≈1.7e9) can't masquerade as a valid ms time far in the
 *  future. Anything beyond this, or beyond `now`, is rejected as not-past. */

/** The validated build identity currently wired via init options. Null until
 *  the host passes a build stamp; stays null on the honest-absence path. */
interface BuildIdentityState {
  commit?: string;
  buildTimeMs?: number;
}
let state: BuildIdentityState | null = null;

/** Normalize + validate a developer-supplied commit SHA. Returns the lowercased
 *  hex string, or undefined when it isn't a 7–40 char hex SHA. */
export function normalizeCommit(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const lowered = raw.trim().toLowerCase();
  return COMMIT_RE.test(lowered) ? lowered : undefined;
}

/** Validate a developer-supplied build time. Accepts a FINITE PAST epoch-ms
 *  number only (the RN kit takes ms directly from init options — no seconds/ISO
 *  coercion, which is the server/env path this kit deliberately skips). Returns
 *  the value, or undefined when it isn't finite, isn't positive, or is in the
 *  future relative to `now`. */
export function normalizeBuildTimeMs(
  raw: unknown,
  now: number,
): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  if (raw <= 0) return undefined;
  // A finite past epoch-ms value. Reject the future (clock skew / a seconds
  // value) so age can never be fabricated negative.
  if (raw > now) return undefined;
  return raw;
}

/**
 * Wire the build identity from telemetry init options. Called once from
 * enableTelemetry(). Validates both fields independently and keeps only the
 * ones that pass — so a good commit with a bad time still yields a commit-only
 * build object. When NEITHER field is valid, state stays null (honest absence:
 * no build object, no patchLag axis). Never throws.
 */
export function setBuildIdentity(
  opts: { buildTimeMs?: unknown; buildCommit?: unknown } | null | undefined,
  now: number,
): void {
  try {
    if (!opts) return;
    const commit = normalizeCommit(opts.buildCommit);
    const buildTimeMs = normalizeBuildTimeMs(opts.buildTimeMs, now);
    if (commit === undefined && buildTimeMs === undefined) return;
    const next: BuildIdentityState = {};
    if (commit !== undefined) next.commit = commit;
    if (buildTimeMs !== undefined) next.buildTimeMs = buildTimeMs;
    state = next;
  } catch {
    /* a mis-wired build stamp must never break the host app */
  }
}

/** The top-level `build` object for the uploaded snapshot, or null when nothing
 *  is known (honest absence — the whole object is omitted). buildAgeMs is
 *  computed at capture against `now` and clamped ≥0. Only known fields appear;
 *  unknown ones are omitted, never fabricated. */
export interface BuildInfo {
  commit?: string;
  buildTimeMs?: number;
  buildAgeMs?: number;
}

export function readBuildInfo(now: number): BuildInfo | null {
  if (!state) return null;
  const out: BuildInfo = {};
  if (state.commit !== undefined) out.commit = state.commit;
  if (state.buildTimeMs !== undefined) {
    out.buildTimeMs = state.buildTimeMs;
    out.buildAgeMs = Math.max(0, now - state.buildTimeMs);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** True when a build time is known — i.e. the patchLag axis can be emitted.
 *  A commit-only stamp is NOT enough (the axis needs an age). */
export function hasBuildTime(): boolean {
  return state?.buildTimeMs !== undefined;
}

/** The known build time (epoch ms), or undefined. */
export function buildTimeMs(): number | undefined {
  return state?.buildTimeMs;
}

/** Clear the wired build identity — wired into telemetry.forget() so nothing
 *  Boosthis-shaped lingers after erasure. */
export function clearBuildIdentity(): void {
  state = null;
}

/** @internal test hooks — deterministic, no dependence on init options. */
export const _buildIdentityInternals = {
  COMMIT_RE,
  /** Force the validated state directly (bypasses init-option plumbing). */
  setForTests(next: BuildIdentityState | null): void {
    state = next;
  },
  get state(): BuildIdentityState | null {
    return state;
  },
  reset(): void {
    state = null;
  },
};
