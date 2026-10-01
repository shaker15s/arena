/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
// Static import, not a lazy require(): perfNovelDetectors only `import type`s
// from this file, so there is no runtime cycle to dodge, and a require() throws
// `require is not defined` on any host that loads the kit as ES modules.
import { computePerceptionScore } from "./perfNovelDetectors";
import { InvertedAxisBandError } from "./axisScoring";

export interface PerfRow {
  key:   string;   // e.g. "screen:tabs/profile" or "event:phase:tabs/profile:afterCommit"
  count: number;
  p50:   number;
  p95:   number;
  max:   number;
  last:  number;
  /** Tail latency (99th percentile). Optional — absent on rows computed by
   *  older runtimes, so every consumer must tolerate `undefined`. */
  p99?:  number;
  /** Sample standard deviation of the durations (ms, rounded). Together with
   *  p99/p50 this separates "steadily slow" from "usually fine but spikes". */
  stdev?: number;
}

export interface PhaseEntry {
  phase: string;
  ms:    number;     // last observed elapsed-since-mount for this phase
  p95:   number;     // p95 across all mounts of this screen
  count: number;     // how many times this phase was recorded
}

export type ScreenPattern =
  | "snappy"               // total < 200ms — nothing to do
  | "single-sync-block"    // setTimeout(0/100/300) all fire ≈ together → JS busy continuously
  | "deferred-work-hump"   // fast commit but big gap before idle timers → heavyReady gate doing one fat block
  | "interaction-wait"     // JS idle but InteractionManager waits → animation holding the handle
  | "heavy-commit"         // beforeReturn → afterCommit gap > 200ms → heavy children
  | "heavy-contexts"       // renderStart → afterContexts > 40% of total → too many Providers
  | "heavy-memos"          // afterContexts → afterMemos > 100ms → expensive useMemo on first paint
  | "unknown";             // not enough phase data to classify

export interface ScreenDiagnosis {
  screen:    string;
  totalMs:   number;             // last value of the deepest phase recorded
  ladder:    PhaseEntry[];       // ordered renderStart → afterIM
  worstGap:  { from: string; to: string; ms: number } | null;
  pattern:   ScreenPattern;
  hints:     string[];           // prescriptive next-step advice
  mounts:    number;             // how many times this screen mounted in the session
  /** Perception-adjusted score (0-100) — raw score with the
   *  NAV_ANIMATION_MASK_MS occlusion window subtracted from TTI.
   *  Optional because pre-existing snapshots don't carry it.
   *  See lib/perfNovelDetectors.ts → computePerceptionScore. */
  perceptionScore?: number;
}

/**
 * A non-screen finding — surfaces patterns Boosthis observes across the
 * full event log (press handlers, nav transitions, etc.) rather than
 * within a single screen's mount ladder.
 */
export interface CrossCuttingFinding {
  kind:
    | "slow-press-handler"
    | "slow-nav"
    | "remount-storm-global"
    | "slow-api"          // single network endpoint with high p95
    | "failing-api"       // endpoint returning errors with non-trivial frequency
    | "regression"        // a phase or row got materially slower vs baseline
    | "render-monolith"   // slow screen with NO slow-api → render-side cause
    | "post-commit-effect-storm" // afterCommit fast but JS pinned post-commit → effect storm
    // ─── Novel detectors (lib/perfNovelDetectors.ts) — Boosthis-only,
    // no equivalent in Sentry / Firebase / Flashlight / Lighthouse:
    | "ghost-mount"            // screen mounted+unmounted in < 200ms (wasted work)
    | "api-thundering-herd"    // ≥3 distinct APIs in <50ms cluster (refetch storm)
    | "stranded-interval"      // screen-tagged event fired after unmount (timer leak)
    | "render-storm"           // ≥5 autonomous re-renders in <1s, no interaction (dev-only)
    | "rage-tap"               // ≥3 rapid taps in one spot while the screen was unresponsive (frustration)
    | "eager-list-mount"       // a scroll container mounted a whole collection in one commit (release-safe)
    // ─── Cross-runtime live detectors (Node + Python; lib/*/liveDetectors) —
    // no RN equivalent, listed here so the server allowlists (which mirror this
    // union) and the Ask-Boosthis digest stay documented-consistent:
    | "retry-storm"            // same outbound host hammered many times with no backoff
    | "idle-burn"              // event loop / CPU busy while no request was in flight
    // ─── AI-call findings (Node; lib/boosthis-runtime-node/src/aiCalls.ts) —
    // what an app's calls to a model provider cost it in waiting, retries and
    // repeated prompts. No RN equivalent (a phone app calls the app’s own
    // server, not the provider), listed here for the same allowlist-mirror
    // reason:
    | "ai-no-timeout"          // a model call with no time limit on it at all
    | "ai-retry-no-backoff"    // retried immediately, with no widening gap
    | "ai-serial-calls"        // independent model calls made one after another
    | "ai-duplicate-prompt"    // the same prompt paid for more than once
    | "ai-cache-cold"          // large prompts that never hit the provider’s cache
    | "ai-stream-usage-missing" // streamed answers that never report their usage
    // ─── Cache-and-repeat waste (Node; lib/boosthis-runtime-node/src/
    // cacheDirectives.ts) — what this app's OWN replies tell a browser or a
    // hosting platform about caching. No RN equivalent (a phone app serves
    // no replies), listed here for the same allowlist-mirror reason:
    | "cache-headers-missing"  // most replies carry no cache instruction at all
    | "cache-never-store"      // a blanket never-cache instruction on nearly everything
    | "cache-no-revalidator"   // cacheable, but with no version stamp to check cheaply
    // ─── Realtime connections (lib/liveConnections.ts on RN + web + Node) —
    // long-lived sockets and streams, which every request-shaped reading is
    // blind to. Each names a DIFFERENT fix, which is why they are four kinds
    // and not one:
    | "reconnect-storm"        // reconnected over and over with no widening gap → add back-off
    | "connection-stalled"     // open but silent far past its own rhythm → add a heartbeat
    | "connection-leak"        // long-lived connections piling up → close them
    | "reconnect-per-screen";  // a fresh connection on almost every screen change → hoist it
  /** Event name the finding is about (e.g. "search.tapTeamResult"). */

  name:    string;

  p95:     number;

  count:   number;

  hint:    string;
  /** Optional regression context — only set on `regression` findings. */

  baseline?: { p95: number; deltaMs: number; deltaPct: number };
}

/**
 * Snapshot of phase / row p95s captured at a known-good moment, used
 * by diagnose() to surface regressions in subsequent reports.
 *
 * Stored as a flat key→p95 map (where key matches PerfRow.key) so a
 * single dictionary lookup is enough — no nested merging logic in the
 * hot path. `version` lets us evolve the schema later without
 * misreading old snapshots from storage.
 */
export interface BaselineSnapshot {
  version:  1;
  savedAt:  number;            // Date.now() when snapshotted
  rows:     Record<string, number>;   // key → p95 ms at snapshot time
}

/**
 * Build a baseline from the current PerfRow set. Pure — kept here so
 * perfMonitor doesn't need to know baseline shape internals. Only
 * keys with at least 2 samples make it in: a single noisy outlier at
 * snapshot time would otherwise lock in a spuriously-high baseline
 * and suppress real regressions later.
 */
export function buildBaselineSnapshot(rows: PerfRow[]): BaselineSnapshot {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.count >= 2) out[r.key] = r.p95;
  }
  return { version: 1, savedAt: Date.now(), rows: out };
}

export interface DiagnosisReport {
  screens:      ScreenDiagnosis[];    // sorted slowest first
  /** Findings derived from non-screen events — press, nav, mount counts. */
  crossCutting: CrossCuttingFinding[];
  summary:      string;               // one-line headline for at-a-glance scanning
  /** Cold/warm/hot launch classification at the time of report. Lets
   *  the dev viewer + prod sampler bucket scores correctly so a
   *  legitimately-slow cold start isn't flagged as a regression
   *  against a warm-launch baseline. See lib/perfBoot.ts. */
  bootKind?:    "cold" | "warm" | "hot" | "unknown";
}

/* ─── Boosthis checklist (qualitative, not auto-detected) ─────────────
 * Some performance pitfalls in this codebase aren't observable from
 * runtime counters — they're "look-at-the-code" rules distilled from
 * fixes that already shipped (see the dated changelog at top of file).
 *
 * Encoding them here as structured data (instead of leaving them
 * buried in prose) means an AI agent reading the diagnoser output
 * can also pull the checklist programmatically and evaluate
 * suspicious code against it. Every entry corresponds to at least
 * one historical regression that bit us, so they're battle-tested.
 */

/* The BoosthisChecklistEntry type and the BOOSTHIS_CHECKLIST array now live
 * in the @boosthis/checklist workspace package so they can be consumed by
 * the boosthis-cli, the @boosthis/runtime types, and any external project
 * without dragging in this whole 2k-line diagnoser. We re-export here
 * for backwards compatibility with everything in this codebase that
 * imported them from this module. */
export type { BoosthisChecklistEntry } from "boosthis-checklist";
export { BOOSTHIS_CHECKLIST } from "boosthis-checklist";

/* ─── Lighthouse-style 0-100 scoring ──────────────────────────────────
 * Indeed open-sourced a Lighthouse-equivalent for React Native in
 * March 2026 (engineering.indeedblog.com — react-native-lighthouse).
 * Their composite-score formula is:
 *   TTFF × 0.25 + TTI × 0.45 + FID × 0.30
 * with mobile-stricter thresholds (~6× tighter than Core Web Vitals):
 *   TTFF: good <300ms,  poor >800ms
 *   TTI:  good <500ms,  poor >1500ms
 *   FID:  good <50ms,   poor >150ms
 *
 * Boosthis's per-screen ladder already collects TTFF (`afterCommit`)
 * and TTI (`afterIM`). FID needs a tap-handler instrumentation hook
 * we haven't shipped yet — when absent we re-normalize the weights
 * onto TTFF + TTI (preserving Indeed's 25:45 ratio).
 *
 * Rating cutoffs follow Lighthouse convention:
 *   ≥85 = good · 60-84 = needs-work · <60 = poor
 */

/** Piecewise-linear score: 100 at `good`, 0 at `poor`, linear between. A band
 *  the wrong way round refuses here too; see axisScoring's
 *  InvertedAxisBandError for why a silent answer is the one thing this must
 *  not give. */
function linearScore(ms: number, good: number, poor: number): number {
  if (!Number.isFinite(good) || !Number.isFinite(poor) || poor <= good) {
    throw new InvertedAxisBandError(good, poor);
  }
  if (ms <= good) return 100;
  if (ms >= poor) return 0;
  return Math.round(100 * (1 - (ms - good) / (poor - good)));
}

export interface ScreenScoreBreakdown {
  ttffMs:    number | null;
  ttiMs:     number | null;
  fidMs:     number | null;
  ttffScore: number | null;
  ttiScore:  number | null;
  fidScore:  number | null;
  /** Composite 0-100. Re-normalized when fidMs is null. */
  score:     number;
  rating:    "good" | "needs-work" | "poor" | "insufficient-data";
}

const W = { TTFF: 0.25, TTI: 0.45, FID: 0.30 } as const;

/**
 * Pluck a phase ms. Prefers `last` (`p.ms`) so the score is coherent
 * with what the dev viewer's ladder bars and `totalMs` headline are
 * showing — both also render `last`. Falls back to p95 only when the
 * last sample is missing (0), which can happen on a phase that fired
 * during a previous mount but not the most recent one.
 */
function phaseMs(s: ScreenDiagnosis, name: string): number | null {
  const p = s.ladder.find((e) => e.phase === name);
  if (!p) return null;
  return p.ms > 0 ? p.ms : (p.p95 > 0 ? p.p95 : null);
}

export function computeScreenScore(
  s: ScreenDiagnosis,
  fidMs?: number,
): ScreenScoreBreakdown {
  const ttffMs = phaseMs(s, "afterCommit");
  // TTI comes from the afterIM phase or not at all.
  //
  // It used to fall back to `s.totalMs`, which reads like a second source and
  // is not one: `diagnose()` sets totalMs to the DEEPEST phase this screen
  // recorded, so on a screen known only by its first paint it is the very
  // same observation as TTFF above. Scoring both from one number produced a
  // confident 100 out of a single 40ms reading — the hold-back below was
  // there, and this line walked straight past it.
  const ttiMs  = phaseMs(s, "afterIM");
  const fid    = typeof fidMs === "number" ? fidMs : null;

  // Hold the composite back until its inputs have earned it.
  //
  // This used to score a screen from EITHER phase, re-weighting whatever
  // turned up so one measurement became a full 0-100 verdict — a screen known
  // only by its total mount time was graded "good" on that alone, and the
  // number looked exactly like one standing on the whole ladder. A composite
  // is a claim about several things at once; with only one of them measured
  // there is nothing to compose, and the honest answer is the one this
  // function already has a word for.
  //
  // FID is deliberately NOT required: an interaction may genuinely never
  // happen on a screen, so waiting for it would hold back a composite that
  // its own inputs HAVE earned. The two mount phases always arrive together
  // on a screen the kit actually timed.
  if (ttffMs == null || ttiMs == null) {
    return {
      ttffMs, ttiMs, fidMs: fid,
      ttffScore: null, ttiScore: null, fidScore: null,
      score: 0, rating: "insufficient-data",
    };
  }

  const ttffScore = ttffMs == null ? null : linearScore(ttffMs, 300, 800);
  const ttiScore  = ttiMs  == null ? null : linearScore(ttiMs,  500, 1500);
  const fidScore  = fid    == null ? null : linearScore(fid,    50,  150);

  // Build weighted average over the metrics we actually have.
  let weightSum = 0;
  let scoreSum  = 0;
  if (ttffScore != null) { weightSum += W.TTFF; scoreSum += W.TTFF * ttffScore; }
  if (ttiScore  != null) { weightSum += W.TTI;  scoreSum += W.TTI  * ttiScore;  }
  if (fidScore  != null) { weightSum += W.FID;  scoreSum += W.FID  * fidScore;  }
  const score = weightSum === 0 ? 0 : Math.round(scoreSum / weightSum);

  const rating: ScreenScoreBreakdown["rating"] =
    score >= 85 ? "good" : score >= 60 ? "needs-work" : "poor";

  return { ttffMs, ttiMs, fidMs: fid, ttffScore, ttiScore, fidScore, score, rating };
}

/**
 * Overall snapshot score = arithmetic mean of all screen scores
 * (excluding insufficient-data screens). One number to track per
 * snapshot — the Lighthouse-style headline.
 */
export function computeOverallScore(diag: DiagnosisReport): {
  score:  number;
  rating: ScreenScoreBreakdown["rating"];
  scoredScreens: number;
  totalScreens:  number;
} {
  const scored = diag.screens
    .map((s) => computeScreenScore(s))
    .filter((b) => b.rating !== "insufficient-data");
  if (scored.length === 0) {
    return { score: 0, rating: "insufficient-data", scoredScreens: 0, totalScreens: diag.screens.length };
  }
  const score = Math.round(scored.reduce((a, b) => a + b.score, 0) / scored.length);
  const rating: ScreenScoreBreakdown["rating"] =
    score >= 85 ? "good" : score >= 60 ? "needs-work" : "poor";
  return { score, rating, scoredScreens: scored.length, totalScreens: diag.screens.length };
}

/* ─── Long-session diagnostic ─────────────────────────────────────────
 * The screen diagnoser above only sees the first ~1s after each tab
 * mounts. It can't see what slowly accumulates over a 5-minute
 * session — the kind of "lags after a while" jank that has nothing to
 * do with mount cost. Long-session sampling fills that gap by
 * snapshotting a few cheap counters every 30s and looking for trends.
 */

export interface LongSessionSample {
  /** ms since session start. */
  t:             number;
  /** Active setInterval/setTimeout count (monkey-patched globals). */
  activeTimers:  number;
  /** Rolling frame-time stats over the last sample window. */
  frameP50Ms:    number;
  frameP95Ms:    number;
  /** Hermes JS heap size if available, else null. */
  jsHeapMb:      number | null;
  /** The screen that was current WHEN this sample was taken, or null when no
   *  screen was — read at sample time, never re-read later (a screen read
   *  while folding a report is the last screen seen, not the one measured).
   *  Surfaces word a null with NO_SCREEN_WORDING; nothing invents a name. */
  screen?:       string | null;
}

export type LongSessionPattern =
  | "stable"                // no growth — app behavior is steady
  | "timer-leak"            // active timer count grows linearly with time
  | "frame-drift"           // frame-time p95 degrades over the session
  | "heap-growth"           // jsHeapMb grows >50% over the session
  | "insufficient-data";    // <2 samples — can't compute trend

export interface LongSessionGrowth {
  metric:       "activeTimers" | "frameP95Ms" | "jsHeapMb";
  from:         number;
  to:           number;
  /** Linear growth rate per minute (positive = growing). */
  perMin:       number;
}

export interface LongSessionReport {
  durationMin:  number;
  sampleCount:  number;
  pattern:      LongSessionPattern;
  /** All metrics that grew, sorted by growth rate descending. */
  growth:       LongSessionGrowth[];
  hints:        string[];
  /** One-line headline. */
  summary:      string;
}

/**
 * Pure function — given an ordered list of samples, classify whether
 * the app is drifting and return prescriptive hints. Mirrors
 * `diagnose()` for screen rows: no I/O, deterministic, easy to test
 * and easy for an AI agent to consume.
 */
export function diagnoseLongSession(samples: LongSessionSample[]): LongSessionReport {
  if (samples.length < 2) {
    return {
      durationMin: 0,
      sampleCount: samples.length,
      pattern:     "insufficient-data",
      growth:      [],
      hints:       ["Need at least 2 samples (≥30s of session) to detect drift."],
      summary:     "Not enough data yet — keep using the app and re-check.",
    };
  }

  const first = samples[0];
  const last  = samples[samples.length - 1];
  const durationMin = Math.max((last.t - first.t) / 60_000, 1 / 60);

  const ratePerMin = (a: number, b: number) => (b - a) / durationMin;

  const growth: LongSessionGrowth[] = [];

  // Active timers — any positive growth at all is suspicious because
  // mount/unmount cycles should net to zero over time.
  const timerRate = ratePerMin(first.activeTimers, last.activeTimers);
  if (timerRate > 0.5) {
    growth.push({
      metric: "activeTimers",
      from:   first.activeTimers,
      to:     last.activeTimers,
      perMin: timerRate,
    });
  }

  // Frame p95 degradation — only flag if p95 worsened by ≥20% AND by
  // at least 4ms (a quarter of a 60fps frame). Avoids flagging noise.
  if (last.frameP95Ms > first.frameP95Ms * 1.2 && (last.frameP95Ms - first.frameP95Ms) >= 4) {
    growth.push({
      metric: "frameP95Ms",
      from:   first.frameP95Ms,
      to:     last.frameP95Ms,
      perMin: ratePerMin(first.frameP95Ms, last.frameP95Ms),
    });
  }

  // Heap growth — only if reported AND grew by ≥50% AND by ≥10MB.
  if (
    first.jsHeapMb != null && last.jsHeapMb != null &&
    last.jsHeapMb > first.jsHeapMb * 1.5 &&
    (last.jsHeapMb - first.jsHeapMb) >= 10
  ) {
    growth.push({
      metric: "jsHeapMb",
      from:   first.jsHeapMb,
      to:     last.jsHeapMb,
      perMin: ratePerMin(first.jsHeapMb, last.jsHeapMb),
    });
  }

  growth.sort((a, b) => b.perMin - a.perMin);

  let pattern: LongSessionPattern = "stable";
  const hints: string[] = [];

  // Pick the strongest signal as the pattern label, but include hints
  // for every growing metric so all evidence is visible.
  if (growth.length > 0) {
    const top = growth[0];
    if (top.metric === "activeTimers")    pattern = "timer-leak";
    else if (top.metric === "frameP95Ms") pattern = "frame-drift";
    else                                  pattern = "heap-growth";

    for (const g of growth) {
      if (g.metric === "activeTimers") {
        hints.push(
          `Active timers grew from ${Math.round(g.from)} to ${Math.round(g.to)} over ${durationMin.toFixed(1)}min (+${g.perMin.toFixed(1)}/min). Some setInterval / setTimeout is being scheduled without a matching clear — likely a useEffect cleanup that returns the wrong handle, or a screen that re-schedules on every render.`,
        );
      } else if (g.metric === "frameP95Ms") {
        hints.push(
          `Frame p95 worsened from ${g.from.toFixed(1)}ms to ${g.to.toFixed(1)}ms. Look for: a list whose data array keeps growing (no cap / pagination), an Animated.Value loop that wasn't stopped, or a polling loop that re-renders a heavy subtree.`,
        );
      } else {
        hints.push(
          `JS heap grew from ${g.from.toFixed(0)}MB to ${g.to.toFixed(0)}MB. Suspect an in-memory cache that never evicts (image cache, message log, fetched feeds) or closures captured by long-lived listeners.`,
        );
      }
    }
  } else {
    hints.push(
      "App behavior is steady — no timer / frame / heap drift detected. If the user still reports lag-after-time, look at on-device factors (thermal throttling, low-power mode) or specific user actions that trigger heavy work.",
    );
  }

  let summary: string;
  if (pattern === "stable") {
    summary = `Stable over ${durationMin.toFixed(1)}min — no drift detected.`;
  } else {
    const top = growth[0];
    summary = `${pattern}: ${top.metric} +${top.perMin.toFixed(1)}/min over ${durationMin.toFixed(1)}min.`;
  }

  return {
    durationMin,
    sampleCount: samples.length,
    pattern,
    growth,
    hints,
    summary,
  };
}

/**
 * Canonical phase order. Phases not in this list are appended at the end
 * (they still appear in the ladder, just after the known ones).
 */
const PHASE_ORDER = [
  "renderStart",
  "afterContexts",
  "afterMemos",
  "beforeReturn",
  "afterCommit",
  "afterMacrotask",
  "afterRaf",
  "afterIdle100",
  "afterIdle300",
  "afterIM",
];

/** True when |a - b| ≤ tol. Used to detect "fired at the same time". */
const within = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

export function diagnose(rows: PerfRow[], baseline?: BaselineSnapshot): DiagnosisReport {
  // Group rows by screen. Phase keys look like:
  //   event:phase:<screen>:<phase>
  // Screen names contain "/" but never ":" so a greedy split on the LAST
  // colon recovers them safely.
  const byScreen = new Map<string, Map<string, PerfRow>>();
  const mountCount = new Map<string, number>();

  for (const r of rows) {
    const phaseMatch = r.key.match(/^event:phase:(.+):([^:]+)$/);
    if (phaseMatch) {
      const [, screen, phase] = phaseMatch;
      let bucket = byScreen.get(screen);
      if (!bucket) { bucket = new Map(); byScreen.set(screen, bucket); }
      bucket.set(phase, r);
      continue;
    }
    const screenMatch = r.key.match(/^screen:(.+)$/);
    if (screenMatch) {
      // recordScreen() runs once per mount, so count = mounts in session.
      mountCount.set(screenMatch[1], r.count);
    }
  }

  const screens: ScreenDiagnosis[] = [];

  for (const [screen, phases] of byScreen) {
    // Build the ordered ladder (known phases in canonical order, then any
    // unknown ones tacked on so we never silently drop data).
    const ladder: PhaseEntry[] = [];
    const seen = new Set<string>();
    for (const p of PHASE_ORDER) {
      const r = phases.get(p);
      if (r) {
        ladder.push({ phase: p, ms: r.last, p95: r.p95, count: r.count });
        seen.add(p);
      }
    }
    for (const [p, r] of phases) {
      if (!seen.has(p)) ladder.push({ phase: p, ms: r.last, p95: r.p95, count: r.count });
    }
    if (ladder.length === 0) continue;

    const totalMs = ladder[ladder.length - 1].ms;

    // Worst adjacent-phase gap — the segment that spent the most time.
    let worstGap: ScreenDiagnosis["worstGap"] = null;
    for (let i = 1; i < ladder.length; i++) {
      const gap = ladder[i].ms - ladder[i - 1].ms;
      if (!worstGap || gap > worstGap.ms) {
        worstGap = { from: ladder[i - 1].phase, to: ladder[i].phase, ms: gap };
      }
    }

    // Classify. Order matters — first match wins. We test the most diagnostic
    // (and least false-positive-prone) patterns first.
    const get = (p: string) => phases.get(p)?.last ?? null;
    const commit        = get("afterCommit");
    const macro         = get("afterMacrotask");
    const idle100       = get("afterIdle100");
    const idle300       = get("afterIdle300");
    const im            = get("afterIM");
    const beforeReturn  = get("beforeReturn");
    const afterContexts = get("afterContexts");
    const afterMemos    = get("afterMemos");

    let pattern: ScreenPattern = "unknown";
    const hints: string[] = [];

    if (totalMs < 200) {
      pattern = "snappy";
    } else if (
      // Single sync block: idle timers all fire ≈ together with commit.
      // tol=60ms covers normal frame jitter without false positives.
      commit != null && idle100 != null && idle300 != null &&
      within(idle100, commit, 60) && within(idle300, idle100, 60)
    ) {
      pattern = "single-sync-block";
      hints.push(
        `All idle timers (0/100/300ms) fired together with afterCommit → one ~${Math.round(commit)}ms synchronous JS block, NOT an InteractionManager wait.`,
        "Look for: always-evaluated <Modal> subtrees, heavy useMemo on first render, deeply-nested ScrollViews, 5+ Provider stack with non-memoized values.",
        "Fix template: gate heavy JSX behind a `heavyReady` flag that flips ~100ms post-mount via InteractionManager.",
      );
    } else if (
      // Deferred-work hump: commit was fast (<100ms) but the JS thread
      // then went busy for a long block before idle timers fire. The
      // idle timers cluster together LATE, while afterCommit is well
      // before them. Signature of heavyReady's deferred work running in
      // one synchronous chunk after the first paint.
      commit != null && macro != null && idle100 != null && idle300 != null &&
      commit < 100 && (macro - commit) > 200 && within(idle300, idle100, 60)
    ) {
      pattern = "deferred-work-hump";
      hints.push(
        `First paint was fast (commit ${Math.round(commit)}ms) but JS then ran a ${Math.round(macro - commit)}ms synchronous block before settling (idle timers cluster at ~${Math.round(idle100)}ms).`,
        "Cause: heavyReady's deferred work (modals, heavy components) is firing all at once.",
        "Fix: stage heavyReady — flip a `heavyReady2` only at idle300 and gate the heaviest items behind it. Or split the deferred work into rAF chunks so no single block exceeds 100ms.",
      );
    } else if (
      // InteractionManager wait: JS idle by macrotask, but IM never resolves.
      macro != null && im != null && commit != null &&
      (im - macro) > 200 && (macro - commit) < 50
    ) {
      pattern = "interaction-wait";
      hints.push(
        `JS thread went idle ${Math.round(macro - commit)}ms after commit, but InteractionManager waited another ${Math.round(im - macro)}ms.`,
        "Cause: an Animated.loop / animation is holding the interaction handle.",
        "Fix: pass `isInteraction:false` to the offending Animated.timing or .loop options.",
      );
    } else if (
      // Heavy commit: returned tree was large.
      beforeReturn != null && commit != null && (commit - beforeReturn) > 200
    ) {
      pattern = "heavy-commit";
      hints.push(
        `React commit took ${Math.round(commit - beforeReturn)}ms after beforeReturn → heavy children being constructed eagerly.`,
        "Lazy-mount: wrap heavy components/Modals with `{heavyReady && (...)}`.",
      );
    } else if (
      // Heavy contexts: more than 40% of total spent before useMemo phase.
      afterContexts != null && afterContexts > 100 && afterContexts > totalMs * 0.4
    ) {
      pattern = "heavy-contexts";
      hints.push(
        `${Math.round(afterContexts)}ms spent in context wiring (${Math.round((afterContexts / totalMs) * 100)}% of total).`,
        "Split large Providers, memoize their `value` object, or defer non-critical contexts.",
      );
    } else if (
      // Heavy memos: useMemo phase added significant time on top of contexts.
      afterMemos != null && afterContexts != null && (afterMemos - afterContexts) > 100
    ) {
      pattern = "heavy-memos";
      hints.push(
        `useMemo block added ${Math.round(afterMemos - afterContexts)}ms on first render.`,
        "Defer expensive memos behind heavyReady, or move them to a worker / background phase.",
      );
    }

    const mounts = mountCount.get(screen) ?? 0;
    if (mounts > 3) {
      hints.push(
        `Screen mounted ${mounts}× this session → possible remount storm. Check parent for unstable keys / effects firing on each render.`,
      );
    }

    // Perception-adjusted score: subtract the nav-animation occlusion
    // window from totalMs (= deepest phase recorded ≈ TTI) and re-score
    // with the same piecewise-linear good=500 / poor=1500 mapping
    // usePerfTracker uses for prod samples. Architect-flagged: this
    // field was declared but never populated — now wired here.
    //
    // This used to be a lazy require(), to dodge a module cycle with
    // perfNovelDetectors. There is no cycle to dodge: that module's only
    // references to this one are `import type`, which is erased. What the
    // require() DID do was throw `require is not defined` on any host that
    // loads the kit as ES modules, and it sits outside a try — so the whole
    // of diagnose() died, and with it every axis derived from it. It never
    // showed up because this line is inside the per-screen loop, and the
    // screens list was empty in every snapshot we had ever stored. The first
    // rig to record the phase ladder hit it immediately.
    // Scored through the checked scorer above rather than spelled out here:
    // written inline, this band was a pair of literals no gate could read and
    // no refusal could catch.
    const linear = (ms: number) => linearScore(ms, 500, 1500);
    const perceptionScore = totalMs > 0
      ? computePerceptionScore(totalMs, linear)
      : undefined;
    screens.push({ screen, totalMs, ladder, worstGap, pattern, hints, mounts, perceptionScore });
  }

  screens.sort((a, b) => b.totalMs - a.totalMs);

  // Cross-cutting findings — derived from non-screen events. perfMonitor
  // records press handlers as `press:<name>` and nav transitions as
  // `nav:<from→to>`; both flow through the same row aggregator that
  // produces `event:<key>` rows here. Surfacing them as their own
  // findings (instead of folding into a screen) makes "this BUTTON is
  // slow" and "this NAV is slow" visible at a glance, alongside the
  // screen ladders.
  const crossCutting: CrossCuttingFinding[] = [];

  for (const r of rows) {
    // Press handlers: anything taking >100ms p95 means the tap blocked
    // the JS thread for >6 frames before the handler returned.
    const press = r.key.match(/^press:(.+)$/);
    if (press && r.p95 > 100 && r.count >= 2) {
      crossCutting.push({
        kind:  "slow-press-handler",
        name:  press[1],
        p95:   r.p95,
        count: r.count,
        hint:  `Tap handler "${press[1]}" took p95 ${Math.round(r.p95)}ms across ${r.count} taps. Move synchronous work off the press path: wrap in InteractionManager.runAfterInteractions, defer with requestAnimationFrame, or cache the computation. Slow press = the user feels the button "stick" before anything happens.`,
      });
    }
    // Nav: tap → destination-interactive. >800ms is "the screen feels
    // slow on tap"; that's almost always a heavy mount on the
    // destination, not a slow handler.
    const nav = r.key.match(/^nav:(.+)$/);
    if (nav && r.p95 > 800 && r.count >= 2) {
      crossCutting.push({
        kind:  "slow-nav",
        name:  nav[1],
        p95:   r.p95,
        count: r.count,
        hint:  `Navigation "${nav[1]}" took p95 ${Math.round(r.p95)}ms tap-to-interactive across ${r.count} attempts. Inspect the destination screen in this report — if its pattern is heavy-commit / single-sync-block / deferred-work-hump, fix that screen first. If the destination looks snappy in isolation, the press handler or route stack is doing pre-mount work.`,
      });
    }
    // API endpoints. Successful endpoints with p95 >800ms are flagged
    // as `slow-api`; failed endpoints (suffix " (failed)") with any
    // count ≥ 3 get `failing-api` regardless of latency. Splitting
    // them keeps a fast-but-broken endpoint from masquerading as
    // healthy in latency dashboards.
    const api = r.key.match(/^api:(.+)$/);
    if (api) {
      const endpoint = api[1];
      const failing  = endpoint.endsWith(" (failed)");
      if (failing && r.count >= 3) {
        crossCutting.push({
          kind:  "failing-api",
          name:  endpoint,
          p95:   r.p95,
          count: r.count,
          hint:  `Endpoint "${endpoint}" failed ${r.count}x (p95 latency to failure ${Math.round(r.p95)}ms). Check: (a) is the URL/method correct in the generated client?, (b) is auth being attached?, (c) does the server return a non-2xx for valid input? A burst of failures often hides behind a "slow screen" report — the screen retries silently and the user sees a spinner.`,
        });
      } else if (!failing && r.p95 > 800 && r.count >= 2) {
        crossCutting.push({
          kind:  "slow-api",
          name:  endpoint,
          p95:   r.p95,
          count: r.count,
          hint:  `Endpoint "${endpoint}" returned in p95 ${Math.round(r.p95)}ms across ${r.count} calls. Investigate in this order: (1) is this called during screen mount? — if yes, the screen's perceived slowness is the API, not React; (2) is it cacheable? add staleTime / select to the react-query hook; (3) does the server endpoint do N+1 / synchronous IO? profile the API route. A slow API right next to a slow screen is almost always the actual cause.`,
        });
      }
    }
  }
  // Regression detection: any row whose p95 worsened by ≥30% AND ≥50ms
  // vs the baseline snapshot. Both gates matter — 30% alone fires on
  // tiny phases (10ms→14ms is meaningless); 50ms alone misses fast
  // hot-path regressions on small handlers. Combined, they signal
  // "this got materially slower in a way the user can feel."
  if (baseline && baseline.rows) {
    for (const r of rows) {
      const before = baseline.rows[r.key];
      if (before == null || before <= 0) continue;
      const deltaMs  = r.p95 - before;
      const deltaPct = deltaMs / before;
      if (deltaPct >= 0.30 && deltaMs >= 50) {
        crossCutting.push({
          kind:     "regression",
          name:     r.key,
          p95:      r.p95,
          count:    r.count,
          hint:     `${r.key} regressed from p95 ${Math.round(before)}ms to ${Math.round(r.p95)}ms (+${Math.round(deltaPct * 100)}%, +${Math.round(deltaMs)}ms) since the baseline snapshot. Check what changed since then — recent commits to the implicated screen, a new heavy child, a Provider added high in the tree, or a removed memoization.`,
          baseline: { p95: before, deltaMs, deltaPct },
        });
      }
    }
  }
  // ── Post-commit effect-storm detection (2026-05-14) ────────────────
  // Pattern: a screen whose `afterCommit` phase is FAST (<100ms) but
  // whose `afterMacrotask` phase is far behind (≥+300ms gap). That
  // fingerprint specifically isolates "render is instant, then JS is
  // pinned in one big synchronous block right after commit" — the
  // signature of post-commit effects firing all in the same task
  // (Animated.timing.start() calls bridging in a cluster, multiple
  // setStates from a useStagedHeavyReady flip, modal pre-mounts).
  //
  // This is DIFFERENT from render-monolith: that one fires on screens
  // whose render itself is heavy. Splitting the file fixes monolith
  // but DOES NOT fix effect-storm — the cure for effect-storm is
  // timing (InteractionManager-defer the .start() calls, add a
  // heavyReady tier, stagger state updates across rAF). The two
  // findings can co-fire and have different fixes.
  //
  // Build a per-screen lookup of phase p95s so we can check both
  // afterCommit and afterMacrotask in one pass.
  const phaseP95: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const m = r.key.match(/^event:phase:(.+):(renderStart|afterContexts|afterMemos|beforeReturn|afterCommit|afterMacrotask|afterRaf|afterIdle100|afterIdle300|afterIM)$/);
    if (!m) continue;
    const [, scr, ph] = m;
    (phaseP95[scr] ??= {})[ph] = r.p95;
  }
  for (const r of rows) {
    const screen = r.key.match(/^screen:(.+)$/);
    if (!screen) continue;
    if (r.count < 2) continue;
    const phases = phaseP95[screen[1]];
    if (!phases) continue;
    const commit = phases["afterCommit"];
    const macro  = phases["afterMacrotask"];
    if (commit == null || macro == null) continue;
    if (commit < 100 && macro - commit >= 300) {
      crossCutting.push({
        kind:  "post-commit-effect-storm",
        name:  screen[1],
        p95:   r.p95,
        count: r.count,
        hint:  `Screen "${screen[1]}" first paint was FAST (afterCommit p95 ${Math.round(commit)}ms) but JS was then pinned for ${Math.round(macro - commit)}ms in a single sync block before idling (afterMacrotask p95 ${Math.round(macro)}ms). This is a post-commit effect storm, NOT a render monolith — splitting the file won't help. Likely causes, in order: (1) multiple Animated.timing(...).start() calls in mount-time useEffects bridging in one microtask — wrap each in InteractionManager.runAfterInteractions and cancel the handle on cleanup; (2) a useStagedHeavyReady flip firing too many memoized children in one frame — add another tier (heavyReady3) and gate the heaviest few behind it; (3) modal pre-mounts on first commit — defer them until first user gesture or behind heavyReady2. Audit any useEffect with [] or [isFocused] deps that calls .start(), Animated.timing(), or setState during the first commit.`,
      });
    }
  }
  // ── Render-monolith detection (2026-05-14) ─────────────────────────
  // Pattern: `screen:X` p95 > 400ms across ≥2 mounts AND no `slow-api`
  // finding for any endpoint touched during X's mount window. When the
  // API is fast but the screen is slow, the cause is render-side: a
  // monolithic screen file (1,500+ lines under one ScrollView) is
  // mounting hundreds of below-the-fold elements eagerly on first
  // commit. Boosthis surfaces this as a distinct finding so the next
  // diagnosis can jump straight to the structural fix template
  // (useDeferredMount / useStagedHeavyReady gating + FlashList for
  // unbounded lists + freezeOnBlur:false in the tabs layout) instead
  // of hunting for a slow API that isn't there.
  //
  // The "no slow-api" check is approximate: we just look at whether
  // ANY slow-api finding fired in this report. Per-screen attribution
  // would require correlating mount windows to API timings, which the
  // current row-only data model doesn't carry. Good enough heuristic:
  // if there's any slow API in the same session as a slow screen, the
  // slow-api finding is the actionable one and we don't double-flag.
  const anySlowApi = crossCutting.some((f) => f.kind === "slow-api");
  if (!anySlowApi) {
    for (const r of rows) {
      const screen = r.key.match(/^screen:(.+)$/);
      if (!screen) continue;
      if (r.p95 <= 400 || r.count < 2) continue;
      crossCutting.push({
        kind:  "render-monolith",
        name:  screen[1],
        p95:   r.p95,
        count: r.count,
        hint:  `Screen "${screen[1]}" took p95 ${Math.round(r.p95)}ms across ${r.count} mounts and no slow-api fired in this report — the bottleneck is render-side, not network. Apply the structural fix template: (1) check the tabs layout has freezeOnBlur:false so re-focus skips the thaw cost; (2) gate below-the-fold subtrees behind useStagedHeavyReady's heavyReady (top half of below-the-fold) and heavyReady2 (bottom half) so the two heavy commits land in different frames via the built-in double-rAF; (3) for any list whose length grows with user data (followers, photos, videos, chats, games), replace the inline .map() with @shopify/flash-list so render cost stays bounded by viewport. The single-file 2,000-line tab-screen pattern is the root cause — gating it is the band-aid; extracting per-section subcomponents (NotificationRow, ChatRow, ContentRow as React.memo'd components) is the real cure.`,
      });
    }
  }
  // ─── Realtime connections ───────────────────────────────────────────
  // Long-lived sockets and streams: reconnect storms, connections that are
  // open but have gone silent, connections nothing ever closes, and the
  // "reconnects every time you move" shape. Read from the SAME counters the
  // Live Connections tile reports, so the tile and this list can never tell a
  // developer two different stories. Silent when the app opened none.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { collectLiveConnectionFindings } =
      require("./liveConnections") as typeof import("./liveConnections");
    for (const f of collectLiveConnectionFindings()) {
      crossCutting.push(f as CrossCuttingFinding);
    }
  } catch {
    /* a watcher that cannot answer simply contributes nothing */
  }
  // Global remount-storm: any single screen mounting >5x in a session
  // is suspicious enough to surface as a top-level finding too, not
  // just as a hint inside that screen's diagnosis.
  for (const [screen, count] of mountCount) {
    if (count > 5) {
      crossCutting.push({
        kind:  "remount-storm-global",
        name:  screen,
        p95:   count,
        count,
        hint:  `Screen "${screen}" mounted ${count}x this session. Almost always means a parent's render is producing unstable keys / Provider values / route params, forcing the screen to remount on every parent re-render. Audit the parent — never the screen itself.`,
      });
    }
  }
  // ─── Novel detectors — append before sorting so they participate
  // in the same p95-ordering rule as the existing findings. They run
  // over the raw event log (timestamps + meta) which the row-based
  // diagnose() doesn't otherwise need; we read it directly from the
  // perfMonitor singleton to keep the diagnose() signature stable
  // for existing callers. Entirely additive.
  try {
    // Lazy import to keep diagnose() free of a hard module-cycle with
    // perfNovelDetectors (which type-imports CrossCuttingFinding from
    // this file).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { runNovelDetectors } = require("./perfNovelDetectors") as typeof import("./perfNovelDetectors");
    // perfMonitor's event store is already in memory; we don't need
    // the async hydrate here because diagnose() is only called on
    // already-hydrated state (the dev viewer, the snapshot saver,
    // the export endpoint all wait for hydrate themselves).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { perfMonitor } = require("./perfMonitor") as typeof import("./perfMonitor");
    // We use a synchronous accessor here — getEventsSync isn't part
    // of the public API, so we read the internal `state.events` via
    // a typed cast. Safe because diagnose() and perfMonitor live in
    // the same realm and we never mutate the array.
    const events = (perfMonitor as unknown as { state?: { events?: unknown[] } })
      .state?.events as Parameters<typeof runNovelDetectors>[0] | undefined;
    // The mount census is the one render-side reading that survives a release
    // build, so it is read whether or not there are events: a screen can
    // mount an entire collection in its very first commit, before anything
    // this app does has produced a timed event at all.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getMountCensus } = require("./mountCensus") as typeof import("./mountCensus");
    const census = getMountCensus();
    const safeEvents = events && Array.isArray(events) ? events : [];
    if (safeEvents.length > 0 || census.length > 0) {
      crossCutting.push(...runNovelDetectors(safeEvents, [], census));
    }
  } catch {
    // Detector failure must never break the report — silently skip.
  }

  crossCutting.sort((a, b) => b.p95 - a.p95);

  let summary: string;
  if (screens.length > 0) {
    const w = screens[0];
    summary = `${screens.length} screen(s). Worst: ${w.screen} @ ${w.totalMs}ms (${w.pattern}).`;
    if (crossCutting.length > 0) {
      summary += ` ${crossCutting.length} cross-cutting finding(s); top: ${crossCutting[0].kind} on "${crossCutting[0].name}".`;
    }
  } else if (crossCutting.length > 0) {
    // Possible when only press / nav events were recorded (no screen
    // phase ladders yet) — still surface the findings instead of the
    // misleading "No screens analyzed yet."
    summary = `No screen ladders yet, but ${crossCutting.length} cross-cutting finding(s); top: ${crossCutting[0].kind} on "${crossCutting[0].name}".`;
  } else {
    summary = "No screens analyzed yet.";
  }
  // Surface the boot kind on the report so consumers (dev viewer,
  // prod sampler, CI gate) can bucket scores correctly. Lazy-read
  // through the same require trick used for novel detectors above to
  // avoid a hard module-cycle. Defaults to "unknown" if perfBoot
  // hasn't classified yet (classifyBootKind is fire-and-forget on
  // app boot — may not have resolved by first diagnose() call).
  let bootKind: DiagnosisReport["bootKind"] = "unknown";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const boot = require("./perfBoot") as typeof import("./perfBoot");
    bootKind = boot.getBootKind();
  } catch {
    // Stay "unknown" — never break the report on a boot-module hiccup.
  }
  return { screens, crossCutting, summary, bootKind };
}
