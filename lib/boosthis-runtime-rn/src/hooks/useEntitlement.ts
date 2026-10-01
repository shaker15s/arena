/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
import { useSyncExternalStore } from "react";
import {
  getEntitlementGateKind,
  getLockHint,
  isInstallIdRejected,
  isRuntimeInert,
  subscribeEntitlement,
  type EntitlementGateKind,
} from "../killSwitch";

/**
 * Subscribe a component to the server-authority kill-switch (Rung 1).
 *
 * Returns true when the kit must be INERT — i.e. the server resolved a
 * non-active entitlement (revoked / unpaid / tampered), the offline grace
 * window lapsed, OR the global `BOOSTHIS_DISABLED` env kill is set. The
 * component re-renders the moment the gate flips, so Boosthis UI disappears on
 * a kill and reappears on a restore without the host reloading anything.
 *
 * First subscription kicks a lazy cache hydrate so a kill cached on a previous
 * launch is honoured even if the host renders Boosthis UI before
 * `enableTelemetry()` runs.
 */
export function useRuntimeInert(): boolean {
  return useSyncExternalStore(
    subscribeEntitlement,
    isRuntimeInert,
    isRuntimeInert,
  );
}

/**
 * Subscribe a component to the coarse "why is the kit locked" hint.
 *
 * Returns a short, plain-English line (or null) explaining the most likely
 * reason the ACTIVATION LOCK is still holding — e.g. no invite key set, the key
 * was rejected/revoked, or the server was unreachable. The category is resolved
 * on-device by the consent path a moment AFTER first paint, so this needs its
 * own subscription: `useRuntimeInert()`'s snapshot is only the locked boolean
 * (unchanged before and after), which alone would never re-render the notice.
 * The strings are fixed and code-defined — this never surfaces the key,
 * endpoint, or any server text.
 */
export function useLockHint(): string | null {
  return useSyncExternalStore(subscribeEntitlement, getLockHint, getLockHint);
}

/**
 * Subscribe a component to the "this app's install ID is not a UUID" state.
 *
 * True once the consent path saw the server refuse registration with the
 * machine-readable `invalid_install_id` marker. Unlike `useLockHint()` this is
 * NOT gated on the activation lock: a non-UUID install id is a developer wiring
 * mistake that must be visible on the account card even when the surrounding
 * state would otherwise look normal. The copy the UI renders for it is fixed
 * and code-defined — no server text and no install id are ever surfaced.
 */
export function useInstallIdRejected(): boolean {
  return useSyncExternalStore(
    subscribeEntitlement,
    isInstallIdRejected,
    isInstallIdRejected,
  );
}

/**
 * Subscribe a component to how the kit UI should PRESENT the gate.
 *
 * Unlike `useRuntimeInert()` (a boolean measuring gate), this returns the
 * finer-grained `EntitlementGateKind` so the UI can show a VISIBLE blocking
 * lock overlay for a revoked / unpaid / paused project (bubble stays visible,
 * opens straight to the overlay) versus fully vanishing for the silent
 * off-switch states ("hidden"). Re-renders the instant the gate flips.
 */
export function useEntitlementGate(): EntitlementGateKind {
  return useSyncExternalStore(
    subscribeEntitlement,
    getEntitlementGateKind,
    getEntitlementGateKind,
  );
}
