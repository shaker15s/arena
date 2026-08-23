/**
 * data/store.tsx — حالة التطبيق الحقيقية.
 *
 *  • الدخول بحساب Google عبر Supabase Auth فقط (لا OTP، لا شخصيات تجريبية).
 *  • البيانات تُقرأ من Postgres وتُكتب فيه فعليًا (data/remote.ts).
 *  • كاش محلي (AsyncStorage/localStorage) لعرض آخر نسخة أثناء انقطاع الشبكة.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session, User } from '@supabase/supabase-js';
import { Db, Profile } from './types';
import { rpcCloseSession } from './engine';
import {
  GoogleIdentity, SUPABASE_ENABLED, getSupabase, identityOf,
  signInWithGoogle as sbSignInWithGoogle, signOut as sbSignOut, uploadAvatar as sbUploadAvatar,
} from './supabase';
import { emptyDb, fetchRemoteDb, pushDelta, subscribeRealtime } from './remote';

const CACHE_KEY = 'masar.cache.v1';

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error' | 'warn';
}

export interface ProfileDraft {
  fullName: string;
  phone: string;
  avatarUrl: string | null;
  branchId: string | null;
  gender: 'm' | 'f';
}

interface AppCtx {
  ready: boolean;
  /** إعدادات Supabase موجودة؟ بدونها التطبيق لا يعمل (ولا يعرض بيانات وهمية) */
  configured: boolean;
  db: Db;
  user: Profile | null;
  /** هوية Google للمستخدم الحالي قبل/بعد إكمال البيانات */
  identity: GoogleIdentity | null;
  /** دخل بجوجل لكنه لم يُكمل بياناته (رقم الموبايل/الفرع) بعد */
  needsProfile: boolean;
  loading: boolean;
  syncing: boolean;
  lastSyncAt: number | null;
  syncError: string | null;
  online: boolean;
  setOnline: (v: boolean) => void;
  toasts: Toast[];
  toast: (message: string, kind?: Toast['kind']) => void;
  /** تنفيذ عملية على القاعدة ثم كتابة الفروق في Supabase */
  mutate: <R>(fn: (db: Db) => R) => Promise<R>;
  touch: () => void;
  refresh: () => Promise<void>;
  signInWithGoogle: () => Promise<{ ok: boolean; error: string | null }>;
  completeProfile: (draft: ProfileDraft) => Promise<{ ok: boolean; error?: string }>;
  updateProfile: (patch: Partial<ProfileDraft>) => Promise<{ ok: boolean; error?: string }>;
  uploadAvatar: (uri: string) => Promise<string | null>;
  logout: () => Promise<void>;
  unreadCount: number;
  markNotificationsRead: () => void;
}

const Ctx = createContext<AppCtx | null>(null);

// ───────────────────────── كاش محلي ─────────────────────────

async function readCache(): Promise<Db | null> {
  try {
    const raw = Platform.OS === 'web' && typeof localStorage !== 'undefined'
      ? localStorage.getItem(CACHE_KEY)
      : await AsyncStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Db) : null;
  } catch {
    return null;
  }
}

function writeCache(db: Db) {
  try {
    const raw = JSON.stringify(db);
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') localStorage.setItem(CACHE_KEY, raw);
    else void AsyncStorage.setItem(CACHE_KEY, raw);
  } catch {
    /* تجاوز حدود التخزين */
  }
}

// ───────────────────────── المزوّد ─────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [db, setDb] = useState<Db>(() => emptyDb());
  const [identity, setIdentity] = useState<GoogleIdentity | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const dbRef = useRef(db);
  dbRef.current = db;

  const toast = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    toastSeq.current += 1;
    const id = toastSeq.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  /** يقرأ القاعدة من السيرفر ويحدّث الحالة والكاش */
  const refresh = useCallback(async () => {
    if (!SUPABASE_ENABLED) return;
    setSyncing(true);
    try {
      const fresh = await fetchRemoteDb();
      // إقفال الجلسات المنسية (احتياطي محلي إن لم يعمل pg_cron)
      const now = Date.now();
      let changed = false;
      fresh.sessions.forEach((s) => {
        if (s.status === 'live' && s.startedAt && now - s.startedAt > (s.durationMin + 30) * 60_000) {
          rpcCloseSession(fresh, s.id, 'system');
          changed = true;
        }
      });
      setDb(fresh);
      writeCache(fresh);
      setLastSyncAt(Date.now());
      setSyncError(null);
      setOnline(true);
      if (changed) void pushDelta(fresh, fresh).catch(() => undefined);
    } catch (e) {
      setSyncError((e as Error).message);
      setOnline(false);
    } finally {
      setSyncing(false);
    }
  }, []);

  /** يربط جلسة Supabase بالبروفايل المحلي */
  const applySession = useCallback(async (session: Session | null) => {
    const authUser: User | null = session?.user ?? null;
    if (!authUser) {
      setIdentity(null);
      setProfileId(null);
      return;
    }
    setIdentity(identityOf(authUser));
    setLoading(true);
    try {
      const sb = getSupabase();
      const { data } = await sb.from('profiles').select('id, phone, full_name').eq('user_id', authUser.id).maybeSingle();
      setProfileId(data?.id ?? null);
      await refresh();
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  // ── الإقلاع ──
  useEffect(() => {
    let unsubRealtime: (() => void) | undefined;
    let unsubAuth: (() => void) | undefined;

    const boot = async () => {
      const cached = await readCache();
      if (cached) setDb(cached);

      if (SUPABASE_ENABLED) {
        const sb = getSupabase();
        const { data: { session } } = await sb.auth.getSession();
        await applySession(session);
        const { data: sub } = sb.auth.onAuthStateChange((_event, s) => { void applySession(s); });
        unsubAuth = () => sub.subscription.unsubscribe();
        unsubRealtime = subscribeRealtime(() => { void refresh(); });
      }
      setReady(true);
    };
    void boot();

    return () => {
      unsubAuth?.();
      unsubRealtime?.();
    };
  }, [applySession, refresh]);

  // ── إعادة المزامنة عند عودة التطبيق للمقدمة ──
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && profileId) void refresh();
    });
    return () => sub.remove();
  }, [profileId, refresh]);

  // ── مراقبة الاتصال على الويب ──
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const up = () => { setOnline(true); void refresh(); };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    setOnline(window.navigator?.onLine ?? true);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [refresh]);

  /** تعديل متفائل محليًا + كتابة الفروق فعليًا في Supabase */
  const mutate = useCallback(async <R,>(fn: (db: Db) => R): Promise<R> => {
    const before = dbRef.current;
    const draft = structuredClone(before);
    const result = fn(draft);
    dbRef.current = draft;
    setDb(draft);
    writeCache(draft);

    if (SUPABASE_ENABLED) {
      setSyncing(true);
      try {
        const rep = await pushDelta(before, draft);
        if (rep.errors.length) {
          setSyncError(rep.errors[0]);
          toast(rep.errors[0], 'error');
        } else {
          setSyncError(null);
          setLastSyncAt(Date.now());
        }
      } catch (e) {
        setSyncError((e as Error).message);
        setOnline(false);
      } finally {
        setSyncing(false);
      }
    }
    return result;
  }, [toast]);

  const touch = useCallback(() => setDb((prev) => ({ ...prev })), []);

  // ── الدخول بجوجل ──
  const signInWithGoogle = useCallback(async () => {
    const r = await sbSignInWithGoogle();
    if (r.ok && Platform.OS !== 'web') {
      const sb = getSupabase();
      const { data: { session } } = await sb.auth.getSession();
      await applySession(session);
    }
    return r;
  }, [applySession]);

  const uploadAvatar = useCallback(async (uri: string) => {
    if (!identity) return null;
    const { url, error } = await sbUploadAvatar(identity.authUserId, uri);
    if (error) {
      toast(error, 'error');
      return null;
    }
    return url;
  }, [identity, toast]);

  /** إنشاء البروفايل بعد الدخول بجوجل — رقم الموبايل مطلوب */
  const completeProfile = useCallback(async (draft: ProfileDraft) => {
    if (!identity) return { ok: false, error: 'no-session' };
    const sb = getSupabase();
    const payload = {
      user_id: identity.authUserId,
      email: identity.email,
      full_name: draft.fullName,
      phone: draft.phone,
      avatar_url: draft.avatarUrl,
      branch_id: draft.branchId,
      gender: draft.gender,
      role: 'student',
    };
    const { data, error } = await sb.from('profiles').upsert(payload, { onConflict: 'user_id' }).select('id').single();
    if (error) return { ok: false, error: error.message };
    setProfileId(data.id as string);
    await refresh();
    return { ok: true };
  }, [identity, refresh]);

  /** تعديل البيانات الشخصية لاحقًا (الاسم/الصورة/الموبايل/الفرع) */
  const updateProfile = useCallback(async (patch: Partial<ProfileDraft>) => {
    if (!profileId) return { ok: false, error: 'no-profile' };
    const sb = getSupabase();
    const row: Record<string, unknown> = {};
    if (patch.fullName !== undefined) row.full_name = patch.fullName;
    if (patch.phone !== undefined) row.phone = patch.phone;
    if (patch.avatarUrl !== undefined) row.avatar_url = patch.avatarUrl;
    if (patch.branchId !== undefined) row.branch_id = patch.branchId;
    if (patch.gender !== undefined) row.gender = patch.gender;
    const { error } = await sb.from('profiles').update(row).eq('id', profileId);
    if (error) return { ok: false, error: error.message };
    await refresh();
    return { ok: true };
  }, [profileId, refresh]);

  const logout = useCallback(async () => {
    await sbSignOut();
    setProfileId(null);
    setIdentity(null);
    setDb(emptyDb());
    writeCache(emptyDb());
  }, []);

  const unreadCount = useMemo(() => {
    if (!profileId) return 0;
    return db.notifications.filter((n) => n.userId === profileId && !n.read).length;
  }, [db.notifications, profileId]);

  const markNotificationsRead = useCallback(() => {
    if (!profileId) return;
    void mutate((draft) => {
      draft.notifications.forEach((n) => {
        if (n.userId === profileId) n.read = true;
      });
    });
  }, [profileId, mutate]);

  const user = useMemo(
    () => db.profiles.find((p) => p.id === profileId) ?? null,
    [db.profiles, profileId],
  );

  const needsProfile = Boolean(identity) && (!user || !user.phone);

  const value = useMemo<AppCtx>(() => ({
    ready, configured: SUPABASE_ENABLED, db, user, identity, needsProfile, loading, syncing,
    lastSyncAt, syncError, online, setOnline, toasts, toast, mutate, touch, refresh,
    signInWithGoogle, completeProfile, updateProfile, uploadAvatar, logout,
    unreadCount, markNotificationsRead,
  }), [
    ready, db, user, identity, needsProfile, loading, syncing, lastSyncAt, syncError, online,
    toasts, toast, mutate, touch, refresh, signInWithGoogle, completeProfile, updateProfile,
    uploadAvatar, logout, unreadCount, markNotificationsRead,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp outside provider');
  return ctx;
}
