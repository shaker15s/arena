/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/** The shape of a request path, with the ids taken out — and a LEAF.
 *
 *  This one function is read by three different parts of the kit: the network
 *  meter, which groups timings by the shape of a call; the span emitter, which
 *  makes a route label out of it; and anything downstream that has to name a
 *  call without naming a customer's record.
 *
 *  It lives here, importing nothing, for the same reason the scoring helpers
 *  do (`axisScoring.ts`): it used to live in `perfMonitor.ts`, which imports
 *  the network wrapper, which now reaches the screen circuit, which needs a
 *  route label — a four-module require cycle that Metro prints in the
 *  customer's own terminal on every bundle. A shared helper cannot live in a
 *  module that imports its users. `perfMonitor.ts` re-exports it, so nothing
 *  that already read it from there had to change.
 */

/** The longest a segment may be and still read as a word somebody typed into
 *  a router rather than a value that came out of a record. */
const MAX_STATIC_SEGMENT = 24;

/** A version marker — `v1`, `v2`, `v10` — the one place a digit belongs in a
 *  path a developer wrote. */
const VERSION_SEGMENT_RE = /^v\d{1,3}$/i;

/** Letters and the punctuation a route word is written with. No digit, no
 *  percent-encoding, no `@`, nothing outside ASCII. */
const STATIC_SEGMENT_RE = /^[A-Za-z][A-Za-z._~-]*$/;

/**
 * Is this segment one the DEVELOPER wrote, rather than one a record supplied?
 *
 * Deliberately answered by refusing everything it is not sure of, because the
 * cost of the two mistakes is not the same: a value kept is a customer's data
 * on our wire, a word replaced is one path shape that reads `:id`. So a
 * segment travels only when it is letters and route punctuation — no digit
 * (bar a version marker), no `%`, no `@`, nothing outside ASCII, and short.
 *
 * What a grammar CANNOT decide is which letters-only word is a route and
 * which is a person: `/profile/sarah` and `/profile/settings` are the same
 * shape. Nothing here pretends otherwise. That case is answered where it can
 * be — a screen label is screened against the app's OWN route vocabulary
 * (`screenCircuit.ts`), and the Terms place what a customer writes into their
 * own route names with the customer.
 */
function isStaticSegment(seg: string): boolean {
  if (seg.length > MAX_STATIC_SEGMENT) return false;
  if (VERSION_SEGMENT_RE.test(seg)) return true;
  return STATIC_SEGMENT_RE.test(seg);
}

/**
 * Collapse a URL to the shape of its path: no scheme, no host, no query, no
 * fragment, and every segment that is not plainly a word the developer wrote
 * replaced by `:id`. `https://api.example.com/orders/48211?x=1` becomes
 * `/orders/:id`, and so do `/orders/48211-b`, `/orders/%41%42` and
 * `/users/a@b.com`.
 */
export function normalizeApiPath(url: string): string {
  let path = url;
  // Strip scheme + host so /api/foo and https://x.com/api/foo collapse.
  path = path.replace(/^[a-z]+:\/\/[^/]+/i, "");
  // Strip query + fragment.
  path = path.split("?")[0].split("#")[0];
  if (!path.startsWith("/")) path = "/" + path;
  const segs = path.split("/").map((seg) => {
    if (!seg) return seg;
    return isStaticSegment(seg) ? seg : ":id";
  });
  return segs.join("/");
}
