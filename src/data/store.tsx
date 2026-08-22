/**
 * data/store.tsx — مزوّد حالة التطبيق: الجلسة، قاعدة البيانات المحاكاة،
 * التهيئة، الكرون المحلي (غلق الجلسات المنسية)، التوست، والاتصال.
 * طبقة الـ api هنا هي البديل المباشر لاستدعاءات Supabase RPC لاحقًا.
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Db, Profile } from './types';
import { buildSeedDb, SEED_VERSION, IDS } from './seed';
import { rpcCloseSession } from './engine';

const DB_KEY = `masar.db.v${SEED_VERSION}`;
const SESSION_KEY = 'masar.session.v1';

interface PendingOtp {
  phone: string;
  code: string;
}

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error' | 'warn';
}

interface AppCtx {
  ready: boolean;
  db: Db;
  user: Profile | null;
  online: boolean;
  setOnline: (v: boolean) => void;
  toasts: Toast[];
  toast: (message: string, kind?: Toast['kind']) => void;
  /** تنفيذ طفرة على القاعدة (محاكاة RPC: استنساخ → طفرة → حفظ → إشعار الواجهة) */
  mutate: <R>(fn: (db: Db) => R) => Promise<R>;
  /** إعادة قراءة قسرية للواجهة */
  touch: () => void;
  pendingOtp: PendingOtp | null;
  requestOtp: (phone: string) => Promise<{ ok: boolean; error?: string }>;
  verifyOtp: (code: string) => Promise<{ outcome: 'existing' | 'new' | 'wrong' }>;
  completeProfile: (fullName: string, branchId: string) => Promise<void>;
  quickLogin: (userId: string) => void;
  logout: () => void;
  resetDemo: () => void;
  unreadCount: number;
  markNotificationsRead: () => void;
}

const Ctx = createContext<AppCtx | null>(null);

function storage(): Storage | null {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* ignore */
  }
  return null;
}

function loadDb(): Db {
  const s = storage();
  if (s) {
    try {
      const raw = s.getItem(DB_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Db;
        if (parsed.seedVersion === SEED_VERSION) return parsed;
      }
    } catch {
      /* corrupted → reseed */
    }
  }
  return buildSeedDb();
}

function persistDb(db: Db) {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    /* storage full — تجاهل */
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [db, setDb] = useState<Db>(() => loadDb());
  const [userId, setUserId] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pendingOtp, setPendingOtp] = useState<PendingOtp | null>(null);
  const toastSeq = useRef(0);

  // ── التهيئة: استرجاع الجلسة + كرون «غلق الجلسات المنسية 23:55» ──
  React.useEffect(() => {
    const boot = async () => {
      setDb((prev) => {
        const draft = structuredClone(prev);
        const now = Date.now();
        let changed = false;
        draft.sessions.forEach((sess) => {
          if (sess.status === 'live' && sess.startedAt && now - sess.startedAt > (sess.durationMin + 30) * 60_000) {
            rpcCloseSession(draft, sess.id, 'system');
            changed = true;
          }
        });
        if (changed) persistDb(draft);
        return changed ? draft : prev;
      });
      const s = storage();
      if (s) {
        try {
          const raw = s.getItem(SESSION_KEY);
          if (raw) {
            const { userId: saved } = JSON.parse(raw);
            if (typeof saved === 'string') setUserId(saved);
          }
        } catch {
          /* ignore */
        }
      }
      // مهلة قصيرة لظهور الـ Splash بشكل أنيق
      setTimeout(() => setReady(true), 1200);
    };
    boot();
  }, []);

  const persistSession = useCallback((id: string | null) => {
    const s = storage();
    if (!s) return;
    try {
      if (id) s.setItem(SESSION_KEY, JSON.stringify({ userId: id }));
      else s.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const mutate = useCallback(async <R,>(fn: (db: Db) => R): Promise<R> => {
    // محاكاة زمن الاستجابة الشبكي للـ RPC
    await new Promise((r) => setTimeout(r, 90 + Math.random() * 160));
    let result!: R;
    setDb((prev) => {
      const draft = structuredClone(prev);
      result = fn(draft);
      persistDb(draft);
      return draft;
    });
    return result;
  }, []);

  const touch = useCallback(() => setDb((prev) => ({ ...prev })), []);

  const toast = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    toastSeq.current += 1;
    const id = toastSeq.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const requestOtp = useCallback(async (phone: string) => {
    await new Promise((r) => setTimeout(r, 500));
    if (!/^01\d{9}$/.test(phone.trim())) return { ok: false, error: 'phone' as const };
    setPendingOtp({ phone: phone.trim(), code: '246810' });
    return { ok: true };
  }, []);

  const verifyOtp = useCallback(async (code: string) => {
    await new Promise((r) => setTimeout(r, 400));
    if (!pendingOtp) return { outcome: 'wrong' as const };
    if (code !== pendingOtp.code) return { outcome: 'wrong' as const };
    const existing = db.profiles.find((p) => p.phone === pendingOtp.phone);
    if (existing) {
      setUserId(existing.id);
      persistSession(existing.id);
      setPendingOtp(null);
      return { outcome: 'existing' as const };
    }
    return { outcome: 'new' as const };
  }, [pendingOtp, db.profiles, persistSession]);

  const completeProfile = useCallback(async (fullName: string, branchId: string) => {
    if (!pendingOtp) return;
    await mutate((draft) => {
      const id = `u_${Date.now().toString(36)}`;
      const newProfile: Profile = {
        id,
        fullName,
        phone: pendingOtp.phone,
        role: 'student',
        branchId,
        avatarColor: '#8B5CF6',
        gender: 'm',
        status: 'active',
        joinedAt: Date.now(),
      };
      draft.profiles.push(newProfile);
    });
    // نجلب الهوية الجديدة
    setDb((prev) => {
      const created = [...prev.profiles].reverse().find((p) => p.phone === pendingOtp.phone);
      if (created) {
        setUserId(created.id);
        persistSession(created.id);
      }
      return prev;
    });
    setPendingOtp(null);
  }, [pendingOtp, mutate, persistSession]);

  const quickLogin = useCallback((id: string) => {
    setUserId(id);
    persistSession(id);
  }, [persistSession]);

  const logout = useCallback(() => {
    setUserId(null);
    persistSession(null);
  }, [persistSession]);

  const resetDemo = useCallback(() => {
    const s = storage();
    try { s?.removeItem(DB_KEY); s?.removeItem(SESSION_KEY); } catch { /* ignore */ }
    setDb(buildSeedDb());
    setUserId(null);
    setToasts([]);
  }, []);

  const unreadCount = useMemo(() => {
    if (!userId) return 0;
    return db.notifications.filter((n) => n.userId === userId && !n.read).length;
  }, [db.notifications, userId]);

  const markNotificationsRead = useCallback(() => {
    if (!userId) return;
    mutate((draft) => {
      draft.notifications.forEach((n) => {
        if (n.userId === userId) n.read = true;
      });
    });
  }, [userId, mutate]);

  const user = useMemo(() => db.profiles.find((p) => p.id === userId) ?? null, [db.profiles, userId]);

  const value = useMemo<AppCtx>(() => ({
    ready, db, user, online, setOnline, toasts, toast, mutate, touch,
    pendingOtp, requestOtp, verifyOtp, completeProfile, quickLogin, logout,
    resetDemo, unreadCount, markNotificationsRead,
  }), [ready, db, user, online, toasts, toast, mutate, touch, pendingOtp, requestOtp, verifyOtp, completeProfile, quickLogin, logout, resetDemo, unreadCount, markNotificationsRead]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp outside provider');
  return ctx;
}

export { IDS };
