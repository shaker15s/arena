/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/**
 * BoosthisEnginePanel — the rich, drop-in performance monitor surface.
 *
 * This is the SAME panel the Boosthis mobile app shows (boot ladder, novel
 * detectors, score-over-time sparkline, on-device snapshots, and a
 * "share as markdown" action), packaged as a single self-contained
 * component so any host app — and the Boosthis app itself — renders ONE source
 * of truth. No drift between the app and the plug-in.
 *
 * Design constraints (so it drops into ANY Expo / React Native app):
 *  - Pure react-native primitives only (View / Text / Pressable / ScrollView).
 *    No icon packs, no custom fonts, no navigation, no theme provider required.
 *  - Tap-through to a rule's fix is OPTIONAL: pass `onRulePress` to wire your
 *    own navigation. Without it, findings render but aren't tappable.
 *  - Fully themeable via the optional `theme` prop; sensible dark defaults.
 *  - Reads only from this runtime's in-memory engine. Nothing leaves the device.
 *
 * Usage (host app):
 *   import { BoosthisEnginePanel } from "@workspace/boosthis-runtime-rn";
 *   <BoosthisEnginePanel />
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";

import { perfMonitor, frameSampler, buildRouteSeries, type FrameStats } from "../perfMonitor";
import {
  getInteractionStats,
  getFrustrationStats,
  type InteractionStats,
  type FrustrationStats,
} from "../hooks/useFidSampler";
import {
  computeMeterAxes,
  computeRenderEfficiency,
  RESILIENCE_MIN_MEDIAN_MS,
  RESILIENCE_MIN_TAIL_SAMPLES,
  RESILIENCE_TAIL_FLOOR_MS,
  type AxisRating,
  type NetworkStatsLike,
} from "../meterAxes";
import { getBootScore, type BootScoreBreakdown } from "../perfBoot";
// A leaf module (it imports only axisScoring), so naming the clock here adds
// no cycle — and the panel must be able to tell "no duration exists" from
// "not measured yet".
import { STARTUP_CLOCK } from "../jsStartup";
// A window is stated through the contract, never interpolated raw: a
// 40-second look must not print as "1m". docs/earned-rate-contract.
import { MIN_RATE_WINDOW_MIN, minuteText } from "../rateHonesty";
import { getMountCensus } from "../mountCensus";
import { runNovelDetectors } from "../perfNovelDetectors";
import { renderProfiler, type RenderStats } from "../renderProfiler";
import {
  buildCircuitMap,
  CIRCUIT_RULE_MAP,
  type CircuitMapReport,
  type CircuitFinding,
} from "../circuitMap";
import {
  layoutCircuitMap,
  type CircuitMapLayout,
  type MapNode,
} from "../circuitMapLayout";
// The panel says WHY a reading is missing in the dashboard's own words, and
// it tells the two silences apart by the same closed code the wire carries —
// never by re-deriving the state from a flag it can see locally.
import {
  REASON_NAVIGATION_NOT_RECOGNISED,
  REASON_OFF_IN_THIS_BUILD,
} from "../axisReasons";
import { getScreenMapStats } from "../pageMap";
import {
  controlCensusReport,
  controlCensusStatusLine,
} from "../controlCensus";
import { screenMapTravelLine } from "../pageMapWire";
import { isPageMapSendEnabled } from "../telemetry";
import { getNavObserverStatus } from "../navObserver";
import { describeScreenReadingCounts } from "../screenAutoReading";
import { scrollSampler, type ScrollStats } from "../scrollSampler";
import { networkCoverageFields } from "../networkAutoWrap";
import { networkSampler, type NetworkStats } from "../networkSampler";
import { safeRun, safeAsync } from "../safe";
import {
  computeOverallScore,
  computeScreenScore,
  type CrossCuttingFinding,
  type DiagnosisReport,
  type PerfRow,
  type ScreenDiagnosis,
  type ScreenPattern,
} from "../perfDiagnose";
import {
  listSnapshots,
  loadSnapshot,
  saveSnapshot,
  deleteSnapshot,
  diffSnapshots,
  findChronicPatterns,
  type SnapshotMeta,
  type SnapshotDiff,
  type ChronicPattern,
  type PerfSnapshot,
} from "../perfSnapshots";
import { ingestFindings } from "../candidateRules";
import { getDroppedRowCount, droppedRowsSummary } from "../killSwitch";
import { RUNTIME_VERSION } from "../thresholds";
import {
  DARK_THEME,
  ratingColor,
  durationColor,
  type BoosthisDashboardTheme,
} from "./theme";
import { BoosthisErrorBoundary } from "./BoosthisErrorBoundary";

const REFRESH_INTERVAL_MS = 2000;

/** A checklist rule a detector finding maps to, surfaced for tap-through. */
export interface DetectorRuleLink {
  ruleId: string;
  language: string;
}

/**
 * Maps a runtime detector finding kind → the checklist rule that explains how
 * to fix it. Kit-owned (these rule ids ship in the bundled checklist), so the
 * app and the plug-in agree on the mapping. The HOST decides how to navigate
 * via `onRulePress`.
 */
const DETECTOR_RULE_MAP: Record<string, DetectorRuleLink> = {
  "ghost-mount": { ruleId: "useeffect-cleanup-required", language: "react-native" },
  "api-thundering-herd": { ruleId: "unbounded-search-results", language: "react-native" },
  "stranded-interval": { ruleId: "background-render-leak", language: "react-native" },
  "remount-storm-global": { ruleId: "useeffect-cleanup-required", language: "react-native" },
  "render-monolith": { ruleId: "heavyready-tier-stagger", language: "react-native" },
  "render-storm": { ruleId: "heavyready-tier-stagger", language: "react-native" },
  // Rage taps mean the user mashed a control because the tap handler didn't
  // respond in time — the fix is keeping interaction dispatch under budget.
  "rage-tap": { ruleId: "dispatch-action-budget-10ms", language: "react-native" },
};

function getRuleForFinding(kind: string): DetectorRuleLink | undefined {
  return DETECTOR_RULE_MAP[kind];
}

function fmtMs(v: number | null): string {
  return v === null ? "—" : `${Math.round(v)}ms`;
}

/**
 * ── A rate that is short of its window, and how far short ────────────────
 *
 * Seven readings here are per-hour rates, and a per-hour projection may not be
 * published until five minutes have been watched (rateHonesty.ts). On a phone
 * that window is earned across SEVERAL runs of the app, because a session is
 * four minutes long — the kit banks what each run watched and the next launch
 * adds it in (docs/decisions/rate-window-earned-across-sessions.md).
 *
 * A bare "warming up" over that is the stall this replaces: it reads the same
 * on the first launch and on the fiftieth, and a developer cannot tell a meter
 * that is filling from one that will never report. So the pending sentence
 * says how much of the window has been earned, and — when the reading spans a
 * restart — that it was earned across more than one run.
 *
 * Never prints a zero window: "0m of 5m" is a measurement of nothing beside a
 * sentence saying nothing was measured, and the words win. An unwatched meter
 * keeps the plain wording.
 */
function warmingWindowSub(
  windowMin: number | null | undefined,
  runsInWindow?: number,
  seen = "",
): string {
  const lead = seen ? `${seen} · ` : "";
  if (typeof windowMin !== "number" || !Number.isFinite(windowMin) || windowMin <= 0) {
    return `${lead}warming up`;
  }
  const runs =
    typeof runsInWindow === "number" && runsInWindow > 1
      ? ` across ${runsInWindow} runs`
      : "";
  return `${lead}${minuteText(windowMin)} of ${minuteText(
    MIN_RATE_WINDOW_MIN,
  )} watched${runs}`;
}

/** Human-readable label for a screen's diagnosed pattern. */
const PATTERN_LABELS: Record<ScreenPattern, string> = {
  "snappy": "snappy",
  "single-sync-block": "sync block",
  "deferred-work-hump": "deferred work",
  "interaction-wait": "interaction wait",
  "heavy-commit": "heavy commit",
  "heavy-contexts": "heavy contexts",
  "heavy-memos": "heavy memos",
  "unknown": "unknown",
};
function patternLabel(p: ScreenPattern): string {
  return PATTERN_LABELS[p] ?? p;
}

/** Build a markdown report from the live engine state (for Share).
 * Exported for tests only — hosts use the panel's Share action. */
export function buildMarkdownReport(input: {
  boot: BootScoreBreakdown;
  detectors: CrossCuttingFinding[];
  snapshots: SnapshotMeta[];
  runtimeVersion: string;
  diagnosis?: DiagnosisReport | null;
  rows?: PerfRow[];
  frame?: FrameStats | null;
  totalEvents?: number;
}): string {
  const lines: string[] = [];
  lines.push(`# Boosthis report`);
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Runtime:   ${input.runtimeVersion}`);
  lines.push("");

  lines.push(`## Boot ladder — ${input.boot.score}/100 (${input.boot.rating})`);
  lines.push("");
  lines.push(`| Phase | Time |`);
  lines.push(`|---|---|`);
  lines.push(`| bundleLoaded | ${fmtMs(input.boot.bundleLoadedMs)} |`);
  lines.push(`| rootRendered | ${fmtMs(input.boot.rootRenderedMs)} |`);
  lines.push(`| firstScreen  | ${fmtMs(input.boot.firstScreenMs)} |`);
  lines.push(`| interactive  | ${fmtMs(input.boot.interactiveMs)} |`);
  lines.push("");
  if (input.boot.idleSuspected) {
    lines.push(
      `> Idle time detected — a boot phase exceeded the plausibility ceiling ` +
        `(likely the app sat backgrounded or on a pre-Boosthis splash/login ` +
        `screen). That wait is excluded from the boot score so it isn't counted ` +
        `as load time.`,
    );
    lines.push("");
  }

  lines.push(`## Novel detectors (${input.detectors.length})`);
  lines.push("");
  if (input.detectors.length === 0) {
    lines.push(`_No anomalies detected._`);
  } else {
    for (const d of input.detectors) {
      lines.push(`- **${d.kind}** — ${d.name}`);
      lines.push(`  - p95: ${Math.round(d.p95)}ms · count: ${d.count}`);
      if (d.hint) lines.push(`  - hint: ${d.hint}`);
    }
  }
  lines.push("");

  if (input.diagnosis && input.diagnosis.screens.length > 0) {
    lines.push(`## Diagnosis (${input.diagnosis.screens.length} screen(s))`);
    lines.push("");
    for (const s of input.diagnosis.screens) {
      const b = computeScreenScore(s);
      lines.push(
        `### ${s.screen} — ${b.rating === "insufficient-data" ? "—" : `${b.score}/100`} · ${patternLabel(s.pattern)} · ${Math.round(s.totalMs)}ms`,
      );
      for (const p of s.ladder) {
        lines.push(`- ${p.phase}: ${Math.round(p.ms)}ms (p95 ${Math.round(p.p95)}ms)`);
      }
      if (s.worstGap) {
        lines.push(
          `- worst gap: ${s.worstGap.from} → ${s.worstGap.to} (${Math.round(s.worstGap.ms)}ms)`,
        );
      }
      lines.push("");
    }
  }

  if (input.rows && input.rows.length > 0) {
    lines.push(`## Aggregates (${input.rows.length} rows)`);
    lines.push("");
    lines.push(`| Key | p50 | p95 | max | last | n |`);
    lines.push(`|---|---|---|---|---|---|`);
    for (const r of input.rows) {
      lines.push(
        `| ${r.key} | ${Math.round(r.p50)} | ${Math.round(r.p95)} | ${Math.round(r.max)} | ${Math.round(r.last)} | ${r.count} |`,
      );
    }
    lines.push("");
  }

  if (input.frame) {
    lines.push(`## Frame sampler`);
    lines.push("");
    lines.push(
      `p50 ${Math.round(input.frame.p50Ms)}ms · p95 ${Math.round(input.frame.p95Ms)}ms · p99 ${Math.round(input.frame.p99Ms)}ms · worst ${Math.round(input.frame.worstMs)}ms · jank ${(input.frame.jankFraction * 100).toFixed(1)}%`,
    );
    lines.push("");
  }

  lines.push(`## Snapshots (${input.snapshots.length})`);
  lines.push("");
  if (input.snapshots.length === 0) {
    lines.push(`_No baseline saved yet._`);
  } else {
    for (const s of input.snapshots) {
      lines.push(
        `- ${new Date(s.savedAt).toISOString()} — **${s.label}** · ${s.totalEvents} events · ${s.slowScreens} slow`,
      );
    }
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    `_Generated by Boosthis v${input.runtimeVersion}. No PII leaves the device — every value here is timing or rule metadata._`,
  );

  return lines.join("\n");
}

// Below this many frames the rolling window is a spot check, not a trend —
// mirrors CONFIDENCE_CUTOFFS.high in meterAxes.ts. Used only for an honesty note.
const THIN_SAMPLE_FRAMES = 20;

const EMPTY_FRAME: FrameStats = {
  isRunning: false,
  sampleCount: 0,
  p50Ms: 0,
  p95Ms: 0,
  p99Ms: 0,
  jankFraction: 0,
  worstMs: 0,
  longTaskCount: 0,
  longTasksPerMin: 0,
  worstBlockMs: 0,
  longTaskScreens: [],
  longTasksWithoutScreen: 0,
  worstBlockScreen: null,
  activeMs: 0,
  idleFrameCount: 0,
  idleJankFrames: 0,
  idleLongTaskCount: 0,
  suspectedSuspensions: 0,
  floorFps: 0,
  floorWindowCount: 0,
  frozenFrameCount: 0,
  hangCount: 0,
  worstHangMs: 0,
};

const EMPTY_INTERACTION: InteractionStats = {
  count: 0,
  p75Ms: 0,
  p95Ms: 0,
  worstMs: 0,
};

const EMPTY_RENDER: RenderStats = {
  sampleCount: 0,
  updateCount: 0,
  mountCount: 0,
  wastedCount: 0,
  updatesPerMin: 0,
  p95ActualMs: 0,
  worstId: null,
  windowMs: 60000,
  // An empty placeholder has looked at nothing, so it claims nothing about
  // the build. Only a profiled subtree that rendered with no commit reported
  // earns the permanent word.
  offInThisBuild: false,
};

const EMPTY_SCROLL: ScrollStats = {
  isScrolling: false,
  frameCount: 0,
  jankyCount: 0,
  jankFraction: 0,
  blankEvents: 0,
  worstBlankPx: 0,
};

const EMPTY_FRUSTRATION: FrustrationStats = {
  burstCount: 0,
  worstDelayMs: 0,
};

const EMPTY_NETWORK: NetworkStats = {
  attemptCount: 0,
  completedCount: 0,
  failedCount: 0,
  timeoutCount: 0,
  stallCount: 0,
  p75Ms: 0,
  worstMs: 0,
};

interface EngineState {
  boot: BootScoreBreakdown;
  detectors: CrossCuttingFinding[];
  snapshots: SnapshotMeta[];
  allSnapshots: SnapshotMeta[];
  rows: PerfRow[];
  diagnosis: DiagnosisReport | null;
  startedAt: number;
  totalEvents: number;
  frame: FrameStats;
  /** Rolling INP-style interaction-delay window (ongoing responsiveness). */
  interaction: InteractionStats;
  /** Dev-only React commit activity (empty in release builds; never uploaded). */
  render: RenderStats;
  /** Field-capable scroll/list health (frame jank while actively scrolling). */
  scroll: ScrollStats;
  /** Coordinate-free rage-tap counters (Frustration axis source). */
  frustration: FrustrationStats;
  /** Field-capable network attempt counters (Network axis source). */
  /** Attempt counts plus what the kit can and cannot watch — widened past
   *  the sampler's own shape so the panel can tell "nothing measured" apart
   *  from "automatic reporting is not switched on". */
  network: NetworkStatsLike;
  /** Label-free per-screen mount-duration series (Baseline axis source). */
  routeSeries: { durations: number[] }[];
  recording: boolean;
  /** Cumulative rows the server refused across this process's uploads, and the
   *  "<n> — <cause>[; <cause>]" figure. 0 / "" when nothing was dropped (an
   *  older server too), so a healthy app shows no row at all. */
  droppedRows: number;
  droppedSummary: string;
  /** Change vs the previous saved snapshot (latest two compared). */
  diff: SnapshotDiff | null;
  /** Screens stuck on the same non-snappy pattern across recent snapshots. */
  chronic: ChronicPattern[];
  /** ON-DEVICE navigation / interaction integrity map (never uploaded). */
  circuitMap: CircuitMapReport;
  /** Whether the render profiler has recorded anything, so the panel can tell
   *  "no dead-end taps" from "dead-end taps could not be judged". */
  circuitTapsObservable: boolean;
}

function PhaseRow({
  label,
  ms,
  t,
  last,
}: {
  label: string;
  ms: number | null;
  t: BoosthisDashboardTheme;
  last?: boolean;
}) {
  // One universal color scale everywhere (matches the legend) so the user can
  // read every meter by color alone without learning a per-phase budget.
  const c = durationColor(ms, t);
  return (
    <View
      style={[
        styles.phaseRow,
        { borderBottomColor: t.border, borderBottomWidth: last ? 0 : 1 },
      ]}
    >
      <View style={styles.phaseLeft}>
        <View style={[styles.phaseDot, { backgroundColor: c }]} />
        <Text style={[styles.phaseLabel, { color: t.foreground }]}>{label}</Text>
      </View>
      <Text style={[styles.phaseValue, { color: c }]}>
        {ms === null ? "—" : `${Math.round(ms)}ms`}
      </Text>
    </View>
  );
}

function FindingRow({
  finding,
  t,
  last,
  onRulePress,
}: {
  finding: CrossCuttingFinding;
  t: BoosthisDashboardTheme;
  last?: boolean;
  onRulePress?: (link: DetectorRuleLink) => void;
}) {
  const link = getRuleForFinding(finding.kind);
  const tappable = !!link && !!onRulePress;
  const onPress = useCallback(() => {
    if (link && onRulePress) onRulePress(link);
  }, [link, onRulePress]);

  return (
    <Pressable
      onPress={onPress}
      disabled={!tappable}
      style={({ pressed }) => [
        styles.findingRow,
        {
          borderBottomColor: t.border,
          borderBottomWidth: last ? 0 : 1,
          opacity: pressed && tappable ? 0.6 : 1,
        },
      ]}
    >
      <View style={styles.findingHeader}>
        <View
          style={[
            styles.findingKindChip,
            { backgroundColor: t.poor + "1a", borderColor: t.poor + "55" },
          ]}
        >
          <Text style={[styles.findingKindLabel, { color: t.poor }]}>
            {finding.kind}
          </Text>
        </View>
        <Text
          style={[styles.findingKind, { color: t.foreground }]}
          numberOfLines={1}
        >
          {finding.name}
        </Text>
        <Text style={[styles.findingMeta, { color: t.mutedForeground }]}>
          p95 {Math.round(finding.p95)}ms · ×{finding.count}
        </Text>
        {tappable ? (
          <Text style={[styles.chevron, { color: t.mutedForeground }]}>›</Text>
        ) : null}
      </View>
      <Text
        style={[styles.findingMessage, { color: t.mutedForeground }]}
        numberOfLines={3}
      >
        {finding.hint}
      </Text>
      {tappable ? (
        <Text style={[styles.findingFix, { color: t.primary }]}>
          Tap to open fix → {link!.ruleId}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Colour for a circuit finding by kind: dead ends and nav loops are defects
 *  (red), orphan screens and fan-out bursts are worth-a-look (amber),
 *  unreachable registered routes are pending notes (neutral). */
function circuitKindColor(kind: CircuitFinding["kind"], t: BoosthisDashboardTheme): string {
  if (kind === "dead-end-tap" || kind === "nav-loop") return t.poor;
  if (kind === "orphan-screen" || kind === "fanout-burst") return t.needsWork;
  return t.mutedForeground; // unreachable-screen (pending, not a defect)
}

function CircuitFindingRow({
  finding,
  t,
  last,
  onRulePress,
}: {
  finding: CircuitFinding;
  t: BoosthisDashboardTheme;
  last?: boolean;
  onRulePress?: (link: DetectorRuleLink) => void;
}) {
  const map = CIRCUIT_RULE_MAP[finding.kind];
  const link: DetectorRuleLink | undefined = map
    ? { ruleId: map.ruleId, language: map.language }
    : undefined;
  const tappable = !!link && !!onRulePress;
  const onPress = useCallback(() => {
    if (link && onRulePress) onRulePress(link);
  }, [link, onRulePress]);
  const color = circuitKindColor(finding.kind, t);

  return (
    <Pressable
      onPress={onPress}
      disabled={!tappable}
      style={({ pressed }) => [
        styles.findingRow,
        {
          borderBottomColor: t.border,
          borderBottomWidth: last ? 0 : 1,
          opacity: pressed && tappable ? 0.6 : 1,
        },
      ]}
    >
      <View style={styles.findingHeader}>
        <View
          style={[
            styles.findingKindChip,
            { backgroundColor: color + "1a", borderColor: color + "55" },
          ]}
        >
          <Text style={[styles.findingKindLabel, { color }]}>{finding.kind}</Text>
        </View>
        <Text style={[styles.findingKind, { color: t.foreground }]} numberOfLines={1}>
          {finding.name}
        </Text>
        {finding.count > 0 ? (
          <Text style={[styles.findingMeta, { color: t.mutedForeground }]}>
            ×{finding.count}
          </Text>
        ) : null}
        {tappable ? <Text style={[styles.chevron, { color: t.mutedForeground }]}>›</Text> : null}
      </View>
      <Text style={[styles.findingMessage, { color: t.mutedForeground }]} numberOfLines={4}>
        {finding.hint}
      </Text>
      {tappable ? (
        <Text style={[styles.findingFix, { color: t.primary }]}>
          Tap to open fix → {link!.ruleId}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * How a node box looks, per its four-way state. The colours are the SAME ones
 * the finding chips below the picture use (red = defect, amber = worth a
 * look, muted = an informational note), and each state also carries its own
 * WORD — so the four are told apart without relying on colour alone.
 */
function circuitNodeLook(
  node: MapNode,
  t: BoosthisDashboardTheme,
): {
  border: string;
  borderWidth: number;
  borderStyle: "solid" | "dashed";
  label: string;
  meta: string | null;
  metaColor: string;
} {
  if (node.state === "declared-unreached") {
    return {
      border: t.mutedForeground,
      borderWidth: 1,
      borderStyle: "dashed",
      label: t.mutedForeground,
      meta: "declared · not reached",
      metaColor: t.mutedForeground,
    };
  }
  if (node.state === "flagged") {
    const parts: string[] = [];
    if (node.controls.length === 1) {
      parts.push(`dead end: ${node.controls[0].control} ×${node.controls[0].count}`);
    } else if (node.controls.length > 1) {
      parts.push(`${node.controls.length} dead-end controls`);
    }
    if (node.findingKinds.includes("nav-loop")) parts.push("loop");
    if (node.findingKinds.includes("fanout-burst")) parts.push("burst");
    return {
      border: t.poor,
      borderWidth: 2,
      borderStyle: "solid",
      label: t.foreground,
      meta: parts.join(" · ") || "finding",
      metaColor: t.poor,
    };
  }
  if (node.state === "no-inbound") {
    return {
      border: t.needsWork,
      borderWidth: 2,
      borderStyle: "solid",
      label: t.foreground,
      meta: "no way in recorded",
      metaColor: t.needsWork,
    };
  }
  return {
    border: t.border,
    borderWidth: 1,
    borderStyle: "solid",
    label: t.foreground,
    meta: node.selfNav > 0 ? `self-nav ×${node.selfNav}` : null,
    metaColor: t.mutedForeground,
  };
}

/** One legend swatch: the box look, then what it means. */
function CircuitLegendChip({
  color,
  dashed,
  heavy,
  label,
  t,
}: {
  color: string;
  dashed?: boolean;
  heavy?: boolean;
  label: string;
  t: BoosthisDashboardTheme;
}) {
  return (
    <View style={styles.circuitLegendItem}>
      <View
        style={[
          styles.circuitLegendSwatch,
          {
            borderColor: color,
            borderWidth: heavy ? 2 : 1,
            borderStyle: dashed ? "dashed" : "solid",
            backgroundColor: t.secondary,
          },
        ]}
      />
      <Text style={[styles.circuitLegendLabel, { color: t.mutedForeground }]}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The drawing itself: a box per screen, an arrow per observed navigation,
 * laid out by `layoutCircuitMap`. Plain Views only — the lines are rotated
 * 1px-tall rectangles and the arrowheads are the zero-size border triangle.
 * Edges render first so the lines pass UNDER the boxes.
 */
function CircuitMapDrawing({
  layout,
  t,
}: {
  layout: CircuitMapLayout;
  t: BoosthisDashboardTheme;
}) {
  return (
    // A MAP CANNOT WRAP, SO IT MUST SAY IT CONTINUES. Unlike the axis strip
    // below, this drawing is one laid-out canvas: the only way to reach a box
    // off the right-hand edge is to scroll. The indicator therefore stays
    // VISIBLE — hidden, a reader who never happens to swipe is left believing
    // the app has only the screens they can see. `persistentScrollbar` keeps
    // it on screen on Android rather than fading after the first touch.
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={true}
      persistentScrollbar={true}
      style={styles.circuitCanvasScroll}
      contentContainerStyle={styles.circuitCanvasContent}
    >
      <View style={[styles.circuitCanvas, { width: layout.width, height: layout.height }]}>
        {layout.edges.map((e) => (
          <React.Fragment key={`edge-${e.from}->${e.to}`}>
            <View
              accessibilityLabel={`${e.from} to ${e.to}, travelled ${e.count}×`}
              style={[
                styles.circuitEdgeLine,
                {
                  left: e.midX - e.length / 2,
                  top: e.midY - e.thickness / 2,
                  width: e.length,
                  height: e.thickness,
                  backgroundColor: t.primary,
                  // Heavier edges also read stronger, not just thicker.
                  opacity: 0.4 + 0.15 * (e.thickness - 1),
                  transform: [{ rotate: `${e.angleDeg}deg` }],
                },
              ]}
            />
            <View
              style={[
                styles.circuitEdgeHead,
                {
                  left: e.headX - 3.5,
                  top: e.headY - 4,
                  borderLeftColor: t.primary,
                  transform: [{ rotate: `${e.angleDeg}deg` }],
                },
              ]}
            />
          </React.Fragment>
        ))}
        {layout.nodes.map((n) => {
          const look = circuitNodeLook(n, t);
          return (
            <View
              key={`node-${n.name}`}
              accessibilityLabel={`${n.name}, ${n.state}`}
              style={[
                styles.circuitNode,
                {
                  left: n.x,
                  top: n.y,
                  width: n.w,
                  height: n.h,
                  backgroundColor: t.secondary,
                  borderColor: look.border,
                  borderWidth: look.borderWidth,
                  borderStyle: look.borderStyle,
                },
              ]}
            >
              <Text
                style={[styles.circuitNodeLabel, { color: look.label }]}
                numberOfLines={1}
              >
                {n.name}
              </Text>
              {look.meta ? (
                <Text
                  style={[styles.circuitNodeMeta, { color: look.metaColor }]}
                  numberOfLines={1}
                >
                  {look.meta}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

/** One sentence about how the accumulated screen map is being kept. Returns
 *  null when there is nothing to say (nothing observed yet). Every honest
 *  state gets its own words: an unsaved map, a map that cannot be kept and a
 *  store that will not say must never read alike. */
function describeScreenMap(): string | null {
  try {
    const s = getScreenMapStats();
    if (s.screenCount === 0) return null;
    const parts = [
      `${s.screenCount} ${s.screenCount === 1 ? "screen" : "screens"} in the accumulated map`,
    ];
    if (s.truncated) parts.push("showing a subset (caps reached)");
    switch (s.persistence) {
      case "stored":
        parts.push("kept on this device");
        break;
      case "memory-only":
        parts.push("this launch only — no device store installed");
        break;
      case "unavailable":
        parts.push("could not be saved");
        break;
      case "unknown":
        parts.push("the app's own store does not say whether it keeps it");
        break;
      case "not-saved-yet":
        parts.push("not written yet");
        break;
    }
    return parts.join(" · ");
  } catch {
    return null;
  }
}

/** One sentence about whether the root integration is drawing the map. */
function describeNavObserver(): string | null {
  try {
    const s = getNavObserverStatus();
    switch (s.router) {
      case "react-navigation":
        return "Drawing itself from the app's navigation container — no per-screen work needed.";
      case "path-source":
        return "Drawing itself from the route path the app root reports — no per-screen work needed.";
      case "unfamiliar":
        return "The root observer is mounted but did not recognise this router, so the map still only shows what useBoosthis / beginNav recorded.";
      case "not-mounted":
        return "Only instrumented screens are on the map. Mount <BoosthisNavigationObserver> once at the app root and every screen change records itself.";
    }
  } catch {
    return null;
  }
}

/**
 * ON-DEVICE navigation / interaction integrity map. DRAWS the observed
 * navigation graph — a box per screen, an arrow per navigation, heavier where
 * it was travelled more often — over the findings the detectors emit: dead-end
 * taps, nav loops, request bursts, orphan screens and unreachable registered
 * routes. Everything here is derived locally and is NEVER uploaded (separate
 * types from the transmitted finding union).
 */
export function CircuitMapCard({
  report,
  t,
  onRulePress,
  tapsObservable = true,
}: {
  report: CircuitMapReport;
  t: BoosthisDashboardTheme;
  onRulePress?: (link: DetectorRuleLink) => void;
  /** False when the render profiler recorded nothing, so a tap that did
   *  nothing CANNOT be told from a tap that worked. Keeps "none found" from
   *  being claimed where nothing could have been found. */
  tapsObservable?: boolean;
}) {
  const { findings } = report;
  // Re-laid out on the panel's normal refresh: pure, bounded, cheap.
  const layout = useMemo(() => layoutCircuitMap(report), [report]);
  const unattributed = layout.unattributedControls;
  // How complete the accumulated map is, and whether the root observer is the
  // one filling it in. Both are local reads of state the kit already holds.
  const mapStats = describeScreenMap();
  const observer = describeNavObserver();

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: t.foreground }]}>Circuit map</Text>
        <Text style={[styles.sectionCount, { color: t.mutedForeground }]}>
          {findings.length} {findings.length === 1 ? "finding" : "findings"}
        </Text>
      </View>
      <Text style={[styles.sectionSub, { color: t.mutedForeground }]}>
        On-device navigation graph · nav loops · request bursts · dead-end taps ·
        orphan &amp; unreachable screens. {screenMapTravelLine(isPageMapSendEnabled())}
        {onRulePress ? " · tap a finding to jump to its fix" : ""}.
      </Text>
      {/* What this kit can and cannot say about the controls on a screen.
          Worded once in controlCensus.ts, so this card, the server’s project
          page and the disclosure cannot drift apart. */}
      <Text style={[styles.sectionSub, { color: t.mutedForeground }]}>
        {controlCensusStatusLine(controlCensusReport())}
      </Text>
      {/* Where the per-screen readings came from, in words. The observer and a
          hand-placed useBoosthis() are two sources for one measurement, so the
          count says which produced what — and a screen being measured right
          now is named once, not counted as a reading it has not finished. */}
      <Text style={[styles.sectionSub, { color: t.mutedForeground }]}>
        {describeScreenReadingCounts()}
      </Text>

      {/* The drawing */}
      <View style={styles.circuitGraph}>
        {layout.nodes.length === 0 ? (
          <View>
            <Text style={[styles.circuitGraphMeta, { color: t.mutedForeground }]}>
              Nothing to draw yet — no screens or navigations recorded, this launch or any
              earlier one this device kept.
            </Text>
            <Text style={[styles.circuitHelpLine, { color: t.mutedForeground }]}>
              The map draws itself from what this kit already records:
            </Text>
            {observer ? (
              <Text style={[styles.circuitHelpLine, { color: t.mutedForeground }]}>
                • {observer}
              </Text>
            ) : null}
            <Text style={[styles.circuitHelpLine, { color: t.mutedForeground }]}>
              •{" "}
              <Text style={{ color: t.foreground }}>useBoosthis(&apos;ScreenName&apos;)</Text>{" "}
              in a screen puts a box on the map.
            </Text>
            <Text style={[styles.circuitHelpLine, { color: t.mutedForeground }]}>
              •{" "}
              <Text style={{ color: t.foreground }}>perfMonitor.beginNav(from, to)</Text>{" "}
              just before you navigate draws the arrow — and thickens it each
              time that hop is travelled.
            </Text>
            <Text style={[styles.circuitHelpLine, { color: t.mutedForeground }]}>
              •{" "}
              <Text style={{ color: t.foreground }}>
                perfMonitor.wrapPress(&apos;Label&apos;, handler)
              </Text>{" "}
              on a control lets a tap that produced nothing be shown against the
              screen it was pressed on.
            </Text>
            <Text style={[styles.circuitHelpLine, { color: t.mutedForeground }]}>
              •{" "}
              <Text style={{ color: t.foreground }}>registerNavigationMap([…])</Text>{" "}
              overlays the routes you declared, so “is everything connected?” is
              answerable by looking.
            </Text>
          </View>
        ) : (
          <View>
            <Text style={[styles.circuitGraphMeta, { color: t.mutedForeground }]}>
              {layout.reached} {layout.reached === 1 ? "screen" : "screens"} reached ·{" "}
              {layout.totalEdges} {layout.totalEdges === 1 ? "route" : "routes"} observed
            </Text>
            <CircuitMapDrawing layout={layout} t={t} />
            {layout.edges.length === 0 ? (
              <Text style={[styles.circuitHelpLine, { color: t.mutedForeground }]}>
                No navigation recorded yet, so there are no arrows to draw. Call{" "}
                <Text style={{ color: t.foreground }}>perfMonitor.beginNav(from, to)</Text>{" "}
                just before each navigation and the lines appear here.
              </Text>
            ) : null}
            <View style={styles.circuitLegend}>
              <CircuitLegendChip color={t.border} label="reached" t={t} />
              <CircuitLegendChip color={t.poor} heavy label="has a finding" t={t} />
              <CircuitLegendChip color={t.needsWork} heavy label="no way in" t={t} />
              <CircuitLegendChip
                color={t.mutedForeground}
                dashed
                label="declared · not reached"
                t={t}
              />
              <Text style={[styles.circuitLegendLabel, { color: t.mutedForeground }]}>
                thicker arrow = travelled more often
              </Text>
            </View>
            {layout.subsetNote ? (
              <Text style={[styles.circuitHelpLine, { color: t.mutedForeground }]}>
                {layout.subsetNote}
              </Text>
            ) : null}
            {layout.declared > 0 ? (
              <Text style={[styles.circuitHelpLine, { color: t.mutedForeground }]}>
                Declared routes: {layout.declared} · reached:{" "}
                {layout.declared - layout.declaredUnreached} · not reached:{" "}
                {layout.declaredUnreached}. Not reached is informational — a screen
                can be perfectly reachable and simply not visited yet. “Reached”
                covers everything the map holds; the line below says how far back
                that goes.
              </Text>
            ) : (
              <Text style={[styles.circuitHelpLine, { color: t.mutedForeground }]}>
                No route list registered, so the map shows only what was walked.
                Call{" "}
                <Text style={{ color: t.foreground }}>registerNavigationMap([…])</Text>{" "}
                to overlay the routes you expect.
              </Text>
            )}
            {/* What this map can and cannot see. A tap only reaches the map
                if the app wrapped that control, so an empty dead-end list is
                a statement about wrapped controls — not about every button on
                the screen. Said here rather than implied by silence. */}
            <Text style={[styles.circuitHelpLine, { color: t.mutedForeground }]}>
              Coverage: taps are seen only for controls this app wrapped with{" "}
              <Text style={{ color: t.foreground }}>perfMonitor.wrapPress(…)</Text> (or
              recorded with <Text style={{ color: t.foreground }}>recordPress(…)</Text>).
              An un-wrapped control is invisible to this map, so “no dead ends” means
              none among the wrapped ones.
            </Text>
            {mapStats ? (
              <Text style={[styles.circuitHelpLine, { color: t.mutedForeground }]}>
                {mapStats}
              </Text>
            ) : null}
            {observer ? (
              <Text style={[styles.circuitHelpLine, { color: t.mutedForeground }]}>
                {observer}
              </Text>
            ) : null}
            {unattributed.length > 0 ? (
              <Text style={[styles.circuitHelpLine, { color: t.mutedForeground }]}>
                {unattributed.length}{" "}
                {unattributed.length === 1 ? "dead-end control" : "dead-end controls"} (
                {unattributed.map((c) => `${c.control} ×${c.count}`).join(", ")}) could
                not be placed on a screen — the log does not say which screen was
                showing when they were pressed, so they stay in the list below rather
                than being guessed at.
              </Text>
            ) : null}
          </View>
        )}
      </View>

      {/* Findings */}
      {findings.length === 0 ? (
        <View style={styles.emptyState}>
          <View
            style={[
              styles.emptyDot,
              { backgroundColor: tapsObservable ? t.good : t.mutedForeground },
            ]}
          />
          <Text style={[styles.emptyText, { color: t.mutedForeground }]}>
            {tapsObservable
              ? "No integrity problems found. Dead-end taps and orphan screens show up here. " +
                "Taps are judged for wrapped controls only, so this is not a verdict on every button."
              : "No integrity problems found in what could be watched. Dead-end taps cannot be judged " +
                "until the render profiler records a commit — wrap your app in <BoosthisProfiler> to " +
                "include them."}
          </Text>
        </View>
      ) : (
        findings
          .slice(0, 6)
          .map((f, i, arr) => (
            <CircuitFindingRow
              key={`${f.kind}-${f.name}-${i}`}
              finding={f}
              t={t}
              last={i === arr.length - 1}
              onRulePress={onRulePress}
            />
          ))
      )}
    </View>
  );
}

function Sparkline({
  points,
  t,
  max = 7,
}: {
  points: { ts: number; score: number }[];
  t: BoosthisDashboardTheme;
  max?: number;
}) {
  const data = useMemo(() => points.slice(-max), [points, max]);

  function colorFor(score: number): string {
    if (score >= 85) return t.good;
    if (score >= 60) return t.needsWork;
    return t.poor;
  }

  if (data.length === 0) {
    return (
      <View>
        <Text style={[styles.sectionTitle, { color: t.foreground }]}>
          Score over time
        </Text>
        <Text style={[styles.sparkEmpty, { color: t.mutedForeground }]}>
          Save a snapshot to start tracking your score over time.
        </Text>
      </View>
    );
  }

  const latest = data[data.length - 1];
  const previous = data.length > 1 ? data[data.length - 2] : null;
  const delta = previous ? latest.score - previous.score : 0;
  const arrow = delta === 0 ? "→" : delta > 0 ? "↑" : "↓";
  const deltaColor =
    delta === 0 ? t.mutedForeground : delta > 0 ? t.good : t.poor;
  const HEIGHT = 56;

  return (
    <View>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: t.foreground }]}>
          Score over time
        </Text>
        <Text style={[styles.sparkDelta, { color: deltaColor }]}>
          {arrow} {Math.abs(delta)} pts
        </Text>
      </View>
      <View style={styles.barsRow}>
        {data.map((p, i) => {
          const h = Math.max(4, (p.score / 100) * HEIGHT);
          return (
            <View key={`${p.ts}-${i}`} style={styles.barCol}>
              <View style={[styles.barTrack, { height: HEIGHT }]}>
                <View
                  style={[
                    styles.bar,
                    { height: h, backgroundColor: colorFor(p.score) },
                  ]}
                />
              </View>
              <Text style={[styles.barLabel, { color: t.mutedForeground }]}>
                {p.score}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function timeAgo(ts: number): string {
  if (!ts) return "—";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** A single frame-timing stat tile (p50 / p95 / p99 / worst). */
function FrameStat({
  label,
  ms,
  t,
}: {
  label: string;
  ms: number;
  t: BoosthisDashboardTheme;
}) {
  return (
    <View style={[styles.frameStat, { backgroundColor: t.secondary }]}>
      <Text style={[styles.frameStatValue, { color: durationColor(ms, t) }]}>
        {Math.round(ms)}
        <Text style={[styles.frameStatUnit, { color: t.mutedForeground }]}>ms</Text>
      </Text>
      <Text style={[styles.frameStatLabel, { color: t.mutedForeground }]}>{label}</Text>
    </View>
  );
}

/**
 * Width of one tile in the sideways-scrolling meter strip.
 *
 * The strip carries ~18 tiles, so they can never all fit: the tile keeps this
 * width and the strip scrolls. It is declared here (not inline in the style)
 * because the guard test asserts the tile can never shrink below it.
 */
export const AXIS_PILL_WIDTH = 128;

/**
 * One additive "meter axis" tile: a big 0-100 score (or "—" before data),
 * colored by its own rating band, with a small caption underneath. These
 * ENRICH the dashboard — they never feed the Speed composite.
 *
 * Exported for the layout guard test (same reason as ScreenDiagCard).
 */
export function AxisPill({
  label,
  value,
  sub,
  rating,
  t,
  fixed,
}: {
  label: string;
  value: string;
  sub: string;
  rating: AxisRating;
  t: BoosthisDashboardTheme;
  /** Fixed-width variant for the horizontally-scrollable axis strip. */
  fixed?: boolean;
}) {
  // Same map every other RN surface reads, so the two final silences
  // ("not-available", "not-scored") never render in the grey that means "a
  // score is still coming".
  const color = ratingColor(rating, t);
  // The bar is DERIVED from the score already printed above it, never passed
  // in beside it — a bar that could disagree with its own number would be
  // worse than no bar. Only a plain 0-100 score fills; the warming-up dash
  // leaves an EMPTY track rather than a fake zero-length reading. Same rule as
  // the other five kits' bubbles and the hosted snapshot page.
  // Accepts the two shapes a scored pill ever prints: a plain 0-100 score and
  // On budget's "NN%" percentage. The warming-up dash and Confidence's
  // HIGH/LOW have no length to draw, so they keep an empty track.
  const pctMatch = /^([0-9]{1,3}(?:\.[0-9]+)?)%?$/.exec(value);
  const pctNum = pctMatch ? Number(pctMatch[1]) : null;
  const pct = pctNum === null || pctNum > 100 ? null : Math.round(pctNum);
  return (
    <View
      style={[
        styles.axisPill,
        fixed ? styles.axisPillFixed : null,
        { backgroundColor: color + "1a", borderColor: color + "55" },
      ]}
    >
      <Text style={[styles.axisPillLabel, { color: t.mutedForeground }]}>{label}</Text>
      <Text style={[styles.axisPillValue, { color }]}>{value}</Text>
      <View style={[styles.axisPillBar, { backgroundColor: t.border }]}>
        <View
          style={[
            styles.axisPillBarFill,
            {
              width: `${pct ?? 0}%`,
              backgroundColor: pct === null ? "transparent" : color,
            },
          ]}
        />
      </View>
      <Text style={[styles.axisPillSub, { color: t.mutedForeground }]}>{sub}</Text>
    </View>
  );
}

/**
 * Compact color key for the perf meters, so the user can read the dashboard by
 * color alone — green is fine, red needs work — without parsing any numbers.
 */
function ColorLegend({ t }: { t: BoosthisDashboardTheme }) {
  const items: { c: string; label: string }[] = [
    { c: t.good, label: "Good ≤100ms" },
    { c: t.needsWork, label: "OK ≤300ms" },
    { c: t.sluggish, label: "Slow ≤800ms" },
    { c: t.poor, label: "Needs work >800ms" },
  ];
  return (
    <View style={[styles.legendCard, { backgroundColor: t.card, borderColor: t.border }]}>
      {items.map((it) => (
        <View key={it.label} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: it.c }]} />
          <Text style={[styles.legendLabel, { color: t.mutedForeground }]}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** One aggregate row: name + p50/p95/max/last. */
function MetricRow({
  label,
  row,
  t,
  isLast,
}: {
  label: string;
  row: PerfRow;
  t: BoosthisDashboardTheme;
  isLast?: boolean;
}) {
  const stat = (k: string, v: number) => (
    <View style={styles.metricStat}>
      <Text style={[styles.metricStatValue, { color: durationColor(v, t) }]}>{Math.round(v)}</Text>
      <Text style={[styles.metricStatLabel, { color: t.mutedForeground }]}>{k}</Text>
    </View>
  );
  return (
    <View
      style={[
        styles.metricRow,
        { borderBottomColor: t.border, borderBottomWidth: isLast ? 0 : 1 },
      ]}
    >
      <Text style={[styles.metricName, { color: t.foreground }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.metricStats}>
        {stat("p50", row.p50)}
        {stat("p95", row.p95)}
        {stat("max", row.max)}
        {stat("last", row.last)}
      </View>
    </View>
  );
}

/**
 * How many per-screen diagnosis cards the panel draws.
 *
 * Named rather than inlined because the panel now has to SAY what it left out:
 * the cap and the sentence under it are two readings of one number, and a
 * literal typed twice is a sentence that goes wrong the first time the cap
 * moves.
 */
export const DIAG_SCREEN_CARDS = 8;

/** Per-screen diagnosis card: score pill, pattern, full phase ladder, worst gap.
 *  Exported for tests only (friendly pattern-label coverage) — not part of the
 *  public kit surface (not re-exported from the package index). */
export function ScreenDiagCard({
  s,
  t,
}: {
  s: ScreenDiagnosis;
  t: BoosthisDashboardTheme;
}) {
  // Per-card score compute runs at render time on real screen data; guard it so
  // a single malformed screen can never throw out of the diagnosis list.
  let b: ReturnType<typeof computeScreenScore> | null = null;
  try {
    b = computeScreenScore(s);
  } catch {
    b = null;
  }
  const c = b ? ratingColor(b.rating, t) : t.pending;
  const ladder = Array.isArray(s.ladder) ? s.ladder : [];
  return (
    <View style={[styles.subCard, { backgroundColor: t.secondary, borderColor: t.border }]}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.subCardTitle, { color: t.foreground }]} numberOfLines={1}>
          {s.screen}
        </Text>
        <View
          style={[styles.scoreChip, { backgroundColor: c + "1a", borderColor: c + "55" }]}
        >
          <Text style={[styles.scoreChipText, { color: c }]}>
            {!b || b.rating === "insufficient-data" ? "—" : `${b.score} / 100`}
          </Text>
        </View>
      </View>
      <Text style={[styles.sectionSub, { color: t.mutedForeground }]}>
        {patternLabel(s.pattern)} · {Math.round(s.totalMs)}ms total · ×{s.mounts}
      </Text>
      {ladder.map((p, i, arr) => (
        <View
          key={p.phase}
          style={[
            styles.phaseRow,
            {
              borderBottomColor: t.border,
              borderBottomWidth: i === arr.length - 1 ? 0 : 1,
              paddingVertical: 7,
            },
          ]}
        >
          <View style={styles.phaseLeft}>
            <View style={[styles.phaseDot, { backgroundColor: durationColor(p.ms, t) }]} />
            <Text style={[styles.phaseLabel, { color: t.foreground }]}>{p.phase}</Text>
          </View>
          <Text style={[styles.phaseValue, { color: durationColor(p.ms, t) }]}>
            {Math.round(p.ms)}ms
          </Text>
        </View>
      ))}
      {s.worstGap ? (
        <Text style={[styles.worstGap, { color: t.needsWork }]}>
          Worst gap: {s.worstGap.from} → {s.worstGap.to} ({Math.round(s.worstGap.ms)}ms)
        </Text>
      ) : null}
    </View>
  );
}

export interface BoosthisEnginePanelProps {
  /** Override any subset of the default dark theme colors. */
  theme?: Partial<BoosthisDashboardTheme>;
  /**
   * Called when the user taps a detector finding that maps to a checklist rule.
   * Wire this to your navigation (e.g. `router.push('/rule/' + link.language +
   * '/' + link.ruleId)`). Omit to render findings as non-tappable.
   */
  onRulePress?: (link: DetectorRuleLink) => void;
}

/** Inline fallback shown when the engine panel cannot render. Resolves its own
 * theme and uses inline styles only, so the fallback itself can never throw. */
function EnginePanelFallback({
  theme,
}: {
  theme?: Partial<BoosthisDashboardTheme>;
}) {
  const t: BoosthisDashboardTheme = { ...DARK_THEME, ...theme };
  return (
    <View
      style={{
        backgroundColor: t.card,
        borderColor: t.border,
        borderWidth: 1,
        borderRadius: 12,
        paddingVertical: 14,
        paddingHorizontal: 16,
        marginHorizontal: 16,
        marginTop: 12,
      }}
    >
      <Text
        style={{
          color: t.foreground,
          fontSize: 15,
          fontWeight: "600",
          marginBottom: 4,
        }}
      >
        Diagnostics unavailable
      </Text>
      <Text style={{ color: t.mutedForeground, fontSize: 13, lineHeight: 18 }}>
        The detailed performance panel could not render this time. Reopen the
        dashboard to try again.
      </Text>
    </View>
  );
}

/**
 * Public engine panel. Self-wraps the implementation in an error boundary so a
 * render-time throw can NEVER escape to the host app — even when a host renders
 * <BoosthisEnginePanel /> directly (not via BoosthisDashboard). On failure it
 * shows the quiet "Diagnostics unavailable" card above; the host keeps running.
 */
export function BoosthisEnginePanel(
  props: BoosthisEnginePanelProps,
): React.ReactElement {
  return (
    <BoosthisErrorBoundary
      name="engine-panel"
      fallback={<EnginePanelFallback theme={props.theme} />}
    >
      <EnginePanelInner {...props} />
    </BoosthisErrorBoundary>
  );
}

function EnginePanelInner({
  theme,
  onRulePress,
}: BoosthisEnginePanelProps): React.ReactElement {
  const t = useMemo<BoosthisDashboardTheme>(
    () => ({ ...DARK_THEME, ...theme }),
    [theme],
  );
  const [state, setState] = useState<EngineState>({
    boot: {
      bundleLoadedMs: null,
      rootRenderedMs: null,
      firstScreenMs: null,
      interactiveMs: null,
      score: 0,
      rating: "insufficient-data",
      idleSuspected: false,
    },
    detectors: [],
    snapshots: [],
    allSnapshots: [],
    rows: [],
    diagnosis: null,
    startedAt: 0,
    totalEvents: 0,
    frame: EMPTY_FRAME,
    interaction: EMPTY_INTERACTION,
    render: EMPTY_RENDER,
    scroll: EMPTY_SCROLL,
    frustration: EMPTY_FRUSTRATION,
    network: EMPTY_NETWORK,
    routeSeries: [],
    recording: true,
    droppedRows: 0,
    droppedSummary: "",
    diff: null,
    chronic: [],
    circuitMap: { nodes: [], edges: [], findings: [], controls: [], screenFindings: [] },
    circuitTapsObservable: false,
  });
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const mountedRef = useRef(true);
  // Snapshot analysis (diff + chronic) is derived by reading full snapshot
  // payloads off disk, which we only do when the saved set actually changes —
  // NOT on every 2s refresh tick. The signature + cache keep it cheap.
  const snapSigRef = useRef<string>("");
  const snapAnalysisRef = useRef<{ diff: SnapshotDiff | null; chronic: ChronicPattern[] }>({
    diff: null,
    chronic: [],
  });
  // Monotonic token: refresh() is async + on a 2s interval, so calls can
  // overlap. Only the latest in-flight call is allowed to commit its results,
  // so a slow older call can never overwrite the cache (or state) with stale
  // analysis and then have the sig-check skip future recomputes.
  const refreshSeqRef = useRef(0);
  /** True only when THIS panel was what started the frame sampler, so closing
   *  the dashboard can undo its own start and nothing else. */
  const startedFrameSamplerRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    // DRAWING MUST NEVER BE WHAT KEEPS A MEASUREMENT ALIVE. `enableTelemetry()`
    // starts the frame sampler at kit boot (installFrameSampling), so a hidden
    // bubble / never-opened dashboard still measures Smoothness, Stability,
    // Frame Floor, frozen frames, hangs and idle burn. This effect only covers
    // the leftover case where nothing started it — a dev harness that never
    // enabled telemetry, or a manual STOP from the frame card — and then only
    // the panel's OWN start is undone on unmount. A sampler the kit started is
    // left running when the dashboard closes.
    safeRun("engine-panel:mount", () => {
      if (perfMonitor.isEnabled() && !frameSampler.isRunning()) {
        frameSampler.start();
        startedFrameSamplerRef.current = true;
      }
    });
    return () => {
      mountedRef.current = false;
      safeRun("engine-panel:unmount", () => {
        if (!startedFrameSamplerRef.current) return;
        startedFrameSamplerRef.current = false;
        frameSampler.stop();
      });
    };
  }, []);

  const refresh = useCallback(async () => {
    const myRun = ++refreshSeqRef.current;
    try {
      const report = await perfMonitor.getReport();
      const events = await perfMonitor.getEvents();
      const commits = renderProfiler.getCommits();
      // The census travels with the events: in a release build it is the ONLY
      // one of the three that can be non-empty (React's profiler is a no-op
      // there), so leaving it out is what made a census-only defect read as
      // "No anomalies detected" on this card and never reach ingestFindings.
      const detectors = runNovelDetectors(events, commits, getMountCensus());
      // Candidate detection + auto-submit still runs here; the panel no longer
      // renders a card for it (maintainer-internal — documented in the Terms).
      await ingestFindings(detectors);
      const snapshots = await listSnapshots();
      // Recompute diff + chronic ONLY when the saved snapshot set changes.
      const sig = snapshots.map((s) => s.id).join(",");
      if (sig !== snapSigRef.current) {
        const fulls = (
          await Promise.all(snapshots.slice(0, 8).map((s) => loadSnapshot(s.id)))
        ).filter((s): s is PerfSnapshot => s !== null);
        // Commit the sig + analysis together, and only if this is still the
        // latest refresh — a slower older call must not overwrite the cache
        // with stale analysis (which would then make the sig-check skip
        // recomputes and leave the cards permanently out of date).
        if (myRun === refreshSeqRef.current) {
          snapSigRef.current = sig;
          snapAnalysisRef.current = {
            // snapshots are newest-first, so [1] is the prior baseline, [0] the latest.
            diff: fulls.length >= 2 ? diffSnapshots(fulls[1], fulls[0]) : null,
            chronic: findChronicPatterns(fulls, 3),
          };
        }
      }
      if (!mountedRef.current || myRun !== refreshSeqRef.current) return;
      setState({
        boot: getBootScore(),
        detectors,
        snapshots: snapshots.slice(0, 3),
        allSnapshots: snapshots,
        rows: report.rows,
        diagnosis: report.diagnosis,
        startedAt: report.startedAt,
        totalEvents: report.totalEvents,
        frame: frameSampler.getStats(),
        interaction: getInteractionStats(),
        render: renderProfiler.getStats(),
        scroll: scrollSampler.getStats(),
        frustration: getFrustrationStats(),
        // Coverage rides along only where there is a claim to make: with
        // automatic reporting off the host may be wiring this axis by hand,
        // and a zero here would be read as "nobody switched it on".
        network: { ...networkSampler.getStats(), ...networkCoverageFields() },
        routeSeries: buildRouteSeries(events),
        recording: perfMonitor.isEnabled(),
        // Cumulative rows the server refused since boot, in the web page's own
        // words. Both are 0 / "" until a reply reports a drop, so the row below
        // stays hidden on a healthy app and an older server.
        droppedRows: getDroppedRowCount(),
        droppedSummary: droppedRowsSummary(),
        diff: snapAnalysisRef.current.diff,
        chronic: snapAnalysisRef.current.chronic,
        // ON-DEVICE ONLY: reconstruct the navigation graph + integrity findings
        // from the local event log + render commits. Never uploaded.
        circuitMap: buildCircuitMap(events, commits),
        circuitTapsObservable: commits.length > 0,
      });
    } catch {
      // Engine reads are best-effort; keep the last good state.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const handleSnapshot = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const report = await perfMonitor.getReport();
      const meta = await saveSnapshot(report);
      if (!mountedRef.current) return;
      Alert.alert("Snapshot saved", `${meta.label} · ${meta.totalEvents} events`);
      await refresh();
    } catch (e) {
      if (mountedRef.current) Alert.alert("Snapshot failed", String(e));
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [saving, refresh]);

  const handleShare = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const md = buildMarkdownReport({
        boot: state.boot,
        detectors: state.detectors,
        snapshots: state.allSnapshots,
        runtimeVersion: RUNTIME_VERSION,
        diagnosis: state.diagnosis,
        rows: state.rows,
        frame: state.frame,
        totalEvents: state.totalEvents,
      });
      await Share.share({ title: "Boosthis report", message: md });
    } catch (e) {
      if (mountedRef.current) Alert.alert("Share failed", String(e));
    } finally {
      if (mountedRef.current) setSharing(false);
    }
  }, [
    sharing,
    state.boot,
    state.detectors,
    state.allSnapshots,
    state.diagnosis,
    state.rows,
    state.frame,
    state.totalEvents,
  ]);

  const handleDeleteSnapshot = useCallback(
    (id: string, label: string) => {
      Alert.alert("Delete snapshot?", label, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void deleteSnapshot(id)
              .then(() => refresh())
              .catch((e) => {
                if (mountedRef.current) Alert.alert("Delete failed", String(e));
              });
          },
        },
      ]);
    },
    [refresh],
  );

  const handleClear = useCallback(() => {
    Alert.alert(
      "Clear collected data?",
      "Erases all in-memory perf events on this device. Saved snapshots are kept.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            safeRun("engine-panel:clear", () => {
              frameSampler.clear();
              scrollSampler.clear();
            });
            safeAsync("engine-panel:clear-monitor", () =>
              perfMonitor.clear().then(() => void refresh()),
            );
          },
        },
      ],
    );
  }, [refresh]);

  const toggleRecording = useCallback(() => {
    safeRun("engine-panel:toggle-recording", () => {
      perfMonitor.setEnabled(!perfMonitor.isEnabled());
    });
    void refresh();
  }, [refresh]);

  const toggleFrameSampler = useCallback(() => {
    safeRun("engine-panel:toggle-frame", () => {
      if (frameSampler.isRunning()) frameSampler.stop();
      else frameSampler.start();
    });
    void refresh();
  }, [refresh]);

  // These meter computes run at RENDER time (outside refresh()'s try/catch) and
  // only exercise their full logic on real accumulated data, so they are the
  // crash surface a host app would hit in the field. Each is wrapped so an
  // unexpected throw degrades to a safe "no data" result instead of taking the
  // panel (and the host app) down. The internal error boundary is the backstop;
  // this keeps the rest of the panel rendering even when one compute fails.
  const overall = useMemo(() => {
    try {
      return state.diagnosis ? computeOverallScore(state.diagnosis) : null;
    } catch {
      return null;
    }
  }, [state.diagnosis]);

  // ── Additive meter axes — these ENRICH the dashboard only. None of them
  // feed the Speed composite (TTFF·0.25 + TTI·0.45 + FID·0.30), which stays
  // byte-identical to the Python runtime + the server rating buckets. They are
  // produced by the SHARED computeMeterAxes helper — the very same function the
  // snapshot upload calls — so the in-app dashboard and the web mirror (/app +
  // /admin) can never drift, and confidence keys off min-mounts across scorable
  // screens just as it does in the uploaded snapshot.
  const {
    smoothness,
    responsiveness,
    stability,
    scroll,
    frustration,
    idle,
    frameFloor,
    frozenFrames,
    appHang,
    eventLoopLag,
    blockingAsync,
    asyncSlowCallbacks,
    network,
    backgroundWork,
    upstreamCache,
    baseline,
    resilience,
    reRenders,
    imageWeight,
    bridgeTraffic,
    jsStartup,
    navDeadTime,
    pressToScreen,
    screenLeaks,
    // Lifecycle / error-hygiene / Hermes / storage batch (Aug 2026). The
    // env-gated ones (hermes*, storage*) are UNDEFINED when their opt-in is
    // off — the pills below self-hide rather than render a fabricated zero.
    foregroundResidency,
    backgroundRecovery,
    dimensionChurn,
    appearanceChurn,
    keyboardLatency,
    memoryWarnings,
    unhandledErrors,
    promiseRejections,
    rejectionPressure,
    leakWatch,
    swallowedErrors,
    devPosture,
    liveConnections,
    heapHeadroom,
    gcPressure,
    gcTax,
    hermesRuntime,
    jsiCapability,
    storageLatency,
    storageFailures,
    patchLag,
    budget,
    confidence,
    confidenceRating,
    confidenceCaption,
  } = useMemo(() => {
    try {
      return computeMeterAxes(
        state.diagnosis ?? null,
        state.frame,
        state.interaction,
        state.scroll,
        state.frustration,
        state.network,
        state.routeSeries,
      );
    } catch {
      // Fall back to the all-empty ("measuring…") result, which is the same
      // guaranteed-safe path the panel renders before any data arrives.
      return computeMeterAxes(
        null,
        EMPTY_FRAME,
        EMPTY_INTERACTION,
        EMPTY_SCROLL,
        EMPTY_FRUSTRATION,
        EMPTY_NETWORK,
      );
    }
  }, [state.diagnosis, state.frame, state.interaction, state.scroll, state.frustration, state.network, state.routeSeries]);

  // Dev-only Render Efficiency axis (5th tile). Empty in release builds, so the
  // pill self-hides; never aggregated into computeMeterAxes / the upload.
  const renderEff = useMemo(() => {
    try {
      return computeRenderEfficiency(state.render);
    } catch {
      return computeRenderEfficiency(EMPTY_RENDER);
    }
  }, [state.render]);

  const rowGroups = useMemo(() => {
    const KIND_ORDER = ["screen", "nav", "press", "api", "event"];
    const groups: Record<string, { name: string; row: PerfRow }[]> = {};
    for (const r of state.rows) {
      const idx = r.key.indexOf(":");
      const kind = idx >= 0 ? r.key.slice(0, idx) : "other";
      const name = idx >= 0 ? r.key.slice(idx + 1) : r.key;
      (groups[kind] ??= []).push({ name, row: r });
    }
    const ordered = Object.keys(groups).sort((a, b) => {
      const ia = KIND_ORDER.indexOf(a);
      const ib = KIND_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return ordered.map((kind) => ({ kind, items: groups[kind] }));
  }, [state.rows]);

  const sparklinePoints = useMemo(() => {
    return state.allSnapshots
      .slice()
      .reverse()
      .filter((s): s is SnapshotMeta & { score: number } => typeof s.score === "number")
      .map((s) => ({ ts: s.savedAt, score: s.score }));
  }, [state.allSnapshots]);

  const bootColor = ratingColor(state.boot.rating, t);

  return (
    <>
      {/* Status */}
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: t.foreground }]}>Status</Text>
          <Pressable
            onPress={toggleRecording}
            style={[
              styles.scoreChip,
              {
                backgroundColor: (state.recording ? t.good : t.pending) + "1a",
                borderColor: (state.recording ? t.good : t.pending) + "55",
              },
            ]}
          >
            <Text
              style={[
                styles.scoreChipText,
                { color: state.recording ? t.good : t.pending },
              ]}
            >
              {state.recording ? "● RECORDING" : "○ PAUSED"}
            </Text>
          </Pressable>
        </View>
        <View style={styles.statusGrid}>
          <View style={styles.statusCell}>
            <Text style={[styles.statusValue, { color: t.foreground }]}>
              {state.totalEvents}
            </Text>
            <Text style={[styles.statusLabel, { color: t.mutedForeground }]}>
              events captured
            </Text>
          </View>
          <View style={styles.statusCell}>
            <Text style={[styles.statusValue, { color: t.foreground }]}>
              {timeAgo(state.startedAt)}
            </Text>
            <Text style={[styles.statusLabel, { color: t.mutedForeground }]}>
              since
            </Text>
          </View>
        </View>
        {/* The server stored fewer rows than this app sent — the size of the
            hole in the dashboard, in the same words the web page uses. Shown
            ONLY when something was dropped; a healthy app and an older server
            render nothing here. */}
        {state.droppedRows > 0 && state.droppedSummary !== "" ? (
          <View style={styles.dropRow}>
            <Text style={[styles.dropLabel, { color: t.mutedForeground }]}>
              Measurements dropped
            </Text>
            <Text style={[styles.dropValue, { color: t.poor }]}>
              {state.droppedSummary}
            </Text>
          </View>
        ) : null}
        <View style={[styles.actionRow, { marginTop: 14 }]}>
          <Pressable
            onPress={handleShare}
            disabled={sharing}
            style={[styles.saveBtn, { backgroundColor: t.primary, opacity: sharing ? 0.6 : 1 }]}
          >
            <Text style={[styles.saveBtnLabel, { color: t.background }]}>
              {sharing ? "…" : "Send to AI"}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleClear}
            style={[styles.saveBtn, { backgroundColor: t.secondary }]}
          >
            <Text style={[styles.saveBtnLabel, { color: t.poor }]}>
              Clear collected data
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Color key — read the meters by color, no numbers needed */}
      <ColorLegend t={t} />

      {/* Boot Ladder */}
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: t.foreground }]}>
            Boot ladder
          </Text>
          <View
            style={[
              styles.scoreChip,
              { backgroundColor: bootColor + "1a", borderColor: bootColor + "55" },
            ]}
          >
            <Text style={[styles.scoreChipText, { color: bootColor }]}>
              {state.boot.rating === "insufficient-data"
                ? "MEASURING"
                : `${state.boot.score} / 100`}
            </Text>
          </View>
        </View>
        <Text style={[styles.sectionSub, { color: t.mutedForeground }]}>
          Cold-start budget — Shopify-derived
        </Text>
        <PhaseRow label="bundleLoaded" ms={state.boot.bundleLoadedMs} t={t} />
        <PhaseRow label="rootRendered" ms={state.boot.rootRenderedMs} t={t} />
        <PhaseRow label="firstScreen" ms={state.boot.firstScreenMs} t={t} />
        <PhaseRow label="interactive" ms={state.boot.interactiveMs} t={t} last />
        {state.boot.idleSuspected ? (
          <Text style={[styles.sectionSub, { color: t.mutedForeground, marginTop: 8 }]}>
            Idle time detected — a phase ran far past a real cold boot (app
            backgrounded, or parked on a splash/login screen Boosthis can't see).
            That wait is excluded from the score, not counted as load time.
          </Text>
        ) : null}
      </View>

      {/* Frame sampler */}
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: t.foreground }]}>
            Frame sampler
          </Text>
          <Pressable
            onPress={toggleFrameSampler}
            style={[
              styles.saveBtn,
              { backgroundColor: state.frame.isRunning ? t.poor : t.primary },
            ]}
          >
            <Text style={[styles.saveBtnLabel, { color: t.background }]}>
              {state.frame.isRunning ? "STOP" : "START"}
            </Text>
          </Pressable>
        </View>
        <Text style={[styles.sectionSub, { color: t.mutedForeground }]}>
          JS frame timing ·{" "}
          {state.frame.isRunning
            ? `${state.frame.sampleCount} frames in window`
            : "idle — press START during an interaction"}
        </Text>
        <View style={styles.frameStatsRow}>
          <FrameStat label="p50" ms={state.frame.p50Ms} t={t} />
          <FrameStat label="p95" ms={state.frame.p95Ms} t={t} />
          <FrameStat label="p99" ms={state.frame.p99Ms} t={t} />
          <FrameStat label="worst" ms={state.frame.worstMs} t={t} />
        </View>
        <View style={[styles.jankRow, { borderTopColor: t.border }]}>
          <Text style={[styles.phaseLabel, { color: t.foreground }]}>
            Jank (frames &gt; 32ms)
          </Text>
          <Text
            style={[
              styles.phaseValue,
              {
                color:
                  state.frame.jankFraction > 0.1
                    ? t.poor
                    : state.frame.jankFraction > 0.02
                      ? t.needsWork
                      : t.good,
              },
            ]}
          >
            {(state.frame.jankFraction * 100).toFixed(1)}%
          </Text>
        </View>
        {/* Honesty note (never a score input): a flat 0% jank window can hide a
            thin sample or a single ≥500ms stall we dropped as "backgrounded". */}
        {state.frame.sampleCount > 0 &&
        (state.frame.sampleCount < THIN_SAMPLE_FRAMES ||
          state.frame.suspectedSuspensions > 0) ? (
          <Text style={[styles.frameHonesty, { color: t.mutedForeground }]}>
            {[
              state.frame.sampleCount < THIN_SAMPLE_FRAMES
                ? `Thin sample (${state.frame.sampleCount} frame${state.frame.sampleCount === 1 ? "" : "s"}) — a spot check, not a trend.`
                : null,
              state.frame.suspectedSuspensions > 0
                ? `${state.frame.suspectedSuspensions} gap${state.frame.suspectedSuspensions === 1 ? "" : "s"} ≥500ms ignored as backgrounding — not counted in jank.`
                : null,
            ]
              .filter(Boolean)
              .join(" ")}
          </Text>
        ) : null}
        {/* Additive on-device axes — runtime feel (do NOT feed Speed score).
            Each pill keeps a fixed readable width — with 8-9 axes, splitting
            the card width made the labels unreadable.

            THESE NO LONGER SCROLL SIDEWAYS. They did, with the indicator
            switched off, which meant a reader who never happened to swipe
            never learnt there were more axes: the product looked like it had
            three readings when it had eighteen. A wrapping row needs no cue
            because nothing is off-screen to begin with — every axis is on the
            page and reachable with the vertical scroll the panel already
            has. */}
        <View style={styles.axisWrap}>
          <AxisPill
            fixed
            label="SMOOTHNESS"
            value={smoothness.score == null ? "—" : String(smoothness.score)}
            sub={
              smoothness.rating === "not-available"
                ? "frame timing is not exposed in this host"
                : smoothness.jankPct == null ? "no frames yet" : `${smoothness.jankPct}% janky`
            }
            rating={smoothness.rating}
            t={t}
          />
          <AxisPill
            fixed
            label="RESPONSIVENESS"
            value={responsiveness.score == null ? "—" : String(responsiveness.score)}
            sub={
              responsiveness.p75Ms == null
                ? "tap around to measure"
                : `${Math.round(responsiveness.p75Ms)}ms p75 · ${responsiveness.count} taps`
            }
            rating={responsiveness.rating}
            t={t}
          />
          <AxisPill
            fixed
            label="STABILITY"
            value={stability.score == null ? "—" : String(stability.score)}
            sub={
              stability.rating === "not-available"
                ? "frame timing is not exposed in this host"
                : stability.longTasksPerMin == null
                ? stability.longTaskCount > 0
                  ? `${stability.longTaskCount} stalls · warming up`
                  : "warming up"
                : `${stability.longTasksPerMin}/min stalls${stability.worstBlockMs > 0 ? ` · worst ${stability.worstBlockMs}ms` : ""}`
            }
            rating={stability.rating}
            t={t}
          />
          <AxisPill
            fixed
            label="SCROLL"
            value={scroll.score == null ? "—" : String(scroll.score)}
            sub={
              scroll.jankPct == null
                ? scroll.blankEvents > 0
                  ? `${scroll.blankEvents} blank cells · scroll to measure`
                  : "scroll to measure"
                : `${scroll.jankPct}% janky${scroll.blankEvents > 0 ? ` · ${scroll.blankEvents} blanks` : ""}`
            }
            rating={scroll.rating}
            t={t}
          />
          <AxisPill
            fixed
            label="FRUSTRATION"
            value={frustration.score == null ? "—" : String(frustration.score)}
            sub={
              frustration.ragePerMin == null
                ? frustration.burstCount > 0
                  ? `${frustration.burstCount} rage taps · warming up`
                  : "tap around to measure"
                : `${frustration.ragePerMin}/min rage taps${frustration.worstDelayMs > 0 ? ` · worst ${frustration.worstDelayMs}ms` : ""}`
            }
            rating={frustration.rating}
            t={t}
          />
          <AxisPill
            fixed
            label="IDLE EFFICIENCY"
            value={idle.score == null ? "—" : String(idle.score)}
            sub={
              idle.rating === "not-available"
                ? "frame timing is not exposed in this host"
                : idle.idleBusyPct == null
                ? idle.idleFrameCount > 0
                  ? `${idle.idleFrameCount} idle frames · warming up`
                  : "leave screen idle to measure"
                : `${idle.idleBusyPct}% busy while idle${idle.idleLongTaskCount > 0 ? ` · ${idle.idleLongTaskCount} stalls` : ""}`
            }
            rating={idle.rating}
            t={t}
          />
          <AxisPill
            fixed
            label="FRAME FLOOR"
            value={frameFloor.score == null ? "—" : String(frameFloor.score)}
            sub={
              frameFloor.rating === "not-available"
                ? "frame timing is not exposed in this host"
                : frameFloor.floorFps == null
                ? frameFloor.windowCount > 0
                  ? `${frameFloor.windowCount} window${frameFloor.windowCount === 1 ? "" : "s"} · warming up`
                  : "keep the app moving to measure"
                : `worst second ${frameFloor.floorFps}fps · ${frameFloor.windowCount} windows`
            }
            rating={frameFloor.rating}
            t={t}
          />
          <AxisPill
            fixed
            label="FROZEN FRAMES"
            value={frozenFrames.score == null ? "—" : String(frozenFrames.score)}
            sub={
              frozenFrames.rating === "not-available"
                ? "frame timing is not exposed in this host"
                : frozenFrames.frozenPerHour == null
                ? warmingWindowSub(
                    frozenFrames.windowMin,
                    frozenFrames.runsInWindow,
                    frozenFrames.frozenCount > 0
                      ? `${frozenFrames.frozenCount} frozen frames (≥700ms)`
                      : "",
                  )
                : `${frozenFrames.frozenCount} frozen frames (≥700ms) · ${frozenFrames.frozenPerHour}/h`
            }
            rating={frozenFrames.rating}
            t={t}
          />
          <AxisPill
            fixed
            label="APP HANGS"
            value={appHang.score == null ? "—" : String(appHang.score)}
            sub={
              appHang.rating === "not-available"
                ? "frame timing is not exposed in this host"
                : appHang.score == null
                ? warmingWindowSub(
                    appHang.windowMin,
                    appHang.runsInWindow,
                    appHang.hangCount > 0
                      ? `${appHang.hangCount} app hangs (≥5s)`
                      : "",
                  )
                : `${appHang.hangCount} app hangs (≥5s)${appHang.worstHangMs > 0 ? ` · worst ${Math.round(appHang.worstHangMs / 1000)}s` : ""}`
            }
            rating={appHang.rating}
            t={t}
          />
          {eventLoopLag ? (
            <AxisPill
              fixed
              label="EVENT LOOP LAG"
              value={String(eventLoopLag.score)}
              sub={`p95 ${eventLoopLag.p95Ms}ms · ${eventLoopLag.sampleCount} callbacks`}
              rating={eventLoopLag.rating}
              t={t}
            />
          ) : null}
          {blockingAsync ? (
            <AxisPill
              fixed
              label="BLOCKING ASYNC"
              value={String(blockingAsync.score)}
              sub={`${blockingAsync.perMin}/min · worst ${blockingAsync.worstMs}ms`}
              rating={blockingAsync.rating}
              t={t}
            />
          ) : null}
          {asyncSlowCallbacks ? (
            <AxisPill
              fixed
              label="SLOW ASYNC CALLBACKS"
              value={String(asyncSlowCallbacks.score)}
              sub={`${asyncSlowCallbacks.perMin}/min · ${asyncSlowCallbacks.count} callbacks`}
              rating={asyncSlowCallbacks.rating}
              t={t}
            />
          ) : null}
          <AxisPill
            fixed
            label="NETWORK"
            value={network.score == null ? "—" : String(network.score)}
            sub={
              // Four silences, four sentences — the same four the wire
              // carries and the dashboard draws. A count beside a verdict
              // that says nothing was counted is the one thing none of them
              // may print: at zero attempts there is no number to give, and
              // printing "0 calls" told a customer with a busy app that we
              // had measured their traffic and found none.
              network.reasonCode === REASON_OFF_IN_THIS_BUILD
                ? // The app refused a default-on collector. That is the app's
                  // own doing and the reading says so, in the dashboard's
                  // words, with the door it came through.
                  "it is switched off in this build · remove autoWrapNetwork: false, or report attempts from your transport"
                : network.p75Ms == null
                ? network.attemptCount > 0
                  ? `${network.attemptCount} calls · warming up`
                  : // Each silence's words are the dashboard's own, to the
                    // word. A developer who reads this pill and then opens the
                    // project page must not have to work out that the two
                    // sentences are the same fact. The page's "nothing
                    // measured yet" LEAD is what the dash above already says
                    // here, so the pill carries the noun and drops the lead
                    // rather than repeating itself — and a per-meter chip
                    // that said it would read as the whole app warming up,
                    // which is a different silence.
                    // "Nobody switched this on" is a CLAIM, and only a kit
                    // that is watching can make it: with automatic reporting
                    // off the host may be reporting every attempt by hand,
                    // and an absent flag is not a zero.
                    network.watching == null || network.watching > 0
                    ? "no network attempt has been reported by this app"
                    : "the app has not switched this on · switch on automatic reporting, or report attempts from your transport"
                : `${network.stallPct}% stalled · p75 ${network.p75Ms}ms${
                    // What we could not watch is stated, never folded into
                    // the measured figure above it.
                    (network.unwatchedClients ?? 0) > 0
                      ? ` · ${network.unwatchedClients} transport(s) out of reach`
                      : ""
                  }`
            }
            rating={network.rating}
            t={t}
          />
          <AxisPill
            fixed
            label="BASELINE"
            value={baseline.score == null ? "—" : String(baseline.score)}
            sub={
              // A screen whose earlier window is all sub-millisecond has no
              // denominator to divide by, so it was NOT examined: an abstention
              // ("too fast to compare") must look different from both a good
              // reading and a warming-up one.
              baseline.score == null
                ? baseline.unscoredRoutes > 0
                  ? `not judged · ${baseline.unscoredRoutes} screen${baseline.unscoredRoutes === 1 ? "" : "s"} too fast to compare`
                  : "navigate screens to measure"
                : (baseline.anomalyCount > 0 && baseline.worstRatio != null
                    ? `${baseline.anomalyCount} screen${baseline.anomalyCount === 1 ? "" : "s"} slower · worst ${baseline.worstRatio}×${
                        baseline.worstBaselineMs != null && baseline.worstCurrentMs != null
                          ? ` (${baseline.worstBaselineMs}→${baseline.worstCurrentMs}ms)`
                          : ""
                      }`
                    : `${baseline.scoredRoutes} screen${baseline.scoredRoutes === 1 ? "" : "s"} steady`) +
                  (baseline.unscoredRoutes > 0
                    ? ` · ${baseline.unscoredRoutes} too fast to compare`
                    : "")
            }
            rating={baseline.rating}
            t={t}
          />
          <AxisPill
            fixed
            label="RESILIENCE"
            value={resilience.score == null ? "—" : String(resilience.score)}
            sub={
              // Four visibly distinct readings, never a blank or a bare zero:
              // a ratio · a tail too small to have one · a median too small to
              // take one from · not enough mounts yet.
              resilience.tailRatio != null
                ? `tail ${resilience.tailRatio}× (${resilience.p50Ms}→${resilience.p99Ms}ms) · ${resilience.sampleCount} mounts`
                : resilience.score != null
                  ? `every mount under ${RESILIENCE_TAIL_FLOOR_MS}ms · ${resilience.sampleCount} mounts`
                  : resilience.sampleCount >= RESILIENCE_MIN_TAIL_SAMPLES
                    ? `tail not judged — median under ${RESILIENCE_MIN_MEDIAN_MS}ms · ${resilience.sampleCount} mounts`
                    : "navigate screens to measure"
            }
            rating={resilience.rating}
            t={t}
          />
          <AxisPill
            fixed
            label="RE-RENDER STORMS"
            value={reRenders.score == null ? "—" : String(reRenders.score)}
            sub={
              reRenders.measurable === 0
                ? "React's Profiler is off in release builds — run a dev session"
                : reRenders.commitsP75 == null
                  ? `${reRenders.interactionCount}/10 interactions · warming up`
                  : `p75 ${reRenders.commitsP75} commits/tap${reRenders.storms > 0 ? ` · ${reRenders.storms} storms` : ""}`
            }
            rating={reRenders.rating}
            t={t}
          />
          <AxisPill
            fixed
            label="IMAGE WEIGHT"
            value={imageWeight.score == null ? "—" : String(imageWeight.score)}
            sub={
              imageWeight.reasonCode === REASON_OFF_IN_THIS_BUILD
                ? "it is switched off in this build · remove trackImageWeight: false"
                : imageWeight.rating === "not-available"
                ? "image interception is not wired"
                : imageWeight.overfetchX == null
                ? imageWeight.imagesMeasured > 0
                  ? `${imageWeight.imagesMeasured}/5 images · warming up`
                  : "no images measured yet"
                : `p75 ${imageWeight.overfetchX}× overfetch${imageWeight.overfetchedCount > 0 ? ` · ${imageWeight.overfetchedCount} heavy` : ""}`
            }
            rating={imageWeight.rating}
            t={t}
          />
          <AxisPill
            fixed
            label="BRIDGE TRAFFIC"
            value={bridgeTraffic.score == null ? "—" : String(bridgeTraffic.score)}
            sub={
              bridgeTraffic.newArch === 1
                ? "new architecture (JSI) — not countable from JS; the new arch is the fix"
                : bridgeTraffic.measurable === 0
                  ? "MessageQueue spy unavailable"
                  : bridgeTraffic.callsPerMin == null
                    ? `${Math.round(bridgeTraffic.sampledMs / 1000)}s sampled · warming up`
                    : `${bridgeTraffic.callsPerMin}/min native calls`
            }
            rating={bridgeTraffic.rating}
            t={t}
          />
          <AxisPill
            fixed
            label="JS STARTUP"
            value={jsStartup.score == null ? "—" : String(jsStartup.score)}
            sub={
              jsStartup.startupClock === STARTUP_CLOCK.UNMATCHED
                ? // Not warming up and never will: the host's bundle-start
                  // anchor is on a clock this app gives us no way to read at
                  // the other end, so there is no duration to report. Saying
                  // "waiting for first render" here would be a promise we
                  // cannot keep.
                  "startup clock can't be matched on this host — no reading"
                : jsStartup.startupMs == null
                  ? "one-shot per launch — waiting for first render"
                  : `${jsStartup.startupMs}ms to first render${jsStartup.fromBundleStart === 1 ? " (from bundle start)" : " (from kit load)"}`
            }
            rating={jsStartup.rating}
            t={t}
          />
          <AxisPill
            fixed
            label="NAV DEAD TIME"
            value={navDeadTime.score == null ? "—" : String(navDeadTime.score)}
            sub={
              navDeadTime.p75Ms == null
                ? navDeadTime.navCount > 0
                  ? `${navDeadTime.navCount}/5 navs · warming up`
                  : "navigate screens to measure"
                : `p75 ${navDeadTime.p75Ms}ms tap→screen · ${navDeadTime.navCount} navs`
            }
            rating={navDeadTime.rating}
            t={t}
          />
          {/* THE WHOLE WAIT — the press, through to the screen it opened
            * having a measurement of its own. The same reading the snapshot
            * uploads, restated here rather than re-derived, so the phone in
            * a developer's hand and the dashboard cannot disagree about it.
            * Presses that reached no timed screen are named beside it: they
            * are what a silent discard used to hide. */}
          <AxisPill
            fixed
            label="PRESS → SCREEN"
            value={
              pressToScreen.score == null ? "—" : String(pressToScreen.score)
            }
            sub={`${
              /* It is not warming up, and it never will be. The kit says
               * which of the two answers it is, so the phone in a
               * developer's hand and the dashboard tile cannot disagree
               * about why there is no number here. */
              pressToScreen.rating === "not-available"
                ? pressToScreen.reasonCode === REASON_OFF_IN_THIS_BUILD
                  ? "presses are not collected in this build"
                  : pressToScreen.reasonCode ===
                      REASON_NAVIGATION_NOT_RECOGNISED
                    ? "screen changes here are not ones the kit can follow"
                    : "this app has not mounted the navigation observer"
                : pressToScreen.p75Ms == null
                  ? `${pressToScreen.navCount}/5 presses joined`
                  : `p75 ${pressToScreen.p75Ms}ms press→usable · ${pressToScreen.navCount} navs`
            } · ${
              pressToScreen.unjoinedPastBound +
              pressToScreen.unjoinedNoScreen +
              pressToScreen.unjoinedNoTiming
            } not joined`}
            rating={pressToScreen.rating}
            t={t}
          />
          {screenLeaks ? (
            <AxisPill
              fixed
              label="SCREEN TIMER LEAKS"
              value={String(screenLeaks.score)}
              sub={`${screenLeaks.leakedPerExit} JS timers/exit · ${screenLeaks.leakedTotal} total`}
              rating={screenLeaks.rating}
              t={t}
            />
          ) : null}
          {/* ── Lifecycle / device-context batch ─────────────────────────────
            * Same numbers the snapshot uploads, restated — never re-derived,
            * so the in-app panel can never disagree with the dashboard. */}
          {/* NOT GRADED — the value slot carries the MEASUREMENT, never a
            * score, because there is no score. How long someone keeps the app
            * open is their choice, not the app's doing. */}
          {foregroundResidency ? (
            <AxisPill
              fixed
              label="FOREGROUND TIME"
              value={
                foregroundResidency.foregroundPct == null ||
                foregroundResidency.activeMin == null
                  ? "—"
                  : minuteText(foregroundResidency.activeMin)
              }
              sub={
                foregroundResidency.foregroundPct == null
                  ? warmingWindowSub(
                      foregroundResidency.activeMin,
                      foregroundResidency.runsInWindow,
                    )
                  : `${foregroundResidency.foregroundPct}% of session in front · not graded`
              }
              rating={foregroundResidency.rating}
              t={t}
            />
          ) : null}
          {backgroundRecovery ? (
            <AxisPill
              fixed
              label="RETURN RECOVERY"
              value={backgroundRecovery.score == null ? "—" : String(backgroundRecovery.score)}
              sub={
                backgroundRecovery.p75Ms == null
                  ? "background the app and come back to measure"
                  : `p75 ${backgroundRecovery.p75Ms}ms to resume · ${backgroundRecovery.returnCount} returns`
              }
              rating={backgroundRecovery.rating}
              t={t}
            />
          ) : null}
          {/* NOT GRADED — rotating the phone and switching to dark mode are
            * the person's doing. The rate is shown; no verdict is. */}
          {dimensionChurn ? (
            <AxisPill
              fixed
              label="ROTATION CHURN"
              value={dimensionChurn.perHour == null ? "—" : `${dimensionChurn.perHour}/hr`}
              sub={
                dimensionChurn.perHour == null
                  ? warmingWindowSub(
                      dimensionChurn.activeMin,
                      dimensionChurn.runsInWindow,
                      dimensionChurn.count > 0
                        ? `${dimensionChurn.count} size changes`
                        : "",
                    )
                  : `${dimensionChurn.count} size changes · not graded`
              }
              rating={dimensionChurn.rating}
              t={t}
            />
          ) : null}
          {appearanceChurn ? (
            <AxisPill
              fixed
              label="THEME CHURN"
              value={appearanceChurn.perHour == null ? "—" : `${appearanceChurn.perHour}/hr`}
              sub={
                appearanceChurn.perHour == null
                  ? warmingWindowSub(
                      appearanceChurn.activeMin,
                      appearanceChurn.runsInWindow,
                      appearanceChurn.count > 0
                        ? `${appearanceChurn.count} theme changes`
                        : "",
                    )
                  : `${appearanceChurn.count} theme changes · not graded`
              }
              rating={appearanceChurn.rating}
              t={t}
            />
          ) : null}
          {keyboardLatency ? (
            <AxisPill
              fixed
              label="KEYBOARD"
              value={keyboardLatency.score == null ? "—" : String(keyboardLatency.score)}
              sub={
                keyboardLatency.rating === "not-available"
                  ? "Keyboard API is not available in this host"
                  : keyboardLatency.p75Ms == null
                  ? "open a keyboard to measure"
                  : `p75 ${keyboardLatency.p75Ms}ms show/hide · ${keyboardLatency.count} transitions`
              }
              rating={keyboardLatency.rating}
              t={t}
            />
          ) : null}
          {/* ── Error hygiene ─────────────────────────────────────────────── */}
          {/* NOT GRADED — the OS decides when to warn, and it decides largely
            * on how much memory THIS DEVICE has. The count is shown; the app's
            * own footprint is graded by the memory axes instead. */}
          {memoryWarnings ? (
            <AxisPill
              fixed
              label="MEMORY WARNINGS"
              value={
                memoryWarnings.rating === "not-available"
                  ? "—"
                  : String(memoryWarnings.count)
              }
              sub={
                memoryWarnings.rating === "not-available"
                  ? "memory warning events are not exposed in this host"
                  : `in ${memoryWarnings.windowMin} min · not graded`
              }
              rating={memoryWarnings.rating}
              t={t}
            />
          ) : null}
          {unhandledErrors ? (
            <AxisPill
              fixed
              label="UNHANDLED ERRORS"
              value={unhandledErrors.score == null ? "—" : String(unhandledErrors.score)}
              sub={
                // Two silences, two sentences, and the second one is OURS to
                // own: a collector that ships on and was switched off by this
                // app says so in the dashboard's own words, never the
                // platform's. Blaming the host for a reading the app declined
                // is the wrong answer to the only question worth asking here.
                unhandledErrors.reasonCode === REASON_OFF_IN_THIS_BUILD
                  ? "it is switched off in this build · remove trackUnhandledErrors: false"
                  : unhandledErrors.rating === "not-available"
                  ? "global error events are not exposed in this host"
                  : unhandledErrors.perHour == null
                  ? warmingWindowSub(
                      unhandledErrors.windowMin,
                      unhandledErrors.runsInWindow,
                      unhandledErrors.count > 0
                        ? `${unhandledErrors.count} errors`
                        : "",
                    )
                  : `${unhandledErrors.perHour}/hr · ${unhandledErrors.count} in ${unhandledErrors.windowMin} min`
              }
              rating={unhandledErrors.rating}
              t={t}
            />
          ) : null}
          {promiseRejections ? (
            <AxisPill
              fixed
              label="PROMISE REJECTIONS"
              value={promiseRejections.score == null ? "—" : String(promiseRejections.score)}
              sub={
                promiseRejections.reasonCode === REASON_OFF_IN_THIS_BUILD
                  ? "it is switched off in this build · remove trackUnhandledErrors: false"
                  : promiseRejections.rating === "not-available"
                  ? "promise rejection events are not exposed in this host"
                  : promiseRejections.perHour == null
                  ? "warming up (or this runtime exposes no rejection event)"
                  : `${promiseRejections.perHour}/hr · ${promiseRejections.count} in ${promiseRejections.windowMin} min`
              }
              rating={promiseRejections.rating}
              t={t}
            />
          ) : null}
          {rejectionPressure ? (
            <AxisPill
              fixed
              label="REJECTION PRESSURE"
              value={rejectionPressure.score == null ? "—" : String(rejectionPressure.score)}
              sub={
                rejectionPressure.rating === "not-available"
                  ? "promise rejection events are not exposed in this host"
                  : rejectionPressure.perHour == null
                    ? "warming up · late handling is not distinguishable on Hermes"
                    : `${rejectionPressure.perHour}/foreground hr · ${rejectionPressure.unhandled ?? "none"} unhandled · late handled: none`
              }
              rating={rejectionPressure.rating}
              t={t}
            />
          ) : null}
          {upstreamCache ? (
            <AxisPill
              fixed
              label="UPSTREAM CACHE"
              value={upstreamCache.score == null ? "—" : String(upstreamCache.score)}
              sub={
                upstreamCache.hitPct == null
                  ? `${upstreamCache.checked}/5 declared dependency cache verdicts · warming up`
                  : `${upstreamCache.hitPct}% hits · ${upstreamCache.checked} checked`
              }
              rating={upstreamCache.rating}
              t={t}
            />
          ) : null}
          {backgroundWork ? (
            <AxisPill
              fixed
              label="BACKGROUND WORK"
              value={backgroundWork.score == null ? "—" : String(backgroundWork.score)}
              sub={
                backgroundWork.score == null
                  ? `${backgroundWork.runs}/5 runs · ${backgroundWork.unattachedSystems} unattached systems · warming up`
                  : `${backgroundWork.runs} runs · ${backgroundWork.failed} failed · ${backgroundWork.unattachedSystems} unattached systems`
              }
              rating={backgroundWork.rating}
              t={t}
            />
          ) : null}
          {/* swallowedErrors — errors the app caught and logged rather than
              crashed on, off the SAME console chain as leakWatch. The web
              meter page has always listed this for RN; the panel never drew
              it, so the two surfaces disagreed about what this kit measures.
              Same two shapes as leakWatch: the unmeasurable sentinel carries
              only `measurable`, and it must say so rather than promise a
              score that cannot come. */}
          {swallowedErrors ? (
            "measurable" in swallowedErrors ? (
              <AxisPill
                fixed
                label="SWALLOWED ERRORS"
                value="—"
                sub="no honest way to count caught errors here (console chain not installed)"
                rating="not-available"
                t={t}
              />
            ) : (
              <AxisPill
                fixed
                label="SWALLOWED ERRORS"
                value={String(swallowedErrors.score)}
                sub={swallowedErrors.caption}
                rating={swallowedErrors.rating}
                t={t}
              />
            )
          ) : null}
          {/* leakWatch — the HOST app leaking traces/secrets/PII to its own
              users, observed off the SAME console.error chain. Counts + category
              words only; we NEVER surface the matched content. Reads "we did not
              observe this", never "you are protected". Absent while warming. */}
          {leakWatch ? (
            "measurable" in leakWatch ? (
              <AxisPill
                fixed
                label="LEAK WATCH"
                value="—"
                sub="no honest way to observe leaks here (console chain not installed)"
                // Not a wait: this build has no console chain to watch, so no
                // score is coming. "pending" promised one.
                rating="not-available"
                t={t}
              />
            ) : (
              <AxisPill
                fixed
                label="LEAK WATCH"
                value={String(leakWatch.score)}
                sub={leakWatch.caption}
                rating={leakWatch.rating}
                t={t}
              />
            )
          ) : null}
          {/* devPosture — whether the app is still wearing its development
              clothes. Reports the development settings we can read; a clean
              tile means none of them were on — NOT that the deployment is
              hardened. Counts + setting NAMES only; never an env value or
              config string. Frozen at startup. Always present on RN. */}
          {devPosture ? (
            <AxisPill
              fixed
              label="DEV POSTURE"
              value={String(devPosture.score)}
              sub={devPosture.caption}
              rating={devPosture.rating}
              t={t}
            />
          ) : null}
          {/* liveConnections — chat, live screens, presence and streamed
              answers: connections that stay open for minutes. Counts, times
              and reasons only; we never see a single message. ABSENT (no
              pill at all) until this app opens one, so an app with no live
              connections shows nothing here rather than a row of zeros. */}
          {liveConnections ? (
            <AxisPill
              fixed
              label="LIVE CONNECTIONS"
              value={String(liveConnections.score)}
              sub={liveConnections.caption}
              rating={liveConnections.rating}
              t={t}
            />
          ) : null}
          {/* ── Hermes heap / GC (opt-in) and capability probes ───────────── */}
          {heapHeadroom ? (
            <AxisPill
              fixed
              label="HEAP HEADROOM"
              value={String(heapHeadroom.score)}
              sub={`${heapHeadroom.usedPct}% used · ${heapHeadroom.usedMb} of ${heapHeadroom.limitMb} MB`}
              rating={heapHeadroom.rating}
              t={t}
            />
          ) : null}
          {gcPressure ? (
            <AxisPill
              fixed
              label="GC PRESSURE"
              value={String(gcPressure.score)}
              sub={`${gcPressure.gcPct}% since start · ${gcPressure.gcCount} collections`}
              rating={gcPressure.rating}
              t={t}
            />
          ) : null}
          {gcTax ? (
            <AxisPill
              fixed
              label="GC TAX"
              value={String(gcTax.score)}
              sub={`${gcTax.gcPct}% of ${gcTax.windowMin} min · ${gcTax.gcCount} collections`}
              rating={gcTax.rating}
              t={t}
            />
          ) : null}
          {hermesRuntime ? (
            <AxisPill
              fixed
              label="ENGINE"
              value={hermesRuntime.present === 1 ? "HERMES" : "OTHER"}
              sub={
                hermesRuntime.measurable === 0
                  ? "engine not identifiable from JS"
                  : hermesRuntime.present === 1
                    ? "running on Hermes"
                    : "not running on Hermes"
              }
              // The axis says which silence it has; the pill never decides.
              rating={hermesRuntime.rating}
              t={t}
            />
          ) : null}
          {jsiCapability ? (
            <AxisPill
              fixed
              label="JSI"
              value={jsiCapability.present === 1 ? "YES" : "NO"}
              sub={
                jsiCapability.measurable === 0
                  ? "no trustworthy JSI signal"
                  : jsiCapability.present === 1
                    ? "JSI available"
                    : "no JSI in this runtime"
              }
              // A capability fact, not a meter: this pill reports what the
              // runtime has and is deliberately never scored — unless the
              // probe itself could not read, which is the other silence. The
              // axis decides which; the pill renders what it was handed.
              rating={jsiCapability.rating}
              t={t}
            />
          ) : null}
          {/* ── AsyncStorage (opt-in, host-provided only) ─────────────────── */}
          {storageLatency ? (
            <AxisPill
              fixed
              label="STORAGE SPEED"
              value={storageLatency.score == null ? "—" : String(storageLatency.score)}
              sub={
                storageLatency.p75Ms == null
                  ? "warming up"
                  : `p75 ${storageLatency.p75Ms}ms · ${storageLatency.opCount} operations`
              }
              rating={storageLatency.rating}
              t={t}
            />
          ) : null}
          {storageFailures ? (
            <AxisPill
              fixed
              label="STORAGE FAILURES"
              value={storageFailures.score == null ? "—" : String(storageFailures.score)}
              sub={
                storageFailures.failPct == null
                  ? "warming up"
                  : `${storageFailures.failPct}% failed · ${storageFailures.failCount}/${storageFailures.opCount}`
              }
              rating={storageFailures.rating}
              t={t}
            />
          ) : null}
          {/* ── Patch Lag (build exposure window, only-if-present) ──────────
              Appears ONLY when a build stamp was wired (patchLag present),
              exactly like the opt-in axes above — never a warming-up chip.
              HONESTY: the caption reports build AGE only and never implies the
              app is patched/safe. */}
          {patchLag ? (
            <AxisPill
              fixed
              label="PATCH LAG"
              value={patchLag.score == null ? "—" : String(patchLag.score)}
              sub={`build ~${Math.round(patchLag.buildAgeMs / 86_400_000)}d old`}
              rating={patchLag.rating}
              t={t}
            />
          ) : null}
          {/* Drawn whenever there is data OR whenever we have positive evidence
              there never will be. An empty store hidden off the strip is an
              absence, and an absence beside four healthy tiles reads as a
              clean result — which is exactly how a screen mounting hundreds of
              children at once went unseen. A release build now says so. */}
          {state.render.sampleCount > 0 || renderEff.measurable === 0 ? (
            <AxisPill
              fixed
              label="RENDER"
              value={renderEff.score == null ? "—" : String(renderEff.score)}
              sub={
                renderEff.measurable === 0
                  ? "off in release builds"
                  : renderEff.updatesPerMin == null
                    ? "warming up"
                    : `${renderEff.updatesPerMin}/min re-renders${renderEff.wastedCount > 0 ? ` · ${renderEff.wastedCount} wasted` : ""}`
              }
              rating={renderEff.rating}
              t={t}
            />
          ) : null}
        </View>
      </View>

      {/* Detectors */}
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: t.foreground }]}>
            Novel detectors
          </Text>
          <Text style={[styles.sectionCount, { color: t.mutedForeground }]}>
            {state.detectors.length} {state.detectors.length === 1 ? "finding" : "findings"}
          </Text>
        </View>
        <Text style={[styles.sectionSub, { color: t.mutedForeground }]}>
          Ghost mounts · thundering herds · stranded intervals · render storms{onRulePress ? " · tap a finding to jump to its fix" : ""}
        </Text>
        {state.detectors.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={[styles.emptyDot, { backgroundColor: t.good }]} />
            <Text style={[styles.emptyText, { color: t.mutedForeground }]}>
              No anomalies detected yet. Navigate around the app to populate events.
            </Text>
          </View>
        ) : (
          state.detectors.slice(0, 5).map((f, i, arr) => (
            <FindingRow
              key={`${f.kind}-${i}`}
              finding={f}
              t={t}
              last={i === arr.length - 1}
              onRulePress={onRulePress}
            />
          ))
        )}
      </View>

      {/* Circuit map (on-device navigation / interaction integrity) */}
      <CircuitMapCard
        report={state.circuitMap}
        t={t}
        onRulePress={onRulePress}
        tapsObservable={state.circuitTapsObservable}
      />

      {/* Diagnosis — per-screen phase ladders */}
      {state.diagnosis && state.diagnosis.screens.length > 0 ? (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: t.foreground }]}>
              Diagnosis
            </Text>
            {overall ? (
              <View
                style={[
                  styles.scoreChip,
                  {
                    backgroundColor: ratingColor(overall.rating, t) + "1a",
                    borderColor: ratingColor(overall.rating, t) + "55",
                  },
                ]}
              >
                <Text
                  style={[styles.scoreChipText, { color: ratingColor(overall.rating, t) }]}
                >
                  {overall.rating === "insufficient-data"
                    ? "MEASURING"
                    : `${overall.score} · ${overall.scoredScreens}/${overall.totalScreens}`}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.sectionSub, { color: t.mutedForeground }]}>
            {state.diagnosis.screens.length} screen(s) · worst:{" "}
            {state.diagnosis.screens[0].screen} @{" "}
            {Math.round(state.diagnosis.screens[0].totalMs)}ms
            {Array.isArray(state.diagnosis.crossCutting) &&
            state.diagnosis.crossCutting.length > 0
              ? ` · ${state.diagnosis.crossCutting.length} cross-cutting finding(s); top: ${state.diagnosis.crossCutting[0].kind} on ${state.diagnosis.crossCutting[0].name}`
              : ""}
          </Text>
          {/* Additive on-device axes — score quality (do NOT feed Speed score) */}
          <View style={styles.axisRow}>
            <AxisPill
              label="ON BUDGET"
              value={budget?.pct == null ? "—" : `${budget.pct}%`}
              sub={
                budget && budget.pct != null
                  ? `${budget.onBudget}/${budget.total} screens good`
                  : "measuring"
              }
              rating={budget?.rating ?? "pending"}
              t={t}
            />
            <AxisPill
              label="CONFIDENCE"
              value={confidence === "none" ? "—" : confidence.toUpperCase()}
              sub={confidenceCaption}
              rating={confidenceRating}
              t={t}
            />
          </View>
          {state.diagnosis.screens.slice(0, DIAG_SCREEN_CARDS).map((s) => (
            <ScreenDiagCard key={s.screen} s={s} t={t} />
          ))}
          {/* WHAT THIS LIST LEFT OUT. Eight cards were drawn and the rest were
              silently dropped, so a developer with twenty measured screens read
              eight as the whole app. The count is of screens that REPORTED —
              never of screens a navigator declares — so it says how much of
              this list is missing and nothing about how many screens the app
              is supposed to have. */}
          {state.diagnosis.screens.length > DIAG_SCREEN_CARDS ? (
            <Text style={[styles.moreNote, { color: t.mutedForeground }]}>
              Showing {DIAG_SCREEN_CARDS} of {state.diagnosis.screens.length}{" "}
              screens that reported here — {""}
              {state.diagnosis.screens.length - DIAG_SCREEN_CARDS} not listed.
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Aggregates — event / screen / nav / press / api rollups */}
      {rowGroups.length > 0 ? (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: t.foreground }]}>
              Aggregates
            </Text>
            <Text style={[styles.sectionCount, { color: t.mutedForeground }]}>
              {state.rows.length} rows
            </Text>
          </View>
          <Text style={[styles.sectionSub, { color: t.mutedForeground }]}>
            p50 · p95 · max · last (ms) per tracked event, grouped by kind
          </Text>
          {rowGroups.map((g) => {
            const shown = g.items.slice(0, 10);
            return (
              <View key={g.kind}>
                <Text style={[styles.kindLabel, { color: t.mutedForeground }]}>
                  {g.kind}
                </Text>
                {shown.map((it, i) => (
                  <MetricRow
                    key={it.row.key}
                    label={it.name}
                    row={it.row}
                    t={t}
                    isLast={i === shown.length - 1}
                  />
                ))}
                {g.items.length > shown.length ? (
                  <Text style={[styles.moreNote, { color: t.mutedForeground }]}>
                    +{g.items.length - shown.length} more
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {/* Score sparkline */}
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <Sparkline points={sparklinePoints} t={t} />
      </View>

      {/* Diff vs previous snapshot */}
      {state.diff ? (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: t.foreground }]}>
              Since last snapshot
            </Text>
            <Text style={[styles.sectionCount, { color: t.mutedForeground }]}>
              {state.diff.regressions.length}↑ · {state.diff.improvements.length}↓
            </Text>
          </View>
          <Text style={[styles.sectionSub, { color: t.mutedForeground }]}>
            {state.diff.summary}
          </Text>
          {state.diff.regressions.slice(0, 4).map((d) => (
            <View key={"reg-" + d.key} style={styles.diffRow}>
              <Text style={[styles.diffKey, { color: t.foreground }]} numberOfLines={1}>
                {d.key}
              </Text>
              <Text style={[styles.diffDelta, { color: durationColor(d.currP95, t) }]}>
                +{Math.round(d.deltaMs)}ms ({Math.round(d.deltaPct * 100)}%)
              </Text>
            </View>
          ))}
          {state.diff.improvements.slice(0, 3).map((d) => (
            <View key={"imp-" + d.key} style={styles.diffRow}>
              <Text style={[styles.diffKey, { color: t.foreground }]} numberOfLines={1}>
                {d.key}
              </Text>
              <Text style={[styles.diffDelta, { color: t.good }]}>
                {Math.round(d.deltaMs)}ms ({Math.round(d.deltaPct * 100)}%)
              </Text>
            </View>
          ))}
          {state.diff.patternChanges.slice(0, 3).map((pc) => (
            <View key={"pc-" + pc.screen} style={styles.diffRow}>
              <Text style={[styles.diffKey, { color: t.foreground }]} numberOfLines={1}>
                {pc.screen}
              </Text>
              <Text style={[styles.diffDelta, { color: t.mutedForeground }]}>
                {patternLabel(pc.prevPattern)} → {patternLabel(pc.currPattern)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Chronic patterns — same issue recurring across snapshots */}
      {state.chronic.length > 0 ? (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: t.foreground }]}>
              Chronic patterns
            </Text>
            <Text style={[styles.sectionCount, { color: t.mutedForeground }]}>
              {state.chronic.length}
            </Text>
          </View>
          <Text style={[styles.sectionSub, { color: t.mutedForeground }]}>
            Same issue across 3+ recent snapshots — fix these first
          </Text>
          {state.chronic.slice(0, 6).map((c) => (
            <View key={c.screen + "::" + c.pattern} style={styles.diffRow}>
              <Text style={[styles.diffKey, { color: t.foreground }]} numberOfLines={1}>
                {c.screen}
              </Text>
              <Text style={[styles.diffDelta, { color: t.sluggish }]}>
                {patternLabel(c.pattern)} · {c.occurrences}×
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Snapshots */}
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: t.foreground }]}>
            Snapshots
          </Text>
          <View style={styles.actionRow}>
            <Pressable
              onPress={handleShare}
              disabled={sharing}
              style={[styles.saveBtn, { backgroundColor: t.secondary, opacity: sharing ? 0.6 : 1 }]}
            >
              <Text style={[styles.saveBtnLabel, { color: t.foreground }]}>
                {sharing ? "…" : "Share"}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleSnapshot}
              disabled={saving}
              style={[
                styles.saveBtn,
                {
                  backgroundColor: saving ? t.secondary : t.primary,
                  opacity: saving ? 0.6 : 1,
                },
              ]}
            >
              <Text style={[styles.saveBtnLabel, { color: t.background }]}>
                {saving ? "Saving…" : "Save now"}
              </Text>
            </Pressable>
          </View>
        </View>
        <Text style={[styles.sectionSub, { color: t.mutedForeground }]}>
          On-device baseline · {state.snapshots.length === 0 ? "none yet" : `last ${state.snapshots.length}`}
        </Text>
        {state.snapshots.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={[styles.emptyDot, { backgroundColor: t.mutedForeground }]} />
            <Text style={[styles.emptyText, { color: t.mutedForeground }]}>
              Save a snapshot to lock in a baseline. Future runs will diff against it.
            </Text>
          </View>
        ) : (
          state.snapshots.map((s, i, arr) => (
            <View
              key={s.id}
              style={[
                styles.snapshotRow,
                {
                  borderBottomColor: t.border,
                  borderBottomWidth: i === arr.length - 1 ? 0 : 1,
                },
              ]}
            >
              <View style={styles.snapshotLeft}>
                <Text
                  style={[styles.snapshotLabel, { color: t.foreground }]}
                  numberOfLines={1}
                >
                  {s.label}
                </Text>
                <Text style={[styles.snapshotMeta, { color: t.mutedForeground }]}>
                  {s.totalEvents} events · {s.slowScreens} slow{typeof s.score === "number" ? ` · ${s.score}/100` : ""}
                </Text>
              </View>
              <View style={styles.snapshotRight}>
                <Text style={[styles.snapshotTime, { color: t.mutedForeground }]}>
                  {new Date(s.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </Text>
                <Pressable
                  onPress={() => handleDeleteSnapshot(s.id, s.label)}
                  hitSlop={8}
                  style={styles.snapDeleteBtn}
                >
                  <Text style={[styles.snapDeleteLabel, { color: t.mutedForeground }]}>✕</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  sectionTitle: { fontSize: 14, fontWeight: "600" },
  sectionSub: { fontSize: 11, marginBottom: 12 },
  sectionCount: { fontSize: 11, fontWeight: "500" },
  scoreChip: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 100,
    borderWidth: 1,
  },
  scoreChipText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.8 },
  axisRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  // The axis strip WRAPS rather than scrolling sideways. On the narrowest
  // phone two fixed-width pills fit per line and the rest fall to the line
  // below, so every axis is reachable with no swipe gesture at all — which is
  // the point: a horizontal strip with its indicator hidden made the panel
  // look like it carried a third of the readings it actually carries.
  axisWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  axisPill: {
    // LONGHANDS ON PURPOSE — see axisPillFixed below. `flex: 1` means the same
    // thing in Yoga and in CSS, but the fixed variant that layers on top of
    // this one must not mix a shorthand with longhands, so both use longhands.
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 11,
  },
  axisPillFixed: {
    // Never `flex: 0` here: Yoga reads that as "don't grow, don't shrink", but
    // CSS (react-native-web, Expo web, any browser-rendered build) reads it as
    // grow 0 / SHRINK 1 / basis 0%, which overrode the width below and crushed
    // all eighteen tiles into a few pixels each — one character per line.
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: AXIS_PILL_WIDTH,
    width: AXIS_PILL_WIDTH,
    // Belt and braces: the tile stays readable even if a future style lands on
    // top of it and re-enables shrinking.
    minWidth: AXIS_PILL_WIDTH,
  },
  axisPillLabel: { fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },
  axisPillValue: { fontSize: 22, fontWeight: "800", marginTop: 2 },
  axisPillBar: { height: 4, borderRadius: 3, overflow: "hidden", marginTop: 5 },
  axisPillBarFill: { height: "100%", borderRadius: 3 },
  axisPillSub: { fontSize: 9, fontWeight: "500", marginTop: 4 },
  actionRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  phaseRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  phaseLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendCard: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    gap: 12,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { fontSize: 12, fontWeight: "600" },
  phaseDot: { width: 7, height: 7, borderRadius: 4 },
  phaseLabel: { fontSize: 12, fontWeight: "500" },
  phaseValue: { fontSize: 12, fontWeight: "600" },
  emptyState: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
  },
  emptyDot: { width: 10, height: 10, borderRadius: 5 },
  emptyText: { flex: 1, fontSize: 12, lineHeight: 17 },
  findingRow: { paddingVertical: 12 },
  findingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  findingKindChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  findingKindLabel: { fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },
  findingKind: { flex: 1, fontSize: 12, fontWeight: "600" },
  findingMeta: { fontSize: 10, fontWeight: "500" },
  chevron: { fontSize: 16, fontWeight: "600" },
  findingMessage: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  findingFix: { fontSize: 10, fontWeight: "600", marginTop: 6 },
  circuitGraph: { marginBottom: 6 },
  circuitGraphMeta: { fontSize: 10, fontWeight: "600", marginBottom: 6 },
  /** One explanatory sentence under (or instead of) the drawing. */
  circuitHelpLine: { fontSize: 10, lineHeight: 15, marginTop: 4 },
  circuitCanvasScroll: { marginBottom: 4 },
  circuitCanvasContent: { alignItems: "flex-start" },
  /** Absolute-positioned drawing surface: boxes and rotated lines live here. */
  circuitCanvas: { position: "relative" },
  circuitEdgeLine: { position: "absolute", borderRadius: 1 },
  /** Zero-size border triangle — the arrowhead, rotated with its line. */
  circuitEdgeHead: {
    position: "absolute",
    width: 0,
    height: 0,
    backgroundColor: "transparent",
    borderTopWidth: 4,
    borderBottomWidth: 4,
    borderLeftWidth: 7,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderRightWidth: 0,
    borderRightColor: "transparent",
  },
  circuitNode: {
    position: "absolute",
    borderRadius: 7,
    paddingHorizontal: 6,
    justifyContent: "center",
  },
  circuitNodeLabel: { fontSize: 10, fontWeight: "700" },
  circuitNodeMeta: { fontSize: 8, fontWeight: "600", marginTop: 1 },
  circuitLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    marginTop: 2,
  },
  circuitLegendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  circuitLegendSwatch: { width: 14, height: 9, borderRadius: 3 },
  circuitLegendLabel: { fontSize: 9, fontWeight: "600" },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 100,
  },
  saveBtnLabel: { fontSize: 11, fontWeight: "600" },
  snapshotRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  snapshotLeft: { flex: 1, paddingRight: 12 },
  snapshotLabel: { fontSize: 12, fontWeight: "600", marginBottom: 2 },
  snapshotMeta: { fontSize: 10 },
  snapshotTime: { fontSize: 10, fontWeight: "500" },
  snapshotRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  snapDeleteBtn: { paddingHorizontal: 4, paddingVertical: 2 },
  snapDeleteLabel: { fontSize: 13, fontWeight: "700" },
  diffRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 5,
  },
  diffKey: { fontSize: 11, flex: 1, paddingRight: 12 },
  diffDelta: { fontSize: 11, fontWeight: "600" },
  sparkEmpty: { fontSize: 12, lineHeight: 17, marginTop: 8 },
  sparkDelta: { fontSize: 11, fontWeight: "600" },
  barsRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
    marginTop: 12,
  },
  barCol: { flex: 1, alignItems: "center", gap: 4 },
  barTrack: { width: "100%", justifyContent: "flex-end" },
  bar: { width: "100%", borderRadius: 4 },
  barLabel: { fontSize: 9 },

  // Status card
  statusGrid: { flexDirection: "row", gap: 12, marginTop: 10 },
  statusCell: { flex: 1 },
  statusValue: { fontSize: 18, fontWeight: "700" },
  statusLabel: {
    fontSize: 10,
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  // "Measurements dropped" — rendered only when the server refused rows, so it
  // never occupies space on a healthy app.
  dropRow: { marginTop: 12 },
  dropLabel: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  dropValue: { fontSize: 13, fontWeight: "600", marginTop: 3 },

  // Frame sampler
  frameStatsRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  frameHonesty: { fontSize: 10, lineHeight: 14, marginTop: 10 },
  frameStat: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 10 },
  frameStatValue: { fontSize: 17, fontWeight: "700" },
  frameStatUnit: { fontSize: 10, fontWeight: "500" },
  frameStatLabel: {
    fontSize: 9,
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  jankRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
  },

  // Per-screen diagnosis sub-card
  subCard: { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 10 },
  subCardTitle: { fontSize: 13, fontWeight: "600", flex: 1, paddingRight: 8 },
  worstGap: { fontSize: 10, fontWeight: "600", marginTop: 8 },

  // Aggregate rows
  metricRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 9,
  },
  metricName: { fontSize: 11, fontWeight: "500", flex: 1, paddingRight: 10 },
  metricStats: { flexDirection: "row", gap: 12 },
  metricStat: { alignItems: "center", minWidth: 30 },
  metricStatValue: { fontSize: 12, fontWeight: "600" },
  metricStatLabel: {
    fontSize: 8,
    marginTop: 1,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  kindLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 14,
    marginBottom: 2,
  },
  moreNote: { fontSize: 10, marginTop: 8, fontStyle: "italic" },
});
