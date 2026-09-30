/**
 * data/remote.ts — طبقة البيانات الحقيقية بين التطبيق و Supabase.
 *
 *  • fetchRemoteDb()  : يقرأ كل الجداول ويحوّلها لشكل `Db` الذي تستهلكه الشاشات.
 *  • subscribeRealtime/applyRealtimePatch : يطبّق التغييرات Incrmental دون تفريغ القاعدة.
 *
 * كل الكتابة الحساسة تمر عبر RPCs في data/actions.ts (الحد الأمني الوحيد).
 * لا يوجد أي مسار كتابة مباشر من العميل إلى الجداول (أزيل pushDelta في 0019).
 *
 * كل المعرّفات المولّدة محليًا صارت UUID v4 (انظر shared/format.ts) لذلك يمكن
 * كتابة السجلات الجديدة بمعرّفاتها كما هي مع الحفاظ على العلاقات بين الجداول.
 */
import { getSupabase } from './supabase';
import {
  Attendance, AuditEntry, Badge, Batch, Branch, Certificate, Committee, Course, CourseRole, Db,
  Enrollment, Excuse, GamificationProfile, GamificationRule, KudosQuota, LeagueWeekRow,
  AppNotification, PointEvent, PrivateNote, Profile, CourseRating, StreakWeek,
  TrainingSession, UserBadge,
} from './types';

// ───────────────────────── أدوات تحويل ─────────────────────────

const ts = (v: string | null | undefined): number | undefined =>
  v ? new Date(v).getTime() : undefined;
const tsOr = (v: string | null | undefined, fallback = 0): number => ts(v) ?? fallback;

/** جدول فارغ — نقطة البداية قبل أي مزامنة (لا بيانات وهمية إطلاقًا) */
export function emptyDb(): Db {
  return {
    profiles: [], branches: [], committees: [], courses: [], batches: [], enrollments: [],
    sessions: [], attendance: [], pointEvents: [], streakWeeks: [], gamification: [],
    badges: [], userBadges: [], leagueWeeks: [], certificates: [], excuses: [], ratings: [],
    rules: [], audit: [], kudosQuotas: [], notifications: [], privateNotes: [],
    courseRoles: [], domainEvents: [],
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

async function selectRecent<T>(table: string, columns = '*', limit = 500, orderColumn = 'created_at'): Promise<T[]> {
  const { data, error } = await getSupabase().from(table).select(columns)
    .order(orderColumn, { ascending: false }).limit(limit);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as T[];
}

/** جلسات نافذة زمنية + أي جلسة حية (بدل تاريخ الجلسات بالكامل). */
async function selectSessionWindow(): Promise<any[]> {
  const sb = getSupabase();
  const cols = 'id,batch_id,seq,title,starts_at,duration_min,status,started_at,closed_at,report,created_at';
  const from = new Date(Date.now() - 21 * 86_400_000).toISOString();
  const to = new Date(Date.now() + 120 * 86_400_000).toISOString();
  const [{ data: windowed, error: e1 }, { data: live, error: e2 }] = await Promise.all([
    sb.from('sessions').select(cols).gte('starts_at', from).lte('starts_at', to).order('starts_at', { ascending: true }).limit(4_000),
    sb.from('sessions').select(cols).eq('status', 'live').limit(200),
  ]);
  if (e1) throw new Error(`sessions: ${e1.message}`);
  if (e2) throw new Error(`sessions: ${e2.message}`);
  const map = new Map<string, any>();
  for (const row of [...(windowed ?? []), ...(live ?? [])]) map.set(row.id, row);
  return [...map.values()];
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
    excuses, ratings, rules, audit, kudosQuotas, notifications, privateNotes, courseRoles,
  ] = await Promise.all([
    callRows<any>('list_visible_profiles'), selectAll<any>('branches'), selectAll<any>('committees'),
    selectAll<any>('courses'), selectAll<any>('batches'), callRows<any>('get_batch_stats'), selectAll<any>('enrollments'),
    selectSessionWindow(),
    // DATA-001 & DATA-13: الجداول المنزلقة والنامية تُقرأ بنافذة محدودة بدل تفريغ كامل التاريخ في الجهاز.
    selectRecent<any>('attendance', '*', 4_000, 'checked_in_at'),
    selectRecent<any>('point_events', '*', 2_000, 'created_at'),
    selectRecent<any>('streak_weeks', '*', 2_000, 'week_start'),
    selectAll<any>('gamification', '*', 'user_id'),
    selectAll<any>('badges', '*', 'code'),
    selectRecent<any>('user_badges', '*', 2_000, 'awarded_at'),
    selectRecent<any>('league_weeks', '*', 2_000, 'week_start'),
    selectRecent<any>('certificates', '*', 2_000, 'issued_at'),
    selectRecent<any>('excuses', '*', 1_000, 'created_at'),
    selectRecent<any>('course_ratings', '*', 2_000, 'created_at'),
    selectAll<any>('gamification_rules', '*', 'key'),
    selectRecent<any>('audit_log', '*', 500, 'created_at'),
    selectRecent<any>('kudos_quotas', '*', 1_000, 'month'),
    selectRecent<any>('notifications', '*', 200, 'created_at'),
    selectRecent<any>('private_notes', '*', 1_000, 'updated_at'),
    selectAll<any>('course_roles').catch(() => []),
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
      gender: (r.gender === 'f' ? 'f' : r.gender === 'm' ? 'm' : null) as Profile['gender'],
      status: r.status ?? 'active',
      joinedAt: tsOr(r.joined_at, Date.now()),
    })),
    branches: branches.map((r): Branch => ({
      id: r.id, name: r.name, governorate: r.governorate,
      address: r.address ?? '', supervisorId: r.supervisor_id ?? null,
    })),
    committees: committees.map((r): Committee => ({ id: r.id, branchId: r.branch_id, name: r.name })),
    courses: courses.map((r): Course => ({
      id: r.id, ownerId: r.owner_id ?? null, committeeId: r.committee_id ?? '', title: r.title, field: r.field,
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
      geofenceEnabled: Boolean(r.geofence_enabled),
      latitude: r.latitude ?? undefined, longitude: r.longitude ?? undefined,
      radiusM: r.radius_m ?? undefined,
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
      // SEC-QR-01: qr_seed عمود محظور بنطاق الـ SELECT (لا يصل أصلًا)، ونُصفّره
      // احتياطًا حتى لا يُخزَّن في الكاش لو تسرّب من أي مسار آخر.
      qrSeed: undefined, report: r.report ?? undefined,
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
      status: r.status === 'revoked' ? 'revoked' : 'active',
      revokedAt: ts(r.revoked_at), revokedBy: r.revoked_by ?? undefined,
      revokeReason: r.revoke_reason ?? undefined,
      reissuedAt: ts(r.reissued_at), reissuedBy: r.reissued_by ?? undefined,
      reissueCount: r.reissue_count ?? 0,
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
      id: r.id,
      instructorId: r.instructor_id, userId: r.user_id, note: r.note, updatedAt: tsOr(r.updated_at),
    })),
    courseRoles: courseRoles.map((r): CourseRole => ({
      id: r.id, courseId: r.course_id, userId: r.user_id, role: r.role,
      createdAt: tsOr(r.created_at),
    })),
    domainEvents: [],
    certSeq: certificates.length,
    seedVersion: 0,
  };
  return db;
}

// ───────────────────────── الزمن الحقيقي ─────────────────────────

/** بيانات حدث Realtime كما يصلها العميل من Supabase. */
export interface RealtimePatch {
  table: string;                       // 'sessions' | 'attendance' | ...
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRow?: Record<string, unknown> | null;
  oldRow?: Record<string, unknown> | null;
}

export interface SubscribeRealtimeOptions {
  profileId?: string | null;
  onReconnect?: () => void;
}

/**
 * يشترك في تغييرات الجداول المهمة ويمرّر كل حدث للمعالج.
 * المعالج يستلم الpayload (حتى لا نُفرّغ كامل قاعدة البيانات على كل حدث).
 */
export function subscribeRealtime(
  onPatch: (p: RealtimePatch) => void,
  options?: SubscribeRealtimeOptions,
): () => void {
  const sb = getSupabase();
  const profileId = options?.profileId ?? null;
  const userFilter = profileId ? 'user_id=eq.' + profileId : undefined;
  let hadSubscribed = false;
  let disconnected = false;
  const handler = (payload: any) =>
    onPatch({
      table: payload.table ?? '',
      eventType: payload.eventType as RealtimePatch['eventType'],
      newRow: payload.new ?? null,
      oldRow: payload.old ?? null,
    });
  // ⚠️ SEC-QR-01: `sessions` القادم من Realtime يكشف الصف كاملًا افتراضيًا،
  // ومن ضمنه `qr_seed` — وهي بذرة توكنات الحضور التي يُمنع قراءتها عبر
  // PostgREST (0005 revokes SELECT). استخدام `select` يقتصر على الأعمدة
  // المسموحة فقط فلا يصل qr_seed للعميل أو الكاش (إصلاح السطر التالي يدافع أيضًا).
  const sessionsRealtime = {
    event: '*' as const, schema: 'public', table: 'sessions',
    select: ['id', 'batch_id', 'seq', 'title', 'starts_at', 'duration_min', 'status', 'started_at', 'closed_at', 'report'],
  };
  const notifRealtime: Record<string, unknown> = { event: '*', schema: 'public', table: 'notifications' };
  const pointsRealtime: Record<string, unknown> = { event: '*', schema: 'public', table: 'point_events' };
  if (userFilter) {
    notifRealtime.filter = userFilter;
    pointsRealtime.filter = userFilter;
  }
  const channel = sb
    .channel(profileId ? 'masar-live-' + profileId.slice(0, 8) : 'masar-live')
    .on('postgres_changes', sessionsRealtime, handler)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, handler)
    .on('postgres_changes', notifRealtime as any, handler)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'excuses' }, handler)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'enrollments' }, handler)
    .on('postgres_changes', pointsRealtime as any, handler)
    .subscribe((status?: string) => {
      if (status === 'SUBSCRIBED') {
        if (hadSubscribed && disconnected) {
          disconnected = false;
          options?.onReconnect?.();
        }
        hadSubscribed = true;
      } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
        disconnected = true;
      }
    });
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

  // PERF-41: بدل deepClone لقاعدة البيانات كاملة في كل حدث Realtime (كانت
  // المصدر الأكبر للتعليق: clone كامل + stringify كامل للكاش عند كل دفعة أحداث)،
  // نسخة سطحية علوية: الجداول غير المتأثرة تحتفظ بمراجعها (أوفر للـ memo)،
  // ونُرجع مصفوفة جديدة للجدول المتأثر فقط دون تعديل أي مصفوفة قائمة.
  const next: Db = { ...db };
  const upsert = <T>(arr: T[], test: (x: T) => boolean, make: () => T): T[] => {
    const i = arr.findIndex(test);
    if (i < 0) return [...arr, make()];
    const copy = arr.slice();
    copy[i] = make();
    return copy;
  };
  const num = (v: unknown): number | undefined => (v == null ? undefined : Number(v));
  const numOr = (v: unknown, fb: number): number => (v == null ? fb : Number(v));
  const tsVal = (v: unknown): number | undefined => (v == null ? undefined : new Date(String(v)).getTime());
  const str = (v: unknown): string => (v == null ? '' : String(v));

  switch (p.table) {
    case 'courses': {
      const id = str(row.id);
      if (del) { next.courses = next.courses.filter((c) => c.id !== id); break; }
      const c: Course = {
        id, title: str(row.title), description: str(row.description ?? ''),
        field: str(row.field ?? ''), topics: Array.isArray(row.topics) ? row.topics : [],
        sessionsCount: numOr(row.sessions_count, 10), committeeId: str(row.committee_id ?? ''),
        status: (row.status as Course['status']) ?? 'published',
        color: str(row.color ?? '#0A84FF'),
      };
      next.courses = upsert(next.courses, (x) => x.id === id, () => c);
      break;
    }
    case 'batches': {
      const id = str(row.id);
      if (del) { next.batches = next.batches.filter((b) => b.id !== id); break; }
      const b: Batch = {
        id, courseId: str(row.course_id), branchId: str(row.branch_id),
        instructorId: str(row.instructor_id), capacity: numOr(row.capacity, 30),
        room: str(row.room ?? ''), joinCode: str(row.code ?? row.join_code ?? ''),
        schedule: (row.schedule as any) ?? { days: [0, 2], time: '18:00', durationMin: 120 },
        startDate: tsVal(row.start_date ?? row.created_at) ?? Date.now(),
        status: (row.status as Batch['status']) ?? 'active',
        enrolledCount: next.enrollments.filter((e) => e.batchId === id && e.status === 'active').length,
        waitlistCount: next.enrollments.filter((e) => e.batchId === id && e.status === 'waitlist').length,
      };
      const prev = next.batches.find((x) => x.id === id);
      // عند التحديث نبقي المقاعد آخر قيمة معروفة (مشتقة من get_batch_stats)
      // ولا نعيد اشتقاقها من enrollments المحلية حتى لا تتراجع عند غياب صفائحها.
      next.batches = upsert(
        next.batches,
        (x) => x.id === id,
        () => (prev ? { ...b, enrolledCount: prev.enrolledCount, waitlistCount: prev.waitlistCount } : b),
      );
      break;
    }
    case 'certificates': {
      const id = str(row.id);
      if (del) { next.certificates = next.certificates.filter((c) => c.id !== id); break; }
      const cert: Certificate = {
        id, userId: str(row.user_id), batchId: str(row.batch_id), serial: str(row.serial),
        issuedAt: tsVal(row.issued_at) ?? Date.now(),
        status: (row.status as Certificate['status']) ?? 'active',
        revokedAt: tsVal(row.revoked_at),
        revokedBy: (row.revoked_by as string) ?? undefined,
        revokeReason: (row.revocation_reason ?? row.revoke_reason) as string | undefined,
        reissuedAt: tsVal(row.reissued_at),
        reissuedBy: (row.reissued_by as string) ?? undefined,
        reissueCount: numOr(row.reissued_count ?? row.reissue_count, 0),
      };
      if (next.certificates.some((x) => x.id === id)) {
        next.certificates = next.certificates.map((x) => (x.id === id ? cert : x));
      } else {
        next.certificates = [cert, ...next.certificates];
      }
      break;
    }
    case 'user_badges': {
      const userId = str(row.user_id); const badgeCode = str(row.badge_code);
      if (!userId || !badgeCode) return null;
      const key = (ub: UserBadge) => ub.userId === userId && ub.badgeCode === badgeCode;
      if (del) { next.userBadges = next.userBadges.filter((ub) => !key(ub)); break; }
      const ub: UserBadge = {
        userId, badgeCode, awardedAt: tsVal(row.awarded_at ?? row.unlocked_at) ?? Date.now(),
      };
      next.userBadges = upsert(next.userBadges, key, () => ub);
      break;
    }
    case 'profiles': {
      const id = str(row.id);
      if (del) { next.profiles = next.profiles.filter((p) => p.id !== id); break; }
      const prof: Profile = {
        id, authUserId: (row.user_id as string) ?? null, fullName: str(row.full_name),
        phone: str(row.phone ?? ''), email: (row.email as string) ?? null,
        role: row.role as Profile['role'], status: row.status as Profile['status'],
        branchId: (row.branch_id as string) ?? null, avatarUrl: row.avatar_url as string | undefined,
        avatarColor: str(row.avatar_color ?? '#0A84FF'), gender: (row.gender as any) ?? null,
        joinedAt: tsVal(row.created_at ?? row.joined_at) ?? Date.now(),
      };
      next.profiles = upsert(next.profiles, (x) => x.id === id, () => prof);
      break;
    }
    case 'notifications': {
      const id = str(row.id);
      if (del) { next.notifications = next.notifications.filter((n) => n.id !== id); break; }
      const n: AppNotification = {
        id, userId: str(row.user_id), title: str(row.title), body: str(row.body ?? ''),
        type: row.type as AppNotification['type'], read: Boolean((row.read as any) === true),
        createdAt: tsVal(row.created_at) ?? Date.now(),
      };
      if (next.notifications.some((x) => x.id === id)) {
        next.notifications = next.notifications.map((x) => (x.id === id ? n : x));
      } else {
        next.notifications = [n, ...next.notifications];
      }
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
        // SEC-QR-01: لا نُخزِّن qr_seed في الكاش أبدًا حتى لو وصله خارج نطاق
        // الـ select — بذرة التوكن لا يُسمح بها إلا داخل RPCs الخادمية.
        qrSeed: undefined, report: row.report as any,
      };
      next.sessions = upsert(next.sessions, (x) => x.id === id, () => s);
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
      next.attendance = upsert(next.attendance, key, () => a);
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
      next.enrollments = upsert(next.enrollments, key, () => e);
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
      next.pointEvents = upsert(next.pointEvents, (x) => x.id === id, () => pe);
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
      next.excuses = upsert(next.excuses, (x) => x.id === id, () => ex);
      break;
    }
    case 'course_roles': {
      const id = str(row.id);
      if (del) { next.courseRoles = next.courseRoles.filter((x) => x.id !== id); break; }
      const cr: CourseRole = {
        id, courseId: str(row.course_id), userId: str(row.user_id), role: row.role as CourseRole['role'],
        createdAt: tsVal(row.created_at) ?? Date.now(),
      };
      next.courseRoles = upsert(next.courseRoles, (x) => x.id === id, () => cr);
      break;
    }
    default:
      return null; // جدول غير مشترك — المتصل يعمل refresh
  }

  // الـ batchStats مشتقة من enrollments — نُبني نسخة جديدة من نفس الـ batch
  // دون تعديل الكائن الحالي (يخالف الإيموتابيلتي ويكسر الـ memoization).
  if (p.table === 'enrollments') {
    const batchId = str(row.batch_id);
    next.batches = next.batches.map((x) => x.id === batchId
      ? {
        ...x,
        enrolledCount: next.enrollments.filter((e) => e.batchId === batchId && e.status === 'active').length,
        waitlistCount: next.enrollments.filter((e) => e.batchId === batchId && e.status === 'waitlist').length,
      }
      : x);
  }
  return next;
}
