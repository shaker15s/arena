/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* What this React Native kit has positively reached.
 *
 * This is only a reader over existing counters. It installs no observer and
 * starts no work. React Native cannot honestly detect an unwrapped screen or
 * an unsupported outbound client, so silence remains "not looked at", never a
 * gap or a clean bill of health.
 */

import { readDeviceFactsBlock } from "./deviceFacts";
import { getInteractionStats, getSessionFid } from "./hooks/useFidSampler";
import { getNetworkStats } from "./networkSampler";
import { frameSampler, perfMonitor } from "./perfMonitor";
import { isBoosthisDisabled } from "./runtimeFlags";
import { _spanInternals } from "./spanEmitter";
import type {
  CoverageInventory,
  SurfaceGap,
  WatchableSurface,
} from "./watchableSurfaces";

export type { CoverageInventory, SurfaceGap } from "./watchableSurfaces";

function safeNumber(read: () => number): number {
  try {
    const value = read();
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

function safeFlag(read: () => boolean): boolean {
  try {
    return read() === true;
  } catch {
    return false;
  }
}

export function coverageInventory(): CoverageInventory {
  if (safeFlag(isBoosthisDisabled)) return { watched: [], unwatched: [] };

  const watched: WatchableSurface[] = [];

  // A completed screen timing is a real interaction boundary reached through
  // useBoosthis/usePerfTracker. Merely rendering the hook is not enough.
  if (safeNumber(() => perfMonitor.observedEventCount("screen")) > 0) {
    watched.push("request-handling");
  }

  // Both sources only move after a real app call: the public network sampler
  // is the manual transport mark, and traceFetch's root table is its existing
  // bookkeeping for calls that passed through that wrapper.
  if (
    safeNumber(() => getNetworkStats().attemptCount) > 0 ||
    safeNumber(() => _spanInternals.traceRootCount()) > 0
  ) {
    watched.push("outbound-calls");
  }

  // This client kit has no positive detector for an unwired screen, an
  // unsupported network client, or any of the server-only surfaces.
  return { watched: watched.sort(), unwatched: [] };
}

export function sortGaps(gaps: SurfaceGap[]): SurfaceGap[] {
  return gaps
    .slice()
    .sort((a, b) =>
      a.surface === b.surface
        ? a.reason.localeCompare(b.reason)
        : a.surface.localeCompare(b.surface),
    );
}

/**
 * What we last told the server, as one comparable string.
 *
 * COLLECTORS ARE PART OF IT. They are sent on the same consent body, so a
 * fingerprint that ignored them would leave a kit that attached its screen
 * collector late — the exact recovery this feature exists to observe — with
 * an unchanged fingerprint and no re-send, and the stored record would keep
 * saying "attached nothing" for the rest of the session. Passed in rather
 * than read here so this stays pure and the caller decides the moment.
 */
export function coverageFingerprint(
  inv: CoverageInventory,
  collectors?: readonly string[],
): string {
  return [
    inv.watched.join(","),
    sortGaps(inv.unwatched)
      .map((gap) => `${gap.surface}:${gap.reason}:${gap.detected}`)
      .join(","),
    collectors === undefined ? "" : collectors.slice().sort().join(","),
  ].join("|");
}

/* ── WHICH OF THIS KIT'S COLLECTORS ACTUALLY RAN THIS SESSION ────────────
 *
 * THE GAP THIS CLOSES. Every Android session from this kit arrived carrying
 * `totalEvents: 0`, an empty row list and an empty screen list, while iOS
 * sessions on the identical kit version carried 47 to 152 events. Nothing
 * said so. A kit that attached none of its collectors and an app nobody
 * touched send the byte-identical empty snapshot, so the project's dashboard
 * showed "no readings yet" in both cases and there was no way to tell them
 * apart from this side.
 *
 * `coverageInventory()` above was the nearest thing to an answer, but it
 * reports SURFACES THAT PRODUCED DATA, and it is omitted entirely when it
 * knows nothing — on both ends: the kit did not send an empty inventory, and
 * the server dropped one. That omission is right for what it describes (an
 * empty surface list genuinely means "we did not look"), and it is exactly
 * why it cannot answer this question: the one session we most need to hear
 * about is the one that sends nothing.
 *
 * SO THIS IS A DIFFERENT FACT, AND IT IS ALWAYS SENT. Attachment, not output.
 * A collector that attached and saw nothing is a quiet app; a collector that
 * never attached is our bug. An EMPTY list here is not silence — it is the
 * kit saying, positively, that it reached none of its collectors, which is a
 * finding. Absent (an older kit) still means "never told us", and the three
 * states stay distinguishable all the way to the stored column.
 *
 * POSITIVE EVIDENCE ONLY. Every entry below is added because something was
 * observed to have run. Nothing here is inferred from a count being zero,
 * and a collector we have no way to check for is simply not listed rather
 * than assumed either way.
 *
 * TWO GRADES OF EVIDENCE, AND THE DIFFERENCE MATTERS WHEN THE LIST IS EMPTY.
 * `frames` is true ATTACHMENT: the sampler either is running or is not, and
 * it starts on its own without waiting for the app to do anything. The other
 * four are OUTPUT: they can only be seen once the app has produced work, so
 * their absence is consistent with an app nobody touched.
 *
 * This is why an empty list is readable but must not be over-read. It means
 * the frame sampler is not running AND nothing else produced anything — and
 * because the sampler needs no help from the app, a genuinely idle app still
 * reports it. So `[]` is strong evidence the kit failed to start, and it is
 * NOT proof; the wording on every surface that renders it says so.
 */

/**
 * The closed vocabulary. Kept deliberately small: one entry per collector
 * this kit can produce POSITIVE evidence for. The server holds the same list
 * and drops anything not on it, because these words are rendered on a page
 * and echoed to an AI.
 */
export const RN_COLLECTORS = [
  "device-facts",
  "frames",
  "interactions",
  "network",
  "screens",
] as const;

export type RnCollector = (typeof RN_COLLECTORS)[number];

function safe<T>(read: () => T, fallback: T): T {
  try {
    const v = read();
    return v === undefined || v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

/**
 * The collectors positively reached this session, sorted.
 *
 * A pure read over counters that already exist: it installs no observer,
 * starts no work, and can never disturb the host.
 */
export function collectorsReached(): RnCollector[] {
  if (safe(() => isBoosthisDisabled() === true, false)) return [];

  const reached: RnCollector[] = [];

  // ATTACHMENT, not output: the rAF sampler is either running or it is not,
  // and that is knowable without a single frame having been judged. This is
  // the entry that separates "the kit is wired in" from "the kit measured
  // something", and on the sessions that prompted this file it was the only
  // collector that was true.
  if (safe(() => frameSampler.isRunning() === true, false)) {
    reached.push("frames");
  }

  // A completed screen timing is a real interaction boundary reached through
  // useBoosthis / usePerfTracker. Merely rendering the hook is not enough,
  // and there is no honest way to detect a screen that was never wrapped.
  if (safe(() => perfMonitor.observedEventCount("screen"), 0) > 0) {
    reached.push("screens");
  }

  // A touch reached the sampler. Either signal is positive evidence: the
  // rolling window holds one, or the session's first input delay was set.
  if (
    safe(() => getInteractionStats().count, 0) > 0 ||
    safe(() => getSessionFid(), null) !== null
  ) {
    reached.push("interactions");
  }

  // Both sources only move after a real app call: the public network sampler
  // is the manual transport mark, and traceFetch's root table is its existing
  // bookkeeping for calls that passed through that wrapper.
  if (
    safe(() => getNetworkStats().attemptCount, 0) > 0 ||
    safe(() => _spanInternals.traceRootCount(), 0) > 0
  ) {
    reached.push("network");
  }

  // The device-facts block is only non-null once something was actually
  // observed about the device — it is never a stub.
  if (safe(() => readDeviceFactsBlock(), null) !== null) {
    reached.push("device-facts");
  }

  return reached.sort();
}

/**
 * Exact optional consent fragment.
 *
 * The surface lists keep their old rule: empty knowledge is omitted, not sent
 * as an authoritative-looking pair of empty lists, because an empty surface
 * list genuinely means "we did not look".
 *
 * `collectors` does NOT follow that rule and is always sent. It is a
 * different fact — which of this kit's collectors positively ran — and an
 * empty one is the answer, not the absence of one. See collectorsReached.ts:
 * omitting it is precisely how a kit that attached nothing came to look
 * exactly like an app nobody used.
 */
export function coveragePayload(
  inv: CoverageInventory,
): { coverage?: CoverageInventory & { collectors: RnCollector[] } } {
  const collectors = collectorsReached();
  return { coverage: { ...inv, collectors } };
}