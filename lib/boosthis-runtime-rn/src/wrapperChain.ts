/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: one of our wrappers, and what it wraps ──────────────────
 *
 * Two different meters in this kit wrap the same host function. The AI call
 * watcher sits on `XMLHttpRequest.prototype.open/send`, and the optional
 * network wrapper sits on `send` and on the global `fetch`. Each of them also
 * has to answer a coverage question at read time: "is what I installed still
 * in front of every request, or has something replaced me?"
 *
 * Answered with plain identity (`proto.send === mine`) that question gets the
 * wrong answer the moment the OTHER meter wraps the same function: the first
 * watcher is still called on every request, through the second one, but it
 * reports itself blind. A meter that says "an AI client is unwatched" while
 * watching it is exactly the false reading this work exists to remove — so
 * the check has to be "am I still in the chain?", not "am I the entry point?".
 *
 * That needs each wrapper to publish two facts about itself: which of our
 * meters installed it, and the function it calls. Both are NON-ENUMERABLE, so
 * a host that copies, inspects or serialises the function never sees them and
 * nothing of ours leaks into its data.
 *
 * The contract a marked wrapper is promising: it calls its inner function on
 * EVERY path, exactly once, and hands back what that returns. Anything that
 * does not do that must not be marked, because another meter's coverage claim
 * rests on it.
 */

/** Which meter installed a wrapper. Own the name, so "is this mine?" and "is
 *  this ours?" stay two different questions. */
export type WrapperOwner = "network" | "ai-calls";

/** Present on a function this kit installed over a host's; its value is the
 *  owner above. */
const OWNER = "__boosthisWrapperOwner";
/** The function that wrapper calls — the next link towards the original. */
const INNER = "__boosthisWrapsInner";

/** How far a chain is walked before giving up. Several of our own layers can
 *  stack over a host's; a cycle should not arise, but a bound costs nothing
 *  and a read path must never hang. */
const MAX_HOPS = 8;

function define(target: unknown, key: string, value: unknown): void {
  try {
    Object.defineProperty(target as object, key, {
      value,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  } catch {
    /* Frozen or exotic function — callers fall back to their own guards. */
  }
}

function read(target: unknown, key: string): unknown {
  try {
    return (target as Record<string, unknown> | null)?.[key];
  } catch {
    return undefined;
  }
}

/**
 * Declare `wrapper` as ours and record the function it delegates to.
 *
 * Returns the wrapper, so it can be used inline where it is created.
 */
export function markBoosthisWrapper<T>(
  wrapper: T,
  inner: unknown,
  owner: WrapperOwner,
): T {
  define(wrapper, OWNER, owner);
  define(wrapper, INNER, inner);
  return wrapper;
}

/**
 * Is this function one this kit installed — and, if an owner is given, one
 * THAT meter installed? A meter re-asserting its own wrapper must ask the
 * narrow question, or another meter's layer would look like its own and it
 * would quietly never install.
 */
export function isBoosthisWrapper(fn: unknown, owner?: WrapperOwner): boolean {
  const mark = read(fn, OWNER);
  if (typeof mark !== "string") return false;
  return owner === undefined || mark === owner;
}

/** What one of our wrappers calls, or undefined if it is not one of ours. */
export function innerOf(fn: unknown): unknown {
  return isBoosthisWrapper(fn) ? read(fn, INNER) : undefined;
}

/**
 * Is `target` still called on every request that goes through `current`?
 *
 * True when `current` IS the target, or when every layer in front of it is a
 * Boosthis wrapper — each of which delegates unconditionally — and one of
 * them calls the target. A stranger's wrapper stops the walk: we cannot know
 * whether it calls through, so the honest answer there is no.
 */
export function wrapperChainReaches(
  current: unknown,
  target: unknown,
): boolean {
  if (!target) return false;
  let fn: unknown = current;
  for (let hop = 0; fn && hop < MAX_HOPS; hop++) {
    if (fn === target) return true;
    if (!isBoosthisWrapper(fn)) return false;
    fn = innerOf(fn);
  }
  return false;
}
