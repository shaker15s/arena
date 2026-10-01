/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/** Global runtime kill-switch.
 *
 * If the environment variable `BOOSTHIS_DISABLED` is set to a truthy value
 * ("1", "true", "yes") at runtime, every Boosthis hot path becomes a no-op:
 *
 *   - `perfMonitor.record*()` drops events on the floor.
 *   - `safeTransmit()` short-circuits and returns a synthetic 204 Response
 *     without ever touching the network.
 *   - `enableTelemetry()` returns a client whose methods all no-op.
 *
 * This is the "I'm running in CI" / "this build must never measure" /
 * "kill it from outside the process" escape hatch. It works without any
 * code change in the consumer app — set the env var and Boosthis goes
 * silent.
 *
 * The check is intentionally simple and re-evaluated on every call so the
 * flag can be toggled at runtime (useful for tests). Cost is negligible —
 * one env-var read per recorded event, dwarfed by the work being measured.
 */

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function readEnv(): string | undefined {
  // Node / RN dev (Metro injects process.env). BOOSTEN_DISABLED is the legacy
  // name, kept as a fallback so apps wired up before the rename keep working.
  if (typeof process !== "undefined" && process.env) {
    // || (not ??) so a set-but-empty new var still falls back to the legacy one.
    const v = process.env.BOOSTHIS_DISABLED || process.env.BOOSTEN_DISABLED;
    if (typeof v === "string" && v.length > 0) return v;
  }
  // Globals — covers cases where a bundler strips process.env or where the
  // host app sets `globalThis.BOOSTHIS_DISABLED = "1"` before importing the
  // runtime (e.g. from a config screen at runtime).
  const g = globalThis as unknown as {
    BOOSTHIS_DISABLED?: string | boolean;
    BOOSTEN_DISABLED?: string | boolean;
  };
  const v = g.BOOSTHIS_DISABLED || g.BOOSTEN_DISABLED;
  if (typeof v === "boolean") return v ? "1" : undefined;
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

/**
 * Returns true if Boosthis should be entirely silent. Cheap; safe to call
 * from any hot path.
 */
export function isBoosthisDisabled(): boolean {
  const v = readEnv();
  if (!v) return false;
  return TRUE_VALUES.has(v.toLowerCase());
}

/**
 * Test helper — set the env var programmatically. Returns a cleanup
 * function that restores the previous value.
 */
export function _setBoosthisDisabledForTests(value: boolean | string | undefined): () => void {
  const g = globalThis as unknown as { BOOSTHIS_DISABLED?: string | boolean };
  const prev = g.BOOSTHIS_DISABLED;
  if (value === undefined) delete g.BOOSTHIS_DISABLED;
  else g.BOOSTHIS_DISABLED = value;
  return () => {
    if (prev === undefined) delete g.BOOSTHIS_DISABLED;
    else g.BOOSTHIS_DISABLED = prev;
  };
}
