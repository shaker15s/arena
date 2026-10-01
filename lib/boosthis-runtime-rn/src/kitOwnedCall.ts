/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: marking the kit's OWN network calls ──────────────────────
 *
 * The Network axis measures THIS APP's traffic. The kit also makes requests
 * of its own — consent, registration, entitlement check-ins, telemetry and
 * snapshot uploads — and those are not the app's traffic by any reading.
 *
 * That distinction costs nothing while the host reports attempts by hand: it
 * reports its own calls and no others. It matters the moment the kit wraps a
 * transport automatically, because the kit's uploads go out through the very
 * same global `fetch` the wrapper now sits on. Left alone, an app that makes
 * no requests at all would accumulate attempts from the kit talking to us,
 * and the Network axis would eventually score — an axis nothing in the app
 * exercised telling a developer their app is fine. That is precisely the
 * defect the axis work exists to remove, arriving by the back door.
 *
 * So every kit-owned dispatch runs inside `runKitOwnedCall`, and the wrapper
 * asks this module before it times anything.
 *
 * SYNCHRONOUS BY CONSTRUCTION, for the same reason the wrapper's own depth
 * counter is: the span covers the call INTO the transport, which is exactly
 * when the wrapper decides whether this attempt is one it should time. It is
 * never held across an `await`, where it would silence an unrelated request
 * of the app's that merely started while one of ours was in the air.
 */

/** How many kit-owned dispatches are on the stack right now. */
let depth = 0;

/**
 * Is a call the KIT made being dispatched at this instant?
 *
 * Read by the automatic wrapper, which stands down when this is true: the
 * request belongs to Boosthis, not to the app being measured.
 */
export function isKitOwnedDispatch(): boolean {
  return depth > 0;
}

/**
 * Run one kit-owned dispatch, marked as ours for exactly as long as it takes
 * to hand the request to the transport.
 *
 * Returns the dispatch's own value untouched (usually a promise, which is
 * deliberately NOT awaited here) and never swallows its error.
 */
export function runKitOwnedCall<T>(dispatch: () => T): T {
  depth++;
  try {
    return dispatch();
  } finally {
    depth--;
  }
}

/** Test helper: forget any depth left behind by a thrown dispatch. */
export function _resetKitOwnedCallForTests(): void {
  depth = 0;
}
