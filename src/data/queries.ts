/**
 * data/queries.ts — طبقة البيانات الحقيقية (Supabase Connected)
 * كل الـ queries والـ mutations مع قاعدة البيانات.
 */
import { getSupabase, SUPABASE_ENABLED } from './supabase';

// ═══════════════════════════════════════════════════════════════
// الأنواع
// ═══════════════════════════════════════════════════════════════

export interface BranchInfo {
  id: string;
  name: string;
  governorate: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  facebook_url: string | null;
  avg_rating: number;
  rating_count: number;
}

export interface CourseInfo {
  id: string;
  title: string;
  field: string;
  description: string | null;
  topics: string[];
  sessions_count: number;
  color: string;
  branch_name?: string;
  instructor_name?: string;
  instructor_id?: string;
  avg_rating: number;
  rating_count: number;
  enrolled_count: number;
  capacity: number;
  status: string;
}

export interface BatchInfo {
  id: string;
  course_id: string;
  branch_id: string;
  instructor_id: string | null;
  capacity: number;
  schedule: { days: number[]; time: string; durationMin: number };
  start_date: string | null;
  room: string | null;
  status: string;
  join_code: string | null;
  course_title?: string;
  course_color?: string;
  branch_name?: string;
  instructor_name?: string;
  enrolled_count: number;
}

export interface SessionInfo {
  id: string;
  batch_id: string;
  seq: number;
  title: string | null;
  starts_at: string;
  duration_min: number;
  status: string;
  started_at: string | null;
  closed_at: string | null;
}

export interface StudentInfo {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_color: string;
  attendance_status?: string;
  checked_in_at?: string | null;
  total_attendance?: number;
  total_sessions?: number;
}

export interface AttendanceRecord {
  id: string;
  session_id: string;
  user_id: string;
  status: string;
  checked_in_at: string | null;
  method: string | null;
  student_name?: string;
  student_color?: string;
}

export interface FeedbackEntry {
  id: string;
  user_id: string;
  student_name: string | null;
  stars: number;
  comment: string | null;
  created_at: string;
}

// ═══════════════════════════════════════════════════════════════
// BRANCHES
// ═══════════════════════════════════════════════════════════════

export async function fetchAllBranches(): Promise<BranchInfo[]> {
  if (!SUPABASE_ENABLED) return [];
  const sb = getSupabase();

  const { data, error } = await sb
    .from('branches')
    .select('*')
    .eq('status', 'active')
    .order('name');

  if (error || !data) return [];

  // Get ratings for each branch
  const branches: BranchInfo[] = await Promise.all(
    data.map(async (b: any) => {
      const { data: ratings } = await sb
        .from('organization_ratings')
        .select('stars')
        .eq('branch_id', b.id);

      const avg = ratings && ratings.length > 0
        ? Math.round((ratings.reduce((s: number, r: any) => s + r.stars, 0) / ratings.length) * 10) / 10
        : 0;

      return {
        ...b,
        avg_rating: avg,
        rating_count: ratings?.length ?? 0,
      };
    })
  );

  return branches;
}

// ═══════════════════════════════════════════════════════════════
// COURSES
// ═══════════════════════════════════════════════════════════════

export async function fetchAllCourses(): Promise<CourseInfo[]> {
  if (!SUPABASE_ENABLED) return [];
  const sb = getSupabase();

  const { data, error } = await sb
    .from('courses')
    .select(`
      *,
      batches!inner(
        id,
        capacity,
        branch_id,
        instructor_id,
        status,
        branches(name),
        profiles!instructor_id(full_name)
      )
    `)
    .eq('status', 'published')
    .order('title');

  if (error || !data) return [];

  const courses: CourseInfo[] = await Promise.all(
    data.map(async (c: any) => {
      // Get ratings
      const { data: ratings } = await sb
        .from('course_ratings')
        .select('stars')
        .eq('course_id', c.id);

      const avg = ratings && ratings.length > 0
        ? Math.round((ratings.reduce((s: number, r: any) => s + r.stars, 0) / ratings.length) * 10) / 10
        : 0;

      // Get total enrolled
      const batches = c.batches || [];
      let enrolled = 0;
      let capacity = 0;
      let instructorName = '';
      let instructorId = '';
      let branchName = '';

      for (const b of batches) {
        if (b.status === 'active' || b.status === 'scheduled') {
          capacity += b.capacity || 25;
          const { count } = await sb
            .from('enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('batch_id', b.id);
          enrolled += count || 0;
          if (b.profiles) instructorName = b.profiles.full_name || '';
          if (b.instructor_id) instructorId = b.instructor_id;
          if (b.branches) branchName = b.branches.name || '';
        }
      }

      return {
        id: c.id,
        title: c.title,
        field: c.field,
        description: c.description,
        topics: c.topics || [],
        sessions_count: c.sessions_count,
        color: c.color,
        branch_name: branchName,
        instructor_name: instructorName,
        instructor_id: instructorId,
        avg_rating: avg,
        rating_count: ratings?.length ?? 0,
        enrolled_count: enrolled,
        capacity: capacity,
        status: c.status,
      };
    })
  );

  return courses;
}

export async function fetchCourseDetails(courseId: string): Promise<CourseInfo | null> {
  if (!SUPABASE_ENABLED) return null;
  const sb = getSupabase();

  const { data, error } = await sb
    .from('courses')
    .select('*')
    .eq('id', courseId)
    .single();

  if (error || !data) return null;

  // Get batches
  const { data: batches } = await sb
    .from('batches')
    .select(`
      *,
      branches(name),
      profiles!instructor_id(full_name)
    `)
    .eq('course_id', courseId)
    .in('status', ['scheduled', 'active']);

  let instructorName = '';
  let instructorId = '';
  let branchName = '';
  let enrolled = 0;
  let capacity = 0;

  if (batches) {
    for (const b of batches) {
      capacity += b.capacity || 25;
      const { count } = await sb
        .from('enrollments')
        .select('*', { count: 'exact', head: true })
        .eq('batch_id', b.id);
      enrolled += count || 0;
      if (b.profiles) instructorName = b.profiles.full_name || '';
      if (b.instructor_id) instructorId = b.instructor_id;
      if (b.branches) branchName = b.branches.name || '';
    }
  }

  // Get ratings
  const { data: ratings } = await sb
    .from('course_ratings')
    .select('stars')
    .eq('course_id', courseId);

  const avg = ratings && ratings.length > 0
    ? Math.round((ratings.reduce((s: number, r: any) => s + r.stars, 0) / ratings.length) * 10) / 10
    : 0;

  return {
    id: data.id,
    title: data.title,
    field: data.field,
    description: data.description,
    topics: data.topics || [],
    sessions_count: data.sessions_count,
    color: data.color,
    branch_name: branchName,
    instructor_name: instructorName,
    instructor_id: instructorId,
    avg_rating: avg,
    rating_count: ratings?.length ?? 0,
    enrolled_count: enrolled,
    capacity: capacity,
    status: data.status,
  };
}

// ═══════════════════════════════════════════════════════════════
// BATCHES
// ═══════════════════════════════════════════════════════════════

export async function fetchBatchesForCourse(courseId: string): Promise<BatchInfo[]> {
  if (!SUPABASE_ENABLED) return [];
  const sb = getSupabase();

  const { data, error } = await sb
    .from('batches')
    .select(`
      *,
      courses(title, color),
      branches(name),
      profiles!instructor_id(full_name)
    `)
    .eq('course_id', courseId)
    .in('status', ['scheduled', 'active'])
    .order('start_date');

  if (error || !data) return [];

  return Promise.all(
    data.map(async (b: any) => {
      const { count } = await sb
        .from('enrollments')
        .select('*', { count: 'exact', head: true })
        .eq('batch_id', b.id);

      return {
        id: b.id,
        course_id: b.course_id,
        branch_id: b.branch_id,
        instructor_id: b.instructor_id,
        capacity: b.capacity,
        schedule: b.schedule || { days: [], time: '18:00', durationMin: 120 },
        start_date: b.start_date,
        room: b.room,
        status: b.status,
        join_code: b.join_code,
        course_title: b.courses?.title,
        course_color: b.courses?.color,
        branch_name: b.branches?.name,
        instructor_name: b.profiles?.full_name,
        enrolled_count: count || 0,
      };
    })
  );
}

// ═══════════════════════════════════════════════════════════════
// SESSIONS & ATTENDANCE
// ═══════════════════════════════════════════════════════════════

export async function fetchSessionsForBatch(batchId: string): Promise<SessionInfo[]> {
  if (!SUPABASE_ENABLED) return [];
  const sb = getSupabase();

  const { data, error } = await sb
    .from('sessions')
    .select('*')
    .eq('batch_id', batchId)
    .order('seq');

  return error ? [] : (data || []);
}

export async function fetchStudentsForBatch(batchId: string): Promise<StudentInfo[]> {
  if (!SUPABASE_ENABLED) return [];
  const sb = getSupabase();

  const { data, error } = await sb
    .from('enrollments')
    .select(`
      *,
      profiles!user_id(id, user_id, full_name, email, phone, avatar_color)
    `)
    .eq('batch_id', batchId)
    .eq('status', 'active');

  if (error || !data) return [];

  return data.map((e: any) => ({
    id: e.profiles.id,
    user_id: e.profiles.user_id,
    full_name: e.profiles.full_name,
    email: e.profiles.email,
    phone: e.profiles.phone,
    avatar_color: e.profiles.avatar_color,
  }));
}

export async function fetchAttendanceForSession(sessionId: string): Promise<AttendanceRecord[]> {
  if (!SUPABASE_ENABLED) return [];
  const sb = getSupabase();

  const { data, error } = await sb
    .from('attendance')
    .select(`
      *,
      profiles!user_id(full_name, avatar_color)
    `)
    .eq('session_id', sessionId);

  if (error || !data) return [];

  return data.map((a: any) => ({
    id: a.id,
    session_id: a.session_id,
    user_id: a.user_id,
    status: a.status,
    checked_in_at: a.checked_in_at,
    method: a.method,
    student_name: a.profiles?.full_name,
    student_color: a.profiles?.avatar_color,
  }));
}

// ═══════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════

export async function enrollStudent(userId: string, batchId: string): Promise<boolean> {
  if (!SUPABASE_ENABLED) return false;
  const sb = getSupabase();

  const { error } = await sb.from('enrollments').insert({
    user_id: userId,
    batch_id: batchId,
    status: 'active',
  });

  return !error;
}

export async function createSession(
  batchId: string,
  seq: number,
  title: string,
  startsAt: string,
  durationMin: number
): Promise<string | null> {
  if (!SUPABASE_ENABLED) return null;
  const sb = getSupabase();

  const { data, error } = await sb
    .from('sessions')
    .insert({
      batch_id: batchId,
      seq,
      title,
      starts_at: startsAt,
      duration_min: durationMin,
      status: 'scheduled',
    })
    .select()
    .single();

  return error ? null : data?.id;
}

export async function startSession(sessionId: string): Promise<boolean> {
  if (!SUPABASE_ENABLED) return false;
  const sb = getSupabase();

  const { error } = await sb
    .from('sessions')
    .update({ status: 'live', started_at: new Date().toISOString() })
    .eq('id', sessionId);

  return !error;
}

export async function closeSession(sessionId: string): Promise<boolean> {
  if (!SUPABASE_ENABLED) return false;
  const sb = getSupabase();

  const { error } = await sb
    .from('sessions')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', sessionId);

  return !error;
}

export async function markAttendance(
  sessionId: string,
  userId: string,
  status: 'present' | 'late' | 'absent' | 'excused',
  method: 'manual' | 'qr' | 'code' = 'manual'
): Promise<boolean> {
  if (!SUPABASE_ENABLED) return false;
  const sb = getSupabase();

  // Check if already exists
  const { data: existing } = await sb
    .from('attendance')
    .select('id')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    const { error } = await sb
      .from('attendance')
      .update({ status, method, checked_in_at: new Date().toISOString() })
      .eq('id', existing.id);
    return !error;
  }

  const { error } = await sb
    .from('attendance')
    .insert({
      session_id: sessionId,
      user_id: userId,
      status,
      method,
      checked_in_at: new Date().toISOString(),
    });

  // Award points if present/late
  if (!error && (status === 'present' || status === 'late')) {
    const points = status === 'present' ? 10 : 7;
    await sb.from('point_events').insert({
      user_id: userId,
      points,
      reason_code: `attendance.${status}`,
      ref_type: 'session',
      ref_id: sessionId,
      idempotency_key: `attendance:${sessionId}:${userId}`,
    });
  }

  return !error;
}

export async function createCourse(data: {
  title: string;
  field: string;
  description: string;
  topics: string[];
  sessions_count: number;
  color: string;
}): Promise<string | null> {
  if (!SUPABASE_ENABLED) return null;
  const sb = getSupabase();

  const { data: result, error } = await sb
    .from('courses')
    .insert({ ...data, status: 'published' })
    .select()
    .single();

  return error ? null : result?.id;
}

export async function createBatch(data: {
  course_id: string;
  branch_id: string;
  instructor_id: string;
  capacity: number;
  schedule: object;
  start_date: string;
  room: string;
}): Promise<string | null> {
  if (!SUPABASE_ENABLED) return null;
  const sb = getSupabase();

  const joinCode = `MSR-${Date.now().toString(36).toUpperCase()}`;

  const { data: result, error } = await sb
    .from('batches')
    .insert({ ...data, status: 'scheduled', join_code: joinCode })
    .select()
    .single();

  return error ? null : result?.id;
}

// ═══════════════════════════════════════════════════════════════
// ADMIN QUERIES
// ═══════════════════════════════════════════════════════════════

export async function fetchAllUsers(): Promise<any[]> {
  if (!SUPABASE_ENABLED) return [];
  const sb = getSupabase();

  const { data, error } = await sb
    .from('profiles')
    .select(`
      *,
      branches(name)
    `)
    .order('created_at', { ascending: false });

  return error ? [] : (data || []);
}

export async function fetchAllFeedback(): Promise<any[]> {
  if (!SUPABASE_ENABLED) return [];
  const sb = getSupabase();

  // Course feedback
  const { data: courseFeedback } = await sb
    .from('course_ratings')
    .select(`
      *,
      profiles!user_id(full_name),
      courses(title)
    `)
    .order('created_at', { ascending: false });

  // Instructor feedback
  const { data: instructorFeedback } = await sb
    .from('instructor_ratings')
    .select(`
      *,
      profiles!user_id(full_name),
      profiles!instructor_id(full_name)
    `)
    .order('created_at', { ascending: false });

  // Organization feedback
  const { data: orgFeedback } = await sb
    .from('organization_ratings')
    .select(`
      *,
      profiles!user_id(full_name),
      branches(name)
    `)
    .order('created_at', { ascending: false });

  return {
    course: courseFeedback || [],
    instructor: instructorFeedback || [],
    organization: orgFeedback || [],
  };
}

// ═══════════════════════════════════════════════════════════════
// STUDENT QUERIES
// ═══════════════════════════════════════════════════════════════

export async function fetchMyEnrollments(userId: string): Promise<any[]> {
  if (!SUPABASE_ENABLED) return [];
  const sb = getSupabase();

  const { data, error } = await sb
    .from('enrollments')
    .select(`
      *,
      batches(
        *,
        courses(title, color, sessions_count, field),
        branches(name),
        profiles!instructor_id(full_name)
      )
    `)
    .eq('user_id', userId)
    .eq('status', 'active');

  if (error || !data) return [];

  // For each enrollment, get attendance stats
  return Promise.all(
    data.map(async (e: any) => {
      const batch = e.batches;
      if (!batch) return { ...e, attendance_pct: 0, attended: 0, total: 0 };

      const { data: sessions } = await sb
        .from('sessions')
        .select('id, status')
        .eq('batch_id', batch.id)
        .eq('status', 'closed');

      const total = sessions?.length || 0;

      const { data: att } = await sb
        .from('attendance')
        .select('status')
        .eq('user_id', userId)
        .in('session_id', (sessions || []).map((s: any) => s.id));

      const attended = (att || []).filter((a: any) => a.status !== 'absent').length;
      const pct = total > 0 ? Math.round((attended / total) * 100) : 0;

      return {
        ...e,
        attendance_pct: pct,
        attended,
        total,
      };
    })
  );
}

export async function fetchMyGamification(userId: string): Promise<any> {
  if (!SUPABASE_ENABLED) return { points: 0, streak: 0, level: 1, tier: 'bronze' };
  const sb = getSupabase();

  const { data: points } = await sb
    .from('point_events')
    .select('points')
    .eq('user_id', userId);

  const totalPoints = (points || []).reduce((s: number, p: any) => s + p.points, 0);

  const { data: gam } = await sb
    .from('gamification')
    .select('*')
    .eq('user_id', userId)
    .single();

  const level = totalPoints >= 12000 ? 8 :
    totalPoints >= 6000 ? 7 :
    totalPoints >= 3000 ? 6 :
    totalPoints >= 1500 ? 5 :
    totalPoints >= 700 ? 4 :
    totalPoints >= 300 ? 3 :
    totalPoints >= 100 ? 2 : 1;

  return {
    points: totalPoints,
    streak: gam?.current_streak_weeks || 0,
    longestStreak: gam?.longest_streak_weeks || 0,
    freezes: gam?.freezes_held || 1,
    level,
    tier: gam?.league_tier || 'bronze',
  };
}

export async function fetchMyPointsHistory(userId: string): Promise<any[]> {
  if (!SUPABASE_ENABLED) return [];
  const sb = getSupabase();

  const { data, error } = await sb
    .from('point_events')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(60);

  return error ? [] : (data || []);
}
