/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * networkSelfTest — a tiny, crash-safe "can this build reach Boosthis?" probe a
 * host can call from a debug button or a one-off script.
 *
 * WHY THIS EXISTS — the Rival sign-in incident took a long time to diagnose
 * because there was no in-app way to answer the first question: *does this build
 * have a working transport to the server at all, and is it the SAME transport
 * telemetry uses?* Consent (startup) worked while sign-in (later, reused socket)
 * did not, and the only signal was a vague "Couldn't reach Boosthis". This probe
 * makes that observable in one call:
 *   - it hits the public, credential-free `GET ${endpoint}/healthz`,
 *   - through the SAME transport the telemetry client uses (a host-wired
 *     `fetchImpl`, e.g. `expo/fetch`), AND — when that differs from the bare
 *     global `fetch` — through the global too, so a developer can see at a glance
 *     "my wired transport fails but the global works" (or vice versa). That is
 *     the exact divergence behind the incident.
 *
 * Contract (mirrors the rest of the kit's transport rules):
 *   - goes through `callFetch`, so headers are Hermes-safe tuples and a raw
 *     `expo/fetch` never trips its `instanceof Headers` landmine;
 *   - bounds each attempt with `Promise.race` against a timer — NEVER an
 *     AbortController/`signal` (some RN runtimes throw synchronously on one);
 *   - sends NO credentials and NO body — only `GET /healthz`;
 *   - NEVER throws and NEVER rejects: it always resolves a structured result,
 *     so a debug button can `await` it without its own try/catch;
 *   - emits a single human-readable `summary` safe to drop into an `Alert()` —
 *     transport error text is classified + sanitized via the shared
 *     `transportReason`, so no URL/email/token can leak into it.
 */
import { resolveFetch, callFetch, type FetchImpl } from "./fetch";
import { transportReason } from "./transportError";
import {
  getActiveTelemetryClient,
  resolveTelemetryEndpoint,
} from "./telemetry";

export interface SelfTestProbe {
  /** Which transport this probe used: the host-wired `fetchImpl`, or the bare
   *  global `fetch` bound to `globalThis`. */
  transport: "configured" | "global";
  /** True when `/healthz` answered with a 2xx status. */
  ok: boolean;
  /** The HTTP status, when a response was received. */
  status?: number;
  /** A short, sanitized, human cause when the probe failed (from
   *  `transportReason`), e.g. " (connection dropped)". Empty/undefined on
   *  success. */
  reason?: string;
}

export interface NetworkSelfTestResult {
  /** True when the transport the kit ACTUALLY uses (the configured one if a
   *  `fetchImpl` is wired, else the global) reached the server. */
  ok: boolean;
  /** The `/api` base that was probed (after `resolveTelemetryEndpoint`). */
  endpoint: string;
  /** One probe per distinct transport (1 when no custom `fetchImpl` is wired,
   *  2 when a wired transport differs from the global). */
  probes: SelfTestProbe[];
  /** A single human-readable line safe to show in an `Alert()`. */
  summary: string;
}

export interface NetworkSelfTestOptions {
  /** Override the `/api` base. Defaults to the active telemetry client's
   *  endpoint, else the built-in production default. Normalized + validated by
   *  `resolveTelemetryEndpoint` (a placeholder/relative value falls back to the
   *  default rather than probing a dead host). */
  endpoint?: string;
  /** Override the transport. Defaults to the active telemetry client's
   *  `fetchImpl` (so the probe matches what telemetry actually uses). */
  fetchImpl?: FetchImpl;
  /** Per-attempt timeout. Defaults to 8s, matching the auth path. */
  timeoutMs?: number;
}

/** Join an `/api` base with a leading-slash path, tolerating a trailing slash. */
function joinUrl(endpoint: string, path: string): string {
  return endpoint.replace(/\/+$/, "") + path;
}

/**
 * One credential-free `GET /healthz` through a single transport, bounded by a
 * timer. Never throws — resolves a {@link SelfTestProbe} either way.
 */
async function probe(
  transport: "configured" | "global",
  f: FetchImpl,
  url: string,
  timeoutMs: number,
): Promise<SelfTestProbe> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("boosthis: request timed out")),
      timeoutMs,
    );
  });
  try {
    // `callFetch` always returns a real Promise (tuple headers, sync-throw
    // caught, non-Response rejected), so this race can never itself be
    // "undefined is not a function".
    const fetchPromise = callFetch(f, url, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    fetchPromise.catch(() => {}); // a late settle must not become an unhandled rejection
    const res = await Promise.race([fetchPromise, timeout]);
    const status = res.status;
    const ok = status >= 200 && status < 300;
    return ok
      ? { transport, ok: true, status }
      : { transport, ok: false, status, reason: ` (HTTP ${status})` };
  } catch (err) {
    return { transport, ok: false, reason: transportReason(err) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Probe whether this build can reach Boosthis, through the kit's real transport
 * (and the global, when they differ). Always resolves — see the module doc for
 * the full contract.
 */
export async function runNetworkSelfTest(
  opts: NetworkSelfTestOptions = {},
): Promise<NetworkSelfTestResult> {
  // Resolve everything defensively so a bad active-client state can never throw.
  let endpoint = resolveTelemetryEndpoint(undefined);
  let providedImpl: unknown;
  try {
    const client = getActiveTelemetryClient();
    endpoint = resolveTelemetryEndpoint(opts.endpoint ?? client?.endpoint);
    providedImpl = opts.fetchImpl ?? client?.fetchImpl;
  } catch {
    endpoint = resolveTelemetryEndpoint(opts.endpoint);
    providedImpl = opts.fetchImpl;
  }

  const url = joinUrl(endpoint, "/healthz");
  const timeoutMs =
    typeof opts.timeoutMs === "number" && opts.timeoutMs > 0
      ? opts.timeoutMs
      : 8000;

  // The transport the kit ACTUALLY uses: the wired impl if one was provided,
  // else the bound global. We additionally probe the global when a custom impl
  // is in play, to surface a transport-specific failure.
  const hasCustom = typeof providedImpl === "function";
  const configured = resolveFetch(providedImpl);
  const global = resolveFetch(undefined);

  const probes: SelfTestProbe[] = [];

  // Primary probe — the transport the kit will use for real traffic.
  const primaryLabel: "configured" | "global" = hasCustom
    ? "configured"
    : "global";
  const primaryFetch = hasCustom ? configured : global;
  if (primaryFetch) {
    probes.push(await probe(primaryLabel, primaryFetch, url, timeoutMs));
  } else {
    probes.push({
      transport: primaryLabel,
      ok: false,
      reason: " (network unavailable in this build)",
    });
  }

  // Secondary probe — the global, only when it is a DISTINCT transport from a
  // wired custom impl (an independent-transport diagnostic).
  if (hasCustom) {
    if (global) {
      probes.push(await probe("global", global, url, timeoutMs));
    } else {
      probes.push({
        transport: "global",
        ok: false,
        reason: " (no global fetch in this build)",
      });
    }
  }

  const primary = probes[0];
  const ok = primary.ok;
  return { ok, endpoint, probes, summary: summarize(endpoint, probes) };
}

/** Build a single actionable line from the probe results. */
function summarize(endpoint: string, probes: SelfTestProbe[]): string {
  const primary = probes[0];
  const secondary = probes[1];

  // Single-transport case (no custom fetchImpl wired).
  if (!secondary) {
    return primary.ok
      ? `Boosthis is reachable (HTTP ${primary.status}).`
      : `Boosthis is unreachable${primary.reason ?? ""}. Check the device's connection and that the endpoint (${endpoint}) is correct.`;
  }

  // Two-transport case (wired transport vs global).
  if (primary.ok && secondary.ok) {
    return `Boosthis is reachable via your wired transport and the global fetch (HTTP ${primary.status}).`;
  }
  if (primary.ok && !secondary.ok) {
    return `Boosthis is reachable via your wired transport (HTTP ${primary.status}); the global fetch is not${secondary.reason ?? ""}. Keep routing Boosthis through your fetchImpl.`;
  }
  if (!primary.ok && secondary.ok) {
    return `Your wired transport can't reach Boosthis${primary.reason ?? ""}, but the global fetch can (HTTP ${secondary.status}). Check your fetchImpl — on Expo, pass \`fetch\` from "expo/fetch".`;
  }
  return `Boosthis is unreachable: wired transport${primary.reason ?? ""}, global fetch${secondary.reason ?? ""}. Check the device's connection and that the endpoint (${endpoint}) is correct.`;
}
