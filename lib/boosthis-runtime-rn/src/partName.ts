/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─────────────────────────────────────────────────────────────────────────
 * WHAT A PART OF THE APP IS CALLED — this kit's copy of the one rule.
 *
 * BOOSTHIS_PART_NAME_V1 — shared with lib/part-name-vocabulary.json.
 * Full reasoning: docs/decisions/part-name-one-rule.md.
 *
 * A part is the piece of the app a reading belongs to: a SCREEN here, a route
 * on a server kit. At most 100 characters, refused rather than shortened, and
 * never a minted stand-in for a screen this kit could not name.
 *
 * WHY ITS OWN MODULE. Both halves of this kit need the rule: the screen names
 * a timing is filed under and the names the inventory and the page map
 * record. Putting it in either half makes the other import it, and the page
 * map, the inventory and the circuit map already reach each other — the rule
 * would close a require cycle, which on React Native Metro prints in the
 * customer's own build output and can hand a half-evaluated module to its
 * neighbour. This module is a LEAF: it imports the privacy screen and nothing
 * else, so it has nothing it COULD import that would close a loop. The same
 * shape the axis scoring helpers were moved into, for the same reason.
 * ───────────────────────────────────────────────────────────────────────── */

import { routeLabelHasPII } from "./no-pii";

// BOOSTHIS_PART_NAME_V1 — shared with lib/part-name-vocabulary.json.
export const MAX_PART_NAME = 100;

const NUMERIC_SEG = /^\d+$/;
const UUID_SEG =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX_SEG = /^[0-9a-f]{16,}$/i;
const warnedPartNameRefusals = new Set<string>();

/**
 * Tell the developer, once per reason, that a screen name they wrote will not
 * travel — with the reason and an acceptable form.
 *
 * The rejected text is deliberately NOT echoed: the reason a name is refused
 * is sometimes that it carries a value, and repeating it into a host console
 * moves that value somewhere new.
 */
export function warnPartNameRefusal(reason: "too-long" | "invalid"): void {
  if (warnedPartNameRefusals.has(reason)) return;
  warnedPartNameRefusals.add(reason);
  try {
    console.warn(
      reason === "too-long"
        ? `Boosthis refused a screen name because its length exceeds ${MAX_PART_NAME} characters. Use a screen name of at most ${MAX_PART_NAME} characters, with volatile path segments written as :id.`
        : "Boosthis refused a screen name because it is empty or carries a value. Use a code-defined name such as OrderDetails or /orders/:id.",
    );
  } catch {
    /* a host console must never break registration */
  }
}

export function _resetPartNameWarningsForTests(): void {
  warnedPartNameRefusals.clear();
}

/**
 * One screen name, made safe to travel — or `null`.
 *
 * A screen name is code, not user data: the developer's own word, kept as
 * written. What is refused is anything that stopped looking like one — a name
 * carrying an id means the navigator handed back a resolved route rather than
 * a registration, and that is dropped rather than redacted into something
 * that would read as a screen.
 */
export function safeScreenName(raw: unknown): string | null {
  try {
    if (typeof raw !== "string") return null;
    let text = raw.trim();
    if (!text) return null;
    if (text.length > MAX_PART_NAME) return null;
    const q = text.search(/[?#]/);
    if (q >= 0) text = text.slice(0, q);
    if (!text) return null;
    if (text.includes("/")) {
      text = text
        .split("/")
        .map((seg) => {
          if (
            seg &&
            (NUMERIC_SEG.test(seg) ||
              UUID_SEG.test(seg) ||
              LONG_HEX_SEG.test(seg) ||
              seg.includes("@"))
          ) {
            return ":id";
          }
          return seg;
        })
        .join("/");
    }
    if (text.length > MAX_PART_NAME) return null;
    if (routeLabelHasPII(text) !== null) return null;
    return text;
  } catch {
    return null;
  }
}
