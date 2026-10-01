/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
import { useEffect } from "react";
import { longSession } from "../perfMonitor";
import { safeRun } from "../safe";

/**
 * Boots Boosthis's long-session sampler for the lifetime of the app.
 *
 * Mount once at the app root. Idempotent — extra mounts don't double up
 * because the underlying `longSession` tracker is a singleton that guards
 * against re-installing its global monkey-patches and re-arming its rAF
 * loop. Gated on `__DEV__` inside the effect, so production pays nothing
 * but the hook itself is always called (Rules of Hooks).
 */
export function useLongSessionDiagnostic(): void {
  useEffect(() => {
    if (!__DEV__) return;
    // Boosthis-owned effect outside any error boundary — fail soft.
    safeRun("longSession:start", () => longSession.start());
  }, []);
}
