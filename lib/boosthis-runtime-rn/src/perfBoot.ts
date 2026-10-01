/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: cold-start ladder ────────────────────────────────────────
 *
 * Per-screen tracking (usePerfTracker) only sees what happens AFTER a
 * screen component mounts. Cold start is a different animal — the
 * time from "user tapped the icon" to "user can interact with the
 * first screen" includes JS-bundle parse, root render, route mount,
 * and the InteractionManager idle gate. None of that is observable
 * from a screen-level hook.
 *
 * This module captures four named phases, all measured from
 * BOOT_START (which is set when this module is first imported — the
 * closest analog to "JS bundle finished loading" the JS realm gets):
 *
 *   bundleLoaded  — JS is parsed & this module ran. Should be ~0ms
 *                   since BOOT_START literally captures it.
 *   rootRendered  — RootLayout's first useEffect fired = first React
 *                   commit happened.
 *   firstScreen   — first navigated route's tracker reported afterCommit.
 *   interactive   — InteractionManager.runAfterInteractions fired in
 *                   the root, after fonts loaded + splash hidden.
 *
 * Indeed-style score for the boot ladder uses `interactive` as TTI
 * (Shopify's 2s P75 budget) and `rootRendered` as TTFF (matches
 * Shopify's <500ms screen-load budget applied to the first paint of
 * the app shell). Same piecewise-linear curve as computeScreenScore
 * — explainable and cheap.
 *
 * All marks emit as `phase:_boot:<phase>` events through perfMonitor,
 * so they show up in the existing PerfReport and snapshot/diff path
 * without any plumbing changes downstream.
 */

import { perfMonitor } from "./perfMonitor";
import { InvertedAxisBandError } from "./axisScoring";

/**
 * Captured at module-import time. The earliest moment the JS realm
 * can observe — anything before this is native-side and only
 * Xcode Instruments / Android Studio Profiler can see it.
 */
export const BOOT_START: number = Date.now();

export type BootPhase =
  | "bundleLoaded"
  | "rootRendered"
  | "firstScreen"
  | "interactive";

const seen = new Set<BootPhase>();
const elapsed: Partial<Record<BootPhase, number>> = {};

/**
 * Record a boot-phase mark. Per-phase dedupe — only the FIRST call
 * for a given phase is recorded (Strict-mode double-effects, hot
 * reload, etc. all become no-ops). Returns the elapsed-ms or null
 * if already recorded.
 */
export function markBoot(phase: BootPhase): number | null {
  if (seen.has(phase)) return null;
  seen.add(phase);
  const ms = Date.now() - BOOT_START;
  elapsed[phase] = ms;
  // Same key shape as screen-mount phases so the diagnoser, snapshot
  // diff, and prod sampler all aggregate boot consistently.
  perfMonitor.recordEvent(`phase:_boot:${phase}`, ms);
  return ms;
}

export interface BootScoreBreakdown {
  bundleLoadedMs: number | null;
  rootRenderedMs: number | null;
  firstScreenMs:  number | null;
  interactiveMs:  number | null;
  /** Composite 0-100 over rootRendered + interactive. */
  score:          number;
  rating:         "good" | "needs-work" | "poor" | "insufficient-data";
  /**
   * True when a boot phase came back implausibly large (> MAX_PLAUSIBLE_BOOT_MS)
   * and was therefore EXCLUDED from scoring. Boot marks are measured from
   * BOOT_START with wall-clock `Date.now()`, which keeps advancing while the app
   * is backgrounded or while the user sits on a pre-instrumented screen (splash,
   * login) before navigating in. That idle time is human wait, not load time, so
   * scoring it would produce a false "poor". When this is set, the inflated phase
   * is shown (rootRenderedMs/interactiveMs keep their raw values for context) but
   * not counted, and the UI/report should explain the gap.
   */
  idleSuspected:  boolean;
}

/**
 * Any single boot phase longer than this is treated as idle-contaminated, not a
 * real measurement, and is dropped from scoring. No legitimate React Native cold
 * boot — even a first-launch on a slow device — reaches interactivity a full
 * minute in; anything past this is the app having been backgrounded or parked on
 * a screen Boosthis can't see. Deliberately generous so it never discards a real
 * (if bad) boot.
 */
export const MAX_PLAUSIBLE_BOOT_MS = 60_000;

/** Same piecewise-linear curve as computeScreenScore — local copy
 *  to keep this module dependency-free of perfDiagnose.ts. A band the wrong
 *  way round refuses here too; see axisScoring's InvertedAxisBandError for
 *  why a silent answer is the one thing this must not give. */
function linearScore(ms: number, good: number, poor: number): number {
  if (!Number.isFinite(good) || !Number.isFinite(poor) || poor <= good) {
    throw new InvertedAxisBandError(good, poor);
  }
  if (ms <= good) return 100;
  if (ms >= poor) return 0;
  return Math.round(100 * (1 - (ms - good) / (poor - good)));
}

/**
 * Boot score using Shopify's published budgets:
 *   rootRendered (≈ first-paint of app shell): good <500ms, poor >1500ms
 *   interactive  (≈ 2s app-launch budget):     good <2000ms, poor >4000ms
 *
 * Weighted 30/70 — interactive dominates because it's what the user
 * actually waits on. Returns insufficient-data if `interactive`
 * hasn't fired yet (i.e. you called this before the app settled).
 */
export function getBootScore(): BootScoreBreakdown {
  const rrRaw = elapsed.rootRendered ?? null;
  const itRaw = elapsed.interactive  ?? null;

  // Idle guard: drop any phase past the plausibility ceiling from scoring (it is
  // human-idle/background time, not load time) but keep the raw value visible for
  // context. See MAX_PLAUSIBLE_BOOT_MS + the `idleSuspected` field docs.
  const rrIdle = rrRaw != null && rrRaw > MAX_PLAUSIBLE_BOOT_MS;
  const itIdle = itRaw != null && itRaw > MAX_PLAUSIBLE_BOOT_MS;
  const rr = rrIdle ? null : rrRaw;
  const it = itIdle ? null : itRaw;
  const idleSuspected = rrIdle || itIdle;

  const base = {
    bundleLoadedMs: elapsed.bundleLoaded ?? null,
    rootRenderedMs: rrRaw,
    firstScreenMs:  elapsed.firstScreen ?? null,
    interactiveMs:  itRaw,
    idleSuspected,
  };

  if (rr == null && it == null) {
    return { ...base, score: 0, rating: "insufficient-data" };
  }
  const rrScore = rr == null ? null : linearScore(rr, 500, 1500);
  const itScore = it == null ? null : linearScore(it, 2000, 4000);
  let weightSum = 0; let scoreSum = 0;
  if (rrScore != null) { weightSum += 0.30; scoreSum += 0.30 * rrScore; }
  if (itScore != null) { weightSum += 0.70; scoreSum += 0.70 * itScore; }
  const score = weightSum === 0 ? 0 : Math.round(scoreSum / weightSum);
  const rating: BootScoreBreakdown["rating"] =
    score >= 85 ? "good" : score >= 60 ? "needs-work" : "poor";
  return { ...base, score, rating };
}

// Auto-mark bundleLoaded immediately. By the time any other module
// imports this one, the JS realm has at minimum loaded enough of
// the bundle to evaluate a top-level statement. Subsequent calls
// from _layout.tsx are de-duped so this is the single source of truth.
markBoot("bundleLoaded");

/* ─── Boot kind classification (cold / warm / hot) ────────────────
 *
 * No other RN profiler distinguishes these three:
 *
 *   COLD — first launch ever after install OR after a user-killed
 *          process. Hermes bytecode cache is empty/cold, JS bundle
 *          parse is from disk, every singleton initializes from
 *          zero. Slowest case.
 *   WARM — relaunch within ~30 minutes of last launch. Hermes
 *          bytecode cache is warm, OS may still have pages cached,
 *          some singletons re-init but disk is fast.
 *   HOT  — fast resume from background (process never died). React
 *          state survives, only the splash flicker happens. Best
 *          case but still measurable from lifecycle hooks.
 *
 * Mixing these three in a single bootScore distribution hides 2-3x
 * differences in TTI that are physics, not regressions. Boosthis
 * exposes the kind so the dev viewer + prod sampler can bucket
 * scores correctly.
 *
 * Implementation is intentionally storage-free at module load —
 * AsyncStorage requires a hydrate. We expose `classifyBootKind()`
 * as an async function that the layout can fire-and-forget; until
 * it resolves, getBootKind() returns "unknown".
 */

export type BootKind = "cold" | "warm" | "hot" | "unknown";

const HOT_THRESHOLD_MS  = 60_000;          // < 1 min since last seen = hot resume
const WARM_THRESHOLD_MS = 30 * 60_000;     // < 30 min = warm
const STORAGE_KEY        = "boosthis:lastBootTs";
const FIRST_LAUNCH_KEY   = "boosthis:hasEverBooted";

let bootKind: BootKind = "unknown";
/** undefined = not yet classified; false = ever-booted before;
 *  true = this is the first launch since install/reinstall. */
let firstLaunch: boolean | undefined = undefined;

export function getBootKind(): BootKind {
  return bootKind;
}

/**
 * Whether this launch is the first one since install (or since the
 * user cleared app data). `undefined` until classifyBootKind() has
 * resolved. Distinct from BootKind="cold" — a regular cold launch
 * happens after a kill, with Hermes bytecode cache populated. A
 * first-launch is the only case where the cache is *empty*, and that
 * difference is typically 1.5-3× in TTI on real devices. Tools that
 * mix the two (Sentry, Firebase) report a "cold" distribution that's
 * structurally bimodal and miscalibrate their alerts as a result.
 */
export function isFirstLaunch(): boolean | undefined {
  return firstLaunch;
}

/**
 * Phase 2 of the first-launch marker — call once the app has actually
 * reached an interactive state (e.g. from the same useEffect that
 * marks `boot:interactive`). Upgrades the marker from "pending" to
 * "1", confirming that this launch successfully booted. If the user
 * kills the app before this call, the next launch will still be
 * classified as first-launch.
 *
 * Idempotent + best-effort. Failures stay silent — the worst case is
 * we re-classify next time, which is correct behavior.
 */
export async function confirmFirstLaunch(): Promise<void> {
  if (firstLaunch !== true) return;       // not a first-launch run, or not yet classified
  try {
    const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
    await AsyncStorage.setItem(FIRST_LAUNCH_KEY, "1");
  } catch {
    // Tolerate — next first-launch classification will simply re-fire.
  }
}

/**
 * Classify the current launch by comparing BOOT_START to the
 * previously-recorded boot timestamp in AsyncStorage. Idempotent —
 * safe to call multiple times; only the first call writes. Failures
 * (e.g. storage hydration error) leave kind as "unknown" rather than
 * blocking app startup.
 */
export async function classifyBootKind(): Promise<BootKind> {
  if (bootKind !== "unknown") return bootKind;
  try {
    // Lazy-import so this module stays cheap to evaluate at boot —
    // AsyncStorage is heavy (native bridge + serialization).
    const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
    const [prevRaw, everBootedRaw] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(FIRST_LAUNCH_KEY),
    ]);
    // Two-phase first-launch marker (architect-flagged):
    //   missing  → never booted before          → firstLaunch=true,  write "pending"
    //   "pending"→ a previous boot started but never confirmed
    //                                           → firstLaunch=true,  leave "pending"
    //   "1"      → at least one prior boot confirmed-interactive
    //                                           → firstLaunch=false
    // The flag is only upgraded "pending" → "1" by confirmFirstLaunch()
    // after the app reaches interactive. This avoids both failure modes:
    //   (a) crash after a fire-and-forget set "1" suppressing a true
    //       first-launch on the NEXT boot (false negative)
    //   (b) write that never reaches disk re-counting first-launch
    //       on every cold start forever (false positive loop)
    firstLaunch = everBootedRaw !== "1";
    if (firstLaunch && everBootedRaw !== "pending") {
      // First time we've ever seen this device — write "pending"
      // synchronously-awaited so a crash before this write completes
      // simply re-runs the first-launch path next time, instead of
      // claiming success the app never actually achieved.
      try { await AsyncStorage.setItem(FIRST_LAUNCH_KEY, "pending"); } catch { /* tolerate */ }
    }
    if (firstLaunch) perfMonitor.recordEvent("boot:firstLaunch", 0);
    const prev = prevRaw ? Number(prevRaw) : 0;
    // Only treat `delta` as a real elapsed-since-last-launch when we
    // actually have a sane prior timestamp. Without this guard the
    // first-ever launch logs `BOOT_START` itself (a Unix epoch in ms,
    // ~1.7×10^12) as a "duration", poisoning every aggregate that
    // touches the bootKind row. Architect-flagged.
    const hasPrior = prev > 0 && prev < BOOT_START;
    const delta = hasPrior ? BOOT_START - prev : -1;
    if (!hasPrior)                      bootKind = "cold";
    else if (delta < HOT_THRESHOLD_MS)  bootKind = "hot";
    else if (delta < WARM_THRESHOLD_MS) bootKind = "warm";
    else                                bootKind = "cold";
    // Update the marker — fire-and-forget, no need to await this.
    void AsyncStorage.setItem(STORAGE_KEY, String(BOOT_START));
    // Only record a duration when it's a real measurement. For first-
    // launch (no prior) we record durationMs = 0 so the event still
    // exists for consumers counting boot kinds, without contributing
    // a junk value to any p95 / mean over `event:bootKind:*`.
    perfMonitor.recordEvent(`bootKind:${bootKind}`, hasPrior ? delta : 0);
  } catch {
    // Stay "unknown" rather than guessing — better to omit a sample
    // dimension than poison the dataset with mis-classified rows.
    bootKind = "unknown";
  }
  return bootKind;
}

