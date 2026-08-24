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
import { completeMyProfile, deleteMyAccount, updateMyProfile } from './actions';
import {
  GoogleIdentity, SUPABASE_ENABLED, getSupabase, identityOf,
  signInWithGoogle as sbSignInWithGoogle, signOut as sbSignOut, uploadAvatar as sbUploadAvatar,
} from './supabase';
import { applyRealtimePatch, emptyDb, fetchRemoteDb, pushDelta, subscribeRealtime } from './remote';

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
  deleteMyAccount: (confirm: string) => Promise<{ ok: boolean; error?: string }>;
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
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const refreshQueued = useRef(false);
  const dbRef = useRef(db);
  dbRef.current = db;

  const toast = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    toastSeq.current += 1;
    const id = toastSeq.current;
    setToasts((current) => [...current.slice(-2), { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  /** يقرأ القاعدة من السيرفر ويحدّث الحالة والكاش */
  const refresh = useCallback(async () => {
    if (!SUPABASE_ENABLED) return;
    // Realtime قد يرسل عدة أحداث للعملية الواحدة؛ كل المستهلكين ينتظرون نفس القراءة
    // بدل فتح عشرات طلبات متوازية وإظهار بيانات أقدم فوق الأحدث.
    if (refreshInFlight.current) {
      refreshQueued.current = true;
      return refreshInFlight.current;
    }
    const task = (async () => {
      setSyncing(true);
      try {
        const fresh = await fetchRemoteDb();
        // لا تُغلق الجلسات أو تغيّر الدفاتر من جهاز المستخدم. المهام المجدولة
        // وعمليات RPC الخادمية هي مصدر الحقيقة الوحيد لهذه الانتقالات.
        dbRef.current = fresh;
        setDb(fresh);
        writeCache(fresh);
        setLastSyncAt(Date.now());
        setSyncError(null);
        setOnline(true);
      } catch (error) {
        setSyncError((error as Error).message);
        setOnline(false);
      } finally {
        setSyncing(false);
      }
    })();
    refreshInFlight.current = task;
    try {
      await task;
    } finally {
      refreshInFlight.current = null;
      if (refreshQueued.current) {
        refreshQueued.current = false;
        setTimeout(() => { void refresh(); }, 0);
      }
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
    let isMounted = true;
    let unsubRealtime: (() => void) | undefined;
    let unsubAuth: (() => void) | undefined;

    const boot = async () => {
      const cached = await readCache();
      if (cached && isMounted) setDb(cached);

      if (SUPABASE_ENABLED) {
        const sb = getSupabase();
        const { data: sub } = sb.auth.onAuthStateChange((_event, s) => {
          if (isMounted) void applySession(s);
        });
        unsubAuth = () => sub.subscription.unsubscribe();

        try {
          const { data: { session } } = await sb.auth.getSession();
          if (isMounted) {
            await applySession(session);
            // Realtime incremental: طبّق التغيير محليًا بدل سحب كل الجداول؛
            // إن تعذّر (جدول/حدث غير مُعالج) نعمل refresh كامل.
            unsubRealtime = subscribeRealtime((patch) => {
              if (!isMounted) return;
              const next = applyRealtimePatch(dbRef.current, patch);
              if (next) {
                dbRef.current = next;
                setDb(next);
                writeCache(next);
              } else {
                void refresh();
              }
            });
          }
        } catch {
          // خطأ شبكة أثناء استرجاع الجلسة
        }
      }
      if (isMounted) setReady(true);
    };
    void boot();

    return () => {
      isMounted = false;
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
          // لا نترك الواجهة تدّعي نجاح تغيير رفضه الخادم.
          dbRef.current = before;
          setDb(before);
          writeCache(before);
          setSyncError(rep.errors[0]);
          toast(rep.errors[0], 'error');
          void refresh();
        } else {
          setSyncError(null);
          setLastSyncAt(Date.now());
        }
      } catch (e) {
        dbRef.current = before;
        setDb(before);
        writeCache(before);
        setSyncError((e as Error).message);
        setOnline(false);
      } finally {
        setSyncing(false);
      }
    }
    return result;
  }, [refresh, toast]);

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
    try {
      const result = await completeMyProfile(draft);
      setProfileId(result.profile_id);
      await refresh();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }, [identity, refresh]);

  /** تعديل البيانات الشخصية لاحقًا عبر RPC منفصلة عن صلاحيات الدور والحالة. */
  const updateProfile = useCallback(async (patch: Partial<ProfileDraft>) => {
    if (!profileId) return { ok: false, error: 'no-profile' };
    const current = db.profiles.find((profile) => profile.id === profileId);
    if (!current) return { ok: false, error: 'profile-not-loaded' };
    try {
      await updateMyProfile({
        fullName: patch.fullName ?? current.fullName,
        phone: patch.phone ?? current.phone,
        avatarUrl: patch.avatarUrl !== undefined ? patch.avatarUrl : (current.avatarUrl ?? null),
      });
      await refresh();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }, [db.profiles, profileId, refresh]);

  const logout = useCallback(async () => {
    await sbSignOut();
    setProfileId(null);
    setIdentity(null);
    setDb(emptyDb());
    writeCache(emptyDb());
  }, []);

  /** حذف الحساب على الخادم ثم إنهاء الجلسة محليًا. */
  const deleteAccount = useCallback(async (confirm: string): Promise<{ ok: boolean; error?: string }> => {
    if (!identity) return { ok: false, error: 'no-session' };
    try {
      await deleteMyAccount(confirm);
      // Auth row removed server-side -> session is invalidated.
      setProfileId(null);
      setIdentity(null);
      setDb(emptyDb());
      writeCache(emptyDb());
      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }, [identity]);

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

  const needsProfile = Boolean(identity) && (!user || (user.status !== 'disabled' && !user.phone));

  const value = useMemo<AppCtx>(() => ({
    ready, configured: SUPABASE_ENABLED, db, user, identity, needsProfile, loading, syncing,
    lastSyncAt, syncError, online, setOnline, toasts, toast, mutate, touch, refresh,
    signInWithGoogle, completeProfile, updateProfile, uploadAvatar, logout,
    deleteMyAccount: deleteAccount, unreadCount, markNotificationsRead,
  }), [
    ready, db, user, identity, needsProfile, loading, syncing, lastSyncAt, syncError, online,
    toasts, toast, mutate, touch, refresh, signInWithGoogle, completeProfile, updateProfile,
    uploadAvatar, logout, deleteAccount, unreadCount, markNotificationsRead,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp outside provider');
  return ctx;
}
