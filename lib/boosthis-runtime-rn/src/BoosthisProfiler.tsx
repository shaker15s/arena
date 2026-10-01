/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: <BoosthisProfiler> ─────────────────────────────────────
 *
 * Thin wrapper around React's <Profiler> that streams each commit into the
 * render profiler so the Render Efficiency meter + the render-storm detector
 * have data. Wrap a screen (or any subtree) and pass a stable `id`:
 *
 *   <BoosthisProfiler id="Feed">
 *     <FeedScreen />
 *   </BoosthisProfiler>
 *
 * React's onRender callback is a NO-OP in release builds, so this records
 * nothing in production — the meter is a DEV-DASHBOARD aid by design, and no
 * render data ever leaves the device.
 */
import React, { Profiler, type ReactNode } from "react";
import { renderProfiler, type RenderPhase } from "./renderProfiler";
import {
  recordCommit as recordReRenderCommit,
  noteProfilerMounted,
} from "./reRenders";
import { markFirstRender } from "./jsStartup";

export interface BoosthisProfilerProps {
  /** Stable label for this subtree — by convention the screen name. */
  id:       string;
  children: ReactNode;
}

export function BoosthisProfiler({ id, children }: BoosthisProfilerProps) {
  // A profiled subtree is rendering. In a dev build React commits it and
  // onRender fires below; in a release build it never will. Recording the
  // render (not the commit) is what lets the Re-render Storms axis tell those
  // two apart later, instead of calling every quiet kit a release build.
  try {
    noteProfilerMounted();
    // Same evidence, kept on the render store too: it is what lets the Render
    // Efficiency axis declare a release build's silence rather than present
    // an empty store as a clean result.
    renderProfiler.noteProfilerMounted();
  } catch {
    /* perf bookkeeping must never affect the host's render */
  }
  return (
    <Profiler
      id={id}
      onRender={(_id, phase, actualDuration) => {
        // onRender fires during React's commit phase, OUTSIDE any error
        // boundary, so a throw here could crash the host. Boosthis's recording
        // must never do that. We deliberately do NOT wrap `children` in a
        // boundary — that would swallow the HOST's own errors and change its
        // behavior; we only guard Boosthis's own callback.
        try {
          renderProfiler.recordCommit(id, phase as RenderPhase, actualDuration);
          // Re-render Storms axis: attribute this commit to the open tap window
          // (commits within ~500ms of a tap). Proves the Profiler is live, so
          // the axis leaves its release-build "not measurable" state.
          recordReRenderCommit(Date.now());
          // JS Startup axis: the first commit the kit ever sees is the first
          // React render — latch the one-shot startup cost. Idempotent.
          markFirstRender();
        } catch {
          /* perf bookkeeping must never crash the host app */
        }
      }}
    >
      {children}
    </Profiler>
  );
}
