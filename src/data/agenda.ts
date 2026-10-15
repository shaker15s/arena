/**
 * data/agenda.ts — «إيه اللي جاي؟» بمصدر واحد ودقّة حقيقية.
 *
 * لماذا ملف مستقل؟ لأن هذا السؤال يُطرح في عشرات الشاشات (طالب/مدرّب/منظّم)، وكل
 * شاشة كانت تجيبه بطريقتها:
 *   • الطالب: `nextSessionForUser` — كانت تُسقط الجلسة الجارية إن مرّ عليها ساعتان،
 *     وتعتبر الجلسة **الملغاة** «قادمة».
 *   • المدرّب: `VolunteerTodayScreen` كانت تسمّي أقرب جلسة «محاضرة اليوم» حتى لو
 *     بعد ثلاثة أيام، وتستبعد كل جلسة حالتها ليست `scheduled` (أي تُخفي الجارية).
 *   • المنظّم: العدّاد في لوحات المتابعة يخلط «اليوم» بـ«الأسبوع».
 *
 * النتيجة عند المستخدم: «عندي محاضرة بعد ١٠ دقائق ويقولي القادمة بعد ٣ أيام».
 *
 * القواعد الصحيحة (وهي ما يطبّقه هذا الملف):
 *   1. الجلسة **الجارية** أولوية مطلقة، مهما مرّ من وقت (مع وسم `stale` لو تجاوزت
 *      مدّتها + نافذة سماح، حتى تعرف الواجهة أنها معلّقة لا نشطة).
 *   2. الجلسة **الملغاة** و**المغلقة** لا تُعرض أبدًا.
 *   3. الجلسة التي بدأت ولم تُغلق بعد (المدرّب لم يبدأ/لم يُغلق) تبقى «القادمة»
 *      حتى نهاية مدّتها + نافذة سماح — لا تسقط بمجرّد تجاوز وقت البداية.
 *   4. الترتيب بوقت البداية، ثم برقم التسلسل (حالات التعادل).
 *
 * وكل هذا **بلا شبكة وبلا React** ليمكن اختباره بالمحرّك مباشرة.
 */
import {
  Attendance, Batch, Course, Db, TrainingSession,
} from './types';
import { attendanceOf, batchOf, courseOf, sessionsOfBatch } from './engine';
import { HARD_CUTOFF_MIN } from './rules';

/** المدّة الافتراضية لأي محاضرة بلا مدّة مسجّلة (نفس افتراض التطبيق في كل مكان). */
export const DEFAULT_SESSION_MIN = 90;
/** نافذة سماح بعد نهاية المحاضرة تبقى فيها «ذات صلة» في الأجندة. */
export const SESSION_GRACE_MIN = 45;
/** بعد هذه المدّة من نهاية جلسة «جارية» نعتبرها معلّقة (stale) لا نشطة. */
export const STALE_LIVE_MIN = 180;

export type AgendaPhase = 'live' | 'starting' | 'today' | 'tomorrow' | 'upcoming' | 'past';

export interface AgendaItem {
  session: TrainingSession;
  batch: Batch;
  course?: Course;
  startsAt: number;
  endsAt: number;
  /** موجب = لم تبدأ بعد، سالب = بدأت (بالمللي ثانية) */
  msUntilStart: number;
  minutesUntilStart: number;
  phase: AgendaPhase;
  /** جلسة جارية لكن تجاوزت مدّتها + نافذة السماح */
  stale: boolean;
  /** هل يمكن للطالب تسجيل الحضور الآن (حسب بوابة الـQR وقاعدة القطع الصارم)؟ */
  canCheckIn: boolean;
  /** حضور الطالب إن وُجد (undefined للمدرّب/المنظّم) */
  attendance?: Attendance;
}

export interface DayAgenda {
  /** بداية اليوم ونهايته (توقيت الجهاز — نفس مرجع كل الشاشات) */
  dayStart: number;
  dayEnd: number;
  items: AgendaItem[];
  total: number;
  done: number;
  liveNow: number;
  /** المجموع الساعات المتبقية من محاضرات اليوم (للملخص) */
  minutesRemaining: number;
}

export interface NextSessionContext {
  /** القوائم التي تُبنى منها الأجندة: التسجيلات + التدريس + الإدارة */
  batchIds: string[];
}

function endOf(session: TrainingSession): number {
  const minutes = session.durationMin && session.durationMin > 0 ? session.durationMin : DEFAULT_SESSION_MIN;
  return session.startsAt + minutes * 60_000;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function phaseOf(startsAt: number, endsAt: number, now: number): AgendaPhase {
  if (now > endsAt) return 'past';
  const today = startOfDay(now);
  const tomorrow = today + 86_400_000;
  if (startsAt <= now) return 'today';
  if (startsAt - now <= 60 * 60_000) return 'starting';
  if (startsAt < today + 86_400_000) return 'today';
  if (startsAt < tomorrow + 86_400_000) return 'tomorrow';
  return 'upcoming';
}

/**
 * القوائم التي تخصّ المستخدم: التسجيلات النشطة + الدفعات التي يدرّسها +
 * الكورسات التي يديرها. تُستخدم كمرجع واحد لكل الشاشات.
 */
export function relevantBatchIds(db: Db, userId: string): NextSessionContext {
  const enrolled = db.enrollments
    .filter((e) => e.userId === userId && e.status === 'active')
    .map((e) => e.batchId);
  const teaching = db.batches.filter((b) => b.instructorId === userId).map((b) => b.id);
  const managedCourses = new Set(db.courseRoles.filter((r) => r.userId === userId).map((r) => r.courseId));
  const managing = db.batches.filter((b) => managedCourses.has(b.courseId)).map((b) => b.id);
  return { batchIds: Array.from(new Set([...enrolled, ...teaching, ...managing])) };
}

/** يحوّل جلسة إلى عنصر أجندة كامل الحسابات. */
export function agendaItemOf(db: Db, session: TrainingSession, userId: string | null, now: number): AgendaItem {
  const batch = batchOf(db, session.batchId);
  const startsAt = session.startsAt;
  const endsAt = endOf(session);
  const msUntilStart = startsAt - now;
  const stale = session.status === 'live' && now > endsAt + STALE_LIVE_MIN * 60_000;
  // نافذة التسجيل تنتهي بعد HARD_CUTOFF_MIN من بداية المحاضرة (نفس ثابت الخادم).
  const canCheckIn = Boolean(
    batch
    && session.status === 'live'
    && now <= startsAt + HARD_CUTOFF_MIN * 60_000,
  );
  return {
    session,
    batch: batch as Batch,
    course: batch ? courseOf(db, batch.courseId) : undefined,
    startsAt,
    endsAt,
    msUntilStart,
    minutesUntilStart: Math.round(msUntilStart / 60_000),
    phase: phaseOf(startsAt, endsAt, now),
    stale,
    canCheckIn,
    attendance: userId ? attendanceOf(db, session.id, userId) : undefined,
  };
}

/**
 * الأجندة الكاملة للمستخدم (بلا فلاتر زمنية) — الأساس لكل ما تبقّى.
 * مرتّبة زمنيًا، ومستبعدة الجلسات الملغاة والمغلقة.
 */
export function agendaFor(db: Db, userId: string, now: number = Date.now(), batchIds?: string[]): AgendaItem[] {
  const ids = new Set(batchIds ?? relevantBatchIds(db, userId).batchIds);
  return db.sessions
    .filter((s) => ids.has(s.batchId))
    .filter((s) => s.status !== 'cancelled' && s.status !== 'closed')
    .map((s) => agendaItemOf(db, s, userId, now))
    .sort((a, b) => a.startsAt - b.startsAt || a.session.seq - b.session.seq);
}

/**
 * العنصر الذي يجب أن تراه الواجهة الآن:
 *   • جلسة جارية (وليست معلّقة) ⇒ هي.
 *   • جلسة جارية لكن معلّقة (stale) ⇒ لا تُعرض كجارية، ننتقل للتي بعدها.
 *   • الجلسة التي لم تنتهِ بعد (تنتهي في المستقبل) ⇒ هي، حتى لو بدأت بالفعل
 *     لأن الحضور ما زال ممكنًا حتى نافذة القطع.
 *   • غير ذلك ⇒ أول جلسة لم تبدأ بعد.
 */
export function nextAgendaItem(db: Db, userId: string, now: number = Date.now(), batchIds?: string[]): AgendaItem | undefined {
  const items = agendaFor(db, userId, now, batchIds);
  const live = items.find((i) => i.session.status === 'live' && !i.stale);
  if (live) return live;
  const notEnded = items.find((i) => i.endsAt + SESSION_GRACE_MIN * 60_000 >= now);
  if (notEnded) return notEnded;
  return items.find((i) => i.startsAt > now);
}

/** كل جلسات اليوم (بمرجع اليوم المحلي نفسه المستخدم في كل الشاشات). */
export function todayAgenda(db: Db, userId: string, now: number = Date.now(), batchIds?: string[]): DayAgenda {
  const dayStart = startOfDay(now);
  const dayEnd = dayStart + 86_400_000;
  const items = agendaFor(db, userId, now, batchIds)
    .filter((i) => i.startsAt >= dayStart && i.startsAt < dayEnd)
    .sort((a, b) => a.startsAt - b.startsAt);
  const done = items.filter((i) => i.attendance && i.attendance.status !== 'absent').length;
  const liveNow = items.filter((i) => i.session.status === 'live' && !i.stale).length;
  const minutesRemaining = items
    .filter((i) => i.endsAt > now)
    .reduce((sum, i) => sum + Math.max(0, Math.round((i.endsAt - Math.max(now, i.startsAt)) / 60_000)), 0);
  return { dayStart, dayEnd, items, total: items.length, done, liveNow, minutesRemaining };
}

/** نصّ عدّاد دقيق بالدقائق — يُستهلك من الواجهة عبر i18n لا من هنا. */
export function countdownParts(msUntil: number): { days: number; hours: number; minutes: number; overdue: boolean } {
  const overdue = msUntil < 0;
  const abs = Math.abs(msUntil);
  return {
    days: Math.floor(abs / 86_400_000),
    hours: Math.floor((abs % 86_400_000) / 3_600_000),
    minutes: Math.floor((abs % 3_600_000) / 60_000),
    overdue,
  };
}

/**
 * ملخص اليوم الكامل — ما يحتاجه المستخدم ليفهم يومه في ثانية واحدة عند فتح التطبيق.
 * كل رقم محسوب من نفس المصدر أعلاه، بلا أي تقدير تقريبي.
 */
export interface DaySummary {
  next?: AgendaItem;
  today: DayAgenda;
  /** عدد المحاضرات المتبقية بعد اليوم (للإشارة إلى «بعدها») */
  laterCount: number;
  /** تغذية راجعة معلّقة على محاضرات منتهية */
  pendingFeedbackCount: number;
  /** معرّفات المحاضرات التي تنتظر تغذية (للانتقال المباشر) */
  pendingFeedbackIds: string[];
}

export function daySummary(db: Db, userId: string, now: number = Date.now()): DaySummary {
  const ids = relevantBatchIds(db, userId).batchIds;
  const agenda = agendaFor(db, userId, now, ids);
  const today = todayAgenda(db, userId, now, ids);
  const next = nextAgendaItem(db, userId, now, ids);
  const laterCount = agenda.filter((i) => i.startsAt >= today.dayEnd).length;

  // التغذية الراجعة: محاضرات منتهية (أو مغلقة) حضرها الطالب ولا تغذية لها بعد.
  // المرجع هو نفس نافذة الإرسال في `pendingFeedbackFor` (٤٨ ساعة بعد الإغلاق/النهاية).
  const myBatchIds = db.enrollments.filter((e) => e.userId === userId && e.status === 'active').map((e) => e.batchId);
  const candidates = db.sessions.filter((s) => myBatchIds.includes(s.batchId));
  const pending = candidates.filter((s) => {
    const att = attendanceOf(db, s.id, userId);
    if (!att || att.status === 'absent') return false;
    const finishedAt = s.status === 'closed' ? (s.closedAt ?? endOf(s)) : endOf(s);
    if (finishedAt > now) return false;
    if (now - finishedAt > 48 * 3_600_000) return false;
    return !db.sessionFeedback.some((f) => f.sessionId === s.id && f.userId === userId);
  });

  return {
    next,
    today,
    laterCount,
    pendingFeedbackCount: pending.length,
    pendingFeedbackIds: pending.map((s) => s.id),
  };
}

export { sessionsOfBatch };
