/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: Memory Warnings axis source (React Native) ───────────────
 *
 * An RN-exclusive, ADDITIVE, display-only meter that counts OS memory-pressure
 * warnings (the AppState "memoryWarning" event — iOS, plus some Android OEMs)
 * during the observed foreground session. A well-behaved app gets ZERO; a
 * rising count means the app is riding the OOM line and the OS is asking it to free
 * memory before it force-kills the process. This is a DEVICE signal the server
 * runtimes (Node/Python/Go/Java) fundamentally cannot see — exactly the kind
 * of on-device UX vital the React Native kit owns.
 *
 * Scored as a count in the stated foreground window, once the minimum observed
 * window has elapsed. It is never projected to an hourly rate.
 *
 * HONESTY / INVARIANTS (see docs/perf-meters.md):
 *   • NEVER feeds the composite Speed score (TTFF/TTI/FID). Display-only.
 *   • OMIT WHILE WARMING: readMemoryWarnings() returns a pending reading until
 *     tracking is installed AND (a warning has fired OR ≥ MIN foreground time
 *     has accrued) — never a fabricated 0/100.
 *   • NOT LISTENING ⇒ PENDING: if the listener never attached we report
 *     pending, never a false "healthy" 100 — a wiring failure must not read as
 *     a perfect memory score.
 *   • NUMERIC-ONLY on the wire:
 *     { present, measurable, count, windowMin, score, rating }.
 *   • NEVER GRADED: the count is published with rating "not-scored" and no
 *     score. The OS decides when to warn, largely on how much memory the
 *     DEVICE has — see docs/decisions/meter-verdicts-that-are-not-about-the-app.md.
 *
 * GUEST-SAFETY (guest code must NEVER break the host app):
 *   • The AppState listener is attached best-effort via a lazy require of
 *     react-native. If AppState / addEventListener is missing or throws,
 *     tracking stays OFF and the axis simply reads pending — the host is never
 *     touched.
 *   • The event handler is wrapped in safeHandler so a throw can never reach
 *     the host's event dispatch.
 *   • uninstallMemoryWarningTracking() removes the subscription and is wired
 *     into telemetry.forget() so nothing Boosthis-shaped keeps listening after
 *     erasure. Idempotent, never throws.
 *   • NO new poller/thread: the count is event-driven; readMemoryWarnings()
 *     just reads the running total against the shared foreground clock.
 */

import { type AxisRating } from "./axisScoring";
import { MIN_RATE_WINDOW_MS, windowMinOf } from "./rateHonesty";
import { safeHandler } from "./safe";
import { noteLowMemoryWarning } from "./deviceFacts";
import { REASON_PLATFORM_DOES_NOT_EXPOSE } from "./axisReasons";

/* NO BANDS. The count is published, never graded — see readMemoryWarnings and
 * docs/decisions/meter-verdicts-that-are-not-about-the-app.md. The old
 * { good: 0, poor: 5 } bands were deleted rather than left unused so the next
 * reader cannot re-wire them. */

/** Stated minimum foreground observation before the session count is stated. */
const MEMWARN_MIN_ACTIVE_MS = MIN_RATE_WINDOW_MS;

export interface MemoryWarningsResult {
  /** ALWAYS null: this reading is never graded. */
  score:     number | null;
  rating:    AxisRating;
  /** OS memory-pressure warnings observed this session. */
  count:     number;
  windowMin: number;
  present: 1;
  measurable?: 0 | 1;
  reasonCode?: number;
}

/** Minimal shape of the bits of react-native we touch (lazy-required). */
interface AppStateLike {
  addEventListener?: (
    type: string,
    handler: (...args: unknown[]) => void,
  ) => { remove?: () => void } | void;
  removeEventListener?: (
    type: string,
    handler: (...args: unknown[]) => void,
  ) => void;
}
interface RNLike {
  AppState?: AppStateLike;
}

let installed = false;
/**
 * POSITIVE evidence that this host cannot take the reading: an install was
 * attempted and AppState was not there to listen to.
 *
 * `installed === false` is NOT that evidence, and reading it as such was the
 * first version of this fix. It is also true of a kit that has not started
 * yet and of one that has been torn down by forget() — neither of which is a
 * statement about the platform. Only an attempt that LOOKED and found nothing
 * earns the permanent word; everything else stays "pending", which promises
 * nothing it cannot keep.
 */
let hostSurfaceAbsent = false;
/** Cumulative memory-warning events observed this session. Never negative. */
let count = 0;
/** Modern-RN subscription handle (has .remove()); null on older RN / not set. */
let subscription: { remove?: () => void } | null = null;
/** Captured handler so an older RN's removeEventListener can detach it. */
let handlerRef: ((...args: unknown[]) => void) | null = null;

/**
 * Attach the AppState "memoryWarning" listener. Idempotent, best-effort, NEVER
 * throws. On any failure (not an RN runtime, AppState missing, wiring throws)
 * tracking stays OFF and the axis reads pending. Call once from telemetry start.
 */
export function installMemoryWarningTracking(): void {
  if (installed) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require("react-native") as RNLike;
    const appState = rn?.AppState;
    if (!appState || typeof appState.addEventListener !== "function") {
      // We looked, and the platform has no AppState to warn us. That is the
      // reading's answer, not a wait — record it so readMemoryWarnings can say
      // "not available here" instead of promising a score.
      hostSurfaceAbsent = true;
      return;
    }
    const handler = safeHandler("memory-warning-listener", () => {
      count += 1;
      // The same event, read as a fact about the PLATFORM rather than about
      // this app: an OS that warns before killing gives an app a chance to
      // release memory, and an assistant writing for this platform needs to
      // know whether that chance exists. Positive-only — see deviceFacts.ts.
      noteLowMemoryWarning();
    });
    handlerRef = handler;
    const sub = appState.addEventListener("memoryWarning", handler);
    // Modern RN (≥0.65) returns a subscription with .remove(); older RN returns
    // void and detaches via removeEventListener (handled in uninstall).
    subscription =
      sub && typeof (sub as { remove?: unknown }).remove === "function"
        ? (sub as { remove?: () => void })
        : null;
    installed = true;
  } catch {
    // Not an RN runtime, or AppState wiring failed — stay OFF (reads pending).
    installed = false;
    subscription = null;
    handlerRef = null;
  }
}

/**
 * The Memory Warnings axis, or null while not installed / warming.
 * Pure read — never mutates state, NEVER throws. Numbers-only wire shape.
 */
export function readMemoryWarnings(activeMs: number): MemoryWarningsResult | null {
  try {
    const ms = typeof activeMs === "number" && activeMs > 0 ? activeMs : 0;
    // Never round up to a minute we did not watch.
    const windowMin = windowMinOf(ms);
    const warnings = Math.max(0, Math.round(count));
    // We looked for AppState and it was not there: no warning can ever reach
    // this app, so no score is coming HERE. Said with a reason code rather
    // than as "measuring…", which would promise a verdict that cannot arrive.
    if (!installed && hostSurfaceAbsent) {
      return {
        score: null,
        rating: "not-available",
        count: warnings,
        windowMin,
        present: 1,
        measurable: 0,
        reasonCode: REASON_PLATFORM_DOES_NOT_EXPOSE,
      };
    }
    // Not listening, and we never got as far as looking (kit not started, or
    // torn down). We have no signal; never claim "healthy", and never claim
    // the platform is at fault either.
    if (!installed) {
      return null;
    }
    if (ms < MEMWARN_MIN_ACTIVE_MS) return null;
    // NEVER GRADED. The operating system decides when to send a memory
    // warning, and it decides largely on how much memory the DEVICE has and
    // what else is running on it: the same build earns warnings on a 2 GB
    // phone and none on a flagship. The app's own footprint is already graded
    // by peakRss / residentGrowth / heapHeadroom / memoryStability. See
    // docs/decisions/meter-verdicts-that-are-not-about-the-app.md.
    return {
      score: null,
      rating: "not-scored",
      count: warnings,
      windowMin,
      present: 1,
      measurable: 1,
    };
  } catch {
    return null;
  }
}

/**
 * Remove the AppState listener and drop all tracking state. Idempotent, NEVER
 * throws. Wired into telemetry.forget() so nothing Boosthis-shaped keeps
 * listening after erasure.
 */
export function uninstallMemoryWarningTracking(): void {
  try {
    if (subscription && typeof subscription.remove === "function") {
      subscription.remove();
    } else if (handlerRef) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const rn = require("react-native") as RNLike;
      rn?.AppState?.removeEventListener?.("memoryWarning", handlerRef);
    }
  } catch {
    /* best-effort — never throw on teardown */
  }
  subscription = null;
  handlerRef = null;
  installed = false;
  // Erasure leaves NO claim behind, including the claim that this platform
  // cannot be read. The next install looks again and decides again.
  hostSurfaceAbsent = false;
  count = 0;
}

/** @internal test hooks — deterministic, no dependence on a real AppState. */
export const _memWarnInternals = {
  MEMWARN_MIN_ACTIVE_MS,
  get isInstalled(): boolean {
    return installed;
  },
  get count(): number {
    return count;
  },
  /** Force the installed flag on/off without wiring a real AppState. */
  setInstalledForTests(v: boolean): void {
    installed = v;
  },
  /** Force the "we looked and AppState was not there" evidence, which is what
   *  the permanent word rests on — never the bare installed flag. */
  setSurfaceAbsentForTests(v: boolean): void {
    hostSurfaceAbsent = v;
  },
  /** Simulate n OS memory-warning events. */
  fireForTests(n = 1): void {
    count += Math.max(0, Math.round(n));
  },
  reset(): void {
    uninstallMemoryWarningTracking();
  },
};
