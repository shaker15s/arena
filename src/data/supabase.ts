/**
 * data/supabase.ts — عميل Supabase الواحد للتطبيق.
 * عند تفعيل الاتصال الحقيقي: ضع مفاتيحك في environment variables أو ملف .env.
 * حاليًا يعمل في وضع Demo (محاكاة محلية) — للتبديل لـ Real Mode:
 *   1. أنشئ مشروع Supabase جديد
 *   2. انسخ URL و anon key
 *   3. فعّل SUPABASE_ENABLED = true
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ═══════════════ الإعدادات ═══════════════
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** هل الاتصال الحقيقي مفعّل؟ (يتطلب SUPABASE_URL + SUPABASE_ANON_KEY) */
export const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let _client: SupabaseClient | null = null;

/** الحصول على عميل Supabase (Singleton) */
export function getSupabase(): SupabaseClient | null {
  if (!SUPABASE_ENABLED) return null;
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  }
  return _client;
}

// ═══════════════ واجهات مساعدة ═══════════════

export interface SupabaseSession {
  userId: string;
  accessToken: string;
  refreshToken: string;
}

/** تسجيل الدخول برقم الهاتف (OTP) */
export async function signInWithPhone(phone: string): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'supabase_not_configured' };
  const { error } = await sb.auth.signInWithOtp({
    phone: `+20${phone}`,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** التحقق من رمز OTP */
export async function verifyPhoneOtp(phone: string, token: string): Promise<{ ok: boolean; session?: SupabaseSession; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'supabase_not_configured' };
  const { data, error } = await sb.auth.verifyOtp({
    phone: `+20${phone}`,
    token,
    type: 'sms',
  });
  if (error) return { ok: false, error: error.message };
  if (!data.session) return { ok: false, error: 'no_session' };
  return {
    ok: true,
    session: {
      userId: data.session.user.id,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    },
  };
}

/** تسجيل الخروج */
export async function signOut(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
}

/** الحصول على الجلسة الحالية */
export async function getSession(): Promise<SupabaseSession | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  if (!data.session) return null;
  return {
    userId: data.session.user.id,
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  };
}

/** استدعاء RPC عام (Secured) */
export async function callRpc<T>(fn: string, params?: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const sb = getSupabase();
  if (!sb) return { error: 'supabase_not_configured' };
  const { data, error } = await sb.rpc(fn, params ?? {});
  if (error) return { error: error.message };
  return { data: data as T };
}

// ═══════════════ Realtime Subscriptions ═══════════════

export function subscribeAttendance(sessionId: string, callback: (payload: any) => void) {
  const sb = getSupabase();
  if (!sb) return () => {};
  const channel = sb
    .channel(`attendance:${sessionId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance', filter: `session_id=eq.${sessionId}` }, callback)
    .subscribe();
  return () => { sb.removeChannel(channel); };
}

export function subscribeNotifications(userId: string, callback: (payload: any) => void) {
  const sb = getSupabase();
  if (!sb) return () => {};
  const channel = sb
    .channel(`notifications:${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, callback)
    .subscribe();
  return () => { sb.removeChannel(channel); };
}
