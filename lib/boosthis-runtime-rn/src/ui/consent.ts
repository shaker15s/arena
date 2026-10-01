/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * consent — local-only record that the developer/tester has read and agreed
 * to the Boosthis Terms of Service & Privacy Policy before using the drop-in
 * Boosthis surface (the dashboard / launcher) inside a host app.
 *
 * IMPORTANT scope note: this gate protects the BOOSTHIS surface only — it is
 * shown the first time someone opens the Boosthis dashboard/bubble in a host
 * app. It never blocks the host app's own UI or the host app's end users.
 *
 * Persistence routes through the runtime's platform storage adapter
 * (AsyncStorage on RN, localStorage on web, in-memory in tests) under the key
 * `boosthis:terms-accepted:v1`. The accepted terms VERSION is stored so that
 * when the legal document is revised (bump TERMS_VERSION), the gate shows again
 * — matching the "a new consent is requested when the terms change" promise in
 * TERMS.md. This is the SAME key the standalone Boosthis app uses, so an app
 * that already accepted at launch will not be prompted again here.
 */
import { platform } from "../perfPlatform";

/**
 * The revision of the Terms this gate reflects — the date the user-facing
 * OBLIGATIONS (data assignment, liability, acceptable use, privacy) last
 * materially changed. Keep it equal to the other two TERMS_VERSION constants
 * (server `accounts.ts`, standalone app `utils/consent.ts`); the `scripts`
 * legal-consistency test enforces that all three agree. It may intentionally
 * LAG the "Last updated" display date in TERMS.md / the served /terms page,
 * which also bumps for non-material edits (typo fixes, wording clean-ups) that
 * do not require re-consent. Bumping THIS value re-prompts everyone.
 */
export const TERMS_VERSION = "2026-07-21";

const STORAGE_KEY = "boosthis:terms-accepted:v1";

export interface TermsAcceptance {
  version: string;
  acceptedAt: number;
  /** The installId the acceptance was recorded under, or null when the app
   *  was unregistered at accept time. Absent on legacy records (treated as
   *  null). */
  installId?: string | null;
}

export async function getAcceptance(): Promise<TermsAcceptance | null> {
  try {
    const raw = await platform().storage.get(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.version === "string" &&
      typeof parsed.acceptedAt === "number"
    ) {
      return parsed as TermsAcceptance;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * True only when the CURRENT terms version has been accepted FOR the current
 * install identity. Any older (or missing) acceptance returns false so the
 * gate shows again.
 *   - `currentInstallId` null/undefined (unregistered app): version-only
 *     check, so a dev testing the surface without telemetry isn't re-gated
 *     on every launch.
 *   - `currentInstallId` present (registered): the stored record must carry
 *     the SAME installId — a fresh install (new installId) re-runs the whole
 *     gate flow (sign-in → telemetry → terms; owner requirement, Jul 2026).
 */
export async function hasAcceptedCurrentTerms(
  currentInstallId?: string | null,
): Promise<boolean> {
  const a = await getAcceptance();
  if (!a || a.version !== TERMS_VERSION) return false;
  if (currentInstallId == null) return true;
  return (a.installId ?? null) === currentInstallId;
}

export async function recordAcceptance(
  installId?: string | null,
): Promise<void> {
  const payload: TermsAcceptance = {
    version: TERMS_VERSION,
    acceptedAt: Date.now(),
    installId: installId ?? null,
  };
  await platform().storage.set(STORAGE_KEY, JSON.stringify(payload));
}

export async function clearAcceptance(): Promise<void> {
  await platform().storage.remove(STORAGE_KEY);
}
