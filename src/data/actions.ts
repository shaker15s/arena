import { getSupabase } from './supabase';
import type { Role } from './types';

export class ActionError extends Error {
  constructor(message: string, public code = 'action_failed') {
    super(message);
    this.name = 'ActionError';
  }
}

function messageOf(error: { message?: string; code?: string } | null, fallback: string): never {
  throw new ActionError(error?.message ?? fallback, error?.code ?? fallback);
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(name, args);
  if (error) messageOf(error, name);
  return data as T;
}

export interface CheckInResponse {
  kind: 'ok' | 'already' | 'expired' | 'too_late' | 'no_session' | 'not_enrolled' | 'invalid' | 'rate_limited' | 'location_required' | 'offsite';
  status?: 'present' | 'late';
  points?: number;
  session_id?: string;
}

export interface SessionQrPayload {
  token: string;
  backup_code: string;
  expires_at: number;
}

export interface CloseSessionResponse {
  ok: boolean;
  present: number;
  late: number;
  absent: number;
  excused: number;
  total: number;
}

export async function completeMyProfile(input: {
  fullName: string;
  phone: string;
  avatarUrl: string | null;
  branchId: string | null;
  gender: 'm' | 'f';
}): Promise<{ ok: boolean; profile_id: string }> {
  return rpc('complete_my_profile', {
    p_full_name: input.fullName,
    p_phone: input.phone,
    p_avatar_url: input.avatarUrl,
    p_branch_id: input.branchId,
    p_gender: input.gender,
  });
}

export async function updateMyProfile(input: { fullName: string; phone: string; avatarUrl: string | null }): Promise<void> {
  await rpc('update_my_profile', {
    p_full_name: input.fullName,
    p_phone: input.phone,
    p_avatar_url: input.avatarUrl,
  });
}

/** ملاحظة خاصة من مدرب لطالب — RPC خادمية (لا تتجاوز RLS عبر pushDelta). */
export async function savePrivateNote(studentId: string, note: string): Promise<void> {
  await rpc('save_private_note', { p_user_id: studentId, p_note: note });
}

/** تسجيل توكن الجهاز (Expo Push) لاستقبال الإشعارات — يُستدعى على الأجهزة فقط. */
export async function registerPushToken(token: string, platform: 'android' | 'ios' | 'web' | 'unknown' = 'unknown'): Promise<void> {
  await rpc('register_push_token', { p_token: token, p_platform: platform });
}

/** إلغاء تسجيل توكن الجهاز (عند تسجيل الخروج/الحذف). */
export async function unregisterPushToken(token: string): Promise<void> {
  await rpc('unregister_push_token', { p_token: token });
}

export async function updateUserAccess(
  profileId: string,
  patch: { role?: Role; status?: 'active' | 'disabled'; branchId?: string | null },
): Promise<void> {
  await rpc('admin_update_user_access', {
    p_profile_id: profileId,
    p_role: patch.role ?? null,
    p_status: patch.status ?? null,
    p_branch_id: patch.branchId !== undefined ? patch.branchId : null,
  });
}

export async function joinBatch(batchId: string): Promise<{ status: 'active' | 'waitlist'; already: boolean }> {
  return rpc('join_batch', { p_batch_id: batchId });
}

export async function joinBatchByCode(code: string): Promise<{ batchId: string; status: 'active' | 'waitlist'; already: boolean }> {
  const result = await rpc<{ batch_id: string; status: 'active' | 'waitlist'; already: boolean }>('join_batch_by_code', {
    p_join_code: code.trim(),
  });
  return { batchId: result.batch_id, status: result.status, already: result.already };
}

export async function startTrainingSession(batchId: string): Promise<{ session_id: string; already: boolean }> {
  return rpc('start_training_session', { p_batch_id: batchId });
}

export async function getSessionQrPayload(sessionId: string): Promise<SessionQrPayload> {
  return rpc('get_session_qr_payload', { p_session_id: sessionId });
}

export async function checkInWithToken(payload: string, lat?: number, lng?: number): Promise<CheckInResponse> {
  // نمرّر الإحداثيات للخادم متى توفرت — الخادم هو من يقرّر القبول (geofence).
  return rpc<CheckInResponse>('check_in_with_token', { p_payload: payload, p_lat: lat ?? null, p_lng: lng ?? null });
}

export async function manualMarkAttendance(input: {
  sessionId: string;
  userId: string;
  status: 'present' | 'late';
  reason: string;
}): Promise<void> {
  await rpc('manual_mark_attendance', {
    p_session_id: input.sessionId,
    p_user_id: input.userId,
    p_status: input.status,
    p_reason: input.reason,
  });
}

export async function closeTrainingSession(
  sessionId: string,
  report: { done: string; planned: string; challenges: string; submittedAt: number },
): Promise<CloseSessionResponse> {
  return rpc('close_training_session', { p_session_id: sessionId, p_report: report });
}

export async function createBranch(input: { name: string; governorate: string; address?: string }): Promise<string> {
  const result = await rpc<{ id: string }>('create_branch', {
    p_name: input.name,
    p_governorate: input.governorate,
    p_address: input.address ?? null,
  });
  return result.id;
}

export async function createCommittee(branchId: string, name: string): Promise<string> {
  const result = await rpc<{ id: string }>('create_committee', { p_branch_id: branchId, p_name: name });
  return result.id;
}

export async function createCourse(input: {
  committeeId?: string | null;
  title: string;
  field: string;
  description?: string;
  topics: string[];
  sessionsCount: number;
  color: string;
}): Promise<string> {
  const result = await rpc<{ id: string }>('create_course', {
    p_committee_id: input.committeeId ?? null,
    p_title: input.title,
    p_field: input.field,
    p_description: input.description ?? '',
    p_topics: input.topics,
    p_sessions_count: input.sessionsCount,
    p_color: input.color,
  });
  return result.id;
}

export async function updateCourse(input: {
  courseId: string;
  title: string;
  field: string;
  description?: string;
  topics: string[];
  sessionsCount: number;
}): Promise<void> {
  await rpc('update_course_details', {
    p_course_id: input.courseId,
    p_title: input.title,
    p_field: input.field,
    p_description: input.description ?? '',
    p_topics: input.topics,
    p_sessions_count: input.sessionsCount,
  });
}

export interface NewSessionInput {
  seq: number;
  title: string;
  starts_at: string;
  duration_min: number;
}

export interface NewBatchInput {
  courseId: string;
  branchId: string;
  instructorId: string;
  capacity: number;
  schedule: { days: number[]; time: string; durationMin: number };
  startDate: string;
  room: string;
  sessions: NewSessionInput[];
}

export async function createBatchWithSessions(input: NewBatchInput): Promise<{ batchId: string; joinCode: string }> {
  const result = await rpc<{ batch_id: string; join_code: string }>('create_batch_with_sessions', {
    p_course_id: input.courseId,
    p_branch_id: input.branchId,
    p_instructor_id: input.instructorId,
    p_capacity: input.capacity,
    p_schedule: input.schedule,
    p_start_date: input.startDate,
    p_room: input.room,
    p_sessions: input.sessions,
  });
  return { batchId: result.batch_id, joinCode: result.join_code };
}

export async function updateGamificationRule(key: string, value: number): Promise<void> {
  await rpc('update_gamification_rule', { p_key: key, p_value: value });
}

export async function setBadgeActive(code: string, active: boolean): Promise<void> {
  await rpc('set_badge_active', { p_code: code, p_active: active });
}

export async function bootstrapOrganization(payload: Record<string, unknown>): Promise<{ batchId: string; joinCode: string }> {
  const result = await rpc<{ batch_id: string; join_code: string }>('bootstrap_organization', { p_payload: payload });
  return { batchId: result.batch_id, joinCode: result.join_code };
}

export async function submitExcuse(input: { sessionId: string; reason: string; attachmentUrl?: string }): Promise<string> {
  const result = await rpc<{ id: string }>('submit_excuse', {
    p_session_id: input.sessionId,
    p_reason: input.reason,
    p_attachment_url: input.attachmentUrl ?? null,
  });
  return result.id;
}

export async function reviewExcuse(input: {
  excuseId: string;
  decision: 'accepted' | 'rejected';
  note?: string;
}): Promise<void> {
  await rpc('review_excuse', {
    p_excuse_id: input.excuseId,
    p_decision: input.decision,
    p_note: input.note ?? null,
  });
}

export async function submitCourseRating(input: { courseId: string; stars: number; comment?: string }): Promise<void> {
  await rpc('submit_course_rating', {
    p_course_id: input.courseId,
    p_stars: input.stars,
    p_comment: input.comment ?? null,
  });
}

export async function awardKudos(input: {
  studentId: string;
  batchId: string;
  points: number;
  reason: string;
  idempotencyKey: string;
}): Promise<number> {
  const result = await rpc<{ left: number }>('award_kudos', {
    p_student_id: input.studentId,
    p_batch_id: input.batchId,
    p_points: input.points,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
  });
  return result.left;
}

export async function issueBatchCertificates(batchId: string): Promise<number> {
  const result = await rpc<{ issued: number }>('issue_batch_certificates', { p_batch_id: batchId });
  return result.issued;
}

export interface VerifiedCertificate {
  serial: string;
  status?: 'active' | 'revoked';
  issued_at: string;
  student_name: string;
  course_title: string;
  branch_name: string;
}

export async function verifyCertificate(serial: string): Promise<VerifiedCertificate | null> {
  return rpc<VerifiedCertificate | null>('verify_certificate', { p_serial: serial.trim() });
}

/** إلغاء شهادة (مدير فقط) — يوقف التحقق العام على سيريالها. */
export async function revokeCertificate(certificateId: string, reason: string): Promise<void> {
  await rpc('revoke_certificate', { p_certificate_id: certificateId, p_reason: reason });
}

/** إعادة إصدار شهادة ملغاة (مدير فقط) — تُعاد بسيريال جديد. */
export async function reissueCertificate(certificateId: string): Promise<{ serial: string }> {
  return rpc<{ serial: string }>('reissue_certificate', { p_certificate_id: certificateId });
}

export async function sendBroadcast(input: {
  scope: 'all' | 'branch' | 'batch';
  scopeId?: string;
  title: string;
  body: string;
}): Promise<number> {
  const result = await rpc<{ reached: number }>('broadcast_notifications', {
    p_scope: input.scope,
    p_scope_id: input.scopeId ?? null,
    p_title: input.title,
    p_body: input.body,
  });
  return result.reached;
}

export async function submitSupportRequest(input: {
  kind: 'course_request' | 'role_request' | 'support';
  subject: string;
  body: string;
  recipientId?: string;
}): Promise<string> {
  const result = await rpc<{ id: string }>('submit_support_request', {
    p_kind: input.kind,
    p_subject: input.subject,
    p_body: input.body,
    p_recipient_id: input.recipientId ?? null,
  });
  return result.id;
}

export async function reviewSupportRequest(input: {
  requestId: string;
  status: 'in_review' | 'resolved' | 'rejected';
  response: string;
}): Promise<void> {
  await rpc('review_support_request', {
    p_request_id: input.requestId,
    p_status: input.status,
    p_response: input.response,
  });
}

export interface SupportRequestRow {
  id: string;
  sender_id: string;
  recipient_id: string | null;
  kind: 'course_request' | 'role_request' | 'support';
  subject: string;
  body: string;
  status: 'open' | 'in_review' | 'resolved' | 'rejected';
  response: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export async function fetchSupportRequests(): Promise<SupportRequestRow[]> {
  const { data, error } = await getSupabase()
    .from('support_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(250);
  if (error) messageOf(error, 'fetch_support_requests');
  return (data ?? []) as SupportRequestRow[];
}

// ───────────────────────────── Batch B: account / waitlist / reports / analytics ─────────────────────────────

/** حذف الحساب نهائيًا على الخادم (يتطلب كتابة كلمة التأكيد DELETE). */
export async function deleteMyAccount(confirm: string): Promise<void> {
  await rpc('delete_my_account', { p_confirm: confirm });
}

/** مغادرة مجموعة (يحرر مقعدًا ويُرقّي قائمة الانتظار فورًا). */
export async function leaveBatch(batchId: string): Promise<void> {
  await rpc('leave_batch', { p_batch_id: batchId });
}

/** إزالة طالب من مجموعة (مدير/مدرب) ثم ترقية قائمة الانتظار. */
export async function removeFromBatch(batchId: string, userId: string): Promise<void> {
  await rpc('remove_from_batch', { p_batch_id: batchId, p_user_id: userId });
}

export interface SessionReportData {
  session_id: string;
  title: string | null;
  starts_at: string | null;
  expected: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  total: number;
  report?: { done?: string; planned?: string; challenges?: string; submittedAt?: number } | null;
}

/** تقرير جلسة موثّق خادميًا (المدرب/المشرف فقط). */
export async function getSessionReport(sessionId: string): Promise<SessionReportData> {
  return rpc<SessionReportData>('get_session_report', { p_session_id: sessionId });
}

/** إشعار المتغيبين عن جلسة مغلقة (idempotent). */
export async function notifySessionAbsentees(sessionId: string): Promise<{ notified: number }> {
  const result = await rpc<{ notified: number }>('notify_session_absentees', { p_session_id: sessionId });
  return { notified: result.notified };
}

export type AnalyticsScope = 'branch' | 'course' | 'batch' | 'session';

export interface AnalyticsResult {
  scope: AnalyticsScope;
  scope_id: string | null;
  sessions: number;
  enrollments: number;
  attendance: number;
  attendanceRatio: number;
}

/** تحليلات خادمية بمدى محدد (branch/course/batch/session) — تتحقق الصلاحية على الخادم. */
export async function getAnalytics(scope: AnalyticsScope, scopeId?: string | null): Promise<AnalyticsResult> {
  return rpc<AnalyticsResult>('get_analytics', { p_scope: scope, p_scope_id: scopeId ?? null });
}

// ───────────── Domain query layer (P0, 0012) — ask the server for one object ─────────────

export interface BatchRosterRow {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  avatar_color: string | null;
  email: string | null;
  phone: string | null;
  status: 'active' | 'waitlist' | 'completed';
  joined_at: string | null;
  attended: number;
  absent: number;
}

export interface CourseOverviewBatch {
  id: string;
  branch_id: string;
  instructor_id: string | null;
  capacity: number | null;
  room: string | null;
  status: string;
  join_code: string | null;
  start_date: string | null;
  schedule: unknown;
  enrolled: number;
  waitlist: number;
  attendance: number;
  attendancePct: number;
}

export interface BatchSessionRow {
  id: string;
  seq: number;
  title: string | null;
  starts_at: string;
  duration_min: number | null;
  status: 'scheduled' | 'live' | 'closed';
  report?: unknown;
  present: number;
  absent: number;
  excused: number;
}

export interface SessionRosterRow {
  id: string;
  user_id: string;
  full_name: string | null;
  status: 'present' | 'late' | 'absent' | 'excused';
  checked_in_at: string | null;
  method: 'qr' | 'code' | 'manual' | null;
  note: string | null;
}

/** نظرة عامة على الكورس: الكورس + مجموعاته (حضور/اشتراكات محسوبة خادميًا). */
export async function getCourseOverview(courseId: string): Promise<{ course: Record<string, unknown>; batches: CourseOverviewBatch[] }> {
  return rpc('get_course_overview', { p_course_id: courseId });
}

/** كشف طلاب مجموعة — PII مخفي إلا للمدير/المشرف/المدرب المالك. */
export async function getBatchRoster(batchId: string): Promise<{ batch: Record<string, unknown>; students: BatchRosterRow[] }> {
  return rpc('get_batch_roster', { p_batch_id: batchId });
}

/** جلسات مجموعة مع ملخص حضور كل جلسة. */
export async function getBatchSessions(batchId: string): Promise<BatchSessionRow[]> {
  return rpc('get_batch_sessions', { p_batch_id: batchId });
}

/** كشف حضور جلسة واحدة. */
export async function getSessionRoster(sessionId: string): Promise<SessionRosterRow[]> {
  return rpc('get_session_roster', { p_session_id: sessionId });
}

// ───────────── Offline write queue (P0 #3, 0013) — idempotent command log ─────────────

export interface CommandStatus {
  ok: boolean;
  command_id: string;
  status: 'pending' | 'applied' | 'failed';
}

/** سجّل أمرًا في قاعدة الأوامر (idempotent — إعادة المحاولة لا تُدخل تكرارًا). */
export async function enqueueCommandOnServer(commandId: string, command: string, payload: Record<string, unknown> = {}): Promise<CommandStatus> {
  return rpc<CommandStatus>('enqueue_command', {
    p_command_id: commandId, p_command: command, p_payload: payload,
  });
}

/** علّم أمرًا منفّذًا (أو فاشلًا) على الخادم. */
export async function finishCommandOnServer(commandId: string, status: 'applied' | 'failed'): Promise<void> {
  await rpc('finish_command', { p_command_id: commandId, p_status: status });
}

export interface RunCommandResult {
  ok: boolean;
  command_id: string;
  status: 'applied' | 'failed';
  already?: boolean;
  deduped?: boolean;
  error?: string;
}

/**
 * تنفيذ أمر مؤجل ذرّيًا على الخادم (0015): تسجيل + تنفيذ فعلي عبر نفس
 * RPCs المدققة. إعادة الاستدعاء بنفس المعرف تعيد النتيجة المسجلة بلا تكرار.
 */
export async function runCommandOnServer(
  commandId: string,
  command: string,
  payload: Record<string, unknown> = {},
  deviceCreatedAt?: number,
): Promise<RunCommandResult> {
  return rpc<RunCommandResult>('run_command', {
    p_command_id: commandId,
    p_command: command,
    p_payload: payload,
    p_device_created_at: deviceCreatedAt ? new Date(deviceCreatedAt).toISOString() : null,
  });
}

/**
 * تعليم كل إشعارات المستخدم الحالي كمقروءة — RPC خادمية (0014).
 * كان المسار القديم upsert مباشرًا على `notifications` وترفضه RLS
 * (لا توجد سياسة INSERT منذ 0005) فيفشل مع toast خطأ في كل زيارة.
 */
export async function markMyNotificationsRead(): Promise<{ ok: boolean; updated: number }> {
  return rpc('mark_notifications_read');
}
