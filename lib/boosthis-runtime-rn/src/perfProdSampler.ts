/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: production sampler ──────────────────────────────────────
 *
 * Ships per-screen perf samples to the api-server's /perf/sample
 * endpoint when running in a production build. Dev builds are silent
 * — Boosthis's in-app /dev/perf viewer covers them.
 *
 * Design choices, all explicit so we don't accidentally drift toward
 * Sentry-shaped vendor lock-in:
 *
 * 1. CUSTOM CODE, NO SDK. Plain fetch, plain JSON. The whole client
 *    is ~120 lines and lives in this repo. No external dependency,
 *    no telemetry going to a 3rd party.
 *
 * 2. SECURED INGEST. Every POST carries a Bearer token from
 *    EXPO_PUBLIC_BOOSTHIS_INGEST_TOKEN. Yes, EXPO_PUBLIC means the
 *    token is in the shipped bundle — that's an anti-abuse measure,
 *    NOT a privacy measure. The api-server should still validate
 *    payload shapes, rate-limit per-IP, and keep the token rotatable.
 *    Treat it like a public-key throttle, not a secret.
 *
 * 3. SAMPLED. SAMPLE_RATE=0.1 (10%) per screen mount by default.
 *    Tunable via EXPO_PUBLIC_BOOSTHIS_INGEST_RATE. Matches Sentry's
 *    "low traffic" recommendation; we're nowhere near needing 1%.
 *
 * 4. BATCHED. Samples buffer in memory; we POST at most every 30s
 *    OR when the buffer hits 50 entries. Keeps battery + bandwidth
 *    cost negligible.
 *
 * 5. NO PII. The sample shape is a fixed schema. The only metadata is a
 *    CLOSED bucket object (`SampleMetadata`) of coarse, privacy-safe
 *    enums — start-type and device-tier — never free-form keys, user IDs,
 *    or URLs other than the screen route name. If the schema below grows,
 *    audit it.
 */

import { Platform } from "react-native";
import { isRuntimeInert } from "./killSwitch";
import { _safeTransmitInternal } from "./transmit";
import { PIIDetectedError } from "./no-pii";
import { getBootKind, type BootKind } from "./perfBoot";
import { getDeviceTier, type DeviceTier } from "./deviceTier";

const INGEST_URL  = process.env.EXPO_PUBLIC_BOOSTHIS_INGEST_URL  || "";
const INGEST_TOKEN = process.env.EXPO_PUBLIC_BOOSTHIS_INGEST_TOKEN || "";
const SAMPLE_RATE = (() => {
  const raw = process.env.EXPO_PUBLIC_BOOSTHIS_INGEST_RATE;
  const n = raw ? Number(raw) : 0.1;
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.1;
})();
const APP_VERSION = process.env.EXPO_PUBLIC_APP_VERSION || "dev";

/**
 * Enabled when:
 *  - running in production (__DEV__ === false), AND
 *  - both ingest URL and token are configured.
 *
 * If you want to test the wire in dev, temporarily flip the __DEV__
 * check by setting EXPO_PUBLIC_BOOSTHIS_FORCE_PROD_SAMPLER=1.
 */
const FORCE = process.env.EXPO_PUBLIC_BOOSTHIS_FORCE_PROD_SAMPLER === "1";
// eslint-disable-next-line no-undef
const ENABLED: boolean = (FORCE || !__DEV__) && !!INGEST_URL && !!INGEST_TOKEN;

/**
 * Closed bucket object of coarse, privacy-safe dimensions attached to each
 * sample. NOT free-form — every key is a fixed enum. Audit this type if it
 * ever grows, and keep the new field names clear of the PII denylist.
 */
export interface SampleMetadata {
  /** App launch kind when the sample was recorded (cold/warm/hot/unknown). */
  startType?: BootKind;
  /** Coarse device capability bucket. Host-provided; "unknown" if unset. */
  deviceTier?: DeviceTier;
}

/**
 * What produced a per-screen reading. Kept on every sample so an app that
 * measures some screens by hand and lets the observer measure the rest can be
 * read apart, and a double count would be visible rather than invisible.
 */
export type ScreenReadingSource =
  /** The root navigation observer, with no per-screen code. */
  | "observer"
  /** A hand-placed call — `useBoosthis`, `usePhaseTracker`, or the host's own. */
  | "manual";

export interface PerfSample {
  /** ms timestamp of when the sample was created on device. */
  ts:        number;
  /** Random per-process session id — lets the server group samples
   *  from the same app run without ever seeing a user identifier. */
  sessionId: string;
  app:       string;     // "rival"
  os:        string;     // "ios" | "android" | "web"
  appVersion: string;
  screen:    string;
  ttffMs:    number | null;
  ttiMs:     number | null;
  fidMs:     number | null;
  score:     number;     // 0-100
  rating:    "good" | "needs-work" | "poor" | "insufficient-data";
  /** Which path produced this reading — an observer, or a hand-placed call. */
  source:    ScreenReadingSource;
  /** Closed bucket object of coarse, privacy-safe dimensions. */
  metadata?: SampleMetadata;
}

const SESSION_ID = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * Explicit opt-in gate. Off by default — must be enabled by calling
 * `setProdSamplerConsent(true)` from `enableTelemetry()`. This ensures
 * the sampler only runs when the host app has actively opted in to
 * telemetry, matching the documented privacy contract.
 */
let consentGranted = false;

/**
 * Called by `enableTelemetry()` to grant or revoke consent for the
 * production sampler. When consent is false the sampler is a no-op
 * even if EXPO_PUBLIC_BOOSTHIS_INGEST_URL/TOKEN are configured.
 */
export function setProdSamplerConsent(granted: boolean): void {
  consentGranted = granted;
  // If consent was just revoked, drop any buffered samples immediately
  // so they cannot be flushed by a pending timer.
  if (!granted) {
    buf.length = 0;
  }
}

const buf: PerfSample[] = [];
const FLUSH_MS    = 30_000;
const FLUSH_AT    = 50;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_MS);
}

async function flush() {
  if (flushing || buf.length === 0) return;
  // Honour the global kill-switch and consent gate at flush time.
  // If either has been revoked since samples were buffered, drop them
  // silently — they must not leave the device.
  if (!consentGranted || isRuntimeInert()) {
    buf.length = 0;
    return;
  }
  flushing = true;
  // Drain the buffer up-front so concurrent recordSample() calls keep
  // landing in a fresh buffer while this POST is in flight.
  const batch = buf.splice(0, buf.length);
  // Re-queue helper: only ever puts samples back when the privacy
  // gates are still open. Closes the architect-flagged race where a
  // failed-flush requeue would resurrect pre-revoke samples if consent
  // or the kill-switch was flipped while the request was in flight.
  const requeueIfStillAllowed = () => {
    if (!consentGranted || isRuntimeInert()) return;
    if (buf.length < 200) buf.unshift(...batch.slice(-Math.min(50, batch.length)));
    scheduleFlush();
  };
  try {
    const res = await _safeTransmitInternal(
      INGEST_URL,
      { samples: batch },
      {},
      `Bearer ${INGEST_TOKEN}`,
    );
    if (!res.ok) {
      requeueIfStillAllowed();
    }
  } catch (err) {
    // PIIDetectedError means a screen label carried PII. Drop the
    // entire batch immediately — do NOT re-queue, as retrying would
    // just send the same PII again. Let the error propagate naturally
    // in dev/test environments; in production it is swallowed below.
    if (err instanceof PIIDetectedError) {
      return;
    }
    requeueIfStillAllowed();
  } finally {
    flushing = false;
  }
}

export interface RecordSampleInput {
  screen: string;
  ttffMs: number | null;
  ttiMs:  number | null;
  fidMs:  number | null;
  score:  number;
  rating: PerfSample["rating"];
  /** Where this reading came from. A caller that does not say is a
   *  hand-placed call by definition — only the kit's own observer is
   *  automatic, and it always says so. */
  source?: ScreenReadingSource;
}

/**
 * Decide-then-buffer. Returns true if the sample was buffered (so
 * callers can log a debug line if they want).
 */
export function recordProdSample(input: RecordSampleInput): boolean {
  if (!ENABLED) return false;
  // Consent must have been granted via enableTelemetry() — off by default.
  if (!consentGranted) return false;
  // Re-check the kill-switch on every call so runtime toggling is honoured.
  // isRuntimeInert() also covers the server-authority entitlement kill.
  if (isRuntimeInert()) return false;
  if (Math.random() >= SAMPLE_RATE) return false;
  buf.push({
    ts:         Date.now(),
    sessionId:  SESSION_ID,
    app:        "rival",
    os:         Platform.OS,
    appVersion: APP_VERSION,
    screen:     input.screen,
    ttffMs:     input.ttffMs,
    ttiMs:      input.ttiMs,
    fidMs:      input.fidMs,
    score:      input.score,
    rating:     input.rating,
    source:     input.source === "observer" ? "observer" : "manual",
    metadata: {
      startType:  getBootKind(),
      deviceTier: getDeviceTier(),
    },
  });
  if (buf.length >= FLUSH_AT) {
    void flush();
  } else {
    scheduleFlush();
  }
  return true;
}

/** Force-flush on app background / explicit dev call. */
export function flushProdSamples(): Promise<void> {
  return flush();
}

/** Introspection helpers for tests + the dev viewer. */
export const _prodSamplerInternals = {
  enabled: () => ENABLED,
  bufferedCount: () => buf.length,
  sessionId: () => SESSION_ID,
  sampleRate: () => SAMPLE_RATE,
};
