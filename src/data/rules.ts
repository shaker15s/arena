/**
 * data/rules.ts — القيم الافتراضية لقواعد اللعبة (وثيقة 04 §8)
 * كل الأرقام من هنا وليس من كود العميل — وتُظبط لاحقًا من شاشة S49.
 */
import { GamificationRule } from './types';

export interface RuleDef {
  key: string;
  def: number | boolean;
  min: number;
  max: number;
  unit: 'pts' | 'min' | 'pct' | 'count' | 'toggle';
}

export const RULE_DEFS: RuleDef[] = [
  { key: 'points.present', def: 10, min: 5, max: 20, unit: 'pts' },
  { key: 'points.late', def: 7, min: 0, max: 20, unit: 'pts' },
  { key: 'attendance.late_window_min', def: 15, min: 5, max: 30, unit: 'min' },
  { key: 'certificate.min_attendance_pct', def: 75, min: 50, max: 100, unit: 'pct' },
  { key: 'kudos.monthly_quota_per_instructor', def: 200, min: 0, max: 1000, unit: 'pts' },
  { key: 'streak.freeze_max_hold', def: 2, min: 0, max: 5, unit: 'count' },
  { key: 'streak.min_sessions_week', def: 1, min: 1, max: 7, unit: 'count' },
  { key: 'league.promotion_pct', def: 15, min: 5, max: 40, unit: 'pct' },
  { key: 'league.relegation_pct', def: 15, min: 0, max: 40, unit: 'pct' },
  { key: 'points.month_bonus', def: 50, min: 0, max: 200, unit: 'pts' },
  { key: 'points.course_complete', def: 100, min: 0, max: 500, unit: 'pts' },
  { key: 'points.rating', def: 5, min: 0, max: 20, unit: 'pts' },
];

export function defaultRules(): GamificationRule[] {
  return RULE_DEFS.map((d) => ({
    key: d.key,
    value: d.def,
    scope: 'global' as const,
    updatedBy: null,
    updatedAt: Date.now(),
  }));
}

// عتبات المستويات (وثيقة 04 §2.3) — نقاط تراكمية
export const LEVEL_THRESHOLDS = [0, 100, 300, 700, 1500, 3000, 6000, 12000];

export function levelForPoints(points: number): number {
  let lvl = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (points >= LEVEL_THRESHOLDS[i]) lvl = i + 1;
  }
  return lvl;
}

// دورة التوكن الدوّار — ثابتة معماريًا (ليست قاعدة لعبة)
export const QR_ROTATION_MS = 25_000;
// امتداد الجلسة الافتراضي بعد بدئها لقفل التسجيل نهائيًا
export const HARD_CUTOFF_MIN = 30;
