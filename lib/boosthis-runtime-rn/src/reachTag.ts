/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * Anonymous per-day issue-reach tag.
 *
 * The kit attaches an OPTIONAL `reachTag` to candidate (issue) uploads so
 * the server can approximate how many distinct devices hit the same issue
 * in a week — WITHOUT ever identifying or tracking a device.
 *
 * Privacy contract (must never weaken):
 *   - The tag is pure random noise (16 hex chars from Math.random), NEVER
 *     derived from any device, user, or install identifier.
 *   - It rotates every calendar day: a new random value is generated when
 *     the stored date no longer matches today, so the tag cannot link a
 *     device across days.
 *   - The server hashes it to a single bit position in a coarse windowed
 *     sketch and drops the raw tag — it is never stored server-side.
 *   - Everything here is fail-safe: any storage error just returns
 *     undefined and the upload proceeds WITHOUT a tag (reach shows "—").
 *   - forget() calls clearReachTag() — erasure leaves nothing
 *     Boosthis-shaped on the device.
 */

import { platform } from "./perfPlatform";

const REACH_TAG_KEY = "boosthis_reach_tag_v1";

/** Local calendar date, YYYY-MM-DD — rotation is per device-local day. */
function todayStamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** 16 hex chars of pure randomness — enough entropy that same-day
 *  collisions between devices are negligible for coarse bucketing, and
 *  deliberately NOT crypto-derived from anything device-specific. */
function randomTag(): string {
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

/**
 * Return today's reach tag, minting (and persisting) a fresh one when the
 * calendar day has rolled over. Returns undefined on ANY failure — the
 * caller must treat the tag as strictly optional.
 */
export async function getDailyReachTag(): Promise<string | undefined> {
  try {
    const storage = platform().storage;
    const today = todayStamp();
    const raw = await storage.get(REACH_TAG_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { d?: string; t?: string };
        if (
          parsed &&
          parsed.d === today &&
          typeof parsed.t === "string" &&
          /^[0-9a-f]{16}$/.test(parsed.t)
        ) {
          return parsed.t;
        }
      } catch {
        // Corrupt entry — fall through and mint a fresh one.
      }
    }
    const tag = randomTag();
    await storage.set(REACH_TAG_KEY, JSON.stringify({ d: today, t: tag }));
    return tag;
  } catch {
    return undefined;
  }
}

/** Erase the persisted tag — called from forget() so erasure leaves
 *  nothing Boosthis-shaped behind. Best-effort, never throws. */
export async function clearReachTag(): Promise<void> {
  try {
    await platform().storage.remove(REACH_TAG_KEY);
  } catch {
    // Best-effort.
  }
}
