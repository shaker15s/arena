/**
 * data/engine.ts — نموذج نطاق حتمي للحسابات والعرض والاختبارات.
 * العمليات الحساسة في المنتج (الحضور، الأدوار، الرسائل، بدء/إغلاق الجلسة)
 * تُنفّذ حصريًا داخل RPCs ذرّية في Supabase؛ هذا الملف لا يمثل حدًا أمنيًا.
 *
 * كل دالة تعدّل نسخة Db ممرّرة ويغطيها اختبار المحرك لتوثيق قواعد العمل.
 */
import {
  AuditEntry, Attendance, Badge, Certificate, Db, GamificationProfile,
  PointEvent, PointReason, Profile, SessionReport, StreakWeek,
  TrainingSession, AppNotification, Batch, Course, Enrollment, Excuse, Role,
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

export function rpcCheckIn(db: Db, userId: string, payload: string, now = Date.now(), lat?: number, lng?: number): CheckInResult {
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
  } else {
    db.attendance.push({ sessionId: session.id, userId, status, checkedInAt: now, method });
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

/** غلق الجلسة: محاسبة الغائبين + بونص الشهر + تحديث الاستريك — في معاملة واحدة */
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

  // بونص شهر الالتزام الكامل
  const month = monthKeyOf(session.startsAt);
  const newBadges: Array<{ userId: string; badge: Badge }> = [];
  students.forEach((st) => {
    const myBatchIds = db.enrollments.filter((e) => e.userId === st.id && e.status === 'active').map((e) => e.batchId);
    const monthSessions = db.sessions.filter((s) => myBatchIds.includes(s.batchId) && s.status === 'closed' && monthKeyOf(s.startsAt) === month);
    const rows = monthSessions.map((s) => attendanceOf(db, s.id, st.id));
    if (monthSessions.length > 0 && rows.every((r) => r && r.status !== 'absent')) {
      const bonus = ruleValue(db, 'points.month_bonus');
      grantPoints(db, {
        userId: st.id, points: bonus, reason: 'month.bonus', refType: 'admin', refId: `month:${month}`,
        idempotencyKey: `month.bonus:${st.id}:${month}`,
      });
    }
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
  const g = gamifOf(db, userId);
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
      notify(db, userId, 'streak', 'كسبت مُجمّد ستريك جديد 🛡️', '4 أسابيع التزام متتالية — أحسنت!');
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
    notify(db, userId, 'streak', 'حمينا ستريكك بمُجمّد 🛡️', 'غبت هذا الأسبوع فاستهلكنا مُجمّدًا تلقائيًا. حضورك الجاي مهم!');
  } else {
    status = 'broken';
    if (g.currentStreakWeeks > 0) {
      notify(db, userId, 'streak', 'انكسر الستريك 💔', `مجهودك محفوظ — أطول سلسلة: ${g.longestStreakWeeks} أسابيع. ابدأ سلسلة جديدة؟`);
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
  const name = badge.nameAr;
  notify(db, userId, 'badge', `شارة جديدة: ${name} 🏅`, badge.descAr);
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
  const g = gamifOf(db, userId);
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

/** تقدم نحو شارة لم تُكسب بعد (يعرض في «أقرب شارة») */
export function badgeProgress(db: Db, userId: string, code: string): number {
  const myAtt = db.attendance.filter((a) => a.userId === userId && a.status !== 'absent');
  const g = gamifGet(db, userId);
  switch (code) {
    case 'first_step': return Math.min(1, myAtt.length);
    case 'consistent': {
      const batchIds = db.enrollments.filter((e) => e.userId === userId && e.status === 'active').map((e) => e.batchId);
      const best = Math.max(0, ...batchIds.map((bid) => courseStreak(db, userId, bid)));
      return Math.min(1, best / 4);
    }
    case 'early_bird': {
      const early = myAtt.filter((a) => {
        const s = db.sessions.find((x) => x.id === a.sessionId);
        return s && a.status === 'present' && a.checkedInAt != null && a.checkedInAt < s.startsAt;
      }).length;
      return Math.min(1, early / 10);
    }
    case 'super_streak': return Math.min(1, g.currentStreakWeeks / 8);
    case 'honest_reviewer': return Math.min(1, db.ratings.filter((r) => r.userId === userId).length / 3);
    case 'pro_expert': return Math.min(1, db.certificates.filter((c) => c.userId === userId).length / 3);
    case 'cert_hunter': return db.certificates.some((c) => c.userId === userId) ? 1 : 0.4;
    default: return 0;
  }
}

/** أقرب شارة قابلة للكسب */
export function nearestBadge(db: Db, userId: string): { badge: Badge; progress: number } | null {
  const notEarned = db.badges.filter((b) => b.active && !db.userBadges.some((u) => u.userId === userId && u.badgeCode === b.code));
  if (notEarned.length === 0) return null;
  let best: { badge: Badge; progress: number } = { badge: notEarned[0], progress: badgeProgress(db, userId, notEarned[0].code) };
  notEarned.forEach((b) => {
    const p = badgeProgress(db, userId, b.code);
    if (p > best.progress) best = { badge: b, progress: p };
  });
  return best;
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
        notify(db, u.id, 'league', `مبروك! صعدت لفئة أعلى 🏆`, 'أسبوع رائع — استمر!');
      } else if (relN > 0 && i >= ranked.length - relN && tier !== 'bronze') {
        outcome = 'relegated';
        g.leagueTier = tiers[ti - 1];
        notify(db, u.id, 'league', 'أسبوع جديد — فرصة جديدة 💪', 'الدوري اتصفّر والجميع يبدأ من جديد.');
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
    status === 'active' ? 'مقعدك محجوز 🎉' : 'انضممت لقائمة الانتظار ⏳',
    status === 'active' ? `مجموعة ${course?.title ?? ''} — سنذكّرك قبل أول محاضرة بساعة.` : `سنُشعرك فور توفر مقعد في ${course?.title ?? ''}.`,
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
      notify(db, batch.instructorId, 'excuse', 'عذر جديد بانتظار مراجعتك', `${st?.fullName ?? 'طالب'} — ${session.title}`);
    }
  }
  return { ok: true };
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
    else db.attendance.push({ sessionId: ex.sessionId, userId: ex.userId, status: 'excused', note: 'عذر مقبول' });
    evaluateStreakWeek(db, ex.userId, weekStartOf(session.startsAt));
    notify(db, ex.userId, 'excuse', 'عذرك مقبول 🛡️', 'الستريك محفوظ — لا توجد نقاط حضور لهذه الجلسة.');
  } else {
    notify(db, ex.userId, 'excuse', 'عذرك مرفوض', note ? `السبب: ${note}` : 'راجع المدرب للتفاصيل.');
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
  notify(db, studentId, 'system', `+${points} نقطة تقدير من ${actor?.fullName ?? 'المدرب'} ⭐`, reason);
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
    notify(db, row.user.id, 'cert', 'شهادتك جاهزة 🎓', `حصلت على شهادة ${course?.title ?? ''} — حمّلها وشاركها!`);
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

export function getMyGamification(db: Db, userId: string): MyGamification {
  const g = gamifGet(db, userId);
  const league = getWeeklyLeague(db, userId, g.leagueTier);
  const me = league.rows.find((r) => r.isYou);
  const wk = db.streakWeeks.find((r) => r.userId === userId && r.weekStart === weekStartOf(Date.now()));
  const lvl = levelOf(db, userId);
  return {
    points: balanceOf(db, userId),
    level: lvl.level, levelInto: lvl.into, levelNextAt: lvl.nextAt,
    streak: g.currentStreakWeeks, longestStreak: g.longestStreakWeeks, freezes: g.freezesHeld,
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
      out.push({ seq, title: `محاضرة ${seq}`, startsAt: cursor.getTime() });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  while (out.length < targetCount) {
    seq += 1;
    const lastTs = out[out.length - 1]?.startsAt ?? Date.now();
    out.push({ seq, title: `محاضرة ${seq}`, startsAt: lastTs + 7 * 86_400_000 });
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
  const batches = db.batches.filter((b) => branchIds.includes(b.branchId));
  const activeBatches = batches.filter((b) => b.status === 'active');
  const students = db.profiles.filter((p) => p.role === 'student' && branchIds.includes(p.branchId ?? ''));
  const att = db.attendance.filter((a) => {
    const s = db.sessions.find((x) => x.id === a.sessionId);
    return s && branchIds.includes(batchOf(db, s.batchId)?.branchId ?? '');
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
    avgAttendance: att.length === 0 ? 0 : Math.round((honored / att.length) * 100),
    certsMonth,
    trend,
  };
}

export function roleHierarchy(): Role[] {
  return ['student', 'volunteer', 'supervisor', 'admin'];
}
