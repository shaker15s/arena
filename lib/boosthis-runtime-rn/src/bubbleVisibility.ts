/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
import { isBoosthisDisabled } from "./runtimeFlags";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

type BubbleGlobals = {
  BOOSTHIS_BUBBLE?: string | boolean;
  BOOSTHIS_NO_BUBBLE?: string | boolean;
  BOOSTHIS_FORCE_BUBBLE?: string | boolean;
};

function parseDirective(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return undefined;
}

/** Read an env/global value without assuming `process` exists on the device. */
function readRaw(name: keyof BubbleGlobals): unknown {
  try {
    if (typeof process !== "undefined" && process.env) {
      const value = process.env[name];
      if (typeof value === "string" && value.length > 0) return value;
    }
    return (globalThis as unknown as BubbleGlobals)[name];
  } catch {
    return undefined;
  }
}

/** Resolve launcher visibility. Precedence is kill switch, directive, legacy
 * aliases, code option, then the always-visible default. */
export function resolveBubbleVisibility(option?: boolean): boolean {
  try {
    if (isBoosthisDisabled()) return false;
  } catch {
    // The kill switch is an entitlement stop. A failed read must never defeat
    // it, so this one signal alone fails closed.
    return false;
  }

  try {
    const directive = parseDirective(readRaw("BOOSTHIS_BUBBLE"));
    if (directive !== undefined) return directive;

    // Backward compatibility: the old opt-out and force-on controls remain
    // supported, but the documented BOOSTHIS_BUBBLE directive outranks them.
    if (parseDirective(readRaw("BOOSTHIS_NO_BUBBLE")) === true) return false;
    if (parseDirective(readRaw("BOOSTHIS_FORCE_BUBBLE")) === true) return true;

    if (option !== undefined) return option;
    return true;
  } catch {
    // Bubble controls are presentation preferences, not entitlement stops.
    // A malformed/throwing host global must not silently hide a valid install.
    return true;
  }
}