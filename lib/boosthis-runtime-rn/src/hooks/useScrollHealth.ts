/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: useScrollHealth ────────────────────────────────────────
 *
 * Drop-in scroll instrumentation for the Scroll Health meter axis. Spread the
 * returned `scrollHandlers` onto ANY ScrollView / FlatList / FlashList; for a
 * FlashList, also wire `onBlankArea` to capture blank-cell stutter:
 *
 *   const { scrollHandlers, onBlankArea } = useScrollHealth();
 *
 *   // ScrollView / FlatList
 *   <FlatList data={data} {...scrollHandlers} />
 *
 *   // FlashList (adds the optional blank-cell signal)
 *   <FlashList data={data} {...scrollHandlers} onBlankArea={onBlankArea} />
 *
 * The four handlers are valid props on every RN scrollable, so spreading them
 * always typechecks. `onBlankArea` is FlashList-only and kept separate so the
 * spread never trips ScrollView/FlatList prop types. Naturally inert when
 * Boosthis is disabled (the sampler no-ops behind the kill-switch).
 */
import { useMemo } from "react";
import { scrollSampler } from "../scrollSampler";
import { safeHandler } from "../safe";

export interface ScrollHealthHandlers {
  onScrollBeginDrag: () => void;
  onScrollEndDrag: () => void;
  onMomentumScrollBegin: () => void;
  onMomentumScrollEnd: () => void;
}

export interface UseScrollHealthResult {
  /** Spread onto any ScrollView / FlatList / FlashList. */
  scrollHandlers: ScrollHealthHandlers;
  /** Pass to FlashList's `onBlankArea` ONLY — the optional blank-cell signal. */
  onBlankArea: (e: { blankArea: number }) => void;
}

export function useScrollHealth(): UseScrollHealthResult {
  return useMemo(
    () => ({
      // These handlers fire on the HOST's scroll events, outside any React
      // error boundary, so a throw here would crash the host's scroll. Each is
      // wrapped so a Boosthis sampler error can never escape into the host.
      scrollHandlers: {
        onScrollBeginDrag: safeHandler("scroll:beginDrag", () =>
          scrollSampler.begin(),
        ),
        onScrollEndDrag: safeHandler("scroll:endDrag", () => scrollSampler.end()),
        onMomentumScrollBegin: safeHandler("scroll:momentumBegin", () =>
          scrollSampler.begin(),
        ),
        onMomentumScrollEnd: safeHandler("scroll:momentumEnd", () =>
          scrollSampler.end(),
        ),
      },
      onBlankArea: safeHandler("scroll:blankArea", (e: { blankArea: number }) =>
        scrollSampler.recordBlankArea(e?.blankArea ?? 0),
      ),
    }),
    [],
  );
}
