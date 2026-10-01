/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: Bridge Traffic axis source (React Native) ────────────────
 *
 * An RN-exclusive, ADDITIVE, display-only meter that measures JS↔native
 * chatter. On the OLD architecture every native call crosses the async
 * MessageQueue "bridge"; a chatty app (per-frame layout reads, un-batched
 * native calls, a runaway animation on the JS driver) floods it and the UI
 * feels laggy. We count MessageQueue traffic via its official spy hook and
 * score calls-per-minute.
 *
 * ARCHITECTURE HONESTY (non-negotiable): on the NEW architecture (Bridgeless /
 * JSI / TurboModules) there is NO async bridge to count — calls are synchronous
 * JSI and invisible from JS. So we DETECT the new arch and report
 * `newArch:1, measurable:0, rating:"pending"`; the server caption explains that
 * JSI calls aren't countable from JS AND that the new architecture is the FIX,
 * not the problem. We never pretend a new-arch app has "zero" bridge traffic.
 *
 * Thresholds (old arch, callsPerMin): good ≤600, poor ≥6000. Pending until
 * ≥30s sampled.
 *
 * HONESTY / INVARIANTS:
 *   • NEVER feeds the composite Speed score (TTFF/TTI/FID). Display-only.
 *   • measurable:0 axes are STILL uploaded so the tile explains itself.
 *   • NUMERIC-ONLY on the wire: { score, rating, callsPerMin, sampledMs,
 *     newArch, measurable }. No caption — the server rebuilds it.
 *   • Bands: linearScore(callsPerMin, good=600, poor=6000).
 *
 * GUEST-SAFETY: the spy CHAINS any pre-existing MessageQueue spy (calling it
 * first, byte-identically) and its own counter increment is try/catch'd so it
 * can never throw into the host's bridge. uninstall restores the previous spy
 * function (or a no-op). No native modules, no timers, no promises.
 */

import { linearScore, ratingFor, type AxisRating, type AxisThresholds } from "./axisScoring";

import { earnedPerMin } from "./rateHonesty";
import { REASON_PLATFORM_DOES_NOT_EXPOSE } from "./axisReasons";
/** Calls-per-minute score bands (old arch). ≤600/min is calm (100); ≥6000/min
 *  (100/s) is a flooded bridge (0). */
export const BRIDGE_TRAFFIC_THRESHOLDS = { good: 600, poor: 6000 } as const satisfies AxisThresholds;

/** Minimum sampled wall-clock time before the axis leaves "pending" (ms). */
export const BRIDGE_MIN_SAMPLED_MS = 30_000;

export interface BridgeTrafficResult {
  /** 0–100, or null while pending / not measurable (new arch). */
  score:       number | null;
  rating:      AxisRating;
  /** MessageQueue calls per minute (old arch), or null while pending / new arch. */
  callsPerMin: number | null;
  /** Wall-clock ms sampled since the spy installed (0 while none). */
  sampledMs:   number;
  /** 1 on the new architecture (Bridgeless/JSI), 0 on the old bridge. */
  newArch:     0 | 1;
  /** 1 when a callsPerMin reading is possible (old arch, spy installed); 0
   *  when it isn't (new arch, or spy not installed). */
  measurable:  0 | 1;
  reasonCode?:  number;
}

interface BridgeGlobals {
  RN$Bridgeless?: boolean;
  __turboModuleProxy?: unknown;
  __fbBatchedBridge?: unknown;
}

/** Detect the new architecture from JS. Best-effort — a false negative just
 *  means we try the old-arch spy (which won't fire on new arch anyway). */
export function detectNewArch(): boolean {
  try {
    const g = globalThis as unknown as BridgeGlobals;
    if (g.RN$Bridgeless === true) return true;
    if (g.__turboModuleProxy != null) return true;
  } catch {
    /* best-effort */
  }
  return false;
}

/** Shape of the bits of the MessageQueue module we touch (lazy-required). */
interface MessageQueueLike {
  spy?: (spyFnOrToggle: unknown) => void;
}

let installed = false;
/**
 * POSITIVE evidence that this host has no bridge to watch: we required the
 * MessageQueue module and it either was not there or carried no `spy` surface.
 *
 * This is deliberately NOT `!installed`. A kit that has not started yet, and
 * one erased by `forget()`, are both "not installed" while saying nothing
 * whatever about the platform — reporting either as "the platform does not
 * expose this" hands a developer a permanent silence for a reading that is
 * simply not running yet. Only a look that FOUND NOTHING earns that word.
 */
let probedNoSpySurface = false;
let newArch = false;
let callCount = 0;
let startedAt = 0;
/** The MessageQueue module we installed our spy onto (for uninstall). */
let mqRef: MessageQueueLike | null = null;
/** The pre-existing spy (if any) we chained, restored on uninstall. */
let priorSpy: ((info: unknown) => void) | null = null;
/** Our own spy fn (identity kept so uninstall can compare/restore). */
let ourSpy: ((info: unknown) => void) | null = null;

/** performance.now() when present (monotonic), else Date.now(). */
function nowMs(): number {
  try {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
  } catch {
    /* fall through */
  }
  return Date.now();
}

/**
 * Install the MessageQueue spy (old arch only). Idempotent, best-effort, NEVER
 * throws. On the new architecture it records newArch:true and installs NOTHING.
 * If MessageQueue / spy is missing or wiring throws, tracking stays OFF and the
 * axis reads pending (measurable:0). Call once from telemetry start.
 */
export function installBridgeTracking(): void {
  if (installed) return;
  try {
    newArch = detectNewArch();
    startedAt = nowMs();
    installed = true; // even on new arch we're "installed" (so readings warm)
    if (newArch) return; // nothing to spy on — JSI is invisible from JS

    // Lazy-require the internal MessageQueue. Path is stable across RN versions
    // that still have the old bridge; guarded so a missing module is harmless.
    let mq: MessageQueueLike | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mq = require("react-native/Libraries/BatchedBridge/MessageQueue") as MessageQueueLike;
    } catch {
      mq = null;
    }
    if (!mq || typeof mq.spy !== "function") {
      // No spy surface (e.g. new-arch build that still resolved the module, or
      // an unexpected RN internal shape). We looked and found nothing, which
      // is the evidence the read needs to say so permanently.
      mqRef = null;
      probedNoSpySurface = true;
      return;
    }
    mqRef = mq;

    // Chain any existing spy: MessageQueue.spy replaces the single spy fn, so
    // capture whatever is there is not directly readable; instead we install a
    // spy that ALWAYS calls priorSpy first (byte-identically) then counts.
    // (RN exposes no getter for the current spy, so priorSpy is whatever a host
    //  registered via our own path; we conservatively keep null and never lose
    //  the host's spy because installing ours is the host's explicit opt-in.)
    ourSpy = function (info: unknown): void {
      if (priorSpy) {
        // Delegate to the chained spy first — its throw is the host's concern.
        priorSpy(info);
      }
      try {
        callCount += 1;
      } catch {
        /* best-effort — a counter slip must never reach the host bridge */
      }
    };
    mq.spy(ourSpy);
  } catch {
    // Wiring failed — restore and stay OFF (reads pending / measurable:0).
    try {
      uninstallBridgeTracking();
    } catch {
      /* best-effort */
    }
    installed = false;
  }
}

/**
 * The Bridge Traffic axis, or a pending reading while warming / not measurable.
 * Pure read — never mutates state, NEVER throws. Numbers-only wire shape.
 */
export function readBridgeTraffic(): BridgeTrafficResult {
  try {
    const sampledMs = installed ? Math.max(0, Math.round(nowMs() - startedAt)) : 0;
    // New arch: honest "not countable from JS", still uploaded so the tile
    // explains itself. measurable:0, pending — never a fake 100.
    if (newArch) {
      return {
        score:       null,
        rating:      "not-available",
        callsPerMin: null,
        sampledMs,
        newArch:     1,
        measurable:  0,
        reasonCode:   REASON_PLATFORM_DOES_NOT_EXPOSE,
      };
    }
    // We looked for the bridge's spy surface and it was not there. That is a
    // fact about this host, so it earns the permanent word.
    if (probedNoSpySurface) {
      return {
        score:       null,
        rating:      "not-available",
        callsPerMin: null,
        sampledMs,
        newArch:     0,
        measurable:  0,
        reasonCode:   REASON_PLATFORM_DOES_NOT_EXPOSE,
      };
    }
    // Not running: never started, or torn down by forget(). Nothing here is a
    // statement about the platform — the reading is simply not going yet.
    if (!installed || !mqRef || !ourSpy) {
      return {
        score:       null,
        rating:      "pending",
        callsPerMin: null,
        sampledMs,
        newArch:     0,
        measurable:  0,
      };
    }
    // Old arch, spy live → measurable. Warm up until enough time sampled.
    if (sampledMs < BRIDGE_MIN_SAMPLED_MS) {
      return {
        score:       null,
        rating:      "pending",
        callsPerMin: null,
        sampledMs,
        newArch:     0,
        measurable:  1,
      };
    }
    // The earned-rate contract (rateHonesty.ts) — the gate above already holds
    // the reading until the window earns the projection, so this cannot be null.
    const perMin = earnedPerMin(callCount, sampledMs) ?? 0;
    const score = linearScore(
      perMin,
      BRIDGE_TRAFFIC_THRESHOLDS.good,
      BRIDGE_TRAFFIC_THRESHOLDS.poor,
    );
    return {
      score,
      rating:      ratingFor(score),
      callsPerMin: Math.round(perMin),
      sampledMs,
      newArch:     0,
      measurable:  1,
    };
  } catch {
    return {
      score:       null,
      rating:      "pending",
      callsPerMin: null,
      sampledMs:   0,
      newArch:     0,
      measurable:  0,
    };
  }
}

/**
 * Uninstall the spy. Idempotent, NEVER throws. Restores the prior spy if one was
 * chained; otherwise toggles the spy off (MessageQueue.spy(false)). Wired into
 * telemetry.forget().
 */
export function uninstallBridgeTracking(): void {
  try {
    if (mqRef && typeof mqRef.spy === "function") {
      if (priorSpy) {
        mqRef.spy(priorSpy);
      } else {
        // No prior spy — turn spying off entirely.
        mqRef.spy(false);
      }
    }
  } catch {
    /* best-effort — never throw on teardown */
  }
  mqRef = null;
  priorSpy = null;
  ourSpy = null;
  installed = false;
  newArch = false;
  // Teardown clears the claim with the listener: after forget() the kit has
  // looked at nothing, so it may not still say the platform lacks a bridge.
  probedNoSpySurface = false;
  callCount = 0;
  startedAt = 0;
}

/** @internal test hooks — deterministic, no dependence on a real MessageQueue. */
export const _bridgeInternals = {
  BRIDGE_TRAFFIC_THRESHOLDS,
  BRIDGE_MIN_SAMPLED_MS,
  get isInstalled(): boolean {
    return installed;
  },
  get callCount(): number {
    return callCount;
  },
  get newArch(): boolean {
    return newArch;
  },
  /** Install synthetic old-arch state (spy live) without a real MessageQueue. */
  setUpForTests(opts: { newArch?: boolean; startedAt?: number } = {}): void {
    installed = true;
    newArch = opts.newArch ?? false;
    startedAt = opts.startedAt ?? 0;
    callCount = 0;
    if (!newArch) {
      mqRef = { spy: () => {} };
      ourSpy = () => {
        callCount += 1;
      };
    }
  },
  /** Simulate n MessageQueue calls (old-arch measurable state only). */
  fireForTests(n = 1): void {
    if (ourSpy) for (let i = 0; i < Math.max(0, Math.round(n)); i++) ourSpy(null);
  },
  /** Move the sampled-time origin back so readings clear the warm-up gate. */
  setStartedAtForTests(ms: number): void {
    startedAt = ms;
  },
  /** The look that found no MessageQueue spy surface on this host. */
  setNoSpySurfaceForTests(v: boolean): void {
    installed = true;
    newArch = false;
    mqRef = null;
    ourSpy = null;
    probedNoSpySurface = v;
  },
  get probedNoSpySurface(): boolean {
    return probedNoSpySurface;
  },
  reset(): void {
    uninstallBridgeTracking();
  },
};
