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
import type { Database } from '../types/database';

// ═══════════════ الإعدادات ═══════════════
export const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();

export const SUPABASE_ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

/** هل الاتصال الحقيقي مُهيّأ؟ */
export const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let _client: SupabaseClient<any> | null = null;

/** الحصول على عميل Supabase (Singleton) */
export function getSupabase(): SupabaseClient<any> {
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
      global: { headers: { 'x-client-info': 'masar-app/3.2' } },
    });
  }
  return _client;
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
