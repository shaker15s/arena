/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
import { InteractionManager } from "react-native";
import {
  diagnose,
  diagnoseLongSession,
  buildBaselineSnapshot,
  type BaselineSnapshot,
  type DiagnosisReport,
  type LongSessionReport,
  type LongSessionSample,
  type PerfRow,
} from "./perfDiagnose";
import { normalizeApiPath } from "./apiPath";
import { platform } from "./perfPlatform";
import { isRuntimeInert } from "./killSwitch";
import { sampleTimerCount } from "./timerHealth";
import { sampleHermes } from "./hermesAxes";
import {
  spansBackgroundSuspend,
  noteBackgroundDiscount,
} from "./backgroundSpans";
import { safeRun } from "./safe";
import { assertNetworkAutoWrapSoon } from "./networkAutoWrap";
import { currentScreen } from "./screenAttribution";

/**
 * In-app performance monitor for Rival.
 *
 * Records two kinds of timings:
 *
 *  1. Screen mount-to-interactive  — measured via usePerfTracker hook.
 *     Captures the wall time from the screen's first render until
 *     InteractionManager reports the navigation transition is done.
 *     This is the number that actually matches "the page felt slow."
 *
 *  2. Ad-hoc events  — anything you want to time, e.g.
 *     `perfMonitor.recordEvent("AsyncStorage.write", ms, { key: "userGames" })`.
 *
 * Events are kept in memory (capped at MAX_EVENTS) and persisted to
 * AsyncStorage on a 30s flush. Anything below MIN_LOG_MS is discarded
 * to avoid noise.
 *
 * The monitor is a no-op in production unless explicitly enabled, so
 * it can stay imported everywhere without cost when shipped.
 */

const STORAGE_KEY          = "boosthis.perfMonitor.v1";
const STORAGE_KEY_LONG     = "boosthis.perfMonitor.long.v1";
const STORAGE_KEY_BASELINE = "boosthis.perfMonitor.baseline.v1";
const MAX_EVENTS       = 500;
const MAX_LONG_SAMPLES = 60;        // 30 min at 30s sample rate
const MIN_LOG_MS       = 16;        // ignore anything faster than one frame
const FLUSH_DEBOUNCE   = 30 * 1000; // persist at most every 30s
const NAV_STALE_MS     = 5 * 1000;  // pending nav expires if no destination mounts in 5s
const LONG_SAMPLE_MS   = 30 * 1000; // long-session sample cadence
const FRAME_WINDOW     = 60;        // rolling window of frame deltas to keep

export type PerfEventKind =
  | "screen"   // mount → InteractionManager-ready (destination only)
  | "event"    // ad-hoc named timing
  | "press"    // synchronous onPress handler duration
  | "nav"      // tap → destination-interactive (full transition)
  | "api";     // network request (method+normalized-path), success or failure

export interface PerfEvent {
  kind:       PerfEventKind;
  name:       string;
  durationMs: number;
  ts:         number;
  meta?:      Record<string, string | number | boolean>;
}

interface PerfState {
  events:     PerfEvent[];
  startedAt:  number;
}

class PerfMonitor {
  private enabled  = __DEV__;          // dev-only by default
  private state: PerfState = { events: [], startedAt: Date.now() };
  private hydrated = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  /** Manual on/off (e.g. for the dev/perf screen toggle). */
  setEnabled(v: boolean) { this.enabled = v; }
  /** Composite gate: app-level toggle AND global `BOOSTHIS_DISABLED` env var.
   *  When the env kill-switch is set every record* path becomes a no-op. */
  isEnabled() { return this.enabled && !isRuntimeInert(); }

  /** Lazy hydrate — called on first record. Cheap if already done. */
  private async hydrate() {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      const raw = await platform().storage.get(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PerfState;
        if (Array.isArray(parsed?.events)) {
          // Keep only the last MAX_EVENTS so a long history doesn't
          // bloat memory on launch.
          this.state.events = parsed.events.slice(-MAX_EVENTS);
          this.state.startedAt = parsed.startedAt ?? Date.now();
        }
      }
    } catch {
      // Corrupt storage — start fresh, don't crash.
    }
  }

  /** Schedule a debounced write to AsyncStorage. */
  private scheduleFlush() {
    // The one cadence that runs in EVERY mode: this app is being measured, so
    // the optional transport wrappers are re-asserted here too. A host shim
    // installed over ours would otherwise switch automatic network reporting
    // off for the rest of the session in an app that never captures a
    // snapshot. Throttled inside, and a no-op unless the host opted in.
    safeRun("boosthis.network.reassert", () => assertNetworkAutoWrapSoon());
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      platform().storage.set(STORAGE_KEY, JSON.stringify(this.state)).catch(() => {});
    }, FLUSH_DEBOUNCE);
  }

  /**
   * Was this duration measured across a spell in the background — and should
   * therefore be withheld rather than recorded?
   *
   * A backgrounded phone app does not stop measuring, it stops RUNNING: the
   * screen the user left is still "mounting" and closes an hour later when they
   * come back. Production showed a 7.4-minute resilience p99 and a 15-minute
   * screen mount from exactly this. The server kits already discount a
   * container suspend the same way (see `backgroundSpans.ts` for the shared
   * reasoning); this is the phone's version of that sensor.
   *
   * Withheld, never clamped: a capped sample is a fabricated measurement of
   * work that never happened. The count and the worst withheld duration are
   * published on the axis, so the discount can be read.
   */
  private withheldForBackground(durationMs: number): boolean {
    if (!spansBackgroundSuspend(durationMs)) return false;
    noteBackgroundDiscount(durationMs);
    return true;
  }

  /**
   * Record a single event. No-op if disabled or below the noise floor.
   *
   * Safe to call from anywhere — never throws, never blocks the JS thread.
   */
  recordEvent(name: string, durationMs: number, meta?: PerfEvent["meta"]) {
    if (!this.isEnabled()) return;
    // Phase events bypass the noise floor — we need every checkpoint,
    // including renderStart=0ms, to compute deltas between phases.
    if (durationMs < MIN_LOG_MS && !name.startsWith("phase:")) return;
    // A boot phase that "took" 15 minutes was a backgrounded launch, not a slow
    // one — production carried a 923,390 ms `phase:_boot:interactive`.
    if (this.withheldForBackground(durationMs)) return;
    this.hydrate();   // fire-and-forget; subsequent calls await internally
    this.state.events.push({
      kind: "event",
      name,
      durationMs: Math.round(durationMs),
      ts: Date.now(),
      meta,
    });
    if (this.state.events.length > MAX_EVENTS) {
      this.state.events.splice(0, this.state.events.length - MAX_EVENTS);
    }
    this.scheduleFlush();
  }

  /**
   * Record a screen mount-to-interactive measurement. Used by usePerfTracker.
   *
   * Side-effect: if there is a pending navigation whose `to` matches this
   * screen name, also record a synthetic "nav:from→to" event capturing
   * the FULL tap-to-interactive duration (handler + push transition +
   * mount + InteractionManager settle). This is the number that
   * actually matches what the user feels.
   */
  recordScreen(name: string, durationMs: number, meta?: PerfEvent["meta"]) {
    if (!this.isEnabled() || durationMs < MIN_LOG_MS) return;
    // The mount that spanned a backgrounding measured sleep, not the screen.
    // Screen durations are the sole input to buildRouteSeries(), so this is the
    // one that was poisoning Resilience and Baseline.
    if (this.withheldForBackground(durationMs)) return;
    this.hydrate();
    this.state.events.push({
      kind: "screen",
      name,
      durationMs: Math.round(durationMs),
      ts: Date.now(),
      meta,
    });

    // Auto-correlate with a pending nav, if one is open and not stale.
    const pending = this.pendingNav;
    if (pending && Date.now() - pending.t0 < NAV_STALE_MS) {
      // Match if the destination matches the screen name exactly, OR if
      // the screen name is a prefix (e.g. nav target "team/user" should
      // match a screen named "team/user" but ALSO accept screens that
      // append a sub-route like "team/user#detail").
      if (name === pending.to || name.startsWith(pending.to + "/")) {
        const dur = Date.now() - pending.t0;
        this.pendingNav = null;
        this.recordNav(pending.from, pending.to, dur, pending.meta);
      }
    }

    if (this.state.events.length > MAX_EVENTS) {
      this.state.events.splice(0, this.state.events.length - MAX_EVENTS);
    }
    this.scheduleFlush();
  }

  /**
   * Record a press handler duration (sync work the user's tap blocked on).
   * Anything ≥ MIN_LOG_MS suggests the tap-to-handler-return felt sluggish.
   *
   * Unlike the other record* paths, presses are NOT floored at MIN_LOG_MS:
   * a tap whose handler returned in ~0ms is exactly the signal the on-device
   * circuit map needs (a "dead-end tap" — a control the user pressed that did
   * nothing observable: no nav, no api, no render commit). Dropping those
   * would blind the dead-end-tap detector. Press volume stays bounded by
   * MAX_EVENTS like every other kind, so keeping sub-frame presses is cheap.
   */
  recordPress(name: string, durationMs: number, meta?: PerfEvent["meta"]) {
    if (!this.isEnabled()) return;
    this.hydrate();
    this.state.events.push({
      kind: "press",
      name,
      durationMs: Math.round(durationMs),
      ts: Date.now(),
      meta,
    });
    if (this.state.events.length > MAX_EVENTS) {
      this.state.events.splice(0, this.state.events.length - MAX_EVENTS);
    }
    this.scheduleFlush();
  }

  /**
   * Record a network request. URL is normalized — query string stripped,
   * IDs/UUIDs replaced with `:id` — so `/players/abc-123/stats?x=1`
   * aggregates with `/players/def-456/stats?x=2` under one row:
   *   `api:GET /players/:id/stats`
   * Failed requests get a `!` suffix in the kind name to keep them
   * separate from healthy ones in p95 calculations.
   */
  recordApi(method: string, url: string, durationMs: number, ok: boolean, meta?: PerfEvent["meta"]) {
    if (!this.isEnabled() || durationMs < MIN_LOG_MS) return;
    // A request in flight when the app was backgrounded is held by the OS, not
    // slowed by the server. Timing it across the suspend measures the pocket.
    if (this.withheldForBackground(durationMs)) return;
    this.hydrate();
    const normalized = normalizeApiPath(url);
    const name = `${method.toUpperCase()} ${normalized}${ok ? "" : " (failed)"}`;
    this.state.events.push({
      kind: "api",
      name,
      durationMs: Math.round(durationMs),
      ts: Date.now(),
      meta,
    });
    if (this.state.events.length > MAX_EVENTS) {
      this.state.events.splice(0, this.state.events.length - MAX_EVENTS);
    }
    this.scheduleFlush();
  }

  /**
   * Record a full tap → destination-interactive transition. Usually
   * recorded automatically via beginNav() + recordScreen() correlation,
   * but also callable directly.
   */
  recordNav(from: string, to: string, durationMs: number, meta?: PerfEvent["meta"]) {
    if (!this.isEnabled() || durationMs < MIN_LOG_MS) return;
    // Tap → destination-interactive, measured in wall clock: a backgrounding
    // between the two ends stretches it into a number about nothing.
    if (this.withheldForBackground(durationMs)) return;
    this.hydrate();
    this.state.events.push({
      kind: "nav",
      name: `${from}→${to}`,
      durationMs: Math.round(durationMs),
      ts: Date.now(),
      meta,
    });
    if (this.state.events.length > MAX_EVENTS) {
      this.state.events.splice(0, this.state.events.length - MAX_EVENTS);
    }
    this.scheduleFlush();
  }

  /* ─── Pending-navigation slot ──────────────────────────────────────── */
  // Single-slot intentional: React Native nav is serial — the user can't
  // start a 2nd nav before the 1st mounts. If something weird does happen,
  // NAV_STALE_MS prevents a stuck pending slot from corrupting later runs.
  private pendingNav:
    | { from: string; to: string; t0: number; meta?: PerfEvent["meta"] }
    | null = null;

  /**
   * Open a pending navigation. Call this from your tap handler RIGHT
   * BEFORE router.push/replace. The matching destination's
   * usePerfTracker (via recordScreen) will close it automatically.
   *
   *   perfMonitor.beginNav("search", "team/user", { id: t.id });
   *   router.push({ pathname: "/team/user", params: { id: t.id } });
   */
  beginNav(from: string, to: string, meta?: PerfEvent["meta"]) {
    if (!this.isEnabled()) return;
    this.pendingNav = { from, to, t0: Date.now(), meta };
  }

  /** Cancel a pending nav (e.g. if the press handler bailed early). */
  cancelNav() {
    this.pendingNav = null;
  }

  /**
   * Wrap a synchronous tap handler so its duration is recorded as a
   * "press" event. The wrapper is transparent — same return value,
   * same `this`. Use for the onPress prop of TouchableOpacity etc.
   *
   *   onPress={perfMonitor.wrapPress("search.tapTeamResult", () => {
   *     perfMonitor.beginNav("search", "team/user", { id: t.id });
   *     router.push(...);
   *   })}
   */
  wrapPress<T extends (...args: any[]) => any>(name: string, fn: T): T {
    if (!this.isEnabled()) return fn;
    const wrapped = ((...args: any[]) => {
      const t0 = Date.now();
      try {
        return fn(...args);
      } finally {
        this.recordPress(name, Date.now() - t0);
      }
    }) as T;
    return wrapped;
  }

  /**
   * Convenience: time an arbitrary async function and record the duration.
   */
  async time<T>(name: string, fn: () => Promise<T>, meta?: PerfEvent["meta"]): Promise<T> {
    if (!this.isEnabled()) return fn();
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      this.recordEvent(name, Date.now() - t0, meta);
    }
  }

  /** Snapshot of all recorded events. */
  async getEvents(): Promise<PerfEvent[]> {
    await this.hydrate();
    return [...this.state.events];
  }

  /** Synchronous read of already-recorded events for small inventory readers.
   *  It deliberately does not hydrate, start, schedule, or mutate anything. */
  observedEventCount(kind: PerfEventKind): number {
    return this.state.events.reduce(
      (count, event) => count + (event.kind === kind ? 1 : 0),
      0,
    );
  }

  /** Compute aggregated rows from the in-memory event log. Pure. */
  private computeRows(): PerfRow[] {
    const buckets = new Map<string, number[]>();
    const lastMs  = new Map<string, number>();
    for (const e of this.state.events) {
      const key = `${e.kind}:${e.name}`;
      const arr = buckets.get(key) ?? [];
      arr.push(e.durationMs);
      buckets.set(key, arr);
      lastMs.set(key, e.durationMs);
    }
    const rows: PerfRow[] = [];
    for (const [key, arr] of buckets) {
      const sorted = [...arr].sort((a, b) => a - b);
      const p = (q: number) =>
        sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
      // Spread stats: p99 tail + sample stdev. Numbers only — these ride the
      // same PII-guarded paths as p50/p95 and carry no labels or values.
      const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
      const stdev = arr.length < 2
        ? 0
        : Math.round(Math.sqrt(
            arr.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (arr.length - 1),
          ));
      rows.push({
        key,
        count: arr.length,
        p50:   p(0.50),
        p95:   p(0.95),
        max:   sorted[sorted.length - 1],
        last:  lastMs.get(key) ?? 0,
        p99:   p(0.99),
        stdev,
      });
    }
    rows.sort((a, b) => b.p95 - a.p95);
    return rows;
  }

  /** Lazy-loaded baseline — null when no snapshot has ever been saved. */
  private baselineCache: BaselineSnapshot | null | undefined = undefined;
  private async loadBaseline(): Promise<BaselineSnapshot | null> {
    if (this.baselineCache !== undefined) return this.baselineCache;
    try {
      const raw = await platform().storage.get(STORAGE_KEY_BASELINE);
      this.baselineCache = raw ? (JSON.parse(raw) as BaselineSnapshot) : null;
    } catch {
      this.baselineCache = null;
    }
    return this.baselineCache;
  }

  /**
   * Save the current report shape as the regression baseline.
   * Subsequent reports will diff against this snapshot and surface
   * any phase that regressed >30% AND >50ms as a `regression`
   * cross-cutting finding. Call this when the app is in a known-
   * good state (e.g. after a clean session you're happy with).
   */
  async snapshotBaseline(): Promise<BaselineSnapshot> {
    await this.hydrate();
    const rows = this.computeRows();
    const snap = buildBaselineSnapshot(rows);
    this.baselineCache = snap;
    try {
      await platform().storage.set(STORAGE_KEY_BASELINE, JSON.stringify(snap));
    } catch {}
    return snap;
  }

  /** Erase the baseline. Next report will not include regression findings. */
  async clearBaseline(): Promise<void> {
    this.baselineCache = null;
    try { await platform().storage.remove(STORAGE_KEY_BASELINE); } catch {}
  }

  /**
   * Aggregated report:
   *   { name → { count, p50, p95, max, lastMs } }
   * Sorted by p95 descending so the worst offenders are first.
   */
  async getReport() {
    await this.hydrate();
    const rows = this.computeRows();
    const baseline = await this.loadBaseline();
    // Auto-diagnose: classify each screen's bottleneck pattern and attach
    // prescriptive hints so the UI / AI agent doesn't have to re-derive them.
    // Pure function over the rows we just computed — see lib/perfDiagnose.ts.
    // The optional baseline arg adds `regression` cross-cutting findings
    // for any phase that got materially slower since the snapshot.
    const diagnosis: DiagnosisReport = diagnose(rows, baseline ?? undefined);
    // Bundle the long-session diagnosis into the same report so the
    // existing export flow (dev/perf "Copy report" → /tmp/boosthis-
    // latest.json) carries both signals without any extra wiring.
    // longSession.getReport() awaits its own hydration, so this is
    // safe to call from inside the already-async getReport().
    const longReport: LongSessionReport = (await longSession.getReport()).diagnosis;
    return {
      startedAt:    this.state.startedAt,
      totalEvents:  this.state.events.length,
      platform:     platform().platformName,
      rows,
      diagnosis,
      longSession:  longReport,
      baselineAt:   baseline?.savedAt ?? null,
    };
  }

  /** Wipe all collected data. */
  async clear() {
    this.state = { events: [], startedAt: Date.now() };
    this.hydrated = true;
    try { await platform().storage.remove(STORAGE_KEY); } catch {}
  }
}

/**
 * Build a chronologically-ordered mount-duration series per SCREEN route from
 * the event log, for the additive Baseline anomaly axis (each screen graded
 * against its OWN recent history). Pure; safe to call anywhere.
 *
 * SCREEN mounts only — the clearest "its own normal" signal — and the returned
 * shape is LABEL-FREE: only the ordered `durations` leave this function, never
 * the route key, so the Baseline axis stays purely numeric and carries no
 * screen content. Events arrive in push (chronological) order, so each route's
 * durations are oldest→newest, exactly what the baseline-vs-recent split needs.
 */
export function buildRouteSeries(events: PerfEvent[]): { durations: number[] }[] {
  const buckets = new Map<string, number[]>();
  for (const e of events) {
    if (e.kind !== "screen") continue;
    const arr = buckets.get(e.name) ?? [];
    arr.push(e.durationMs);
    buckets.set(e.name, arr);
  }
  return [...buckets.values()].map((durations) => ({ durations }));
}

/**
 * Normalize an API URL so different IDs aggregate under one row.
 *   /players/abc-123/stats?x=1     → /players/:id/stats
 *   https://api.example.com/foo/42 → /foo/:id
 *
 * Strips: scheme+host, query string, fragment.
 * Replaces: any path segment that's all-digits OR matches a UUID
 * pattern OR contains both a letter and a digit (likely opaque ID).
 */
// Re-exported from the leaf that owns it (src/apiPath.ts). It used to be
// defined here, and this module imports the network wrapper — which now
// reaches the screen circuit, which needs a route label — so a helper defined
// here closed a require cycle. Every importer that reads it from this module
// still works.
export { normalizeApiPath };

export const perfMonitor = new PerfMonitor();

/* ─── Long-session sampling ──────────────────────────────────────────
 * Watches counters that drift over the lifetime of a session. The
 * tracker is a singleton because it monkey-patches global timer
 * functions and runs a rAF loop — we want exactly one of each, no
 * matter how many places call startLongSession().
 *
 * See lib/perfDiagnose.ts > diagnoseLongSession for how the samples
 * get classified (timer-leak / frame-drift / heap-growth / stable).
 */
class LongSessionTracker {
  private started      = false;
  private startedAt    = 0;
  private hydrated     = false;
  private samples:       LongSessionSample[] = [];
  private sampleTimer:   ReturnType<typeof setTimeout> | null = null;
  private flushTimer:    ReturnType<typeof setTimeout> | null = null;
  private rafHandle:     number | null = null;
  private frameDeltas:   number[] = [];
  private lastFrameAt    = 0;
  private activeTimers   = 0;

  /**
   * Begin sampling. Idempotent — calling twice has no extra effect.
   * Only the FIRST call installs the global monkey-patches; the rAF
   * loop and 30s timer also stay singletons across calls.
   */
  start() {
    if (this.started) return;
    this.started = true;
    this.startedAt = Date.now();
    this.hydrate();
    this.installTimerCounter();
    this.startFrameLoop();
    this.scheduleNextSample();
  }

  /**
   * Stop sampling. Used by the dev/perf "Reset" button. We do NOT
   * uninstall the timer monkey-patches — they're cheap (one ++/--
   * per scheduled timer) and removing them safely from a live app
   * is fiddly. Future start() calls just reuse them.
   */
  stop() {
    this.started = false;
    if (this.sampleTimer != null) { clearTimeout(this.sampleTimer); this.sampleTimer = null; }
    if (this.rafHandle != null)   { cancelAnimationFrame(this.rafHandle); this.rafHandle = null; }
  }

  /**
   * Monkey-patch globals so every scheduled timer is counted, and
   * decremented on fire OR clear. We only patch once even if start()
   * is called repeatedly — guarded by a sentinel on the function.
   */
  private installTimerCounter() {
    const g = globalThis as any;
    if (g.__rivalTimerCounterInstalled) return;
    g.__rivalTimerCounterInstalled = true;

    const origSetTimeout    = g.setTimeout;
    const origSetInterval   = g.setInterval;
    const origClearTimeout  = g.clearTimeout;
    const origClearInterval = g.clearInterval;

    // Track which IDs were registered through our wrappers so a
    // double-clear (or a clear of an already-fired timeout) doesn't
    // decrement twice and drift the count negative.
    const trackedIds = new Set<unknown>();
    const dec = (id: unknown) => {
      if (trackedIds.has(id)) { trackedIds.delete(id); this.activeTimers--; }
    };

    g.setTimeout = (fn: (...a: any[]) => any, ms?: number, ...rest: any[]) => {
      let id: unknown;
      const wrapped = (...args: any[]) => {
        dec(id);
        return fn(...args);
      };
      id = origSetTimeout(wrapped, ms, ...rest);
      trackedIds.add(id);
      this.activeTimers++;
      return id;
    };

    g.setInterval = (fn: (...a: any[]) => any, ms?: number, ...rest: any[]) => {
      // Intervals stay active until cleared — count once, never
      // auto-decrement on fire (unlike setTimeout).
      const id = origSetInterval(fn, ms, ...rest);
      trackedIds.add(id);
      this.activeTimers++;
      return id;
    };

    g.clearTimeout = (id: unknown) => {
      dec(id);
      return origClearTimeout(id);
    };

    g.clearInterval = (id: unknown) => {
      dec(id);
      return origClearInterval(id);
    };
  }

  /**
   * Continuous rAF loop — captures frame-to-frame ms into a rolling
   * window. One loop, regardless of how many components also use rAF.
   */
  private startFrameLoop() {
    if (this.rafHandle != null) return;
    const tick = () => {
      const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
      if (this.lastFrameAt > 0) {
        const dt = now - this.lastFrameAt;
        // Filter obvious outliers from JS thread suspension (>500ms
        // typically means the app was backgrounded). They'd skew p95
        // wildly without telling us anything new.
        if (dt > 0 && dt < 500) {
          this.frameDeltas.push(dt);
          if (this.frameDeltas.length > FRAME_WINDOW) {
            this.frameDeltas.splice(0, this.frameDeltas.length - FRAME_WINDOW);
          }
        }
      }
      this.lastFrameAt = now;
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  /** Capture one sample and schedule the next. Self-rescheduling. */
  private scheduleNextSample() {
    this.sampleTimer = setTimeout(() => {
      if (!this.started) return;
      this.captureSample();
      this.scheduleNextSample();
    }, LONG_SAMPLE_MS);
  }

  private captureSample() {
    const sorted = [...this.frameDeltas].sort((a, b) => a - b);
    const p = (q: number) =>
      sorted.length === 0 ? 0 :
      sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];

    // Heap is best-effort — adapter returns null on runtimes that
    // don't expose a JS heap counter (JSC, Safari, Node w/o flags).
    const jsHeapMb: number | null = platform().heapMb();

    this.samples.push({
      t:            Date.now() - this.startedAt,
      activeTimers: this.activeTimers,
      frameP50Ms:   p(0.50),
      frameP95Ms:   p(0.95),
      jsHeapMb,
      // Whose frames and whose heap these are. Read HERE, at the moment the
      // sample is taken — null is an answer ("no screen was current"), and
      // the last screen seen is never used as a stand-in for it.
      screen:       currentScreen(),
    });
    if (this.samples.length > MAX_LONG_SAMPLES) {
      this.samples.splice(0, this.samples.length - MAX_LONG_SAMPLES);
    }
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      platform().storage.set(
        STORAGE_KEY_LONG,
        JSON.stringify({ startedAt: this.startedAt, samples: this.samples }),
      ).catch(() => {});
    }, FLUSH_DEBOUNCE);
  }

  private async hydrate() {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      const raw = await platform().storage.get(STORAGE_KEY_LONG);
      if (raw) {
        const parsed = JSON.parse(raw) as { startedAt?: number; samples?: LongSessionSample[] };
        if (Array.isArray(parsed?.samples)) {
          this.samples   = parsed.samples.slice(-MAX_LONG_SAMPLES);
          this.startedAt = parsed.startedAt ?? this.startedAt;
        }
      }
    } catch {}
  }

  /** Snapshot + diagnose — what the dev/perf screen calls. */
  async getReport(): Promise<{
    startedAt:   number;
    samples:     LongSessionSample[];
    diagnosis:   LongSessionReport;
    platform:    string;
  }> {
    await this.hydrate();
    return {
      startedAt: this.startedAt,
      samples:   [...this.samples],
      diagnosis: diagnoseLongSession(this.samples),
      platform:  platform().platformName,
    };
  }

  async clear() {
    this.samples   = [];
    this.startedAt = Date.now();
    this.hydrated  = true;
    try { await platform().storage.remove(STORAGE_KEY_LONG); } catch {}
  }
}

export const longSession = new LongSessionTracker();

/**
 * Helper: returns a cancellable timer for screen mount.
 * Call start() on first render, then ready() once
 * InteractionManager.runAfterInteractions resolves.
 */
export function makeScreenTimer(name: string, meta?: PerfEvent["meta"]) {
  const t0 = Date.now();
  let done = false;
  let handle: { cancel: () => void } | null = null;

  const ready = () => {
    if (done) return;
    done = true;
    perfMonitor.recordScreen(name, Date.now() - t0, meta);
  };

  // Auto-mark when the navigation transition + initial layout settle.
  handle = InteractionManager.runAfterInteractions(ready);

  return {
    /** Manually mark ready (overrides the InteractionManager auto-mark). */
    ready,
    cancel: () => {
      done = true;
      handle?.cancel?.();
    },
  };
}

/* ─── Frame-drop sampler ─────────────────────────────────────────────
 * Lightweight rAF-based JS frame timing. Independent of LongSession
 * (which tracks long-lived counters on a 30s cadence) so it can be
 * started/stopped on demand from /dev/perf to capture frame health
 * during a specific interaction, without polluting the long-session
 * timeline.
 *
 * What it measures: time between successive requestAnimationFrame
 * callbacks. On a healthy 60fps app, deltas cluster at ~16.67ms. A
 * frame > 32ms means we missed at least one frame paint — that's the
 * "jank" the user actually sees as stutter.
 *
 * What it CAN'T measure: native-thread time, GPU stalls, or render
 * passes that happen entirely off the JS thread. For those you need
 * a turbo-module bridge to the platform's frame metrics API; out of
 * scope for this dev tool.
 */
const FRAME_SAMPLER_WINDOW = 240;   // ~4 seconds of frames at 60fps
const JANK_THRESHOLD_MS    = 32;    // > 32ms = missed a 60fps frame budget
const LONG_TASK_MS         = 50;    // ≥ 50ms between frames = a JS-thread "long task" (a perceptible stall)
const SUSPENSION_CUTOFF_MS = 500;   // anything above this is app-backgrounded, not jank
/** How many distinct screens the long-task tally holds before further ones
 *  are counted without a screen rather than growing without bound. */
const LONG_TASK_SCREEN_CAP = 50;
const IDLE_AFTER_MS        = 5_000; // ≥5s since the last touch = the user has stopped interacting; frames after this are "idle", where a well-behaved app should be quiescent — anything it still burns is wasted/battery work
const FROZEN_FRAME_MS      = 700;   // industry (Sentry) frozen-frame threshold: a foreground gap ≥700ms is a visibly frozen frame, not mere jank
const APP_HANG_MS          = 5_000; // Sentry app-hang threshold: the main JS queue was unresponsive ≥5s. This is the HONEST JS-side watchdog (a frame that never fired for ≥5s), NOT a native ANR.

/* ─── App-state disambiguation (frozen-frame / app-hang classification) ──
 * A frame gap ≥ SUSPENSION_CUTOFF_MS is ambiguous: it can be an app being
 * backgrounded (legitimately dropped) OR a real freeze/hang while the app was
 * in the FOREGROUND. To tell them apart we track AppState transitions on the
 * SAME frameNow() clock the sampler uses. If NO app-state transition happened
 * during a large gap AND the app is currently 'active', the gap is a confirmed
 * foreground freeze/hang; otherwise it stays a suspected suspension (we NEVER
 * guess). If AppState is unavailable we cannot disambiguate, so we keep the old
 * behaviour and count every large gap as a suspension.
 *
 * GUEST-SAFETY: subscription is attached best-effort via a lazy require of
 * react-native inside try/catch (mirrors memoryWarnings.ts). If AppState /
 * addEventListener is missing or throws, tracking stays OFF, appStateAvailable
 * stays false, and classification falls back to the suspension path — the host
 * is never touched, nothing ever throws into the app. */
let appStateAvailable       = false;
let currentAppState         = "active";
let lastAppStateChangeAt     = 0;
let appStateSubscription: { remove?: () => void } | null = null;

/** Minimal shape of the bits of react-native we touch (lazy-required). */
interface AppStateModuleLike {
  currentState?: string | null;
  addEventListener?: (
    type: string,
    handler: (...args: unknown[]) => void,
  ) => { remove?: () => void } | void;
}
interface RNModuleLike {
  AppState?: AppStateModuleLike;
}

/** Attach the AppState 'change' listener, best-effort. Idempotent, NEVER
 *  throws. On any failure tracking stays OFF and large gaps fall back to the
 *  suspected-suspension path. Installed lazily from FrameSampler.start(). */
function installAppStateTracking(): void {
  if (appStateAvailable) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require("react-native") as RNModuleLike;
    const appState = rn?.AppState;
    if (!appState || typeof appState.addEventListener !== "function") return;
    if (typeof appState.currentState === "string") {
      currentAppState = appState.currentState;
    }
    const handler = (next: unknown) => {
      try {
        if (typeof next === "string") currentAppState = next;
        lastAppStateChangeAt = frameNow();
      } catch {
        /* never throw into the host's event dispatch */
      }
    };
    const sub = appState.addEventListener("change", handler);
    appStateSubscription =
      sub && typeof (sub as { remove?: unknown }).remove === "function"
        ? (sub as { remove?: () => void })
        : null;
    appStateAvailable = true;
  } catch {
    appStateAvailable = false;
    appStateSubscription = null;
  }
}

/** Remove the AppState listener. Idempotent, NEVER throws. Called from
 *  FrameSampler.stop() so the subscription lifecycle follows the sampler. */
function uninstallAppStateTracking(): void {
  try {
    appStateSubscription?.remove?.();
  } catch {
    /* best-effort — never throw on teardown */
  }
  appStateSubscription = null;
  appStateAvailable = false;
}

/** Monotonic-ish clock shared by the frame sampler and its touch marker so the
 *  idle gap is measured on ONE timeline: performance.now() when present
 *  (RN/Hermes, browsers), Date.now() otherwise. */
const frameNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Set by `installFrameSampling()` when it looked for `requestAnimationFrame`
 * and this host does not have one. Deliberately NOT the same thing as "the
 * sampler is not running": a kit that has not started, a dev "Reset", and
 * `forget()` all stop the sampler while saying nothing at all about the host.
 * Only this flag lets a frame-derived axis report a permanent silence.
 */
let frameSourceAbsent = false;

export interface FrameStats {
  /** 1 while the rAF sampler is running, 0 when it is not. NOT evidence about
   * the host: a kit that has not started yet and one stopped by `forget()` are
   * both 0. Never read this to decide that a reading is impossible here. */
  sampling?:     0 | 1;
  /** POSITIVE evidence that this host has no frame source: installation was
   * ATTEMPTED and `requestAnimationFrame` was not a function. Only this earns
   * the frame-derived axes their permanent "not available here" word; it is
   * cleared the moment a sampler does start and on teardown, so the next
   * install decides again. Optional for old snapshots. */
  sourceAbsent?: 0 | 1;
  isRunning:    boolean;
  sampleCount:  number;
  p50Ms:        number;
  p95Ms:        number;
  p99Ms:        number;
  /** Fraction of frames that exceeded the 60fps budget — 0..1. */
  jankFraction: number;
  /** Worst single frame in the window, ms. Useful for spotting
   *  one-shot stalls that p99 would smooth over. */
  worstMs:      number;
  /** Cumulative, session-long count of frame gaps ≥ LONG_TASK_MS (≥50ms) —
   *  i.e. how many times the JS thread blocked long enough to feel like a
   *  stall. NOT windowed (the 240-frame window is far too short to count a
   *  session-wide rate); this drives the additive Stability axis. */
  longTaskCount: number;
  /** Long tasks per minute of FOREGROUND sampling (longTaskCount ÷ activeMin).
   *  0 until any foreground time is accrued. */
  longTasksPerMin: number;
  /** Worst single JS-thread block (ms) seen this session, ≥ LONG_TASK_MS, or
   *  0 if none. Distinct from `worstMs` (worst in the 4s window). */
  worstBlockMs: number;
  /** WHICH screens the long tasks happened on, counted at the moment each
   *  stall was measured, busiest first. Empty when none could name a screen —
   *  never padded with a stand-in name. Sums to `longTaskCount` together with
   *  `longTasksWithoutScreen`. */
  longTaskScreens: { screen: string; count: number }[];
  /** Long tasks that could not name a screen: none was current, or there were
   *  more screens than the tally holds. Worded with NO_SCREEN_WORDING; never
   *  charged to the last screen seen. */
  longTasksWithoutScreen: number;
  /** The screen that was current when `worstBlockMs` was measured, or null if
   *  none was. */
  worstBlockScreen: string | null;
  /** Total foreground sampling time (ms) — the sum of all counted frame gaps,
   *  excluding backgrounded suspensions. The Stability axis's denominator and
   *  its confidence floor. */
  activeMs: number;
  /** Frames sampled while the app was IDLE (≥ IDLE_AFTER_MS since the last
   *  touch). The denominator + confidence floor for the additive Idle
   *  (wasted-work / battery) axis. 0 until the user has gone idle at least once. */
  idleFrameCount: number;
  /** Of those idle frames, how many blew the 60fps budget (>32ms) — i.e. the JS
   *  thread did work while the user wasn't interacting. The Idle axis's
   *  numerator (kept on-device; the axis uploads only the derived percentage). */
  idleJankFrames: number;
  /** Of those idle frames, how many were ≥50ms JS-thread blocks (long tasks)
   *  while idle — sustained wasted work. Surfaced raw on the Idle axis. */
  idleLongTaskCount: number;
  /** Cumulative, session-long count of frame gaps ≥ SUSPENSION_CUTOFF_MS (≥500ms)
   *  that were EXCLUDED from the rolling window as "backgrounded suspensions".
   *  Not a score input — a HONESTY annotation: a flat "0% jank" window can hide a
   *  single catastrophic ≥500ms stall that was dropped here, so the meter surfaces
   *  how many gaps it chose not to count. Resets only on clear(). */
  suspectedSuspensions: number;
  /** Sustained-frame-rate FLOOR: the WORST completed 1-second window's
   *  effective frame rate (frames ÷ window seconds) seen this session, so a
   *  single bad stretch is never averaged away by a healthy mean FPS. 0 until
   *  the first 1s window completes. Counts + rates only — drives the additive
   *  Frame Floor axis and resets only on clear(). */
  floorFps: number;
  /** How many complete 1-second windows back `floorFps` (the axis's
   *  confidence floor). A window never spans a suspected suspension — the
   *  in-progress bucket is discarded on a ≥500ms gap so a backgrounding can
   *  never fabricate a catastrophic-looking window. */
  floorWindowCount: number;
  /** Cumulative, session-long count of CONFIRMED-FOREGROUND frozen frames: a
   *  frame gap ≥ FROZEN_FRAME_MS (≥700ms, Sentry's industry threshold) but
   *  < APP_HANG_MS (5s), where NO app-state transition occurred during the gap
   *  and the app was 'active'. Distinct from suspectedSuspensions (which stays
   *  for gaps we could NOT confirm as foreground). Drives the additive
   *  frozen-frame axis; resets only on clear(). 0 when AppState is unavailable
   *  (we never guess a suspension is a freeze). */
  frozenFrameCount: number;
  /** Cumulative, session-long count of CONFIRMED-FOREGROUND app hangs: a
   *  foreground frame gap ≥ APP_HANG_MS (≥5s), i.e. the main JS queue was
   *  unresponsive for ≥5s while the app stayed 'active'. This is the honest
   *  JS-side watchdog (a rAF that never fired), NOT a native ANR. Drives the
   *  additive app-hang axis; resets only on clear(). 0 when AppState is
   *  unavailable. */
  hangCount: number;
  /** Worst single confirmed-foreground app hang (ms) seen this session, or 0
   *  if none. Counts + durations only. */
  worstHangMs: number;
}

class FrameSampler {
  private running     = false;
  private deltas:     number[] = [];
  private lastFrameAt = 0;
  private rafHandle:  number | null = null;
  // Cumulative, session-long counters for the Stability axis. The `deltas`
  // window above is only ~4s, so it can't count session-wide long tasks —
  // these accrue across the whole session and reset only on clear().
  private longTaskCount = 0;
  private worstBlockMs  = 0;
  private activeMs      = 0;
  // WHERE the stalls happened. A bare "13 long tasks, worst 240ms" points
  // nowhere; the kit already knows which screen was up, so each stall is
  // filed under the screen current AT THE MOMENT it was counted. A stall with
  // no screen current is counted apart, never charged to the last screen seen
  // — surfaces word that count with NO_SCREEN_WORDING.
  private longTaskByScreen = new Map<string, number>();
  private longTasksWithoutScreen = 0;
  private worstBlockScreen: string | null = null;
  // Idle (wasted-work / battery) axis source. markTouch() records the last
  // interaction time in the SAME clock the tick loop uses; any frame sampled
  // ≥ IDLE_AFTER_MS after that is "idle", where the app should be doing nothing.
  // We only start counting once the user has touched at least once
  // (lastTouchAt > 0) so app-launch/boot work is never mis-attributed as idle
  // waste. These accrue across the whole session and reset only on clear().
  private lastTouchAt       = 0;
  private idleFrameCount    = 0;
  private idleJankFrames    = 0;
  private idleLongTaskCount = 0;
  // Honesty annotation: how many ≥500ms gaps we dropped as "backgrounded" and so
  // left OUT of the windowed p-stats. A flat "0% jank" must never silently hide a
  // catastrophic stall — this counts what the window chose not to see.
  private suspectedSuspensions = 0;
  // Sustained-frame-rate floor (Frame Floor axis source). Frames are bucketed
  // into consecutive ~1s windows of FOREGROUND time; when a bucket completes,
  // its effective FPS is compared against the session's worst. The in-progress
  // bucket is DISCARDED on a suspected suspension so a backgrounding gap can
  // never split a window and fake a near-zero FPS reading. Counts only.
  private floorBucketMs     = 0;
  private floorBucketFrames = 0;
  private floorWorstFps     = 0; // 0 = no complete window yet
  private floorWindowCount  = 0;
  // Frozen-frame / app-hang counters (additive frozenFrames + appHang axes).
  // A large gap is classified as a confirmed-foreground FREEZE only when
  // AppState is available, no app-state transition happened during the gap,
  // and the app is currently 'active' — otherwise it stays a suspected
  // suspension (see tick()). Counts + one worst-duration only; reset on clear().
  private frozenFrameCount = 0;
  private hangCount        = 0;
  private worstHangMs      = 0;

  start() {
    if (this.running) return;
    this.running = true;
    this.lastFrameAt = 0;
    // Install the AppState listener that disambiguates large gaps into
    // foreground freezes/hangs vs. backgrounded suspensions. Best-effort +
    // idempotent; a failure just leaves classification on the old suspension
    // path. Lifecycle follows the sampler (removed in stop()).
    installAppStateTracking();
    const tick = () => {
      if (!this.running) return;
      const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
      if (this.lastFrameAt > 0) {
        const dt = now - this.lastFrameAt;
        if (dt > 0 && dt < SUSPENSION_CUTOFF_MS) {
          this.deltas.push(dt);
          if (this.deltas.length > FRAME_SAMPLER_WINDOW) {
            this.deltas.splice(0, this.deltas.length - FRAME_SAMPLER_WINDOW);
          }
          // Cumulative tallies (foreground time + long-task count) — these are
          // the Stability axis's signal, kept outside the rolling window so a
          // session-wide rate-per-minute can be derived. Backgrounded gaps
          // (dt ≥ SUSPENSION_CUTOFF_MS) are excluded by the guard above, so a
          // tab-away never inflates either the denominator or the count.
          this.activeMs += dt;
          if (dt >= LONG_TASK_MS) {
            this.longTaskCount++;
            const onScreen = currentScreen();
            if (onScreen == null) {
              this.longTasksWithoutScreen++;
            } else if (this.longTaskByScreen.size < LONG_TASK_SCREEN_CAP ||
                       this.longTaskByScreen.has(onScreen)) {
              this.longTaskByScreen.set(
                onScreen,
                (this.longTaskByScreen.get(onScreen) ?? 0) + 1,
              );
            } else {
              // More screens than the tally holds. The stall is still counted
              // in the total; what is lost is WHICH screen, and that is said
              // rather than guessed.
              this.longTasksWithoutScreen++;
            }
            if (dt > this.worstBlockMs) {
              this.worstBlockMs = dt;
              this.worstBlockScreen = onScreen;
            }
          }
          // Idle (wasted-work) accrual — only AFTER the user has interacted at
          // least once (lastTouchAt > 0, so boot work is excluded) and then
          // gone quiet for ≥ IDLE_AFTER_MS. A quiescent app should burn ~no
          // frames here; any jank/long task while idle is wasted battery. Uses
          // the SAME `now`/clock as the touch marker so the gap is apples-to-
          // apples, and reuses the SAME 32ms/50ms cutoffs as the other axes so
          // the threshold meaning stays consistent (no new magic numbers).
          if (this.lastTouchAt > 0 && now - this.lastTouchAt >= IDLE_AFTER_MS) {
            this.idleFrameCount++;
            if (dt > JANK_THRESHOLD_MS) this.idleJankFrames++;
            if (dt >= LONG_TASK_MS) this.idleLongTaskCount++;
          }
          // Frame-floor bucketing: accumulate this frame into the current ~1s
          // window; on completion, keep the WORST window's effective FPS. Uses
          // the same counted deltas as everything above, so suspensions are
          // already excluded from the accumulation itself.
          this.floorBucketMs += dt;
          this.floorBucketFrames++;
          if (this.floorBucketMs >= 1_000) {
            const fps = this.floorBucketFrames / (this.floorBucketMs / 1_000);
            this.floorWindowCount++;
            if (this.floorWorstFps === 0 || fps < this.floorWorstFps) {
              this.floorWorstFps = fps;
            }
            this.floorBucketMs = 0;
            this.floorBucketFrames = 0;
          }
        } else if (dt >= SUSPENSION_CUTOFF_MS) {
          // A gap this large is ambiguous — a backgrounding OR a real
          // foreground freeze/hang. Disambiguate with AppState: it is a
          // confirmed-foreground FREEZE only when (a) AppState is available,
          // (b) NO app-state transition happened during the gap
          // (lastAppStateChangeAt < this.lastFrameAt, i.e. the last transition
          // predates the frame the gap started from), and (c) the app is
          // currently 'active'. If AppState is unavailable we NEVER guess —
          // we keep the old suspension behaviour.
          const foregroundFreeze =
            appStateAvailable &&
            currentAppState === "active" &&
            lastAppStateChangeAt < this.lastFrameAt;
          if (foregroundFreeze) {
            // Confirmed foreground freeze/hang — NOT a suspension.
            if (dt >= APP_HANG_MS) {
              // ≥5s: the main JS queue was unresponsive. Honest JS-side
              // app-hang verdict (not a native ANR).
              this.hangCount++;
              if (dt > this.worstHangMs) this.worstHangMs = dt;
            } else if (dt >= FROZEN_FRAME_MS) {
              // ≥700ms (< 5s): a visibly frozen frame (Sentry threshold).
              this.frozenFrameCount++;
            }
            // Gaps 500–700ms with no transition are neither a frozen frame nor
            // a suspension: we do NOT increment suspectedSuspensions (it was a
            // confirmed foreground gap, not a backgrounding) and count nothing
            // else — kept deliberately simple.
          } else {
            // Could not confirm foreground (backgrounded, a transition
            // straddled the gap, or AppState unavailable). Count it anyway so
            // the meter can honestly say "N suspensions ignored" next to a 0%
            // jank reading — a single 600ms stall lives here, not in p99.
            this.suspectedSuspensions++;
          }
          // Discard the in-progress frame-floor bucket: a window must never
          // span a large gap (a backgrounding OR a freeze), or the split halves
          // would read as two artificially frame-starved windows.
          this.floorBucketMs = 0;
          this.floorBucketFrames = 0;
        }
      }
      this.lastFrameAt = now;
      // Timer Health axis: sample the outstanding-timer count at the SAME frame
      // cadence (no new poller). sampleTimerCount is internally throttled to
      // one sample/second and NEVER throws — a no-op when tracking is off.
      sampleTimerCount(now);
      // Hermes heap/GC axes: capture a checkpoint at the SAME frame cadence (no
      // new poller). sampleHermes is throttled to one/second and NEVER throws —
      // a no-op unless BOOSTHIS_HERMES_HEAP/BOOSTHIS_HERMES_GC is set.
      sampleHermes(now);
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  /** Note that the user just interacted, on the SAME clock the tick loop uses.
   *  Called by useFidSampler on every touch capture. Resets the idle window:
   *  a frame only counts as "idle" once IDLE_AFTER_MS has elapsed since the most
   *  recent markTouch(). Coordinate-free — only the timestamp is kept. */
  markTouch() {
    this.lastTouchAt = frameNow();
  }

  stop() {
    this.running = false;
    if (this.rafHandle !== null) {
      try { cancelAnimationFrame(this.rafHandle); } catch {}
      this.rafHandle = null;
    }
    // Subscription lifecycle follows the sampler: drop the AppState listener so
    // nothing Boosthis-shaped keeps listening while the sampler is stopped.
    uninstallAppStateTracking();
  }

  isRunning() { return this.running; }

  clear() {
    this.deltas = [];
    this.lastFrameAt = 0;
    this.longTaskCount = 0;
    this.worstBlockMs  = 0;
    this.activeMs      = 0;
    this.longTaskByScreen.clear();
    this.longTasksWithoutScreen = 0;
    this.worstBlockScreen  = null;
    this.lastTouchAt       = 0;
    this.idleFrameCount    = 0;
    this.idleJankFrames    = 0;
    this.idleLongTaskCount = 0;
    this.suspectedSuspensions = 0;
    this.floorBucketMs     = 0;
    this.floorBucketFrames = 0;
    this.floorWorstFps     = 0;
    this.floorWindowCount  = 0;
    this.frozenFrameCount  = 0;
    this.hangCount         = 0;
    this.worstHangMs       = 0;
  }

  /** Snapshot the current rolling window. Pure read — sampler keeps running. */
  getStats(): FrameStats {
    const sorted = [...this.deltas].sort((a, b) => a - b);
    const p = (q: number) =>
      sorted.length === 0 ? 0 :
      sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
    const janky = sorted.filter((d) => d > JANK_THRESHOLD_MS).length;
    const longTasksPerMin =
      this.activeMs > 0 ? this.longTaskCount / (this.activeMs / 60_000) : 0;
    return {
      sampling:     this.running ? 1 : 0,
      sourceAbsent: frameSourceAbsent ? 1 : 0,
      isRunning:    this.running,
      sampleCount:  sorted.length,
      p50Ms:        p(0.50),
      p95Ms:        p(0.95),
      p99Ms:        p(0.99),
      jankFraction: sorted.length === 0 ? 0 : janky / sorted.length,
      worstMs:      sorted.length === 0 ? 0 : sorted[sorted.length - 1],
      longTaskCount: this.longTaskCount,
      longTasksPerMin,
      worstBlockMs:  this.worstBlockMs,
      longTaskScreens: Array.from(this.longTaskByScreen.entries())
        .map(([screen, count]) => ({ screen, count }))
        .sort((a, b) => b.count - a.count || a.screen.localeCompare(b.screen)),
      longTasksWithoutScreen: this.longTasksWithoutScreen,
      worstBlockScreen: this.worstBlockScreen,
      activeMs:      this.activeMs,
      idleFrameCount:    this.idleFrameCount,
      idleJankFrames:    this.idleJankFrames,
      idleLongTaskCount: this.idleLongTaskCount,
      suspectedSuspensions: this.suspectedSuspensions,
      floorFps:          Math.round(this.floorWorstFps * 10) / 10,
      floorWindowCount:  this.floorWindowCount,
      frozenFrameCount:  this.frozenFrameCount,
      hangCount:         this.hangCount,
      worstHangMs:       Math.round(this.worstHangMs),
    };
  }
}

export const frameSampler = new FrameSampler();

/**
 * Start the rAF frame sampler as an ALWAYS-ON observation, independent of any
 * display surface. Called once from `enableTelemetry()` beside the other
 * sensor installs.
 *
 * DRAWING MUST NEVER BE WHAT KEEPS A MEASUREMENT ALIVE. Until Aug 2026 the ONLY
 * caller of `frameSampler.start()` was the in-app dashboard's mount effect, so
 * every frame-derived axis (Smoothness, Stability, Frame Floor, Frozen Frames,
 * App Hang, Idle Efficiency — plus the timer-count and Hermes checkpoints that
 * ride the same tick) was measured solely while a developer had the panel open.
 * A shipped app with the bubble hidden reported those meters as "warming up"
 * forever, which reads exactly like an honestly quiet meter.
 *
 * Idempotent and fully guest-safe: a missing `requestAnimationFrame` (non-RN
 * host / test VM) or any wiring failure leaves the sampler simply not running,
 * never a crash. Torn down only by `uninstallFrameSampling()` (forget()).
 */
export function installFrameSampling(): void {
  try {
    if (typeof requestAnimationFrame !== "function") {
      // We LOOKED for the frame source and this host has none. That is the
      // only fact that lets the frame-derived axes say so permanently — a
      // sampler that is merely stopped says nothing about the platform.
      frameSourceAbsent = true;
      return;
    }
    frameSourceAbsent = false;
    if (frameSampler.isRunning()) return;
    frameSampler.start();
  } catch {
    // never let sampler wiring take down the host
    try { frameSampler.stop(); } catch {}
  }
}

/** Stop the always-on frame sampler (erasure path — see forget()). */
export function uninstallFrameSampling(): void {
  try {
    frameSampler.stop();
  } catch {
    // best-effort — teardown must never throw into the host
  }
  // An erased kit has looked at nothing. Keeping the verdict here would let
  // the next install inherit a claim about a host it never probed.
  frameSourceAbsent = false;
}

/** @internal test hooks — let the frozen-frame / app-hang classification be
 *  driven deterministically without a real AppState (which the node test env
 *  does not provide). Mirrors memoryWarnings' `_memWarnInternals`. Never used
 *  by production code. */
export const _frameSamplerInternals = {
  FROZEN_FRAME_MS,
  APP_HANG_MS,
  SUSPENSION_CUTOFF_MS,
  /** Force AppState availability + current state on, as if a real listener had
   *  attached, so tick() can classify foreground freezes/hangs in tests. */
  setAppStateForTests(available: boolean, state = "active"): void {
    appStateAvailable = available;
    currentAppState = state;
    lastAppStateChangeAt = 0;
  },
  /** Simulate an AppState transition at time `at` (frameNow() clock). */
  fireAppStateChangeForTests(state: string, at: number): void {
    currentAppState = state;
    lastAppStateChangeAt = at;
  },
  get appStateAvailable(): boolean {
    return appStateAvailable;
  },
  get currentAppState(): string {
    return currentAppState;
  },
  /** The look that found no `requestAnimationFrame` on this host. Separate
   *  from the running flag on purpose: a test that could only set them
   *  together could not tell a stopped sampler from an absent frame source,
   *  which is the confusion this whole seam exists to prevent. */
  setSourceAbsentForTests(v: boolean): void {
    frameSourceAbsent = v;
  },
  get sourceAbsent(): boolean {
    return frameSourceAbsent;
  },
};
