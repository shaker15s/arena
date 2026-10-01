/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: AI-provider classification (React Native) ────────────────
 *
 * A destination is reduced on-device to a fixed numeric code. Hostnames are
 * compared here and are never returned by a reader or put on the wire.
 *
 * The 1-based position is the wire format. APPEND ONLY: never reorder or
 * delete an entry.
 */

export interface AiProviderEntry {
  readonly id: string;
  readonly hosts: readonly string[];
}

export const AI_PROVIDERS: readonly AiProviderEntry[] = [
  { id: "openai", hosts: ["api.openai.com"] },
  { id: "anthropic", hosts: ["api.anthropic.com"] },
  {
    id: "google",
    hosts: [
      "generativelanguage.googleapis.com",
      "aiplatform.googleapis.com",
      ".aiplatform.googleapis.com",
    ],
  },
  {
    id: "azure-openai",
    hosts: [".openai.azure.com", ".cognitiveservices.azure.com"],
  },
  { id: "aws-bedrock", hosts: [".amazonaws.com"] },
  { id: "mistral", hosts: ["api.mistral.ai", "codestral.mistral.ai"] },
  { id: "cohere", hosts: ["api.cohere.ai", "api.cohere.com"] },
  { id: "groq", hosts: ["api.groq.com"] },
  { id: "together", hosts: ["api.together.xyz", "api.together.ai"] },
  { id: "perplexity", hosts: ["api.perplexity.ai"] },
  { id: "deepseek", hosts: ["api.deepseek.com"] },
  { id: "xai", hosts: ["api.x.ai"] },
  { id: "fireworks", hosts: ["api.fireworks.ai"] },
  { id: "openrouter", hosts: ["openrouter.ai"] },
  { id: "replicate", hosts: ["api.replicate.com"] },
  {
    id: "huggingface",
    hosts: ["api-inference.huggingface.co", "router.huggingface.co"],
  },
  { id: "voyage", hosts: ["api.voyageai.com"] },
  { id: "cerebras", hosts: ["api.cerebras.ai"] },
  { id: "declared", hosts: [] },
] as const;

export const DECLARED_PROVIDER_CODE =
  AI_PROVIDERS.findIndex((p) => p.id === "declared") + 1;

const AWS_BEDROCK_PREFIXES = ["bedrock-runtime.", "bedrock."] as const;

export function aiProviderCode(host: unknown): number {
  try {
    const h = typeof host === "string" ? host.toLowerCase() : "";
    if (!h) return 0;
    for (let i = 0; i < AI_PROVIDERS.length; i++) {
      const entry = AI_PROVIDERS[i]!;
      for (const suffix of entry.hosts) {
        const hit = suffix.startsWith(".")
          ? h.endsWith(suffix) || h === suffix.slice(1)
          : h === suffix;
        if (!hit) continue;
        if (
          entry.id === "aws-bedrock" &&
          !AWS_BEDROCK_PREFIXES.some((p) => h.startsWith(p))
        ) {
          continue;
        }
        return i + 1;
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

export const MAX_DECLARED_AI_ENDPOINTS = 8;
const MAX_HOST_LENGTH = 253;

let declaredHosts: readonly string[] = [];
let envRead = false;

export function normaliseDeclaredEndpoint(raw: unknown): string | null {
  try {
    if (typeof raw !== "string") return null;
    let value = raw.trim().toLowerCase();
    if (!value || /\s/.test(value)) return null;
    if (value.includes("://")) {
      const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(value);
      if (!match) return null;
      value = match[1]!;
    } else {
      const slash = value.search(/[/?#]/);
      if (slash >= 0) value = value.slice(0, slash);
    }
    const at = value.lastIndexOf("@");
    if (at >= 0) value = value.slice(at + 1);
    if (value.startsWith("[")) {
      const close = value.indexOf("]");
      if (close < 0) return null;
      value = value.slice(1, close);
    } else {
      const colon = value.lastIndexOf(":");
      if (colon >= 0) value = value.slice(0, colon);
    }
    if (!value || value.length > MAX_HOST_LENGTH || value.includes("*")) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function environmentDeclarations(): string[] {
  const values: string[] = [];
  try {
    const env = typeof process === "object" ? process.env : undefined;
    const raw =
      env?.BOOSTHIS_AI_ENDPOINTS ?? env?.EXPO_PUBLIC_BOOSTHIS_AI_ENDPOINTS;
    if (typeof raw === "string") values.push(...raw.split(","));
  } catch {
    /* Expo builds may not provide process */
  }
  try {
    const raw = (globalThis as { BOOSTHIS_AI_ENDPOINTS?: unknown })
      .BOOSTHIS_AI_ENDPOINTS;
    if (typeof raw === "string") values.push(...raw.split(","));
  } catch {
    /* a frozen global is an empty declaration */
  }
  return values;
}

function rebuild(extra: readonly unknown[]): void {
  const out: string[] = [];
  for (const candidate of [...environmentDeclarations(), ...extra]) {
    const host = normaliseDeclaredEndpoint(candidate);
    if (!host || out.includes(host)) continue;
    if (out.length >= MAX_DECLARED_AI_ENDPOINTS) break;
    out.push(host);
  }
  declaredHosts = out;
}

function ensureEnvRead(): void {
  if (envRead) return;
  envRead = true;
  rebuild([]);
}

export function setDeclaredAiEndpoints(list: unknown): number {
  envRead = true;
  rebuild(Array.isArray(list) ? list : list == null ? [] : [list]);
  return declaredHosts.length;
}

export function declaredAiEndpointCount(): number {
  ensureEnvRead();
  return declaredHosts.length;
}

export function aiProviderCodeOrDeclared(host: unknown): number {
  const known = aiProviderCode(host);
  if (known !== 0) return known;
  try {
    ensureEnvRead();
    const h = typeof host === "string" ? host.toLowerCase() : "";
    return h && declaredHosts.includes(h) ? DECLARED_PROVIDER_CODE : 0;
  } catch {
    return 0;
  }
}

export function _resetDeclaredAiEndpointsForTests(): void {
  declaredHosts = [];
  envRead = false;
}