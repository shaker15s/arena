/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: Dev Posture axis source (React Native) ───────────────────
 *
 * The additive "Dev Posture" meter reports whether a live app is still wearing
 * its development clothes. It reports EXPOSURE, never safety
 * (security-meters-doctrine): a clean tile means "none of the development
 * settings we can read were on", never "you are production-hardened".
 *
 * It reports the development settings we can read; a clean tile means none of
 * them were on — not that the deployment is hardened.
 *
 * READ ONCE AT STARTUP (freeze-at-init, like the cold-start contract): the
 * checks are evaluated one time when the meters first read this axis, the
 * result is cached, and the SAME frozen result is returned on every later
 * snapshot even if the environment changes afterwards. A test seam
 * (_resetDevPostureForTests / readDevPostureForTests) resets/overrides it.
 *
 * PER-RUNTIME READABLE CHECKS (RN):
 *   • debugFlag    — __DEV__ === true (development build shipped). ALWAYS
 *                    present (__DEV__ is always inspectable, guarded typeof).
 *   • profilingOpen — remote JS debugging attached. Under RN the classic
 *                    remote-debug signal is: the synchronous native call hook
 *                    (global.nativeCallSyncHook) is absent WHILE a chrome-like
 *                    debugger environment (a real window/document) is present.
 *                    Any uncertainty ⇒ the flag is OMITTED (honest absence).
 *   verboseErrors / sourceMaps are NOT readable on RN → their flags are OMITTED.
 *
 * WIRE OBJECT (numbers + rating/caption strings only — NEVER an env value,
 * path, URL, or config string):
 *   { score, rating, caption, findings, checks, measurable,
 *     debugFlag?, verboseErrors?, sourceMaps?, profilingOpen? }
 *
 * Each flag is present ONLY when this runtime actually performed that check
 * (value 1 = the development setting is ON; 0 = we read it and it was off). An
 * UNREADABLE check's flag is OMITTED entirely — absence means "we did not look".
 *
 * ADDITIVE / display-only: NEVER feeds the Speed score.
 */

import type { AxisRating } from "./axisScoring";

/** The reported axis wire shape. Every field is a number except rating +
 *  caption. The four flags are OPTIONAL — present only when this runtime read
 *  that check this session. */
export interface DevPostureReading {
  /** 0-100. 100 iff no development setting we could read was on. */
  score: number;
  rating: AxisRating;
  /** Counts + setting NAMES only — never an env value or config string. */
  caption: string;
  /** Number of present flags equal to 1. */
  findings: number;
  /** Number of flag fields present (checks this runtime actually read). */
  checks: number;
  /** 1 always when the axis is emitted. */
  measurable: 1;
  /** Present only when read. 1 = development build (__DEV__); 0 = off. */
  debugFlag?: number;
  /** Present only when read (never readable on RN → omitted). */
  verboseErrors?: number;
  /** Present only when read (never readable on RN → omitted). */
  sourceMaps?: number;
  /** Present only when read. 1 = remote JS debugging attached; 0 = off. */
  profilingOpen?: number;
}

/** The four flag identifiers, in the fixed order the caption lists them. */
type FlagKey = "debugFlag" | "verboseErrors" | "sourceMaps" | "profilingOpen";

/** Setting NAMES used in the caption — never an env var value or flag string. */
const FLAG_PHRASE: Record<FlagKey, string> = {
  debugFlag: "debug mode on",
  verboseErrors: "verbose error pages on",
  sourceMaps: "source maps served",
  profilingOpen: "profiling port open",
};

/** The frozen, read-once result. `null` until the first read populates it. */
let frozen: DevPostureReading | null = null;

/** Assemble the wire object from the flags that were actually read. Applies the
 *  shared devPosture scoring/rating/caption contract deterministically:
 *   • rating: debugFlag===1 → poor; else findings>0 → needs-work; else good.
 *   • score: 100, −60 if debugFlag===1, −20 per OTHER finding, clamp 0..100.
 *   • caption: good → "none of the {checks} development settings we can read
 *     were on"; otherwise the ON findings joined by ", " using the fixed
 *     setting-name phrases. */
export function assembleDevPosture(
  flags: Partial<Record<FlagKey, number>>,
): DevPostureReading {
  const order: FlagKey[] = [
    "debugFlag",
    "verboseErrors",
    "sourceMaps",
    "profilingOpen",
  ];
  let checks = 0;
  let findings = 0;
  const onPhrases: string[] = [];
  const debugOn = flags.debugFlag === 1;
  for (const key of order) {
    const v = flags[key];
    if (v === undefined) continue;
    checks += 1;
    if (v === 1) {
      findings += 1;
      onPhrases.push(FLAG_PHRASE[key]);
    }
  }

  let score = 100;
  if (debugOn) score -= 60;
  // −20 for each OTHER finding (never double-counting debugFlag).
  for (const key of order) {
    if (key === "debugFlag") continue;
    if (flags[key] === 1) score -= 20;
  }
  if (score < 0) score = 0;
  if (score > 100) score = 100;

  const rating: AxisRating = debugOn
    ? "poor"
    : findings > 0
      ? "needs-work"
      : "good";

  const caption =
    findings === 0
      ? `none of the ${checks} development settings we can read were on`
      : onPhrases.join(", ");

  const out: DevPostureReading = {
    score,
    rating,
    caption,
    findings,
    checks,
    measurable: 1,
  };
  // Emit each flag ONLY when it was read (present in `flags`).
  for (const key of order) {
    const v = flags[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Read `__DEV__` safely — 1 when the development bundle shipped, else 0. The
 *  flag is ALWAYS readable (typeof guard never throws), so it is never omitted. */
function readDebugFlag(): number {
  try {
    return typeof __DEV__ !== "undefined" && __DEV__ === true ? 1 : 0;
  } catch {
    return 0;
  }
}

/** Remote-JS-debugging probe. The classic RN signal is that the synchronous
 *  native call hook is absent (remote debugging moves JS off-device, so the
 *  JSI sync hook is gone) WHILE a chrome-like debugger environment is present
 *  (a real window with a document). Any uncertainty ⇒ return undefined so the
 *  flag is OMITTED (we could not honestly look). */
function readProfilingOpen(): number | undefined {
  try {
    const g = globalThis as unknown as {
      nativeCallSyncHook?: unknown;
      window?: { document?: unknown } | undefined;
      document?: unknown;
    };
    const hasSyncHook = typeof g.nativeCallSyncHook !== "undefined";
    const win = g.window;
    const chromeLike =
      typeof win !== "undefined" &&
      win !== null &&
      typeof (win as { document?: unknown }).document !== "undefined";
    // On-device (sync hook present): remote debugging is NOT attached → 0.
    if (hasSyncHook) return 0;
    // No sync hook AND a chrome-like debugger env: remote debugging attached → 1.
    if (chromeLike) return 1;
    // No sync hook and no chrome-like env: we cannot tell (could be a bare
    // JS test host, Bridgeless/JSI, etc.) → OMIT (honest absence).
    return undefined;
  } catch {
    return undefined;
  }
}

/** Evaluate every readable RN check ONCE and assemble the frozen reading. */
function computeFrozen(): DevPostureReading {
  const flags: Partial<Record<FlagKey, number>> = {};
  flags.debugFlag = readDebugFlag();
  const prof = readProfilingOpen();
  if (prof !== undefined) flags.profilingOpen = prof;
  // verboseErrors + sourceMaps are not readable on RN → never added → omitted.
  return assembleDevPosture(flags);
}

/**
 * The Dev Posture axis. Freeze-at-init: the first call evaluates the checks and
 * caches the reading; every later call returns the SAME frozen object even if
 * the environment changes afterwards. Never throws.
 *
 * RN always has at least one readable check (__DEV__ is always inspectable), so
 * this always emits — it never returns null.
 */
export function readDevPosture(): DevPostureReading {
  if (frozen === null) {
    try {
      frozen = computeFrozen();
    } catch {
      // Even on a catastrophic failure __DEV__ read is trivially safe; fall
      // back to a debug-off, single-check clean reading rather than crash.
      frozen = assembleDevPosture({ debugFlag: 0 });
    }
  }
  return frozen;
}

/** @internal test seam — reset the frozen result so the next read re-evaluates
 *  (and, optionally, override the frozen reading with explicit flags to test
 *  bands / omission without manipulating the RN globals). Follows the kit's
 *  cookieExposure/leakWatch test-seam conventions. */
export function _resetDevPostureForTests(
  override?: Partial<Record<FlagKey, number>>,
): void {
  frozen = override ? assembleDevPosture(override) : null;
}

/** @internal test seam — force a fresh evaluation and return the reading
 *  (bypasses the freeze so a test can assert what the live checks produced). */
export function readDevPostureForTests(): DevPostureReading {
  frozen = null;
  return readDevPosture();
}
