/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * controlCensus — what this kit can say about the controls on a screen.
 *
 * The browser kit asks the rendered document what controls it has, the same
 * way `routeInventory.ts` asks the router for its routes. This kit is asked
 * the same question and its honest answer today is **no**, so this module
 * exists to SAY no in the same words on the same wire, rather than leave the
 * project page to infer something from a block that never arrives.
 *
 * WHY THE ANSWER IS NO
 * --------------------
 * React Native has no document to query. What this kit observes is the
 * host's root touch observer (`hooks/useFidSampler.ts`), and what that hands
 * over is a TIMESTAMP — deliberately coordinate-free, because coordinates
 * are how a tap turns into a picture of someone's screen. There is no
 * element, no tree position, no stable identity of any kind attached to it.
 *
 * So this kit can see THAT a control was pressed and cannot see WHICH. It
 * cannot enumerate a screen's controls, and it cannot tell one press from
 * another. Reporting `0 controls` would render that gap as a screen with no
 * controls; reporting nothing at all would be indistinguishable from a kit
 * too old to know the question. It reports `no-identity`, which is neither.
 *
 * WHAT WOULD CHANGE IT
 * --------------------
 * A registry: a control the app wrapped in one of this kit's own components,
 * which could then carry a handle the app's own code defines. Nothing like
 * that ships today, and inventing one is a separate piece of work with a
 * separate consent question — it changes what an app's code has to do, not
 * just what the kit reads.
 */

/** The same closed status vocabulary the browser kit uses. The server holds
 *  a third copy and refuses anything outside it. */
export const CONTROL_CENSUS_STATUS_WORDS = [
  "read",
  "unsupported",
  "unreadable",
  "off",
  "no-identity",
] as const;
export type ControlCensusStatus = (typeof CONTROL_CENSUS_STATUS_WORDS)[number];

export const CONTROL_KIND_WORDS = [
  "press",
  "link",
  "field",
  "choice",
  "other",
] as const;
export type ControlKind = (typeof CONTROL_KIND_WORDS)[number];

export const CONTROL_LEADS_WORDS = ["route", "same-page", "unknown"] as const;
export type ControlLeads = (typeof CONTROL_LEADS_WORDS)[number];

export const CONTROL_CENSUS_BOUND_WORDS = [
  "none",
  "entries",
  "nodes",
  "time",
  "shared-handle",
] as const;
export type ControlCensusBound = (typeof CONTROL_CENSUS_BOUND_WORDS)[number];

export interface ControlCensusEntry {
  handle: string;
  kind: ControlKind;
  used: boolean;
  leads: ControlLeads;
  to?: string;
}

export interface ControlCensusReport {
  status: ControlCensusStatus;
  /** Always an array; empty unless `status` is `read`. */
  entries: ControlCensusEntry[];
  /** Present ONLY on a `read`, so an unmeasured screen has no zero to
   *  misread as a screen with no controls. */
  total?: number;
  bounded?: boolean;
  boundedBy?: ControlCensusBound;
  usedOffCensus?: number;
}

/**
 * The sentence this kit's own surfaces print, worded to match the one the
 * server prints for this runtime so the two cannot drift.
 */
export const CONTROL_CENSUS_NO_IDENTITY_SENTENCE =
  "Controls on this screen: this kit sees that a control was pressed but " +
  "not which one \u2014 its touch observation carries a timestamp and " +
  "nothing else \u2014 so there is no census of this screen. That is a gap " +
  "in what we can see, not a screen with no controls. No press on this " +
  "screen is reported as having done nothing either: without an identity " +
  "there is no control to attribute a dead press to, and this kit reports " +
  "none rather than a number nobody could act on.";

let enabledOverride: boolean | null = null;

/** Switch the block off. Switched off it still travels saying `off`, so a
 *  developer's choice can be told from a kit too old to have the feature. */
export function setControlCensusEnabled(on: boolean): void {
  enabledOverride = on === false ? false : true;
}

export function controlCensusEnabled(): boolean {
  if (enabledOverride !== null) return enabledOverride;
  try {
    const g = globalThis as { BOOSTHIS_CONTROL_CENSUS?: unknown };
    const v = g.BOOSTHIS_CONTROL_CENSUS;
    if (v === false || v === 0) return false;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (s === "0" || s === "false" || s === "off" || s === "no") return false;
    }
  } catch {
    /* a host may seal globalThis */
  }
  return true;
}

/** This runtime's answer, today. */
export function controlCensusReport(): ControlCensusReport {
  if (!controlCensusEnabled()) return { status: "off", entries: [] };
  return { status: "no-identity", entries: [] };
}

/** The block a snapshot carries. */
export function controlCensusForSnapshot(): ControlCensusReport | undefined {
  try {
    return controlCensusReport();
  } catch {
    return undefined;
  }
}

/** One sentence for this kit's own panel and status readout. */
export function controlCensusStatusLine(r: ControlCensusReport): string {
  if (r.status === "off") {
    return (
      "Controls on this screen: switched off in this build, so nothing " +
      "about controls is collected or sent."
    );
  }
  return CONTROL_CENSUS_NO_IDENTITY_SENTENCE;
}

/** The compact caption for the bubble panel's row. */
export function controlCensusPanelText(r: ControlCensusReport): string {
  return r.status === "off" ? "off" : "no control identity here";
}

/** @internal test hook. */
export function _resetControlCensusForTests(): void {
  enabledOverride = null;
}
