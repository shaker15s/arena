/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * WHERE THIS KIT KEEPS ITS INSTALL ID — and whether the next launch will still
 * be this install.
 *
 * WHY THIS EXISTS
 * ---------------
 * This kit's identity across launches does not rest on the id baked into the
 * app's source. That id is stable, but it is only a SEED: a relaunch that
 * cannot produce the delete token the server issued gets the idempotent
 * "already registered, no token" answer, and the kit heals itself by minting a
 * fresh id and reporting under that instead. Both the credential and the
 * rotation mapping live in the kit's own store. So the kit — not the host —
 * owns whether the next launch is this same install, and the honest `source`
 * word for that is `store`.
 *
 * The store the kit gets is whatever `perfPlatform` settled on. On React
 * Native that is `@react-native-async-storage/async-storage`, which is an
 * OPTIONAL peer dependency: an app that does not have it falls through to an
 * in-memory map, keeps running, and loses everything at exit. Nothing about
 * that path looks broken from the device, and from the server it looks like a
 * growing fleet of healthy installs under one project key.
 *
 * So the kit says which store it landed on, in the server's own closed
 * vocabulary — never a path, never a module name, never an error string. The
 * server owns every word a human reads.
 *
 * THE THREE ANSWERS MUST STAY APART
 * ---------------------------------
 *   device   the platform's own app storage. Outside this process, expected
 *            to outlive it: a relaunch is the same install.
 *   memory   no durable store is in use: either nothing durable was found, or
 *            the adapter the application supplied says what it holds does not
 *            survive. The id lives only in this process, so every relaunch
 *            arrives as a brand-new install. The kit reports that STATE and
 *            never which of the two produced it — it cannot see the
 *            difference, and a remedy naming the wrong one is a loop.
 *   unknown  the APPLICATION supplied its own storage adapter and that adapter
 *            does not say whether what it holds survives. The kit asked and
 *            got no answer — which is not `memory` ("there is an answer and it
 *            is no") and not silence ("nobody ever asked").
 */

import { platform } from "./perfPlatform";

/** The three store words this kit can honestly send. A subset of the server's
 *  closed `identity.store` list; nothing here is invented for React Native. */
export type IdentityStoreWord = "device" | "memory" | "unknown";

/** The `identity` block this kit puts on its consent body. `source` is always
 *  `store` — see the note at the top of this file for why the host-baked id
 *  does not make this host-managed. */
export interface ConsentIdentity {
  source: "store";
  store: IdentityStoreWord;
  restored: boolean;
}

/**
 * Which store this launch settled on.
 *
 * Reads the adapter's own declaration rather than sniffing for AsyncStorage:
 * a host that routes storage through SQLite, the keychain or its own
 * encrypted file is just as durable, and the only thing we can honestly
 * report is what the adapter says about itself.
 */
export function identityStoreWord(): IdentityStoreWord {
  try {
    const persistent = platform().storage.persistent;
    if (persistent === true) return "device";
    if (persistent === false) return "memory";
    // A host adapter that does not answer. Never guessed either way.
    return "unknown";
  } catch {
    // A replaced platform that throws on read is exactly as unanswerable.
    return "unknown";
  }
}

/**
 * Does a relaunch come back as this same install?
 *
 * `true` / `false` are claims the store's own declaration supports. `null` is
 * the answer when the host's adapter will not say, and it must never be
 * rendered as either of the other two.
 */
export function identityKeepsAcrossLaunch(): boolean | null {
  const store = identityStoreWord();
  if (store === "device") return true;
  if (store === "memory") return false;
  return null;
}

/** The consent block. `restored` is whether THIS launch read its own identity
 *  state back out of the store — the proof the mechanism works, and the thing
 *  a store that reports `device` and never restores is failing to do. */
export function consentIdentity(restored: boolean): ConsentIdentity {
  return { source: "store", store: identityStoreWord(), restored };
}

/* ─── What the in-app panel says ──────────────────────────────────────── */

/** Heading for the panel card. Empty string when there is nothing to say. */
export const IDENTITY_PANEL_TITLE: Record<"memory" | "unknown", string> = {
  memory: "This app cannot keep its Boosthis identity",
  unknown: "Cannot tell whether this app keeps its Boosthis identity",
};

/**
 * The panel's body text. Short, on-device wording — the full sentence lives on
 * the server (lib/identityPersistence.ts) because that is the copy the
 * dashboard and an AI read. Both must say the same two things: what is
 * happening, and what it costs.
 */
export const IDENTITY_PANEL_BODY: Record<"memory" | "unknown", string> = {
  memory:
    "Boosthis has nowhere durable to keep this app's install id, so it is holding it in memory for this launch only. Every relaunch registers as a brand-new install: the history on your dashboard starts again from nothing, and the install id, read token and MCP config shown here stop working. Either the optional package @react-native-async-storage/async-storage is missing from this app — add it and rebuild — or this app passed setPerfPlatform a storage adapter that declares it does not persist, and the fix belongs in that adapter.",
  unknown:
    "This app gave Boosthis its own storage adapter, and that adapter does not say whether what it holds survives a relaunch. Boosthis will not guess: it cannot tell you whether the next launch is this same install, or whether the install id and read token shown here will still work. Set `persistent` on the adapter you pass to setPerfPlatform to settle it.",
};

/** What the panel should show, or null when the identity is durable (nothing
 *  to warn about) — the panel never narrates a healthy state here. */
export function identityPanelNotice(): {
  kind: "memory" | "unknown";
  title: string;
  body: string;
} | null {
  const store = identityStoreWord();
  if (store === "device") return null;
  return {
    kind: store,
    title: IDENTITY_PANEL_TITLE[store],
    body: IDENTITY_PANEL_BODY[store],
  };
}
