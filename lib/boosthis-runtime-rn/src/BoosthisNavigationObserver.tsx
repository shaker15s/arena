/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: <BoosthisNavigationObserver> ───────────────────────────
 *
 * ONE integration at the app root makes every screen change name itself and
 * produce an edge. No per-screen work, no `useBoosthis(name)` on every screen,
 * no `beginNav(from, to)` before every push.
 *
 * React Navigation — hand it the container ref you already have:
 *
 *   const navRef = useNavigationContainerRef();
 *   <NavigationContainer ref={navRef}>
 *     …
 *     <BoosthisNavigationObserver container={navRef} />
 *   </NavigationContainer>
 *
 * expo-router (or any router that can tell you the current path) — hand it
 * the path from your root layout:
 *
 *   <BoosthisNavigationObserver route={usePathname()} />
 *
 * Both props are optional and both may be passed. It renders NOTHING and adds
 * NO dependency on any navigation library: a project without one, or with an
 * unfamiliar one, builds and runs unchanged — the component simply records
 * nothing and the app behaves exactly as it does today.
 *
 * The map it draws stays on-device (see `pageMap.ts`). Nothing new goes on
 * the wire because this is mounted.
 */
import { useEffect, useRef } from "react";
import {
  attachNavigationObserver,
  attachRouteSource,
  noteScreenChange,
} from "./navObserver";
import { hydrateScreenMap } from "./pageMap";

/** How long to keep waiting for a container ref that is not populated yet. */
const REF_RETRY_MS = 300;
const REF_RETRY_ATTEMPTS = 6;

export interface BoosthisNavigationObserverProps {
  /**
   * A navigation container, or a ref to one. Recognised by shape, never by
   * import — anything the observer does not know how to read is ignored.
   */
  container?: unknown;
  /**
   * The current route/path from a router that exposes it as a value
   * (expo-router's `usePathname()`, a custom router's current path). Each new
   * value is one observed screen change.
   */
  route?: string | null;
}

export function BoosthisNavigationObserver({
  container,
  route,
}: BoosthisNavigationObserverProps) {
  const detachRef = useRef<null | (() => void)>(null);

  // Container path: subscribe once the ref is populated. A ref rendered above
  // its container is briefly null, so we retry a BOUNDED number of times and
  // then give up quietly rather than polling forever.
  useEffect(() => {
    if (container == null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const tryAttach = (): void => {
      if (cancelled) return;
      try {
        const resolved =
          container &&
          typeof container === "object" &&
          "current" in (container as Record<string, unknown>)
            ? (container as { current: unknown }).current
            : container;
        if (resolved == null && attempts < REF_RETRY_ATTEMPTS) {
          attempts++;
          timer = setTimeout(tryAttach, REF_RETRY_MS);
          return;
        }
        detachRef.current = attachNavigationObserver(container);
      } catch {
        // an unfamiliar router degrades to today's behaviour
      }
    };
    tryAttach();

    return () => {
      cancelled = true;
      if (timer) {
        try {
          clearTimeout(timer);
        } catch {
          // ignore
        }
      }
      try {
        detachRef.current?.();
      } catch {
        // ignore
      }
      detachRef.current = null;
    };
  }, [container]);

  // Value path, ownership: a mount that passes a `route` prop at all is
  // watching the router's value for as long as it is mounted. The claim is
  // held for the LIFETIME of the mount, not per route change, so unmounting
  // returns the status to "nothing is drawing the map" — and a second mounted
  // observer keeps its own claim rather than being switched off by this one.
  const usesRoute = route !== undefined;
  useEffect(() => {
    if (!usesRoute) return;
    const release = attachRouteSource();
    return () => {
      try {
        release();
      } catch {
        // ignore
      }
    };
  }, [usesRoute]);

  // Value path: every distinct route string is one screen change.
  useEffect(() => {
    if (typeof route !== "string" || route.length === 0) return;
    void hydrateScreenMap();
    noteScreenChange(route);
  }, [route]);

  return null;
}
