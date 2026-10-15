/**
 * data/engine.ts — نموذج نطاق حتمي للحسابات والعرض والاختبارات.
 * العمليات الحساسة في المنتج (الحضور، الأدوار، الرسائل، بدء/إغلاق الجلسة)
 * تُنفّذ حصريًا داخل RPCs ذرّية في Supabase؛ هذا الملف لا يمثل حدًا أمنيًا.
 *
 * كل دالة تعدّل نسخة Db ممرّرة ويغطيها اختبار المحرك لتوثيق قواعد العمل.
 */
import { getLang, tStatic } from '../i18n/core';
import {
  AuditEntry, Attendance, Badge, Certificate, Db, GamificationProfile,
  PointEvent, PointReason, Profile, SessionReport, StreakWeek,
  TrainingSession, AppNotification, Batch, Course, Enrollment, Excuse, FeedbackSentiment, Role,
} from './types';
import { HARD_CUTOFF_MIN, LEVEL_THRESHOLDS, QR_ROTATION_MS, RULE_DEFS, levelForPoints } from './rules';
import { hashStr, monthKeyOf, uid, weekStartOf } from '../shared/format';
import { backupCode, qrSignature } from '../shared/sha256';

// ───────────────────────────── أدوات عامة ─────────────────────────────

export function ruleValue(db: Db, key: string): number {
  const r = db.rules.find((x) => x.key === key);
  const def = RULE_DEFS.find((d) => d.key === key);
  return typeof r?.value === 'number' ? r.value : (def?.def as number) ?? 0;
}

/** الرصيد = مجموع الدفتر — لا عمود نقاط أبدًا (وثيقة 04 §1) */
export function balanceOf(db: Db, userId: string): number {
  return db.pointEvents.filter((e) => e.userId === userId).reduce((s, e) => s + e.points, 0);
}

export function levelOf(db: Db, userId: string): { level: number; into: number; nextAt: number | null } {
  const pts = balanceOf(db, userId);
  const level = levelForPoints(pts);
  const nextAt = level < LEVEL_THRESHOLDS.length ? LEVEL_THRESHOLDS[level] : null;
  const base = LEVEL_THRESHOLDS[level - 1];
  return { level, into: pts - base, nextAt };
}

export function profileOf(db: Db, userId: string): Profile | undefined {
  return db.profiles.find((p) => p.id === userId);
}

export function courseOf(db: Db, id: string): Course | undefined {
  return db.courses.find((c) => c.id === id);
}

export function batchOf(db: Db, id: string): Batch | undefined {
  return db.batches.find((b) => b.id === id);
}

export function gamifOf(db: Db, userId: string): GamificationProfile {
  let g = db.gamification.find((x) => x.userId === userId);
  if (!g) {
    g = { userId, currentStreakWeeks: 0, longestStreakWeeks: 0, freezesHeld: 1, leagueTier: 'bronze' };
    db.gamification.push(g);
  }
  return g;
}

/**
 * قراءة ملف الجيميفيكيشن دون أي أثر جانبي. تُستخدم في دوال القراءة البحتة
 * التي تُستدعى أثناء الرسم (useMemo) — gamifOf تدفع صفًا جديدًا عند الغياب
 * وهذا تعديلٌ لا يجوز أثناء رسم مكوّن (LOGIC-01). الكتابة الحقيقية للصف
 * تتم خادميًا عبر trigger إنشاء الحساب، فغيابه هنا حالة نادرة نعوّضها افتراضيًا.
 */
export function gamifGet(db: Db, userId: string): GamificationProfile {
  return db.gamification.find((x) => x.userId === userId)
    ?? { userId, currentStreakWeeks: 0, longestStreakWeeks: 0, freezesHeld: 1, leagueTier: 'bronze' };
}

export function notify(db: Db, userId: string, type: AppNotification['type'], title: string, body: string) {
  db.notifications.unshift({ id: uid('n'), userId, title, body, type, read: false, createdAt: Date.now() });
}

export function audit(db: Db, actorId: string, action: string, target: string, payload: Record<string, unknown>) {
  const entry: AuditEntry = { id: uid('au'), actorId, action, target, payload, createdAt: Date.now() };
  db.audit.unshift(entry);
}

/** منح نقاط — Idempotent بمفتاح فريد، الضغطة المكررة = نتيجة واحدة */
function grantPoints(db: Db, args: {
  userId: string; points: number; reason: PointReason;
  refType?: PointEvent['refType']; refId?: string; awardedBy?: string | null;
  idempotencyKey: string; createdAt?: number;
}): PointEvent | null {
  if (db.pointEvents.some((e) => e.idempotencyKey === args.idempotencyKey)) return null;
  const ev: PointEvent = {
    id: uid('pe'), userId: args.userId, points: args.points, reasonCode: args.reason,
    refType: args.refType, refId: args.refId, awardedBy: args.awardedBy ?? null,
    idempotencyKey: args.idempotencyKey, createdAt: args.createdAt ?? Date.now(),
  };
  db.pointEvents.push(ev);
  return ev;
}

// ───────────────────────────── الحضور / جلسات ─────────────────────────────

export function sessionsOfBatch(db: Db, batchId: string): TrainingSession[] {
  return db.sessions.filter((s) => s.batchId === batchId).sort((a, b) => a.seq - b.seq);
}

/**
 * Completion is derived from the batch's own sessions and at least one real
 * enrollee (0017): no dependence on courses.sessions_count — editing the
 * course after batch generation must not brick completion.
 */
export function isBatchComplete(db: Db, batchId: string): boolean {
  const batch = batchOf(db, batchId);
  if (!batch || batch.status !== 'completed') return false;
  const sessions = sessionsOfBatch(db, batchId);
  const students = db.enrollments.filter((e) => e.batchId === batchId && e.status === 'active');
  return students.length > 0
    && sessions.length > 0
    && sessions.every((session) => session.status === 'closed');
}

export function attendanceOf(db: Db, sessionId: string, userId: string): Attendance | undefined {
  return db.attendance.find((a) => a.sessionId === sessionId && a.userId === userId);
}

export function batchStudents(db: Db, batchId: string): Profile[] {
  const ids = db.enrollments.filter((e) => e.batchId === batchId && e.status === 'active').map((e) => e.userId);
  return db.profiles.filter((p) => ids.includes(p.id));
}

export function seatCounts(db: Db, batchId: string): { taken: number; waitlist: number } {
  const batch = batchOf(db, batchId);
  const rows = db.enrollments.filter((e) => e.batchId === batchId);
  // Students only receive their own enrollment rows. Server aggregates keep
  // capacity accurate without leaking the complete class roster.
  return {
    taken: batch?.enrolledCount ?? rows.filter((e) => e.status === 'active').length,
    waitlist: batch?.waitlistCount ?? rows.filter((e) => e.status === 'waitlist').length,
  };
}

export function myBatches(db: Db, userId: string): Batch[] {
  const ids = db.enrollments.filter((e) => e.userId === userId && e.status === 'active').map((e) => e.batchId);
  return db.batches.filter((b) => ids.includes(b.id));
}

export function instructorBatches(db: Db, instructorId: string): Batch[] {
  return db.batches.filter((b) => b.instructorId === instructorId && b.status !== 'archived');
}

export function canManageCourse(db: Db, courseId: string, userId: string): boolean {
  const user = profileOf(db, userId);
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'supervisor') return true;
  const course = courseOf(db, courseId);
  if (course?.ownerId === userId) return true;
  if (db.courseRoles?.some((r) => r.courseId === courseId && r.userId === userId && ['owner', 'organizer', 'coordinator'].includes(r.role))) {
    return true;
  }
  return db.batches.some((b) => b.courseId === courseId && b.instructorId === userId && b.status !== 'archived');
}

export function courseOrganizers(db: Db, courseId: string): Profile[] {
  const userIds = db.courseRoles?.filter((r) => r.courseId === courseId).map((r) => r.userId) ?? [];
  const course = courseOf(db, courseId);
  if (course?.ownerId && !userIds.includes(course.ownerId)) {
    userIds.push(course.ownerId);
  }
  return db.profiles.filter((p) => userIds.includes(p.id));
}

export function cancelSessionInEngine(db: Db, sessionId: string, reason: string, cancelledBy?: string) {
  const sess = db.sessions.find((s) => s.id === sessionId);
  if (!sess) return;
  sess.status = 'cancelled';
  sess.qrSeed = undefined;
  sess.report = {
    done: '',
    planned: '',
    challenges: reason,
    submittedAt: Date.now(),
  };
  audit(db, cancelledBy ?? 'system', 'cancel_session', sessionId, { reason });
}

export function rescheduleSessionInEngine(db: Db, sessionId: string, startsAt: number, reason?: string) {
  const sess = db.sessions.find((s) => s.id === sessionId);
  if (!sess) return;
  sess.startsAt = startsAt;
  audit(db, 'system', 'reschedule_session', sessionId, { startsAt, reason });
}

export function nextSessionForUser(db: Db, userId: string): TrainingSession | undefined {
  const ids = db.enrollments.filter((e) => e.userId === userId && e.status === 'active').map((e) => e.batchId);
  return db.sessions
    .filter((s) => ids.includes(s.batchId) && s.status !== 'closed' && s.startsAt > Date.now() - 2 * 3_600_000)
    .sort((a, b) => a.startsAt - b.startsAt)[0];
}

export function liveSessionForStudent(db: Db, userId: string): TrainingSession | undefined {
  const live = db.sessions.filter((s) => s.status === 'live');
  return live.find((s) => {
    const batch = batchOf(db, s.batchId);
    return batch && db.enrollments.some((e) => e.batchId === batch.id && e.userId === userId && e.status === 'active');
  });
}

// ───────────────────────────── QR الدوّار ─────────────────────────────

export function qrSlotOf(session: TrainingSession, now: number): number {
  if (!session.startedAt) return 0;
  return Math.max(0, Math.floor((now - session.startedAt) / QR_ROTATION_MS));
}

/**
 * التوكن المعروض حاليًا على شاشة المدرب.
 * يطابق تمامًا خوارزمية الخادم (public._qr_signature): أول 20 حرف hex من SHA-256.
 */
export function currentQrToken(session: TrainingSession, now: number): string {
  const slot = qrSlotOf(session, now);
  const h = qrSignature(session.qrSeed ?? '', session.id, slot);
  return `MSRQ:${session.id}:${slot}:${h}`;
}

function qrTokenValid(session: TrainingSession, slot: number, h: string, now: number): boolean {
  const current = qrSlotOf(session, now);
  if (slot < current - 1 || slot > current) return false; // مهلة رحمة = نافذة سابقة واحدة فقط
  return qrSignature(session.qrSeed ?? '', session.id, slot) === h;
}

/** الكود الاحتياطي 6 أرقام — ثابت طوال الجلسة. يطابق public._backup_code في الخادم. */
export function backupCodeOf(session: TrainingSession): string {
  return backupCode(session.qrSeed ?? '', session.id);
}

// ───────────────────────────── RPC: check-in ─────────────────────────────

export type CheckInResult =
  | { kind: 'ok'; status: 'present' | 'late'; points: number; session: TrainingSession; streakSafe: boolean; already: boolean; newBadges: Array<{ userId: string; badge: Badge }> }
  | { kind: 'already'; session: TrainingSession }
  | { kind: 'expired' }
  | { kind: 'too_late' }
  | { kind: 'no_session' }
  | { kind: 'not_enrolled' }
  | { kind: 'invalid' }
  | { kind: 'location_required' }
  | { kind: 'offsite' };

/** مسافة هافرساين بالمتر — مرآة _haversine_m في الخادم. */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

export function rpcCheckIn(db: Db, userId: string, payload: string, now = Date.now(), lat?: number, lng?: number, deviceFingerprint?: string): CheckInResult {
  const code = payload.trim();
  // ── توثيق التوكن ──
  let session: TrainingSession | undefined;
  let method: Attendance['method'] = 'qr';
  if (code.startsWith('MSRQ:')) {
    const parts = code.split(':');
    if (parts.length !== 4) return { kind: 'invalid' };
    const sid = parts[1];
    const slot = Number(parts[2]);
    const h = parts[3];
    session = db.sessions.find((s) => s.id === sid);
    if (!session || session.status !== 'live') return { kind: 'no_session' };
    if (!qrTokenValid(session, slot, h, now)) return { kind: 'expired' };
  } else if (/^\d{6}$/.test(code)) {
    session = db.sessions.find((s) => s.status === 'live' && s.qrSeed && backupCodeOf(s) === code);
    if (!session) return { kind: 'no_session' };
    method = 'code';
  } else {
    return { kind: 'invalid' };
  }

  // ── Geofence اختياري: يطبَّق فقط على المجموعات المفعّلة ──
  const batch = batchOf(db, session!.batchId);
  if (batch?.geofenceEnabled) {
    if (lat == null || lng == null) return { kind: 'location_required' };
    if (batch.latitude == null || batch.longitude == null) return { kind: 'offsite' };
    if (haversineM(lat, lng, batch.latitude, batch.longitude) > (batch.radiusM ?? 500)) return { kind: 'offsite' };
  }

  // ── صلاحية: منضم للمجموعة؟ ──
  const enrolled = db.enrollments.some((e) => e.batchId === session!.batchId && e.userId === userId && e.status === 'active');
  if (!enrolled) return { kind: 'not_enrolled' };

  // ── Idempotency: مسجل مسبقًا؟ نفس النتيجة بلا نقاط مكررة ──
  const existing = attendanceOf(db, session.id, userId);
  if (existing && existing.status !== 'absent') return { kind: 'already', session };

  // ── النافذة الزمنية ──
  const elapsedMin = (now - (session.startedAt ?? session.startsAt)) / 60_000;
  const lateWindow = ruleValue(db, 'attendance.late_window_min');
  if (elapsedMin > HARD_CUTOFF_MIN) return { kind: 'too_late' };
  const status: 'present' | 'late' = elapsedMin <= lateWindow ? 'present' : 'late';

  // ── الكتابة + المنح في معاملة واحدة ──
  if (existing) {
    existing.status = status;
    existing.checkedInAt = now;
    existing.method = method;
    if (deviceFingerprint) existing.deviceFingerprint = deviceFingerprint;
  } else {
    db.attendance.push({ sessionId: session.id, userId, status, checkedInAt: now, method, deviceFingerprint });
  }
  const pts = status === 'present' ? ruleValue(db, 'points.present') : ruleValue(db, 'points.late');
  grantPoints(db, {
    userId, points: pts,
    reason: `attendance.${status}` as PointReason,
    refType: 'session', refId: session.id,
    idempotencyKey: `attendance:${session.id}:${userId}`,
  });
  const newBadges = evaluateBadges(db, userId);

  return { kind: 'ok', status, points: pts, session, streakSafe: true, already: false, newBadges };
}

/** تسجيل الانصراف وتوثيق مدة بقاء المتدرب الفعلية (Check-out) */
export function rpcCheckOut(db: Db, userId: string, sessionId: string, now = Date.now()): { ok: boolean; error?: string; durationMin?: number } {
  const att = attendanceOf(db, sessionId, userId);
  if (!att || att.status === 'absent') {
    return { ok: false, error: 'not_checked_in' };
  }
  if (att.checkedOutAt) {
    return { ok: true, durationMin: Math.round((att.checkedOutAt - (att.checkedInAt ?? now)) / 60_000) };
  }
  att.checkedOutAt = now;
  const durationMin = Math.round((now - (att.checkedInAt ?? now)) / 60_000);
  return { ok: true, durationMin };
}

// ───────────────────────────── RPC: الجلسات للمدرب ─────────────────────────────

export function rpcStartSession(db: Db, batchId: string, actorId: string): { session: TrainingSession } | { error: string } {
  const batch = batchOf(db, batchId);
  if (!batch) return { error: 'no_batch' };
  const existing = db.sessions.find((s) => s.batchId === batchId && s.status === 'live');
  if (existing) return { session: existing };
  // أقرب جلسة مجدولة تتحول للحالة الحية الآن
  const upcoming = db.sessions
    .filter((s) => s.batchId === batchId && s.status === 'scheduled')
    .sort((a, b) => a.startsAt - b.startsAt)[0];
  if (!upcoming) return { error: 'no_scheduled' };
  upcoming.status = 'live';
  upcoming.startedAt = Date.now();
  upcoming.startsAt = Date.now();
  upcoming.qrSeed = `seed_${upcoming.id}_${hashStr(String(Date.now())).slice(0, 8)}`;
  audit(db, actorId, 'start_session', upcoming.id, { batchId });
  return { session: upcoming };
}

export interface CloseSummary {
  present: number; late: number; absent: number; excused: number; total: number;
  streakOutcomes: Array<{ userId: string; name: string; status: StreakWeek['status']; }>;
  newBadges: Array<{ userId: string; badge: Badge }>;
}

/** غلق الجلسة: محاسبة الغائبين + تحديث الاستريك + تقييم الشارات — في معاملة واحدة */
export function rpcCloseSession(db: Db, sessionId: string, actorId: string, report?: SessionReport): CloseSummary {
  const session = db.sessions.find((s) => s.id === sessionId);
  if (!session || session.status !== 'live') {
    return { present: 0, late: 0, absent: 0, excused: 0, total: 0, streakOutcomes: [], newBadges: [] };
  }
  session.status = 'closed';
  session.closedAt = Date.now();
  if (report) session.report = report;

  const students = batchStudents(db, session.batchId);
  students.forEach((st) => {
    if (!attendanceOf(db, sessionId, st.id)) {
      db.attendance.push({ sessionId, userId: st.id, status: 'absent' });
    }
  });

  // بونص الشهر لا يُمنح عند الإقفال: عقد السيرفر يسوّي «الشهر الماضي» فقط عبر
  // settle_previous_month_bonus (cron masar-month-bonus) — الإقفال هنا يقيّم الشارات فحسب.
  const newBadges: Array<{ userId: string; badge: Badge }> = [];
  students.forEach((st) => {
    newBadges.push(...evaluateBadges(db, st.id));
  });

  const streakOutcomes = students.map((st) => ({
    userId: st.id,
    name: st.fullName,
    status: evaluateStreakWeek(db, st.id, weekStartOf(session.startsAt)),
  }));

  audit(db, actorId, 'close_session', sessionId, { batchId: session.batchId });

  const rows = db.attendance.filter((a) => a.sessionId === sessionId);
  return {
    present: rows.filter((a) => a.status === 'present').length,
    late: rows.filter((a) => a.status === 'late').length,
    absent: rows.filter((a) => a.status === 'absent').length,
    excused: rows.filter((a) => a.status === 'excused').length,
    total: rows.length,
    streakOutcomes,
    newBadges,
  };
}

/**
 * تسوية بونص الشهر الماضي + شارة نجم الشهر — مرآة `settle_previous_month_bonus`
 * (0006_automation_jobs.sql · cron «masar-month-bonus» — كل ساعتين عند الدقيقة 45).
 * تُنفَّذ عند بداية الشهر التالي فقط؛ الإقفال وحده لا يمنح البونص أبدًا.
 * حدود الشهر بتوقيت القاهرة (UTC+2 ثابت منذ 2016) — بلا اعتماد على timezone الجهاز.
 * تُرجع عدد المستخدمين الذين استلموا البونص في هذه التسوية (0 عند الإعادة).
 */
export function settlePreviousMonthBonus(db: Db, now = Date.now()): number {
  const cairoMonthFloor = (t: number): number => {
    const d = new Date(t + 2 * 3_600_000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 2 * 3_600_000;
  };
  const monthEnd = cairoMonthFloor(now);            // أول الشهر الحالي (القاهرة)
  const monthStart = cairoMonthFloor(monthEnd - 1); // أول الشهر الماضي (القاهرة)
  const md = new Date(monthStart + 2 * 3_600_000);
  const monthKey = `${md.getUTCFullYear()}-${String(md.getUTCMonth() + 1).padStart(2, '0')}`;
  const bonus = ruleValue(db, 'points.month_bonus');

  let granted = 0;
  for (const userId of new Set(db.enrollments.filter((e) => e.status === 'active').map((e) => e.userId))) {
    const batchIds = db.enrollments.filter((e) => e.userId === userId && e.status === 'active').map((e) => e.batchId);
    const monthSessions = db.sessions.filter((s) =>
      batchIds.includes(s.batchId) && s.status === 'closed' && s.startsAt >= monthStart && s.startsAt < monthEnd);
    if (monthSessions.length === 0) continue; // الـSQL: من بلا جلسات الشهر لا يظهر أصلًا
    const honored = monthSessions.every((s) => {
      const r = attendanceOf(db, s.id, userId);
      return r && r.status !== 'absent';
    });
    if (honored && bonus > 0) {
      const ev = grantPoints(db, {
        userId, points: bonus, reason: 'month.bonus', refType: 'admin',
        idempotencyKey: `month.bonus:${userId}:${monthKey}`, createdAt: now,
      });
      if (ev) granted += 1;
    }
    // الـSQL: PERFORM evaluate_user_badges لكل مستخدم ضمن نتيجة التسوية
    evaluateBadges(db, userId);
  }

  // نجم الشهر: أعلى نقاط الشهر داخل كل فرع — الترتيب نقاطًا تنازليًا ثم المعرّف
  // (row_number OVER(PARTITION BY branch_id ORDER BY points DESC, user_id)) ثم نقاط > 0.
  const scores = new Map<string, number>();
  for (const pe of db.pointEvents) {
    if (pe.createdAt < monthStart || pe.createdAt >= monthEnd) continue;
    const p = profileOf(db, pe.userId);
    if (!p || p.role !== 'student' || p.status !== 'active' || !p.branchId) continue;
    scores.set(pe.userId, (scores.get(pe.userId) ?? 0) + pe.points);
  }
  const topByBranch = new Map<string, { userId: string; points: number }>();
  for (const [userId, points] of scores) {
    if (points <= 0) continue;
    const branchId = profileOf(db, userId)!.branchId!;
    const cur = topByBranch.get(branchId);
    if (!cur || points > cur.points || (points === cur.points && userId < cur.userId)) {
      topByBranch.set(branchId, { userId, points });
    }
  }
  for (const winner of topByBranch.values()) {
    // awardBadge تمنع التكرر وتُرسل إشعار «شارة جديدة» — مرآة إدراج month_star + إشعاره في الـSQL
    awardBadge(db, winner.userId, 'month_star');
  }
  return granted;
}

export function rpcManualMark(db: Db, args: {
  sessionId: string; userId: string; status: 'present' | 'late'; reason: string; actorId: string;
}): { ok: boolean; already?: boolean } {
  const session = db.sessions.find((s) => s.id === args.sessionId);
  if (!session) return { ok: false };
  const existing = attendanceOf(db, args.sessionId, args.userId);
  if (existing && existing.status !== 'absent') return { ok: false, already: true };
  if (!args.reason.trim()) return { ok: false };
  if (existing) {
    existing.status = args.status;
    existing.checkedInAt = Date.now();
    existing.method = 'manual';
    existing.note = args.reason;
  } else {
    db.attendance.push({ sessionId: args.sessionId, userId: args.userId, status: args.status, checkedInAt: Date.now(), method: 'manual', note: args.reason });
  }
  const pts = args.status === 'present' ? ruleValue(db, 'points.present') : ruleValue(db, 'points.late');
  grantPoints(db, {
    userId: args.userId, points: pts, reason: `attendance.${args.status}` as PointReason,
    refType: 'session', refId: args.sessionId,
    idempotencyKey: `attendance:${args.sessionId}:${args.userId}`,
  });
  audit(db, args.actorId, 'manual_mark', args.userId, { sessionId: args.sessionId, status: args.status, reason: args.reason });
  evaluateBadges(db, args.userId);
  return { ok: true };
}

// ───────────────────────────── محرك الاستريك (وثيقة 04 §3) ─────────────────────────────

export function evaluateStreakWeek(db: Db, userId: string, weekStart: number): StreakWeek['status'] {
  const myBatchIds = db.enrollments.filter((e) => e.userId === userId && e.status === 'active').map((e) => e.batchId);
  const weekSessions = db.sessions.filter((s) => myBatchIds.includes(s.batchId) && weekStartOf(s.startsAt) === weekStart);
  const closed = weekSessions.filter((s) => s.status === 'closed');
  const g = gamifGet(db, userId);
  const maxFreeze = ruleValue(db, 'streak.freeze_max_hold');

  // تتبع جزئي: ما زالت هناك جلسات في الأسبوع لم تُغلق
  const unsettled = weekSessions.some((s) => s.status !== 'closed');
  const rows = closed.map((s) => attendanceOf(db, s.id, userId));
  const honored = rows.filter((r) => r && r.status !== 'absent').length;
  const absents = closed.filter((s) => {
    const r = attendanceOf(db, s.id, userId);
    return !r || r.status === 'absent';
  });

  // حالات الأسبوع النهائية لاصقة: الكرون السيرفري يقفل كل أسبوع مرة واحدة،
  // والمحاكي يقيّم عند كل غلق جلسة — فنمنع التدهور والعدّ المزدوج لنفس الأسبوع.
  // الترقية الوحيدة المسموحة: frozen/broken ← kept عند زوال كل الغيابات (عذر مقبول/تصحيح).
  const prev = db.streakWeeks.find((r) => r.userId === userId && r.weekStart === weekStart);
  if (prev && prev.status !== 'tracking' && prev.status !== 'pending') {
    if (prev.status === 'kept' || absents.length > 0) return prev.status;
    g.currentStreakWeeks += 1;
    g.longestStreakWeeks = Math.max(g.longestStreakWeeks, g.currentStreakWeeks);
    if (prev.freezeUsed && g.freezesHeld < maxFreeze) g.freezesHeld += 1; // استرداد الدرع المستهلك
    upsertStreakRow(db, { userId, weekStart, status: 'kept', sessionsTotal: closed.length, sessionsHonored: honored, freezeUsed: false });
    return 'kept';
  }

  // الهدف الأسبوعي: بمجرد تحقيق الحد الأدنى من الحضور بلا غياب يُحسم الأسبوع «محفوظ»
  // فورًا (حالة لاصقة لا تتدهور) — حتى لو بقيت جلسات مجدولة في نفس الأسبوع.
  const minPerWeek = Math.max(1, ruleValue(db, 'streak.min_sessions_week') || 1);
  if (closed.length > 0 && absents.length === 0 && honored >= minPerWeek) {
    g.currentStreakWeeks += 1;
    g.longestStreakWeeks = Math.max(g.longestStreakWeeks, g.currentStreakWeeks);
    if (g.currentStreakWeeks % 4 === 0 && g.freezesHeld < maxFreeze) {
      g.freezesHeld += 1;
      notify(db, userId, 'streak', tStatic('notify.streakFreezeTitle'), tStatic('notify.streakFreezeBody'));
    }
    upsertStreakRow(db, { userId, weekStart, status: 'kept', sessionsTotal: closed.length, sessionsHonored: honored, freezeUsed: false });
    return 'kept';
  }

  if (unsettled || closed.length === 0) {
    upsertStreakRow(db, { userId, weekStart, status: 'tracking', sessionsTotal: weekSessions.length || closed.length, sessionsHonored: honored, freezeUsed: false });
    return 'tracking';
  }

  const hasPendingExcuse = absents.some((s) =>
    db.excuses.some((e) => e.sessionId === s.id && e.userId === userId && e.status === 'pending'),
  );

  let status: StreakWeek['status'];
  let freezeUsed = false;
  if (absents.length === 0) {
    status = 'kept';
    g.currentStreakWeeks += 1;
    g.longestStreakWeeks = Math.max(g.longestStreakWeeks, g.currentStreakWeeks);
    if (g.currentStreakWeeks % 4 === 0 && g.freezesHeld < maxFreeze) {
      g.freezesHeld += 1;
      notify(db, userId, 'streak', 'كسبت مُجمّد ستريك جديد 🛡️', '4 أسابيع التزام متتالية — أحسنت!');
    }
  } else if (hasPendingExcuse) {
    status = 'pending';
  } else if (g.freezesHeld > 0) {
    status = 'frozen';
    freezeUsed = true;
    g.freezesHeld -= 1;
    notify(db, userId, 'streak', tStatic('notify.streakShieldTitle'), tStatic('notify.streakShieldBody'));
  } else {
    status = 'broken';
    if (g.currentStreakWeeks > 0) {
      notify(db, userId, 'streak', tStatic('notify.streakBrokenTitle'), tStatic('notify.streakBrokenBody', { weeks: g.longestStreakWeeks }));
    }
    g.currentStreakWeeks = 0;
  }

  upsertStreakRow(db, { userId, weekStart, status, sessionsTotal: closed.length, sessionsHonored: honored, freezeUsed });
  return status;
}

function upsertStreakRow(db: Db, row: StreakWeek) {
  const idx = db.streakWeeks.findIndex((r) => r.userId === row.userId && r.weekStart === row.weekStart);
  if (idx >= 0) db.streakWeeks[idx] = row;
  else db.streakWeeks.push(row);
}

/** ستريك الكورس: محاضرات متتالية داخل باتش واحد */
export function courseStreak(db: Db, userId: string, batchId: string): number {
  const sess = sessionsOfBatch(db, batchId).filter((s) => s.status === 'closed');
  let run = 0;
  for (let i = sess.length - 1; i >= 0; i--) {
    const r = attendanceOf(db, sess[i].id, userId);
    if (r && r.status !== 'absent') run += 1;
    else break;
  }
  return run;
}

// ───────────────────────────── محرك الشارات ─────────────────────────────

function awardBadge(db: Db, userId: string, code: string): Badge | null {
  if (db.userBadges.some((b) => b.userId === userId && b.badgeCode === code)) return null;
  const badge = db.badges.find((b) => b.code === code && b.active);
  if (!badge) return null;
  db.userBadges.push({ userId, badgeCode: code, awardedAt: Date.now() });
  // الاسم/الوصف حسب لغة التطبيق الحالية — كان يرسل العربية دائمًا للمستخدم الإنجليزي.
  const name = getLang() === 'ar' ? badge.nameAr : badge.nameEn;
  notify(db, userId, 'badge', tStatic('notify.badgeUnlockedTitle', { name }),
    getLang() === 'ar' ? badge.descAr : badge.descEn);
  return badge;
}

export function evaluateBadges(db: Db, userId: string): Array<{ userId: string; badge: Badge }> {
  const out: Array<{ userId: string; badge: Badge }> = [];
  const push = (b: Badge | null) => { if (b) out.push({ userId, badge: b }); };

  const myAtt = db.attendance.filter((a) => a.userId === userId && a.status !== 'absent');
  if (myAtt.length >= 1) push(awardBadge(db, userId, 'first_step'));
  if (myAtt.length >= 4) {
    const batchIds = [...new Set(myAtt.map((a) => db.sessions.find((s) => s.id === a.sessionId)?.batchId).filter(Boolean))] as string[];
    if (batchIds.some((bid) => courseStreak(db, userId, bid) >= 4)) push(awardBadge(db, userId, 'consistent'));
  }
  const early = myAtt.filter((a) => {
    const s = db.sessions.find((x) => x.id === a.sessionId);
    return s && a.status === 'present' && a.checkedInAt != null && a.checkedInAt < s.startsAt;
  }).length;
  if (early >= 10) push(awardBadge(db, userId, 'early_bird'));
  const g = gamifGet(db, userId);
  if (g.currentStreakWeeks >= 8) push(awardBadge(db, userId, 'super_streak'));
  // الكمال: شهر كامل بكل محاضراته مع مد 4+ محاضرات
  const months = [...new Set(db.pointEvents.filter((e) => e.userId === userId).map((e) => monthKeyOf(e.createdAt)))];
  const perfect = months.some((m) => {
    const myBatchIds = db.enrollments.filter((e) => e.userId === userId && e.status === 'active').map((e) => e.batchId);
    const sess = db.sessions.filter((s) => myBatchIds.includes(s.batchId) && s.status === 'closed' && monthKeyOf(s.startsAt) === m);
    if (sess.length < 4) return false;
    return sess.every((s) => {
      const r = attendanceOf(db, s.id, userId);
      return r && r.status !== 'absent';
    });
  });
  if (perfect) push(awardBadge(db, userId, 'perfection'));
  const certs = db.certificates.filter((c) => c.userId === userId).length;
  if (certs >= 1) push(awardBadge(db, userId, 'cert_hunter'));
  if (certs >= 3) push(awardBadge(db, userId, 'pro_expert'));
  const ratings = db.ratings.filter((r) => r.userId === userId).length;
  if (ratings >= 3) push(awardBadge(db, userId, 'honest_reviewer'));
  return out;
}

/**
 * تفصيل تقدّم الشارة — **أرقام حقيقية لا تقديرات** (UX-G2).
 *
 * كان العيب: `badgeProgress` كانت تُرجع نسبًا مخترعة (مثلًا `cert_hunter` = 0.4 ثابتة
 * قبل أول شهادة!)، وبعض الشارات بلا حالة إطلاقًا فتُرجع 0% دائمًا. النتيجة: كرت
 * «أقرب شارة» يقول رقمًا غير صحيح، وهو أسوأ من عدم إظهاره.
 *
 * الآن كل شارة تُرجع:
 *   • `current` / `target` — العدّاد الفعلي والهدف (يُعرض «2 من 4»).
 *   • `progress` = current/target مقصوصة داخل [0,1].
 *   • `metric` — اسم المقياس (أسابيع/حضورات/محاضرات/شهادات…) لتعريب الوحدة.
 * وشارات الدوري/الشهر تُحسب من ترتيبك الفعلي في مجموعتك (لا رقم عام).
 */
export type BadgeMetric = 'attendance' | 'weeks' | 'certificates' | 'ratings' | 'feedback' | 'kudos' | 'rank';

export interface BadgeProgressDetail {
  code: string;
  current: number;
  target: number;
  progress: number;
  metric: BadgeMetric;
  /** هل الشارة قابلة للكسب فعلًا الآن (بعضها موسمي/دوري)؟ */
  achievable: boolean;
}

/** أطول سلسلة محاضرات متتالية بحضور غير غياب (بأي مجموعة). */
function bestCourseStreak(db: Db, userId: string): number {
  const batchIds = db.enrollments.filter((e) => e.userId === userId && e.status === 'active').map((e) => e.batchId);
  return batchIds.reduce((best, bid) => Math.max(best, courseStreak(db, userId, bid)), 0);
}

/** عدد الحضورات المبكرة (قبل وقت البداية) — يُستخدم للشارة وللتقدّم معًا. */
function earlyCheckIns(db: Db, userId: string): number {
  return db.attendance.filter((a) => {
    if (a.userId !== userId || a.status !== 'present' || a.checkedInAt == null) return false;
    const s = db.sessions.find((x) => x.id === a.sessionId);
    return Boolean(s && a.checkedInAt < s.startsAt);
  }).length;
}

/** أفضل شهر من ناحية نسبة الحضور (≥4 محاضرات مغلقة) — مقياس شارة «الكمال». */
function bestMonthProgress(db: Db, userId: string): { current: number; target: number; perfect: boolean } {
  const batchIds = db.enrollments.filter((e) => e.userId === userId && e.status === 'active').map((e) => e.batchId);
  const byMonth = new Map<string, { total: number; honored: number }>();
  for (const s of db.sessions) {
    if (!batchIds.includes(s.batchId) || s.status !== 'closed') continue;
    const key = monthKeyOf(s.startsAt);
    const row = byMonth.get(key) ?? { total: 0, honored: 0 };
    row.total += 1;
    const att = attendanceOf(db, s.id, userId);
    if (att && att.status !== 'absent') row.honored += 1;
    byMonth.set(key, row);
  }
  let best = { current: 0, target: 4, perfect: false };
  for (const row of byMonth.values()) {
    if (row.total < 4) continue;
    if (row.total - row.honored === 0) return { current: row.total, target: row.total, perfect: true };
    // ليس شهرًا كاملًا: نعرض أفضل محاولة (المحاضرات المُحضورة من أصل محاضرات الشهر)
    if (row.honored > best.current) best = { current: row.honored, target: Math.max(row.total, 4), perfect: false };
  }
  return best;
}

/** أفضل عدد محاضرات في أسبوع واحد (شارة الماراثون). */
function bestWeekSessions(db: Db, userId: string): number {
  const counts = new Map<number, number>();
  for (const a of db.attendance) {
    if (a.userId !== userId || a.status === 'absent') continue;
    const s = db.sessions.find((x) => x.id === a.sessionId);
    if (!s) continue;
    const wk = weekStartOf(s.startsAt);
    counts.set(wk, (counts.get(wk) ?? 0) + 1);
  }
  return counts.size === 0 ? 0 : Math.max(...counts.values());
}

/** أعذار مقبولة (شرارة المسؤولية): الحضور بعد فترة غياب طويلة ثم العودة. */
function comebackSessions(db: Db, userId: string): number {
  const mine = db.attendance
    .filter((a) => a.userId === userId && a.status !== 'absent')
    .map((a) => ({ a, s: db.sessions.find((x) => x.id === a.sessionId) }))
    .filter((row): row is { a: Attendance; s: TrainingSession } => Boolean(row.s))
    .sort((x, y) => x.s.startsAt - y.s.startsAt);
  let best = 0;
  for (let i = 1; i < mine.length; i++) {
    const gap = mine[i].s.startsAt - mine[i - 1].s.startsAt;
    if (gap >= 14 * 86_400_000) best = Math.max(best, 1);
  }
  return best;
}

/**
 * ترتيب المستخدم في دوري فئته (1 = الأول) وحجم مجموعته.
 * يُبنى على `getWeeklyLeague` نفسها (لا حساب موازٍ) حتى لا يختلف الترتيب في كرت
 * «أقرب شارة» عن الترتيب المعروض في شاشة الدوري — نفس المجموعة، نفس القاعدة.
 */
function leagueStanding(db: Db, userId: string): { rank: number; size: number } {
  const league = getWeeklyLeague(db, userId);
  const size = Math.max(1, league.rows.length);
  const me = league.rows.find((r) => r.isYou);
  return { rank: me?.rank ?? size, size };
}

export function badgeProgressDetail(db: Db, userId: string, code: string): BadgeProgressDetail {
  const g = gamifGet(db, userId);
  const myAtt = db.attendance.filter((a) => a.userId === userId && a.status !== 'absent');
  const certs = db.certificates.filter((c) => c.userId === userId && c.status === 'active').length;
  const ratings = db.ratings.filter((r) => r.userId === userId).length;
  const feedbackCount = db.sessionFeedback.filter((f) => f.userId === userId).length;
  const make = (current: number, target: number, metric: BadgeMetric, achievable = true): BadgeProgressDetail => ({
    code,
    current: Math.max(0, Math.round(current)),
    target: Math.max(1, target),
    progress: Math.max(0, Math.min(1, current / Math.max(1, target))),
    metric,
    achievable,
  });

  switch (code) {
    case 'first_step': return make(myAtt.length, 1, 'attendance');
    case 'consistent': return make(bestCourseStreak(db, userId), 4, 'attendance');
    case 'early_bird': return make(earlyCheckIns(db, userId), 10, 'attendance');
    case 'perfection': {
      const best = bestMonthProgress(db, userId);
      return make(best.current, best.target, 'attendance');
    }
    case 'super_streak': return make(g.currentStreakWeeks, 8, 'weeks');
    case 'streak_12': return make(g.currentStreakWeeks, 12, 'weeks');
    case 'cert_hunter': return make(certs, 1, 'certificates');
    case 'pro_expert': return make(certs, 3, 'certificates');
    case 'honest_reviewer': return make(ratings, 3, 'ratings');
    case 'feedback_star': return make(feedbackCount, 10, 'feedback');
    case 'marathon': return make(bestWeekSessions(db, userId), 5, 'attendance');
    case 'comeback': return make(comebackSessions(db, userId), 1, 'attendance');
    case 'month_star': {
      // نجم الشهر: أعلى نقاط شهر ميلادي في فرعك — نقيس الفارق عن المتصدّر الحالي.
      const month = monthKeyOf(Date.now());
      const branchId = profileOf(db, userId)?.branchId ?? null;
      const rows = db.profiles
        .filter((p) => p.role === 'student' && p.status === 'active' && (branchId == null || p.branchId === branchId))
        .map((p) => ({
          id: p.id,
          xp: db.pointEvents.filter((e) => e.userId === p.id && monthKeyOf(e.createdAt) === month).reduce((sum, e) => sum + e.points, 0),
        }))
        .sort((a, b) => b.xp - a.xp);
      const mine = rows.findIndex((r) => r.id === userId);
      const rank = mine < 0 ? rows.length + 1 : mine + 1;
      const top = rows[0]?.xp ?? 0;
      const myXp = rows.find((r) => r.id === userId)?.xp ?? 0;
      // التقدّم = اقترابي من متصدّر الشهر (1 عندما أتجاوزه/أعدله)
      return make(rank === 1 ? 1 : myXp, Math.max(1, rank === 1 ? 1 : top), 'rank');
    }
    case 'top_scorer': {
      const { rank } = leagueStanding(db, userId);
      return make(rank === 1 ? 1 : 0, 1, 'rank');
    }
    case 'climber': {
      // الصعود لفئة أعلى: التقدّم = موقعي داخل منطقة الترقية (نسبة عدد من هم فوقي).
      const standing = leagueStanding(db, userId);
      const promoSize = Math.max(1, Math.round(standing.size * (ruleValue(db, 'league.promotion_pct') / 100)));
      const inside = standing.rank <= promoSize;
      return make(inside ? 1 : 0, 1, 'rank');
    }
    default: return make(0, 1, 'attendance', false);
  }
}

/** متوافق مع الاسم القديم — يعيد نسبة واحدة (مقصوصة) بلا أي تقدير. */
export function badgeProgress(db: Db, userId: string, code: string): number {
  return badgeProgressDetail(db, userId, code).progress;
}

export interface NearestBadge {
  badge: Badge;
  progress: number;
  current: number;
  target: number;
  metric: BadgeMetric;
  /** كم بقي للوصول (بوحدات المقياس) */
  remaining: number;
}

/**
 * أقرب شارة قابلة للكسب: الأعلى تقدّمًا، وكسر التعادل بالأقل متبقّيًا ثم بالأقدم تعريفًا.
 * تُستبعد الشارات غير القابلة للكسب (موسمية/معطّلة) — بدل أن يُعرض 0% أبدي.
 */
export function nearestBadge(db: Db, userId: string): NearestBadge | null {
  const earned = new Set(db.userBadges.filter((u) => u.userId === userId).map((u) => u.badgeCode));
  const pool = db.badges
    .filter((b) => b.active && !earned.has(b.code))
    .map((b) => ({ badge: b, detail: badgeProgressDetail(db, userId, b.code) }))
    .filter((row) => row.detail.achievable && row.detail.progress < 1);
  if (pool.length === 0) return null;
  pool.sort((a, b) => {
    if (b.detail.progress !== a.detail.progress) return b.detail.progress - a.detail.progress;
    const remainA = a.detail.target - a.detail.current;
    const remainB = b.detail.target - b.detail.current;
    if (remainA !== remainB) return remainA - remainB;
    return a.badge.code.localeCompare(b.badge.code);
  });
  const best = pool[0];
  return {
    badge: best.badge,
    progress: best.detail.progress,
    current: best.detail.current,
    target: best.detail.target,
    metric: best.detail.metric,
    remaining: Math.max(0, best.detail.target - best.detail.current),
  };
}

/** كل الشارات مع تقدّمها (لشاشة الإنجازات) — مرتّبة: المكتسبة ثم الأقرب. */
export function badgeBoard(db: Db, userId: string): Array<{ badge: Badge; earned: boolean; detail: BadgeProgressDetail }> {
  const earned = new Set(db.userBadges.filter((u) => u.userId === userId).map((u) => u.badgeCode));
  return db.badges
    .filter((b) => b.active)
    .map((b) => ({ badge: b, earned: earned.has(b.code), detail: badgeProgressDetail(db, userId, b.code) }))
    .sort((a, b) => Number(b.earned) - Number(a.earned) || b.detail.progress - a.detail.progress || a.badge.code.localeCompare(b.badge.code));
}

// ───────────────────────────── الدوري الأسبوعي ─────────────────────────────

export interface LeagueRow {
  user: Profile; xp: number; rank: number; zone: 'promotion' | 'safe' | 'relegation'; isYou: boolean;
}

export function getWeeklyLeague(db: Db, viewerId: string, tierOverride?: GamificationProfile['leagueTier']) {
  const viewer = profileOf(db, viewerId);
  const g = gamifGet(db, viewerId);
  const tier = tierOverride ?? g.leagueTier;
  const branchId = viewer?.branchId ?? null;
  const weekStart = weekStartOf(Date.now());

  const cohort = db.profiles.filter((p) =>
    p.role === 'student' && (branchId == null || p.branchId === branchId) &&
    gamifGet(db, p.id).leagueTier === tier,
  );
  const promoPct = ruleValue(db, 'league.promotion_pct');
  const relPct = ruleValue(db, 'league.relegation_pct');

  const rows: LeagueRow[] = cohort
    .map((user) => ({
      user,
      xp: db.pointEvents.filter((e) => e.userId === user.id && weekStartOf(e.createdAt) === weekStart).reduce((s, e) => s + e.points, 0),
      rank: 0, zone: 'safe' as const, isYou: user.id === viewerId,
    }))
    .sort((a, b) => b.xp - a.xp)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  const promoN = Math.max(1, Math.ceil((rows.length * promoPct) / 100));
  const relN = Math.floor((rows.length * relPct) / 100);
  rows.forEach((r, i) => {
    if (i < promoN && tier !== 'master') r.zone = 'promotion';
    else if (relN > 0 && i >= rows.length - relN && tier !== 'bronze') r.zone = 'relegation';
  });

  return { tier, rows, promoPct, relPct, weekStart, endsAt: weekStart + 7 * 86_400_000 - 60_000 };
}

/** النجوم الصاعدة: أول 30 يومًا للمستخدم */
export function risingStars(db: Db, viewerId: string): LeagueRow[] {
  const cutoff = Date.now() - 30 * 86_400_000;
  const weekStart = weekStartOf(Date.now());
  const rows = db.profiles
    .filter((p) => p.role === 'student' && p.joinedAt >= cutoff)
    .map((user) => ({
      user,
      xp: db.pointEvents.filter((e) => e.userId === user.id && weekStartOf(e.createdAt) === weekStart).reduce((s, e) => s + e.points, 0),
      rank: 0, zone: 'safe' as const, isYou: user.id === viewerId,
    }))
    .sort((a, b) => b.xp - a.xp);
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

/** إقفال أسبوع الدوري (كرون السبت 23:59 — يشغّله الأدمن يدويًا في الديمو) */
export function simulateWeekClose(db: Db, actorId: string): { moved: number } {
  const tiers: GamificationProfile['leagueTier'][] = ['bronze', 'silver', 'gold', 'ruby', 'master'];
  const weekStart = weekStartOf(Date.now());
  let moved = 0;
  tiers.forEach((tier, ti) => {
    const cohort = db.profiles.filter((p) => p.role === 'student' && gamifOf(db, p.id).leagueTier === tier);
    const ranked = cohort
      .map((u) => ({ u, xp: db.pointEvents.filter((e) => e.userId === u.id && weekStartOf(e.createdAt) === weekStart).reduce((s, e) => s + e.points, 0) }))
      .sort((a, b) => b.xp - a.xp);
    if (ranked.length === 0) return;
    const promoN = Math.max(1, Math.ceil((ranked.length * ruleValue(db, 'league.promotion_pct')) / 100));
    const relN = Math.floor((ranked.length * ruleValue(db, 'league.relegation_pct')) / 100);
    ranked.forEach(({ u, xp }, i) => {
      const g = gamifOf(db, u.id);
      let outcome: 'promoted' | 'stayed' | 'relegated' = 'stayed';
      if (i < promoN && tier !== 'master') {
        outcome = 'promoted';
        g.leagueTier = tiers[ti + 1];
        const b = awardBadge(db, u.id, 'climber');
        if (b) moved++;
        notify(db, u.id, 'league', tStatic('notify.leagueUpTitle'), tStatic('notify.leagueUpBody'));
      } else if (relN > 0 && i >= ranked.length - relN && tier !== 'bronze') {
        outcome = 'relegated';
        g.leagueTier = tiers[ti - 1];
        notify(db, u.id, 'league', tStatic('notify.leagueNewWeekTitle'), tStatic('notify.leagueNewWeekBody'));
      }
      if (i === 0) awardBadge(db, u.id, 'top_scorer');
      db.leagueWeeks.push({ userId: u.id, weekStart, tier, xpWeek: xp, finalRank: i + 1, outcome });
    });
  });
  audit(db, actorId, 'league_week_close', 'system', { moved });
  return { moved };
}

// ───────────────────────────── الانضمام للمجموعة ─────────────────────────────

export function rpcJoinBatch(db: Db, userId: string, batchId: string): { status: Enrollment['status'] } {
  const existing = db.enrollments.find((e) => e.userId === userId && e.batchId === batchId);
  if (existing) return { status: existing.status };
  const batch = batchOf(db, batchId)!;
  const { taken } = seatCounts(db, batchId);
  const status: Enrollment['status'] = taken >= batch.capacity ? 'waitlist' : 'active';
  db.enrollments.push({ userId, batchId, status, joinedAt: Date.now() });
  const course = courseOf(db, batch.courseId);
  notify(db, userId, 'session',
    status === 'active' ? tStatic('notify.seatReservedTitle') : tStatic('notify.waitlistTitle'),
    status === 'active'
      ? tStatic('notify.seatReservedBody', { course: course?.title ?? '' })
      : tStatic('notify.waitlistBody', { course: course?.title ?? '' }),
  );
  return { status };
}

// ───────────────────────────── الأعذار ─────────────────────────────

export function rpcSubmitExcuse(db: Db, userId: string, sessionId: string, reason: string): { ok: boolean; error?: string } {
  const exists = db.excuses.some((e) => e.userId === userId && e.sessionId === sessionId && e.status !== 'rejected');
  if (exists) return { ok: false, error: 'alreadyExcused' };
  const att = attendanceOf(db, sessionId, userId);
  if (att && att.status !== 'absent') return { ok: false, error: 'onlyAbsent' };
  const excuse: Excuse = { id: uid('ex'), userId, sessionId, reason, status: 'pending', createdAt: Date.now() };
  db.excuses.unshift(excuse);
  const session = db.sessions.find((s) => s.id === sessionId);
  if (session) {
    const batch = batchOf(db, session.batchId);
    if (batch) {
      const st = profileOf(db, userId);
      notify(db, batch.instructorId, 'excuse', tStatic('notify.excuseNewTitle'),
    tStatic('notify.excuseNewBody', { student: st?.fullName ?? tStatic('notify.studentFallback'), session: session.title }));
    }
  }
  return { ok: true };
}

// ───────────────── التغذية الراجعة بعد كل محاضرة (D4 — مرآة عقد الخادم) ─────────────────

/** نافذة التغذية الراجعة: من بداية المحاضرة حتى 48 ساعة بعد نهايتها (0035). */
export const FEEDBACK_WINDOW_MIN = 48 * 60;
/** التعديل مسموح خلال 24 ساعة من الإرسال الأول (0035). */
export const FEEDBACK_EDIT_MIN = 24 * 60;

export function sessionEndsAt(s: TrainingSession): number {
  return s.startsAt + s.durationMin * 60_000;
}

/** تغذية راجعة قائمة لجلسة/مستخدم — undefined = لا يوجد. */
export function feedbackOf(db: Db, sessionId: string, userId: string) {
  return db.sessionFeedback.find((f) => f.sessionId === sessionId && f.userId === userId);
}

/** هل «اليوم الكامل» مكتمل: حضور + تغذية راجعة (قواعد اللعبة D4). */
export function fullDayCompleted(db: Db, sessionId: string, userId: string): boolean {
  const att = attendanceOf(db, sessionId, userId);
  return Boolean(att && (att.status === 'present' || att.status === 'late') && feedbackOf(db, sessionId, userId));
}

/**
 * الجلسات التي تنتظر التغذية الراجعة من المستخدم: حضرها، داخل النافذة،
 * ولم يُرسل تغذيته بعد — تُعرض في بانر «اليوم» (خطة الإصلاح §10).
 */
export function pendingFeedbackFor(db: Db, userId: string, now = Date.now()): TrainingSession[] {
  return db.sessions
    .filter((s) => {
      const att = attendanceOf(db, s.id, userId);
      if (!att || (att.status !== 'present' && att.status !== 'late' && att.status !== 'excused')) return false;
      if (now < s.startsAt) return false;
      if (now > sessionEndsAt(s) + FEEDBACK_WINDOW_MIN * 60_000) return false;
      return !feedbackOf(db, s.id, userId);
    })
    .sort((a, b) => b.startsAt - a.startsAt);
}

export interface FeedbackInput {
  sessionId: string;
  understanding: number;
  pace: number;
  clarity: number;
  sentiment: 'excited' | 'clear' | 'confused' | 'tired';
  comment?: string;
  praiseInstructor?: boolean;
  topicsOk?: string[];
  topicsHard?: string[];
}

export type FeedbackResult =
  | { ok: true; already: boolean; points: number; fullDay: boolean }
  | { ok: false; error: 'sessionNotFound' | 'sessionCancelled' | 'tooEarly' | 'windowClosed'
      | 'notEnrolled' | 'notAttended' | 'invalidScores' | 'invalidSentiment' | 'editWindowClosed' };

/**
 * مرآة حتمية لعقد `submit_session_feedback` الخادمي (0035) — للاختبارات والعرض:
 * نفس التحقق (نافذة 48 ساعة، تعديل 24 ساعة، حضور إلزامي، درجات 1–5)،
 * ونفس الدفتر: نقاط `points.feedback` مرة واحدة بمفتاح idempotency.
 */
export function rpcSubmitSessionFeedback(db: Db, userId: string, input: FeedbackInput, now = Date.now()): FeedbackResult {
  const { sessionId, understanding, pace, clarity, sentiment } = input;
  if (understanding < 1 || understanding > 5 || pace < 1 || pace > 5 || clarity < 1 || clarity > 5) {
    return { ok: false, error: 'invalidScores' };
  }
  if (!['excited', 'clear', 'confused', 'tired'].includes(sentiment)) {
    return { ok: false, error: 'invalidSentiment' };
  }
  const session = db.sessions.find((s) => s.id === sessionId);
  if (!session) return { ok: false, error: 'sessionNotFound' };
  if (session.status === 'cancelled') return { ok: false, error: 'sessionCancelled' };
  if (now < session.startsAt) return { ok: false, error: 'tooEarly' };
  if (now > sessionEndsAt(session) + FEEDBACK_WINDOW_MIN * 60_000) return { ok: false, error: 'windowClosed' };

  const att = attendanceOf(db, sessionId, userId);
  const enrolled = db.enrollments.some((e) => e.batchId === session.batchId && e.userId === userId && e.status === 'active');
  const attended = Boolean(att && (att.status === 'present' || att.status === 'late' || att.status === 'excused'));
  if (!attended && !enrolled) return { ok: false, error: 'notEnrolled' };
  if (!attended) return { ok: false, error: 'notAttended' };

  const existing = feedbackOf(db, sessionId, userId);
  const fullDay = Boolean(att && (att.status === 'present' || att.status === 'late'));
  if (existing) {
    if (now > existing.createdAt + FEEDBACK_EDIT_MIN * 60_000) return { ok: false, error: 'editWindowClosed' };
    existing.understanding = understanding;
    existing.pace = pace;
    existing.clarity = clarity;
    existing.sentiment = sentiment;
    existing.comment = input.comment?.trim() ?? '';
    existing.praiseInstructor = Boolean(input.praiseInstructor);
    // التعديل بدون قوائم محاور يُبقي القديم (مرآة COALESCE الخادمية في 0035)
    existing.topicsOk = input.topicsOk ?? existing.topicsOk;
    existing.topicsHard = input.topicsHard ?? existing.topicsHard;
    existing.updatedAt = now;
    return { ok: true, already: true, points: 0, fullDay };
  }

  const fb = {
    id: uid('sf'), sessionId, userId, understanding, pace, clarity, sentiment,
    comment: input.comment?.trim() ?? '', praiseInstructor: Boolean(input.praiseInstructor),
    topicsOk: input.topicsOk ?? [], topicsHard: input.topicsHard ?? [],
    createdAt: now, updatedAt: now,
  };
  db.sessionFeedback.push(fb);
  const pts = Math.round(ruleValue(db, 'points.feedback')) || 5;
  const ev = grantPoints(db, {
    userId, points: pts, reason: 'session.feedback', refType: 'session', refId: sessionId,
    idempotencyKey: `feedback:${sessionId}:${userId}`, createdAt: now,
  });
  return { ok: true, already: false, points: ev ? pts : 0, fullDay };
}

export interface LectureReportView {
  sessionId: string;
  title: string;
  courseTitle: string;
  seq: number;
  objectives: string[];
  topics: string[];
  summary: string;
  attendance: Attendance['status'] | 'unmarked';
  points: number;
  hasFeedback: boolean;
  editableUntil: number | null;
  done: string;
  /** المحاور التي تحتاج توضيحًا (من تغذيتي) */
  topicsHard: string[];
  fullDay: boolean;
}

/**
 * تقرير المحاضرة للطالب محسوبًا محليًا (عرض أوفلاين/اختبارات) —
 * النسخة الخادمية المُصرَّح بها هي `get_lecture_report` (0035).
 */
export function lectureReportFor(db: Db, sessionId: string, userId: string): LectureReportView | null {
  const session = db.sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  const batch = batchOf(db, session.batchId);
  const course = batch ? courseOf(db, batch.courseId) : undefined;
  const content = db.sessionContent.find((c) => c.sessionId === sessionId);
  const att = attendanceOf(db, sessionId, userId);
  const fb = feedbackOf(db, sessionId, userId);
  const points = db.pointEvents
    .filter((e) => e.userId === userId && e.refType === 'session' && e.refId === sessionId)
    .reduce((s, e) => s + e.points, 0);
  return {
    sessionId,
    title: session.title,
    courseTitle: course?.title ?? '',
    seq: session.seq,
    objectives: content?.objectives ?? [],
    topics: content?.topics ?? [],
    summary: content?.summary ?? '',
    attendance: att?.status ?? 'unmarked',
    points,
    hasFeedback: Boolean(fb),
    editableUntil: fb ? fb.createdAt + FEEDBACK_EDIT_MIN * 60_000 : null,
    done: session.report?.done ?? '',
    topicsHard: fb?.topicsHard ?? [],
    fullDay: fullDayCompleted(db, sessionId, userId),
  };
}

export function rpcReviewExcuse(db: Db, excuseId: string, actorId: string, decision: 'accepted' | 'rejected', note?: string): { ok: boolean } {
  const ex = db.excuses.find((e) => e.id === excuseId);
  if (!ex || ex.status !== 'pending') return { ok: false };
  ex.status = decision;
  ex.note = note;
  ex.reviewedBy = actorId;
  const session = db.sessions.find((s) => s.id === ex.sessionId);
  if (decision === 'accepted' && session) {
    // التحويل لمعذور: صفر نقاط لكن الستريك محفوظ (وثيقة F5)
    const att = attendanceOf(db, ex.sessionId, ex.userId);
    if (att) att.status = 'excused';
    else db.attendance.push({ sessionId: ex.sessionId, userId: ex.userId, status: 'excused', note: tStatic('notify.excuseNoteAccepted') });
    evaluateStreakWeek(db, ex.userId, weekStartOf(session.startsAt));
    notify(db, ex.userId, 'excuse', tStatic('notify.excuseAcceptedTitle'), tStatic('notify.excuseAcceptedBody'));
  } else {
    notify(db, ex.userId, 'excuse', tStatic('notify.excuseRejectedTitle'),
    note ? tStatic('notify.excuseRejectedReason', { reason: note }) : tStatic('notify.excuseRejectedFallback'));
  }
  audit(db, actorId, 'review_excuse', excuseId, { decision, note });
  return { ok: true };
}

// ───────────────────────────── تقدير المدرب (كوتا شهرية ضد التضخم) ─────────────────────────────

export function rpcAwardKudos(db: Db, actorId: string, studentId: string, batchId: string, points: number, reason: string): { ok: boolean; left?: number; error?: string } {
  const quota = ruleValue(db, 'kudos.monthly_quota_per_instructor');
  const month = monthKeyOf(Date.now());
  let q = db.kudosQuotas.find((x) => x.instructorId === actorId && x.month === month);
  if (!q) { q = { instructorId: actorId, month, spent: 0 }; db.kudosQuotas.push(q); }
  if (points <= 0 || points > 25) return { ok: false, error: 'range' };
  if (q.spent + points > quota) return { ok: false, error: 'quota', left: quota - q.spent };
  if (!reason.trim()) return { ok: false, error: 'reason' };
  q.spent += points;
  grantPoints(db, {
    userId: studentId, points, reason: 'kudos', refType: 'batch', refId: batchId, awardedBy: actorId,
    idempotencyKey: `kudos:${actorId}:${studentId}:${month}:${q.spent}:${Date.now()}`,
  });
  const actor = profileOf(db, actorId);
  notify(db, studentId, 'system', tStatic('notify.kudosTitle', { points, actor: actor?.fullName ?? tStatic('notify.trainerFallback') }), reason);
  audit(db, actorId, 'award_kudos', studentId, { points, reason, batchId });
  return { ok: true, left: quota - q.spent };
}

// ───────────────────────────── الشهادات ─────────────────────────────

export function attendancePct(db: Db, userId: string, batchId: string): { pct: number; honored: number; total: number } {
  const sess = sessionsOfBatch(db, batchId).filter((s) => s.status === 'closed');
  const total = sess.length;
  if (total === 0) return { pct: 0, honored: 0, total: 0 };
  const honored = sess.filter((s) => {
    const r = attendanceOf(db, s.id, userId);
    return r && r.status !== 'absent';
  }).length;
  return { pct: Math.round((honored / total) * 100), honored, total };
}

export interface IssuanceRow {
  user: Profile; pct: number; eligible: boolean; alreadyIssued: boolean;
}

export function issuanceTable(db: Db, batchId: string): IssuanceRow[] {
  const pctRule = ruleValue(db, 'certificate.min_attendance_pct');
  return batchStudents(db, batchId).map((user) => {
    const { pct } = attendancePct(db, user.id, batchId);
    return {
      user, pct,
      eligible: pct >= pctRule,
      alreadyIssued: db.certificates.some((c) => c.batchId === batchId && c.userId === user.id),
    };
  }).sort((a, b) => b.pct - a.pct);
}

export function rpcIssueCertificates(db: Db, actorId: string, batchId: string): { issued: Certificate[] } {
  const table = issuanceTable(db, batchId);
  const completePts = ruleValue(db, 'points.course_complete');
  const course = courseOf(db, batchOf(db, batchId)!.courseId);
  const issued: Certificate[] = [];
  table.forEach((row) => {
    if (!row.eligible || row.alreadyIssued) return;
    db.certSeq += 1;
    const cert: Certificate = {
      id: uid('cert'), userId: row.user.id, batchId,
      // مرآة محلية للاختبارات فقط — الخادم يولّد سيريالًا عشوائيًا (0005).
      serial: `MSR-${new Date().getFullYear()}-${String(db.certSeq).padStart(6, '0')}`,
      issuedAt: Date.now(),
      status: 'active', reissueCount: 0,
    };
    db.certificates.push(cert);
    issued.push(cert);
    grantPoints(db, {
      userId: row.user.id, points: completePts, reason: 'course.complete', refType: 'batch', refId: batchId,
      idempotencyKey: `course.complete:${batchId}:${row.user.id}`,
    });
    evaluateBadges(db, row.user.id);
    notify(db, row.user.id, 'cert', tStatic('notify.certReadyTitle'), tStatic('notify.certReadyBody', { course: course?.title ?? '' }));
  });
  audit(db, actorId, 'issue_certificates', batchId, { count: issued.length });
  return { issued };
}

export function lookupCertificate(db: Db, serial: string): { cert: Certificate; user: Profile; course: Course; batch: Batch } | null {
  // التحقق العام يرفض أي شهادة غير نشطة (أُلغيت أو أُعيد إصدارها بسيريال جديد) — يطابق verify_certificate.
  const cert = db.certificates.find((c) => c.status === 'active' && c.serial.trim().toUpperCase() === serial.trim().toUpperCase());
  if (!cert) return null;
  const batch = batchOf(db, cert.batchId)!;
  const course = courseOf(db, batch.courseId)!;
  const user = profileOf(db, cert.userId)!;
  return { cert, user, course, batch };
}

/** إلغاء شهادة (مدير فقط) — يطابق public.revoke_certificate في 0020. */
export function rpcRevokeCertificate(db: Db, actorId: string, certificateId: string, reason: string): { ok: boolean; error?: string } {
  if (!reason.trim() || reason.trim().length < 3) return { ok: false, error: 'reason_required' };
  const cert = db.certificates.find((c) => c.id === certificateId);
  if (!cert || cert.status !== 'active') return { ok: false, error: 'not_active' };
  cert.status = 'revoked';
  cert.revokedAt = Date.now();
  cert.revokedBy = actorId;
  cert.revokeReason = reason.trim();
  audit(db, actorId, 'revoke_certificate', certificateId, { reason: reason.trim() });
  return { ok: true };
}

/** إعادة إصدار شهادة ملغاة (مدير فقط) — تطابق public.reissue_certificate في 0020. */
export function rpcReissueCertificate(db: Db, actorId: string, certificateId: string): { ok: boolean; serial?: string; error?: string } {
  const cert = db.certificates.find((c) => c.id === certificateId);
  if (!cert || cert.status !== 'revoked') return { ok: false, error: 'not_revoked' };
  db.certSeq += 1;
  cert.status = 'active';
  cert.serial = `MSR-${new Date().getFullYear()}-${String(db.certSeq).padStart(6, '0')}`;
  cert.revokedAt = undefined;
  cert.revokedBy = undefined;
  cert.revokeReason = undefined;
  cert.reissuedAt = Date.now();
  cert.reissuedBy = actorId;
  cert.reissueCount = (cert.reissueCount ?? 0) + 1;
  audit(db, actorId, 'reissue_certificate', certificateId, { new_serial: cert.serial });
  return { ok: true, serial: cert.serial };
}

// ───────────────────────────── التقييمات ─────────────────────────────

export function rpcSubmitRating(db: Db, userId: string, courseId: string, stars: number, comment?: string): { ok: boolean } {
  if (db.ratings.some((r) => r.userId === userId && r.courseId === courseId)) return { ok: false };
  db.ratings.push({ userId, courseId, stars, comment, createdAt: Date.now() });
  grantPoints(db, {
    userId, points: ruleValue(db, 'points.rating'), reason: 'rating', refType: 'course', refId: courseId,
    idempotencyKey: `rating:${courseId}:${userId}`,
  });
  evaluateBadges(db, userId);
  return { ok: true };
}

export function courseRatingStats(db: Db, courseId: string): { avg: number; count: number } {
  const rows = db.ratings.filter((r) => r.courseId === courseId);
  if (rows.length === 0) return { avg: 0, count: 0 };
  return { avg: Math.round((rows.reduce((s, r) => s + r.stars, 0) / rows.length) * 10) / 10, count: rows.length };
}

// ───────────────────────────── قواعد اللعبة (S49) ─────────────────────────────

export function previewRuleImpact(db: Db, key: string, newValue: number): { affected: number } {
  if (key === 'certificate.min_attendance_pct') {
    const old = ruleValue(db, key);
    if (newValue <= old) return { affected: 0 };
    let affected = 0;
    db.batches.filter((b) => b.status === 'active').forEach((b) => {
      batchStudents(db, b.id).forEach((st) => {
        const { pct } = attendancePct(db, st.id, b.id);
        if (pct >= old && pct < newValue) affected += 1;
      });
    });
    return { affected };
  }
  return { affected: 0 };
}

export function rpcUpdateRule(db: Db, actorId: string, key: string, value: number): { ok: boolean; error?: string } {
  const def = RULE_DEFS.find((d) => d.key === key);
  if (!def) return { ok: false, error: 'unknown' };
  if (value < def.min || value > def.max) return { ok: false, error: 'bounds' };
  const rule = db.rules.find((r) => r.key === key);
  const from = rule?.value ?? def.def;
  if (rule) { rule.value = value; rule.updatedBy = actorId; rule.updatedAt = Date.now(); }
  else db.rules.push({ key, value, scope: 'global', updatedBy: actorId, updatedAt: Date.now() });
  audit(db, actorId, 'admin_update_rule', key, { from, to: value });
  return { ok: true };
}

// ───────────────────────────── المراسلات الجماعية ─────────────────────────────

export function rpcBroadcast(db: Db, actorId: string, scope: { kind: 'all' } | { kind: 'branch'; branchId: string } | { kind: 'batch'; batchId: string }, title: string, body: string): { reached: number } {
  let targets: Profile[] = [];
  if (scope.kind === 'all') {
    targets = db.profiles.filter((p) => p.role === 'student' || p.role === 'volunteer');
  } else if (scope.kind === 'branch') {
    targets = db.profiles.filter((p) => p.branchId === scope.branchId && (p.role === 'student' || p.role === 'volunteer'));
  } else {
    const ids = batchStudents(db, scope.batchId).map((p) => p.id);
    targets = db.profiles.filter((p) => ids.includes(p.id));
  }
  targets.forEach((p) => notify(db, p.id, 'broadcast', title, body));
  audit(db, actorId, 'broadcast', scope.kind, { title, reached: targets.length });
  return { reached: targets.length };
}

// ───────────────────────────── حزمة «نجاحي» لشاشة اليوم ─────────────────────────────

export interface MyGamification {
  points: number;
  level: number; levelInto: number; levelNextAt: number | null;
  streak: number; longestStreak: number; freezes: number;
  leagueTier: GamificationProfile['leagueTier']; leagueRank: number; leagueXp: number; leagueEndsAt: number;
  weekStatus: StreakWeek['status'];
}

/**
 * `streakSnapshot` — لقطة كاملة لحالة الستريك الأسبوعي (UX-G1).
 *
 * لماذا في المحرّك؟ لأن شريط الستريك يحتاج ستة أرقام مرتبطة ببعضها (الهدف الأسبوعي،
 * المُنجَز، الغيابات، موعد حسم الأسبوع، الدروع، والمعلم التالي) وحسابها موزّعًا في
 * الشاشات كان يعطي أرقامًا متناقضة بين شاشة وأخرى. هنا مصدر واحد للحقيقة، ويستطيع
 * الخادم لاحقًا إرجاع نفس الشكل من RPC واحد.
 */
export interface StreakSnapshot {
  weeks: number;
  longest: number;
  freezesHeld: number;
  freezesMax: number;
  /** الحد الأدنى لعدد الجلسات المطلوب أسبوعيًا للحفاظ على السلسلة */
  weekGoal: number;
  /** جلسات مغلقة هذا الأسبوع حضرها المستخدم (بما فيها المتأخر «محسوب») */
  honoredThisWeek: number;
  /** جلسات مغلقة هذا الأسبوع في مجموعات المستخدم */
  closedThisWeek: number;
  /** غيابات هذا الأسبوع (بلا عذر مقبول) */
  absencesThisWeek: number;
  /** نهاية الأسبوع الحالي (لحظة الحسم) */
  weekEndsAt: number;
  /** وقت متبقٍّ بالمللي ثانية قبل حسم الأسبوع */
  msLeft: number;
  status: 'kept' | 'tracking' | 'at_risk' | 'frozen' | 'broken' | 'pending' | 'unknown';
  /** حالة كل يوم من أيام الأسبوع الحالي (U=الأحد … S=السبت) */
  days: Array<{ ts: number; hasSession: boolean; honored: boolean; absent: boolean; isToday: boolean; isFuture: boolean }>;
  /** المعلم القادم (4/8/12/26/52) وتقدّمنا نحوه */
  milestone: { next: number; previous: number; progress: number };
}

const STREAK_MILESTONES = [4, 8, 12, 26, 52];

export function streakSnapshot(db: Db, userId: string, now = Date.now()): StreakSnapshot {
  const g = gamifGet(db, userId);
  const weekStart = weekStartOf(now);
  const weekEndsAt = weekStart + 7 * 86_400_000;
  const myBatchIds = db.enrollments
    .filter((e) => e.userId === userId && e.status === 'active')
    .map((e) => e.batchId);
  const weekSessions = db.sessions.filter(
    (s) => myBatchIds.includes(s.batchId) && weekStartOf(s.startsAt) === weekStart,
  );
  const closed = weekSessions.filter((s) => s.status === 'closed');

  let honoredThisWeek = 0;
  let absencesThisWeek = 0;
  for (const s of closed) {
    const a = attendanceOf(db, s.id, userId);
    if (a && a.status !== 'absent') honoredThisWeek += 1;
    else absencesThisWeek += 1;
  }

  const row = db.streakWeeks.find((r) => r.userId === userId && r.weekStart === weekStart);
  const weekGoal = Math.max(1, ruleValue(db, 'streak.min_sessions_week') || 1);
  const freezesMax = Math.max(0, ruleValue(db, 'streak.freeze_max_hold') || 0);

  // الأيام السبعة: نحسب لكل يوم هل فيه جلسة، وهل حضرها/غاب عنها المستخدم
  const da = new Date(weekStart);
  const days = Array.from({ length: 7 }).map((_, i) => {
    const ts = da.getTime() + i * 86_400_000;
    const daySessions = weekSessions.filter((s) => new Date(s.startsAt).toDateString() === new Date(ts).toDateString());
    let honored = false;
    let absent = false;
    for (const s of daySessions) {
      if (s.status !== 'closed') continue;
      const a = attendanceOf(db, s.id, userId);
      if (a && a.status !== 'absent') honored = true;
      else absent = true;
    }
    return {
      ts,
      hasSession: daySessions.length > 0,
      honored,
      absent,
      isToday: new Date(ts).toDateString() === new Date(now).toDateString(),
      isFuture: ts > now,
    };
  });

  let status: StreakSnapshot['status'] = row?.status ?? 'unknown';
  if (status === 'tracking' || status === 'unknown' || status === 'pending') {
    if (absencesThisWeek > 0) {
      status = 'at_risk'; // الغياب بلا عذر = خطر مباشر على السلسلة (الدرع متاح للتفسير في الواجهة)
    } else if (honoredThisWeek >= weekGoal) {
      status = 'kept';
    } else if (weekSessions.length === 0) {
      status = 'tracking';
    } else {
      status = 'at_risk';
    }
  }

  const next = STREAK_MILESTONES.find((m) => m > g.currentStreakWeeks) ?? STREAK_MILESTONES[STREAK_MILESTONES.length - 1];
  const previous = [...STREAK_MILESTONES].reverse().find((m) => m <= g.currentStreakWeeks) ?? 0;
  const span = Math.max(1, next - previous);
  const progress = Math.min(1, Math.max(0, (g.currentStreakWeeks - previous) / span));

  return {
    weeks: g.currentStreakWeeks,
    longest: g.longestStreakWeeks,
    freezesHeld: g.freezesHeld,
    freezesMax,
    weekGoal,
    honoredThisWeek,
    closedThisWeek: closed.length,
    absencesThisWeek,
    weekEndsAt,
    msLeft: Math.max(0, weekEndsAt - now),
    status,
    days,
    milestone: { next, previous, progress },
  };
}

/**
 * `courseOutline` — تنظيم محاضرات المجموعة في **وحدات** (كورسيرا-style) مع حالة كل
 * محاضرة وتقدّم كل وحدة (UX-C1).
 *
 * لماذا في المحرّك؟ لأن «أين أنا من الكورس؟» سؤال واحد، والإجابة عنه كانت موزّعة:
 * شاشة الرحلة تعرض تسلسلًا مسطّحًا، وشاشة إدارة الكورس تعرض الوحدات، وشاشة التقارير
 * تعرض المحاور — فيظهر للمستخدم ثلاثة أرقام مختلفة لنفس الحقيقة. هنا مصدر واحد:
 *   • الوحدة = `course_modules` إن وُجدت، وإلا وحدة افتراضية تجمع الكل.
 *   • المحاضرات غير المرتبطة بوحدة تُجمَّع في وحدة «محاضرات إضافية».
 *   • لكل محاضرة: الحالة + مؤشر الإتقان (محتوى/تغذية راجعة/تقرير).
 */
export type OutlineSessionStatus = 'done' | 'late' | 'current' | 'locked' | 'excused' | 'absent' | 'cancelled';

export interface OutlineSession {
  id: string;
  seq: number;
  title: string;
  startsAt: number;
  durationMin: number;
  status: OutlineSessionStatus;
  hasContent: boolean;
  hasFeedback: boolean;
  hasReport: boolean;
  points: number;
  reportReady: boolean;
}

export interface OutlineUnit {
  id: string;
  title: string;
  seq: number;
  sessions: OutlineSession[];
  completed: number;
  total: number;
  progress: number;
  /** أول محاضرة قادمة في الوحدة (لفتح الوحدة تلقائيًا في الواجهة) */
  nextSessionId: string | null;
}

export interface CourseOutline {
  units: OutlineUnit[];
  totalSessions: number;
  completedSessions: number;
  progress: number;
  /** الوحدة التي تحتوي المحاضرة الجارية/القادمة */
  activeUnitId: string | null;
  /** المحاضرة القادمة على مستوى الكورس */
  nextSessionId: string | null;
}

export function courseOutline(db: Db, batchId: string, userId: string): CourseOutline {
  const batch = batchOf(db, batchId);
  const sessions = sessionsOfBatch(db, batchId);
  const modules = batch
    ? db.modules.filter((m) => m.courseId === batch.courseId).sort((a, b) => a.seq - b.seq)
    : [];

  const statusOf = (sess: TrainingSession): OutlineSessionStatus => {
    if (sess.status === 'cancelled') return 'cancelled';
    const att = attendanceOf(db, sess.id, userId);
    if (sess.status === 'live') {
      if (!att || att.status === 'absent') return 'current';
      return att.status === 'late' ? 'late' : 'done';
    }
    if (sess.status === 'closed') {
      if (!att || att.status === 'absent') return 'absent';
      if (att.status === 'excused') return 'excused';
      if (att.status === 'late') return 'late';
      return 'done';
    }
    // مجدولة: مفتوحة لو كل ما سبقها محسوم بالحضور/العذر
    const prev = sessions.filter((s) => s.seq < sess.seq);
    const prevDone = prev.every((p) => {
      if (p.status === 'cancelled') return true;
      const a = attendanceOf(db, p.id, userId);
      return p.status === 'closed' && a && a.status !== 'absent';
    });
    return prevDone ? 'current' : 'locked';
  };

  const build = (list: TrainingSession[]): OutlineSession[] => list
    .sort((a, b) => a.seq - b.seq)
    .map((sess) => {
      const points = db.pointEvents
        .filter((e) => e.userId === userId && e.refType === 'session' && e.refId === sess.id)
        .reduce((sum, e) => sum + e.points, 0);
      return {
        id: sess.id,
        seq: sess.seq,
        title: sess.title,
        startsAt: sess.startsAt,
        durationMin: sess.durationMin,
        status: statusOf(sess),
        hasContent: db.sessionContent.some((c) => c.sessionId === sess.id),
        hasFeedback: Boolean(feedbackOf(db, sess.id, userId)),
        hasReport: Boolean(sess.report && (sess.report.done || sess.report.challenges)),
        points,
        reportReady: sess.status === 'closed' && Boolean(lectureReportFor(db, sess.id, userId)),
      };
    });

  const units: OutlineUnit[] = [];
  if (modules.length === 0) {
    const list = build([...sessions]);
    units.push({
      id: 'all',
      title: tStatic('outline.allUnits'),
      seq: 1,
      sessions: list,
      completed: list.filter((s) => s.status === 'done' || s.status === 'late' || s.status === 'excused').length,
      total: list.length,
      progress: list.length ? list.filter((s) => s.status === 'done' || s.status === 'late' || s.status === 'excused').length / list.length : 0,
      nextSessionId: list.find((s) => s.status === 'current')?.id ?? null,
    });
  } else {
    for (const mod of modules) {
      const list = build(sessions.filter((s) => s.moduleId === mod.id));
      if (list.length === 0) continue;
      const done = list.filter((s) => s.status === 'done' || s.status === 'late' || s.status === 'excused').length;
      units.push({
        id: mod.id,
        title: mod.title,
        seq: mod.seq,
        sessions: list,
        completed: done,
        total: list.length,
        progress: list.length ? done / list.length : 0,
        nextSessionId: list.find((s) => s.status === 'current')?.id ?? null,
      });
    }
    const orphan = build(sessions.filter((s) => !s.moduleId || !modules.some((m) => m.id === s.moduleId)));
    if (orphan.length > 0) {
      const done = orphan.filter((s) => s.status === 'done' || s.status === 'late' || s.status === 'excused').length;
      units.push({
        id: 'extra',
        title: tStatic('outline.extraSessions'),
        seq: modules.length + 1,
        sessions: orphan,
        completed: done,
        total: orphan.length,
        progress: orphan.length ? done / orphan.length : 0,
        nextSessionId: orphan.find((s) => s.status === 'current')?.id ?? null,
      });
    }
  }

  const allSessions = units.flatMap((u) => u.sessions);
  const completedSessions = allSessions.filter((s) => s.status === 'done' || s.status === 'late' || s.status === 'excused').length;
  const activeUnit = units.find((u) => u.sessions.some((s) => s.status === 'current')) ?? null;

  return {
    units,
    totalSessions: allSessions.length,
    completedSessions,
    progress: allSessions.length ? completedSessions / allSessions.length : 0,
    activeUnitId: activeUnit?.id ?? (units[0]?.id ?? null),
    nextSessionId: allSessions.find((s) => s.status === 'current')?.id ?? null,
  };
}

/**
 * `courseFeedback` — نظرة واحدة على **كل** تغذية الكورس الراجعة (UX-C2).
 *
 * مرآة محلية لدالة `get_course_feedback` (ترحيل 0036): نفس الأرقام بالضبط حتى
 * يرى المنظّم شيئًا واحدًا سواء كان متصلًا (RPC) أو يعرض من الذاكرة/أوفلاين.
 * **مجهول الهوية 100%**: لا يُعاد أي `userId`، والتعليقات تُعرَض بلا صاحبها.
 */
export interface CourseFeedbackSession {
  sessionId: string;
  batchId: string;
  seq: number;
  title: string;
  startsAt: number;
  status: string;
  responses: number;
  avgUnderstanding: number;
  avgPace: number;
  avgClarity: number;
  praiseCount: number;
  sentiments: Partial<Record<FeedbackSentiment, number>>;
  topicsHard: string[];
  hasReport: boolean;
  /** تعليقات مجهولة الهوية (نص + انطباع + تاريخ) */
  comments: Array<{ comment: string; sentiment: FeedbackSentiment; createdAt: number }>;
}

export interface CourseFeedbackView {
  sessions: CourseFeedbackSession[];
  totals: {
    responses: number;
    sessionsWithFeedback: number;
    sessionsTotal: number;
    avgUnderstanding: number;
    avgPace: number;
    avgClarity: number;
    praiseCount: number;
    missingReports: number;
  };
  sentiments: Partial<Record<FeedbackSentiment, number>>;
  /** المحاور الأكثر احتياجًا لتوضيح عبر الكورس كاملًا (مرتّبة تنازليًا) */
  topicsHard: Array<{ topic: string; count: number }>;
  ratings: { count: number; avg: number; distribution: Record<number, number> };
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const avgOf = (values: number[]) => (values.length === 0 ? 0 : round2(values.reduce((a, b) => a + b, 0) / values.length));

export function courseFeedback(db: Db, courseId: string): CourseFeedbackView {
  const batchIds = new Set(db.batches.filter((b) => b.courseId === courseId).map((b) => b.id));
  const sessions = db.sessions.filter((s) => batchIds.has(s.batchId)).sort((a, b) => a.seq - b.seq);
  const sessionIds = new Set(sessions.map((s) => s.id));
  const feedback = db.sessionFeedback.filter((f) => sessionIds.has(f.sessionId));

  const rows: CourseFeedbackSession[] = sessions.map((sess) => {
    const rowsOfSession = feedback.filter((f) => f.sessionId === sess.id);
    const sentiments: Partial<Record<FeedbackSentiment, number>> = {};
    for (const f of rowsOfSession) sentiments[f.sentiment] = (sentiments[f.sentiment] ?? 0) + 1;
    return {
      sessionId: sess.id,
      batchId: sess.batchId,
      seq: sess.seq,
      title: sess.title,
      startsAt: sess.startsAt,
      status: sess.status,
      responses: rowsOfSession.length,
      avgUnderstanding: avgOf(rowsOfSession.map((f) => f.understanding)),
      avgPace: avgOf(rowsOfSession.map((f) => f.pace)),
      avgClarity: avgOf(rowsOfSession.map((f) => f.clarity)),
      praiseCount: rowsOfSession.filter((f) => f.praiseInstructor).length,
      sentiments,
      topicsHard: Array.from(new Set(rowsOfSession.flatMap((f) => f.topicsHard))),
      hasReport: Boolean(sess.report && (sess.report.done || sess.report.challenges)),
      comments: rowsOfSession
        .filter((f) => f.comment.trim().length > 0)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((f) => ({ comment: f.comment.trim(), sentiment: f.sentiment, createdAt: f.createdAt })),
    };
  });

  const sentiments: Partial<Record<FeedbackSentiment, number>> = {};
  for (const f of feedback) sentiments[f.sentiment] = (sentiments[f.sentiment] ?? 0) + 1;

  const topicCounts = new Map<string, number>();
  for (const f of feedback) {
    for (const topic of new Set(f.topicsHard)) topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
  }

  const ratings = db.ratings.filter((r) => r.courseId === courseId);
  const distribution: Record<number, number> = {};
  for (const r of ratings) distribution[r.stars] = (distribution[r.stars] ?? 0) + 1;

  return {
    sessions: rows,
    totals: {
      responses: feedback.length,
      sessionsWithFeedback: new Set(feedback.map((f) => f.sessionId)).size,
      sessionsTotal: sessions.length,
      avgUnderstanding: avgOf(feedback.map((f) => f.understanding)),
      avgPace: avgOf(feedback.map((f) => f.pace)),
      avgClarity: avgOf(feedback.map((f) => f.clarity)),
      praiseCount: feedback.filter((f) => f.praiseInstructor).length,
      missingReports: sessions.filter((s) => s.status === 'closed' && !(s.report && (s.report.done || s.report.challenges))).length,
    },
    sentiments,
    topicsHard: Array.from(topicCounts.entries())
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic)),
    ratings: {
      count: ratings.length,
      avg: avgOf(ratings.map((r) => r.stars)),
      distribution,
    },
  };
}

/**
 * `courseReportSummary` — الملخص الرقمي الذي يُدرج في تقرير الكورس المكتوب (0037).
 *
 * مرآة محلية لـ`get_course_report_summary`: نفس الأرقام كي تُعرض المسودة بلا شبكة
 * وتظل مطابقة لما يراه المنظّم على السيرفر.
 */
export interface CourseReportSummaryView {
  batches: number;
  sessionsTotal: number;
  sessionsClosed: number;
  students: number;
  certificates: number;
  attendance: { total: number; present: number; late: number; absent: number; excused: number };
  learning: { responses: number; avgUnderstanding: number; avgPace: number; avgClarity: number };
  ratings: { count: number; avg: number };
  missingReports: number;
}

export function courseReportSummary(db: Db, courseId: string): CourseReportSummaryView {
  const batchIds = new Set(db.batches.filter((b) => b.courseId === courseId).map((b) => b.id));
  const sessions = db.sessions.filter((s) => batchIds.has(s.batchId));
  const sessionIds = new Set(sessions.map((s) => s.id));
  const feedback = db.sessionFeedback.filter((f) => sessionIds.has(f.sessionId));
  const attendance = db.attendance.filter((a) => sessionIds.has(a.sessionId));
  const ratings = db.ratings.filter((r) => r.courseId === courseId);

  return {
    batches: batchIds.size,
    sessionsTotal: sessions.length,
    sessionsClosed: sessions.filter((s) => s.status === 'closed').length,
    students: new Set(
      db.enrollments.filter((e) => batchIds.has(e.batchId) && e.status === 'active').map((e) => e.userId),
    ).size,
    // الشهادات مرتبطة بالدفعة لا بالكورس في المخطط المحلي — نعدّ شهادات دفعات الكورس.
    certificates: db.certificates.filter((c) => batchIds.has(c.batchId) && c.status === 'active').length,
    attendance: {
      total: attendance.length,
      present: attendance.filter((a) => a.status === 'present').length,
      late: attendance.filter((a) => a.status === 'late').length,
      absent: attendance.filter((a) => a.status === 'absent').length,
      excused: attendance.filter((a) => a.status === 'excused').length,
    },
    learning: {
      responses: feedback.length,
      avgUnderstanding: avgOf(feedback.map((f) => f.understanding)),
      avgPace: avgOf(feedback.map((f) => f.pace)),
      avgClarity: avgOf(feedback.map((f) => f.clarity)),
    },
    ratings: { count: ratings.length, avg: avgOf(ratings.map((r) => r.stars)) },
    missingReports: sessions.filter((s) => s.status === 'closed' && !(s.report && (s.report.done || s.report.challenges))).length,
  };
}

export function getMyGamification(db: Db, userId: string): MyGamification {
  const g = gamifGet(db, userId);
  const league = getWeeklyLeague(db, userId, g.leagueTier);
  const me = league.rows.find((r) => r.isYou);
  const wk = db.streakWeeks.find((r) => r.userId === userId && r.weekStart === weekStartOf(Date.now()));
  const lvl = levelOf(db, userId);

  const user = profileOf(db, userId);
  const isVolunteer = user?.role === 'volunteer';

  let dynamicStreak = g.currentStreakWeeks;
  if (isVolunteer) {
    const myBatches = instructorBatches(db, userId);
    const myBatchIds = myBatches.map((b) => b.id);
    const myClosedSessions = db.sessions.filter((s) => myBatchIds.includes(s.batchId) && s.status === 'closed');
    dynamicStreak = Math.max(g.currentStreakWeeks, Math.min(myClosedSessions.length, 52));
  } else {
    const myBatchStreaks = db.enrollments
      .filter((e) => e.userId === userId && e.status === 'active')
      .map((e) => courseStreak(db, userId, e.batchId));
    dynamicStreak = Math.max(g.currentStreakWeeks, ...myBatchStreaks, 0);
  }
  const longestStreak = Math.max(g.longestStreakWeeks, dynamicStreak);

  return {
    points: balanceOf(db, userId),
    level: lvl.level, levelInto: lvl.into, levelNextAt: lvl.nextAt,
    streak: dynamicStreak, longestStreak, freezes: g.freezesHeld,
    leagueTier: g.leagueTier, leagueRank: me?.rank ?? 0, leagueXp: me?.xp ?? 0, leagueEndsAt: league.endsAt,
    weekStatus: wk?.status ?? 'tracking',
  };
}

// ───────────────────────────── Muhamakaat الإدارة (CRUD) ─────────────────────────────

export function generateSessionsForBatch(batch: Batch, count: number): Array<{ seq: number; title: string; startsAt: number }> {
  const out: Array<{ seq: number; title: string; startsAt: number }> = [];
  const timeStr = (batch.schedule?.time || '18:00').trim();
  let hh = 18;
  let mm = 0;
  const match = timeStr.match(/(\d{1,2})(?::(\d{2}))?/);
  if (match) {
    hh = parseInt(match[1], 10);
    mm = match[2] ? parseInt(match[2], 10) : 0;
    // i18n-lint:ok — تحليل صيغة وقت عربية قادمة من المستخدم، ليست نص واجهة
    if ((timeStr.includes('م') || timeStr.toLowerCase().includes('pm') || timeStr.includes('مساء')) && hh < 12) {
      hh += 12;
    }
  }
  if (isNaN(hh) || hh < 0 || hh > 23) hh = 18;
  if (isNaN(mm) || mm < 0 || mm > 59) mm = 0;

  const targetCount = Math.max(1, count || 8);
  const startTs = typeof batch.startDate === 'number' && !isNaN(batch.startDate) && batch.startDate > 0
    ? batch.startDate
    : Date.now() + 7 * 86_400_000;
  const cursor = new Date(startTs);
  cursor.setHours(hh, mm, 0, 0);

  const selectedDays = batch.schedule?.days && batch.schedule.days.length > 0
    ? batch.schedule.days
    : [6];

  let seq = 0;
  let guard = 0;
  while (seq < targetCount && guard < 600) {
    guard += 1;
    if (selectedDays.includes(cursor.getDay())) {
      seq += 1;
      out.push({ seq, title: tStatic('notify.sessionTitle', { seq }), startsAt: cursor.getTime() });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  while (out.length < targetCount) {
    seq += 1;
    const lastTs = out[out.length - 1]?.startsAt ?? Date.now();
    out.push({ seq, title: tStatic('notify.sessionTitle', { seq }), startsAt: lastTs + 7 * 86_400_000 });
  }

  return out;
}

export function checkInstructorConflict(db: Db, instructorId: string, days: number[], time: string, excludeBatchId?: string): Batch | null {
  const mine = db.batches.filter((b) => b.instructorId === instructorId && b.id !== excludeBatchId && (b.status === 'active' || b.status === 'scheduled'));
  return mine.find((b) => b.schedule.time === time && b.schedule.days.some((d) => days.includes(d))) ?? null;
}

export function dashboardStats(db: Db, branchId?: string) {
  const branches = db.branches.filter((b) => !branchId || b.id === branchId);
  const branchIds = branches.map((b) => b.id);
  const batches = db.batches.filter((b) => !branchId || branchIds.includes(b.branchId));
  const activeBatches = batches.filter((b) => b.status === 'active' || b.status === 'scheduled');
  const students = db.profiles.filter((p) => p.role === 'student' && (!branchId || branchIds.includes(p.branchId ?? '')));
  const att = db.attendance.filter((a) => {
    const s = db.sessions.find((x) => x.id === a.sessionId);
    return s && (!branchId || branchIds.includes(batchOf(db, s.batchId)?.branchId ?? ''));
  });
  const honored = att.filter((a) => a.status !== 'absent').length;
  const month = monthKeyOf(Date.now());
  const certsMonth = db.certificates.filter((c) => monthKeyOf(c.issuedAt) === month).length;
  // اتجاه 6 أسابيع
  const trend: number[] = [];
  for (let w = 5; w >= 0; w--) {
    const wk = weekStartOf(Date.now() - w * 7 * 86_400_000);
    const rows = att.filter((a) => {
      const s = db.sessions.find((x) => x.id === a.sessionId);
      return s && weekStartOf(s.startsAt) === wk;
    });
    const hon = rows.filter((a) => a.status !== 'absent').length;
    trend.push(rows.length === 0 ? 0 : Math.round((hon / rows.length) * 100));
  }
  return {
    branchesCount: branches.length,
    activeBatches: activeBatches.length,
    students: students.length,
    avgAttendance: att.length === 0 ? (students.length > 0 ? 100 : 0) : Math.round((honored / att.length) * 100),
    certsMonth,
    trend,
  };
}

export function roleHierarchy(): Role[] {
  return ['student', 'volunteer', 'supervisor', 'admin'];
}
