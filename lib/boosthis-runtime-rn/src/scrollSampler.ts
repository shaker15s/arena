/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: scroll sampler (FIELD-CAPABLE) ─────────────────────────
 *
 * Measures how smooth scrolling actually feels by attributing frame jank to
 * the windows when the user is ACTIVELY scrolling — between a drag/momentum
 * begin and its matching end — rather than across the whole session. Driven
 * by the handlers from useScrollHealth(), which a developer spreads onto any
 * ScrollView / FlatList / FlashList.
 *
 * Unlike the render profiler (which rides React's <Profiler onRender>, a no-op
 * in release builds and therefore dev-only), the scroll loop measures real
 * requestAnimationFrame gaps, so it produces data in RELEASE builds too. That
 * makes Scroll Health a field-capable axis — it lives in computeMeterAxes and
 * is uploaded with the snapshot, exactly like Smoothness and Stability.
 *
 * Optional enrichment: FlashList reports blank space (cells not yet rendered)
 * via onBlankArea; recordBlankArea() folds that in. Plain ScrollView/FlatList
 * never call it, so blankEvents simply stays 0 and the axis scores on jank
 * alone.
 *
 * Nothing here touches the shared TTFF/TTI/FID composite — it is an additive
 * axis with its own thresholds (see meterAxes.ts).
 */

import { isBoosthisDisabled } from "./runtimeFlags";

// Mirror the FrameSampler thresholds so "jank while scrolling" means the same
// thing as jank elsewhere: a frame gap > 32ms missed the 60fps budget, and a
// gap ≥ 500ms is a backgrounded suspension (not scroll jank) and is excluded.
const SCROLL_JANK_MS = 32;
const SCROLL_SUSPENSION_MS = 500;

export interface ScrollStats {
  /** True while a drag/momentum window is open. */
  isScrolling: boolean;
  /** Frames sampled while scrolling was active (session-cumulative). */
  frameCount: number;
  /** Of those, the ones that blew the 60fps budget (>32ms). */
  jankyCount: number;
  /** jankyCount / frameCount, or 0 when nothing sampled yet. */
  jankFraction: number;
  /** FlashList onBlankArea hits (0 for plain ScrollView/FlatList). */
  blankEvents: number;
  /** Worst blank gap seen (px), 0 when none. */
  worstBlankPx: number;
}

class ScrollSampler {
  private active = false;
  private rafHandle: number | null = null;
  private lastFrameAt = 0;
  // Cumulative across the whole session — scrolling happens in short bursts, so
  // a session-wide health rate (like Stability) is the meaningful signal. Reset
  // only on clear().
  private frameCount = 0;
  private jankyCount = 0;
  private blankEvents = 0;
  private worstBlankPx = 0;

  /** onScrollBeginDrag / onMomentumScrollBegin — idempotent. Opens the scroll
   *  window and starts a per-frame loop so ONLY frames painted while scrolling
   *  are attributed to this axis. */
  begin() {
    if (isBoosthisDisabled()) return;
    if (this.active) return;
    this.active = true;
    this.lastFrameAt = 0;
    const tick = () => {
      if (!this.active) return;
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      if (this.lastFrameAt > 0) {
        const dt = now - this.lastFrameAt;
        // Exclude backgrounded suspensions so a tab-away mid-scroll never reads
        // as a giant janky frame.
        if (dt > 0 && dt < SCROLL_SUSPENSION_MS) {
          this.frameCount++;
          if (dt > SCROLL_JANK_MS) this.jankyCount++;
        }
      }
      this.lastFrameAt = now;
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  /** onScrollEndDrag / onMomentumScrollEnd — idempotent. Closes the window.
   *  A drag→momentum handoff briefly ends then begin() restarts; the few ms
   *  in between are negligible and never mis-attribute non-scroll frames. */
  end() {
    if (!this.active) return;
    this.active = false;
    if (this.rafHandle !== null) {
      try {
        cancelAnimationFrame(this.rafHandle);
      } catch {
        /* noop */
      }
      this.rafHandle = null;
    }
  }

  /** FlashList onBlankArea adapter — the px of blank space the user saw because
   *  cells weren't ready. Optional: plain lists never call it. */
  recordBlankArea(blankPx: number) {
    if (isBoosthisDisabled()) return;
    if (!(blankPx > 0)) return;
    this.blankEvents++;
    if (blankPx > this.worstBlankPx) this.worstBlankPx = blankPx;
  }

  isScrolling() {
    return this.active;
  }

  /** Pure read — does not stop the loop or mutate counters. */
  getStats(): ScrollStats {
    return {
      isScrolling: this.active,
      frameCount: this.frameCount,
      jankyCount: this.jankyCount,
      jankFraction: this.frameCount === 0 ? 0 : this.jankyCount / this.frameCount,
      blankEvents: this.blankEvents,
      worstBlankPx: this.worstBlankPx,
    };
  }

  clear() {
    this.end();
    this.frameCount = 0;
    this.jankyCount = 0;
    this.blankEvents = 0;
    this.worstBlankPx = 0;
    this.lastFrameAt = 0;
  }
}

export const scrollSampler = new ScrollSampler();
