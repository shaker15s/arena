/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: AI-call meter (React Native) ─────────────────────────────
 *
 * React Native's global fetch is the whatwg-fetch layer over XMLHttpRequest.
 * This watcher deliberately attaches to XHR only. Wrapping fetch as well would
 * file the same physical request twice; watching the lower transport sees both
 * fetch and direct XHR while counting at send(), not at open().
 *
 * Only aggregate numbers and fixed provider codes leave this module. Request
 * and response bodies, headers, URLs, paths and hosts are never retained.
 */

import {
  aiProviderCodeOrDeclared,
  DECLARED_PROVIDER_CODE,
  normaliseDeclaredEndpoint,
} from "./aiProviders";
import { isBoosthisDisabled } from "./runtimeFlags";
import { markBoosthisWrapper, wrapperChainReaches } from "./wrapperChain";

const AI_SHAPED_PATHS: readonly string[] = [
  "/v1/chat/completions",
  "/v1/completions",
  "/v1/responses",
  "/v1/embeddings",
  "/v1/messages",
  "/api/generate",
  "/api/chat",
  "/api/embeddings",
  "/generate_stream",
];

const DURATION_RING = 256;

export interface AiCallStats {
  callCount: number;
  providerCount: number;
  topProvider: number;
  failCount: number;
  declaredCalls: number;
  unclassifiedCalls: number;
  /** Whether RN's one JavaScript HTTP funnel is currently outside our watch. */
  unwatchedClients?: number;
  p75Ms?: number;
  worstMs?: number;
}

interface XhrLike {
  status?: number;
  open(method: string, url: string, ...rest: unknown[]): unknown;
  send(body?: unknown): unknown;
  addEventListener?: (name: string, listener: () => void) => void;
}

interface PendingCall {
  method: string;
  url: string;
}

let installedPrototype: Record<string, unknown> | null = null;
let originalOpen: ((this: XhrLike, ...args: unknown[]) => unknown) | null = null;
let originalSend: ((this: XhrLike, ...args: unknown[]) => unknown) | null = null;
let installedOpen: ((this: XhrLike, ...args: unknown[]) => unknown) | null = null;
let installedSend: ((this: XhrLike, ...args: unknown[]) => unknown) | null = null;
let observationArmed = false;
let ownApiHost = "www.boosthis.com";
let callCount = 0;
let failCount = 0;
let declaredCalls = 0;
let unclassifiedCalls = 0;
const providersSeen = new Set<number>();
const callsByProvider = new Map<number, number>();
const durations: number[] = [];
const pending = new WeakMap<object, PendingCall>();

function nowMs(): number {
  try {
    const p = (globalThis as { performance?: { now?: () => number } }).performance;
    if (typeof p?.now === "function") return p.now();
  } catch {
    /* fall through */
  }
  return Date.now();
}

function addressOf(raw: unknown): { host: string; path: string } | null {
  try {
    if (typeof raw !== "string") return null;
    const match = /^https?:\/\/([^/?#]+)([^?#]*)?(?:[?#].*)?$/i.exec(raw.trim());
    if (!match) return null;
    const host = normaliseDeclaredEndpoint(match[1]);
    if (!host) return null;
    let path = String(match[2] || "/").toLowerCase().replace(/\/+$/, "");
    if (!path) path = "/";
    return { host, path };
  } catch {
    return null;
  }
}

function pushDuration(ms: number): void {
  durations.push(Math.max(0, Math.round(ms)));
  if (durations.length > DURATION_RING) durations.shift();
}

function observeCompletion(xhr: XhrLike, startedAt: number): void {
  let filed = false;
  const finish = (failed: boolean) => {
    if (filed) return;
    filed = true;
    pushDuration(nowMs() - startedAt);
    if (failed) failCount++;
  };
  try {
    if (typeof xhr.addEventListener !== "function") return;
    xhr.addEventListener("load", () => {
      const status = Number(xhr.status);
      finish(!Number.isFinite(status) || status === 0 || status >= 400);
    });
    xhr.addEventListener("error", () => finish(true));
    xhr.addEventListener("timeout", () => finish(true));
    xhr.addEventListener("abort", () => finish(true));
  } catch {
    /* outcome stays unknown; the sent call is still real */
  }
}

function classifyAtSend(xhr: XhrLike, request: PendingCall): void {
  try {
    const address = addressOf(request.url);
    if (!address) return; // Relative URLs are the phone app's own backend shape.
    if (address.host === ownApiHost) return;
    const provider = aiProviderCodeOrDeclared(address.host);
    if (provider !== 0) {
      callCount++;
      providersSeen.add(provider);
      callsByProvider.set(provider, (callsByProvider.get(provider) ?? 0) + 1);
      if (provider === DECLARED_PROVIDER_CODE) declaredCalls++;
      observeCompletion(xhr, nowMs());
      return;
    }
    if (
      request.method.toUpperCase() === "POST" &&
      AI_SHAPED_PATHS.includes(address.path)
    ) {
      unclassifiedCalls++;
    }
  } catch {
    /* a meter must never disturb the app */
  }
}

export function setAiCallOwnEndpoint(endpoint: unknown): void {
  ownApiHost = normaliseDeclaredEndpoint(endpoint) ?? "www.boosthis.com";
}

export function installAiCallWatch(): boolean {
  try {
    // A switched-off kit never looked, so it has no blind-spot claim to make.
    if (isBoosthisDisabled()) return false;
    observationArmed = true;
    const Ctor = (globalThis as { XMLHttpRequest?: { prototype?: unknown } })
      .XMLHttpRequest;
    const proto = Ctor?.prototype as Record<string, unknown> | undefined;
    if (!proto) return false;
    if (installedPrototype === proto) {
      // Still installed means still IN THE CHAIN, not still the entry point:
      // the optional network wrapper sits on `send` over this one, and it
      // delegates unconditionally, so every request still reaches us.
      return (
        wrapperChainReaches(proto.open, installedOpen) &&
        wrapperChainReaches(proto.send, installedSend)
      );
    }
    if (installedPrototype) uninstallAiCallWatch(false);
    observationArmed = true;
    const open = proto.open;
    const send = proto.send;
    if (typeof open !== "function" || typeof send !== "function") return false;
    originalOpen = open as typeof originalOpen;
    originalSend = send as typeof originalSend;
    installedOpen = function (this: XhrLike, ...args: unknown[]) {
      try {
        pending.set(this as object, {
          method: String(args[0] ?? "GET"),
          url: String(args[1] ?? ""),
        });
      } catch {
        /* call through */
      }
      return originalOpen!.apply(this, args);
    };
    installedSend = function (this: XhrLike, ...args: unknown[]) {
      const request = pending.get(this as object);
      // A synchronous throw means XHR rejected the call before it left. File
      // only after the real send accepted it; RN's async XHR cannot complete
      // before this method returns.
      const result = originalSend!.apply(this, args);
      if (request) classifyAtSend(this, request);
      return result;
    };
    // Published as ours, with the function each one calls, so a wrapper of
    // ours installed over these can be walked THROUGH at read time instead
    // of reading as a stranger that may have switched us off.
    markBoosthisWrapper(installedOpen, originalOpen, "ai-calls");
    markBoosthisWrapper(installedSend, originalSend, "ai-calls");
    proto.open = installedOpen;
    proto.send = installedSend;
    installedPrototype = proto;
    return true;
  } catch {
    return false;
  }
}

export function uninstallAiCallWatch(clear = true): void {
  try {
    if (installedPrototype && originalOpen && originalSend) {
      installedPrototype.open = originalOpen;
      installedPrototype.send = originalSend;
    }
  } catch {
    /* best-effort restoration */
  }
  installedPrototype = null;
  originalOpen = null;
  originalSend = null;
  installedOpen = null;
  installedSend = null;
  observationArmed = false;
  if (clear) clearAiCalls();
}

/**
 * React Native has one JavaScript HTTP funnel: fetch and common client
 * libraries all issue through XMLHttpRequest. Count that funnel as watched
 * only while the exact prototype and wrappers installed above remain in place.
 *
 * Read-time identity checks matter: another library can restore or re-wrap
 * open/send after startup, making every later request invisible to this meter.
 * A count is returned only after observation was armed; names never leave.
 */
export function unwatchedAiClientCount(): number | undefined {
  if (!observationArmed) return undefined;
  try {
    if (isBoosthisDisabled()) return undefined;
  } catch {
    // If the kill-switch state itself cannot be read, make no coverage claim.
    return undefined;
  }
  try {
    const Ctor = (globalThis as { XMLHttpRequest?: { prototype?: unknown } })
      .XMLHttpRequest;
    const proto = Ctor?.prototype as Record<string, unknown> | undefined;
    return proto &&
      proto === installedPrototype &&
      wrapperChainReaches(proto.open, installedOpen) &&
      wrapperChainReaches(proto.send, installedSend)
      ? 0
      : 1;
  } catch {
    // Armed but unreadable is a blind funnel, never a reason to disturb host.
    return observationArmed ? 1 : undefined;
  }
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index]!;
}

export function getAiCallStats(): AiCallStats {
  let topProvider = 0;
  let topCalls = 0;
  for (const [provider, count] of callsByProvider) {
    if (count > topCalls) {
      topProvider = provider;
      topCalls = count;
    }
  }
  const unwatchedClients = unwatchedAiClientCount();
  return {
    callCount,
    providerCount: providersSeen.size,
    topProvider,
    failCount,
    declaredCalls,
    unclassifiedCalls,
    ...(unwatchedClients === undefined ? {} : { unwatchedClients }),
    ...(durations.length
      ? {
          p75Ms: percentile(durations, 75),
          worstMs: Math.max(...durations),
        }
      : {}),
  };
}

export function clearAiCalls(): void {
  callCount = 0;
  failCount = 0;
  declaredCalls = 0;
  unclassifiedCalls = 0;
  providersSeen.clear();
  callsByProvider.clear();
  durations.length = 0;
}

export const _aiCallInternals = {
  addressOf,
  shapedPaths: AI_SHAPED_PATHS,
};