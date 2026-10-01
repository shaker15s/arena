/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: useRenderGuard ─────────────────────────────────────────
 *
 * Optional companion to <BoosthisProfiler>. Drop it at the top of a
 * component with that component's props to detect renders where NOTHING
 * actually changed (shallow-equal props) — a provably wasted render, almost
 * always a missing React.memo, an unstable inline callback/object upstream,
 * or a context value that changes identity every render. Wasted renders are
 * counted into the Render Efficiency meter's caption.
 *
 *   function Row(props: RowProps) {
 *     useRenderGuard(props, "Row");
 *     ...
 *   }
 *
 * Returns true on a wasted render so callers can debug-log if they want.
 * Gated on `__DEV__`: in release builds the effect returns before the ref is
 * ever populated, so `prev.current` stays null, the shallow compare never runs,
 * and nothing is recorded — production pays nothing. This matches the rest of
 * the render layer, which is inert in release (React's Profiler onRender is a
 * no-op there), and keeps the Render Efficiency meter strictly dev-only.
 */
import { useEffect, useRef } from "react";
import { renderProfiler } from "../renderProfiler";
import { safeRun } from "../safe";

function shallowEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.is(a[k], b[k])) return false;
  }
  return true;
}

export function useRenderGuard(
  props: Record<string, unknown>,
  id: string = "component",
): boolean {
  const prev = useRef<Record<string, unknown> | null>(null);
  const wasted = prev.current !== null && shallowEqual(prev.current, props);
  useEffect(() => {
    if (!__DEV__) return;
    // Boosthis-owned effect outside any error boundary — fail soft, but always
    // advance the ref so the next render's compare stays correct.
    if (wasted) safeRun("renderGuard:record", () => renderProfiler.recordWasted(id));
    prev.current = props;
  });
  return wasted;
}
