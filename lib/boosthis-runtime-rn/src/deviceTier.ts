/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: device-tier bucket ─────────────────────────────────────
 *
 * A coarse, privacy-safe capability bucket for the device this app runs
 * on. This runtime intentionally ships ZERO native dependencies, and a
 * real CPU/RAM tier cannot be derived from React Native core APIs without
 * one. We deliberately do NOT guess from screen geometry: Dimensions /
 * PixelRatio misclassify badly (an iPhone SE is a small screen on a fast
 * chip; a budget Android is 1080p on a slow one), and a wrong tier
 * silently poisons every tier-segmented analysis. So the tier stays
 * "unknown" until the host app explicitly sets it — matching the codebase
 * convention "better to omit a sample dimension than poison the dataset".
 *
 * Hosts that already depend on `expo-device` (or react-native-device-info)
 * can feed an accurate bucket once at startup, e.g.:
 *
 *   import * as Device from "expo-device";
 *   import { setDeviceTier } from "@workspace/boosthis-runtime-rn";
 *   const yc = Device.deviceYearClass;            // e.g. 2017, or null
 *   setDeviceTier(
 *     yc == null ? "unknown" : yc >= 2019 ? "high" : yc >= 2015 ? "mid" : "low",
 *   );
 *
 * The bucket is attached to perf samples as privacy-safe metadata. It is a
 * CLOSED enum — never a device model string — so it carries no fingerprint.
 */

export type DeviceTier = "low" | "mid" | "high" | "unknown";

let tier: DeviceTier = "unknown";

/**
 * Set the device capability bucket. Call once at startup from a host that
 * has a real signal (e.g. expo-device's `deviceYearClass`). Defaults to
 * "unknown" — Boosthis never guesses a tier from screen size.
 */
export function setDeviceTier(next: DeviceTier): void {
  tier = next;
}

/** Read the current device tier bucket. "unknown" until a host sets it. */
export function getDeviceTier(): DeviceTier {
  return tier;
}
