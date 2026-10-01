/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/** Which project key does THIS runtime report under?
 *
 * ─── The problem this exists to solve ────────────────────────────────────
 * A codebase usually holds ONE Boosthis project key, wired once and read by
 * whatever kit is installed. That is fine while a codebase runs one runtime.
 * The moment a phone app is added to a codebase whose back end already
 * reports under an older key, the phone app silently inherits that key: it
 * registers as part of the OLD project, the developer's NEW key shows nothing,
 * and no surface anywhere says why. Rotating the old key would be the wrong
 * cure — these are two genuinely separate projects that happen to live in one
 * repository.
 *
 * ─── The convention (shared by every Boosthis kit) ───────────────────────
 * A per-language key always beats the shared one, because naming a runtime is
 * strictly more specific than not naming it:
 *
 *   1. host override      globalThis.__BOOSTHIS_PROJECT_KEY_RN__
 *   2. per-language env   EXPO_PUBLIC_BOOSTHIS_PROJECT_KEY_RN
 *                         BOOSTHIS_PROJECT_KEY_RN
 *   3. code               enableTelemetry({ inviteKey })
 *   4. per-language file  boosthis.config.json → ingest.projectKeys.rn
 *   5. shared file        boosthis.config.json → ingest.inviteKey
 *
 * (1) and (2) are the levers that need NO app-code edit, which is the whole
 * point: an app already passing the shared key in code can be moved onto its
 * own project key from outside, by the person doing the setup.
 *
 * The runtime deliberately does NOT read a SHARED environment variable. The
 * shared key must be passed in code or come from the project config file —
 * inheriting a shared env var is precisely the silent conflation above.
 *
 * Nothing here ever logs, transmits, or displays a whole key: only a masked
 * tail (last four characters) for the in-app panel, so a developer can tell
 * two keys apart without the key itself being readable off a screen.
 */

import { warnProjectKeyRefused } from "./startAnnounce";

/** The runtime name this kit registers under (server-side vocabulary). */
export const RN_RUNTIME_NAME = "rn";

export type ProjectKeySource =
  /** globalThis.__BOOSTHIS_PROJECT_KEY_RN__ */
  | "host-override"
  /** EXPO_PUBLIC_BOOSTHIS_PROJECT_KEY_RN / BOOSTHIS_PROJECT_KEY_RN */
  | "env-override"
  /** enableTelemetry({ inviteKey }) */
  | "code"
  /** boosthis.config.json → ingest.projectKeys.rn */
  | "config-runtime"
  /** boosthis.config.json → ingest.inviteKey */
  | "config-shared"
  /** nothing configured anywhere */
  | "none"
  /** explicitly configured to remain local-only */
  | "declined";

export interface ResolvedProjectKey {
  /** The key that will actually be sent, or null when none is configured. */
  key: string | null;
  /** Where it came from — shown in the in-app panel so the answer is never a
   *  guess. */
  source: ProjectKeySource;
  /** True when a React-Native-specific key replaced a DIFFERENT key the app
   *  supplied in code or in the shared config entry. The kit says this out
   *  loud once at startup: a silent override would be the same class of bug
   *  as the silent inheritance it fixes. */
  overrodeShared: boolean;
  /** Masked tail, e.g. "…4f2a". Never the whole key. Null when no key. */
  display: string | null;
  declined: boolean;
}

function noKeyRequested(): boolean {
  try {
    if (typeof process === "undefined" || !process.env) return false;
    return new Set(["1", "true", "yes", "on"]).has(
      String(process.env.BOOSTHIS_NO_PROJECT_KEY ?? "").trim().toLowerCase(),
    );
  } catch {
    return false;
  }
}

/** Shape of the parts of `boosthis.config.json` this resolver reads. */
export interface ProjectKeyConfig {
  ingest?: {
    inviteKey?: string | null;
    /** Per-language keys, keyed by runtime name ("rn", "node", "py", …). */
    projectKeys?: Record<string, string | null | undefined> | null;
  } | null;
}

function trimmed(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/** Trim a supplied value, and REFUSE (never silently repair) one that cannot
 *  be a project key — naming, once, the setting it came from. A refused value
 *  resolves to "no key", exactly as if none had been given. */
function clean(value: unknown, source: string): string | null {
  const value2 = trimmed(value);
  if (value2 === null) return null;
  if (warnProjectKeyRefused(value2, source)) return null;
  return value2;
}

/** Per-language override from the environment.
 *
 *  The two `process.env.…` reads are written out LONGHAND on purpose: Expo's
 *  bundler only inlines a literal `process.env.EXPO_PUBLIC_*` member
 *  expression, so a dynamic lookup would silently resolve to nothing in a
 *  release build. Both are guarded because plenty of React Native hosts have
 *  no `process` at all. */
function envOverride(): string | null {
  try {
    if (typeof process !== "undefined" && process.env) {
      const fromExpo = clean(process.env.EXPO_PUBLIC_BOOSTHIS_PROJECT_KEY_RN, "EXPO_PUBLIC_BOOSTHIS_PROJECT_KEY_RN");
      if (fromExpo) return fromExpo;
      const plain = clean(process.env.BOOSTHIS_PROJECT_KEY_RN, "BOOSTHIS_PROJECT_KEY_RN");
      if (plain) return plain;
    }
  } catch {
    /* a host that throws on env access must not break registration */
  }
  return null;
}

/** Host override — set before the kit is imported, e.g. from a dev screen or
 *  a native config bridge. */
function hostOverride(): string | null {
  const g = globalThis as unknown as {
    __BOOSTHIS_PROJECT_KEY_RN__?: unknown;
  };
  return clean(g.__BOOSTHIS_PROJECT_KEY_RN__, "__BOOSTHIS_PROJECT_KEY_RN__");
}

/** Mask a key for display: the last four characters only. Short/odd values
 *  render as "set" rather than exposing most of a short key. */
export function maskProjectKey(key: string | null | undefined): string | null {
  const k = trimmed(key);
  if (!k) return null;
  return k.length >= 8 ? `…${k.slice(-4)}` : "set";
}

/**
 * Resolve the project key for this runtime, with the full story of where it
 * came from.
 *
 * @param explicit the key passed in code (`enableTelemetry({ inviteKey })`)
 * @param config   the parsed `boosthis.config.json`, when the caller has it
 */
export function resolveProjectKeyDetailed(
  explicit?: string | null,
  config?: ProjectKeyConfig | null,
): ResolvedProjectKey {
  const inCode = clean(explicit, "the key passed in code");
  const perLanguageFile = clean(
    config?.ingest?.projectKeys?.[RN_RUNTIME_NAME],
    "boosthis.config.json (ingest.projectKeys.rn)",
  );
  const shared = clean(
    config?.ingest?.inviteKey,
    "boosthis.config.json (ingest.inviteKey)",
  );

  const host = hostOverride();
  const env = host ? null : envOverride();
  const override = host ?? env;

  if (override) {
    // Only call it an override when it actually replaces a DIFFERENT key the
    // app had supplied — re-stating the same key is not a change worth a line.
    const replaced = inCode ?? perLanguageFile ?? shared;
    return {
      key: override,
      source: host ? "host-override" : "env-override",
      overrodeShared: !!replaced && replaced !== override,
      display: maskProjectKey(override),
      declined: false,
    };
  }
  if (inCode) {
    return {
      key: inCode,
      source: "code",
      overrodeShared: false,
      display: maskProjectKey(inCode),
      declined: false,
    };
  }
  if (perLanguageFile) {
    return {
      key: perLanguageFile,
      source: "config-runtime",
      overrodeShared: !!shared && shared !== perLanguageFile,
      display: maskProjectKey(perLanguageFile),
      declined: false,
    };
  }
  if (shared) {
    return {
      key: shared,
      source: "config-shared",
      overrodeShared: false,
      display: maskProjectKey(shared),
      declined: false,
    };
  }
  const declined = noKeyRequested();
  return { key: null, source: declined ? "declined" : "none", overrodeShared: false, display: null, declined };
}

/**
 * The one-liner the generated wiring uses:
 *
 * ```ts
 * import boosthisConfig from "./boosthis.config.json";
 * enableTelemetry({ inviteKey: resolveProjectKey(boosthisConfig), … });
 * ```
 *
 * Returns `undefined` (not null) when nothing is configured, so it can be
 * spread straight into the options object.
 */
export function resolveProjectKey(
  config?: ProjectKeyConfig | null,
  explicit?: string | null,
): string | undefined {
  return resolveProjectKeyDetailed(explicit, config).key ?? undefined;
}

/** One-line, plain-English sentence naming where the key came from. Used by
 *  the in-app panel and the startup honesty line. Never contains the key. */
export function describeProjectKeySource(resolved: ResolvedProjectKey): string {
  switch (resolved.source) {
    case "host-override":
      return "React Native key set by this app at runtime";
    case "env-override":
      return "React Native key from the environment";
    case "code":
      return "key passed in code";
    case "config-runtime":
      return "React Native key from boosthis.config.json";
    case "config-shared":
      return "shared key from boosthis.config.json";
    case "none":
      return "no project key configured";
    case "declined":
      return "running with no project key on purpose";
  }
}
