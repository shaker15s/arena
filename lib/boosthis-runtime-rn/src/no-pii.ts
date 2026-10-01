/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/** PII denylist + guard.
 *
 * Mirrors `lib/boosthis-py/boosthis/pii.py` verbatim. Both implementations
 * must move in lock-step — same denylist, same allowlist, same value
 * patterns, same algorithm. See `threat_model.md` (Information
 * Disclosure) for the security guarantees this module is meant to enforce.
 */

export const PII_DENYLIST = [
  // identity
  "email", "mail", "username", "userid", "user_id", "uid",
  "firstname", "first_name", "lastname", "last_name",
  "fullname", "full_name", "phone", "mobile", "tel",
  "ssn", "nationalid", "national_id", "taxid", "tax_id",
  "dob", "birthdate", "birthday",
  // account/auth secrets
  "password", "passwd", "secret",
  "apikey", "api_key", "token", "auth", "authorization",
  "session", "cookie", "bearer", "jwt",
  "creditcard", "credit_card", "cardnumber", "card_number", "cvv",
  "iban", "swift", "routingnumber", "routing_number",
  // device-as-identity
  "deviceid", "device_id", "advertisingid", "advertising_id",
  "idfa", "idfv", "macaddress", "mac_address", "imei",
  // network identity
  "ipaddress", "ip_address", "ip", "ipv4", "ipv6",
  "useragent", "user_agent",
  // location
  "latitude", "longitude", "lat", "lng", "lon", "geohash",
  "address", "street", "city", "zipcode", "zip_code",
  "postalcode", "postal_code",
  // free-form content (high-risk for incidental PII)
  "message", "content", "body", "text", "comment", "note",
  "value", "input", "query", "search",
] as const;

/** Allowlist of keys that look like denylisted ones but are explicitly safe. */
const ALLOWLIST = new Set([
  "screen", "screenname", "screen_name",
  "appversion", "app_version",
  "osversion", "os_version",
  "osname", "os_name",
  "findingid", "finding_id",
  "ruleid", "rule_id",
  "score", "rating", "perception",
  // Per-process correlation token used by the production sampler. It is
  // generated as s_<timestamp>_<random> at module load and never
  // contains a user/auth session id. Without this entry the denied
  // fragment session tokenizes out of sessionId and blocks every sample.
  // Other session-prefixed variants like sessionKey or sessionToken
  // remain denied via the tokenizer (no exact allowlist match).
  "sessionid", "session_id",
  // Snapshot axis keys whose names collide with the denied fragment content
  // via the pass-2 substring check (gilContention / lockContention contain
  // it as a substring once normalized). Code-defined axis identifiers, never
  // user content; values are still screened. Kept here because the Python
  // kit allowlist must match this set verbatim (tests/test_pii_parity.py) —
  // without the exemption the kit itself silently drops the ENTIRE snapshot
  // once such a meter leaves warming. Server twin lives in api-server
  // pii.ts; the Go twin in boosthis-go/pii.go.
  "gilcontention", "lockcontention",
  // leakWatch (shared additive Leak Watch axis, Aug 2026) emits per-category
  // COUNTERS whose contract-mandated camelCase key names embed denied fragments
  // (secret in secretCount). These are integers — never any matched value — so
  // the field NAMES are allowlisted here. Kept in lock-step across runtimes.
  "secretcount", "stackcount", "piicount",
  // cookieExposure axis KEY itself collides with the denied cookie fragment
  // via the pass-2 substring check. Code-defined axis identifier whose sub-
  // object is counts-only (no cookie name, value or header text ever rides it).
  // Without this entry the guard drops the ENTIRE snapshot the moment the app
  // sets its first cookie. Kept in lock-step across every kit allowlist.
  "cookieexposure",
  // AI-call visibility (Aug 2026). A provider reports how much of the prompt
  // it read and how much answer it wrote in units it calls TOKENS, and the
  // headroom it publishes is counted in the same units. The field names below
  // therefore collide with the denied token fragment while carrying nothing
  // but integers and percentages — never a credential, never a prompt, never
  // an answer. Allowlisted by exact name so the collision cannot widen: any
  // other token-named field is still refused. This runtime never emits them;
  // the entries are here so every kit guard judges one payload the same way.
  "tokensin",
  "tokensout",
  "worsttokenspct",
]);

const DENY_NORMALIZED: ReadonlyArray<{ denied: string; norm: string }> =
  PII_DENYLIST.map((d) => ({ denied: d, norm: normalize(d) }));

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
/** The kit's canonical email regex, re-exported (never duplicated) so the
 *  leakWatch collector reuses this exact pattern for its pii category. */
export const PII_EMAIL_RE: RegExp = EMAIL_RE;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const IPV6_FULL_RE = /^[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){7}$/i;
const IPV6_HEX_ONLY_RE = /^[0-9a-f:]+$/i;
const IPV6_CANDIDATE_RE = /[0-9a-f:]{4,45}/gi;
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const BEARER_RE = /bearer\s+\S{8,}/i;
const PHONE_RE =
  /(?<![0-9a-fA-F])(?:\+\d{1,3}[\s\-.])?\(?\d{3}\)?[\s\-.]\d{3}[\s\-.]\d{4}(?![0-9a-fA-F])/;
// UUID v4/v5 and similar hyphen-grouped hex identifiers. These are common
// structured PII carriers when embedded in route labels (user ids, order ids,
// resource ids passed as route params). NOT used in the general walk() because
// install IDs are also UUID-shaped and would trigger a false positive; instead
// these are applied only to specific high-risk fields (see routeLabelHasPII).
export const ROUTE_LABEL_UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// Long unbroken numeric runs (6+ digits) that look like opaque identifiers
// (order numbers, customer refs, ticket ids) in route labels. Word-boundary
// anchors prevent false positives on short numbers in version strings or
// timings. Scoped to routeLabel checks for the same reason as UUID_RE above.
export const ROUTE_LABEL_NUMERIC_RE = /\b\d{6,}\b/;

// Route/screen labels are code-defined identifiers (PascalCase, camelCase,
// snake_case, slash paths like "profile/detail"). Legitimate labels never
// contain whitespace — space-separated words are a strong signal of
// user-derived content ("Jane Doe", "Patient John Smith", "Workspace acme-west").
const LABEL_HAS_SPACE_RE = /\s/;

/** Returns the matched tag if the given route/screen label contains a
 *  high-risk PII pattern that the general walk() cannot check (UUID or long
 *  numeric ID) without false-positiving on internal install identifiers.
 *  Also blocks labels with whitespace, which are always dynamic user content —
 *  code-defined names use PascalCase/camelCase/snake_case/slash paths.
 *  Apply this BEFORE including any label in an outbound payload. */
export function routeLabelHasPII(label: string): string | null {
  if (LABEL_HAS_SPACE_RE.test(label)) return "~space-separated-label";
  const existing = findDeniedValue(label);
  if (existing !== null) return existing;
  if (ROUTE_LABEL_UUID_RE.test(label)) return "~uuid";
  if (ROUTE_LABEL_NUMERIC_RE.test(label)) return "~numeric-id";
  return null;
}

// RN span labels are produced as "METHOD /path" by spanLabel() — a single HTTP
// method token followed by a space and a slash-prefixed path. The path is
// already PII-redacted by normalizeApiPath(); the space is structural, not user
// content. All other whitespace-bearing labels ("Jane Doe", "Order 873451") are
// user-derived and must be blocked.
// Fully anchored (closed method set, exactly one space, path has no further
// whitespace) — mirrors HTTP_METHOD_PATH_RE in no-pii.ts files for web and Node.
const HTTP_METHOD_PATH_RE =
  /^(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE|CONNECT) \/\S*$/;

// Second structural exception, and the ONLY other one: a SCREEN NODE label —
// "screen:Order Details", "screen:orders/[id]" — produced by the screen
// circuit (`screenCircuit.ts`) when the developer switches it on.
//
// A screen is named by the developer in their navigator, and some of those
// names legitimately carry a space. Without this exception such a screen was
// dropped HERE, at the last gate before the upload, while the calls made from
// it went out and arrived pointing at a parent that never came — a hole in the
// app's own map with nothing saying why.
//
// Byte-identical to `STRUCTURAL_SCREEN_NODE_RE` in the server's lib/pii.ts,
// which is the screen this label has to survive on arrival: the two are one
// rule, and a label one side admits and the other refuses is a silent drop.
// Every subsequent check (denied value, UUID, long numeric id) still runs on
// the whole label, so a screen name carrying a real identifier is still
// blocked — and the circuit refuses the same names on the device, so a node
// this guard would drop is never given children in the first place.
const STRUCTURAL_SCREEN_NODE_RE =
  /^screen:[A-Za-z0-9[\]()][A-Za-z0-9[\]._:/()-]*(?: [A-Za-z0-9[\]()][A-Za-z0-9[\]._:/()-]*)*$/;

/** Returns the matched ~tag if the label contains a high-risk PII pattern.
 *  Use this at transmit time for span labels that originate from `spanLabel()`
 *  and therefore legitimately contain a single structural "METHOD /path" space.
 *  For all other label types (screen names, route keys) use `routeLabelHasPII`
 *  which rejects every label with whitespace. */
export function transmitLabelHasPII(label: string): string | null {
  // Allow the structural "HTTP_METHOD /path" space, and the spaces inside a
  // "screen:<Route Name>" node label; block everything else.
  if (
    LABEL_HAS_SPACE_RE.test(label) &&
    !HTTP_METHOD_PATH_RE.test(label) &&
    !STRUCTURAL_SCREEN_NODE_RE.test(label)
  ) {
    return "~space-separated-label";
  }
  const existing = findDeniedValue(label);
  if (existing !== null) return existing;
  if (ROUTE_LABEL_UUID_RE.test(label)) return "~uuid";
  if (ROUTE_LABEL_NUMERIC_RE.test(label)) return "~numeric-id";
  return null;
}

/**
 * A BACKGROUND JOB'S NAME, screened before it leaves the device.
 *
 * Deliberately NOT `routeLabelHasPII`: a job name is written in code the way
 * a function is ("nightly-billing", "queue.drain", "Refresh Feed"), and a
 * space in one is ordinary rather than the sign of a name built out of
 * somebody's data. What is screened is what a name should never contain — an
 * address, a token, a phone number, an id — plus control characters, which
 * have no business in a code-defined name and are how a name would be made to
 * lie on a page.
 *
 * Identical in intent and in checks to the Node kit's screen of the same
 * name, because the two produce rows in the same table and the server applies
 * one rule to both.
 */
export function jobNameHasPII(name: string): string | null {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return "~control-characters";
  const existing = findDeniedValue(name);
  if (existing !== null) return existing;
  if (ROUTE_LABEL_UUID_RE.test(name)) return "~uuid";
  if (ROUTE_LABEL_NUMERIC_RE.test(name)) return "~numeric-id";
  return null;
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tokenize(name: string): string[] {
  const s = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return s.split(/[^a-zA-Z0-9]+/).filter(Boolean).map((t) => t.toLowerCase());
}

function looksLikeIPv6(val: string): boolean {
  if (val.length < 3) return false;
  if (IPV6_FULL_RE.test(val)) return true;
  if (!val.includes("::")) return false;
  if (!IPV6_HEX_ONLY_RE.test(val)) return false;
  if (val.indexOf("::") !== val.lastIndexOf("::")) return false;
  const groups = val.split(":").filter((g) => g.length > 0);
  return groups.length >= 1 && groups.length <= 7;
}

function containsEmbeddedIPv6(val: string): boolean {
  const matches = val.match(IPV6_CANDIDATE_RE);
  if (!matches) return false;
  for (const m of matches) if (looksLikeIPv6(m)) return true;
  return false;
}

function findDeniedFragment(name: string): string | null {
  const norm = normalize(name);
  if (ALLOWLIST.has(norm)) return null;
  const tokens = tokenize(name);
  // Pass 1: exact normalized match + per-token match.
  for (const { denied, norm: dNorm } of DENY_NORMALIZED) {
    if (norm === dNorm) return denied;
    for (const tok of tokens) if (tok === dNorm) return denied;
  }
  // Pass 2: concatenated-fragment containment for entries ≥ 5 chars.
  // Catches `customertoken`, `myemail`, `sessiontokenv2`. Length floor
  // avoids false positives on short tokens (`ip`, `uid`, `dob`, ...).
  for (const { denied, norm: dNorm } of DENY_NORMALIZED) {
    if (dNorm.length < 5) continue;
    if (norm.includes(dNorm)) return denied;
  }
  return null;
}

function findDeniedValue(val: string): string | null {
  if (val.length < 5) return null;
  if (EMAIL_RE.test(val)) return "~email";
  if (JWT_RE.test(val)) return "~jwt";
  if (BEARER_RE.test(val)) return "~bearer";
  if (IPV4_RE.test(val)) return "~ipv4";
  if (containsEmbeddedIPv6(val)) return "~ipv6";
  if (PHONE_RE.test(val)) return "~phone";
  return null;
}

/**
 * Value-level scan that includes UUID detection. Used only for route/screen
 * labels — NOT for the general `walk()` guard. UUIDs are legitimate in
 * technical fields like installId, but must not appear in route labels where
 * they signal a dynamic, user-derived string (order id, customer ref, etc.).
 */
function findDeniedValueForLabel(val: string): string | null {
  const hit = findDeniedValue(val);
  if (hit !== null) return hit;
  if (ROUTE_LABEL_UUID_RE.test(val)) return "~uuid";
  return null;
}

/**
 * Sanitize a route or screen label before it leaves the device.
 *
 * Route labels are meant to be code-defined identifiers (e.g. "HomeScreen",
 * "tabs/profile", "OrderDetails") — never user-supplied strings. This function
 * enforces two layers of defence:
 *
 *  1. Truncate to the server's max accepted length (200 chars).
 *  2. Reject labels containing spaces. Code-defined route names never contain
 *     spaces; a space in a route label is a strong signal that the string is
 *     user-derived (e.g. "Profile/Jane Doe", "Order 873451", "Patient John
 *     Smith") and must not leave the device.
 *  3. Run the value-level PII scan including UUID detection; if the label
 *     embeds an email, JWT, IP, phone, UUID, or other detected pattern, replace
 *     the whole label with "[redacted]".
 *
 * This combination catches all the realistic attack cases described in the
 * privacy threat model without requiring NLP. The only undetectable case is a
 * code-defined label that happens to collide with a real name without spaces —
 * an acknowledged limitation documented in threat_model.md.
 */
export function sanitizeRouteLabel(label: string): string {
  const truncated = label.slice(0, 200);
  // Spaces are the primary signal of user-derived content in a label field.
  if (truncated.includes(" ")) return "[redacted]";
  if (findDeniedValueForLabel(truncated) !== null) return "[redacted]";
  return truncated;
}

export class PIIDetectedError extends Error {
  readonly path: string;
  readonly fieldName: string;
  readonly matchedFragment: string;
  constructor(path: string, fieldName: string, matchedFragment: string) {
    super(
      `Boosthis no-PII guard refused outgoing payload: field "${path}" ` +
        `(name "${fieldName}") matches denied fragment "${matchedFragment}". ` +
        "Boosthis's privacy contract forbids transmitting personally identifying data. " +
        "If this field is genuinely non-PII, rename it; otherwise remove it.",
    );
    this.name = "PIIDetectedError";
    this.path = path;
    this.fieldName = fieldName;
    this.matchedFragment = matchedFragment;
  }
}

function walk(
  payload: unknown,
  path: string,
  seen: WeakSet<object>,
): PIIDetectedError | null {
  if (typeof payload === "string") {
    const denied = findDeniedValue(payload);
    if (denied !== null) {
      const fieldName = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1) : path;
      return new PIIDetectedError(path, fieldName, denied);
    }
    return null;
  }
  if (payload === null || typeof payload !== "object") return null;
  if (seen.has(payload as object)) return null;
  seen.add(payload as object);

  if (Array.isArray(payload)) {
    for (let i = 0; i < payload.length; i++) {
      const inner = walk(payload[i], `${path}[${i}]`, seen);
      if (inner) return inner;
    }
    return null;
  }
  for (const [key, val] of Object.entries(payload as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    const matched = findDeniedFragment(key);
    if (matched !== null) return new PIIDetectedError(childPath, key, matched);
    const inner = walk(val, childPath, seen);
    if (inner) return inner;
  }
  return null;
}

/** Returns null if clean, or the offending error object if PII was detected. */
export function checkNoPII(payload: unknown): PIIDetectedError | null {
  return walk(payload, "$", new WeakSet<object>());
}

/** Throws `PIIDetectedError` if the payload contains any PII. */
export function assertNoPII(payload: unknown): void {
  const hit = checkNoPII(payload);
  if (hit) throw hit;
}
