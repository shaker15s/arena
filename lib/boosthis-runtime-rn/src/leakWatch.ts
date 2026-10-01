/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: Leak Watch axis source (React Native) ────────────────────
 *
 * Detects the HOST app leaking stack traces, secrets/keys, or personal
 * details TO ITS OWN USERS. On React Native the only user-visible surface a
 * JS kit can honestly observe is console output — LogBox and the dev overlay
 * render logged stack traces, and app code funnels leaked values through
 * console.error. So this axis PIGGYBACKS the SAME console.error chain that
 * swallowedErrors installs (see swallowedErrors.ts installSwallowedErrorTracking):
 * there is NO second wrapper and NO second hook. The swallowedErrors wrapper
 * calls noteLeakScan() with the stringified args; we classify and count here.
 *
 * ABSOLUTE PRIVACY RULE: the matched text, the matched value, and the log line
 * NEVER leave the local classification scope. Nothing but a timestamp and a
 * category enum is retained. Nothing about the content ever enters a field,
 * caption, error, or log line.
 *
 * Categories (each observation classified into EXACTLY ONE, priority
 * secret > pii > stack, so stackCount + secretCount + piiCount === count):
 *   • secret — JWT / bearer / AWS key id / PEM private key / api_key=… assignment
 *   • pii    — the kit's canonical email regex (reused from no-pii.ts)
 *   • stack  — a JS/other stack-frame shape (LogBox renders it to the user)
 *
 * Gates + bands (mirror swallowedErrors mechanics exactly):
 *   • 5-minute minimum observation window before the axis reports at all,
 *   • 60-minute trailing window,
 *   • bounded ring of {ts, cat}, cap 200,
 *   • score = 100 when count === 0; otherwise max(0, 70 - round(perHour*10)):
 *     any observed leak is at best "needs-work".
 *
 * HONESTY / INVARIANTS:
 *   • NEVER feeds the composite Speed score. Additive / display-only.
 *   • WARMING ⇒ OMITTED: inside the 5-minute min window readLeakWatch()
 *     returns null (the axis is dropped from the upload → "warming up").
 *   • The tile/caption reads "no leaks observed" (absence of evidence), never
 *     "you are protected".
 *
 * GUEST-SAFETY: every scan is wrapped in a catch that drops silently; a throw
 * can never reach the host's logging call. Bounded work per event (first 4096
 * chars of the stringified message only).
 */

import { ratingFor, type AxisRating } from "./axisScoring";
import { PII_EMAIL_RE } from "./no-pii";

import { MIN_RATE_WINDOW_MS, earnedPerHour, windowMinOf } from "./rateHonesty";
/** Trailing window the rate is measured over (60 minutes). */
export const LEAK_WINDOW_MS = 60 * 60_000;

/** Minimum observation window before the axis reports at all (5 minutes). */
export const LEAK_MIN_WINDOW_MS = MIN_RATE_WINDOW_MS;

/** Ring cap — at most this many {ts, cat} events are retained (oldest dropped). */
export const LEAK_RING_CAP = 200;

/** Only the first this-many chars of a stringified message are scanned. */
export const LEAK_SCAN_LIMIT = 4096;

/** The three closed leak categories. */
export type LeakCategory = "secret" | "pii" | "stack";

/* ── The detection-detail vocabulary (docs/leak-detection-vocabulary.md) ──
 * A bare count is an alarm nobody can act on, so each observation also carries
 * WHERE it was seen and WHICH shape matched — both from CLOSED, code-defined
 * lists, both crossing the wire as NUMBERS. A number cannot carry a matched
 * value, a path, a host name or a credential. Kept in step with the same lists
 * in the Node and Python kits (a guard parses all three from source). */

/** Surface kinds. React Native has exactly ONE user-visible surface a JS kit
 *  can honestly observe — console output — so `fromReplyCount` is OMITTED from
 *  the wire here for the same reason `routeClassCount` is: there is no response
 *  path to attribute anything to, and a zero would read as "we looked". */
export const LEAK_SURFACE_LOG = 1;

/** Detection shapes — one bit each; a reading reports the OR of every shape
 *  seen in the window (`shapeMask`). */
export const LEAK_SHAPE_JWT = 1;
export const LEAK_SHAPE_BEARER = 2;
export const LEAK_SHAPE_AWS_KEY_ID = 4;
export const LEAK_SHAPE_PRIVATE_KEY = 8;
export const LEAK_SHAPE_NAMED_VALUE = 16;
export const LEAK_SHAPE_EMAIL = 32;
export const LEAK_SHAPE_STACK_FRAME = 64;

/** The reported axis wire shape (RN omits routeClassCount — no response path). */
export interface LeakWatchReading {
  /** 0–100. 100 iff no leaks observed; otherwise ≤ 70. */
  score:       number;
  rating:      AxisRating;
  /** Total leak observations within the trailing window. */
  count:       number;
  /** Observations per hour over the window (1dp). */
  perHour:     number;
  /** Window observed (minutes, 1dp) — the rate denominator. */
  windowMin:   number;
  /** Per-category split; the three sum EXACTLY to count. */
  stackCount:  number;
  secretCount: number;
  piiCount:    number;
  /** How many of `count` were seen in the app's own log output. On RN that is
   *  the only surface, so this equals `count` — stated rather than implied so
   *  a reader is never left guessing where to go and look. */
  fromLogCount: number;
  /** OR of the closed shape codes seen in the window (0 when count is 0). */
  shapeMask:   number;
  /** Caption sentence — counts + category words only, never content. */
  caption:     string;
}

/** The "can never measure" sentinel — uploaded so the tile explains itself
 *  (the console.error chain never installed). */
export interface LeakWatchUnmeasurable {
  measurable: 0;
}

export type LeakWatchResult = LeakWatchReading | LeakWatchUnmeasurable;

/* ─── Detection patterns (conservative; ONLY these) ──────────────────────
 * These match SHAPES, never capture or retain content. */

/** stack: a JS stack frame, or "Error:" followed by newline + "    at ".
 *  Also accepts the other runtimes' shapes since a RN app may print them. */
const STACK_JS_FRAME_RE = /\bat .{1,200}\(.{1,200}:\d+:\d+\)/;
const STACK_JS_ERROR_RE = /Error:[\s\S]*?\n\s+at /;
const STACK_PY_RE = /Traceback \(most recent call last\)/;
const STACK_GO_RE = /goroutine \d+ \[|\.go:\d+ \+0x/;
const STACK_JAVA_RE = /\bat [\w.$]+\([\w$]+\.java:\d+\)/;

/** secret patterns. */
const SECRET_JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const SECRET_BEARER_RE = /bearer\s+(\S{8,})/gi;
const SECRET_AWS_RE = /AKIA[0-9A-Z]{16}/;
const SECRET_PEM_RE = /-----BEGIN [\s\S]*?PRIVATE KEY/;
const SECRET_ASSIGN_RE =
  /(?:api[_-]?key|secret|token)["']?\s*[:=]\s*["']?([A-Za-z0-9_\-]{16,})/gi;

/* ── Placeholders are not credentials ─────────────────────────────────────
 * A value written in a placeholder form is, by construction, the ABSENCE of a
 * credential: it is what a message prints WHERE a credential would go. Only
 * the two shapes that read a free-form value can meet one. The set is closed
 * and deliberately small — anything outside it is still a detection.
 * Byte-identical in meaning to the Node and Python kits; the reason it exists
 * is recorded in docs/leak-detection-vocabulary.md. */
const PLACEHOLDER_VALUE_RE =
  /^(?:<[^>]*>|\{\{[^}]*\}\}|\$\{[^}]*\}|\*{3,}|[xX]{3,}|\.{3,}|\u2026|(?:YOUR|EXAMPLE|SAMPLE|PLACEHOLDER|REPLACE|INSERT)[A-Z0-9_-]*)[^A-Za-z0-9_-]*$/;
/** Opening punctuation a sentence wraps a value in. */
const VALUE_LTRIM_RE = /^[("'`[]+/;

function isPlaceholder(value: string): boolean {
  try {
    const v = value.replace(VALUE_LTRIM_RE, "");
    return v.length > 0 && PLACEHOLDER_VALUE_RE.test(v);
  } catch {
    return false;
  }
}

/** How many matches of ONE shape a single scan inspects. A screen that shows a
 *  placeholder and then leaks a real credential below it is the ordinary case,
 *  so the shape must not end at its FIRST match — but the walk stays bounded,
 *  on top of the already-bounded slice. */
const MAX_MATCHES_PER_SHAPE = 16;

/** True when this free-form shape has at least one match whose value is NOT a
 *  placeholder. Walks successive matches rather than judging the shape by its
 *  first one, so a documented "Bearer <project-key>" above a real token cannot
 *  hide it. Returns a boolean — no matched text is returned or retained. */
function hasRealValue(re: RegExp, text: string): boolean {
  try {
    re.lastIndex = 0;
    for (let i = 0; i < MAX_MATCHES_PER_SHAPE; i++) {
      const m = re.exec(text);
      if (!m) break;
      if (!isPlaceholder(m[1] ?? "")) return true;
      if (m[0].length === 0) re.lastIndex += 1;
    }
    return false;
  } catch {
    return false;
  } finally {
    re.lastIndex = 0;
  }
}

/** One classification outcome — a category enum and the closed numeric shape
 *  code that decided it. Never any matched text. */
interface LeakClass {
  cat:   LeakCategory;
  shape: number;
}

/** Classify a bounded slice of text into EXACTLY ONE category (priority
 *  secret > pii > stack) or null if nothing matched. Content is examined only
 *  locally here and is NEVER returned or retained. Shapes are tested in a fixed
 *  order, so the reported shape is deterministically the FIRST that matched. */
function classify(text: string): LeakClass | null {
  if (SECRET_JWT_RE.test(text)) return { cat: "secret", shape: LEAK_SHAPE_JWT };
  // A placeholder value ends neither the shape nor the classification: the
  // scan walks the shape's LATER matches for a real value, and only then falls
  // through to the remaining shapes.
  if (hasRealValue(SECRET_BEARER_RE, text)) {
    return { cat: "secret", shape: LEAK_SHAPE_BEARER };
  }
  if (SECRET_AWS_RE.test(text)) {
    return { cat: "secret", shape: LEAK_SHAPE_AWS_KEY_ID };
  }
  if (SECRET_PEM_RE.test(text)) {
    return { cat: "secret", shape: LEAK_SHAPE_PRIVATE_KEY };
  }
  if (hasRealValue(SECRET_ASSIGN_RE, text)) {
    return { cat: "secret", shape: LEAK_SHAPE_NAMED_VALUE };
  }
  if (PII_EMAIL_RE.test(text)) return { cat: "pii", shape: LEAK_SHAPE_EMAIL };
  if (
    STACK_JS_FRAME_RE.test(text) ||
    STACK_JS_ERROR_RE.test(text) ||
    STACK_PY_RE.test(text) ||
    STACK_GO_RE.test(text) ||
    STACK_JAVA_RE.test(text)
  ) {
    return { cat: "stack", shape: LEAK_SHAPE_STACK_FRAME };
  }
  return null;
}

/** One retained event — a TIMESTAMP, a CATEGORY and two closed numeric codes.
 *  Never any content. */
interface LeakEvent {
  ts:    number;
  cat:   LeakCategory;
  /** Closed surface-kind code (always LEAK_SURFACE_LOG on RN). */
  surf:  number;
  /** Closed shape code (LEAK_SHAPE_*). */
  shape: number;
}

/** Whether the piggybacked hook has installed (mirrors the swallowedErrors
 *  chain being live). Set by markInstalled() from the shared wrapper. */
let installed = false;
/** epoch-ms of the last install (window origin). */
let startedAt = 0;
/** Bounded ring of {ts, cat} — TIMESTAMPS + CATEGORY ONLY. */
const events: LeakEvent[] = [];

/** Wall-clock epoch ms (a rate needs wall-clock, not monotonic). */
function nowMs(): number {
  return Date.now();
}

/**
 * Mark the leakWatch collector live. Called by the shared console.error chain
 * (installSwallowedErrorTracking) once the wrapper is installed — leakWatch has
 * NO wrapper of its own. Idempotent; resets the window origin on first install.
 */
export function markLeakWatchInstalled(): void {
  if (installed) return;
  installed = true;
  startedAt = nowMs();
  events.length = 0;
}

/** Mark the collector off (shared wrapper uninstalled). Drops all state. */
export function markLeakWatchUninstalled(): void {
  installed = false;
  startedAt = 0;
  events.length = 0;
}

/**
 * Scan ONE console output for leaks. Called from INSIDE the shared
 * console.error wrapper (swallowedErrors), AFTER the host call and only when it
 * was not our own logging (the wrapper's reentrancy guard already excludes us).
 * `text` is the already-stringified message/args. We slice to LEAK_SCAN_LIMIT,
 * classify into exactly one category, and retain ONLY {ts, cat}. Never throws,
 * never returns or stores any content.
 */
export function noteLeakScan(text: string): void {
  try {
    if (!installed) return;
    if (typeof text !== "string" || text.length === 0) return;
    const slice = text.length > LEAK_SCAN_LIMIT ? text.slice(0, LEAK_SCAN_LIMIT) : text;
    const klass = classify(slice);
    if (klass === null) return;
    events.push({
      ts:    nowMs(),
      cat:   klass.cat,
      surf:  LEAK_SURFACE_LOG,
      shape: klass.shape,
    });
    if (events.length > LEAK_RING_CAP) {
      events.splice(0, events.length - LEAK_RING_CAP);
    }
  } catch {
    /* best-effort — a scan slip must never reach the host's logging call */
  }
}

/**
 * The Leak Watch axis. Pure read — never mutates state, NEVER throws.
 *   • not installed → { measurable: 0 } (the tile explains itself),
 *   • installed but inside the 5-minute min window → null (OMITTED / warming),
 *   • otherwise the full reading (routeClassCount omitted on RN).
 */
export function readLeakWatch(): LeakWatchResult | null {
  try {
    if (!installed) {
      return { measurable: 0 };
    }
    const now = nowMs();
    const windowMs = Math.min(now - startedAt, LEAK_WINDOW_MS);
    if (windowMs < LEAK_MIN_WINDOW_MS) {
      return null;
    }
    const cutoff = now - windowMs;
    let count = 0;
    let stackCount = 0;
    let secretCount = 0;
    let piiCount = 0;
    let fromLogCount = 0;
    let shapeMask = 0;
    for (const e of events) {
      if (e.ts < cutoff) continue;
      count += 1;
      if (e.cat === "secret") secretCount += 1;
      else if (e.cat === "pii") piiCount += 1;
      else stackCount += 1;
      if (e.surf === LEAK_SURFACE_LOG) fromLogCount += 1;
      shapeMask |= e.shape;
    }
    // The earned-rate contract (rateHonesty.ts) — the gate above already holds
    // the reading until the window earns the projection, so this cannot be null.
    const perHour = earnedPerHour(count, windowMs) ?? 0;
    // Any observed leak is at best "needs-work" (never 100 when count > 0).
    const score =
      count === 0 ? 100 : Math.max(0, 70 - Math.round(perHour * 10));
    const windowMinRounded = Math.round(windowMs / 60_000);
    const caption =
      count === 0
        ? `no leaks observed in this window \u00b7 ${windowMinRounded} min watched`
        : leakSummary(count, secretCount, piiCount, stackCount, shapeMask);
    return {
      score,
      rating:      ratingFor(score),
      count,
      perHour,
      windowMin:   windowMinOf(windowMs),
      stackCount,
      secretCount,
      piiCount,
      fromLogCount,
      shapeMask,
      caption,
    };
  } catch {
    return { measurable: 0 };
  }
}

/** Words for the matched shapes — read from the CLOSED shape vocabulary, never
 *  from anything the detector matched. The dashboard's wording is written
 *  server-side from the same number; this copy serves the kit's own panel,
 *  which never sees the server. */
const LEAK_SHAPE_WORDS: ReadonlyArray<{ bit: number; word: string }> = [
  { bit: LEAK_SHAPE_JWT, word: "a JSON Web Token" },
  { bit: LEAK_SHAPE_BEARER, word: "a bearer credential" },
  { bit: LEAK_SHAPE_AWS_KEY_ID, word: "an AWS access-key id" },
  { bit: LEAK_SHAPE_PRIVATE_KEY, word: "a private-key header" },
  { bit: LEAK_SHAPE_NAMED_VALUE, word: "a named api-key/secret/token value" },
  { bit: LEAK_SHAPE_EMAIL, word: "an email address" },
  { bit: LEAK_SHAPE_STACK_FRAME, word: "a stack frame" },
];
function leakShapePhrase(shapeMask: number): string {
  const words = LEAK_SHAPE_WORDS.filter((s) => (shapeMask & s.bit) !== 0).map(
    (s) => s.word,
  );
  return words.length === 0
    ? "shape not recorded"
    : `matched ${words.join(", ")}`;
}

/** Build a counts-and-closed-vocabulary caption, e.g. "3 possible leaks
 *  observed (2 secret-like, 1 stack trace) · all in your app's log output ·
 *  matched a JSON Web Token, a stack frame". NEVER content. */
function leakSummary(
  count: number,
  secretCount: number,
  piiCount: number,
  stackCount: number,
  shapeMask: number,
): string {
  const parts: string[] = [];
  if (secretCount > 0) parts.push(`${secretCount} secret-like`);
  if (piiCount > 0) parts.push(`${piiCount} personal-detail`);
  if (stackCount > 0) {
    parts.push(`${stackCount} stack trace${stackCount !== 1 ? "s" : ""}`);
  }
  const noun = `possible leak${count !== 1 ? "s" : ""}`;
  return (
    `${count} ${noun} observed (${parts.join(", ")})` +
    " \u00b7 all in your app's log output" +
    ` \u00b7 ${leakShapePhrase(shapeMask)}`
  );
}

/** @internal test hooks — deterministic, no dependence on a real console. */
export const _leakWatchInternals = {
  LEAK_WINDOW_MS,
  LEAK_MIN_WINDOW_MS,
  LEAK_RING_CAP,
  LEAK_SCAN_LIMIT,
  get isInstalled(): boolean {
    return installed;
  },
  get count(): number {
    return events.length;
  },
  /** Classify a bounded text slice exactly as the collector does (test-only). */
  classifyForTests(text: string): LeakCategory | null {
    const t = text.length > LEAK_SCAN_LIMIT ? text.slice(0, LEAK_SCAN_LIMIT) : text;
    return classify(t)?.cat ?? null;
  },
  /** The closed numeric SHAPE code the collector would record (test-only). */
  classifyShapeForTests(text: string): number | null {
    const t = text.length > LEAK_SCAN_LIMIT ? text.slice(0, LEAK_SCAN_LIMIT) : text;
    return classify(t)?.shape ?? null;
  },
  /** Force the installed flag on without the shared chain being live. */
  setInstalledForTests(v: boolean): void {
    installed = v;
    if (v && startedAt === 0) startedAt = nowMs();
  },
  /** Push n synthetic events of a category (defaults to "now"), ring-capped.
   *  The shape code defaults to the stack-frame shape so older callers still
   *  produce a well-formed event. */
  fireForTests(
    cat: LeakCategory,
    n = 1,
    at?: number,
    shape: number = LEAK_SHAPE_STACK_FRAME,
  ): void {
    for (let i = 0; i < Math.max(0, Math.round(n)); i++) {
      events.push({ ts: at ?? nowMs(), cat, surf: LEAK_SURFACE_LOG, shape });
    }
    if (events.length > LEAK_RING_CAP) {
      events.splice(0, events.length - LEAK_RING_CAP);
    }
  },
  /** Move the window origin back so readings clear the warm-up gate. */
  setStartedAtForTests(ms: number): void {
    startedAt = ms;
  },
  reset(): void {
    markLeakWatchUninstalled();
  },
};
