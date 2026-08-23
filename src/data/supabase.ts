/**
 * data/supabase.ts — عميل Supabase الحقيقي مع Google OAuth + Phone
 * تم تفعيل الاتصال بقاعدة البيانات الحقيقية
 */
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ═══════════════ الإعدادات ═══════════════
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://udqgaudtclkbaygftndx.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkcWdhdWR0Y2xrYmF5Z2Z0bmR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0NTYyNzUsImV4cCI6MjEwMzAzMjI3NX0.AHe8cNJ8-uGKYbUG2UPJ5w2p54uHtEhpoIYhFcYjco4';

/** هل الاتصال الحقيقي مفعّل؟ */
export const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let _client: SupabaseClient | null = null;

/** الحصول على عميل Supabase (Singleton) */
export function getSupabase(): SupabaseClient {
  if (!_client && SUPABASE_ENABLED) {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  }
  return _client!;
}

// ═══════════════ أنواع البيانات ═══════════════

export interface Profile {
  id: string;
  user_id: string;
  email: string | null;
  phone: string | null;
  full_name: string | null;
  role: 'student' | 'volunteer' | 'supervisor' | 'admin';
  avatar_url: string | null;
  avatar_color: string;
  branch_id: string | null;
  status: 'active' | 'disabled';
  gender: 'm' | 'f' | null;
  joined_at: string;
}

export interface Branch {
  id: string;
  name: string;
  governorate: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  facebook_url: string | null;
  supervisor_id: string | null;
  status: 'active' | 'inactive';
}

export interface Course {
  id: string;
  committee_id: string | null;
  title: string;
  field: string;
  description: string | null;
  topics: string[];
  sessions_count: number;
  status: 'draft' | 'published' | 'archived';
  color: string;
}

export interface GamificationStats {
  points: number;
  streak: number;
  level: number;
  tier: 'bronze' | 'silver' | 'gold' | 'ruby' | 'master';
}

// ═══════════════ Auth Functions ═══════════════

/** الدخول بحساب Google */
export async function signInWithGoogle(): Promise<{ url: string | null; error: string | null }> {
  const sb = getSupabase();
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
    },
  });
  return { url: data?.url ?? null, error: error?.message ?? null };
}

/** إضافة/تحديث رقم الهاتف بعد تسجيل الدخول بـ Google */
export async function updatePhoneNumber(phone: string): Promise<{ success: boolean; error: string | null }> {
  const sb = getSupabase();
  const { error } = await sb.auth.updateUser({
    phone: `+20${phone}`,
  });
  return { success: !error, error: error?.message ?? null };
}

/** الحصول على المستخدم الحالي */
export async function getCurrentUser(): Promise<User | null> {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  return user;
}

/** الحصول على البروفايل الكامل */
export async function getProfile(userId: string): Promise<Profile | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .single();
  
  if (error) return null;
  return data;
}

/** تسجيل الخروج */
export async function signOut(): Promise<void> {
  const sb = getSupabase();
  await sb.auth.signOut();
}

// ═══════════════ Data Fetching ═══════════════

/** جلب كل الفروع */
export async function getBranches(): Promise<Branch[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('branches')
    .select('*')
    .eq('status', 'active')
    .order('name');
  
  return error ? [] : (data ?? []);
}

/** جلب الكورسات المنشورة */
export async function getCourses(): Promise<Course[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('courses')
    .select('*')
    .eq('status', 'published')
    .order('title');
  
  return error ? [] : (data ?? []);
}

/** جلب المجموعات (batches) لكورس معين */
export async function getBatchesForCourse(courseId: string): Promise<any[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('batches')
    .select(`
      *,
      courses(title, field),
      branches(name),
      profiles!instructor_id(full_name)
    `)
    .eq('course_id', courseId)
    .in('status', ['scheduled', 'active'])
    .order('start_date', { ascending: true });
  
  return error ? [] : (data ?? []);
}

/** جلب الجلسات لمجموعة معينة */
export async function getSessionsForBatch(batchId: string): Promise<any[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('sessions')
    .select('*')
    .eq('batch_id', batchId)
    .order('seq');
  
  return error ? [] : (data ?? []);
}

/** جلب إحصائيات الجيميفيكيشن للمستخدم */
export async function getUserGamification(userId: string): Promise<GamificationStats | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .rpc('get_user_gamification', { p_user_id: userId });
  
  return error ? null : data;
}

/** تسجيل الحضور */
export async function checkInSession(
  sessionId: string,
  userId: string,
  method: 'qr' | 'code' | 'manual' = 'qr'
): Promise<{ success: boolean; points?: number; status?: string; error?: string }> {
  const sb = getSupabase();
  const { data, error } = await sb
    .rpc('check_in_session', {
      p_session_id: sessionId,
      p_user_id: userId,
      p_method: method,
    });
  
  if (error) return { success: false, error: error.message };
  return data;
}

// ═══════════════ Rating Functions (NEW!) ═══════════════

/** تقييم كورس */
export async function rateCourse(
  userId: string,
  courseId: string,
  stars: number,
  comment?: string
): Promise<{ success: boolean; error: string | null }> {
  const sb = getSupabase();
  const { error } = await sb
    .from('course_ratings')
    .insert({
      user_id: userId,
      course_id: courseId,
      stars,
      comment,
    });
  
  return { success: !error, error: error?.message ?? null };
}

/** تقييم مدرب */
export async function rateInstructor(
  userId: string,
  instructorId: string,
  batchId: string,
  stars: number,
  comment?: string
): Promise<{ success: boolean; error: string | null }> {
  const sb = getSupabase();
  const { error } = await sb
    .from('instructor_ratings')
    .insert({
      user_id: userId,
      instructor_id: instructorId,
      batch_id: batchId,
      stars,
      comment,
    });
  
  return { success: !error, error: error?.message ?? null };
}

/** تقييم فرع/تنظيم */
export async function rateOrganization(
  userId: string,
  branchId: string,
  stars: number,
  comment?: string
): Promise<{ success: boolean; error: string | null }> {
  const sb = getSupabase();
  const { error } = await sb
    .from('organization_ratings')
    .insert({
      user_id: userId,
      branch_id: branchId,
      stars,
      comment,
    });
  
  return { success: !error, error: error?.message ?? null };
}

/** جلب متوسط تقييم كورس */
export async function getCourseRating(courseId: string): Promise<{ avg: number; count: number }> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('course_ratings')
    .select('stars')
    .eq('course_id', courseId);
  
  if (error || !data || data.length === 0) return { avg: 0, count: 0 };
  
  const avg = data.reduce((sum, r) => sum + r.stars, 0) / data.length;
  return { avg: Math.round(avg * 10) / 10, count: data.length };
}

/** جلب متوسط تقييم مدرب */
export async function getInstructorRating(instructorId: string): Promise<{ avg: number; count: number }> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('instructor_ratings')
    .select('stars')
    .eq('instructor_id', instructorId);
  
  if (error || !data || data.length === 0) return { avg: 0, count: 0 };
  
  const avg = data.reduce((sum, r) => sum + r.stars, 0) / data.length;
  return { avg: Math.round(avg * 10) / 10, count: data.length };
}

/** جلب متوسط تقييم فرع */
export async function getBranchRating(branchId: string): Promise<{ avg: number; count: number }> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('organization_ratings')
    .select('stars')
    .eq('branch_id', branchId);
  
  if (error || !data || data.length === 0) return { avg: 0, count: 0 };
  
  const avg = data.reduce((sum, r) => sum + r.stars, 0) / data.length;
  return { avg: Math.round(avg * 10) / 10, count: data.length };
}

// ═══════════════ Realtime Subscriptions ═══════════════

/** الاشتراك في تحديثات الحضور لجلسة معينة */
export function subscribeAttendance(sessionId: string, callback: (payload: any) => void) {
  const sb = getSupabase();
  const channel = sb
    .channel(`attendance:${sessionId}`)
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'attendance', 
      filter: `session_id=eq.${sessionId}` 
    }, callback)
    .subscribe();
  
  return () => { sb.removeChannel(channel); };
}

/** الاشتراك في الإشعارات للمستخدم */
export function subscribeNotifications(userId: string, callback: (payload: any) => void) {
  const sb = getSupabase();
  const channel = sb
    .channel(`notifications:${userId}`)
    .on('postgres_changes', { 
      event: 'INSERT', 
      schema: 'public', 
      table: 'notifications', 
      filter: `user_id=eq.${userId}` 
    }, callback)
    .subscribe();
  
  return () => { sb.removeChannel(channel); };
}

// ═══════════════ Helper Functions ═══════════════

/** التحقق من صلاحيات الأدمن */
export async function isAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  
  const profile = await getProfile(user.id);
  return profile?.role === 'admin';
}

/** التحقق من صلاحيات المدرب/المتطوع */
export async function isVolunteer(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  
  const profile = await getProfile(user.id);
  return profile?.role === 'volunteer' || profile?.role === 'supervisor' || profile?.role === 'admin';
}
