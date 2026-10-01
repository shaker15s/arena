/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * safe — fail-soft wrappers for Boosthis's OWN non-render callbacks.
 *
 * React error boundaries only catch throws during render/commit. They do NOT
 * catch event handlers (Pressable onPress, PanResponder, scroll/touch
 * observers), effect cleanups, timers, or promise rejections. An unguarded
 * throw/rejection in one of those Boosthis-owned paths would bubble straight to
 * the HOST app's root — exactly what a drop-in measurement SDK must never do.
 *
 * These helpers make Boosthis's own logic fail soft: the error is swallowed and
 * logged ONCE to the on-device console in __DEV__ only — never transmitted,
 * persisted, or uploaded (its message/args may carry app data, and the privacy
 * contract forbids sending anything off-device that has not passed the PII
 * guard). This mirrors BoosthisErrorBoundary's posture for the render path.
 *
 * IMPORTANT: only ever wrap Boosthis-OWNED logic. NEVER wrap a host-provided
 * callback (e.g. an `onRulePress` passed in by the host) — a throw there is the
 * host's own bug, and silently swallowing it would change the host app's
 * behavior and hide real errors from the developer.
 */

function devWarn(scope: string, err: unknown): void {
  const dev = (globalThis as { __DEV__?: boolean }).__DEV__ === true;
  if (dev) {
    // eslint-disable-next-line no-console
    console.warn(
      `[boosthis] suppressed error in ${scope} — Boosthis failed soft so the ` +
        `host app keeps running:`,
      err,
    );
  }
}

/** Run a synchronous Boosthis-owned block; a throw can never escape. */
export function safeRun(scope: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    devWarn(scope, err);
  }
}

/**
 * Wrap a synchronous Boosthis-owned handler (Pressable/PanResponder/scroll)
 * so a throw can never reach the host's event dispatch. Preserves the call
 * signature so it can be spread/assigned where the original was.
 */
export function safeHandler<A extends unknown[]>(
  scope: string,
  fn: (...args: A) => void,
): (...args: A) => void {
  return (...args: A) => {
    try {
      fn(...args);
    } catch (err) {
      devWarn(scope, err);
    }
  };
}

/**
 * Fire a Boosthis-owned async/promise op without awaiting it, swallowing any
 * rejection (and any synchronous throw while starting it). Use for fire-and-
 * forget chains like `void thing().then(...)` so they can never become an
 * unhandled promise rejection at the host root.
 */
export function safeAsync(scope: string, op: () => unknown): void {
  try {
    Promise.resolve(op()).catch((err) => devWarn(scope, err));
  } catch (err) {
    devWarn(scope, err);
  }
}
