/**
 * data/domain.ts — focused query layer to avoid full database fetches.
 * Each function returns only the data needed for specific UI/components.
 * Additionally, we provide functions to fetch full tables (with necessary columns) for use in refresh.
 */

import { getSupabase } from './supabase';
import type { Database } from '../types/database';
import type { Profile, Batch, Course, TrainingSession, GamificationProfile } from './types';

// ───────────────────────────── UI-focused queries ─────────────────────────────

/**
 * Get course overview with essential fields only.
 */
export async function getCourseOverview(courseId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('courses')
    .select('id, title, field, description, topics, sessionsCount, status, color')
    .eq('id', courseId)
    .single();

  if (error) throw error;
  return data as Course | null;
}

/**
 * Get batch roster: enrolled users with profile data for the batch.
 */
export async function getBatchRoster(batchId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('enrollments')
    .select(`
      userId,
      joinedAt,
      status,
      profiles!inner (
        id, fullName, avatarUrl, avatarColor, role, branchId
      )
    `)
    .eq('batchId', batchId)
    .eq('status', 'active');

  if (error) throw error;
  return data as { userId: string; joinedAt: string; status: string; profiles: Profile }[] | [];
}

/**
 * Get batch sessions with attendance statistics.
 */
export async function getBatchSessions(batchId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('sessions')
    .select(`
      id, seq, title, startsAt, durationMin, status, startedAt, closedAt,
      attendance!left (userId, status, checkedInAt)
    `)
    .eq('batchId', batchId)
    .order('seq', { ascending: true });

  if (error) throw error;
  return data as {
    id: string;
    seq: number;
    title: string;
    startsAt: string | null;
    durationMin: number | null;
    status: string;
    startedAt: string | null;
    closedAt: string | null;
    attendance: { userId: string; status: string; checkedInAt: string | null }[] | null;
  }[] | [];
}

/**
 * Get session roster: attendees for session with status info.
 */
export async function getSessionRoster(sessionId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('attendance')
    .select(`
      userId, status, checkedInAt,
      profiles!inner (id, fullName, avatarUrl, avatarColor)
    `)
    .eq('sessionId', sessionId);

  if (error) throw error;
  return data as {
    userId: string;
    status: string;
    checkedInAt: string | null;
    profiles: { id: string; fullName: string; avatarUrl: string | null; avatarColor: string };
  }[] | [];
}

/**
 * Get user's gamification data using read-only gamifGet (safe for rendering).
 * Note: This function is a placeholder; actual gamifGet is in engine.ts.
 * We'll import and use it from store where engine is available.
 */
export async function getMyGamificationSafe(userId: string) {
  // This will be implemented in store.tsx where we have access to engine functions
  // For now, we return null; store will call engine.gamifGet directly
  return null;
}

/**
 * Get active batches for user with course/batch data.
 */
export async function getActiveBatchesForUser(userId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('enrollments')
    .select(`
      batchId, joinedAt, status,
      batches!inner (
        id, courseId, branchId, capacity, joinCode, geofenceEnabled,
        latitude, longitude, radiusM, startDate, status,
        courses!inner (id, title, field, color)
      )
    `)
    .eq('userId', userId)
    .eq('status', 'active');

  if (error) throw error;
  return data as {
    batchId: string;
    joinedAt: string;
    status: string;
    batches: {
      id: string;
      courseId: string;
      branchId: string;
      capacity: number | null;
      joinCode: string | null;
      geofenceEnabled: boolean;
      latitude: number | null;
      longitude: number | null;
      radiusM: number | null;
      startDate: string | null;
      status: string;
      courses: {
        id: string;
        title: string;
        field: string;
        color: string;
      };
    };
  }[] | [];
}

/**
 * Get upcoming sessions for user with course info.
 */
export async function getUpcomingSessions(userId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('enrollments')
    .select(`
      batchId,
      batches!inner (
        id,
        courses!inner (id, title),
        sessions!inner (
          id, seq, title, startsAt, durationMin, status
        )
      )
    `)
    .eq('userId', userId)
    .eq('status', 'active')
    .gt('batches.sessions.startsAt', new Date().toISOString()) // future sessions
    .order('batches.sessions.startsAt', { ascending: true });

  if (error) throw error;
  // Need to flatten the structure; we'll do a simple map for now
  return data as {
    batchId: string;
    batches: {
      id: string;
      courses: { id: string; title: string };
      sessions: { id: string; seq: number; title: string; startsAt: string | null; durationMin: number | null; status: string }[];
    };
  }[] | [];
}

// ───────────────────────────── Full table queries (for refresh) ─────────────────────────────

/**
 * Fetch all profiles with necessary columns.
 */
export async function getAllProfiles() {
  const sb = getSupabase();
  const { data, error } = await sb.rpc('list_visible_profiles');
  if (error) throw error;
  return data as any[]; // We'll map in refresh
}

/**
 * Fetch all branches.
 */
export async function getAllBranches() {
  const sb = getSupabase();
  const { data, error } = await sb.from('branches').select('id, name, governorate, address, supervisor_id');
  if (error) throw error;
  return data as any[];
}

/**
 * Fetch all committees.
 */
export async function getAllCommittees() {
  const sb = getSupabase();
  const { data, error } = await sb.from('committees').select('id, branch_id, name');
  if (error) throw error;
  return data as any[];
}

/**
 * Fetch all courses.
 */
export async function getAllCourses() {
  const sb = getSupabase();
  const { data, error } = await sb.from('courses').select('id, owner_id, committee_id, title, field, description, topics, sessions_count, status, color');
  if (error) throw error;
  return data as any[];
}

/**
 * Fetch all batches.
 */
export async function getAllBatches() {
  const sb = getSupabase();
  const { data, error } = await sb.from('batches').select('id, course_id, branch_id, instructor_id, capacity, start_date, room, status, join_code, geofence_enabled, latitude, longitude, radius_m');
  if (error) throw error;
  return data as any[];
}

/**
 * Fetch all enrollments.
 */
export async function getAllEnrollments() {
  const sb = getSupabase();
  const { data, error } = await sb.from('enrollments').select('user_id, batch_id, status, joined_at');
  if (error) throw error;
  return data as any[];
}

/**
 * Fetch all sessions.
 */
export async function getAllSessions() {
  const sb = getSupabase();
  const { data, error } = await sb.from('sessions').select('id, batch_id, seq, title, starts_at, duration_min, status, started_at, closed_at, report');
  if (error) throw error;
  return data as any[];
}

/**
 * Fetch all attendance.
 */
export async function getAllAttendance() {
  const sb = getSupabase();
  const { data, error } = await sb.from('attendance').select('session_id, user_id, status, checked_in_at, method, note');
  if (error) throw error;
  return data as any[];
}

/**
 * Fetch all point events.
 */
export async function getAllPointEvents() {
  const sb = getSupabase();
  const { data, error } = await sb.from('point_events').select('id, user_id, points, reason_code, ref_type, ref_id, awarded_by, idempotency_key, created_at');
  if (error) throw error;
  return data as any[];
}

/**
 * Fetch all streak weeks.
 */
export async function getAllStreakWeeks() {
  const sb = getSupabase();
  const { data, error } = await sb.from('streak_weeks').select('user_id, week_start, status, sessions_total, sessions_honored, freeze_used');
  if (error) throw error;
  return data as any[];
}

/**
 * Fetch all gamification profiles.
 */
export async function getAllGamification() {
  const sb = getSupabase();
  const { data, error } = await sb.from('gamification').select('user_id, current_streak_weeks, longest_streak_weeks, freezes_held, league_tier');
  if (error) throw error;
  return data as any[];
}

/**
 * Fetch all badges.
 */
export async function getAllBadges() {
  const sb = getSupabase();
  const { data, error } = await sb.from('badges').select('code, name_ar, name_en, desc_ar, desc_en, rarity, icon, active');
  if (error) throw error;
  return data as any[];
}

/**
 * Fetch all user badges.
 */
export async function getAllUserBadges() {
  const sb = getSupabase();
  const { data, error } = await sb.from('user_badges').select('user_id, badge_code, awarded_at');
  if (error) throw error;
  return data as any[];
}

/**
 * Fetch all league weeks.
 */
export async function getAllLeagueWeeks() {
  const sb = getSupabase();
  const { data, error } = await sb.from('league_weeks').select('user_id, week_start, tier, xp_week, final_rank, outcome');
  if (error) throw error;
  return data as any[];
}

/**
 * Fetch all certificates.
 */
export async function getAllCertificates() {
  const sb = getSupabase();
  const { data, error } = await sb.from('certificates').select('id, user_id, batch_id, serial, issued_at, status, revoked_at, revoked_by, revoke_reason, reissued_at, reissued_by, reissue_count');
  if (error) throw error;
  return data as any[];
}

/**
 * Fetch all excuses.
 */
export async function getAllExcuses() {
  const sb = getSupabase();
  const { data, error } = await sb.from('excuses').select('id, user_id, session_id, reason, attachment_url, status, note, reviewed_by, created_at');
  if (error) throw error;
  return data as any[];
}

/**
 * Fetch all course ratings.
 */
export async function getAllRatings() {
  const sb = getSupabase();
  const { data, error } = await sb.from('course_ratings').select('user_id, course_id, stars, comment, created_at');
  if (error) throw error;
  return data as any[];
}

/**
 * Fetch all gamification rules.
 */
export async function getAllRules() {
  const sb = getSupabase();
  const { data, error } = await sb.from('gamification_rules').select('key, value');
  if (error) throw error;
  return data as any[];
}

/**
 * Fetch all audit log (recent).
 */
export async function getAllAudit() {
  const sb = getSupabase();
  const { data, error } = await sb.from('audit_log').select('id, actor_id, action, target, payload, created_at');
  if (error) throw error;
  return data as any[];
}

/**
 * Fetch all kudos quotas.
 */
export async function getAllKudosQuotas() {
  const sb = getSupabase();
  const { data, error } = await sb.from('kudos_quotas').select('instructor_id, month, spent');
  if (error) throw error;
  return data as any[];
}

/**
 * Fetch all notifications.
 */
export async function getAllNotifications() {
  const sb = getSupabase();
  const { data, error } = await sb.from('notifications').select('id, user_id, title, body, type, read, created_at');
  if (error) throw error;
  return data as any[];
}

/**
 * Fetch all private notes.
 */
export async function getAllPrivateNotes() {
  const sb = getSupabase();
  const { data, error } = await sb.from('private_notes').select('id, instructor_id, user_id, note, updated_at');
  if (error) throw error;
  return data as any[];
}

/**
 * Fetch all course roles.
 */
export async function getAllCourseRoles() {
  const sb = getSupabase();
  const { data, error } = await sb.from('course_roles').select('id, course_id, user_id, role, created_at');
  if (error) throw error;
  return data as any[];
}