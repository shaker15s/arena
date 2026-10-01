/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/* ─── Boosthis: novel detectors ────────────────────────────────────────
 *
 * These four detectors surface perf failure modes that no other tool
 * I'm aware of (Sentry, Firebase, Flashlight, Lighthouse, Embrace,
 * Xcode Instruments, React DevTools) currently surfaces as a named
 * finding. They're Boosthis's differentiation — not a re-implementation
 * of someone else's product.
 *
 * Each runs as a pure function over the raw perfMonitor event log
 * (with timestamps), emitting CrossCuttingFinding-shaped results
 * that slot into the existing diagnosis pipeline unchanged.
 *
 * ───────────────────────────────────────────────────────────────────
 *
 * 1. GHOST MOUNT  (kind: "ghost-mount")
 *    A screen mounts → unmounts within < 200ms. Pure wasted work,
 *    usually caused by:
 *      - Parent re-rendered with a new key while the child was
 *        still mounting
 *      - Navigation aborted mid-transition (back-press during slide)
 *      - StrictMode double-mount that didn't actually run twice
 *    Existing tools count screen views; none flag the wasted ones.
 *    We rely on usePerfTracker writing `event:lifetime:<screen>` on
 *    unmount with the mount→unmount duration in ms.
 *
 * 2. THUNDERING HERD API  (kind: "api-thundering-herd")
 *    ≥ 3 distinct API requests fire within a 50ms window. Classic
 *    react-query "refetch on focus" storm — every query wakes up at
 *    once, hammering the same backend, multiplying latency for the
 *    user (the slowest of N concurrent requests dominates).
 *    Sentry / Firebase show each request individually so the
 *    CLUSTER itself is invisible. Boosthis names it.
 *
 * 3. SLOW-BUT-MASKED  (added to ScreenDiagnosis.perceptionScore)
 *    Not a CrossCuttingFinding — a per-screen score adjustment.
 *    The default RN slide-from-right animation occupies ~280ms;
 *    while the animation runs, the user can't interact and
 *    visually doesn't notice work happening underneath. So a
 *    screen with TTI = 600ms feels like 320ms to the user.
 *    Lighthouse / Indeed RN-Lighthouse / Flashlight all report
 *    raw TTI; none subtract the perception window. Useful for
 *    prioritization: "yes the score is 62 but users feel 91."
 *
 * 4. STRANDED INTERVAL  (kind: "stranded-interval")
 *    A timer/interval whose key matches a screen name keeps firing
 *    even after the screen unmounted (i.e. event count after the
 *    last lifetime event for that screen > 0). Battery + CPU drain
 *    no other tool catches without explicit instrumentation. We use
 *    the existing perfMonitor event timestamps + lifetime events
 *    together — purely additive analysis.
 *
 * Plus a helper:
 *
 * 5. computePerceptionScore  — pure function applied per screen.
 */

import type { CrossCuttingFinding } from "./perfDiagnose";
import type { MountCensusRecord } from "./mountCensus";
import { MOUNT_CENSUS_THRESHOLD } from "./mountCensus";
import type { PerfEvent } from "./perfMonitor";
import { NO_SCREEN_WORDING } from "./screenAttribution";
import type { RenderCommit } from "./renderProfiler";

/** Default RN slide-from-right animation duration. Used to subtract
 *  the perception-occlusion window from raw TTI when computing the
 *  perception-adjusted score. Empirically ~280ms on iOS, ~250ms on
 *  Android — we use 280 as the conservative (pessimistic) value,
 *  meaning we LIKELY UNDER-CREDIT user perception, not over-credit. */
export const NAV_ANIMATION_MASK_MS = 280;

/* ─── Detector 1: ghost mounts ───────────────────────────────────── */

const GHOST_MOUNT_THRESHOLD_MS = 200;
const GHOST_MOUNT_MIN_OCCURRENCES = 2;

export function detectGhostMounts(events: PerfEvent[]): CrossCuttingFinding[] {
  // We watch for the special `event:lifetime:<screen>` key emitted
  // by usePerfTracker on unmount. Anything under threshold counts.
  const byScreen = new Map<string, number[]>();
  for (const e of events) {
    if (e.kind !== "event") continue;
    if (!e.name.startsWith("lifetime:")) continue;
    if (e.durationMs >= GHOST_MOUNT_THRESHOLD_MS) continue;
    const screen = e.name.slice("lifetime:".length);
    const arr = byScreen.get(screen) ?? [];
    arr.push(e.durationMs);
    byScreen.set(screen, arr);
  }
  const out: CrossCuttingFinding[] = [];
  for (const [screen, durations] of byScreen) {
    if (durations.length < GHOST_MOUNT_MIN_OCCURRENCES) continue;
    const sorted = [...durations].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.95))];
    out.push({
      kind:  "ghost-mount",
      name:  screen,
      p95,
      count: durations.length,
      hint:
        `Screen mounted ${durations.length}× and unmounted within ` +
        `${GHOST_MOUNT_THRESHOLD_MS}ms each time (median ` +
        `${sorted[Math.floor(sorted.length / 2)]}ms). Pure wasted ` +
        `work — usually a parent re-rendering with an unstable key, ` +
        `or a navigation that aborted before the screen settled. ` +
        `Stabilize the parent's key/props (memo + useCallback), or ` +
        `move the unstable derivation behind a useMemo upstream.`,
    });
  }
  return out;
}

/* ─── Detector 2: thundering herd API ────────────────────────────── */

const HERD_WINDOW_MS = 50;
const HERD_MIN_DISTINCT = 3;

export function detectThunderingHerd(events: PerfEvent[]): CrossCuttingFinding[] {
  // Cluster api events by start-time (ts - durationMs) within HERD_WINDOW_MS.
  // We use start-time, not end-time, because "all fired together" is what
  // hits the backend simultaneously — end times will fan out by latency.
  const apis = events
    .filter((e) => e.kind === "api")
    .map((e) => ({ name: e.name, start: e.ts - e.durationMs, end: e.ts }))
    .sort((a, b) => a.start - b.start);

  if (apis.length < HERD_MIN_DISTINCT) return [];

  type Cluster = { startMs: number; names: Set<string>; firstName: string };
  const clusters: Cluster[] = [];
  for (let i = 0; i < apis.length; i++) {
    const a = apis[i];
    const set = new Set<string>([a.name]);
    let firstName = a.name;
    let j = i + 1;
    while (j < apis.length && apis[j].start - a.start <= HERD_WINDOW_MS) {
      set.add(apis[j].name);
      j++;
    }
    if (set.size >= HERD_MIN_DISTINCT) {
      clusters.push({ startMs: a.start, names: set, firstName });
      // Skip ahead past this cluster so we don't emit overlapping reports.
      i = j - 1;
    }
  }

  // Aggregate clusters by their member-set fingerprint — repeated herds
  // with the same membership are the same bug, so report once with count.
  const byFingerprint = new Map<string, { count: number; names: string[] }>();
  for (const c of clusters) {
    const fp = [...c.names].sort().join("|");
    const e = byFingerprint.get(fp) ?? { count: 0, names: [...c.names].sort() };
    e.count++;
    byFingerprint.set(fp, e);
  }

  const out: CrossCuttingFinding[] = [];
  for (const [, info] of byFingerprint) {
    out.push({
      kind:  "api-thundering-herd",
      name:  info.names.slice(0, 3).join(" + ") + (info.names.length > 3 ? ` +${info.names.length - 3} more` : ""),
      p95:   HERD_WINDOW_MS,           // window width — surfaces the timescale
      count: info.count,
      hint:
        `${info.names.length} APIs fired within ${HERD_WINDOW_MS}ms — ` +
        `classic refetch-on-focus storm or "all-queries-on-mount" pattern. ` +
        `The user perceives the latency of the SLOWEST of these N requests. ` +
        `Stagger via react-query's staleTime/refetchOnWindowFocus, batch ` +
        `into a single composite endpoint, or guard with an enabled-flag ` +
        `tied to viewport visibility.`,
    });
  }
  return out;
}

/* ─── Detector 3: stranded interval ──────────────────────────────── */

// Higher than ghost-mount's threshold because the matching heuristic
// (name prefix or meta.screen) is broader and more prone to FPs;
// requiring 5+ post-unmount events avoids surfacing stray one-shots
// (e.g. an in-flight fetch resolving slightly after navigation).
const STRANDED_MIN_AFTER_UNMOUNT = 5;

export function detectStrandedIntervals(events: PerfEvent[]): CrossCuttingFinding[] {
  // For each screen with at least one lifetime event, find the LAST
  // lifetime ts (most recent unmount). Then count how many events
  // bearing the same screen prefix in their meta or name fire AFTER
  // that ts. A non-trivial count = a setInterval / pollster / WS
  // listener that wasn't torn down on unmount.
  const lastUnmount = new Map<string, number>();
  for (const e of events) {
    if (e.kind === "event" && e.name.startsWith("lifetime:")) {
      const screen = e.name.slice("lifetime:".length);
      const prev = lastUnmount.get(screen) ?? 0;
      if (e.ts > prev) lastUnmount.set(screen, e.ts);
    }
  }
  if (lastUnmount.size === 0) return [];

  // Heuristic match: an event "belongs" to a screen if its name starts
  // with `<screen>:` or its meta.screen === screen. Cheap. False
  // positives are fine — Boosthis surfaces, doesn't auto-fix.
  const stranded = new Map<string, number>();   // screen → count
  for (const e of events) {
    if (e.kind === "event" && e.name.startsWith("lifetime:")) continue;
    for (const [screen, ts] of lastUnmount) {
      if (e.ts <= ts) continue;
      const matches =
        e.name.startsWith(screen + ":") ||
        (e.meta && typeof (e.meta as Record<string, unknown>).screen === "string" &&
         (e.meta as Record<string, string>).screen === screen);
      if (matches) {
        stranded.set(screen, (stranded.get(screen) ?? 0) + 1);
      }
    }
  }
  const out: CrossCuttingFinding[] = [];
  for (const [screen, count] of stranded) {
    if (count < STRANDED_MIN_AFTER_UNMOUNT) continue;
    out.push({
      kind:  "stranded-interval",
      name:  screen,
      p95:   count,
      count,
      hint:
        `${count} event(s) tagged "${screen}" fired AFTER the screen ` +
        `unmounted. Likely a setInterval / setTimeout / WebSocket / ` +
        `subscription that wasn't cleaned up in the effect's return. ` +
        `Drains battery + CPU silently and can race-update unmounted ` +
        `state. Audit the screen's useEffect cleanups — every timer ` +
        `and subscription must be returned-and-cancelled.`,
    });
  }
  return out;
}

/* ─── Detector 4: perception-adjusted score helper ───────────────── */

/**
 * Compute the perception-adjusted score given a raw TTI in ms and a
 * scoring function (typically computeScreenScore's piecewise-linear).
 * The first NAV_ANIMATION_MASK_MS of TTI happen UNDER the slide
 * animation — the user can't see or interact, so subjectively that
 * time is "free."
 *
 * Returns the score the user actually feels.
 */
export function computePerceptionScore(
  ttiMs: number,
  rawScoreFor: (ms: number) => number,
): number {
  const visibleMs = Math.max(0, ttiMs - NAV_ANIMATION_MASK_MS);
  return rawScoreFor(visibleMs);
}

/* ─── Detector 5: render storm (DEV-DASHBOARD ONLY) ──────────────────
 * A burst of ≥ RENDER_STORM_MIN update commits for the SAME id inside
 * RENDER_STORM_WINDOW_MS with NO user interaction (press/nav) in that span.
 * An interaction-free re-render burst is almost always an autonomous loop —
 * a setState in an effect with missing/wrong deps, a new object/array/callback
 * identity created every render and fed to a memoized child, or a subscription
 * that setStates on every emit. React DevTools shows commit COUNT but never
 * names the interaction-free burst; Boosthis does.
 *
 * Commit data comes from <BoosthisProfiler>, whose onRender is a no-op in
 * release builds, so this naturally finds nothing in production.
 */
export const RENDER_STORM_WINDOW_MS = 1000;
export const RENDER_STORM_MIN = 5;

export function detectRenderStorms(
  commits: RenderCommit[],
  events: PerfEvent[],
): CrossCuttingFinding[] {
  const updates = commits
    .filter((c) => c.phase === "update" || c.phase === "nested-update")
    .sort((a, b) => a.ts - b.ts);
  if (updates.length < RENDER_STORM_MIN) return [];

  // A tap or navigation means the re-render was user-driven, not a storm.
  // We only flag bursts with NONE of these inside their time span.
  const interactions = events
    .filter((e) => e.kind === "press" || e.kind === "nav")
    .map((e) => e.ts);
  const interactionInSpan = (t0: number, t1: number) =>
    interactions.some((t) => t >= t0 && t <= t1);

  const byId = new Map<string, number[]>();
  for (const c of updates) {
    const arr = byId.get(c.id) ?? [];
    arr.push(c.ts);
    byId.set(c.id, arr);
  }

  const out: CrossCuttingFinding[] = [];
  for (const [id, tsList] of byId) {
    let storms = 0;
    let worstBurst = 0;
    let i = 0;
    while (i < tsList.length) {
      let j = i;
      while (j < tsList.length && tsList[j] - tsList[i] <= RENDER_STORM_WINDOW_MS) j++;
      const burst = j - i;
      if (burst >= RENDER_STORM_MIN && !interactionInSpan(tsList[i], tsList[j - 1])) {
        storms++;
        if (burst > worstBurst) worstBurst = burst;
        i = j;            // skip past this burst so we don't double-count
      } else {
        i++;
      }
    }
    if (storms > 0) {
      out.push({
        kind:  "render-storm",
        name:  id,
        p95:   worstBurst,       // worst burst size — surfaces severity
        count: storms,
        hint:
          `"${id}" re-rendered ${worstBurst}× within ` +
          `${RENDER_STORM_WINDOW_MS}ms with no tap or navigation in between — ` +
          `an autonomous render loop, not user-driven work. Usual causes: a ` +
          `setState inside an effect with missing/incorrect deps, a new ` +
          `object/array/callback identity created every render and passed to a ` +
          `memoized child, or a subscription that setStates on every emit. ` +
          `Memoize the unstable prop (useMemo/useCallback), fix the effect ` +
          `deps, or throttle the subscription.`,
      });
    }
  }
  return out;
}

/* ─── Detector 6: rage taps (kind: "rage-tap") ──────────────────────
 * The user jabbed the SAME spot 3+ times within ~700ms while the screen took
 * ≥300ms to respond to each jab — the classic "is this thing frozen?" mash.
 * useFidSampler confirms each burst ON-DEVICE (comparing touch coordinates
 * EPHEMERALLY — coordinates are never stored, logged, or uploaded) and records
 * a coordinate-free `rage:burst` event carrying only the measured input delay.
 * This detector counts those confirmed bursts and reports the worst delay.
 *
 * Sentry / LogRocket have "rage click" for the web, but no RN perf tool names
 * it against the on-device input-delay signal. It is the human PROOF that a
 * slow interaction actually hurt: the user told us, with their thumb, that the
 * tap produced no response fast enough — so they tried again.
 */
export function detectRageTaps(events: PerfEvent[]): CrossCuttingFinding[] {
  const bursts = events.filter((e) => e.kind === "event" && e.name === "rage:burst");
  if (bursts.length === 0) return [];
  const worstDelay = bursts.reduce((m, e) => Math.max(m, e.durationMs), 0);
  // Each burst carries the screen that was current when the user jabbed at it
  // (attached by the interaction sampler, at that moment). The finding names
  // that screen when every burst agrees on one; bursts spread across screens,
  // or taken while no screen was current, are worded rather than pinned to a
  // screen that only some of them happened on.
  const screens = new Set<string>();
  let burstsWithoutScreen = 0;
  for (const e of bursts) {
    const s = e.meta?.screen;
    if (typeof s === "string" && s.length > 0) screens.add(s);
    else burstsWithoutScreen++;
  }
  const onlyScreen =
    screens.size === 1 && burstsWithoutScreen === 0
      ? Array.from(screens)[0]
      : null;
  const where =
    onlyScreen != null
      ? `on ${onlyScreen}`
      : screens.size > 1
        ? `across ${screens.size} screens (${Array.from(screens).sort().join(", ")})`
        : NO_SCREEN_WORDING;
  return [
    {
      kind:  "rage-tap",
      // The screen it happened on when that is the whole story; otherwise the
      // generic name stands and the hint says where, rather than one screen
      // being named for taps that happened on several or on none.
      name:  onlyScreen ?? "user frustration",
      p95:   worstDelay,        // worst input delay (ms) observed during a burst
      count: bursts.length,     // number of confirmed rage-tap bursts this session
      hint:
        `The user jabbed the same spot 3+ times within ~700ms while the screen ` +
        `took ≥300ms to respond — the "is this frozen?" mash, and the human ` +
        `signal that a slow tap actually hurt (worst delay ${worstDelay}ms across ` +
        `${bursts.length} burst(s), ${where}). Find what blocks the JS thread on that tap: ` +
        `heavy synchronous onPress work, an un-memoized list re-render, a ` +
        `synchronous layout or storage read, or an awaited call before any ` +
        `visible feedback. Give an instant optimistic response (spinner / ` +
        `disabled state) on press, then move the heavy work off the tap path ` +
        `with InteractionManager.runAfterInteractions or a deferred task. No ` +
        `coordinates are captured — only the fact that a burst happened.`,
    },
  ];
}

/* ─── Detector 7: eager list mounts (kind: "eager-list-mount") ──────
 * A scroll container was handed more children than a screen's own furniture
 * could account for, and mounted all of them in one commit.
 *
 * This is the release-safe half of the render story. React's <Profiler> is a
 * no-op in production, so detectRenderStorms above finds nothing there; this
 * detector reads the mount census, which is taken off the element tree as it
 * is BUILT and therefore survives a production bundle. It is the one signal
 * that would have caught a screen mounting 500 media tiles at once while
 * every uploaded axis read 100.
 *
 * It names the SCREEN, not a count — a developer receives "this screen
 * mounted 500 children at once", not "13 long tasks occurred".
 *
 * A virtualised list never reaches the census at all (it is handed `data`,
 * not children), so a screen that has been fixed stands down by construction.
 */

/** The consequence that must travel with every rendering of this advice.
 *
 *  Our advice lands in a customer's own repository and gets committed there,
 *  so a recommendation that creates a correctness bug is not acceptable.
 *  Virtualising changes row lifecycle: rows are recycled, and per-row state
 *  kept inside a row reverts when the row scrolls away and comes back. This
 *  sentence is held to every other rendering of the same advice by
 *  scripts/src/__tests__/virtualisationAdviceConsequence.test.ts. */
export const VIRTUALISATION_RECYCLE_CONSEQUENCE =
  `Before you switch: virtualising RECYCLES rows, so any per-row state kept ` +
  `inside the row — a liked flag, an expanded/collapsed toggle, a ` +
  `once-per-session analytics ping fired from the row's mount effect — will ` +
  `revert or refire when the row scrolls out and back. Lift that state out ` +
  `of the row into the list's own data or a store keyed by item id before ` +
  `you virtualise, or you will trade a slow screen for a wrong one.`;

export function detectEagerListMounts(
  census: MountCensusRecord[],
): CrossCuttingFinding[] {
  const out: CrossCuttingFinding[] = [];
  for (const rec of census) {
    // The census only holds containers already at or above its threshold, but
    // the detector states the bar itself rather than inheriting it silently.
    if (rec.maxChildren < MOUNT_CENSUS_THRESHOLD) continue;
    // Three states, never two: a named screen, a screen the kit had not yet
    // identified, and no record at all. An unidentified screen says so — it
    // does not borrow a name it does not have.
    const where =
      rec.screen ??
      "a screen Boosthis had not identified yet (no navigation observed at mount time)";
    out.push({
      kind: "eager-list-mount",
      name: where,
      p95: rec.maxChildren,
      count: rec.overCount,
      hint:
        `A <${rec.container}> on "${where}" mounted ${rec.maxChildren} children ` +
        `in ONE commit and keeps every one of them mounted for as long as the ` +
        `screen lives. That is the whole collection, not a window: first ` +
        `render, native view count and memory all scale with the number of ` +
        `items the API returned, so the screen gets slower as the data grows ` +
        `and no amount of making each row cheaper fixes it. The bar is ` +
        `${MOUNT_CENSUS_THRESHOLD} children — the largest hand-written ` +
        `scroll container we have measured holds 17. Replace it with a ` +
        `virtualised list (FlatList / SectionList, or FlashList for heavy ` +
        `rows), which mounts only what is visible plus a buffer. ` +
        VIRTUALISATION_RECYCLE_CONSEQUENCE +
        ` Only the number of children was read — no row content, no prop ` +
        `value, nothing about anyone using the app.`,
    });
  }
  return out;
}

/* ─── Aggregator ─────────────────────────────────────────────────── */

/**
 * Run all novel cross-cutting detectors over an event log and return the
 * combined findings. Pure — caller decides what to do with them. The optional
 * `renderCommits` feed the dev-only render-storm detector; in release builds no
 * commits are recorded, so it contributes nothing. The optional `census` feeds
 * the release-safe eager-list-mount detector, which is what still fires there.
 */
export function runNovelDetectors(
  events: PerfEvent[],
  renderCommits: RenderCommit[] = [],
  census: MountCensusRecord[] = [],
): CrossCuttingFinding[] {
  return [
    ...detectGhostMounts(events),
    ...detectThunderingHerd(events),
    ...detectStrandedIntervals(events),
    ...detectRageTaps(events),
    ...detectRenderStorms(renderCommits, events),
    ...detectEagerListMounts(census),
  ];
}
