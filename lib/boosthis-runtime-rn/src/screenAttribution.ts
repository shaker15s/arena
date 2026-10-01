/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: which screen was on when a reading was taken ───────────
 *
 * The kit has always known which screen is current — the screen tracker sets
 * it so a timer created now can be blamed on the screen that created it. This
 * module is that one holder, so every OTHER reading taken while a screen is up
 * can name it too: a long task, a rage tap, a frame/heap sample.
 *
 * TWO RULES, both the reason this is a module and not a variable:
 *
 *   1. ATTRIBUTE AT THE MOMENT, NEVER AT READ TIME. A reading names the screen
 *      that was current WHEN IT WAS TAKEN. Reading "the current screen" later,
 *      while rendering a panel or folding a snapshot, names the last screen
 *      seen — which is a guess dressed as a measurement.
 *   2. A READING THAT CANNOT NAME A SCREEN SAYS SO. No stand-in name is ever
 *      minted (see lib/part-name-vocabulary.json — a placeholder becomes a
 *      real-looking part pooling unrelated screens). Such readings are kept
 *      apart, counted, and described with ONE agreed wording.
 *
 * A leaf on purpose: it imports nothing from the kit, so the modules that need
 * it (the timer tracker, the frame sampler, the interaction sampler) can all
 * hold it without closing a require cycle.
 */

/**
 * What every surface says about a reading that has no screen on it. One
 * wording, used everywhere, and deliberately not a NAME: it can never be
 * mistaken for a screen, sorted beside one, or joined to one.
 */
export const NO_SCREEN_WORDING = "no screen was current";

/** The screen currently on display, or null when nothing has said. */
let current: string | null = null;

/**
 * A screen is now on display. Called by the screen tracker — by hand from
 * `useBoosthis`, automatically from the navigation observer. Never throws.
 */
export function setCurrentScreen(screen: string): void {
  try {
    if (typeof screen === "string" && screen.length > 0) current = screen;
  } catch {
    /* best-effort */
  }
}

/**
 * A screen has gone. Only the screen that is actually current can clear it, so
 * a late unmount cannot blank the screen that replaced it. Never throws.
 */
export function clearCurrentScreen(screen: string): void {
  try {
    if (current === screen) current = null;
  } catch {
    /* best-effort */
  }
}

/**
 * The screen to file a reading under, read AT THE MOMENT the reading is taken.
 * null means no screen was current — which is an answer, not a gap.
 */
export function currentScreen(): string | null {
  return current;
}

/** How a reading's screen is worded, including when it has none. */
export function describeScreenAttribution(screen: string | null): string {
  return screen == null || screen.length === 0 ? NO_SCREEN_WORDING : screen;
}

/** @internal test hook. */
export function _resetScreenAttributionForTests(): void {
  current = null;
}
