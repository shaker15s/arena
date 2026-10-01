/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/** Find the app's navigation container instead of being handed it.
 *
 * The kit has always accepted a container: `<BoosthisNavigationObserver
 * container={navigationRef} />`. That still works and still wins. But an app
 * that followed the setup guide and stopped there has no reason to have wired
 * it, and the screens it moves between are the most legible thing about it.
 *
 * WHAT WE DO NOT DO: `require("@react-navigation/native")`. Metro resolves
 * every require in the bundle statically, so a kit that reaches for a package
 * the app does not have fails the BUILD of every app that does not use it.
 * A kit cannot make its host depend on a navigation library to switch on a
 * measurement.
 *
 * So the seam is a global the navigation library itself writes to.
 * React Navigation registers each container it mounts on
 * `global.REACT_NAVIGATION_DEVTOOLS`, a WeakMap keyed by the container ref.
 * A WeakMap cannot be enumerated, so reading it is useless — but replacing it
 * with an object that FORWARDS to the real one and tells us the key on the way
 * past is enough, and it leaves the library's own behaviour untouched. Expo
 * Router is React Navigation underneath and mounts the same container, so the
 * same seam answers for both.
 *
 * When nothing answers, that is a recognised outcome and the status says so:
 * the circuit then draws from whatever screen-change signal the app does feed
 * the kit, and from nothing if it feeds none.
 */

/** How the container was found. */
export type NavDetectSeam =
  /** The navigation library registered it with its own devtools global. */
  | "devtools-hook"
  /** The app handed it to us (the mounted observer, or the global below). */
  | "handed-over"
  /** Nothing was found; no container is being watched. */
  | "none";

/** What we recognised the container as, if anything. */
export type NavDetectLibrary = "react-navigation" | "unknown";

export interface NavDetectResult {
  seam: NavDetectSeam;
  library: NavDetectLibrary;
}

/** An app with no navigation library, or one we do not recognise, can still
 *  put its container here before starting the kit. */
const HANDOVER_GLOBAL = "__BOOSTHIS_NAV_CONTAINER__";
const DEVTOOLS_GLOBAL = "REACT_NAVIGATION_DEVTOOLS";

/** Does this object behave like a React Navigation container ref? Duck-typed,
 *  never `instanceof` — the kit and the app may hold different copies. */
export function looksLikeNavigationContainer(value: unknown): boolean {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return false;
  }
  const c = value as Record<string, unknown>;
  return (
    typeof c.addListener === "function" &&
    (typeof c.getCurrentRoute === "function" ||
      typeof c.getRootState === "function")
  );
}

type Found = (container: unknown, result: NavDetectResult) => void;

/* ─── Remembering what was registered, from the moment we load ──────────── */

/*
 * The registration we need has usually ALREADY happened.
 *
 * `enableTelemetry()` is typically called from an effect at the app root, and
 * an effect runs after the tree below it has mounted — so by the time the
 * switch is thrown, the navigation container has been created and registered,
 * and the WeakMap it was registered in cannot be enumerated. A watcher
 * installed at that point sees nothing, for ever, in the commonest wiring
 * there is.
 *
 * So the pass-through goes in when this module loads, which is when the kit is
 * imported — before the app renders anything. It remembers the last container
 * the navigation library registered and does NOTHING else with it: no
 * listener, no route read, no span, nothing on any wire. The registry keeps
 * behaving exactly as the library's own WeakMap does, and until the developer
 * switches the circuit on, the only difference is a reference held in this
 * module. `screenCircuit.test.ts` holds that claim: with the switch off, a
 * container registered here has neither of its methods called.
 *
 * It is installed as an accessor so that it survives the library's own
 * `globalThis.REACT_NAVIGATION_DEVTOOLS = new WeakMap()` at ITS module load,
 * whichever of us is imported first — an assignment is wrapped rather than
 * clobbering the wrapper.
 */

interface ContainerRef {
  deref(): unknown;
}

function holdWeakly(value: object): ContainerRef {
  const WeakRefCtor = (globalThis as { WeakRef?: new (o: object) => ContainerRef })
    .WeakRef;
  if (typeof WeakRefCtor === "function") return new WeakRefCtor(value);
  // An engine without WeakRef keeps one strong reference to one container.
  return { deref: () => value };
}

/** The container the navigation library registered most recently. */
let remembered: ContainerRef | null = null;
/** Set while somebody is waiting to be told about the next one. */
let listener: Found | null = null;
/** Undo the pass-through — tests only; a shipped app never takes it out. */
let uninstall: (() => void) | null = null;

function announce(container: unknown): void {
  const cb = listener;
  if (!cb) return;
  try {
    cb(container, { seam: "devtools-hook", library: "react-navigation" });
  } catch {
    // never break the host
  }
}

/** One registration, seen on its way into the library's own registry. */
function noteRegistered(key: unknown): void {
  try {
    if (!looksLikeNavigationContainer(key)) return;
    remembered = holdWeakly(key as object);
    announce(key);
  } catch {
    // ignore
  }
}

type RegistryLike = {
  set?: (k: object, v: unknown) => unknown;
  get?: (k: object) => unknown;
  delete?: (k: object) => unknown;
  has?: (k: object) => unknown;
};

/** Wrap a registry so every registration is seen on the way past. Already-
 *  wrapped registries are handed back as they are. */
function wrapRegistry(value: unknown): RegistryLike {
  const real: RegistryLike =
    value && typeof (value as RegistryLike).set === "function"
      ? (value as RegistryLike)
      : (new WeakMap() as unknown as RegistryLike);
  if ((real as { __boosthisWatched?: boolean }).__boosthisWatched === true) {
    return real;
  }
  const wrapper: RegistryLike & { __boosthisWatched: boolean } = {
    __boosthisWatched: true,
    set(key: object, value2: unknown) {
      noteRegistered(key);
      return real.set ? real.set(key, value2) : undefined;
    },
    get(key: object) {
      return real.get ? real.get(key) : undefined;
    },
    delete(key: object) {
      return real.delete ? real.delete(key) : false;
    },
    has(key: object) {
      return real.has ? real.has(key) : false;
    },
  };
  return wrapper;
}

/** Put the pass-through in place. Idempotent, and never throws: a frozen or
 *  non-configurable global leaves the app exactly as it is. */
export function rememberNavigationContainers(): void {
  if (uninstall) return;
  try {
    const g = globalThis as unknown as Record<string, unknown>;
    let current: unknown = wrapRegistry(g[DEVTOOLS_GLOBAL]);
    const original = g[DEVTOOLS_GLOBAL];
    Object.defineProperty(g, DEVTOOLS_GLOBAL, {
      configurable: true,
      enumerable: true,
      get: () => current,
      // The navigation library assigns a fresh WeakMap when ITS module loads.
      // Wrapping that assignment is the whole reason this is an accessor.
      set: (value: unknown) => {
        current = wrapRegistry(value);
      },
    });
    uninstall = () => {
      try {
        delete g[DEVTOOLS_GLOBAL];
        if (original !== undefined) g[DEVTOOLS_GLOBAL] = original;
      } catch {
        // ignore
      }
      uninstall = null;
    };
  } catch {
    // A global we may not redefine: nothing installed, nothing broken, and
    // detection falls back to whatever the app hands over.
  }
}

// Remembered from load, for the reasons above.
rememberNavigationContainers();

let restore: (() => void) | null = null;

/**
 * Watch for a navigation container, calling back the first time one appears.
 *
 * Returns a stop function. Never throws: an app whose globals are frozen, or
 * whose navigation library is something we have never seen, behaves exactly as
 * it does today and the circuit reports that nothing answered.
 */
export function detectNavigationContainer(onFound: Found): () => void {
  stopDetectingNavigationContainer();
  let done = false;
  const answer = (container: unknown, result: NavDetectResult): void => {
    if (done) return;
    done = true;
    try {
      onFound(container, result);
    } catch {
      // never break the host
    }
  };

  const g = globalThis as unknown as Record<string, unknown>;

  // 1. Already handed over, before we even started.
  try {
    const handed = g[HANDOVER_GLOBAL];
    if (looksLikeNavigationContainer(handed)) {
      answer(handed, { seam: "handed-over", library: "react-navigation" });
      return () => {};
    }
  } catch {
    // ignore
  }

  // 2. A container the navigation library ALREADY registered. The pass-
  //    through above has been remembering registrations since the kit was
  //    imported, so the usual case — a container mounted by the app's tree
  //    before an effect called `enableTelemetry()` — is answered here and
  //    now, rather than waiting for a second registration that never comes.
  try {
    rememberNavigationContainers();
    const already = remembered?.deref();
    if (looksLikeNavigationContainer(already)) {
      answer(already, { seam: "devtools-hook", library: "react-navigation" });
      return () => stopDetectingNavigationContainer();
    }
  } catch {
    // ignore
  }

  // 3. Nothing yet: be told about the next registration.
  listener = (container, result) => answer(container, result);
  restore = () => {
    listener = null;
    restore = null;
  };

  return () => stopDetectingNavigationContainer();
}

/** Stop waiting to be told about the next container. The pass-through itself
 *  stays where it is: taking it out would put the app back in the state this
 *  module exists to avoid, and it costs nothing to leave. */
export function stopDetectingNavigationContainer(): void {
  try {
    restore?.();
  } catch {
    // ignore
  }
  restore = null;
  listener = null;
}

/** @internal test hook. */
export const _navDetectInternals = {
  handoverGlobal: HANDOVER_GLOBAL,
  devtoolsGlobal: DEVTOOLS_GLOBAL,
  isWatching: (): boolean => listener !== null,
  isRemembering: (): boolean => uninstall !== null,
  rememberedContainer: (): unknown => remembered?.deref() ?? null,
  forgetRemembered: (): void => {
    remembered = null;
  },
  /** Take the pass-through out, so a test can prove what a kit that never
   *  installed one would do. */
  uninstallRecorder: (): void => {
    try {
      uninstall?.();
    } catch {
      // ignore
    }
    uninstall = null;
    remembered = null;
  },
};
