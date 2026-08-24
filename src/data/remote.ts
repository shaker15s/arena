/**
 * data/remote.ts — طبقة البيانات الحقيقية بين التطبيق و Supabase.
 *
 *  • fetchRemoteDb()  : يقرأ كل الجداول ويحوّلها لشكل `Db` الذي تستهلكه الشاشات.
 *  • pushDelta(a, b)  : يقارن نسختي القاعدة قبل/بعد أي عملية ويكتب الفروق فعليًا
 *                       (INSERT / UPDATE / DELETE) في Postgres — بدون أي محاكاة.
 *
 * كل المعرّفات المولّدة محليًا صارت UUID v4 (انظر shared/format.ts) لذلك يمكن
 * كتابة السجلات الجديدة بمعرّفاتها كما هي مع الحفاظ على العلاقات بين الجداول.
 */
import { getSupabase } from './supabase';
import {
  Attendance, AuditEntry, Badge, Batch, Branch, Certificate, Committee, Course, Db,
  Enrollment, Excuse, GamificationProfile, GamificationRule, KudosQuota, LeagueWeekRow,
  AppNotification, PointEvent, PrivateNote, Profile, CourseRating, StreakWeek,
  TrainingSession, UserBadge,
} from './types';

// ───────────────────────── أدوات تحويل ─────────────────────────

const ts = (v: string | null | undefined): number | undefined =>
  v ? new Date(v).getTime() : undefined;
const tsOr = (v: string | null | undefined, fallback = 0): number => ts(v) ?? fallback;
const iso = (v: number | null | undefined): string | null =>
  typeof v === 'number' && Number.isFinite(v) ? new Date(v).toISOString() : null;
const dateOnly = (v: number): string => new Date(v).toISOString().slice(0, 10);

/** جدول فارغ — نقطة البداية قبل أي مزامنة (لا بيانات وهمية إطلاقًا) */
export function emptyDb(): Db {
  return {
    profiles: [], branches: [], committees: [], courses: [], batches: [], enrollments: [],
    sessions: [], attendance: [], pointEvents: [], streakWeeks: [], gamification: [],
    badges: [], userBadges: [], leagueWeeks: [], certificates: [], excuses: [], ratings: [],
    rules: [], audit: [], kudosQuotas: [], notifications: [], privateNotes: [],
    certSeq: 0, seedVersion: 0,
  };
}

// ───────────────────────── القراءة ─────────────────────────

const READ_PAGE_SIZE = 500;
const MAX_READ_ROWS = 100_000;

async function selectAll<T>(table: string, columns = '*', orderColumn = 'id'): Promise<T[]> {
  const sb = getSupabase();
  const rows: T[] = [];
  for (let from = 0; from < MAX_READ_ROWS; from += READ_PAGE_SIZE) {
    const { data, error } = await sb.from(table).select(columns)
      .order(orderColumn, { ascending: true })
      .range(from, from + READ_PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < READ_PAGE_SIZE) return rows;
  }
  throw new Error(`${table}: safety limit of ${MAX_READ_ROWS} rows exceeded; use a server-side paginated view`);
}

async function selectRecent<T>(table: string, columns = '*', limit = 500): Promise<T[]> {
  const { data, error } = await getSupabase().from(table).select(columns)
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as T[];
}

async function callRows<T>(fn: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < MAX_READ_ROWS; offset += READ_PAGE_SIZE) {
    const { data, error } = await getSupabase().rpc(fn, { p_offset: offset, p_limit: READ_PAGE_SIZE });
    if (error) throw new Error(`${fn}: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < READ_PAGE_SIZE) return rows;
  }
  throw new Error(`${fn}: safety limit of ${MAX_READ_ROWS} rows exceeded`);
}

/**
 * يقرأ فقط النطاق المسموح للمستخدم الحالي. الملفات الشخصية تمر عبر directory
 * آمن يحجب الهاتف والبريد عن الطلاب، وإحصاء المقاعد لا يكشف هويات المسجلين.
 */
export async function fetchRemoteDb(): Promise<Db> {
  const [
    profiles, branches, committees, courses, batches, batchStats, enrollments, sessions, attendance,
    pointEvents, streakWeeks, gamification, badges, userBadges, leagueWeeks, certificates,
    excuses, ratings, rules, audit, kudosQuotas, notifications, privateNotes,
  ] = await Promise.all([
    callRows<any>('list_visible_profiles'), selectAll<any>('branches'), selectAll<any>('committees'),
    selectAll<any>('courses'), selectAll<any>('batches'), callRows<any>('get_batch_stats'), selectAll<any>('enrollments'),
    selectAll<any>('sessions', 'id,batch_id,seq,title,starts_at,duration_min,status,started_at,closed_at,report,created_at'),
    selectAll<any>('attendance'), selectAll<any>('point_events'),
    selectAll<any>('streak_weeks'), selectAll<any>('gamification'), selectAll<any>('badges', '*', 'code'),
    selectAll<any>('user_badges'), selectAll<any>('league_weeks'), selectAll<any>('certificates'),
    selectAll<any>('excuses'), selectAll<any>('course_ratings'), selectAll<any>('gamification_rules'),
    selectRecent<any>('audit_log'), selectAll<any>('kudos_quotas'), selectAll<any>('notifications'),
    selectAll<any>('private_notes'),
  ]);
  const statsByBatch = new Map(batchStats.map((r: any) => [r.batch_id, r]));

  const db: Db = {
    profiles: profiles.map((r): Profile => ({
      id: r.id,
      authUserId: r.user_id ?? null,
      fullName: r.full_name ?? '',
      email: r.email ?? null,
      phone: r.phone ?? '',
      role: r.role ?? 'student',
      branchId: r.branch_id ?? null,
      avatarUrl: r.avatar_url ?? null,
      avatarColor: r.avatar_color ?? '#007AFF',
      gender: (r.gender ?? 'm') as Profile['gender'],
      status: r.status ?? 'active',
      joinedAt: tsOr(r.joined_at, Date.now()),
    })),
    branches: branches.map((r): Branch => ({
      id: r.id, name: r.name, governorate: r.governorate,
      address: r.address ?? '', supervisorId: r.supervisor_id ?? null,
    })),
    committees: committees.map((r): Committee => ({ id: r.id, branchId: r.branch_id, name: r.name })),
    courses: courses.map((r): Course => ({
      id: r.id, committeeId: r.committee_id ?? '', title: r.title, field: r.field,
      description: r.description ?? '', topics: r.topics ?? [],
      sessionsCount: r.sessions_count ?? 0, status: r.status, color: r.color ?? '#007AFF',
    })),
    batches: batches.map((r): Batch => ({
      id: r.id, courseId: r.course_id, branchId: r.branch_id, instructorId: r.instructor_id ?? '',
      capacity: r.capacity ?? 0,
      enrolledCount: Number(statsByBatch.get(r.id)?.enrolled_count ?? 0),
      waitlistCount: Number(statsByBatch.get(r.id)?.waitlist_count ?? 0),
      schedule: r.schedule ?? { days: [], time: '18:00', durationMin: 120 },
      startDate: tsOr(r.start_date, Date.now()), room: r.room ?? '',
      status: r.status, joinCode: r.join_code ?? '',
    })),
    enrollments: enrollments.map((r): Enrollment => ({
      userId: r.user_id, batchId: r.batch_id,
      status: r.status === 'waitlist' ? 'waitlist' : 'active',
      joinedAt: tsOr(r.joined_at, Date.now()),
    })),
    sessions: sessions.map((r): TrainingSession => ({
      id: r.id, batchId: r.batch_id, seq: r.seq, title: r.title ?? '',
      startsAt: tsOr(r.starts_at), durationMin: r.duration_min ?? 120, status: r.status,
      startedAt: ts(r.started_at), closedAt: ts(r.closed_at),
      qrSeed: r.qr_seed ?? undefined, report: r.report ?? undefined,
    })),
    attendance: attendance.map((r): Attendance => ({
      sessionId: r.session_id, userId: r.user_id, status: r.status,
      checkedInAt: ts(r.checked_in_at), method: r.method ?? undefined, note: r.note ?? undefined,
    })),
    pointEvents: pointEvents.map((r): PointEvent => ({
      id: r.id, userId: r.user_id, points: r.points, reasonCode: r.reason_code,
      refType: r.ref_type ?? undefined, refId: r.ref_id ?? undefined,
      awardedBy: r.awarded_by ?? null, idempotencyKey: r.idempotency_key,
      createdAt: tsOr(r.created_at),
    })),
    streakWeeks: streakWeeks.map((r): StreakWeek => ({
      userId: r.user_id, weekStart: tsOr(r.week_start), status: r.status,
      sessionsTotal: r.sessions_total ?? 0, sessionsHonored: r.sessions_honored ?? 0,
      freezeUsed: Boolean(r.freeze_used),
    })),
    gamification: gamification.map((r): GamificationProfile => ({
      userId: r.user_id, currentStreakWeeks: r.current_streak_weeks ?? 0,
      longestStreakWeeks: r.longest_streak_weeks ?? 0, freezesHeld: r.freezes_held ?? 0,
      leagueTier: r.league_tier ?? 'bronze',
    })),
    badges: badges.map((r): Badge => ({
      code: r.code, nameAr: r.name_ar, nameEn: r.name_en, descAr: r.desc_ar ?? '',
      descEn: r.desc_en ?? '', rarity: r.rarity, icon: r.icon, active: r.active !== false,
    })),
    userBadges: userBadges.map((r): UserBadge => ({
      userId: r.user_id, badgeCode: r.badge_code, awardedAt: tsOr(r.awarded_at),
    })),
    leagueWeeks: leagueWeeks.map((r): LeagueWeekRow => ({
      userId: r.user_id, weekStart: tsOr(r.week_start), tier: r.tier,
      xpWeek: r.xp_week ?? 0, finalRank: r.final_rank ?? undefined, outcome: r.outcome ?? undefined,
    })),
    certificates: certificates.map((r): Certificate => ({
      id: r.id, userId: r.user_id, batchId: r.batch_id, serial: r.serial, issuedAt: tsOr(r.issued_at),
    })),
    excuses: excuses.map((r): Excuse => ({
      id: r.id, userId: r.user_id, sessionId: r.session_id, reason: r.reason,
      attachment: r.attachment_url ?? undefined, status: r.status, note: r.note ?? undefined,
      reviewedBy: r.reviewed_by ?? undefined, createdAt: tsOr(r.created_at),
    })),
    ratings: ratings.map((r): CourseRating => ({
      userId: r.user_id, courseId: r.course_id, stars: r.stars,
      comment: r.comment ?? undefined, createdAt: tsOr(r.created_at),
    })),
    rules: rules.map((r): GamificationRule => ({
      key: r.key, value: typeof r.value === 'object' && r.value !== null ? (r.value.value ?? 0) : r.value,
      scope: 'global', updatedBy: r.updated_by ?? null, updatedAt: tsOr(r.updated_at),
    })),
    audit: audit.map((r): AuditEntry => ({
      id: r.id, actorId: r.actor_id ?? '', action: r.action, target: r.target ?? '',
      payload: r.payload ?? {}, createdAt: tsOr(r.created_at),
    })),
    kudosQuotas: kudosQuotas.map((r): KudosQuota => ({
      instructorId: r.instructor_id, month: r.month, spent: r.spent ?? 0,
    })),
    notifications: notifications.map((r): AppNotification => ({
      id: r.id, userId: r.user_id, title: r.title, body: r.body ?? '',
      type: r.type, read: Boolean(r.read), createdAt: tsOr(r.created_at),
    })),
    privateNotes: privateNotes.map((r): PrivateNote => ({
      instructorId: r.instructor_id, userId: r.user_id, note: r.note, updatedAt: tsOr(r.updated_at),
    })),
    certSeq: certificates.length,
    seedVersion: 0,
  };
  return db;
}

// ───────────────────────── الكتابة (مزامنة الفروق) ─────────────────────────

interface TableSpec<T> {
  table: string;
  /** مفتاح محلي فريد للمقارنة */
  key: (row: T) => string;
  /** أعمدة تحديد السجل في قاعدة البيانات (للحذف/التحديث) */
  match: (row: T) => Record<string, string>;
  /** التحويل لصف قاعدة البيانات */
  toRow: (row: T) => Record<string, unknown>;
  /** عمود تعارض الـ upsert */
  onConflict: string;
  /** هل يُسمح بحذف السجلات المفقودة؟ */
  allowDelete?: boolean;
}

const SPECS: { [K in keyof Db]?: TableSpec<any> } = {
  profiles: {
    table: 'profiles', onConflict: 'id',
    key: (r: Profile) => r.id,
    match: (r: Profile) => ({ id: r.id }),
    toRow: (r: Profile) => ({
      id: r.id, user_id: r.authUserId ?? null, full_name: r.fullName, email: r.email ?? null,
      phone: r.phone || null, role: r.role, branch_id: r.branchId, avatar_url: r.avatarUrl ?? null,
      avatar_color: r.avatarColor, gender: r.gender, status: r.status, joined_at: iso(r.joinedAt),
    }),
  },
  branches: {
    table: 'branches', onConflict: 'id',
    key: (r: Branch) => r.id, match: (r: Branch) => ({ id: r.id }),
    toRow: (r: Branch) => ({
      id: r.id, name: r.name, governorate: r.governorate, address: r.address || null,
      supervisor_id: r.supervisorId,
    }),
  },
  committees: {
    table: 'committees', onConflict: 'id',
    key: (r: Committee) => r.id, match: (r: Committee) => ({ id: r.id }),
    toRow: (r: Committee) => ({ id: r.id, branch_id: r.branchId, name: r.name }),
  },
  courses: {
    table: 'courses', onConflict: 'id',
    key: (r: Course) => r.id, match: (r: Course) => ({ id: r.id }),
    toRow: (r: Course) => ({
      id: r.id, committee_id: r.committeeId || null, title: r.title, field: r.field,
      description: r.description || null, topics: r.topics, sessions_count: r.sessionsCount,
      status: r.status, color: r.color,
    }),
  },
  batches: {
    table: 'batches', onConflict: 'id',
    key: (r: Batch) => r.id, match: (r: Batch) => ({ id: r.id }),
    toRow: (r: Batch) => ({
      id: r.id, course_id: r.courseId, branch_id: r.branchId, instructor_id: r.instructorId || null,
      capacity: r.capacity, schedule: r.schedule, start_date: dateOnly(r.startDate),
      room: r.room || null, status: r.status, join_code: r.joinCode || null,
    }),
  },
  enrollments: {
    table: 'enrollments', onConflict: 'user_id,batch_id', allowDelete: true,
    key: (r: Enrollment) => `${r.userId}|${r.batchId}`,
    match: (r: Enrollment) => ({ user_id: r.userId, batch_id: r.batchId }),
    toRow: (r: Enrollment) => ({
      user_id: r.userId, batch_id: r.batchId, status: r.status, joined_at: iso(r.joinedAt),
    }),
  },
  sessions: {
    table: 'sessions', onConflict: 'id',
    key: (r: TrainingSession) => r.id, match: (r: TrainingSession) => ({ id: r.id }),
    toRow: (r: TrainingSession) => ({
      id: r.id, batch_id: r.batchId, seq: r.seq, title: r.title || null,
      starts_at: iso(r.startsAt), duration_min: r.durationMin, status: r.status,
      started_at: iso(r.startedAt ?? null), closed_at: iso(r.closedAt ?? null),
      qr_seed: r.qrSeed ?? null, report: r.report ?? null,
    }),
  },
  attendance: {
    table: 'attendance', onConflict: 'session_id,user_id',
    key: (r: Attendance) => `${r.sessionId}|${r.userId}`,
    match: (r: Attendance) => ({ session_id: r.sessionId, user_id: r.userId }),
    toRow: (r: Attendance) => ({
      session_id: r.sessionId, user_id: r.userId, status: r.status,
      checked_in_at: iso(r.checkedInAt ?? null), method: r.method ?? null, note: r.note ?? null,
    }),
  },
  pointEvents: {
    table: 'point_events', onConflict: 'idempotency_key',
    key: (r: PointEvent) => r.idempotencyKey, match: (r: PointEvent) => ({ id: r.id }),
    toRow: (r: PointEvent) => ({
      id: r.id, user_id: r.userId, points: r.points, reason_code: r.reasonCode,
      ref_type: r.refType ?? null, ref_id: r.refId ?? null, awarded_by: r.awardedBy,
      idempotency_key: r.idempotencyKey, created_at: iso(r.createdAt),
    }),
  },
  streakWeeks: {
    table: 'streak_weeks', onConflict: 'user_id,week_start',
    key: (r: StreakWeek) => `${r.userId}|${r.weekStart}`,
    match: (r: StreakWeek) => ({ user_id: r.userId, week_start: dateOnly(r.weekStart) }),
    toRow: (r: StreakWeek) => ({
      user_id: r.userId, week_start: dateOnly(r.weekStart), status: r.status,
      sessions_total: r.sessionsTotal, sessions_honored: r.sessionsHonored, freeze_used: r.freezeUsed,
    }),
  },
  gamification: {
    table: 'gamification', onConflict: 'user_id',
    key: (r: GamificationProfile) => r.userId,
    match: (r: GamificationProfile) => ({ user_id: r.userId }),
    toRow: (r: GamificationProfile) => ({
      user_id: r.userId, current_streak_weeks: r.currentStreakWeeks,
      longest_streak_weeks: r.longestStreakWeeks, freezes_held: r.freezesHeld,
      league_tier: r.leagueTier, updated_at: new Date().toISOString(),
    }),
  },
  userBadges: {
    table: 'user_badges', onConflict: 'user_id,badge_code',
    key: (r: UserBadge) => `${r.userId}|${r.badgeCode}`,
    match: (r: UserBadge) => ({ user_id: r.userId, badge_code: r.badgeCode }),
    toRow: (r: UserBadge) => ({ user_id: r.userId, badge_code: r.badgeCode, awarded_at: iso(r.awardedAt) }),
  },
  leagueWeeks: {
    table: 'league_weeks', onConflict: 'user_id,week_start',
    key: (r: LeagueWeekRow) => `${r.userId}|${r.weekStart}`,
    match: (r: LeagueWeekRow) => ({ user_id: r.userId, week_start: dateOnly(r.weekStart) }),
    toRow: (r: LeagueWeekRow) => ({
      user_id: r.userId, week_start: dateOnly(r.weekStart), tier: r.tier, xp_week: r.xpWeek,
      final_rank: r.finalRank ?? null, outcome: r.outcome ?? null,
    }),
  },
  certificates: {
    table: 'certificates', onConflict: 'serial',
    key: (r: Certificate) => r.serial, match: (r: Certificate) => ({ id: r.id }),
    toRow: (r: Certificate) => ({
      id: r.id, user_id: r.userId, batch_id: r.batchId, serial: r.serial, issued_at: iso(r.issuedAt),
    }),
  },
  excuses: {
    table: 'excuses', onConflict: 'id',
    key: (r: Excuse) => r.id, match: (r: Excuse) => ({ id: r.id }),
    toRow: (r: Excuse) => ({
      id: r.id, user_id: r.userId, session_id: r.sessionId, reason: r.reason,
      attachment_url: r.attachment ?? null, status: r.status, note: r.note ?? null,
      reviewed_by: r.reviewedBy ?? null, created_at: iso(r.createdAt),
    }),
  },
  ratings: {
    table: 'course_ratings', onConflict: 'user_id,course_id',
    key: (r: CourseRating) => `${r.userId}|${r.courseId}`,
    match: (r: CourseRating) => ({ user_id: r.userId, course_id: r.courseId }),
    toRow: (r: CourseRating) => ({
      user_id: r.userId, course_id: r.courseId, stars: r.stars,
      comment: r.comment ?? null, created_at: iso(r.createdAt),
    }),
  },
  rules: {
    table: 'gamification_rules', onConflict: 'key',
    key: (r: GamificationRule) => r.key, match: (r: GamificationRule) => ({ key: r.key }),
    toRow: (r: GamificationRule) => ({
      key: r.key, value: { value: r.value }, updated_by: r.updatedBy, updated_at: iso(r.updatedAt),
    }),
  },
  audit: {
    table: 'audit_log', onConflict: 'id',
    key: (r: AuditEntry) => r.id, match: (r: AuditEntry) => ({ id: r.id }),
    toRow: (r: AuditEntry) => ({
      id: r.id, actor_id: r.actorId || null, action: r.action, target: r.target,
      payload: r.payload, created_at: iso(r.createdAt),
    }),
  },
  kudosQuotas: {
    table: 'kudos_quotas', onConflict: 'instructor_id,month',
    key: (r: KudosQuota) => `${r.instructorId}|${r.month}`,
    match: (r: KudosQuota) => ({ instructor_id: r.instructorId, month: r.month }),
    toRow: (r: KudosQuota) => ({ instructor_id: r.instructorId, month: r.month, spent: r.spent }),
  },
  notifications: {
    table: 'notifications', onConflict: 'id',
    key: (r: AppNotification) => r.id, match: (r: AppNotification) => ({ id: r.id }),
    toRow: (r: AppNotification) => ({
      id: r.id, user_id: r.userId, title: r.title, body: r.body, type: r.type,
      read: r.read, created_at: iso(r.createdAt),
    }),
  },
  privateNotes: {
    table: 'private_notes', onConflict: 'instructor_id,user_id',
    key: (r: PrivateNote) => `${r.instructorId}|${r.userId}`,
    match: (r: PrivateNote) => ({ instructor_id: r.instructorId, user_id: r.userId }),
    toRow: (r: PrivateNote) => ({
      instructor_id: r.instructorId, user_id: r.userId, note: r.note, updated_at: iso(r.updatedAt),
    }),
  },
};

export interface SyncReport {
  written: number;
  deleted: number;
  errors: string[];
}

/**
 * يقارن نسختين من القاعدة ويكتب الفروق في Supabase.
 * يُستدعى بعد كل عملية `mutate` — أي تغيير في الواجهة يصبح تغييرًا حقيقيًا في السيرفر.
 */
export async function pushDelta(before: Db, after: Db): Promise<SyncReport> {
  const sb = getSupabase();
  const report: SyncReport = { written: 0, deleted: 0, errors: [] };

  for (const tableKey of Object.keys(SPECS) as Array<keyof Db>) {
    const spec = SPECS[tableKey] as TableSpec<any> | undefined;
    if (!spec) continue;
    const prevRows = (before[tableKey] ?? []) as unknown as any[];
    const nextRows = (after[tableKey] ?? []) as unknown as any[];
    if (!Array.isArray(prevRows) || !Array.isArray(nextRows)) continue;

    const prevMap = new Map<string, string>();
    prevRows.forEach((r) => prevMap.set(spec.key(r), JSON.stringify(spec.toRow(r))));

    const upserts: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    nextRows.forEach((r) => {
      const k = spec.key(r);
      seen.add(k);
      const row = spec.toRow(r);
      const serialized = JSON.stringify(row);
      if (prevMap.get(k) !== serialized) upserts.push(row);
    });

    if (upserts.length) {
      const { error } = await sb.from(spec.table).upsert(upserts, { onConflict: spec.onConflict });
      if (error) report.errors.push(`${spec.table}: ${error.message}`);
      else report.written += upserts.length;
    }

    if (spec.allowDelete) {
      const removed = prevRows.filter((r) => !seen.has(spec.key(r)));
      for (const r of removed) {
        const { error } = await sb.from(spec.table).delete().match(spec.match(r));
        if (error) report.errors.push(`${spec.table} delete: ${error.message}`);
        else report.deleted += 1;
      }
    }
  }
  return report;
}

// ───────────────────────── الزمن الحقيقي ─────────────────────────

/** بيانات حدث Realtime كما يصلها العميل من Supabase. */
export interface RealtimePatch {
  table: string;                       // 'sessions' | 'attendance' | ...
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRow?: Record<string, unknown> | null;
  oldRow?: Record<string, unknown> | null;
}

/**
 * يشترك في تغييرات الجداول المهمة ويمرّر كل حدث للمعالج.
 * المعالج يستلم الpayload (حتى لا نُفرّغ كامل قاعدة البيانات على كل حدث).
 */
export function subscribeRealtime(onPatch: (p: RealtimePatch) => void): () => void {
  const sb = getSupabase();
  const handler = (payload: any) =>
    onPatch({
      table: payload.table ?? '',
      eventType: payload.eventType as RealtimePatch['eventType'],
      newRow: payload.new ?? null,
      oldRow: payload.old ?? null,
    });
  const channel = sb
    .channel('masar-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, handler)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, handler)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, handler)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'excuses' }, handler)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'enrollments' }, handler)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'point_events' }, handler)
    .subscribe();
  return () => { void sb.removeChannel(channel); };
}

/**
 * Realtime incremental: يطبّق حدثًا واحدًا على نسخة `db` محليًا بدل سحب كل الجداول.
 * يعيد `null` إذا لم يستطع تطبيق الحدث (فليتبعه المتصل بـ refresh).
 * يدعم INSERT/UPDATE (upsert) وDELETE (remove) لكل جدول مشترك.
 */
export function applyRealtimePatch(db: Db, p: RealtimePatch): Db | null {
  if (!p.eventType || !p.table) return null;
  const del = p.eventType === 'DELETE';
  const row = del ? p.oldRow : p.newRow;
  if (!row) return null;

  const next = structuredClone(db);
  const num = (v: unknown): number | undefined => (v == null ? undefined : Number(v));
  const numOr = (v: unknown, fb: number): number => (v == null ? fb : Number(v));
  const tsVal = (v: unknown): number | undefined => (v == null ? undefined : new Date(String(v)).getTime());
  const str = (v: unknown): string => (v == null ? '' : String(v));

  switch (p.table) {
    case 'notifications': {
      const id = str(row.id);
      if (del) { next.notifications = next.notifications.filter((n) => n.id !== id); break; }
      const n: AppNotification = {
        id, userId: str(row.user_id), title: str(row.title), body: str(row.body ?? ''),
        type: row.type as AppNotification['type'], read: Boolean((row.read as any) === true),
        createdAt: tsVal(row.created_at) ?? Date.now(),
      };
      const i = next.notifications.findIndex((x) => x.id === id);
      if (i >= 0) next.notifications[i] = n; else next.notifications.unshift(n);
      break;
    }
    case 'sessions': {
      const id = str(row.id);
      if (del) { next.sessions = next.sessions.filter((s) => s.id !== id); break; }
      const s: TrainingSession = {
        id, batchId: str(row.batch_id), seq: numOr(row.seq, 0), title: str(row.title ?? ''),
        startsAt: tsVal(row.starts_at) ?? 0, durationMin: numOr(row.duration_min, 120),
        status: row.status as TrainingSession['status'],
        startedAt: tsVal(row.started_at), closedAt: tsVal(row.closed_at),
        qrSeed: row.qr_seed as string | undefined, report: row.report as any,
      };
      const i = next.sessions.findIndex((x) => x.id === id);
      if (i >= 0) next.sessions[i] = s; else next.sessions.push(s);
      break;
    }
    case 'attendance': {
      const sessionId = str(row.session_id); const userId = str(row.user_id);
      // على DELETE قد لا يصل المفتاح المركّب (بدون REPLICA IDENTITY FULL) — نعيد null ليتبعها refresh.
      if (!sessionId || !userId) return null;
      const key = (a: Attendance) => a.sessionId === sessionId && a.userId === userId;
      if (del) { next.attendance = next.attendance.filter((a) => !key(a)); break; }
      const a: Attendance = {
        sessionId, userId, status: row.status as Attendance['status'],
        checkedInAt: tsVal(row.checked_in_at), method: row.method as Attendance['method'] ?? undefined,
        note: (row.note as string) ?? undefined,
      };
      const i = next.attendance.findIndex(key);
      if (i >= 0) next.attendance[i] = a; else next.attendance.push(a);
      break;
    }
    case 'enrollments': {
      const userId = str(row.user_id); const batchId = str(row.batch_id);
      if (!userId || !batchId) return null;
      const key = (e: Enrollment) => e.userId === userId && e.batchId === batchId;
      if (del) { next.enrollments = next.enrollments.filter((e) => !key(e)); break; }
      const e: Enrollment = {
        userId, batchId, status: row.status === 'waitlist' ? 'waitlist' : 'active',
        joinedAt: tsVal(row.joined_at) ?? Date.now(),
      };
      const i = next.enrollments.findIndex(key);
      if (i >= 0) next.enrollments[i] = e; else next.enrollments.push(e);
      break;
    }
    case 'point_events': {
      const id = str(row.id);
      if (del) { next.pointEvents = next.pointEvents.filter((x) => x.id !== id); break; }
      const pe: PointEvent = {
        id, userId: str(row.user_id), points: numOr(row.points, 0), reasonCode: row.reason_code as PointEvent['reasonCode'],
        refType: row.ref_type as PointEvent['refType'] ?? undefined, refId: row.ref_id as string | undefined,
        awardedBy: (row.awarded_by as string) ?? null, idempotencyKey: str(row.idempotency_key),
        createdAt: tsVal(row.created_at) ?? Date.now(),
      };
      const i = next.pointEvents.findIndex((x) => x.id === id);
      if (i >= 0) next.pointEvents[i] = pe; else next.pointEvents.push(pe);
      break;
    }
    case 'excuses': {
      const id = str(row.id);
      if (del) { next.excuses = next.excuses.filter((x) => x.id !== id); break; }
      const ex: Excuse = {
        id, userId: str(row.user_id), sessionId: str(row.session_id), reason: str(row.reason ?? ''),
        attachment: row.attachment_url as string | undefined, status: row.status as Excuse['status'],
        note: row.note as string | undefined, reviewedBy: row.reviewed_by as string | undefined,
        createdAt: tsVal(row.created_at) ?? Date.now(),
      };
      const i = next.excuses.findIndex((x) => x.id === id);
      if (i >= 0) next.excuses[i] = ex; else next.excuses.push(ex);
      break;
    }
    default:
      return null; // جدول غير مشترك — المتصل يعمل refresh
  }

  // الـ batchStats مشتقة من enrollments — نُحدّث المقاعد لنفس الـ batch مباشرة.
  if (p.table === 'enrollments') {
    const batchId = str(row.batch_id);
    const b = next.batches.find((x) => x.id === batchId);
    if (b) {
      b.enrolledCount = next.enrollments.filter((e) => e.batchId === batchId && e.status === 'active').length;
      b.waitlistCount = next.enrollments.filter((e) => e.batchId === batchId && e.status === 'waitlist').length;
    }
  }
  return next;
}
