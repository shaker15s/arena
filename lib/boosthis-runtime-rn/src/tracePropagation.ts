/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/** BOOSTHIS_TRACE_PROPAGATION_V1 — where this kit may WRITE the trace headers.
 *
 * Shared contract: `docs/kit-trace-propagation-contract.md`. Every kit that
 * writes a trace header answers the same question — which destinations may see
 * it — and this is the React Native answer.
 *
 * THIS KIT'S POLICY IS STRICTER THAN THE CONTRACT'S DEFAULT, DELIBERATELY.
 *
 * The server kits default to `internal`: a private address, a `.local`, a
 * container name, a host with no dot in it. That default is safe there because
 * a server's neighbours really are the rest of its own deployment. A phone has
 * no neighbours. Its own back end is a public name on the public internet, and
 * it is spelled exactly like the analytics host, the map tiles and the payment
 * provider sitting beside it in the same app. An "internal" default here would
 * either propagate to nothing useful or propagate to whatever happened to look
 * private, and neither is a decision a developer made.
 *
 * So: NOTHING is propagated unless the developer NAMES the destination.
 *
 *   enableTelemetry({ traceScreens: { propagateTo: ["api.example.com"] } })
 *
 * Named nothing → written nowhere, and the circuit is still drawn from the
 * device's own spans. There is no environment variable: an app bundle has no
 * environment, and the setup call is the one place an RN developer already
 * writes this kind of decision.
 *
 * What IS shared with every other kit, byte for byte in behaviour:
 *   - the three headers, and only those three;
 *   - an entry is a bare host (`api.example.com`) or a leading-dot suffix
 *     (`.example.com`), matched case-insensitively, never a URL and never a
 *     path;
 *   - at most 64 entries, so a runaway list cannot become a scan;
 *   - `none` / `off` switch the whole thing off in one word;
 *   - an address written as a NUMBER is refused, because a numeric form is
 *     how a destination is spelled when it is being reached past its name;
 *   - a hosting provider's metadata service is refused outright and cannot be
 *     named back in.
 */

/** Say it in one word and nothing is propagated at all. */
export const OFF_KEYWORDS: readonly string[] = ["none", "off"];

/** Hard cap on named destinations. */
export const MAX_PROPAGATION_ENTRIES = 64;

/** The metadata services a cloud host answers on. Never propagated to, and
 *  never nameable: a trace header reaching one of these is a header written
 *  into the machinery the app runs on rather than to the app's own back end. */
export const PROVIDER_METADATA_HOSTS: readonly string[] = [
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
];

/** The same services reached by their well-known addresses. */
export const PROVIDER_METADATA_ADDRESSES: readonly string[] = [
  "169.254.169.254",
  "169.254.170.2",
  "fd00:ec2::254",
  "100.100.100.200",
];

/** What this kit will do with the headers, settled once at start-up. */
export interface PropagationPolicy {
  /** `off` — nothing, ever. `named` — exactly the hosts below. */
  mode: "off" | "named";
  /** Exact host names, lowercased. */
  hosts: readonly string[];
  /** Leading-dot suffixes (`.example.com`), lowercased. */
  suffixes: readonly string[];
  /** Entries refused for their shape, counted so a typo is not silence. */
  refused: number;
  /** Entries dropped because the list was over the cap. */
  dropped: number;
}

const OFF_POLICY: PropagationPolicy = Object.freeze({
  mode: "off",
  hosts: Object.freeze([]) as readonly string[],
  suffixes: Object.freeze([]) as readonly string[],
  refused: 0,
  dropped: 0,
});

let policy: PropagationPolicy = OFF_POLICY;

/** Is this text shaped like a host at all? Letters, digits, dots, hyphens —
 *  no scheme, no slash, no port, no space, no credentials. */
function looksLikeHost(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false;
  if (!/^[a-z0-9.-]+$/.test(value)) return false;
  if (value.startsWith("-") || value.endsWith("-")) return false;
  if (value.includes("..")) return false;
  return true;
}

/** An address spelled as a number, in any of the forms a resolver accepts.
 *  Refused wholesale: the point of naming a destination is the NAME. */
function isNumericAddressForm(host: string): boolean {
  if (host.includes(":")) return true; // IPv6, in any spelling
  const parts = host.split(".");
  if (parts.length === 0) return false;
  // Dotted quad, and also the short forms (`10.1`, `167772161`) that resolve
  // to the same place.
  return parts.every((p) => p.length > 0 && /^[0-9]+$/.test(p));
}

/** A provider metadata service, by name or by address. Not nameable. */
export function isProviderMetadataHost(host: unknown): boolean {
  if (typeof host !== "string") return false;
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (h.length === 0) return false;
  if (PROVIDER_METADATA_HOSTS.includes(h)) return true;
  if (PROVIDER_METADATA_ADDRESSES.includes(h)) return true;
  // A subdomain of a metadata name is the same service.
  return PROVIDER_METADATA_HOSTS.some((m) => h.endsWith("." + m));
}

/**
 * Read the developer's list into a settled policy.
 *
 * Accepts an array of entries, a comma-separated string, or one of the off
 * words. Anything else — a URL, a path, a port, an address written as a number
 * — is REFUSED and counted, never silently coerced into something that
 * half-matches.
 */
export function parseTracePropagation(raw: unknown): PropagationPolicy {
  if (raw === undefined || raw === null) return OFF_POLICY;
  let entries: string[];
  if (Array.isArray(raw)) {
    entries = raw.map((e) => String(e));
  } else if (typeof raw === "string") {
    entries = raw.split(",");
  } else {
    return OFF_POLICY;
  }
  entries = entries.map((e) => e.trim().toLowerCase()).filter((e) => e !== "");
  if (entries.length === 0) return OFF_POLICY;
  if (entries.length === 1 && OFF_KEYWORDS.includes(entries[0]!)) {
    return OFF_POLICY;
  }

  const hosts: string[] = [];
  const suffixes: string[] = [];
  let refused = 0;
  let dropped = 0;
  for (const entry of entries) {
    if (hosts.length + suffixes.length >= MAX_PROPAGATION_ENTRIES) {
      dropped += 1;
      continue;
    }
    if (OFF_KEYWORDS.includes(entry)) {
      // An off word mixed into a real list is a contradiction, not an entry.
      refused += 1;
      continue;
    }
    const isSuffix = entry.startsWith(".");
    const host = isSuffix ? entry.slice(1) : entry;
    if (!looksLikeHost(host) || isNumericAddressForm(host)) {
      refused += 1;
      continue;
    }
    if (isProviderMetadataHost(host)) {
      refused += 1;
      continue;
    }
    if (isSuffix) {
      if (!suffixes.includes(host)) suffixes.push(host);
    } else if (!hosts.includes(host)) {
      hosts.push(host);
    }
  }
  if (hosts.length === 0 && suffixes.length === 0) {
    return Object.freeze({
      mode: "off",
      hosts: Object.freeze([]) as readonly string[],
      suffixes: Object.freeze([]) as readonly string[],
      refused,
      dropped,
    });
  }
  return Object.freeze({
    mode: "named",
    hosts: Object.freeze(hosts) as readonly string[],
    suffixes: Object.freeze(suffixes) as readonly string[],
    refused,
    dropped,
  });
}

/** Settle the policy for this run. */
export function setTracePropagation(raw: unknown): PropagationPolicy {
  policy = parseTracePropagation(raw);
  return policy;
}

/** The policy in force. */
export function tracePropagationPolicy(): PropagationPolicy {
  return policy;
}

/** Back to propagating nowhere. */
export function resetTracePropagationPolicy(): void {
  policy = OFF_POLICY;
}

/** The only schemes this kit's transports speak. A destination written in any
 *  other is refused rather than guessed at. */
const PROPAGATABLE_SCHEMES: readonly string[] = ["http", "https"];

/**
 * Pull the host out of a URL without `new URL()` — undefined on some RN
 * runtimes, and a throw here would have to be swallowed anyway. Returns null
 * for a relative URL, which a phone app uses for nothing we can name.
 *
 * Reading this loosely is not a missing measurement. It is a trace header
 * delivered to somebody the developer never named, because the answer decides
 * who may receive it. So every URL this reader is not SURE of answers null,
 * and null means the request goes out exactly as the app wrote it. Three ways
 * a URL says one host to a permissive reader and another to the parser that
 * actually dials it:
 *
 *   - a BACKSLASH. For http and https a standards parser treats `\` exactly as
 *     `/`, so `https://evil.example\@api.example.com/` connects to
 *     evil.example — while a reader that only knows `/` keeps the whole thing
 *     as the authority, strips everything before the `@` as credentials, and
 *     reads the named host.
 *   - a TAB, NEWLINE or CARRIAGE RETURN. A parser deletes these from the whole
 *     URL before it looks at it, so they can move the authority's boundary
 *     after we have read it.
 *   - PERCENT-ENCODING in the authority. It is decoded during parsing, so
 *     `%2f` and `%40` can introduce a separator we never saw.
 */
export function hostOfUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const raw = url.trim();
  if (/[\t\n\r]/.test(raw)) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw);
  if (!scheme) return null;
  if (!PROPAGATABLE_SCHEMES.includes((scheme[1] ?? "").toLowerCase())) {
    return null;
  }
  const rest = raw.slice(scheme[0].length);
  // The authority ends at the first of these — the backslash included.
  const end = rest.search(/[/\\?#]/);
  let authority = end === -1 ? rest : rest.slice(0, end);
  const at = authority.lastIndexOf("@");
  if (at >= 0) authority = authority.slice(at + 1);
  if (authority.includes("%")) return null;
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]");
    if (close <= 0) return null;
    const inner = authority.slice(1, close).toLowerCase();
    const tail = authority.slice(close + 1);
    // Only the characters an address is written in, and a port after it or
    // nothing at all.
    if (!/^[0-9a-f:.]+$/.test(inner)) return null;
    if (tail.length > 0 && !/^:[0-9]+$/.test(tail)) return null;
    return inner;
  }
  const colon = authority.indexOf(":");
  if (colon >= 0 && !/^[0-9]*$/.test(authority.slice(colon + 1))) return null;
  const host = (colon >= 0 ? authority.slice(0, colon) : authority).toLowerCase();
  // A name we cannot read as a name is not a name we can match against the
  // developer's list.
  return looksLikeHost(host) ? host : null;
}

/**
 * May this destination see the trace headers?
 *
 * The only true answer is "the developer named it". A relative URL, an
 * unreadable one, a metadata service and anything not on the list are all
 * false, and false means the request goes out exactly as the app wrote it.
 */
export function shouldPropagateTo(host: unknown): boolean {
  if (policy.mode !== "named") return false;
  if (typeof host !== "string") return false;
  const h = host.trim().toLowerCase();
  if (h.length === 0) return false;
  if (isProviderMetadataHost(h)) return false;
  if (policy.hosts.includes(h)) return true;
  return policy.suffixes.some((s) => h === s || h.endsWith("." + s));
}

/** Same question, asked of a whole URL. */
export function shouldPropagateToUrl(url: unknown): boolean {
  return shouldPropagateTo(hostOfUrl(url));
}

/** How many destinations to name before saying "and N more". */
const SUMMARY_NAMED_LIMIT = 4;

/** One line for the panel and the setup page: what this kit will do with the
 *  headers, in the developer's own terms. */
export function tracePropagationSummary(): string {
  if (policy.mode === "off") {
    return "trace headers: not written to any host (name hosts in traceScreens.propagateTo)";
  }
  const all = [
    ...policy.hosts,
    ...policy.suffixes.map((s) => "." + s),
  ];
  const shown = all.slice(0, SUMMARY_NAMED_LIMIT).join(", ");
  const more = all.length > SUMMARY_NAMED_LIMIT
    ? ` and ${all.length - SUMMARY_NAMED_LIMIT} more`
    : "";
  const refused = policy.refused > 0 ? `; ${policy.refused} refused` : "";
  const dropped = policy.dropped > 0 ? `; ${policy.dropped} over the cap` : "";
  return `trace headers: ${shown}${more}${refused}${dropped}`;
}
