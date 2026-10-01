/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * "Is THIS install on file with Boosthis?" — the one answer the in-app
 * dashboard is allowed to render a registration verdict from. Port of the
 * browser kit's `registration.ts`, identical in its state machine so no two
 * kits can disagree about what "registered" means.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The dashboard used to decide "registered" from on-device state alone: this
 * process holds a delete token. That is true right after consent and false on
 * every launch where the credential store could not be read — a reinstall, a
 * cleared keychain, a cold start that raced the restore. Same live install,
 * two contradictory verdicts, and only one can be true. Worse, the panel is
 * what an assisting AI reads to decide whether it is done: a false "not
 * registered" makes it change the install line's id, which mints a second
 * install, which the panel also calls not registered.
 *
 * A verdict about the SERVER's records has to come from the server. This
 * module holds that answer in FOUR internal states so a real negative can be
 * told apart from an unanswered question:
 *
 *   pending      no answer yet (the check has not run, or is in flight)
 *   registered   we asked (or registered) and the install IS on file
 *   unregistered we asked and it is NOT on file / the key was refused
 *   unreachable  we asked and could not get an answer at all
 *
 * The public verdict collapses `pending` and `unreachable` into `"unknown"`:
 * three outcomes, never two, so an unanswered check can never be shown as a
 * failed install and can never carry the claim that nothing is being sent.
 *
 * Never throws into the host app: every entry point is self-guarded, and a
 * failed probe degrades to `unreachable`.
 */

import { callFetch, resolveFetch } from "./fetch";

/** Internal, four-way. `unreachable` is a FAILED attempt, `pending` is no
 *  attempt yet — callers that need the difference read this. */
export type RegistrationState =
  | "pending"
  | "registered"
  | "unregistered"
  | "unreachable";

/** What a display surface is allowed to know: three outcomes, not two. */
export type RegistrationVerdict = "registered" | "unregistered" | "unknown";

let state: RegistrationState = "pending";
let inFlight = false;
let lastAttemptAt = 0;
const listeners = new Set<() => void>();

/** Don't re-ask more than this often while the answer is still missing. The
 *  dashboard re-reads on a 2s interval and would otherwise hammer the route. */
const RECHECK_MS = 30_000;

/** How long a single probe may hang before we treat it as no answer. RN gives
 *  no default timeout, and a dashboard that waits forever is a dashboard that
 *  never reaches its "cannot tell" state. */
const PROBE_TIMEOUT_MS = 8_000;

function setState(next: RegistrationState): void {
  if (next === state) return;
  state = next;
  for (const fn of Array.from(listeners)) {
    try {
      fn();
    } catch {
      // a broken subscriber must never break the kit
    }
  }
}

/** The server has this install on file — proven by a consent call it accepted
 *  (a delete token only exists because the server minted it), or by the
 *  registration probe below. */
export function markRegistrationConfirmed(): void {
  setState("registered");
}

/** A definite negative: the server does not have this install on file, or it
 *  refused the project key outright (so this app cannot register with it). */
export function markRegistrationRefused(): void {
  setState("unregistered");
}

/** We asked and got no usable answer (no signal, 5xx, a server too old to know
 *  the route). Never downgrades a definite answer we already hold: a
 *  registered install stays registered when the phone loses its connection. */
export function markRegistrationUnreachable(): void {
  if (state === "registered" || state === "unregistered") return;
  setState("unreachable");
}

export function getRegistrationState(): RegistrationState {
  return state;
}

/** The three-outcome verdict every display surface must use. */
export function getRegistrationVerdict(): RegistrationVerdict {
  if (state === "registered") return "registered";
  if (state === "unregistered") return "unregistered";
  return "unknown";
}

/** Re-render hook for the in-app dashboard: fires whenever the answer moves. */
export function subscribeRegistration(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Test-only: forget the answer and every latch. */
export function _resetRegistrationForTests(): void {
  state = "pending";
  inFlight = false;
  lastAttemptAt = 0;
  listeners.clear();
}

export interface RegistrationCheckContext {
  endpoint: string | null | undefined;
  installId: string | null | undefined;
  /** The project key this app registers with. Without one the app cannot
   *  register at all, and we cannot ask about it either. */
  projectKey: string | null | undefined;
  fetchImpl?: typeof fetch;
  /** Test seam only. */
  nowMs?: number;
}

/**
 * Ask the server whether this install is on file, and record the answer.
 *
 * `GET /installs/{installId}/registration` with the project key as the bearer —
 * the app already holds that key (it is what the kit registers with), so
 * asking leaks nothing new. The route answers `{ registered: boolean }`, and
 * only ever says `true` for an install on the presented key's own key line.
 *
 * Fire-and-forget: never rejects, never throws, and re-asks at most once every
 * 30s while the answer is still missing. Anything that is not a clean answer
 * (offline, 5xx, an older server that 404s the route itself) lands on
 * `unreachable` — "cannot tell", never "not registered".
 */
export async function checkRegistrationOnce(
  ctx: RegistrationCheckContext,
): Promise<void> {
  try {
    // A definite answer is never re-asked; local latching keeps the panel calm.
    if (state === "registered" || state === "unregistered") return;
    if (inFlight) return;
    const now = ctx.nowMs ?? Date.now();
    if (lastAttemptAt !== 0 && now - lastAttemptAt < RECHECK_MS) return;

    const endpoint = ctx.endpoint;
    const installId = ctx.installId;
    if (!endpoint || !installId) {
      // Nothing to ask about: the kit never started. That is a LOCAL fact, not
      // a guess about the server, so it is a definite negative.
      setState("unregistered");
      return;
    }
    if (!ctx.projectKey) {
      // No key means this app cannot register with us at all — equally a local
      // fact.
      setState("unregistered");
      return;
    }
    const f = resolveFetch(ctx.fetchImpl);
    if (!f) {
      // No transport at all — that is "cannot tell", never a failed install.
      setState("unreachable");
      return;
    }

    inFlight = true;
    lastAttemptAt = now;
    try {
      const base = endpoint.replace(/\/$/, "");
      const url = `${base}/installs/${encodeURIComponent(installId)}/registration`;
      // No abort signal: some RN runtimes throw synchronously on one (see
      // fetch.ts). A stalled probe is bounded by racing a timer instead, and a
      // timeout lands on "cannot tell" like every other non-answer.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), PROBE_TIMEOUT_MS);
      });
      const res = await Promise.race([
        callFetch(f, url, {
          method: "GET",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${ctx.projectKey}`,
          },
        }),
        timeout,
      ]);
      if (timer !== undefined) clearTimeout(timer);
      if (!res) {
        setState("unreachable");
        return;
      }
      if (res.status === 200) {
        let registered: unknown = undefined;
        try {
          const body = (await res.json()) as { registered?: unknown };
          registered = body?.registered;
        } catch {
          // Unreadable body — we asked, but we did not get an answer.
        }
        if (registered === true) setState("registered");
        else if (registered === false) setState("unregistered");
        else setState("unreachable");
        return;
      }
      if (res.status === 401 || res.status === 403) {
        // The key was refused, so this app cannot be registered under it.
        setState("unregistered");
        return;
      }
      // 404 (a server too old to know this route), 429, 5xx, anything else:
      // we could not get an answer. Say exactly that.
      setState("unreachable");
    } finally {
      inFlight = false;
    }
  } catch {
    inFlight = false;
    try {
      markRegistrationUnreachable();
    } catch {
      // never throw into the host
    }
  }
}
