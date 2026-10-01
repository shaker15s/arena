/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/** Stub shipped INSIDE the Boosthis RN kit (auto-injected by repack-kit.mjs).
 *
 * The REAL integrationKit.ts (in the Boosthis source repo) embeds the whole kit
 * manifest so the maintainer's HOSTED MCP server can deliver the kit by value.
 * That file is deliberately NOT shipped inside the kit: a kit cannot embed a
 * copy of itself (it would recurse), and a locally-installed kit has no reason
 * to re-ship or self-uninstall via an embedded manifest.
 *
 * But the kit DOES ship mcp.ts, which imports these two functions. This stub
 * keeps that import resolvable so the kit compiles cleanly on a blind copy. On
 * a local kit server these two tools just return a note pointing at the hosted
 * Boosthis MCP, which is where kit delivery/removal actually lives.
 */

/** Mirrors the real module's changelog types so mcp.ts compiles unchanged. */
export type KitChangelogSeverity =
  | "cosmetic"
  | "recommended"
  | "important"
  | "security";

export interface KitChangelogEntry {
  version: string;
  summary: string;
  severity?: KitChangelogSeverity;
}

/** A locally-installed kit carries no changelog (that lives with the hosted
 * MCP, which knows what "newer" means); an empty list keeps the update-check
 * path honest — it simply reports nothing newer from this local copy. */
export const KIT_CHANGELOG: KitChangelogEntry[] = [];

/** The canonical integrity fingerprint comes from the EMBEDDED manifest,
 * which this local kit deliberately does not carry — `null` tells callers to
 * skip the canonical comparison (same contract as the real module when the
 * manifest predates hashing). */
export function getCanonicalKitIntegrity(): {
  version: string;
  manifestHash: string;
} | null {
  return null;
}

export interface IntegrationKitStubResult {
  available: false;
  note: string;
}

export function getIntegrationKit(): IntegrationKitStubResult {
  return {
    available: false,
    note:
      "boosthis.get_integration_kit delivers the Boosthis kit by value and is " +
      "served only by the maintainer's hosted Boosthis MCP server (which embeds " +
      "the kit manifest). This locally-installed kit carries no manifest, so it " +
      "cannot re-ship itself — Boosthis is already installed here. To update " +
      "or reinstall, connect to the hosted Boosthis MCP and call " +
      "get_integration_kit there.",
  };
}

export function getRemovalKit(): IntegrationKitStubResult {
  return {
    available: false,
    note:
      "boosthis.get_removal_kit is served only by the maintainer's hosted " +
      "Boosthis MCP server (it derives the file list from the embedded kit " +
      "manifest, which this locally-installed kit does not carry). To uninstall " +
      "Boosthis manually: run the telemetry client's forget() first, then delete " +
      "boosthis.config.json, strip the wiring, and remove the lib/boosthis-* " +
      "folders plus their package.json dependencies.",
  };
}
