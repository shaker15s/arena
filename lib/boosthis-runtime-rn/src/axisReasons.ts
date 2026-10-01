/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: why a reading cannot be taken (React Native) ────────────
 *
 * The kit sends the CODE; the server owns the words. A kit never sends prose.
 * These numbers belong to the shared closed vocabulary and are permanent:
 * never re-use or renumber them. Only codes this kit actually sends live here.
 */

/** The host app must wire or enable the collector first. */
export const REASON_NOT_WIRED_BY_HOST = 1 as const;
/** The platform does not expose this reading to JavaScript. */
export const REASON_PLATFORM_DOES_NOT_EXPOSE = 3 as const;
/** The collector is compiled out or inert in this build. */
export const REASON_OFF_IN_THIS_BUILD = 5 as const;
/**
 * The app moves between screens by something this kit cannot follow.
 *
 * Distinct from NOT_WIRED_BY_HOST, which names something the developer can
 * switch on: this one says we looked, saw the app being used, and could not
 * attribute the move. Sent only on positive evidence, never from an absent
 * value (docs/press-to-screen-contract.md).
 */
export const REASON_NAVIGATION_NOT_RECOGNISED = 10 as const;