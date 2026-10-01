/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * Shared theme for the drop-in Boosthis UI (BoosthisDashboard + BoosthisEnginePanel).
 *
 * Kept in its own module so the dashboard and the engine panel can both import
 * the type, the dark defaults, and the rating-color helper without creating a
 * require cycle (the dashboard renders the engine panel).
 */
import type { Rating } from "../thresholds";

export interface BoosthisDashboardTheme {
  background: string;
  card: string;
  border: string;
  foreground: string;
  mutedForeground: string;
  secondary: string;
  /** Accent used for primary action buttons (e.g. "Save now", "Promote"). */
  primary: string;
  good: string;
  needsWork: string;
  /** Orange middle tier: slow / sluggish, between needsWork (yellow) and poor (red). */
  sluggish: string;
  poor: string;
  pending: string;
}

/**
 * Matches the LIVE Boosthis web dashboard's dark palette (the `:root` CSS
 * variables in artifacts/api-server/src/routes/app.ts STYLE — bg/card/line/
 * text/muted plus the orange `#f97316` primary button with dark text) so the
 * drop-in kit looks identical to the dashboard developers sign in to. Keep
 * the two in lockstep when the brand palette changes. NOTE: this is the WEB
 * dashboard palette, NOT the mobile app's colors.ts (which uses a green
 * primary) — the owner-approved brand reference is the web dashboard.
 */
export const DARK_THEME: BoosthisDashboardTheme = {
  background: "#0b0c10",
  card: "#15171c",
  border: "#262932",
  foreground: "#e6e7eb",
  mutedForeground: "#8b8f99",
  secondary: "#1c1f26",
  primary: "#f97316",
  good: "#4ade80",
  needsWork: "#fbbf24",
  sluggish: "#fb923c",
  poor: "#f87171",
  pending: "#64748b",
};

export function ratingColor(
  rating: Rating | "insufficient-data" | "not-available" | "not-scored",
  t: BoosthisDashboardTheme,
): string {
  switch (rating) {
    case "good":
      return t.good;
    case "needs-work":
      return t.needsWork;
    case "poor":
      return t.poor;
    // The two silences that are NOT progress toward a score: a reading this
    // device cannot take, and a real reading that is deliberately never
    // graded. Grey belongs to "still measuring", so neither may share it or a
    // permanent answer reads as a wait. Same two colours as the served kit
    // page and the dashboard tiles.
    case "not-available":
      return "#a371f7";
    case "not-scored":
      return "#58a6ff";
    default:
      return t.pending;
  }
}

/**
 * Universal 4-tier color for a raw duration in milliseconds, so any timing the
 * user sees is readable by color alone — no need to read the number:
 *   ≤100ms good (green) · ≤300ms ok (yellow) · ≤800ms slow (orange) · >800ms needs work (red)
 * A missing value is neutral (pending grey).
 */
export function durationColor(
  ms: number | null | undefined,
  t: BoosthisDashboardTheme,
): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return t.pending;
  if (ms <= 100) return t.good;
  if (ms <= 300) return t.needsWork;
  if (ms <= 800) return t.sluggish;
  return t.poor;
}
