/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * Boosthis platform adapter.
 *
 * Boosthis's diagnostic engine (perfMonitor + perfDiagnose) is pure
 * data + math over event rows — but the COLLECTION layer touches
 * three host primitives that differ between runtimes:
 *
 *   1. Persistence (AsyncStorage on RN; localStorage on web; an
 *      in-memory map for unit tests / SSR).
 *   2. JS heap reading (HermesInternal on RN; performance.memory on
 *      Chromium-based browsers; null elsewhere).
 *   3. High-resolution clock (performance.now() everywhere modern;
 *      Date.now() as a last-resort fallback).
 *
 * Routing all three through this small adapter is what makes Boosthis
 * portable to React web, Node, Electron, etc. without any changes
 * to the engine code. See the changelog at the top of perfDiagnose.ts
 * for the full motivation.
 */

export interface PerfStorage {
  get(key: string):              Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string):           Promise<void>;
  /**
   * Does this store KEEP what it is given across process restarts?
   *
   * `true` for AsyncStorage / localStorage, `false` for the in-memory safety
   * net. Optional, and left UNDEFINED by a host-supplied adapter that does not
   * say — callers that accumulate state across launches report "unknown"
   * rather than guessing on the host's behalf.
   */
  persistent?: boolean;
}

export interface PerfPlatform {
  /** Persistence — must be safe to call from anywhere. */
  storage:      PerfStorage;
  /**
   * Current JS heap usage in MB, or null when the runtime doesn't
   * expose it. Heap is best-effort everywhere; the diagnoser
   * gracefully treats null as "no heap signal".
   */
  heapMb():     number | null;
  /** Monotonic clock in ms. Used for frame deltas and event timing. */
  now():        number;
  /** Stable name of the host runtime, e.g. "ios" / "android" / "web". */
  platformName: string;
}

/* ─── Default adapter (auto-detects RN-Hermes vs web) ──────────── */

const memoryFallback: PerfStorage = (() => {
  // Test / SSR safety net: if neither AsyncStorage nor localStorage
  // is available, keep an in-memory map so callers don't crash.
  const m = new Map<string, string>();
  return {
    get:    async (k) => (m.has(k) ? m.get(k)! : null),
    set:    async (k, v) => { m.set(k, v); },
    remove: async (k) => { m.delete(k); },
    // Nothing here survives the process — callers must be able to SAY that.
    persistent: false,
  };
})();

function detectStorage(): PerfStorage {
  // 1. React Native — AsyncStorage. We require it lazily so a web
  //    bundle that doesn't install @react-native-async-storage
  //    still works.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@react-native-async-storage/async-storage");
    const AsyncStorage = mod?.default ?? mod;
    if (AsyncStorage?.getItem) {
      return {
        get:    (k) => AsyncStorage.getItem(k),
        set:    (k, v) => AsyncStorage.setItem(k, v),
        remove: (k) => AsyncStorage.removeItem(k),
        persistent: true,
      };
    }
  } catch {
    // not in an RN runtime — fall through to web
  }
  // 2. Web — localStorage wrapped to a Promise interface.
  const ls = (globalThis as unknown as { localStorage?: Storage }).localStorage;
  if (ls?.getItem) {
    return {
      get:    async (k) => ls.getItem(k),
      set:    async (k, v) => { ls.setItem(k, v); },
      remove: async (k) => { ls.removeItem(k); },
      persistent: true,
    };
  }
  // 3. Nothing available — stay alive with an in-memory map.
  return memoryFallback;
}

function detectHeapReader(): () => number | null {
  return () => {
    try {
      // Hermes (React Native default). getInstrumentedStats is
      // available in dev when GCEnableInstrumentedStats is on.
      const hermes = (globalThis as unknown as {
        HermesInternal?: { getInstrumentedStats?: () => Record<string, number> };
      }).HermesInternal;
      const stats  = hermes?.getInstrumentedStats?.();
      const bytes  = stats?.js_allocatedBytes ?? stats?.js_heapSize;
      if (typeof bytes === "number") return bytes / (1024 * 1024);
    } catch {
      // fall through
    }
    // Chromium-based browsers expose performance.memory.
    const mem = (globalThis as unknown as {
      performance?: { memory?: { usedJSHeapSize?: number } };
    }).performance?.memory;
    if (typeof mem?.usedJSHeapSize === "number") {
      return mem.usedJSHeapSize / (1024 * 1024);
    }
    return null;
  };
}

function detectPlatformName(): string {
  // React Native exposes Platform.OS — try first.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require("react-native");
    if (rn?.Platform?.OS) return String(rn.Platform.OS);
  } catch {}
  // Browser / Node fallback.
  if (typeof (globalThis as unknown as { document?: object }).document !== "undefined") return "web";
  if (typeof (globalThis as unknown as { process?: { versions?: { node?: string } } }).process?.versions?.node === "string") return "node";
  return "unknown";
}

/**
 * Best-effort detection of the host app's own display name so the dashboard
 * shows a friendly name (e.g. "Rival") instead of a churny per-build install
 * id. Purely optional: it lazily requires Expo's own metadata modules (mirror
 * of the `require(...)` pattern used above), returns `undefined` outside Expo
 * (bare RN, web, tests), and never throws. The returned value is the app's
 * public product name — not PII — but the caller still clamps + PII-screens it
 * before it leaves the device, so auto-detection can NEVER break registration.
 */
export function detectAppName(): string | undefined {
  // 1. expo-constants — the JS-config name (app.json / app.config.*).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-constants");
    const Constants = mod?.default ?? mod;
    const name =
      Constants?.expoConfig?.name ??
      Constants?.manifest2?.extra?.expoClient?.name ??
      Constants?.manifest?.name;
    if (typeof name === "string" && name.trim()) return name.trim();
  } catch {
    // expo-constants not installed — fall through
  }
  // 2. expo-application — the native app display name.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-application");
    const Application = mod?.default ?? mod;
    const name = Application?.applicationName;
    if (typeof name === "string" && name.trim()) return name.trim();
  } catch {
    // expo-application not installed — fall through
  }
  return undefined;
}

/**
 * THE HOST APP'S OWN VERSION, read out of the build rather than asked for.
 *
 * `packageVersion` on every registration this kit has ever sent is the
 * BOOSTHIS KIT's version. The app's own version was never on the wire at all,
 * so a project's release history was empty, a release comparison had nothing
 * to compare, and every surface that showed "the version" was showing one of
 * our releases to somebody looking for one of theirs.
 *
 * Nobody has to declare anything for this to work, which is the whole point:
 * a version that needs remembering is a version that will be wrong. It is read
 * in the order a native build is authoritative:
 *
 *   1. `expo-application.nativeApplicationVersion` — the value actually baked
 *      into the shipped binary: `CFBundleShortVersionString` on iOS,
 *      `versionName` on Android. This is the number the store shows and the
 *      number a person reads off the about screen.
 *   2. `expo-constants.expoConfig.version` — the app config's own `version`,
 *      which is what a managed build puts into the two fields above. Used when
 *      `expo-application` is not installed, and correct for an app whose
 *      JavaScript was updated over the air ahead of its binary.
 *
 * Never throws, never requires either module to be present, and returns
 * `undefined` outside Expo (bare React Native without these packages, web,
 * tests) rather than guessing. An absent answer is reported as an absence:
 * this kit does not fall back to its own version, because putting our version
 * in the customer's field is the exact confusion the reading exists to end.
 */
export function detectAppVersion(): string | undefined {
  // 1. expo-application — the native build's own version string.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-application");
    const Application = mod?.default ?? mod;
    const version = Application?.nativeApplicationVersion;
    if (typeof version === "string" && version.trim()) return version.trim();
  } catch {
    // expo-application not installed — fall through
  }
  // 2. expo-constants — the app config the build was made from.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-constants");
    const Constants = mod?.default ?? mod;
    const version =
      Constants?.expoConfig?.version ??
      Constants?.manifest2?.extra?.expoClient?.version ??
      Constants?.manifest?.version;
    if (typeof version === "string" && version.trim()) return version.trim();
  } catch {
    // expo-constants not installed — fall through
  }
  return undefined;
}

const defaultPlatform: PerfPlatform = {
  storage:      detectStorage(),
  heapMb:       detectHeapReader(),
  now:          () => {
    const p = (globalThis as unknown as { performance?: { now?: () => number } }).performance;
    return typeof p?.now === "function" ? p.now() : Date.now();
  },
  platformName: detectPlatformName(),
};

let active: PerfPlatform = defaultPlatform;

/** Read the active platform adapter. Used internally by perfMonitor. */
export const platform = (): PerfPlatform => active;

/**
 * Override the platform adapter — for tests, for embedding Boosthis in
 * a non-RN/non-web host, or for routing storage through a custom
 * backend (e.g. file system, IndexedDB, SQLite).
 *
 * Pass `null` to restore the auto-detected default.
 */
export function setPerfPlatform(p: PerfPlatform | null): void {
  active = p ?? defaultPlatform;
}
