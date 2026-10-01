/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * THE VERSION OF THE APP THIS KIT IS RUNNING INSIDE — never our own.
 *
 * Every registration this kit has ever sent carried `packageVersion`, and
 * that has always been the BOOSTHIS KIT's version. It reads like the app's
 * version, it sits where an app's version would sit, and it is not the app's
 * version. So a project's release history was empty for every customer, and a
 * developer looking at their own dashboard was shown one of our release
 * numbers.
 *
 * This module answers the other question, and keeps the two apart by
 * construction: the app's version travels in its own block, under its own
 * name, and this module never once falls back to `RUNTIME_VERSION`. An app
 * whose version cannot be read reports no version at all — which the server
 * renders as "this kit has never told us" — because a wrong answer here is
 * worse than a missing one.
 *
 * WHERE IT CAME FROM TRAVELS WITH IT. A version read out of the build and a
 * version an application handed the kit are different kinds of claim, and the
 * server records each as a different kind of release. The word is chosen here,
 * at the only place that knows, rather than guessed later.
 */

import { detectAppVersion } from "./perfPlatform";

/**
 * The closed vocabulary for where a version came from. Exactly the words the
 * server holds (`APP_VERSION_SOURCES` in lib/api-zod/src/appVersionFields.ts);
 * `appVersionWireParity.test.ts` fails if the two lists drift.
 *
 * A word outside this list is dropped by the server on its own — the version
 * is still stored, and it simply never becomes a release. That is why the
 * choice is made here, in code, and never built from a value.
 */
export const APP_VERSION_SOURCES = ["build", "declared"] as const;

export type AppVersionSource = (typeof APP_VERSION_SOURCES)[number];

/** The app's own version and where this kit got it. */
export interface AppVersionFact {
  version: string;
  source: AppVersionSource;
}

/** The longest version string this kit will send. Matches the server's own
 *  ceiling, so a value that leaves here is one a release row can hold. A
 *  longer one is dropped rather than truncated: half a version number is a
 *  different version number. */
export const MAX_APP_VERSION = 60;

/** What the server will accept: starts alphanumeric, then letters, digits,
 *  dot, dash, underscore and plus. Checked here so a value that cannot be
 *  stored is never sent, rather than vanishing on arrival. */
const APP_VERSION_SHAPE_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

/** True for a string this kit is willing to put on the wire as a version. */
export function isSendableAppVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= MAX_APP_VERSION &&
    APP_VERSION_SHAPE_RE.test(value.trim())
  );
}

/**
 * Resolve the app's own version, preferring what the application SAID over
 * what the build says.
 *
 * A declaration wins because it is the only way to name a version the build
 * does not know — an over-the-air JavaScript bundle shipped ahead of its
 * binary is a real release the native fields cannot see, and an app that goes
 * to the trouble of stating its version has a reason.
 *
 * Returns `null` when neither is available or neither is sendable. Never
 * throws: this runs on the consent path, and no version reading may cost an
 * app its registration.
 */
export function resolveAppVersion(declared?: string): AppVersionFact | null {
  if (isSendableAppVersion(declared))
    return { version: declared.trim(), source: "declared" };
  let read: string | undefined;
  try {
    read = detectAppVersion();
  } catch {
    // A metadata module that throws is not a reason to fail a registration.
    read = undefined;
  }
  if (isSendableAppVersion(read)) return { version: read.trim(), source: "build" };
  return null;
}

/**
 * The block as it goes on the wire, or nothing at all.
 *
 * Spread into the consent body. An app with no readable version sends no
 * `app` key, which is a different thing from sending an empty one.
 */
export function appVersionPayload(
  declared?: string,
): { app: AppVersionFact } | Record<string, never> {
  const fact = resolveAppVersion(declared);
  return fact ? { app: fact } : {};
}
