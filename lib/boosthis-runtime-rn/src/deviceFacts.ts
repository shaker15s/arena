/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: what this PHONE PLATFORM allows (React Native) ─────────────
 *
 * Boosthis holds a measured record of what a hosting platform really permits.
 * It could not answer for a phone, and a phone is held to MORE rules than any
 * server host: background execution windows, doze and app standby, memory
 * ceilings the OS enforces by killing you, timers that stop without saying
 * so. An assistant writing a React Native app is working against all of that
 * with runtime feedback from nobody.
 *
 * This module is this kit's contribution to that record. It reports FACTS
 * ABOUT THE PLATFORM — never about the app, the device or its owner — so the
 * server can pool them across every install on the same OS band and answer
 * "what is an app allowed to do here?" from what actually happened rather
 * than from what the OS says about itself.
 *
 * THREE RULES DECIDE EVERY LINE HERE.
 *
 * **Only what we WATCHED.** Every fact below is a by-product of work the kit
 * was doing anyway: an upload that was already in flight, a tick that was
 * already scheduled, a warning the OS already sent. Nothing here starts work,
 * arms a timer or allocates memory in order to answer a question. A kit that
 * probed would be changing the host app's behaviour to measure the platform,
 * and the measurement would be of the probe.
 *
 * **A key we omit is not a "no".** Four of the seven device facts are simply
 * not readable from JavaScript — the OS memory ceiling, a processor clock, a
 * background-time countdown and the budget behind it all live below the
 * bridge. Those keys never appear in this block. Reporting our own deafness
 * as a platform finding is the single way this could make the record worse
 * than the empty one it starts from, and the two kits that CAN see them
 * (Swift, Kotlin) report them for the same bands.
 *
 * **Nothing here is about a person.** Three counters and two lifecycle
 * stamps. No screen, no URL, no identifier, no device name, nothing about
 * what the app was doing. The platform band itself is the only thing
 * describing the device, and it is exactly as specific as it must be to file
 * a fact: an OS, a major version, and on Android who made the handset,
 * because several Android vendors ship their own process killers and
 * genuinely change the answer.
 *
 * NEVER BLOCKS THE INTERFACE. Everything here is bookkeeping over numbers on
 * whatever thread already called it. No synchronous native call, no I/O, no
 * loop over anything unbounded. Every entry point is total and can be called
 * from a lifecycle callback without ever throwing into the host.
 */

/* ─── What we can be asked ────────────────────────────────────────────── */

/**
 * The facts this kit reports, and the wire key each travels under.
 *
 * The names match the server's closed list exactly (platformRecord.ts). A
 * name this kit invents is a fact the record silently drops, so the list is
 * short, shared and never spelled locally.
 */
export type RnDeviceFact =
  | "backgroundWorkRuns"
  | "timersRunInBackground"
  | "lowMemoryWarningGiven";

/** The snapshot key the block travels under. Matches the server's
 *  DEVICE_FACTS_KEY; a mismatch here is a block that is silently ignored. */
export const DEVICE_FACTS_KEY = "deviceFacts";

/**
 * A background period shorter than this proves nothing.
 *
 * The same threshold the suspend sensor uses (backgroundSpans.ts): a trip
 * through `inactive` for a notification shade or a permission sheet is the
 * app still working. Judging "did pending work finish while backgrounded?"
 * across 200 ms would answer yes for every app on every platform, which is a
 * measurement of nothing dressed as a platform fact.
 */
export const DEVICE_BACKGROUND_MIN_MS = 10_000;

/**
 * How late a timer may fire and still count as having fired in the
 * background.
 *
 * A tick due one second before the app came back and delivered one second
 * after it did is the OS holding it, not running it. Without this slack the
 * kit would read every delayed tick as proof that timers run, which is the
 * exact wrong answer on the platforms that freeze them.
 */
const TIMER_LATE_SLACK_MS = 1_000;

/* ─── State (numbers and stamps only) ─────────────────────────────────── */

/** Wall clock when the app went to the background, or 0 in the foreground. */
let backgroundSince = 0;
/** Work that was ALREADY in flight at the moment the app backgrounded. */
let pendingAtBackground = new Set<number>();
/** Work in flight right now, by the handle noteWorkPending() returned. */
let inFlight = new Set<number>();
let nextWorkId = 1;
/** A timer tick that was armed BEFORE the app backgrounded and was due while
 *  it was there. 0 when there is no such tick outstanding. */
let armedDueAt = 0;

/** Observations, three-valued: undefined = never observed, and once set it
 *  is what we watched happen. A false is only ever written by watching the
 *  platform fail to do the thing, never by failing to look. */
let backgroundWorkRuns: boolean | undefined;
let timersRunInBackground: boolean | undefined;
let lowMemoryWarningGiven: boolean | undefined;

/* ─── Feeding it, from work the kit already does ──────────────────────── */

/**
 * The app's foreground state changed.
 *
 * Fed from the kit's single AppState listener, so there is no second
 * subscription on the host's lifecycle. This is where both background facts
 * are decided, because the answer is only knowable at the transition: work
 * still pending when the app comes BACK is work the platform did not run.
 */
export function noteDeviceForegroundState(active: boolean, nowMs?: number): void {
  try {
    const now = nowMs ?? Date.now();
    if (!active) {
      // Going out. A repeat (inactive → background is one trip, not two) must
      // not re-snapshot, or work that started while already backgrounded
      // would be judged as if it had been pending at the transition.
      if (backgroundSince === 0) {
        backgroundSince = now;
        pendingAtBackground = new Set(inFlight);
      }
      return;
    }
    if (backgroundSince === 0) return;
    const asleepFor = now - backgroundSince;
    // Long enough to be a real background period? If not, nothing that
    // happened across it says anything about what the platform allows.
    if (asleepFor >= DEVICE_BACKGROUND_MIN_MS) {
      // Work that was in flight when the app left and is STILL in flight now
      // did not run while the app was away. That is a measured false: we
      // watched the platform hold it, we did not merely fail to see it
      // finish.
      for (const id of pendingAtBackground) {
        if (inFlight.has(id)) {
          backgroundWorkRuns = false;
          break;
        }
      }
      // A tick that was due during the whole of that window and never
      // arrived is a timer the platform stopped. The slack keeps a tick due
      // just before the app returned out of the judgement.
      if (
        armedDueAt > 0 &&
        armedDueAt >= backgroundSince &&
        armedDueAt <= now - TIMER_LATE_SLACK_MS
      ) {
        timersRunInBackground = false;
      }
    }
    backgroundSince = 0;
    pendingAtBackground = new Set();
    armedDueAt = 0;
  } catch {
    /* a fact we cannot judge is a fact we do not report */
  }
}

/**
 * Work the kit has just handed to the platform and is waiting on — an upload
 * already on its way, not something started to be measured.
 *
 * Returns a handle to settle it with. Returns 0 if anything went wrong, and
 * settling 0 is a no-op, so a caller never has to branch.
 */
export function noteWorkPending(): number {
  try {
    const id = nextWorkId++;
    inFlight.add(id);
    // Flat memory in a session that runs for days: a caller that leaks a
    // handle must not grow this set without bound. The oldest is dropped,
    // which can only ever LOSE an observation, never invent one.
    if (inFlight.size > 64) {
      const oldest = inFlight.values().next();
      if (!oldest.done) inFlight.delete(oldest.value);
    }
    return id;
  } catch {
    return 0;
  }
}

/**
 * That work finished. If it was already in flight when the app went to the
 * background, and it finished while the app was still there, then this
 * platform ran it — which is the positive half of the same fact.
 */
export function noteWorkSettled(id: number, nowMs?: number): void {
  try {
    if (!id) return;
    inFlight.delete(id);
    if (!pendingAtBackground.has(id)) return;
    pendingAtBackground.delete(id);
    const now = nowMs ?? Date.now();
    if (backgroundSince > 0 && now - backgroundSince >= DEVICE_BACKGROUND_MIN_MS) {
      backgroundWorkRuns = true;
    }
  } catch {
    /* never throw into a completion handler */
  }
}

/**
 * A repeating tick the kit had ALREADY scheduled is due at `dueAt`.
 *
 * Fed from the kit's own upload loop, which arms itself for its own reasons.
 * Only the tick outstanding across a background period matters, so a single
 * stamp is the whole state.
 */
export function noteTimerArmed(dueAt: number, nowMs?: number): void {
  try {
    if (!Number.isFinite(dueAt)) return;
    const now = nowMs ?? Date.now();
    if (dueAt < now) return;
    armedDueAt = dueAt;
  } catch {
    /* ignore */
  }
}

/** That tick fired. Firing while the app is genuinely in the background is
 *  the platform letting an armed timer run — the positive half. */
export function noteTimerFired(nowMs?: number): void {
  try {
    const now = nowMs ?? Date.now();
    if (backgroundSince > 0 && now - backgroundSince >= DEVICE_BACKGROUND_MIN_MS) {
      timersRunInBackground = true;
    }
    armedDueAt = 0;
  } catch {
    /* ignore */
  }
}

/**
 * The OS warned the app about memory pressure.
 *
 * Positive-only by nature, and said so out loud: a session that saw no
 * warning saw nothing. It may have had plenty of memory all day. Writing a
 * false here would record our silence as the platform's.
 */
export function noteLowMemoryWarning(): void {
  lowMemoryWarningGiven = true;
}

/* ─── Which platform this is ──────────────────────────────────────────── */

/** The closed vendor list the server files a fact under. Spelled here only
 *  to keep an arbitrary manufacturer string — which can be anything a
 *  handset maker types — from travelling. Anything not on it is dropped and
 *  the server files the fact under "unknown", which is a different answer
 *  from any named vendor and never merged with one. */
const KNOWN_VENDORS = [
  "google",
  "samsung",
  "xiaomi",
  "huawei",
  "honor",
  "oppo",
  "vivo",
  "oneplus",
  "realme",
  "meizu",
  "asus",
  "sony",
  "nokia",
  "motorola",
];

interface PlatformIdentity {
  os?: string;
  iosMajor?: number;
  androidApi?: number;
  vendor?: string;
}

/** The shape of React Native's Platform this file reads — nothing else. */
interface RnPlatformLike {
  OS?: string;
  Version?: string | number;
  isPad?: boolean;
  constants?: { Manufacturer?: string };
}

/**
 * A Platform handed in by a test, instead of the one `require` finds.
 *
 * Vitest's alias does not reach a `require()` call, so on Node the lookup
 * below correctly finds nothing and every device fact is correctly withheld
 * — which would leave the recognition rules (an iPad is not an iPhone, an
 * unlisted maker does not travel, an unreadable version is omitted rather
 * than defaulted) untested in the one direction that can put a wrong answer
 * in a pooled record. This seam is the kit's usual answer to that; it is
 * never set outside a test, and the real lookup is what runs on a device.
 */
let platformOverride: RnPlatformLike | null = null;

/**
 * What operating system, which version, and (Android) who made it.
 *
 * Raw, never a ready-made band: the server derives the band from these, so
 * four kits cannot spell a platform four ways. Unknown stays unknown — an
 * OS this cannot read is left out entirely rather than defaulted, and a
 * runtime that is not a phone at all returns nothing.
 */
function identityFrom(p: RnPlatformLike | undefined): PlatformIdentity {
  const out: PlatformIdentity = {};
  if (!p || typeof p.OS !== "string") return out;
  if (p.OS === "ios") {
    // iPadOS is filed separately. It is a different platform with
    // different background rules, and merging the two would answer an
    // iPad question with an iPhone observation.
    out.os = p.isPad === true ? "ipados" : "ios";
    const major = Number.parseInt(String(p.Version ?? ""), 10);
    if (Number.isInteger(major) && major > 0) out.iosMajor = major;
    return out;
  }
  if (p.OS === "android") {
    out.os = "android";
    const api = typeof p.Version === "number" ? p.Version : Number.NaN;
    if (Number.isInteger(api) && api > 0) out.androidApi = api;
    const maker = p.constants?.Manufacturer;
    if (typeof maker === "string") {
      const word = maker.trim().toLowerCase();
      if (KNOWN_VENDORS.indexOf(word) !== -1) out.vendor = word;
    }
    return out;
  }
  // Not a phone (RN on web, or something new). Nothing to file it under,
  // and guessing would put a browser's behaviour in a phone's record.
  return out;
}

function platformIdentity(): PlatformIdentity {
  if (platformOverride) return identityFrom(platformOverride);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require("react-native") as { Platform?: RnPlatformLike };
    return identityFrom(rn?.Platform);
  } catch {
    return {};
  }
}

/* ─── What rides the snapshot ─────────────────────────────────────────── */

/**
 * The block the snapshot carries, or null when there is nothing to say.
 *
 * Null on three separate paths, all of them honest silence: this is not a
 * phone; the OS could not be read; or nothing has been observed yet. A block
 * with a platform and no fact is not an observation, and sending one would
 * have the record dating an answer it does not hold.
 */
export function readDeviceFactsBlock(): Record<string, number | string> | null {
  try {
    const id = platformIdentity();
    if (!id.os) return null;
    const out: Record<string, number | string> = {};
    let any = false;
    if (backgroundWorkRuns !== undefined) {
      out.backgroundWorkRuns = backgroundWorkRuns ? 1 : 0;
      any = true;
    }
    if (timersRunInBackground !== undefined) {
      out.timersRunInBackground = timersRunInBackground ? 1 : 0;
      any = true;
    }
    if (lowMemoryWarningGiven !== undefined) {
      out.lowMemoryWarningGiven = lowMemoryWarningGiven ? 1 : 0;
      any = true;
    }
    if (!any) return null;
    out.os = id.os;
    if (id.iosMajor !== undefined) out.iosMajor = id.iosMajor;
    if (id.androidApi !== undefined) out.androidApi = id.androidApi;
    if (id.vendor !== undefined) out.vendor = id.vendor;
    return out;
  } catch {
    return null;
  }
}

/** Wipe every observation. Wired into the same forget()/erase path as the
 *  other sensors, so a customer who clears their data clears this too. */
export function clearDeviceFacts(): void {
  backgroundSince = 0;
  pendingAtBackground = new Set();
  inFlight = new Set();
  nextWorkId = 1;
  armedDueAt = 0;
  backgroundWorkRuns = undefined;
  timersRunInBackground = undefined;
  lowMemoryWarningGiven = undefined;
}

/** @internal test hooks — deterministic state without wall-clock games. */
export const _deviceFactsInternals = {
  DEVICE_BACKGROUND_MIN_MS,
  TIMER_LATE_SLACK_MS,
  reset(): void {
    clearDeviceFacts();
    platformOverride = null;
  },
  /** Drive the recognition rules with a Platform of the test's choosing.
   *  Never set outside a test; on a device the real lookup is what runs. */
  setPlatformForTests(p: RnPlatformLike | null): void {
    platformOverride = p;
  },
  platformIdentity,
  observed(): {
    backgroundWorkRuns: boolean | undefined;
    timersRunInBackground: boolean | undefined;
    lowMemoryWarningGiven: boolean | undefined;
  } {
    return {
      backgroundWorkRuns,
      timersRunInBackground,
      lowMemoryWarningGiven,
    };
  },
  inFlightCount(): number {
    return inFlight.size;
  },
};
