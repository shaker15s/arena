/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: Lifecycle & device-context axes (React Native) ───────────
 *
 * Five RN-exclusive, ADDITIVE, display-only meters driven ENTIRELY by RN's
 * own lifecycle/device event subscriptions — no new permanent poller, no rAF
 * loop that stays alive, nothing that keeps the app awake or fires while
 * backgrounded. Each listener is best-effort, feature-detected, wrapped so a
 * throw can never reach the host's dispatch, and removed on teardown.
 *
 * Axes (all read their own module state; numbers-only wire shape):
 *   • foregroundResidency — share of observed session time that is actually
 *     foreground, so a short visit isn't mistaken for a well-observed run.
 *     ALWAYS warms: AppState reports "active" on launch, so any ordinary run
 *     accrues foreground time. (Higher fraction = better.)
 *   • backgroundRecovery — how long the JS runtime takes to resume a useful
 *     rAF callback after returning to "active". We schedule ONE rAF on each
 *     background→active transition (never a standing loop) and time it. Absent
 *     until the app has been backgrounded and returned at least once.
 *   • dimensionChurn — orientation/window-size change events per foreground
 *     hour. A calm app changes rarely; a thrash reads as churn.
 *   • appearanceChurn — system theme/appearance change notifications per
 *     foreground hour.
 *   • keyboardLatency — p75 gap from a keyboard show/hide RN event to the next
 *     rAF (how long the JS thread takes to settle around a keyboard
 *     transition). Absent until enough transitions are sampled.
 *
 * HONESTY / INVARIANTS:
 *   • NEVER feed the composite Speed score (TTFF/TTI/FID). Display-only.
 *   • OMIT WHILE WARMING / NOT WIRED: readers return null when the relevant
 *     listener never attached or too little has been observed → the axis is
 *     dropped from the upload (server renders an absent expected axis as
 *     "warming up"). We never fabricate a 0 or a fake "healthy" reading.
 *   • Counts + durations only. No labels, no dimensions payload, no theme
 *     string — just how OFTEN and how LONG.
 *
 * GUEST-SAFETY: react-native is lazy-required; if a module/API is missing the
 * subscription simply isn't attached and the axis reads pending. Every handler
 * is safeHandler-wrapped. uninstallLifecycleTracking() removes every
 * subscription and is wired into telemetry.forget(). Idempotent, never throws.
 */

import { linearScore, ratingFor, type AxisRating, type AxisThresholds } from "./axisScoring";
import { earnedPerHour, MIN_RATE_WINDOW_MS, windowMinOf } from "./rateHonesty";
import { safeHandler, safeRun } from "./safe";
import { REASON_NOT_WIRED_BY_HOST } from "./axisReasons";
import {
  noteAppForegroundState,
  clearBackgroundSpans,
} from "./backgroundSpans";
import { clearDeviceFacts, noteDeviceForegroundState } from "./deviceFacts";
import { bankedWatch, flushWatchNow, type BankedWatch } from "./watchHistory";
import { closeOpenCircuitScreen, resumeCircuitScreen } from "./screenCircuit";

/* ─── Thresholds ────────────────────────────────────────────────────── */

/* foregroundResidency / dimensionChurn / appearanceChurn carry NO bands: they
 * are published as measurements and never graded. See
 * docs/decisions/meter-verdicts-that-are-not-about-the-app.md — how long a
 * person keeps an app open, how often they rotate the phone and how often they
 * switch to dark mode are facts about the person and the device, not about the
 * app, and there is no change the app's author can make to move them. Bands
 * were deleted rather than left unused so the next reader cannot re-wire them. */

/** Background-return recovery bands (ms to the first rAF after active). ≤120ms
 *  is a snappy resume (100); ≥1000ms means the JS runtime stalled coming back
 *  (0). GRADED: the clock starts at the OS handover, so what fills it is the
 *  app's own resume work. */
export const BACKGROUND_RECOVERY_THRESHOLDS = { good: 120, poor: 1000 } as const satisfies AxisThresholds;

/** Keyboard-transition latency bands (p75 ms, RN event → next rAF). ≤50ms is
 *  instant (100); ≥250ms is a visibly laggy keyboard (0). */
export const KEYBOARD_LATENCY_THRESHOLDS = { good: 50, poor: 250 } as const satisfies AxisThresholds;

/** Minimum foreground time before the residency / churn axes report (below
 *  this a single blip would swamp the reading). The churn axes publish a
 *  per-hour projection, so this is the earned-rate contract's minimum.
 *  This gate is read against the FOREGROUND clock, never the observed-session
 *  clock: a reading whose quantity is a share of foreground time must not open
 *  on time the app spent in someone's pocket. */
const LIFECYCLE_MIN_ACTIVE_MS = MIN_RATE_WINDOW_MS;

/** A single unbroken background stretch contributes at most this much to the
 *  observed-session clock. A phone pocketed for an hour is not an hour of the
 *  app failing to be in front; past this bound the stretch says nothing
 *  further, so counting it only drags the published share toward zero. */
const BACKGROUND_SPAN_CAP_MS = 5 * 60_000;
/** Minimum keyboard transitions sampled before that axis reports. */
const KEYBOARD_MIN_SAMPLES = 3;
/** Cap on retained keyboard-latency samples (bounded memory). */
const KEYBOARD_RING_CAP = 200;
/** rAF deltas above this are treated as a backgrounding, not a real resume. */
const RECOVERY_SANE_MAX_MS = 5_000;

/* ─── Result shapes (numbers-only wire) ─────────────────────────────── */

export interface ForegroundResidencyResult {
  /** ALWAYS null: this reading is never graded (see readForegroundResidency).
   *  The field stays on the wire so the shared tile keeps one shape. */
  score:        number | null;
  rating:       AxisRating;
  /** 1 once the reading is real — a measurement with no rating, not a wait. */
  measurable?:  1;
  /** Foreground share of the observed session (0–100), or null while warming. */
  foregroundPct: number | null;
  /** Foreground minutes the share rests on, across every run inside the
   *  banked window (shown even while warming). Floored to a whole second —
   *  never rounded UP to time we did not watch. */
  activeMin:    number;
  /** OBSERVED minutes — the share's denominator. Reported beside the
   *  numerator so the far side can see both halves of the fraction rather
   *  than a percentage it has to take on trust. */
  observedMin:  number;
  /** Earlier runs inside the window this reading pooled, when there were
   *  any. Omitted for a single-run reading, which is what its absence has
   *  always meant. */
  runsInWindow?: number;
}

export interface BackgroundRecoveryResult {
  /** 0–100, or null while warming (no background→active resume timed yet). */
  score:      number | null;
  rating:     AxisRating;
  /** p75 resume latency (ms), or null while warming. */
  p75Ms:      number | null;
  /** Worst resume latency (ms) this session, 0 if none. */
  worstMs:    number;
  /** Background→active resumes timed this session. */
  returnCount: number;
}

export interface DimensionChurnResult {
  /** ALWAYS null: never graded (see readChurn). */
  score:     number | null;
  rating:    AxisRating;
  /** 1 once the rate is real — a measurement with no rating, not a wait. */
  measurable?: 1;
  /** Dimension-change events per foreground hour, or null while warming. */
  perHour:   number | null;
  /** Dimension-change events inside the banked window — this run's, plus
   *  those earlier runs of this app on this device banked (shown even while
   *  warming). */
  count:     number;
  activeMin: number;
  /** Earlier runs inside the window this reading pooled, when there were
   *  any. Omitted for a single-run reading. */
  runsInWindow?: number;
}

export interface AppearanceChurnResult {
  /** ALWAYS null: never graded (see readChurn). */
  score:     number | null;
  rating:    AxisRating;
  /** 1 once the rate is real — a measurement with no rating, not a wait. */
  measurable?: 1;
  /** Appearance-change events per foreground hour, or null while warming. */
  perHour:   number | null;
  /** Appearance-change events inside the banked window — this run's, plus
   *  those earlier runs of this app on this device banked (shown even while
   *  warming). */
  count:     number;
  activeMin: number;
  /** Earlier runs inside the window this reading pooled, when there were
   *  any. Omitted for a single-run reading. */
  runsInWindow?: number;
}

export interface KeyboardLatencyResult {
  score:  number | null;
  rating: AxisRating;
  /** p75 keyboard-transition latency (ms), or null while warming. */
  p75Ms:  number | null;
  /** Worst keyboard-transition latency (ms) this session, 0 if none. */
  worstMs: number;
  /** Keyboard transitions sampled (shown even while warming). */
  count:  number;
  measurable?: 0 | 1;
  reasonCode?: number;
}

/* ─── Minimal lazy-required RN surface ──────────────────────────────── */

type Sub = { remove?: () => void } | void;
interface AppStateLike {
  currentState?: string | null;
  addEventListener?: (type: string, handler: (...a: unknown[]) => void) => Sub;
}
interface DimensionsLike {
  addEventListener?: (type: string, handler: (...a: unknown[]) => void) => Sub;
}
interface AppearanceLike {
  addChangeListener?: (handler: (...a: unknown[]) => void) => Sub;
}
interface KeyboardLike {
  addListener?: (type: string, handler: (...a: unknown[]) => void) => Sub;
}
interface RNLike {
  AppState?: AppStateLike;
  Dimensions?: DimensionsLike;
  Appearance?: AppearanceLike;
  Keyboard?: KeyboardLike;
}

/* ─── Module state ──────────────────────────────────────────────────── */

let installed = false;

// Foreground residency + background recovery (AppState).
let appStateWired = false;
let foregroundMs = 0;       // accumulated foreground time (ms)
let observedMs = 0;         // accumulated total observed time (fg + bg)
let lastStateAt = 0;        // monotonic ms of the last state transition
let currentActive = true;   // are we currently foregrounded?
/** Background time already charged to `observedMs` for the CURRENT unbroken
 *  background stretch. The cap is per STRETCH, not per notification: a phone
 *  goes inactive, then paused, then hidden without ever coming back to the
 *  front, and every one of those is a separate lifecycle event mapping to the
 *  same "not in the foreground". Charging each one its own allowance would
 *  hand a single pocketed hour three or four allowances and put the pocket
 *  back in the denominator. Reset to zero on the way IN to the foreground. */
let backgroundChargedMs = 0;
const recoverySamples: number[] = []; // background→active resume latencies (ms)
let recoveryWorstMs = 0;

// Dimension + appearance churn.
let dimensionWired = false;
let dimensionCount = 0;
let appearanceWired = false;
let appearanceCount = 0;

// Keyboard transition latency.
let keyboardWired = false;
/**
 * POSITIVE evidence this host cannot take the keyboard reading: wireRn() ran
 * and there was no Keyboard module to listen to.
 *
 * `keyboardWired === false` is NOT that evidence — it is equally true before
 * the kit starts and after forget() — and reading it as a platform verdict
 * was the first version of this fix. Only a look that found nothing earns
 * "not available here"; anything else stays "pending".
 */
let keyboardSurfaceAbsent = false;
const keyboardSamples: number[] = [];
let keyboardWorstMs = 0;

// Subscriptions to remove on teardown.
const subs: Array<{ remove?: () => void }> = [];

/* ─── Clocks ────────────────────────────────────────────────────────── */

/** Monotonic ms (rAF-comparable), falling back to Date.now(). */
function monoNow(): number {
  const p = (globalThis as unknown as { performance?: { now?: () => number } })
    .performance;
  return typeof p?.now === "function" ? p.now() : Date.now();
}

/** Feature-detected requestAnimationFrame, or null. */
function raf(): ((cb: (t: number) => void) => unknown) | null {
  const g = globalThis as unknown as {
    requestAnimationFrame?: (cb: (t: number) => void) => unknown;
  };
  return typeof g.requestAnimationFrame === "function"
    ? g.requestAnimationFrame.bind(g)
    : null;
}

/** p75 of a numeric sample array (0 when empty). */
function p75(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.75))];
}

/* ─── AppState: foreground clock + background-return recovery ───────── */

/** Fold the time since the last transition into the fg/observed clocks. A
 *  background stretch is bounded (BACKGROUND_SPAN_CAP_MS) before it reaches the
 *  observed clock, so a pocketed phone cannot inflate the denominator. */
function accrue(now: number): void {
  if (lastStateAt > 0) {
    const dt = now - lastStateAt;
    if (dt > 0 && dt < 24 * 3_600_000) {
      if (currentActive) {
        observedMs += dt;
        foregroundMs += dt;
      } else {
        // What is left of THIS unbroken background stretch's allowance —
        // never a fresh one per notification.
        const room = Math.max(0, BACKGROUND_SPAN_CAP_MS - backgroundChargedMs);
        const charged = dt < room ? dt : room;
        observedMs += charged;
        backgroundChargedMs += charged;
      }
    }
  }
  lastStateAt = now;
}

function onAppStateChange(next: unknown): void {
  const now = monoNow();
  accrue(now);
  const active = next === "active";
  const wasActive = currentActive;
  currentActive = active;
  // A stretch ends when the app comes back to the front, and only then. Every
  // notification that keeps the app out of the foreground — inactive, then
  // background — is the SAME stretch, and shares the one allowance.
  if (active) backgroundChargedMs = 0;
  // Tell the background-suspend sensor, from the kit's ONE AppState listener,
  // so the meters can withhold a duration that was measured while the app was
  // asleep in a pocket rather than working. Wall clock deliberately — that is
  // the clock the perf events are stamped in, and the only one that keeps
  // running while the app is suspended.
  noteAppForegroundState(active, Date.now());
  // The same transition, read for a different question: not "was this
  // measurement taken while the app slept?" but "what did the platform let
  // the app DO while it slept?" — the phone's half of the record of what a
  // platform allows. Same single listener; see deviceFacts.ts.
  noteDeviceForegroundState(active, Date.now());
  // And the same transition, read for a third: this is the moment the app may
  // never come back from. Everything watched since the last write is lost if
  // the ledger is not flushed here, and on a four-minute session that is most
  // of it — the whole reason these rates could never earn their window. Same
  // single listener; see watchHistory.ts.
  if (!active) flushWatchNow(Date.now());
  // The same transition again, for the circuit: the screen the app is on has
  // not been left, so nothing has closed it, and an app that never comes back
  // would leave its last node undrawn. Inert unless the developer switched
  // the circuit on.
  if (!active) closeOpenCircuitScreen();
  // And the other half of the same transition: the app is back, on the screen
  // it left. Returning to a route it never left raises no navigation event, so
  // the circuit reopens that screen itself, as the entry node of a fresh
  // journey — otherwise every call made after the phone came out of a pocket
  // hangs off a node that was sent hours ago. Inert unless the circuit is on.
  if (active && !wasActive) resumeCircuitScreen();
  // On a background→active transition, time the FIRST rAF that fires (one-shot;
  // never a standing loop). A missing rAF just means no sample is recorded.
  if (active && !wasActive) {
    const scheduleRaf = raf();
    if (scheduleRaf) {
      const t0 = monoNow();
      safeRun("lifecycle-recovery-raf-schedule", () => {
        scheduleRaf(() => {
          safeRun("lifecycle-recovery-raf-cb", () => {
            const dt = monoNow() - t0;
            // Drop insane gaps (another backgrounding before the frame fired).
            if (dt > 0 && dt < RECOVERY_SANE_MAX_MS) {
              recoverySamples.push(dt);
              if (recoverySamples.length > KEYBOARD_RING_CAP) {
                recoverySamples.splice(0, recoverySamples.length - KEYBOARD_RING_CAP);
              }
              if (dt > recoveryWorstMs) recoveryWorstMs = dt;
            }
          });
        });
      });
    }
  }
}

/* ─── Keyboard transition latency ───────────────────────────────────── */

function onKeyboardTransition(): void {
  const scheduleRaf = raf();
  if (!scheduleRaf) return;
  const t0 = monoNow();
  safeRun("lifecycle-keyboard-raf-schedule", () => {
    scheduleRaf(() => {
      safeRun("lifecycle-keyboard-raf-cb", () => {
        const dt = monoNow() - t0;
        if (dt >= 0 && dt < RECOVERY_SANE_MAX_MS) {
          keyboardSamples.push(dt);
          if (keyboardSamples.length > KEYBOARD_RING_CAP) {
            keyboardSamples.splice(0, keyboardSamples.length - KEYBOARD_RING_CAP);
          }
          if (dt > keyboardWorstMs) keyboardWorstMs = dt;
        }
      });
    });
  });
}

/* ─── Install / uninstall ───────────────────────────────────────────── */

/**
 * Attach the lifecycle/device listeners. Idempotent, best-effort, NEVER throws.
 * Each subscription is feature-detected independently — a missing API just
 * leaves that axis pending; the host is never touched. Call from telemetry
 * start.
 */
/** Attach the lifecycle/device listeners against a resolved RN-like surface.
 *  Extracted from installLifecycleTracking so both the real require path and the
 *  deterministic test seam drive one identical wiring path. Best-effort; each
 *  subscription is feature-detected independently. */
function wireRn(rn: RNLike): void {
  try {
    // AppState → foreground residency + background recovery.
    const appState = rn?.AppState;
    if (appState && typeof appState.addEventListener === "function") {
      currentActive = appState.currentState == null ? true : appState.currentState === "active";
      lastStateAt = monoNow();
      // Seed the background-suspend sensor with the state the app is ALREADY
      // in. An app can be launched into the background — a push notification,
      // a location wake, a background fetch — and if the sensor only ever
      // hears about later transitions, that first stretch is invisible: the
      // work started at launch is still "in flight" when the person finally
      // opens the app minutes later, and the whole wait lands in the tail as
      // if the app had been slow. A currentState we cannot read leaves the
      // sensor alone rather than inventing a background period.
      if (appState.currentState != null) {
        noteAppForegroundState(currentActive, Date.now());
      }
      const handler = safeHandler("lifecycle-appstate", (next: unknown) =>
        onAppStateChange(next),
      );
      const sub = appState.addEventListener("change", handler);
      if (sub && typeof (sub as { remove?: unknown }).remove === "function") {
        subs.push(sub as { remove: () => void });
      }
      appStateWired = true;
    }

    // Dimensions → dimension-change churn.
    const dims = rn?.Dimensions;
    if (dims && typeof dims.addEventListener === "function") {
      const handler = safeHandler("lifecycle-dimensions", () => {
        dimensionCount += 1;
      });
      const sub = dims.addEventListener("change", handler);
      if (sub && typeof (sub as { remove?: unknown }).remove === "function") {
        subs.push(sub as { remove: () => void });
      }
      dimensionWired = true;
    }

    // Appearance → appearance-change churn.
    const appearance = rn?.Appearance;
    if (appearance && typeof appearance.addChangeListener === "function") {
      const handler = safeHandler("lifecycle-appearance", () => {
        appearanceCount += 1;
      });
      const sub = appearance.addChangeListener(handler);
      if (sub && typeof (sub as { remove?: unknown }).remove === "function") {
        subs.push(sub as { remove: () => void });
      }
      appearanceWired = true;
    }

    // Keyboard → transition latency (show + hide).
    const keyboard = rn?.Keyboard;
    if (keyboard && typeof keyboard.addListener === "function") {
      const handler = safeHandler("lifecycle-keyboard", () => onKeyboardTransition());
      for (const evt of ["keyboardDidShow", "keyboardDidHide"]) {
        const sub = keyboard.addListener(evt, handler);
        if (sub && typeof (sub as { remove?: unknown }).remove === "function") {
          subs.push(sub as { remove: () => void });
        }
      }
      keyboardWired = true;
    } else {
      // We looked, and this host has no Keyboard module: no show/hide
      // transition can ever be timed here.
      keyboardSurfaceAbsent = true;
    }
  } catch {
    // Not an RN runtime, or wiring failed — whatever attached stays; the rest
    // reads pending. Never touch the host.
  }
}

export function installLifecycleTracking(): void {
  if (installed) return;
  installed = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require("react-native") as RNLike;
    wireRn(rn);
  } catch {
    // Not an RN runtime — nothing attached; every axis reads pending.
  }
}

/**
 * Remove every lifecycle subscription and drop all state. Idempotent, NEVER
 * throws. Wired into telemetry.forget() so nothing Boosthis-shaped keeps
 * listening after erasure.
 */
export function uninstallLifecycleTracking(): void {
  for (const s of subs) {
    try {
      s.remove?.();
    } catch {
      /* best-effort — never throw on teardown */
    }
  }
  subs.length = 0;
  installed = false;
  appStateWired = false;
  dimensionWired = false;
  appearanceWired = false;
  keyboardWired = false;
  // Erasure leaves NO claim behind, including the claim that this host has no
  // keyboard. The next install looks again and decides again.
  keyboardSurfaceAbsent = false;
  foregroundMs = 0;
  observedMs = 0;
  lastStateAt = 0;
  currentActive = true;
  backgroundChargedMs = 0;
  recoverySamples.length = 0;
  recoveryWorstMs = 0;
  dimensionCount = 0;
  appearanceCount = 0;
  keyboardSamples.length = 0;
  keyboardWorstMs = 0;
  // The background-suspend sensor is fed from this module's ONE AppState
  // listener, so it is erased with it: after forget() nothing Boosthis-shaped
  // keeps a record of when the app was asleep.
  clearBackgroundSpans();
  // Same reason for the platform-facts sensor: it is fed from this listener
  // and from the upload loop, and forget() must leave nothing behind.
  clearDeviceFacts();
}

/* ─── Readers (pure; never throw) ───────────────────────────────────── */

/** Snapshot the foreground clock without mutating it (folds the in-progress
 *  segment for reads only). Returns { fg, observed } ms. */
function residencySnapshot(): { fg: number; observed: number } {
  const now = monoNow();
  let fg = foregroundMs;
  let obs = observedMs;
  if (lastStateAt > 0) {
    const dt = now - lastStateAt;
    if (dt > 0 && dt < 24 * 3_600_000) {
      // Same bound as accrue(): the in-progress segment is folded for reads
      // only, and a still-running background stretch gets what is LEFT of the
      // current stretch's allowance, never a fresh one.
      if (currentActive) {
        obs += dt;
        fg += dt;
      } else {
        const room = Math.max(0, BACKGROUND_SPAN_CAP_MS - backgroundChargedMs);
        obs += dt < room ? dt : room;
      }
    }
  }
  return { fg, observed: obs };
}

/** Foreground time observed independently of rAF. A missing AppState listener
 * is positive evidence that this clock does not exist, so return zero. */
export function observedForegroundMs(): number {
  if (!appStateWired) return 0;
  return residencySnapshot().fg;
}

export function readForegroundResidency(
  banked: BankedWatch = bankedWatch(),
): ForegroundResidencyResult {
  try {
    const live = residencySnapshot();
    // WHAT THIS APP WATCHED, NOT WHAT THIS RUN WATCHED. A phone app is used in
    // bursts of a few minutes, so a window earned inside one run is a window
    // this reading never reaches. Earlier runs of this same app on this same
    // device banked what they watched; it is added here. See
    // docs/decisions/rate-window-earned-across-sessions.md.
    const fg = live.fg + banked.foregroundMs;
    const observed = live.observed + banked.observedMs;
    // FLOORED TO A WHOLE SECOND, never rounded up. This used to round: thirty
    // seconds of foreground reported "1m observed", which is the same
    // fabrication as an unearned rate one level down — and banking a rounded
    // figure would compound it once per run. See windowMinOf in rateHonesty.
    const activeMin = windowMinOf(fg);
    const observedMin = windowMinOf(observed);
    const runsTail = banked.runs > 0 ? { runsInWindow: banked.runs + 1 } : {};
    // The gate reads the FOREGROUND clock, because foreground time is the
    // quantity the reading is about. It used to read `observed`, which counts
    // background: a phone left in a pocket satisfied "enough evidence" while
    // the foreground clock was still near zero, so the axis opened on evidence
    // its own number could not use.
    if (!appStateWired || fg < LIFECYCLE_MIN_ACTIVE_MS) {
      return {
        score: null,
        rating: "pending",
        foregroundPct: null,
        activeMin,
        observedMin,
        ...runsTail,
      };
    }
    const frac = observed > 0 ? Math.min(1, fg / observed) : 0;
    // NEVER GRADED. How long someone keeps an app open is a fact about that
    // person, not about the app, and no change its author can make moves it.
    // The numbers stay because "how long we actually watched" is real
    // information; the verdict goes.
    return {
      score: null,
      rating: "not-scored",
      measurable: 1,
      foregroundPct: Math.round(frac * 1000) / 10,
      activeMin,
      observedMin,
      ...runsTail,
    };
  } catch {
    return {
      score: null,
      rating: "pending",
      foregroundPct: null,
      activeMin: 0,
      observedMin: 0,
    };
  }
}

export function readBackgroundRecovery(): BackgroundRecoveryResult {
  try {
    const count = recoverySamples.length;
    if (!appStateWired || count === 0) {
      return {
        score: null,
        rating: "pending",
        p75Ms: null,
        worstMs: Math.round(recoveryWorstMs),
        returnCount: count,
      };
    }
    const v = p75(recoverySamples);
    const score = linearScore(
      v,
      BACKGROUND_RECOVERY_THRESHOLDS.good,
      BACKGROUND_RECOVERY_THRESHOLDS.poor,
    );
    return {
      score,
      rating: ratingFor(score),
      p75Ms: Math.round(v),
      worstMs: Math.round(recoveryWorstMs),
      returnCount: count,
    };
  } catch {
    return { score: null, rating: "pending", p75Ms: null, worstMs: 0, returnCount: 0 };
  }
}

function readChurn(
  wired: boolean,
  liveCount: number,
  bankedCount: number,
  banked: BankedWatch,
): {
  score: number | null;
  rating: AxisRating;
  measurable?: 1;
  perHour: number | null;
  count: number;
  activeMin: number;
  runsInWindow?: number;
} {
  const { fg: liveFg } = residencySnapshot();
  // POOLED ACROSS THE RUNS OF THIS APP ON THIS DEVICE. A four-minute session
  // can never earn a per-hour projection on its own, so both halves of the
  // rate come from the banked window: the count and the time it was counted
  // over, always together. See docs/decisions/rate-window-earned-across-sessions.md.
  const fg = liveFg + banked.foregroundMs;
  const count = liveCount + bankedCount;
  // The window the rate rests on, reported at the precision the contract keeps
  // (rateHonesty.ts): a foreground stretch rounded UP to a whole minute is a
  // window we did not watch, and the server re-judges the projection from it.
  const activeMin = windowMinOf(fg);
  const runsTail = banked.runs > 0 ? { runsInWindow: banked.runs + 1 } : {};
  // The earned-rate contract (rateHonesty.ts): no projection, and no judgement
  // built on one, until the observation window has earned it. The raw count and
  // the window observed are reported either way.
  const perHour = wired ? earnedPerHour(count, fg) : null;
  if (perHour === null) {
    return { score: null, rating: "pending", perHour: null, count, activeMin, ...runsTail };
  }
  // NEVER GRADED. Rotating a phone and switching to dark mode are things the
  // person holding the device does; the app cannot stop them, so a rate of
  // them is not a verdict on the app. The rate is published as a measurement.
  return {
    score: null,
    rating: "not-scored",
    measurable: 1,
    perHour,
    count,
    activeMin,
    ...runsTail,
  };
}

export function readDimensionChurn(
  banked: BankedWatch = bankedWatch(),
): DimensionChurnResult {
  try {
    return readChurn(dimensionWired, dimensionCount, banked.dimensionChanges, banked);
  } catch {
    return { score: null, rating: "pending", perHour: null, count: 0, activeMin: 0 };
  }
}

export function readAppearanceChurn(
  banked: BankedWatch = bankedWatch(),
): AppearanceChurnResult {
  try {
    return readChurn(appearanceWired, appearanceCount, banked.appearanceChanges, banked);
  } catch {
    return { score: null, rating: "pending", perHour: null, count: 0, activeMin: 0 };
  }
}

/**
 * What THIS RUN has watched and counted, for the cross-run ledger.
 *
 * Live values only — never the banked total, or a run would bank a figure
 * that already contains every earlier run and the ledger would compound on
 * itself once per write. See watchHistory.ts.
 */
export function lifecycleRunWatch(): {
  foregroundMs: number;
  observedMs: number;
  dimensionChanges: number;
  appearanceChanges: number;
} {
  try {
    const { fg, observed } = residencySnapshot();
    return {
      // A clock nobody wired is not a zero reading, it is no reading — and
      // banking a zero would dilute a window earned by the runs that DID
      // wire it. The counts follow their own listener for the same reason.
      foregroundMs: appStateWired ? fg : 0,
      observedMs: appStateWired ? observed : 0,
      dimensionChanges: dimensionWired ? dimensionCount : 0,
      appearanceChanges: appearanceWired ? appearanceCount : 0,
    };
  } catch {
    return { foregroundMs: 0, observedMs: 0, dimensionChanges: 0, appearanceChanges: 0 };
  }
}

export function readKeyboardLatency(): KeyboardLatencyResult {
  try {
    const count = keyboardSamples.length;
    if (!keyboardWired && keyboardSurfaceAbsent) {
      return {
        score: null,
        rating: "not-available",
        p75Ms: null,
        worstMs: Math.round(keyboardWorstMs),
        count,
        measurable: 0,
        reasonCode: REASON_NOT_WIRED_BY_HOST,
      };
    }
    if (count < KEYBOARD_MIN_SAMPLES) {
      return {
        score: null,
        rating: "pending",
        p75Ms: null,
        worstMs: Math.round(keyboardWorstMs),
        count,
      };
    }
    const v = p75(keyboardSamples);
    const score = linearScore(
      v,
      KEYBOARD_LATENCY_THRESHOLDS.good,
      KEYBOARD_LATENCY_THRESHOLDS.poor,
    );
    return {
      score,
      rating: ratingFor(score),
      p75Ms: Math.round(v),
      worstMs: Math.round(keyboardWorstMs),
      count,
    };
  } catch {
    return { score: null, rating: "pending", p75Ms: null, worstMs: 0, count: 0 };
  }
}

/** @internal test hooks — deterministic, no dependence on real RN modules. */
export const _lifecycleInternals = {
  BACKGROUND_RECOVERY_THRESHOLDS,
  KEYBOARD_LATENCY_THRESHOLDS,
  LIFECYCLE_MIN_ACTIVE_MS,
  BACKGROUND_SPAN_CAP_MS,
  KEYBOARD_MIN_SAMPLES,
  get isInstalled(): boolean {
    return installed;
  },
  /** Wire against a caller-provided RN-like surface via the REAL wiring path
   *  (no dependence on require("react-native")), so tests can drive the actual
   *  AppState / Dimensions / Appearance / Keyboard listeners deterministically. */
  installWithRnForTests(rn: RNLike): void {
    if (installed) return;
    installed = true;
    wireRn(rn);
  },
  /** Force each subsystem's wired flag on without real RN modules. */
  setWiredForTests(v: {
    appState?: boolean;
    dimension?: boolean;
    appearance?: boolean;
    keyboard?: boolean;
  }): void {
    if (v.appState !== undefined) appStateWired = v.appState;
    if (v.dimension !== undefined) dimensionWired = v.dimension;
    if (v.appearance !== undefined) appearanceWired = v.appearance;
    if (v.keyboard !== undefined) keyboardWired = v.keyboard;
    installed = true;
  },
  /** Force the "wiring ran and there was no Keyboard module" evidence. That,
   *  not the bare wired flag, is what "not available here" rests on. */
  setKeyboardSurfaceAbsentForTests(v: boolean): void {
    keyboardSurfaceAbsent = v;
  },
  /** Seed the foreground/observed clock directly (ms), currentActive state. */
  setClockForTests(fgMs: number, observedMs2: number, active = true): void {
    foregroundMs = Math.max(0, fgMs);
    observedMs = Math.max(foregroundMs, observedMs2);
    currentActive = active;
    backgroundChargedMs = 0;
    lastStateAt = 0; // freeze: reads won't fold an in-progress segment
  },
  /** How much of the current unbroken background stretch's allowance has been
   *  spent (ms). Exposed so a test can prove the cap is per STRETCH. */
  backgroundChargedMsForTests(): number {
    return backgroundChargedMs;
  },
  fireDimensionForTests(n = 1): void {
    dimensionCount += Math.max(0, Math.round(n));
  },
  fireAppearanceForTests(n = 1): void {
    appearanceCount += Math.max(0, Math.round(n));
  },
  /** Push n synthetic keyboard-transition latencies (ms). */
  fireKeyboardForTests(...msValues: number[]): void {
    for (const ms of msValues) {
      keyboardSamples.push(ms);
      if (ms > keyboardWorstMs) keyboardWorstMs = ms;
    }
  },
  /** Push n synthetic background-return recovery latencies (ms). */
  fireRecoveryForTests(...msValues: number[]): void {
    for (const ms of msValues) {
      recoverySamples.push(ms);
      if (ms > recoveryWorstMs) recoveryWorstMs = ms;
    }
  },
  reset(): void {
    uninstallLifecycleTracking();
  },
};
