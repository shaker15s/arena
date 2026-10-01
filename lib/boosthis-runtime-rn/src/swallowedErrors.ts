/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: Swallowed Errors axis source (React Native) ──────────────
 *
 * A PORT of the Python kit's "swallowedErrors" (Near-Miss Rate) axis
 * (lib/boosthis-py/boosthis/extra_meters.py) — SAME wire shape, SAME rounding,
 * SAME caption sentence pattern, SAME gates and bands, so both runtimes read
 * byte-identically for the same axis key.
 *
 * Definition: errors the HOST app LOGGED at error level but did NOT crash on —
 * a "near miss". A calm app logs almost none; a chatty-but-alive app that keeps
 * swallowing errors is riding the edge of a real failure.
 *
 * HOST HOOK (React Native): the honest place to observe caught-and-logged
 * errors from JS is `console.error` — RN's LogBox, most crash reporters, and
 * app code funnel logged errors through it. We CHAIN it, never replace it:
 *   • call the host's existing console.error FIRST, byte-identically,
 *   • observe (record ONE timestamp),
 *   • return exactly what the host's console.error returned.
 * We add/remove NOTHING else, change no formatting or output, and re-entrancy-
 * guard so Boosthis's OWN console.error (e.g. safe.devWarn) is never counted.
 * If chaining fails we stay OFF and the axis reads not-measurable (never a fake
 * "healthy" reading).
 *
 * TIMESTAMPS ONLY: the ring holds at most SWALLOWED_RING_CAP epoch-ms integers —
 * never the message, arguments, logger name, or stack. Nothing about the error
 * content ever enters this module.
 *
 * Gates + bands (copied from Python, unchanged):
 *   • no minimum count,
 *   • a 5-minute minimum window before the axis reports at all
 *     (SWALLOWED_MIN_WINDOW_MS),
 *   • trailing window capped at 60 minutes (SWALLOWED_WINDOW_MS),
 *   • bands: 1/hour = good, 60/hour = poor,
 *   • ring of at most SWALLOWED_RING_CAP timestamps.
 *
 * HONESTY / INVARIANTS:
 *   • NEVER feeds the composite Speed score (TTFF/TTI/FID). Display-only.
 *   • NOT LISTENING ⇒ NOT MEASURABLE: if the chain never installed we report
 *     { measurable: 0 } and the other fields absent, so the tile explains
 *     itself instead of warming forever or faking a 100.
 *   • WARMING ⇒ OMITTED: while measurable but still inside the 5-minute
 *     minimum window we return null (the axis is omitted from the upload; the
 *     server renders an absent expected axis as "warming up").
 *   • Wire shape when reported: { score, rating, count, perHour, windowMin,
 *     caption } — identical to the Python kit.
 *
 * GUEST-SAFETY: every observation is wrapped in a catch that drops silently;
 * a throw can never reach the host's logging call. uninstall restores the
 * host's previous console.error and is wired into telemetry.forget().
 */

import { linearScore, ratingFor, type AxisRating } from "./axisScoring";
import { MIN_RATE_WINDOW_MS, earnedPerHour, windowMinOf } from "./rateHonesty";
import {
  markLeakWatchInstalled,
  markLeakWatchUninstalled,
  noteLeakScan,
} from "./leakWatch";

/** Rate bands (errors per hour). ≤1/hr reads as an occasional near miss (100);
 *  ≥60/hr (one a minute) is chronically swallowing errors (0). */
export const SWALLOWED_GOOD_PER_HOUR = 1.0;
export const SWALLOWED_POOR_PER_HOUR = 60.0;

/** Minimum observation window before the axis reports at all — too early for a
 *  clean bill to be honest. Copied from Python (5 minutes). */
export const SWALLOWED_MIN_WINDOW_MS = MIN_RATE_WINDOW_MS;

/** Trailing window the rate is measured over, capped at 60 minutes. */
export const SWALLOWED_WINDOW_MS = 60 * 60_000;

/** Ring cap — at most this many timestamps are retained (oldest dropped). */
export const SWALLOWED_RING_CAP = 400;

/** The reported axis — wire shape IDENTICAL to the Python kit's
 *  _read_swallowed_errors(): { score, rating, count, perHour, windowMin,
 *  caption }. NO `measurable` key when the axis is measurable (matching
 *  Python, which omits it entirely). */
export interface SwallowedErrorsReading {
  /** 0–100. */
  score:     number;
  rating:    AxisRating;
  /** Logged errors counted within the trailing window. */
  count:     number;
  /** Errors per hour over the window (1dp). */
  perHour:   number;
  /** Window observed (minutes, 1dp) — the rate denominator. */
  windowMin: number;
  /** Caption sentence, identical pattern to the Python kit. */
  caption:   string;
}

/** The "can never measure" sentinel — the ONLY shape that carries
 *  `measurable`. Uploaded (unlike a warming axis, which is omitted) so the tile
 *  explains itself instead of warming forever. */
export interface SwallowedErrorsUnmeasurable {
  measurable: 0;
}

/** What readSwallowedErrors() returns:
 *   • a full reading (measurable, past the min window),
 *   • { measurable: 0 } (can never measure — chain never installed),
 *   • or null while warming inside the min window (the caller omits the axis
 *     from the upload, so the server renders it as "warming up").
 *  Mirrors the Python reader byte-for-byte: it returns the dict, or None. */
export type SwallowedErrorsResult =
  | SwallowedErrorsReading
  | SwallowedErrorsUnmeasurable;

let installed = false;
/** epoch-ms of the last install (window origin). */
let startedAt = 0;
/** Ring of at most SWALLOWED_RING_CAP timestamps — TIMESTAMPS ONLY. */
const timestamps: number[] = [];
/** The host's console.error we chained (restored on uninstall). */
let priorConsoleError: ((...args: unknown[]) => unknown) | null = null;
/** Our own wrapper (identity kept so uninstall can compare/restore). */
let ourConsoleError: ((...args: unknown[]) => unknown) | null = null;
/** Re-entrancy guard: true while WE are inside a console.error call, so
 *  Boosthis's own logging (safe.devWarn etc.) is never counted as a host
 *  near miss — we exclude ourselves, exactly like the Python kit's
 *  _is_our_record. */
let inOurLog = false;

/** Wall-clock epoch ms. Date.now() (a rate needs wall-clock, not monotonic). */
function nowMs(): number {
  return Date.now();
}

/** Max chars we ever hand to the leakWatch scan (its own limit also applies).
 *  Bounds work per event and caps the transient string this scope builds. */
const SCAN_STRINGIFY_CAP = 4096;

/** Cheaply stringify console.error args for the leakWatch scan ONLY. The
 *  returned string is transient — the leakWatch collector classifies it and
 *  keeps only {ts, cat}; NOTHING here or there retains the text. Never throws
 *  (returns "" on any failure). Bounded to SCAN_STRINGIFY_CAP chars. */
function stringifyArgsForScan(args: unknown[]): string {
  try {
    let out = "";
    for (const a of args) {
      if (out.length >= SCAN_STRINGIFY_CAP) break;
      let piece: string;
      if (typeof a === "string") {
        piece = a;
      } else if (a instanceof Error) {
        // Error text + stack is exactly the user-visible LogBox content.
        piece = `${a.message}\n${a.stack ?? ""}`;
      } else {
        try {
          piece = String(a);
        } catch {
          piece = "";
        }
      }
      out += (out.length > 0 ? " " : "") + piece;
    }
    return out.length > SCAN_STRINGIFY_CAP ? out.slice(0, SCAN_STRINGIFY_CAP) : out;
  } catch {
    return "";
  }
}

/** Record ONE host-logged error: append a timestamp, cap the ring. Never the
 *  message/args. Never throws (bookkeeping only). */
function note(): void {
  try {
    if (!installed) return;
    // Exclude Boosthis's own logging so we never count ourselves.
    if (inOurLog) return;
    timestamps.push(nowMs());
    if (timestamps.length > SWALLOWED_RING_CAP) {
      timestamps.splice(0, timestamps.length - SWALLOWED_RING_CAP);
    }
  } catch {
    /* best-effort — a counter slip must never reach the host's logging call */
  }
}

/**
 * Chain console.error to observe host-logged errors. Idempotent, best-effort,
 * NEVER throws. On any failure tracking stays OFF and the axis reads
 * { measurable: 0 }. Call once from telemetry start.
 */
export function installSwallowedErrorTracking(): void {
  if (installed) return;
  try {
    const c = (globalThis as unknown as { console?: Record<string, unknown> })
      .console;
    if (!c || typeof c.error !== "function") {
      // No console.error to chain — stay OFF (reads measurable:0).
      return;
    }
    const prior = c.error as (...args: unknown[]) => unknown;
    priorConsoleError = prior;
    const wrapper = function (this: unknown, ...args: unknown[]): unknown {
      // Call the host's existing console.error FIRST, byte-identically, and
      // capture its result so we return exactly what the host expected. Its
      // throw is the host's own concern — we do not swallow it.
      let result: unknown;
      const wasOurs = inOurLog;
      inOurLog = true;
      try {
        result = prior.apply(this, args);
      } finally {
        inOurLog = wasOurs;
      }
      // Observe AFTER the host call, and only when it wasn't our own logging.
      if (!wasOurs) {
        note();
        // Piggyback the SAME wrapper for the leakWatch axis — NO second hook.
        // We stringify the args (bounded) here and hand them to the leakWatch
        // collector, which classifies + counts and retains ONLY {ts, cat}. The
        // stringified text is scoped to this call and never stored by us.
        try {
          noteLeakScan(stringifyArgsForScan(args));
        } catch {
          /* best-effort — a scan slip must never reach the host's log call */
        }
      }
      return result;
    };
    ourConsoleError = wrapper;
    c.error = wrapper;
    startedAt = nowMs();
    timestamps.length = 0;
    installed = true;
    // The leakWatch axis piggybacks THIS wrapper (no second hook); mark it live
    // so its reader leaves "not measurable" and starts its own 5-min window.
    try {
      markLeakWatchInstalled();
    } catch {
      /* best-effort — leakWatch stays not-measurable on failure */
    }
  } catch {
    // Wiring failed — restore whatever we can and stay OFF (reads measurable:0).
    try {
      uninstallSwallowedErrorTracking();
    } catch {
      /* best-effort */
    }
    installed = false;
  }
}

/**
 * The Swallowed Errors axis. Pure read — never mutates state, NEVER throws.
 *   • not installed → { measurable: 0 } (the tile explains itself),
 *   • installed but inside the 5-minute min window → null (OMITTED / warming),
 *   • otherwise the full { score, rating, count, perHour, windowMin, caption }
 *     wire shape, identical to the Python kit.
 */
export function readSwallowedErrors(): SwallowedErrorsResult | null {
  try {
    // No honest way to observe caught-and-logged errors here → not measurable.
    if (!installed) {
      return { measurable: 0 };
    }
    const now = nowMs();
    const windowMs = Math.min(now - startedAt, SWALLOWED_WINDOW_MS);
    // Too early for a clean bill to be honest → omit while warming.
    if (windowMs < SWALLOWED_MIN_WINDOW_MS) {
      return null;
    }
    const cutoff = now - windowMs;
    let count = 0;
    for (const t of timestamps) if (t >= cutoff) count += 1;
    // The earned-rate contract (rateHonesty.ts) — the gate above already holds
    // the reading until the window earns the projection, so this cannot be null.
    const perHour = earnedPerHour(count, windowMs) ?? 0;
    const score = linearScore(
      perHour,
      SWALLOWED_GOOD_PER_HOUR,
      SWALLOWED_POOR_PER_HOUR,
    );
    const windowMinRounded = Math.round(windowMs / 60_000);
    const caption =
      count === 0
        ? `no logged errors \u00b7 ${windowMinRounded} min watched`
        : `${count} error${count !== 1 ? "s" : ""} logged, app survived`;
    // Measurable + past the min window → the full reading, with NO `measurable`
    // key (matching Python's _read_swallowed_errors, which omits it entirely).
    return {
      score,
      rating:    ratingFor(score),
      count,
      perHour,
      windowMin: windowMinOf(windowMs),
      caption,
    };
  } catch {
    return { measurable: 0 };
  }
}

/**
 * Restore the host's console.error and drop all tracking state. Idempotent,
 * NEVER throws. If another library chained ON TOP of ours we leave the chain
 * alone (unhooking would drop THEIR wrapper too); ours is already inert once
 * `installed` is false. Wired into telemetry.forget().
 */
export function uninstallSwallowedErrorTracking(): void {
  try {
    const c = (globalThis as unknown as { console?: Record<string, unknown> })
      .console;
    if (
      c &&
      ourConsoleError !== null &&
      priorConsoleError !== null &&
      c.error === ourConsoleError
    ) {
      c.error = priorConsoleError;
    }
  } catch {
    /* best-effort — never throw on teardown */
  }
  priorConsoleError = null;
  ourConsoleError = null;
  installed = false;
  startedAt = 0;
  inOurLog = false;
  timestamps.length = 0;
  // leakWatch shares this wrapper's lifecycle — tear it down too.
  try {
    markLeakWatchUninstalled();
  } catch {
    /* best-effort — never throw on teardown */
  }
}

/** @internal test hooks — deterministic, no dependence on a real console. */
export const _swallowedInternals = {
  SWALLOWED_GOOD_PER_HOUR,
  SWALLOWED_POOR_PER_HOUR,
  SWALLOWED_MIN_WINDOW_MS,
  SWALLOWED_WINDOW_MS,
  SWALLOWED_RING_CAP,
  get isInstalled(): boolean {
    return installed;
  },
  get count(): number {
    return timestamps.length;
  },
  /** Force the installed flag on without chaining a real console. */
  setInstalledForTests(v: boolean): void {
    installed = v;
    if (v && startedAt === 0) startedAt = nowMs();
  },
  /** Push n synthetic timestamps (defaults to "now"), applying the ring cap. */
  fireForTests(n = 1, at?: number): void {
    for (let i = 0; i < Math.max(0, Math.round(n)); i++) {
      timestamps.push(at ?? nowMs());
    }
    if (timestamps.length > SWALLOWED_RING_CAP) {
      timestamps.splice(0, timestamps.length - SWALLOWED_RING_CAP);
    }
  },
  /** Move the window origin back so readings clear the warm-up gate. */
  setStartedAtForTests(ms: number): void {
    startedAt = ms;
  },
  reset(): void {
    uninstallSwallowedErrorTracking();
  },
};
