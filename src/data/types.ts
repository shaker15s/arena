/**
 * data/types.ts — مرآة دقيقة لمخطط قاعدة البيانات (وثيقة 06 §3)
 * نفس الأسماء والعلاقات حتى يبقى عقد الانتقال لـ Supabase نظيفًا.
 */

export type Role = 'student' | 'volunteer' | 'supervisor' | 'admin';

export interface Profile {
  id: string;
  /** معرّف المستخدم في auth.users (Google) — null للحسابات المُنشأة إداريًا */
  authUserId?: string | null;
  fullName: string;
  /** الإيميل القادم من حساب Google — يُحفظ ولا يُعدّل يدويًا */
  email?: string | null;
  phone: string;
  role: Role;
  branchId: string | null;
  /** صورة المستخدم (من Google أو مرفوعة على Supabase Storage) */
  avatarUrl?: string | null;
  avatarColor: string;
  gender: 'm' | 'f' | null;
  status: 'active' | 'disabled';
  joinedAt: number;
}

export interface Branch {
  id: string;
  name: string;
  governorate: string;
  address: string;
  supervisorId: string | null;
}

export interface Committee {
  id: string;
  branchId: string;
  name: string;
}

export interface Course {
  id: string;
  committeeId: string;
  title: string;
  field: string;
  description: string;
  topics: string[];
  sessionsCount: number;
  status: 'draft' | 'published' | 'archived';
  color: string;
}

export interface BatchSchedule {
  days: number[]; // 0=الأحد … 6=السبت
  time: string;   // "18:00"
  durationMin: number;
}

export interface Batch {
  id: string;
  courseId: string;
  branchId: string;
  instructorId: string;
  capacity: number;
  /** Aggregates returned by the server without exposing enrollment identities. */
  enrolledCount?: number;
  waitlistCount?: number;
  schedule: BatchSchedule;
  startDate: number;
  room: string;
  status: 'scheduled' | 'active' | 'completed' | 'archived';
  joinCode: string;
  /** Geofence اختياري — يُفعَّل خادميًا على المجموعات المفعّلة فقط. */
  geofenceEnabled?: boolean;
  latitude?: number;
  longitude?: number;
  radiusM?: number;
}

export interface Enrollment {
  userId: string;
  batchId: string;
  status: 'active' | 'waitlist';
  joinedAt: number;
}

export type SessionStatus = 'scheduled' | 'live' | 'closed';

export interface TrainingSession {
  id: string;
  batchId: string;
  seq: number;
  title: string;
  startsAt: number;
  durationMin: number;
  status: SessionStatus;
  startedAt?: number;
  closedAt?: number;
  qrSeed?: string; // بذرة توكنات الدوران (سيرفري)
  report?: SessionReport;
}

export interface SessionReport {
  done: string;
  planned: string;
  challenges: string;
  submittedAt: number;
}

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused';

export interface Attendance {
  sessionId: string;
  userId: string;
  status: AttendanceStatus;
  checkedInAt?: number;
  method?: 'qr' | 'code' | 'manual';
  note?: string;
}

export type PointReason =
  | 'attendance.present'
  | 'attendance.late'
  | 'course.complete'
  | 'kudos'
  | 'rating'
  | 'month.bonus'
  | 'admin.grant';

/** دفتر النقاط — مصدر الحقيقة الوحيد، الرصيد = SUM */
export interface PointEvent {
  id: string;
  userId: string;
  points: number;
  reasonCode: PointReason;
  refType?: 'session' | 'course' | 'batch' | 'admin';
  refId?: string;
  awardedBy: string | null; // null = النظام
  idempotencyKey: string;   // UNIQUE
  createdAt: number;
}

export type StreakWeekStatus = 'tracking' | 'kept' | 'frozen' | 'pending' | 'broken';

export interface StreakWeek {
  userId: string;
  weekStart: number;
  status: StreakWeekStatus;
  sessionsTotal: number;
  sessionsHonored: number;
  freezeUsed: boolean;
}

/** كاش مشتق من الدفاتر — يُعاد بناؤه دائمًا */
export interface GamificationProfile {
  userId: string;
  currentStreakWeeks: number;
  longestStreakWeeks: number;
  freezesHeld: number;
  leagueTier: 'bronze' | 'silver' | 'gold' | 'ruby' | 'master';
}

export type BadgeRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface Badge {
  code: string;
  nameAr: string;
  nameEn: string;
  descAr: string;
  descEn: string;
  rarity: BadgeRarity;
  icon: string; // ionicons name
  active: boolean;
}

export interface UserBadge {
  userId: string;
  badgeCode: string;
  awardedAt: number;
}

export interface LeagueWeekRow {
  userId: string;
  weekStart: number;
  tier: GamificationProfile['leagueTier'];
  xpWeek: number;
  finalRank?: number;
  outcome?: 'promoted' | 'stayed' | 'relegated';
}

export interface Certificate {
  id: string;
  userId: string;
  batchId: string;
  serial: string;
  issuedAt: number;
  status: 'active' | 'revoked';
  revokedAt?: number;
  revokedBy?: string;
  revokeReason?: string;
  reissuedAt?: number;
  reissuedBy?: string;
  reissueCount?: number;
}

export interface Excuse {
  id: string;
  userId: string;
  sessionId: string;
  reason: string;
  attachment?: string;
  status: 'pending' | 'accepted' | 'rejected';
  note?: string;
  reviewedBy?: string;
  createdAt: number;
}

export interface CourseRating {
  userId: string;
  courseId: string;
  stars: number;
  comment?: string;
  createdAt: number;
}

/** قواعد اللعبة — تُظبط من S49 وتسري فورًا */
export interface GamificationRule {
  key: string;
  value: number | boolean;
  scope: 'global';
  updatedBy: string | null;
  updatedAt: number;
}

export interface AuditEntry {
  id: string;
  actorId: string;
  action: string;
  target: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface KudosQuota {
  instructorId: string;
  month: string; // "2026-8"
  spent: number;
}

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: 'session' | 'excuse' | 'badge' | 'cert' | 'league' | 'broadcast' | 'streak' | 'system';
  read: boolean;
  createdAt: number;
}

export interface PrivateNote {
  instructorId: string;
  userId: string;
  note: string;
  updatedAt: number;
}

/** نموذج القراءة الموحّد للبيانات المسموح بها للمستخدم الحالي. */
export interface Db {
  profiles: Profile[];
  branches: Branch[];
  committees: Committee[];
  courses: Course[];
  batches: Batch[];
  enrollments: Enrollment[];
  sessions: TrainingSession[];
  attendance: Attendance[];
  pointEvents: PointEvent[];
  streakWeeks: StreakWeek[];
  gamification: GamificationProfile[];
  badges: Badge[];
  userBadges: UserBadge[];
  leagueWeeks: LeagueWeekRow[];
  certificates: Certificate[];
  excuses: Excuse[];
  ratings: CourseRating[];
  rules: GamificationRule[];
  audit: AuditEntry[];
  kudosQuotas: KudosQuota[];
  notifications: AppNotification[];
  privateNotes: PrivateNote[];
  certSeq: number;
  seedVersion: number;
}
