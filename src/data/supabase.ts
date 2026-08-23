/**
 * data/supabase.ts — عميل Supabase الحقيقي (مصدر الحقيقة الوحيد للاتصال).
 * الاعتماد على متغيرات البيئة فقط — ممنوع أي مفاتيح أو بيانات وهمية داخل الكود.
 *
 *   EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
 */
import { Platform } from 'react-native';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

// ═══════════════ الإعدادات ═══════════════
export const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
export const SUPABASE_ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

/** هل الاتصال الحقيقي مُهيّأ؟ (بدون مفاتيح → التطبيق يطلب الإعداد ولا يعرض بيانات وهمية) */
export const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let _client: SupabaseClient | null = null;

/** الحصول على عميل Supabase (Singleton) */
export function getSupabase(): SupabaseClient {
  if (!_client) {
    if (!SUPABASE_ENABLED) {
      throw new Error('Supabase is not configured: set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY');
    }
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        // على الويب فقط نلتقط الجلسة من الـ URL بعد رجوع Google
        detectSessionInUrl: Platform.OS === 'web',
        flowType: 'pkce',
      },
      global: { headers: { 'x-client-info': 'masar-app/3.1' } },
    });
  }
  return _client;
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

/** رابط الرجوع بعد Google (ويب: نفس الأصل، موبايل: masar://auth/callback) */
export function authRedirectUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.origin}${window.location.pathname}`;
  }
  return Linking.createURL('auth/callback');
}

/**
 * الدخول بحساب Google — الطريقة الوحيدة للدخول في مسار.
 * الويب: إعادة توجيه كاملة. الموبايل: متصفح آمن + التقاط التوكنات من الـ deep link.
 */
export async function signInWithGoogle(): Promise<{ ok: boolean; error: string | null }> {
  if (!SUPABASE_ENABLED) return { ok: false, error: 'not-configured' };
  const sb = getSupabase();
  const redirectTo = authRedirectUrl();

  if (Platform.OS === 'web') {
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: { access_type: 'offline', prompt: 'select_account' },
      },
    });
    return { ok: !error, error: error?.message ?? null };
  }

  const { data, error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
  });
  if (error || !data?.url) return { ok: false, error: error?.message ?? 'oauth-url-missing' };

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo, { showInRecents: true });
  if (result.type !== 'success' || !result.url) {
    return { ok: false, error: result.type === 'cancel' || result.type === 'dismiss' ? 'cancelled' : 'oauth-failed' };
  }
  return exchangeUrlForSession(result.url);
}

/** تحويل رابط الرجوع (code أو access_token) إلى جلسة فعلية */
export async function exchangeUrlForSession(url: string): Promise<{ ok: boolean; error: string | null }> {
  const sb = getSupabase();
  const parsed = Linking.parse(url);
  const params = (parsed.queryParams ?? {}) as Record<string, string>;
  const hash = url.includes('#') ? new URLSearchParams(url.split('#')[1]) : null;

  const code = params.code;
  if (typeof code === 'string' && code) {
    const { error } = await sb.auth.exchangeCodeForSession(code);
    return { ok: !error, error: error?.message ?? null };
  }

  const accessToken = hash?.get('access_token') ?? params.access_token;
  const refreshToken = hash?.get('refresh_token') ?? params.refresh_token;
  if (accessToken && refreshToken) {
    const { error } = await sb.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    return { ok: !error, error: error?.message ?? null };
  }
  return { ok: false, error: 'no-session-in-url' };
}

/** بيانات هوية Google الخام (الاسم/الإيميل/الصورة) */
export interface GoogleIdentity {
  authUserId: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
}

export function identityOf(user: User): GoogleIdentity {
  const meta = (user.user_metadata ?? {}) as Record<string, string | undefined>;
  return {
    authUserId: user.id,
    email: user.email ?? meta.email ?? null,
    fullName: meta.full_name ?? meta.name ?? null,
    avatarUrl: meta.avatar_url ?? meta.picture ?? null,
  };
}

/** الحصول على المستخدم الحالي */
export async function getCurrentUser(): Promise<User | null> {
  if (!SUPABASE_ENABLED) return null;
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  return user;
}

/** الحصول على البروفايل الكامل بالـ auth user id */
export async function getProfile(authUserId: string): Promise<Profile | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('user_id', authUserId)
    .maybeSingle();

  if (error) return null;
  return (data as Profile) ?? null;
}

/** إنشاء/تحديث بروفايل المستخدم الحالي (يُستدعى من شاشة «أكمل بياناتك») */
export async function upsertMyProfile(input: {
  authUserId: string;
  email: string | null;
  fullName: string;
  phone: string;
  avatarUrl: string | null;
  branchId: string | null;
  gender: 'm' | 'f' | null;
}): Promise<{ profile: Profile | null; error: string | null }> {
  const sb = getSupabase();
  const payload = {
    user_id: input.authUserId,
    email: input.email,
    full_name: input.fullName,
    phone: input.phone,
    avatar_url: input.avatarUrl,
    branch_id: input.branchId,
    gender: input.gender,
  };
  const { data, error } = await sb
    .from('profiles')
    .upsert(payload, { onConflict: 'user_id' })
    .select('*')
    .single();
  return { profile: (data as Profile) ?? null, error: error?.message ?? null };
}

/** رفع صورة شخصية إلى bucket «avatars» وإرجاع الرابط العام */
export async function uploadAvatar(authUserId: string, uri: string): Promise<{ url: string | null; error: string | null }> {
  try {
    const sb = getSupabase();
    const res = await fetch(uri);
    const blob = await res.blob();
    const ext = (blob.type?.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg');
    const path = `${authUserId}/avatar_${Date.now()}.${ext}`;
    const { error } = await sb.storage.from('avatars').upload(path, blob, {
      contentType: blob.type || 'image/jpeg',
      upsert: true,
    });
    if (error) return { url: null, error: error.message };
    const { data } = sb.storage.from('avatars').getPublicUrl(path);
    return { url: data.publicUrl, error: null };
  } catch (e) {
    return { url: null, error: (e as Error).message };
  }
}

/** تسجيل الخروج */
export async function signOut(): Promise<void> {
  if (!SUPABASE_ENABLED) return;
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
