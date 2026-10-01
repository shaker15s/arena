#!/usr/bin/env node
/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * boosthis — zero-dep CLI for the private Boosthis runtime.
 *
 * Subcommands:
 *   boosthis init [path]   Drop boosthis.config.json + print integration snippet
 *   boosthis doctor        Sanity-check an existing integration
 *   boosthis help          Show usage
 *
 * Pure Node stdlib — no transitive deps so it runs the moment the runtime
 * is linked into a host project (no install step required).
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve, join, relative } from "node:path";
import process from "node:process";

const VERSION = "1.0.0-alpha.246";

// Tamper-evidence: name of the shipped canonical hash manifest. The hashing
// algorithm below is intentionally a SELF-CONTAINED copy of scripts/kit-integrity.mjs
// (sha256 of exact bytes; overall hash = sha256 of sorted `path\0sha256\0size`
// lines). scripts/ is NOT shipped inside the kit, but this CLI is — so the CLI
// keeps the algorithm inline to stay zero-dep. A scripts test asserts the two
// stay in lockstep, so a change in one must be mirrored in the other.
const MANIFEST_FILENAME = "boosthis-kit-manifest.json";

// The runtime name this kit registers under. A codebase can hold one project
// key per language, and "rn" is this kit's slot in boosthis.config.json.
const RUNTIME_NAME = "rn";

/* ─── Which project key will this app actually send? ──────────────────────
 * A self-contained mirror of the precedence in src/projectKey.ts (the CLI is
 * shipped and stays zero-dep, exactly like the hashing algorithm above; a test
 * holds the two in lockstep). Per-language always beats shared:
 *
 *   1. EXPO_PUBLIC_BOOSTHIS_PROJECT_KEY_RN / BOOSTHIS_PROJECT_KEY_RN (env)
 *   2. boosthis.config.json -> ingest.projectKeys.rn
 *   3. boosthis.config.json -> ingest.inviteKey  (the shared key)
 */
function cleanKey(v) {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function envProjectKey() {
  return (
    cleanKey(process.env.EXPO_PUBLIC_BOOSTHIS_PROJECT_KEY_RN) ??
    cleanKey(process.env.BOOSTHIS_PROJECT_KEY_RN)
  );
}

function effectiveProjectKey(cfg) {
  const env = envProjectKey();
  if (env) return { key: env, source: "environment" };
  const perLanguage = cleanKey(cfg?.ingest?.projectKeys?.[RUNTIME_NAME]);
  if (perLanguage) {
    return { key: perLanguage, source: "React Native key in boosthis.config.json" };
  }
  const shared = cleanKey(cfg?.ingest?.inviteKey);
  if (shared) return { key: shared, source: "shared key in boosthis.config.json" };
  return { key: null, source: "not set anywhere" };
}

// The SAME 8-character fingerprint the Boosthis dashboard shows next to a key,
// so a developer can match what this app sends against what the dashboard
// lists. Never prints the key itself.
function keyFingerprint(key) {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

const DEFAULT_CONFIG = {
  version: VERSION,
  ingest: { url: "", token: "", inviteKey: "" },
  budgets: {
    screenP75Ms: 500,
    coldStartP75Ms: 2000,
    scoreFloor: 60,
    perceptionFloor: 70,
  },
  sampling: { prodSamplePercent: 5, maxSamplesPerHour: 600 },
};

const ROOT_SNIPPET = `// ─── Boosthis v1.0 — paste at the top of your root layout component ───
import {
  markBoot,
  useFidSampler,
  useLongSessionDiagnostic,
} from "@workspace/boosthis-runtime-rn";
import { InteractionManager, View } from "react-native";
import { useEffect } from "react";

export default function RootLayout() {
  const { panHandlers } = useFidSampler();
  useLongSessionDiagnostic();
  useEffect(() => {
    markBoot("rootRendered");
    const h = InteractionManager.runAfterInteractions(() => markBoot("interactive"));
    return () => h.cancel();
  }, []);
  return (
    <View style={{ flex: 1 }} {...panHandlers}>
      {/* your existing tree */}
    </View>
  );
}
`;

const SCREEN_SNIPPET = `// ─── Boosthis v1.0 — paste at the top of any tracked screen ───
import { useBoosthis } from "@workspace/boosthis-runtime-rn";

export default function MyScreen() {
  useBoosthis("MyScreen");
  // ... your screen body
}
`;

// The telemetry/registration snippet. For an EXPO app we wire `expo/fetch` as the
// default transport: RN's built-in XHR can silently drop a response on a reused
// iOS socket — the bug behind the Rival in-app sign-in incident — and expo/fetch
// (a WHATWG transport, Expo SDK 52+) does not. Because EVERY Boosthis call
// (telemetry, consent, AND sign-in / account-link) flows through this one
// fetchImpl, wiring it here makes sign-in reliable with zero extra work. A bare
// React Native app (no `expo` package) can't import expo/fetch, so it keeps the
// global fetch — see the "Custom transport" section of INSTALL.md if such an app
// ever hits the reused-socket bug.
function telemetrySnippet(framework) {
  const expo = framework === "expo";
  const importLine = expo
    ? `import { fetch as expoFetch } from "expo/fetch"; // Expo SDK 52+ — robust transport (see note)\n`
    : "";
  const fetchOpt = expo
    ? `  fetchOptions: { fetchImpl: expoFetch }, // route every Boosthis call (incl. sign-in) through expo/fetch\n`
    : "";
  return `// ─── Boosthis telemetry — invited (registered) apps only ───
${importLine}import boosthisConfig from "./boosthis.config.json";
import { enableTelemetry, resolveProjectKey } from "@workspace/boosthis-runtime-rn";

enableTelemetry({
  installId: "<your-stable-uuid-v4>",
  inviteKey: resolveProjectKey(boosthisConfig), // this app's own project key (see boosthis.config.json)
  issuesOnly: true, // report only privacy-safe issue signatures
  integrity: boosthisConfig.integrity, // tamper-evidence; written by \`boosthis verify .\`
${fetchOpt}});
`;
}

/* ─── Helpers ───────────────────────────────────────────────────────── */

const COLORS = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

function log(msg) { process.stdout.write(msg + "\n"); }
function ok(msg) { log("  " + COLORS.green("✓") + " " + msg); }
function warn(msg) { log("  " + COLORS.yellow("!") + " " + msg); }
function err(msg) { log("  " + COLORS.red("✗") + " " + msg); }
function info(msg) { log("  " + COLORS.cyan("·") + " " + msg); }

function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

/* ─── Tamper-evidence helpers (mirror of scripts/kit-integrity.mjs) ────── */

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// Overall hash over per-file entries; order-independent (sorted by path first).
// MUST match manifestHashOf() in scripts/kit-integrity.mjs byte-for-byte.
function manifestHashOf(entries) {
  const canon = entries
    .slice()
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => `${f.path}\u0000${f.sha256}\u0000${f.size}`)
    .join("\n");
  return createHash("sha256").update(canon).digest("hex");
}

// Files/dirs that legitimately appear inside Boosthis-owned folders without being
// part of the kit (build/dep/editor noise) — never counted as "extra".
const EXTRA_IGNORE_DIRS = new Set(["node_modules", ".git", "generated", "__tests__"]);
function isIgnoredExtra(name) {
  if (EXTRA_IGNORE_DIRS.has(name)) return true;
  if (name.endsWith(".tsbuildinfo")) return true;
  if (name === ".DS_Store") return true;
  return false;
}

function detectFramework(pkg) {
  if (!pkg) return null;
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if (deps["expo"]) return "expo";
  if (deps["react-native"]) return "react-native";
  return null;
}

/* ─── Endpoint / transport lint (the Rival sign-in incident class) ─────── */

// Mirror of `resolveTelemetryEndpoint`'s acceptance rule (src/telemetry.ts),
// kept zero-dep + inline so the CLI runs the moment it is linked. An absolute
// http(s) URL whose authority carries NO query/fragment/whitespace/slash, plus
// an optional path. `new URL()` is intentionally avoided (Node has it, but this
// stays a byte-for-byte mirror of the on-device parser).
const ENDPOINT_RE = /^(https?):\/\/([^/?#\s]+)(\/[^?#\s]*)?$/i;

// Common "I forgot to fill this in" tokens. A TRUTHY placeholder is the exact
// footgun behind the shipped-dead-host incident: it defeats the `value || DEFAULT`
// fallback and a build silently points at a host that 404s.
const PLACEHOLDER_RE =
  /(^|[^a-z])(replace[_-]?me|your[_-]?(app|api|url|host|domain|server)|changeme|placeholder|todo|xxx+|foo|bar)([^a-z]|$)|<[^>]+>|example\.(com|org|net)/i;

/**
 * Classify one endpoint-ish string. Returns `{ fail, findings[] }` where each
 * finding is `{ level: "err"|"warn"|"info", msg }`. When `hard` is true a
 * placeholder/malformed/creds value is an ERROR that fails the doctor (used for
 * Boosthis's own `ingest.url`); otherwise everything is advisory (used for the
 * app's EXPO_PUBLIC_* URLs, which may legitimately point anywhere).
 */
function lintEndpointValue(label, raw, hard) {
  const findings = [];
  const original = String(raw);
  const trimmed = original.trim();
  if (trimmed === "") return { fail: false, findings };
  let fail = false;
  if (trimmed !== original) {
    findings.push({ level: "warn", msg: `${label} has surrounding whitespace — trim it.` });
  }
  if (PLACEHOLDER_RE.test(trimmed)) {
    findings.push({
      level: hard ? "err" : "warn",
      msg: `${label} looks like a placeholder (\`${trimmed}\`). A truthy placeholder defeats the \`|| DEFAULT\` fallback and ships a dead host — clear it (use the built-in endpoint) or set a real https URL.`,
    });
    if (hard) fail = true;
    return { fail, findings };
  }
  const m = ENDPOINT_RE.exec(trimmed);
  if (!m) {
    findings.push({
      level: hard ? "err" : "warn",
      msg: `${label} (\`${trimmed}\`) is not an absolute http(s) URL — a relative or malformed value cannot be reached on-device.`,
    });
    if (hard) fail = true;
    return { fail, findings };
  }
  const authority = m[2];
  if (authority.includes("@")) {
    findings.push({
      level: hard ? "err" : "warn",
      msg: `${label} embeds credentials (\`user:pass@host\`) — never place a secret in an endpoint URL.`,
    });
    if (hard) fail = true;
  }
  if (/^boosten\.replit\.app$/i.test(authority)) {
    findings.push({
      level: "warn",
      msg: `${label} points at boosten.replit.app (DEAD / 404) — use www.boosthis.com.`,
    });
  }
  return { fail, findings };
}

function emitFindings(findings) {
  for (const f of findings) {
    if (f.level === "err") err(f.msg);
    else if (f.level === "warn") warn(f.msg);
    else info(f.msg);
  }
}

// Minimal `.env` parser: `KEY=VALUE` per line, `#` comments, optional quotes.
function parseDotEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

// Bounded, depth-limited source walk for `enableTelemetry(` call sites. Skips
// dependency/build/native dirs and caps the number of files read so the doctor
// stays fast even on a large app. Returns `[{ path, wired }]` where `wired` is a
// same-file heuristic (does the file also reference a custom transport?).
const SRC_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SCAN_IGNORE_DIRS = new Set([
  "node_modules", ".git", ".expo", ".expo-shared", "ios", "android",
  "dist", "build", ".next", "generated", "coverage", "__tests__",
]);
function scanForEnableTelemetry(root) {
  const hits = [];
  let scanned = 0;
  const MAX_FILES = 4000;
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > 6) continue;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      if (scanned >= MAX_FILES) return hits;
      const name = ent.name;
      if (ent.isDirectory()) {
        if (SCAN_IGNORE_DIRS.has(name) || name.startsWith(".")) continue;
        stack.push({ dir: join(dir, name), depth: depth + 1 });
        continue;
      }
      const dot = name.lastIndexOf(".");
      if (dot < 0 || !SRC_EXT.has(name.slice(dot))) continue;
      scanned++;
      let text;
      try { text = readFileSync(join(dir, name), "utf8"); } catch { continue; }
      if (text.includes("enableTelemetry(")) {
        const wired = /fetchImpl|expo\/fetch|fetchOptions/.test(text);
        hits.push({ path: relative(root, join(dir, name)) || name, wired });
      }
    }
  }
  return hits;
}

// Split argv into positional args and known flags. Supports both
// `--invite-key foo` and `--invite-key=foo`; unknown `--flags` are ignored
// (and never mistaken for the target path).
function parseArgs(argv) {
  const positional = [];
  const flags = { force: false, inviteKey: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") { flags.force = true; continue; }
    // "--project-key" is the documented name; "--invite-key" stays accepted
    // for back-compat with older guides and scripts.
    if (a === "--project-key" || a === "--invite-key") { flags.inviteKey = argv[++i]; continue; }
    if (a.startsWith("--project-key=")) {
      flags.inviteKey = a.slice("--project-key=".length);
      continue;
    }
    if (a.startsWith("--invite-key=")) {
      flags.inviteKey = a.slice("--invite-key=".length);
      continue;
    }
    if (a.startsWith("--")) continue; // ignore unknown flags
    positional.push(a);
  }
  return { positional, flags };
}

/* ─── Subcommand: init ──────────────────────────────────────────────── */

function cmdInit(argv) {
  const { positional, flags } = parseArgs(argv);
  const target = resolve(positional[0] ?? process.cwd());
  const force = flags.force;
  const inviteKey = flags.inviteKey;

  log("");
  log(COLORS.bold(`boosthis init`) + COLORS.dim(`  v${VERSION}`));
  log(COLORS.dim(`  target: ${target}`));
  log("");

  // 1. Verify it's an RN/Expo project.
  const pkgPath = join(target, "package.json");
  if (!existsSync(pkgPath)) {
    err(`No package.json at ${target}`);
    err("Run boosthis init inside a React Native or Expo project.");
    process.exit(1);
  }
  const pkg = readJsonSafe(pkgPath);
  const framework = detectFramework(pkg);
  if (!framework) {
    err("Could not find expo or react-native in dependencies.");
    err("Boosthis is a React Native toolkit — point it at an RN/Expo project.");
    process.exit(1);
  }
  ok(`Detected ${framework} project: ${pkg.name ?? "(unnamed)"}`);

  // 2. Write boosthis.config.json (idempotent). An existing config is kept
  //    as-is, EXCEPT that a freshly supplied --invite-key is always merged in
  //    (re-running with a new key is the whole point of the flag).
  const configPath = join(target, "boosthis.config.json");
  const existingCfg = existsSync(configPath) ? readJsonSafe(configPath) : null;
  if (existingCfg && !force) {
    if (inviteKey) {
      // A supplied key ALWAYS wins over whatever is already stored — that is
      // the whole point of passing one. It goes into THIS runtime's own slot,
      // so a codebase whose back end already reports under another key keeps
      // that key untouched and React Native becomes its own project. Nothing
      // is ever rotated or replaced.
      const prevShared = cleanKey(existingCfg.ingest?.inviteKey);
      const prevRn = cleanKey(existingCfg.ingest?.projectKeys?.[RUNTIME_NAME]);
      existingCfg.ingest = {
        ...(existingCfg.ingest ?? {}),
        projectKeys: {
          ...(existingCfg.ingest?.projectKeys ?? {}),
          [RUNTIME_NAME]: inviteKey,
        },
        // Only fill the shared slot when the codebase has none — never
        // overwrite a key another language is already reporting under.
        ...(prevShared ? {} : { inviteKey }),
      };
      writeFileSync(configPath, JSON.stringify(existingCfg, null, 2) + "\n", "utf8");
      ok(
        `Set the React Native project key in ${relative(target, configPath) || "boosthis.config.json"} (fingerprint ${keyFingerprint(inviteKey)}…).`,
      );
      if (prevRn && prevRn !== inviteKey) {
        info("It replaced the React Native key stored here before.");
      }
      if (prevShared && prevShared !== inviteKey) {
        info(
          `This codebase already reports under another project key (fingerprint ${keyFingerprint(prevShared)}…). That key is untouched — React Native now reports as its own project.`,
        );
      }
    } else {
      warn("boosthis.config.json already exists — keeping yours. Use --force to overwrite.");
      const existing = effectiveProjectKey(existingCfg);
      const hasOwn = !!cleanKey(existingCfg.ingest?.projectKeys?.[RUNTIME_NAME]);
      if (existing.key && !hasOwn && !envProjectKey()) {
        // The silent-inheritance moment: this app is about to register inside
        // a project that already exists. Say it out loud, with the fix.
        warn(
          `No React Native key was supplied, so this app will report under the ${existing.source} (fingerprint ${keyFingerprint(existing.key)}…) — the SAME project as whatever already uses it.`,
        );
        info("To give React Native its own project, re-run with --project-key <your key>.");
      }
    }
  } else {
    const cfg = {
      ...DEFAULT_CONFIG,
      ingest: {
        ...DEFAULT_CONFIG.ingest,
        ...(inviteKey
          ? { inviteKey, projectKeys: { [RUNTIME_NAME]: inviteKey } }
          : {}),
      },
    };
    writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
    ok(`Wrote ${relative(target, configPath) || "boosthis.config.json"}`);
    if (inviteKey) {
      info(`React Native project key fingerprint: ${keyFingerprint(inviteKey)}…`);
    }
  }

  // 3. Check that the runtime is reachable.
  const hasRuntime =
    !!(pkg.dependencies?.["@workspace/boosthis-runtime-rn"]) ||
    !!(pkg.devDependencies?.["@workspace/boosthis-runtime-rn"]);
  if (hasRuntime) {
    ok("Runtime package is declared in package.json.");
  } else {
    warn("Runtime package not declared yet. While Boosthis is private, add:");
    log("");
    log(COLORS.dim('      "@workspace/boosthis-runtime-rn": "workspace:*"'));
    log("");
    log("    to your dependencies, then run " + COLORS.bold("pnpm install") + ".");
  }

  // 4. Print snippets.
  log("");
  log(COLORS.bold("Next: paste these into your app"));
  log("");
  log(COLORS.dim("─── Root layout (app/_layout.tsx or App.tsx) ──────────────────────"));
  log(ROOT_SNIPPET);
  log(COLORS.dim("─── Any tracked screen ─────────────────────────────────────────────"));
  log(SCREEN_SNIPPET);

  // 5. Invite-key guidance — only when a key was supplied.
  if (inviteKey) {
    log(COLORS.dim("─── Telemetry (invited apps) ───────────────────────────────────────"));
    log(telemetrySnippet(framework));
    log(
      COLORS.bold("Project key wired.") +
        " Stored in boosthis.config.json → ingest.projectKeys.rn" +
        " (this runtime's own slot; the shared ingest.inviteKey is filled only" +
        " when the codebase does not already have one).",
    );
    info("That key authorizes telemetry consent (full scope: register + fetch fixes).");
    log("");
    info(
      "Three collectors start themselves, so the snippet above needs no " +
        "setting for them: the network wrapper (autoWrapNetwork), the " +
        "unhandled-error hooks (trackUnhandledErrors) and image weight " +
        "(trackImageWeight). Pass any of them `false` to refuse it — that " +
        "meter then SAYS it is switched off in this build rather than " +
        "claiming to measure.",
    );
    info(
      "The network wrapper reports how long this app's requests take and " +
        "how they ended, so the Network meter measures an ordinary app with " +
        "no calls to write.",
    );
    info(
      "It reports a duration and a coarse outcome and nothing else — there " +
        "is no field for a URL, host, path or status anywhere in that path.",
    );
    info(
      "It wraps the global fetch and XMLHttpRequest (what RN's own fetch " +
        "runs on). A transport you import and call directly, such as " +
        "expo/fetch, is measured by wrapping it once: " +
        "`export const fetch = wrapNetworkFetch(expoFetch)`.",
    );
    info(
      "Boosthis's own uploads are never counted as your app's traffic.",
    );
    info(
      "Drop the line to keep the meter manual; recordNetworkAttempt / " +
        "measureNetworkAttempt keep working. A call you time yourself with " +
        "measureNetworkAttempt is counted once even with the wrapper on; " +
        "recordNetworkAttempt records exactly what you hand it, so keep it " +
        "for transports the kit cannot see.",
    );
    log("");
    log("  " + COLORS.bold("For the MCP fix-fetch server, use a FIX-SCOPED key instead:"));
    info("A fix-scoped key can fetch per-rule fixes but CANNOT register installs —");
    info("safer to drop into an AI tool's env. Mint one:");
    log(COLORS.dim("      curl -sX POST https://www.boosthis.com/api/keys \\"));
    log(COLORS.dim("        -H 'content-type: application/json' -d '{\"scope\":\"fix\"}'"));
    info("Then expose it to the MCP server:");
    log(COLORS.dim("      export BOOSTHIS_INVITE_KEY=<fix-scoped-key>"));
    log("");
  }

  log(COLORS.bold("Done.") + " Edit budgets in boosthis.config.json to taste.");
  log(COLORS.dim("  Tip: run `boosthis doctor` after pasting to verify the wiring."));
  log(COLORS.dim("  Tip: pass `--project-key <key>` to wire a project key into the config."));
  log("");
}

/* ─── Subcommand: doctor ────────────────────────────────────────────── */

function cmdDoctor(argv) {
  const target = resolve(argv[0] ?? process.cwd());
  log("");
  log(COLORS.bold("boosthis doctor") + COLORS.dim(`  target: ${target}`));
  log("");

  let failed = 0;
  const check = (label, condition, hint) => {
    if (condition) { ok(label); } else { err(label); if (hint) info(hint); failed++; }
  };

  const pkg = readJsonSafe(join(target, "package.json"));
  check("package.json present", !!pkg, "Run boosthis doctor inside an RN/Expo project root.");

  const framework = detectFramework(pkg);
  check("expo or react-native dependency", !!framework);

  const hasRuntime =
    !!(pkg?.dependencies?.["@workspace/boosthis-runtime-rn"]) ||
    !!(pkg?.devDependencies?.["@workspace/boosthis-runtime-rn"]);
  check(
    "@workspace/boosthis-runtime-rn declared",
    hasRuntime,
    'Add "@workspace/boosthis-runtime-rn": "workspace:*" to dependencies.',
  );

  const hasConfig = existsSync(join(target, "boosthis.config.json"));
  check("boosthis.config.json present", hasConfig, "Run `boosthis init` to create one.");

  const hasManifest = existsSync(join(target, MANIFEST_FILENAME));
  if (hasManifest) {
    ok("boosthis-kit-manifest.json present");
    info("Run `boosthis verify .` to confirm Boosthis files are unmodified.");
  }

  // ─── Endpoint & transport wiring (the Rival sign-in incident class) ────
  log("");
  log(COLORS.dim("  Endpoint & transport"));

  // 1. Boosthis's own endpoint override (boosthis.config.json → ingest.url).
  //    Blank is GOOD — the kit uses its baked-in production endpoint. A truthy
  //    placeholder / relative / creds value is a hard failure.
  const doctorCfg = hasConfig ? readJsonSafe(join(target, "boosthis.config.json")) : null;
  const ingestUrl = doctorCfg?.ingest?.url;
  if (typeof ingestUrl === "string" && ingestUrl.trim() !== "") {
    const { fail, findings } = lintEndpointValue("ingest.url", ingestUrl, true);
    if (findings.length === 0) ok("ingest.url is a clean absolute endpoint.");
    else emitFindings(findings);
    if (fail) failed++;
  } else if (hasConfig) {
    info("ingest.url is blank → the kit uses its built-in production endpoint (fine).");
  }

  // 2. EXPO_PUBLIC_*URL values across .env files + eas.json build envs (advisory:
  //    these may legitimately be the app's own URLs, so findings are warnings).
  let urlVarsChecked = 0;
  let urlVarsFlagged = 0;
  const checkUrlVar = (label, val) => {
    if (typeof val !== "string" || val.trim() === "") return;
    if (!/url/i.test(label)) return;
    urlVarsChecked++;
    const { findings } = lintEndpointValue(label, val, false);
    if (findings.length) { emitFindings(findings); urlVarsFlagged += findings.length; }
  };
  for (const envName of [".env", ".env.local", ".env.development", ".env.production"]) {
    const p = join(target, envName);
    if (!existsSync(p)) continue;
    let text; try { text = readFileSync(p, "utf8"); } catch { continue; }
    for (const [k, v] of Object.entries(parseDotEnv(text))) {
      if (k.startsWith("EXPO_PUBLIC_")) checkUrlVar(`${envName} ${k}`, v);
    }
  }
  const eas = readJsonSafe(join(target, "eas.json"));
  if (eas && eas.build && typeof eas.build === "object") {
    for (const [profile, def] of Object.entries(eas.build)) {
      const env = def && def.env;
      if (env && typeof env === "object") {
        for (const [k, v] of Object.entries(env)) {
          if (k.startsWith("EXPO_PUBLIC_")) checkUrlVar(`eas.json build.${profile}.env.${k}`, v);
        }
      }
    }
  }
  // Dead-host catch-all across raw config text (app.json extra, eas.json, etc.).
  for (const cfgName of ["app.json", "app.config.json", "eas.json"]) {
    const p = join(target, cfgName);
    if (!existsSync(p)) continue;
    let text; try { text = readFileSync(p, "utf8"); } catch { continue; }
    if (/boosten\.replit\.app/i.test(text)) {
      warn(`${cfgName} references boosten.replit.app (DEAD / 404) — update it to www.boosthis.com.`);
      urlVarsFlagged++;
    }
  }
  if (urlVarsChecked > 0 && urlVarsFlagged === 0) {
    ok(`Checked ${urlVarsChecked} EXPO_PUBLIC_* URL value${urlVarsChecked === 1 ? "" : "s"} — all clean.`);
  }

  // 3. Expo transport wiring — on Expo, enableTelemetry() must route through a
  //    custom transport (expo/fetch). RN's built-in XHR can silently drop a
  //    response on a reused iOS socket — the Rival in-app sign-in bug.
  if (framework === "expo") {
    const hits = scanForEnableTelemetry(target);
    if (hits.length === 0) {
      info("No enableTelemetry() call found yet (telemetry is opt-in).");
    } else {
      const unwired = hits.filter((h) => !h.wired);
      if (unwired.length === 0) {
        ok("enableTelemetry() routes through a custom transport (fetchImpl / expo/fetch).");
      } else {
        for (const h of unwired) {
          warn(`${h.path} calls enableTelemetry() without a fetchImpl. On Expo, RN's XHR can silently drop responses on a reused iOS socket (the Rival sign-in bug).`);
        }
        info('Wire expo/fetch:  import { fetch as expoFetch } from "expo/fetch";');
        info("  enableTelemetry({ …, fetchOptions: { fetchImpl: expoFetch } });");
      }
    }
  }

  // ─── Duplicate React Native / React copies (the Vigil crash class) ─────
  // npm v7+ auto-installs peer dependencies: if a library's react/react-native
  // peer range doesn't match the host app's installed version, npm quietly
  // nests a SECOND copy under node_modules/<lib>/node_modules. Anything that
  // touches the never-initialized second copy crashes instantly (Modal render,
  // sign-in screen, "Invalid hook call"). Walk node_modules and fail loudly.
  if (existsSync(join(target, "node_modules"))) {
    log("");
    log(COLORS.dim("  Duplicate native-core copies"));
    for (const modName of ["react-native", "react"]) {
      const copies = findModuleCopies(target, modName);
      if (copies.length > 1) {
        err(`${copies.length} copies of ${modName} resolved in node_modules — this crashes apps at runtime.`);
        for (const c of copies) {
          info(`  ${c.rel}${c.version ? COLORS.dim(`  (${c.version})`) : ""}`);
        }
        info(`Align every dependency's ${modName} peer range with your app's version, then delete node_modules + the lockfile and reinstall.`);
        info(`Verify with \`npm ls ${modName}\` — exactly one resolution should remain. Rebuild the native app afterwards.`);
        failed++;
      } else if (copies.length === 1) {
        ok(`Exactly one ${modName} copy${copies[0].version ? ` (${copies[0].version})` : ""}.`);
      }
    }
  }

  log("");
  if (failed === 0) {
    log(COLORS.green(COLORS.bold("All checks passed.")));
  } else {
    log(COLORS.red(COLORS.bold(`${failed} check${failed === 1 ? "" : "s"} failed.`)));
    process.exit(1);
  }
  log("");
}

/**
 * Walk node_modules (nested installs included) for every distinct on-disk copy
 * of `modName`. Dot-directories (.bin, .pnpm virtual store, caches) are skipped
 * so pnpm's content store never false-positives; symlinked resolutions are
 * deduped by realpath, so "many links, one store dir" counts as ONE copy.
 * Depth- and volume-capped so a pathological tree can't hang the doctor.
 */
function findModuleCopies(target, modName) {
  const byRealPath = new Map();
  const budget = { dirs: 0 };
  const walk = (dir, depth) => {
    if (depth > 6 || budget.dirs > 5000) return;
    const nm = join(dir, "node_modules");
    if (!existsSync(nm)) return;
    let entries;
    try { entries = readdirSync(nm, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      budget.dirs++;
      const p = join(nm, e.name);
      if (e.name === modName) {
        const pkgPath = join(p, "package.json");
        if (existsSync(pkgPath)) {
          let real = p;
          try { real = realpathSync(p); } catch { /* keep the link path */ }
          if (!byRealPath.has(real)) {
            const pkg = readJsonSafe(pkgPath);
            byRealPath.set(real, {
              rel: relative(target, p) || p,
              version: typeof pkg?.version === "string" ? pkg.version : null,
            });
          }
        }
        continue;
      }
      if (e.name.startsWith("@")) {
        let scoped;
        try { scoped = readdirSync(p, { withFileTypes: true }); } catch { continue; }
        for (const s of scoped) {
          if (s.isDirectory() || s.isSymbolicLink()) walk(join(p, s.name), depth + 1);
        }
      } else {
        walk(p, depth + 1);
      }
    }
  };
  walk(target, 0);
  return [...byRealPath.values()];
}

/* ─── Subcommand: verify ────────────────────────────────────────────── */

function cmdVerify(argv) {
  const { positional, flags } = parseArgs(argv);
  const target = resolve(positional[0] ?? process.cwd());
  log("");
  log(COLORS.bold("boosthis verify") + COLORS.dim(`  target: ${target}`));
  log("");

  const manifestPath = join(target, MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) {
    err(`${MANIFEST_FILENAME} not found here.`);
    info("Point verify at the folder that contains the Boosthis kit, e.g.");
    info("  boosthis verify ./node_modules/@workspace/boosthis-runtime-rn/..");
    process.exit(1);
  }
  const manifest = readJsonSafe(manifestPath);
  if (!manifest || !Array.isArray(manifest.files)) {
    err(`${MANIFEST_FILENAME} is malformed.`);
    process.exit(1);
  }

  const listed = new Set(manifest.files.map((f) => f.path));
  let missing = 0;
  let changed = 0;
  let extra = 0;
  let verified = 0;
  const present = [];
  for (const f of manifest.files) {
    const full = join(target, f.path);
    if (!existsSync(full)) { missing++; continue; }
    const sha256 = sha256File(full);
    const size = statSync(full).size;
    present.push({ path: f.path, sha256, size });
    if (sha256 === f.sha256) verified++;
    else changed++;
  }

  // Bounded "extra file" scan: only directories that ACTUALLY contain a manifest
  // file are scanned (never the kit root or a shared parent like `lib/`), so a
  // consumer's own files and sibling packages are never flagged. An unexpected
  // file dropped into a Boosthis source folder is a soft warning only — an
  // unreferenced file cannot execute, so it never flips the persisted status (and
  // never the server kill-switch). Edits/removals of REAL files are the hard,
  // hash-backed tamper signals.
  const ownedDirs = new Set();
  for (const f of manifest.files) {
    const slash = f.path.lastIndexOf("/");
    if (slash > 0) ownedDirs.add(f.path.slice(0, slash));
  }
  for (const dir of ownedDirs) {
    const abs = join(target, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      if (isIgnoredExtra(name)) continue;
      const childAbs = join(abs, name);
      if (statSync(childAbs).isDirectory()) continue;
      if (!listed.has(dir + "/" + name)) extra++;
    }
  }

  // status reflects ONLY the zero-false-positive signals (missing/changed). This
  // is what the server trusts to promote `tampered`, so a stray extra file must
  // never break an honest install.
  const status = missing || changed ? "mismatch" : "ok";
  const reportedHash = manifestHashOf(present);

  if (verified) ok(`${verified} file(s) verified`);
  if (changed) err(`${changed} file(s) modified`);
  if (missing) err(`${missing} file(s) missing`);
  if (extra) warn(`${extra} unexpected file(s) in Boosthis-owned folders`);

  // Persist a coarse, privacy-safe result (no file names, no diffs) so the runtime
  // can forward it on its next entitlement check-in.
  const configPath = join(target, "boosthis.config.json");
  const cfg = existsSync(configPath) ? readJsonSafe(configPath) : null;
  if (cfg) {
    cfg.integrity = {
      status,
      manifestHash: reportedHash,
      kitVersion: manifest.version ?? null,
    };
    writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
    info(`Recorded integrity status (${status}) in boosthis.config.json.`);
  } else {
    warn("No boosthis.config.json — run `boosthis init` to enable check-in reporting.");
  }

  // ─── Which project key will this app send? ──────────────────────────────
  // Integrity used to be the whole of verify, so an app wired to the WRONG
  // project key passed cleanly and the developer only found out by staring at
  // an empty dashboard. Verify now says which key this app will actually send,
  // and FAILS when it is not the key setup was given.
  let keyMismatch = false;
  const supplied = cleanKey(flags.inviteKey);
  const effective = cfg
    ? effectiveProjectKey(cfg)
    : { key: envProjectKey(), source: "environment" };
  log("");
  if (effective.key) {
    info(
      `Project key this app will send: fingerprint ${keyFingerprint(effective.key)}… (${effective.source}).`,
    );
    const sharedKey = cleanKey(cfg?.ingest?.inviteKey);
    const rnKey = cleanKey(cfg?.ingest?.projectKeys?.[RUNTIME_NAME]);
    if (sharedKey && rnKey && sharedKey !== rnKey) {
      info(
        `This codebase also holds a shared key (fingerprint ${keyFingerprint(sharedKey)}…) for its other runtimes — React Native reports as its own project.`,
      );
    }
  } else {
    warn("No project key is set for React Native — this app cannot register.");
    info("Run: boosthis init . --project-key <your key>");
  }
  if (supplied) {
    if (!effective.key) {
      keyMismatch = true;
      err("The key you passed is not wired anywhere — this app would register under no key at all.");
    } else if (supplied !== effective.key) {
      keyMismatch = true;
      err(
        `WRONG PROJECT KEY. This app will report under fingerprint ${keyFingerprint(effective.key)}… (${effective.source}), not the key you passed (${keyFingerprint(supplied)}…).`,
      );
      info("Fix it with: boosthis init . --project-key <your key>");
      info("or set BOOSTHIS_PROJECT_KEY_RN (EXPO_PUBLIC_BOOSTHIS_PROJECT_KEY_RN in Expo).");
    } else {
      ok("Project key matches the one you passed.");
    }
  }

  log("");
  if (status === "ok" && !keyMismatch) {
    log(COLORS.green(COLORS.bold("Kit integrity OK.")));
    log("");
  } else if (status === "ok") {
    log(
      COLORS.red(
        COLORS.bold("Kit files are fine, but this app is wired to the wrong project key."),
      ),
    );
    log("");
    process.exit(1);
  } else {
    log(COLORS.red(COLORS.bold("Kit integrity MISMATCH — Boosthis-owned files changed.")));
    info("Do not edit Boosthis files. Restore them via the hosted Boosthis MCP,");
    info("then re-run `boosthis verify .`.");
    log("");
    process.exit(1);
  }
}

/* ─── Subcommand: help ──────────────────────────────────────────────── */

function cmdHelp() {
  log("");
  log(COLORS.bold("boosthis") + COLORS.dim(`  v${VERSION}  ·  React Native performance toolkit`));
  log("");
  log("  " + COLORS.bold("Usage:"));
  log("    boosthis <command> [args]");
  log("");
  log("  " + COLORS.bold("Commands:"));
  log("    init [path] [--project-key <key>]  Scaffold boosthis.config.json + snippets");
  log("    doctor [path] Verify an existing integration");
  log("    verify [path] [--project-key <key>]  Check kit files are unmodified AND");
  log("                  that this app reports under the project key you expect");
  log("    help          Show this message");
  log("    version       Print version");
  log("");
}

/* ─── Entry ─────────────────────────────────────────────────────────── */

const [, , cmd, ...rest] = process.argv;

switch (cmd) {
  case "init":    cmdInit(rest); break;
  case "doctor":  cmdDoctor(rest); break;
  case "verify":  cmdVerify(rest); break;
  case "version": case "--version": case "-v": log(VERSION); break;
  case "help":    case "--help":    case "-h": cmdHelp(); break;
  case undefined: cmdHelp(); process.exit(1); break;
  default:        err(`Unknown command: ${cmd}`); cmdHelp(); process.exit(1);
}
