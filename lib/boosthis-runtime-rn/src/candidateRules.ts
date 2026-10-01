/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: candidate rules ──────────────────────────────────────
 *
 * A "candidate rule" is a recurring performance signature that Boosthis
 * has observed but which does NOT map to any rule in the existing
 * rule book. The idea: when the engine sees the same kind of finding
 * fire repeatedly across multiple snapshots, that's a strong signal
 * there's a real, generalizable perf pattern worth turning into a
 * named rule.
 *
 * This is the honest, privacy-preserving version of "Boosthis learns
 * new rules from future projects":
 *
 *   1. Detectors emit findings (ghost-mount, thundering-herd, …).
 *   2. We hash the finding into a signature — no screen names that
 *      contain user data, no values, no code. Just kind + bucketed
 *      severity + occurrence count.
 *   3. If the same signature is seen ≥ MIN_OCCURRENCES times locally,
 *      it surfaces in the dashboard as a "candidate rule" the user
 *      can review.
 *   4. If — and ONLY if — the user has opted into telemetry, the
 *      signature is auto-submitted to the Boosthis server the moment
 *      it crosses the local recurrence threshold. The host app does
 *      not have to call anything; the runtime registers a submitter
 *      via `setCandidateSubmitter` at startup and `ingestFindings`
 *      fires it for any candidate whose status is still `new`. On
 *      success the candidate is marked `submitted` so we don't
 *      re-upload it.
 *
 * NO unreviewed rule is ever auto-shipped. The "learning" is the
 * shortlisting; the human-in-the-loop maintainer review is what
 * promotes a candidate into the real rule book. See PRIVACY.md.
 *
 * Storage: in-memory ring buffer + a single platform-storage key so
 * candidates persist across app restarts. Bounded to MAX_CANDIDATES
 * to keep memory + storage cost predictable.
 */

import type { CrossCuttingFinding } from "./perfDiagnose";
import { platform } from "./perfPlatform";
import { isProblemKind } from "./problemKinds";

const STORAGE_KEY = "boosthis:candidate-rules:v1";
const MAX_CANDIDATES = 100;
const MIN_OCCURRENCES_TO_SURFACE = 2;

export type CandidateStatus = "new" | "promoted-local" | "submitted";

export interface CandidateRule {
  /** Stable local id derived from the signature. */
  id: string;
  /** Privacy-safe fingerprint: `<kind>:<bucket>:<countBucket>`. No values. */
  signature: string;
  /** Detector kind that produced this finding. */
  kind: CrossCuttingFinding["kind"];
  /** Bucketed severity ("low" | "med" | "high") based on p95. */
  severityBucket: "low" | "med" | "high";
  /** First wall-clock time this signature was seen. */
  firstSeenAt: number;
  /** Most recent wall-clock time. */
  lastSeenAt: number;
  /** How many times this exact signature has fired. */
  occurrences: number;
  /** Safe, generic hint pulled from the originating finding. */
  exampleHint: string;
  /** Lifecycle state. Server upload sets `submitted`. */
  status: CandidateStatus;
}

function bucketSeverity(p95: number): "low" | "med" | "high" {
  if (p95 <= 100) return "low";
  if (p95 <= 500) return "med";
  return "high";
}

function bucketCount(count: number): string {
  if (count < 3) return "<3";
  if (count < 10) return "<10";
  if (count < 50) return "<50";
  return "50+";
}

/** Build the privacy-safe signature. We intentionally drop the
 *  `name` field of the finding (which might be a screen name carrying
 *  user-supplied content) and keep only the kind + severity + count
 *  bucket. The signature is what gets persisted and what — only
 *  on telemetry opt-in — could later be uploaded for aggregation. */
export function signatureFor(finding: CrossCuttingFinding): string {
  const sev = bucketSeverity(finding.p95);
  const ct = bucketCount(finding.count);
  return `${finding.kind}:${sev}:${ct}`;
}

function safeHashId(input: string): string {
  // Cheap stable hash — no crypto dep, no PII risk because input is
  // already the signature (no user values). Used purely as a stable
  // map key for storage.
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (h * 33) ^ input.charCodeAt(i);
  return "cr_" + (h >>> 0).toString(36);
}

/** Replace the persisted candidate set with the given list. Bounded. */
async function writeAll(list: CandidateRule[]): Promise<void> {
  try {
    const trimmed = list.slice(0, MAX_CANDIDATES);
    await platform().storage.set(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Storage is best-effort. A failed write just means the next
    // ingest call rebuilds the in-memory view from whatever
    // persisted last.
  }
}

/** Read the persisted candidate set. Safe — returns [] on any error. */
export async function listCandidateRules(): Promise<CandidateRule[]> {
  try {
    const raw = await platform().storage.get(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is CandidateRule =>
        c &&
        typeof c.id === "string" &&
        typeof c.signature === "string" &&
        typeof c.occurrences === "number",
    );
  } catch {
    return [];
  }
}

/** Network submitter registered by the host app at startup. When
 *  telemetry is enabled, the mobile app wires this to
 *  `telemetryClient.transmitCandidates`. When telemetry is off, no
 *  submitter is registered and nothing leaves the device. */
export type CandidateSubmitter = (
  signatures: readonly {
    signature: string;
    kind: string;
    severityBucket: "low" | "med" | "high";
    countBucket: string;
    occurrences: number;
  }[],
) => Promise<number>;

let activeSubmitter: CandidateSubmitter | null = null;

/** Register an auto-submitter. Pass `null` to clear (e.g. on opt-out). */
export function setCandidateSubmitter(submitter: CandidateSubmitter | null): void {
  activeSubmitter = submitter;
}

/* ─── Fix-resolution detection ──────────────────────────────────────
 *
 * Boosthis reports not just *issues* but *fixes*: when a rule kind that
 * was previously firing at a worse severity is later observed only at a
 * better severity, a fix was applied. We emit a privacy-safe resolution
 * signal — the rule/detector kind plus the bucketed before→after rating.
 * NEVER the code, the diff, screen names, or raw values. This is the
 * honest, leak-proof version of "Boosthis sees how the AI resolved it":
 * we report *that* the rule's area improved and *which* rule, not the
 * developer's source.
 */

const BASELINE_STORAGE_KEY = "boosthis:rule-baselines:v1";

type SeverityBucket = "low" | "med" | "high";
const SEV_RANK: Record<SeverityBucket, number> = { low: 0, med: 1, high: 2 };

type SampleRating = "good" | "needs-work" | "poor";
function severityToRating(sev: SeverityBucket): SampleRating {
  return sev === "high" ? "poor" : sev === "med" ? "needs-work" : "good";
}

/** Network submitter for fix-resolution signals. Wired by the telemetry
 *  client exactly like {@link CandidateSubmitter}: registered on opt-in,
 *  cleared on opt-out so nothing leaves the device after the user opts
 *  out. Payload carries only rule kind + bucketed before→after rating. */
export type ResolutionSubmitter = (
  resolutions: readonly {
    ruleId: string;
    kind: string;
    beforeRating: SampleRating;
    afterRating: SampleRating;
    occurrences: number;
    severityBucket?: SeverityBucket;
    countBucket?: string;
  }[],
) => Promise<number>;

let activeResolutionSubmitter: ResolutionSubmitter | null = null;

/** Register the resolution auto-submitter. Pass `null` to clear. */
export function setResolutionSubmitter(
  submitter: ResolutionSubmitter | null,
): void {
  activeResolutionSubmitter = submitter;
}

/** Per-kind worst severity ever observed. Used only to detect when a
 *  rule's severity later improves. Contains no user data — just rule
 *  kinds mapped to a low/med/high bucket. */
async function readBaselines(): Promise<Record<string, SeverityBucket>> {
  try {
    const raw = await platform().storage.get(BASELINE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, SeverityBucket> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === "low" || v === "med" || v === "high") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

async function writeBaselines(
  baselines: Record<string, SeverityBucket>,
): Promise<void> {
  try {
    await platform().storage.set(
      BASELINE_STORAGE_KEY,
      JSON.stringify(baselines),
    );
  } catch {
    // Best-effort, same policy as the candidate store.
  }
}

/** Module-level dedupe: if the dashboard polls every 2s with the
 *  same findings, we must NOT increment occurrences each poll —
 *  otherwise "recurrence" reflects refresh cadence, not real
 *  recurrence. We hash the finding set and skip if unchanged. */
let lastIngestKey: string | null = null;

/** Test-only: clear the dedupe key so successive ingests in a single
 *  test process behave as independent observations. */
export function _resetIngestDedupeForTests(): void {
  lastIngestKey = null;
}

function fingerprintFindings(findings: CrossCuttingFinding[]): string {
  return findings
    .map((f) => `${f.kind}|${f.name}|${Math.round(f.p95)}|${f.count}`)
    .sort()
    .join("\n");
}

/**
 * Ingest the latest detector findings: increment counts for known
 * signatures, create new candidates for unseen ones, persist.
 *
 * Pure-ish — caller passes in the current findings, we read+merge+write.
 * Returns the updated list (already filtered to surfaceable candidates).
 *
 * Polling-safe: consecutive calls with an identical finding set
 * (same kinds + names + p95 + counts) are treated as the same
 * observation and do NOT inflate occurrence counts.
 */
export async function ingestFindings(
  observed: CrossCuttingFinding[],
): Promise<CandidateRule[]> {
  // Only the shared vocabulary travels. A kind nobody else spells the same way
  // could never group with the same problem found by another language, so it is
  // dropped here rather than accumulated and uploaded. Dropping (not throwing)
  // is deliberate: bookkeeping must never break the host. The build guard in
  // scripts/src/__tests__/kitProblemReporting.test.ts is what stops an off-list
  // detector going unnoticed. See docs/kit-problem-reporting-contract.md.
  const findings = observed.filter((f) => isProblemKind(f.kind));
  if (findings.length === 0) return listSurfaceable(await listCandidateRules());
  const key = fingerprintFindings(findings);
  if (key === lastIngestKey) {
    return listSurfaceable(await listCandidateRules());
  }
  lastIngestKey = key;
  const now = Date.now();
  const existing = await listCandidateRules();
  const byId = new Map(existing.map((c) => [c.id, c]));

  for (const f of findings) {
    const sig = signatureFor(f);
    const id = safeHashId(sig);
    const prev = byId.get(id);
    if (prev) {
      byId.set(id, {
        ...prev,
        lastSeenAt: now,
        occurrences: prev.occurrences + 1,
      });
    } else {
      byId.set(id, {
        id,
        signature: sig,
        kind: f.kind,
        severityBucket: bucketSeverity(f.p95),
        firstSeenAt: now,
        lastSeenAt: now,
        occurrences: 1,
        exampleHint: f.hint,
        status: "new",
      });
    }
  }

  // Most-recently-seen first, capped.
  const merged = [...byId.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  await writeAll(merged);

  // ── Fix-resolution detection ──────────────────────────────────────
  // Compare each rule kind's current worst severity against the worst
  // severity we've ever recorded. A strict improvement means a fix
  // landed; emit a privacy-safe resolution (rule kind + before→after
  // rating only). We lower the stored baseline ONLY after a successful
  // submit so a transient network failure retries on the next pass.
  const baselines = await readBaselines();
  let baselinesChanged = false;
  const currentWorst: Record<string, SeverityBucket> = {};
  const currentCount: Record<string, number> = {};
  for (const f of findings) {
    const sev = bucketSeverity(f.p95);
    const prev = currentWorst[f.kind];
    if (!prev || SEV_RANK[sev] > SEV_RANK[prev]) currentWorst[f.kind] = sev;
    currentCount[f.kind] = Math.max(currentCount[f.kind] ?? 0, f.count);
  }
  const resolved: {
    ruleId: string;
    kind: string;
    beforeRating: SampleRating;
    afterRating: SampleRating;
    occurrences: number;
    severityBucket: SeverityBucket;
    countBucket: string;
  }[] = [];
  for (const [kind, sev] of Object.entries(currentWorst)) {
    const worst = baselines[kind];
    if (worst && SEV_RANK[sev] < SEV_RANK[worst]) {
      // Improvement — defer baseline lowering until the submit succeeds.
      resolved.push({
        ruleId: kind,
        kind,
        beforeRating: severityToRating(worst),
        afterRating: severityToRating(sev),
        occurrences: 1,
        // Privacy-safe "circumstances" so the community matcher can weight this
        // proven fix toward similar pages: the severity the issue held BEFORE
        // the fix, plus the bucketed occurrence count. No raw values, no code.
        severityBucket: worst,
        countBucket: bucketCount(currentCount[kind] ?? 0),
      });
    } else if (!worst || SEV_RANK[sev] > SEV_RANK[worst]) {
      // New or worsened — record/raise the worst-ever baseline now.
      baselines[kind] = sev;
      baselinesChanged = true;
    }
  }
  if (resolved.length > 0 && activeResolutionSubmitter) {
    try {
      const accepted = await activeResolutionSubmitter(resolved);
      if (accepted > 0) {
        for (const r of resolved.slice(0, accepted)) {
          baselines[r.ruleId] = currentWorst[r.ruleId]!;
          baselinesChanged = true;
        }
      }
    } catch {
      // Best-effort. Baseline is left untouched so the improvement is
      // retried on the next observation once connectivity returns.
    }
  }
  if (baselinesChanged) await writeBaselines(baselines);

  // Auto-submit: any surfaceable candidate that's still `new` is a
  // signature that just crossed the local threshold. If telemetry is
  // on (host registered a submitter), upload it now and mark as
  // submitted so we don't re-send it. If telemetry is off,
  // activeSubmitter is null and nothing leaves the device.
  if (activeSubmitter) {
    const toSubmit = listSurfaceable(merged).filter(
      (c) => c.status === "new",
    );
    if (toSubmit.length > 0) {
      const payload = toSubmit.map((c) => ({
        signature: c.signature,
        kind: c.kind as string,
        severityBucket: c.severityBucket,
        countBucket: c.signature.split(":")[2] ?? "<3",
        occurrences: c.occurrences,
      }));
      try {
        const accepted = await activeSubmitter(payload);
        if (accepted > 0) {
          const submittedIds = new Set(
            toSubmit.slice(0, accepted).map((c) => c.id),
          );
          const after = merged.map((c) =>
            submittedIds.has(c.id) ? { ...c, status: "submitted" as const } : c,
          );
          await writeAll(after);
          return listSurfaceable(after);
        }
      } catch {
        // Best-effort. Leave the candidate as `new` so the next
        // observation retries automatically.
      }
    }
  }

  return listSurfaceable(merged);
}

/** Filter to candidates that have hit the minimum recurrence
 *  threshold — these are the ones worth showing the user. */
export function listSurfaceable(all: CandidateRule[]): CandidateRule[] {
  return all.filter((c) => c.occurrences >= MIN_OCCURRENCES_TO_SURFACE);
}

/** User accepted a candidate — mark it locally promoted. Does not
 *  edit the shipped rule book. (That's a maintainer release step.) */
export async function promoteCandidateLocal(id: string): Promise<void> {
  const all = await listCandidateRules();
  const next = all.map((c) =>
    c.id === id ? { ...c, status: "promoted-local" as const } : c,
  );
  await writeAll(next);
}

/** Mark candidate as submitted (call after successful server POST). */
export async function markCandidateSubmitted(id: string): Promise<void> {
  const all = await listCandidateRules();
  const next = all.map((c) =>
    c.id === id ? { ...c, status: "submitted" as const } : c,
  );
  await writeAll(next);
}

/** Wipe all candidates AND the rule-severity baselines. Used by
 *  `telemetry.forget()` paths so nothing Boosthis-shaped is left behind. */
export async function clearAllCandidates(): Promise<void> {
  try {
    await platform().storage.remove(STORAGE_KEY);
  } catch {
    // Best-effort.
  }
  try {
    await platform().storage.remove(BASELINE_STORAGE_KEY);
  } catch {
    // Best-effort.
  }
}

/** Test/debug helper. */
export const _candidateInternals = {
  STORAGE_KEY,
  MAX_CANDIDATES,
  MIN_OCCURRENCES_TO_SURFACE,
  bucketSeverity,
  bucketCount,
  safeHashId,
};
