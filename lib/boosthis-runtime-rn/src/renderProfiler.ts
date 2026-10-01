/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: render profiler (DEV-DASHBOARD ONLY) ───────────────────
 *
 * Records React commit timings reported by <BoosthisProfiler> (a thin
 * wrapper around React's <Profiler onRender>). It powers two ADDITIVE,
 * on-device-only signals:
 *
 *   1. the Render Efficiency meter axis (computeRenderEfficiency in
 *      meterAxes.ts) — how busy React's commit phase is, and
 *   2. the "render-storm" novel detector (perfNovelDetectors.ts) — bursts
 *      of autonomous re-renders with no user interaction between them.
 *
 * CRITICAL: React's <Profiler onRender> is a NO-OP in release builds, so
 * this store stays empty in production. Render data therefore NEVER leaves
 * the device — it is intentionally NOT part of computeMeterAxes (the
 * uploaded payload) and is shown only in the in-app dev dashboard. Mounts
 * are expected work; the meter scores the RATE of update commits, which is
 * the signal a developer can actually act on (memoize, move animations off
 * the JS thread, break state→effect→state loops).
 */

import { isRuntimeInert } from "./killSwitch";

export type RenderPhase = "mount" | "update" | "nested-update";

export interface RenderCommit {
  /** Profiler id — by convention the screen/component name. */
  id:       string;
  phase:    RenderPhase;
  /** actualDuration from onRender (ms React spent rendering this commit). */
  actualMs: number;
  ts:       number;
}

export interface RenderStats {
  /** Commits inside the rolling window. */
  sampleCount:   number;
  /** "update" + "nested-update" commits (re-renders) in the window. */
  updateCount:   number;
  /** "mount" commits in the window. */
  mountCount:    number;
  /** Wasted re-renders flagged by useRenderGuard in the window. */
  wastedCount:   number;
  /** Re-renders normalized to a per-minute rate over the window. */
  updatesPerMin: number;
  /** p95 of actualDuration across commits in the window (ms), or 0. */
  p95ActualMs:   number;
  /** id with the most update commits in the window, or null. */
  worstId:       string | null;
  windowMs:      number;
  /** Positive evidence that React's profiler is compiled out in this build:
   *  a profiled subtree rendered and no commit was ever reported. Lets a
   *  reader tell a release build's permanent silence from a kit that simply
   *  started a moment ago. */
  offInThisBuild: boolean;
}

const BUFFER_CAP = 1000;
const DEFAULT_WINDOW_MS = 60_000;

class RenderProfiler {
  private commits: RenderCommit[] = [];
  private wasted:  { id: string; ts: number }[] = [];
  /** True once a <BoosthisProfiler> subtree has actually rendered. */
  private profilerMounted = false;
  /** True once ANY commit has ever been reported — proves onRender is live. */
  private everObserved = false;

  /**
   * Record that a <BoosthisProfiler> subtree rendered. Best-effort, NEVER
   * throws.
   *
   * This is what turns the empty store into EVIDENCE rather than a guess. An
   * empty store on its own is also true of a kit that started a moment ago, a
   * host that wrapped nothing, and the state right after `forget()` — none of
   * which say anything about the build. A profiled subtree that rendered, and
   * STILL no commit reported, is the one combination only an inert Profiler
   * produces, which is what a release build always is.
   */
  noteProfilerMounted() {
    this.profilerMounted = true;
  }

  /**
   * Positive evidence that React's profiler is compiled out here: something
   * was profiled and nothing was ever reported. Read by
   * computeRenderEfficiency so a release build declares the gap instead of
   * presenting an empty store as a clean result.
   */
  isOffInThisBuild(): boolean {
    return this.profilerMounted && !this.everObserved;
  }

  /** Whether any commit has ever been reported. Distinguishes a profiler that
   *  is live but quiet from one that will never speak. */
  hasEverObserved(): boolean {
    return this.everObserved;
  }

  /** Called by <BoosthisProfiler>'s onRender. No-op when the kit is inert
   *  (env kill-switch OR a non-active server entitlement); naturally inert in
   *  release builds (onRender doesn't fire there). `ts` is injectable for
   *  deterministic tests. */
  recordCommit(id: string, phase: RenderPhase, actualMs: number, ts: number = Date.now()) {
    if (isRuntimeInert()) return;
    this.everObserved = true;
    this.commits.push({ id, phase, actualMs, ts });
    if (this.commits.length > BUFFER_CAP) {
      this.commits.splice(0, this.commits.length - BUFFER_CAP);
    }
  }

  /** Called by useRenderGuard when a component re-rendered with shallow-equal
   *  props (a provably wasted render). Informational — surfaced in the axis
   *  caption; does not by itself change the score. */
  recordWasted(id: string, ts: number = Date.now()) {
    if (isRuntimeInert()) return;
    this.wasted.push({ id, ts });
    if (this.wasted.length > BUFFER_CAP) {
      this.wasted.splice(0, this.wasted.length - BUFFER_CAP);
    }
  }

  /** Windowed copy of the raw commit log for the render-storm detector. */
  getCommits(windowMs: number = DEFAULT_WINDOW_MS, now: number = Date.now()): RenderCommit[] {
    const cutoff = now - windowMs;
    return this.commits.filter((c) => c.ts >= cutoff);
  }

  /** Snapshot the rolling window. Pure read — does not mutate the buffer. */
  getStats(windowMs: number = DEFAULT_WINDOW_MS, now: number = Date.now()): RenderStats {
    const cutoff = now - windowMs;
    const inWin = this.commits.filter((c) => c.ts >= cutoff);
    const updates = inWin.filter((c) => c.phase === "update" || c.phase === "nested-update");
    const mounts  = inWin.filter((c) => c.phase === "mount");
    const wastedCount = this.wasted.filter((w) => w.ts >= cutoff).length;

    // Per-minute rate over the FULL window (not the observed span) so a few
    // commits early in a session read as a low, calm rate instead of a
    // spurious spike. Conservative: under-reports bursts, never over-reports —
    // true bursts are caught separately by the render-storm detector.
    const updatesPerMin =
      updates.length === 0 ? 0 : Math.round((updates.length * 60_000) / windowMs);

    // Worst offender by update-commit count, for the caption.
    let worstId: string | null = null;
    if (updates.length > 0) {
      const byId = new Map<string, number>();
      for (const c of updates) byId.set(c.id, (byId.get(c.id) ?? 0) + 1);
      worstId = [...byId.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }

    const durs = inWin.map((c) => c.actualMs).sort((a, b) => a - b);
    const p95ActualMs =
      durs.length === 0
        ? 0
        : Math.round(durs[Math.min(durs.length - 1, Math.floor((durs.length - 1) * 0.95))]);

    return {
      sampleCount: inWin.length,
      updateCount: updates.length,
      mountCount:  mounts.length,
      wastedCount,
      updatesPerMin,
      p95ActualMs,
      worstId,
      windowMs,
      offInThisBuild: this.isOffInThisBuild(),
    };
  }

  clear() {
    this.commits = [];
    this.wasted  = [];
    // A cleared profiler has looked at nothing. Keeping either latch would let
    // a fresh install inherit the last one's verdict about a different build.
    this.profilerMounted = false;
    this.everObserved    = false;
  }
}

export const renderProfiler = new RenderProfiler();
