/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * BoosthisLauncher — a floating, draggable bubble that opens the full
 * BoosthisDashboard.
 *
 * Why this exists: the dashboard normally lives in a Settings row or a tab. A
 * brand-new app may have neither, so there is nowhere obvious to put it. Drop
 * `<BoosthisLauncher />` once near the app root and a small movable bubble
 * appears in a corner; tapping it opens the dashboard in a modal. Drag it
 * anywhere; the user can ask their AI agent to change the starting corner or
 * hide it later.
 *
 * Visibility:
 *  - By default the bubble is visible in every build, including release builds.
 *  - Set `BOOSTHIS_BUBBLE=0` (env or global) or pass `visible={false}` to hide
 *    it. The environment/global directive takes precedence over the prop.
 *  - The global `BOOSTHIS_DISABLED` kill-switch always wins: the bubble never
 *    renders when Boosthis is disabled.
 *
 * Drop-in constraints (works in ANY Expo / React Native app):
 *  - Pure react-native primitives only (View / Text / Pressable / Modal /
 *    Animated / PanResponder). No icon packs, no navigation, no gesture libs.
 *
 * Usage (host app root — e.g. app/_layout.tsx or App.tsx):
 *
 *   import { BoosthisLauncher } from "@workspace/boosthis-runtime-rn";
 *
 *   // ...inside the root component, after your navigator:
 *   <BoosthisLauncher appName="MyApp" />
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  BoosthisDashboard,
  type BoosthisDashboardTheme,
} from "./BoosthisDashboard";
import { BOOSTHIS_ICON_URI } from "./brandIcon";
import { BoosthisErrorBoundary } from "./BoosthisErrorBoundary";
import { useEntitlementGate } from "../hooks/useEntitlement";
import { forceEntitlementCheck } from "../killSwitch";
import { safeRun } from "../safe";
import { resolveBubbleVisibility } from "../bubbleVisibility";

export type BoosthisLauncherCorner =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface BoosthisLauncherProps {
  /** App name shown in the dashboard header. Defaults to "Boosthis". */
  appName?: string;
  /** Small line under the dashboard title. */
  subtitle?: string;
  /**
   * Whether the floating bubble is shown. Defaults to visible in every build.
   * `BOOSTHIS_BUBBLE` takes precedence; the global kill-switch always wins.
   */
  visible?: boolean;
  /** Which corner the bubble starts in. Default "top-right". Always draggable. */
  corner?: BoosthisLauncherCorner;
  /**
   * Optional custom bubble label/glyph (e.g. an emoji). When omitted, the
   * bubble shows the Boosthis brand icon (embedded — no asset files needed).
   */
  label?: string;
  /** Optional theme overrides forwarded to the dashboard. */
  theme?: Partial<BoosthisDashboardTheme>;
}

const SIZE = 56;
const MARGIN = 16;
// Clear the status bar / notch when starting in a top corner.
const TOP_INSET = 52;
const BOTTOM_INSET = 32;
/**
 * The gap kept between the bubble and the window edge. The clamp keeps the
 * WHOLE bubble inside the window rather than a grabbable sliver: a bubble the
 * developer cannot reach looks exactly like no bubble, which is the failure
 * this launcher exists to avoid.
 */
const EDGE_KEEP = 4;

interface XY {
  x: number;
  y: number;
}

interface WindowSize {
  width: number;
  height: number;
}

/**
 * The window size, or null when the platform has not measured it yet.
 *
 * A zero or non-finite size is NOT a measurement. On Expo web, and on any late
 * first layout, `Dimensions.get("window")` legitimately answers 0×0 for a frame
 * or two; treating that as a real size pins the bubble at a nonsense coordinate
 * for the rest of the session, which reads as "the kit drew nothing".
 */
function readWindow(): WindowSize | null {
  try {
    const { width, height } = Dimensions.get("window");
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  } catch {
    return null;
  }
}

/** Pull a position back inside the window, whatever the window has become. */
function clampToWindow(pos: XY, win: WindowSize): XY {
  const maxX = Math.max(EDGE_KEEP, win.width - SIZE - EDGE_KEEP);
  const maxY = Math.max(EDGE_KEEP, win.height - SIZE - EDGE_KEEP);
  return {
    x: Math.min(Math.max(pos.x, EDGE_KEEP), maxX),
    y: Math.min(Math.max(pos.y, EDGE_KEEP), maxY),
  };
}

function cornerToXY(
  corner: BoosthisLauncherCorner,
  width: number,
  height: number,
): XY {
  const left = MARGIN;
  const right = width - SIZE - MARGIN;
  const top = TOP_INSET;
  const bottom = height - SIZE - MARGIN - BOTTOM_INSET;
  switch (corner) {
    case "top-left":
      return { x: left, y: top };
    case "bottom-left":
      return { x: left, y: bottom };
    case "bottom-right":
      return { x: right, y: bottom };
    case "top-right":
    default:
      return { x: right, y: top };
  }
}

/** The requested corner, clamped for windows smaller than the insets assume. */
function restingPosition(
  corner: BoosthisLauncherCorner,
  win: WindowSize,
): XY {
  return clampToWindow(cornerToXY(corner, win.width, win.height), win);
}

/**
 * Where the bubble sits before the window has ever been measured. Safe on any
 * device because it needs neither width nor height, and it is replaced by the
 * requested corner the moment a real measurement arrives.
 */
const UNMEASURED_POSITION: XY = { x: MARGIN, y: TOP_INSET };

/**
 * Floating launcher bubble. Self-wraps the implementation in an error boundary
 * so a render-time throw anywhere inside it — the bubble, the modal chrome, or
 * the dashboard rendered within — can NEVER crash the host app. On failure the
 * whole launcher quietly disappears and the host keeps running.
 */
export function BoosthisLauncher(props: BoosthisLauncherProps) {
  return (
    <BoosthisErrorBoundary name="launcher">
      <LauncherInner {...props} />
    </BoosthisErrorBoundary>
  );
}

function LauncherInner({
  appName = "Boosthis",
  subtitle,
  visible,
  corner = "top-right",
  label,
  theme,
}: BoosthisLauncherProps) {
  const [open, setOpen] = useState(false);

  // The window is re-read on EVERY size change — a rotation, a split view, an
  // Expo/browser preview being resized — and the resting corner re-derived from
  // it. It used to be read once at first render and never again, so a bubble
  // placed against a stale (or never-taken) measurement stayed off screen for
  // the life of the app, which is indistinguishable from no bubble at all.
  const [win, setWin] = useState<WindowSize | null>(readWindow);
  const winRef = useRef<WindowSize | null>(win);
  winRef.current = win;

  // The bubble's position in window coordinates. `null` means it has never been
  // placed against a real measurement, so the first one wins the corner.
  const posRef = useRef<XY | null>(win ? restingPosition(corner, win) : null);
  // Lazily constructed ONCE per mount: `useRef(new Animated.ValueXY(...))`
  // would build (and throw away) a fresh animated value on every render.
  const panRef = useRef<Animated.ValueXY | null>(null);
  if (panRef.current === null) {
    panRef.current = new Animated.ValueXY(posRef.current ?? UNMEASURED_POSITION);
  }
  const pan = panRef.current;
  const dragFrom = useRef<XY | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    const onChange = () => {
      const next = readWindow();
      if (!next) return;
      setWin((prev) =>
        prev && prev.width === next.width && prev.height === next.height
          ? prev
          : next,
      );
    };
    let sub: { remove?: () => void } | undefined;
    try {
      sub = Dimensions.addEventListener("change", onChange) as unknown as {
        remove?: () => void;
      };
    } catch {
      /* a platform without the subscription still gets the mount re-read */
    }
    // A first layout that reported nothing does not always fire a change event,
    // so take one more reading now that the component is mounted.
    onChange();
    return () => {
      try {
        sub?.remove?.();
      } catch {
        /* teardown must never crash the host app */
      }
    };
  }, []);

  // Place the bubble whenever the measurement changes. An unplaced bubble takes
  // the requested corner; an already-placed one keeps where the developer put
  // it, pulled back inside the new window so it stays reachable.
  useEffect(() => {
    if (!win) return;
    const next =
      posRef.current === null
        ? restingPosition(corner, win)
        : clampToWindow(posRef.current, win);
    posRef.current = next;
    try {
      pan.setValue(next);
    } catch {
      /* placement must never crash the host app */
    }
  }, [win, corner, pan]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4,
        // Gesture callbacks run OUTSIDE React render, so an error boundary
        // cannot catch them — a throw here would reach RN's global handler and
        // could crash the host. Guard each so the bubble fails soft instead.
        onPanResponderGrant: () => {
          try {
            moved.current = false;
            dragFrom.current = posRef.current ?? UNMEASURED_POSITION;
          } catch {
            /* gesture bookkeeping must never crash the host app */
          }
        },
        onPanResponderMove: (_e, g) => {
          try {
            if (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) moved.current = true;
            const from = dragFrom.current;
            if (!from) return;
            const w = winRef.current;
            const raw = { x: from.x + g.dx, y: from.y + g.dy };
            // BOUNDED: a drag may move the bubble anywhere inside the window and
            // nowhere outside it, so it can never be flung out of reach.
            const next = w ? clampToWindow(raw, w) : raw;
            posRef.current = next;
            pan.setValue(next);
          } catch {
            /* drag tracking must never crash the host app */
          }
        },
        onPanResponderRelease: () => {
          try {
            dragFrom.current = null;
            // A tap (no real movement) opens the dashboard.
            if (!moved.current) setOpen(true);
          } catch {
            /* release handling must never crash the host app */
          }
        },
        onPanResponderTerminate: () => {
          try {
            dragFrom.current = null;
          } catch {
            /* teardown must never crash the host app */
          }
        },
      }),
    [pan],
  );

  // Re-render when the server-authority kill-switch flips the gate. The gate
  // KIND distinguishes the SILENT off-switch states ("hidden": env kill /
  // tampered / grace-expired) from the VISIBLE-LOCK states ("revoked" /
  // "unpaid" / "paused"), where the owner's UX requires the kit be shown as
  // locked (bubble stays, opens straight to a blocking overlay) rather than
  // silently vanishing — and from "unregistered", the never-checked-in state,
  // which draws and opens on the dashboard's own "Not registered yet" verdict.
  const gate = useEntitlementGate();
  const lockedVisible =
    gate === "revoked" || gate === "unpaid" || gate === "paused";

  // VAULT contract: opening the dashboard is a user-driven enforcement edge —
  // trigger a FRESH (throttled ≤1/60s) server entitlement check the moment the
  // dashboard opens. Non-blocking; the verdict flips the gate when it lands.
  // A revoked/unpaid verdict landing while the dashboard is open does NOT close
  // it — the dashboard body swaps to the blocking lock overlay in place (the
  // meters stop being readable), which is the "close/refuse a dashboard being
  // opened right now" behavior in its new visible-lock form.
  useEffect(() => {
    if (!open) return;
    safeRun("launcher.onOpenCheck", () => forceEntitlementCheck(false));
  }, [open]);

  // If the kit becomes SILENTLY inert while the dashboard is OPEN (a "hidden"
  // state — env kill / tampered / grace-expired), close it: there is no overlay
  // copy for those and the bubble is about to vanish, so a dangling modal must
  // not linger. Visible-lock states keep the modal open to SHOW the overlay.
  useEffect(() => {
    if (gate === "hidden" && open) setOpen(false);
  }, [gate, open]);

  // Visibility is computed AFTER all hooks so hook order stays stable. The
  // bubble shows when the kit is active ("none"), when it has never checked in
  // ("unregistered" — the developer needs to READ that, not guess it), and in a
  // visible-lock state (so they see WHY it stopped). It hides only for the
  // silent off-switch states and when visibility resolution explicitly hides
  // it. See docs/kit-bubble-draw-contract.md.
  const showBase = resolveBubbleVisibility(visible);
  const show =
    showBase && (gate === "none" || gate === "unregistered" || lockedVisible);
  if (!show) return null;

  return (
    <>
      <Animated.View
        accessibilityRole="button"
        accessibilityLabel="Open Boosthis performance dashboard"
        style={[styles.bubble, { transform: pan.getTranslateTransform() }]}
        {...panResponder.panHandlers}
      >
        {label ? (
          <Text style={styles.bubbleLabel}>{label}</Text>
        ) : (
          <Image
            source={{ uri: BOOSTHIS_ICON_URI }}
            style={styles.bubbleIcon}
            accessibilityIgnoresInvertColors
          />
        )}
      </Animated.View>

      <Modal
        visible={open}
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modalRoot}>
          <View style={styles.modalBar}>
            <Text style={styles.modalTitle}>{appName}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close Boosthis dashboard"
              onPress={() => setOpen(false)}
              style={styles.closeBtn}
            >
              <Text style={styles.closeLabel}>Close</Text>
            </Pressable>
          </View>
          {/* BoosthisDashboard self-wraps in its own error boundary, so a
              dashboard render failure leaves this modal chrome (bar + Close) up
              and the host app untouched. The outer BoosthisLauncher boundary is
              the final net for the bubble + modal chrome themselves. */}
          <BoosthisDashboard
            appName={appName}
            subtitle={subtitle}
            theme={theme}
          />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: "absolute",
    top: 0,
    left: 0,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: "#15171c",
    // Hairline ring for separation on any background — NOT a loud accent, so
    // the brand mark itself is what reads.
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
    // Float above app content.
    zIndex: 9999,
    elevation: 12,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  bubbleLabel: {
    fontSize: 24,
    color: "#e6e7eb",
  },
  // The brand mark nearly fills the bubble as a circular app-icon tile so the
  // "B + lightning bolt" reads clearly instead of floating small in the middle.
  bubbleIcon: {
    width: SIZE - 4,
    height: SIZE - 4,
    borderRadius: (SIZE - 4) / 2,
  },
  modalRoot: {
    flex: 1,
    backgroundColor: "#0b0c10",
  },
  modalBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 52,
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: "#15171c",
    borderBottomWidth: 1,
    borderBottomColor: "#262932",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#e6e7eb",
  },
  closeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: "#1c1f26",
    borderWidth: 1,
    borderColor: "#262932",
  },
  closeLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#e6e7eb",
  },
});
