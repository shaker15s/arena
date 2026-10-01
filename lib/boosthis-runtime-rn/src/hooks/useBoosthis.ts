/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/** `useBoosthis(name, meta?)` — drop-in screen perf tracker.
 *
 * Records mount → InteractionManager-idle as TTI, emits one production
 * sample (gated by `recordProdSample`), and on unmount records a
 * `lifetime:<name>` event so the ghost-mount detector can spot wasted
 * mounts. The very first call across the app marks the cold-start
 * `firstScreen` boot phase.
 *
 * Verbatim port of Rival's `usePerfTracker`, renamed for the standalone
 * Boosthis package. The legacy `usePerfTracker` name is exported as a
 * deprecated alias so existing call sites compile unchanged.
 *
 * Also exports `usePhaseTracker` — the richer sub-screen ladder
 * (afterCommit / afterMacrotask / afterRaf / afterIdle100 / afterIdle300
 * / afterIM) used on the most-instrumented screens.
 */

import { useEffect, useRef } from "react";
import { InteractionManager } from "react-native";
import { makeScreenTimer, perfMonitor, type PerfEvent } from "../perfMonitor";
import { recordProdSample } from "../perfProdSampler";
import { getSessionFid } from "./useFidSampler";
import { markBoot } from "../perfBoot";
import { safeRun } from "../safe";
import { recordScreenMountStart, recordScreenUsable } from "../navDeadTime";
import { markScreenMounted, markScreenExit } from "../timerHealth";
import { markFirstRender } from "../jsStartup";
import {
  noteHostScreenReading,
  scoreScreenReading,
} from "../screenAutoReading";

/** Module-level guard so the very first useBoosthis() call across the app
 *  marks the cold-start `firstScreen` phase exactly once. */
let firstScreenMarked = false;

/**
 * Create the screen timer for useBoosthis's first render, failing soft.
 *
 * makeScreenTimer schedules an InteractionManager callback SYNCHRONOUSLY, and
 * useBoosthis runs this during the HOST screen's render — outside any Boosthis
 * error boundary (host screens call useBoosthis directly). An unexpected throw
 * here would crash the host screen and, inside the drop-in dashboard, trip its
 * "screen couldn't load" fallback (which hides the sign-in form). So a throw is
 * swallowed and null is returned; every downstream use of the timer is already
 * optional-chained.
 */
export function makeScreenTimerSafe(
  name: string,
  meta?: PerfEvent["meta"],
): ReturnType<typeof makeScreenTimer> | null {
  try {
    return makeScreenTimer(name, meta);
  } catch {
    return null;
  }
}

export function useBoosthis(name: string, meta?: PerfEvent["meta"]): void {
  const timerRef = useRef<ReturnType<typeof makeScreenTimer> | null>(null);
  const startedAtRef = useRef<number>(Date.now());
  const initRef = useRef(false);
  // First render only (initRef guards re-runs, so a one-time failure never
  // retries on later renders). makeScreenTimerSafe can never throw into the
  // host's render; timerRef is left null on failure and every downstream use of
  // it is already optional-chained.
  if (!initRef.current) {
    initRef.current = true;
    startedAtRef.current = Date.now();
    timerRef.current = makeScreenTimerSafe(name, meta);
    // Additive RN axes, best-effort (each recorder is total-try/catch and can
    // never throw into the host's render):
    //  • Navigation Dead Time — this screen's mount START; correlates with a
    //    recent tap to measure the tap→mount-start dead gap.
    //  • JS Startup — the first screen mount is a render source (fallback for
    //    apps that don't wrap a <BoosthisProfiler>); one-shot latch.
    //  • Screen Timer Leaks — tag this screen as active so timers it creates
    //    are attributed to it.
    recordScreenMountStart(Date.now());
    markFirstRender();
    markScreenMounted(name);
    // This screen is measured BY HAND. The root navigation observer, if one is
    // mounted, stands down for this boundary rather than reporting it twice.
    noteHostScreenReading(name);
  }
  useEffect(() => {
    let handle: ReturnType<
      typeof InteractionManager.runAfterInteractions
    > | null = null;
    // All Boosthis-owned effect work, running outside any React error boundary.
    // A throw here would crash the host screen, so it fails soft.
    safeRun("useBoosthis:mount", () => {
      if (!firstScreenMarked) {
        firstScreenMarked = true;
        markBoot("firstScreen");
      }
      handle = InteractionManager.runAfterInteractions(() => {
        safeRun("useBoosthis:tti", () => {
          // ONE clock read feeds both readings: this screen's own reading and
          // the press→usable join must not disagree about when it was ready.
          const completedAt = Date.now();
          const ttiMs = completedAt - startedAtRef.current;
          const fidMs = getSessionFid();
          const { score, rating } = scoreScreenReading({ ttffMs: null, ttiMs, fidMs });
          recordProdSample({
            screen: name, ttffMs: null, ttiMs, fidMs, score, rating,
            source: "manual",
          });
          // A hand-measured screen answers the press→usable question too: the
          // press this screen's mount joined is closed off HERE, at the same
          // moment the hook calls the screen ready.
          recordScreenUsable(completedAt);
        });
      });
    });
    return () => {
      safeRun("useBoosthis:cleanup", () => {
        handle?.cancel();
        timerRef.current?.cancel();
        const lifetime = Date.now() - startedAtRef.current;
        perfMonitor.recordEvent(`lifetime:${name}`, lifetime);
        // Screen Timer Leaks — this screen has unmounted; 5s later the timer
        // tracker counts how many of ITS JS timers are still outstanding.
        markScreenExit(name);
      });
    };
    // We deliberately depend on `name` only — meta changes shouldn't restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
}

/** @deprecated Renamed to `useBoosthis` in v0.3.0. Same behavior. */
export const usePerfTracker = useBoosthis;

/**
 * Sub-screen phase tracker. Returns a `mark(phase)` function that records
 * the elapsed time since the FIRST render of this hook.
 *
 * Correctness rules: per-phase dedupe, buffer-then-flush on first commit
 * (Strict Mode safe), MIN_LOG_MS=16 floor in perfMonitor.
 */
export function usePhaseTracker(screen: string): (phase: string) => void {
  type Pending = { phase: string; elapsed: number };
  const stateRef = useRef<{
    start: number;
    seen: Set<string>;
    pending: Pending[];
    committed: boolean;
  } | null>(null);
  if (stateRef.current === null) {
    stateRef.current = {
      start: Date.now(),
      seen: new Set(),
      pending: [],
      committed: false,
    };
    // Measured by hand — the root observer stands down for this boundary.
    noteHostScreenReading(screen);
  }
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    s.committed = true;
    // Boosthis-owned effect plus deferred timer/rAF/IM callbacks, all outside any
    // error boundary — each phase is fail-soft so a throw can't crash the host.
    safeRun(`phase:${screen}:commit`, () => {
      for (const { phase, elapsed } of s.pending) {
        perfMonitor.recordEvent(`phase:${screen}:${phase}`, elapsed);
      }
      s.pending = [];
      if (!s.seen.has("afterCommit")) {
        s.seen.add("afterCommit");
        perfMonitor.recordEvent(`phase:${screen}:afterCommit`, Date.now() - s.start);
      }
      const elapsedAt: Record<string, number> = {
        afterCommit: Date.now() - s.start,
      };
      const queue = (phase: string, fn: (cb: () => void) => void): void => {
        fn(() =>
          safeRun(`phase:${screen}:${phase}`, () => {
            if (s.seen.has(phase)) return;
            s.seen.add(phase);
            const ms = Date.now() - s.start;
            elapsedAt[phase] = ms;
            perfMonitor.recordEvent(`phase:${screen}:${phase}`, ms);
          }),
        );
      };
      queue("afterMacrotask", (cb) => { setTimeout(cb, 0); });
      queue("afterRaf", (cb) => { requestAnimationFrame(() => cb()); });
      queue("afterIdle100", (cb) => { setTimeout(cb, 100); });
      queue("afterIdle300", (cb) => { setTimeout(cb, 300); });
      queue("afterIM", (cb) => {
        InteractionManager.runAfterInteractions(() =>
          safeRun(`phase:${screen}:afterIM-sample`, () => {
            cb();
            const ttffMs = (elapsedAt.afterCommit ?? 0) > 0 ? elapsedAt.afterCommit : null;
            const ttiMs = Date.now() - s.start;
            const fidMs = getSessionFid();
            const { score, rating } = scoreScreenReading({
              ttffMs: ttffMs ?? null, ttiMs, fidMs,
            });
            recordProdSample({
              screen, ttffMs: ttffMs ?? null, ttiMs, fidMs, score, rating,
              source: "manual",
            });
          }),
        );
      });
    });
  }, [screen]);

  return (phase: string): void => {
    // Host-called marker — must never throw into the host's render/handlers.
    safeRun(`phase:${screen}:mark`, () => {
      const s = stateRef.current;
      if (!s) return;
      if (s.seen.has(phase)) return;
      s.seen.add(phase);
      const elapsed = Date.now() - s.start;
      if (s.committed) {
        perfMonitor.recordEvent(`phase:${screen}:${phase}`, elapsed);
      } else {
        s.pending.push({ phase, elapsed });
      }
    });
  };
}
