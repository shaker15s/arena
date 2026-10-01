/**
 * design/preferences.tsx — تفضيلات الوصول والإتاحة (FUNC-10 + WCAG 1.4.4/1.4.8).
 *
 *  • حجم النص (100% / 115% / 130%) — يدعم تكبير المتصفح حتى 200% على الويب.
 *  • تباين عالٍ — يقوّي الحدود والفواصل دون تبديل ألوان النصوص المقاسة.
 *  • تقليل الحركة — يغذي محرّك الحركة المركزي.
 *  • تقليل الشفافية — يوقف طبقات الزجاج؛ وإعداد iOS للنظام يتقدم على اختيار التطبيق.
 *
 * الاختيارات المحلية تُخزَّن على الجهاز؛ إعداد النظام غير قابل للكتابة ولا يُحفظ.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setTextScale } from './tokens';
import { setReducedMotion } from './motion';

const STORAGE_KEY = 'masar.a11y.v1';

export type TextScale = 1 | 1.15 | 1.3;

export interface A11yPrefs {
  textScale: TextScale;
  highContrast: boolean;
  reduceMotion: boolean;
  reduceTransparency: boolean;
}

const DEFAULTS: A11yPrefs = {
  textScale: 1,
  highContrast: false,
  reduceMotion: false,
  reduceTransparency: false,
};

interface Ctx extends A11yPrefs {
  /** يظل إعداد نظام iOS مفعلًا حتى لو أوقف المستخدم تفضيل التطبيق. */
  systemReduceTransparency: boolean;
  effectiveReduceTransparency: boolean;
  setPrefs: (patch: Partial<A11yPrefs>) => void;
  reset: () => void;
}

const A11yCtx = createContext<Ctx | null>(null);

async function loadStored(): Promise<Partial<A11yPrefs> | null> {
  try {
    const raw = Platform.OS === 'web' && typeof localStorage !== 'undefined'
      ? localStorage.getItem(STORAGE_KEY)
      : await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<A11yPrefs>) : null;
  } catch {
    return null;
  }
}

function persist(prefs: A11yPrefs): void {
  try {
    const raw = JSON.stringify(prefs);
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, raw);
    else void AsyncStorage.setItem(STORAGE_KEY, raw);
  } catch {
    /* التخزين غير متاح — يستمر التطبيق بالتفضيل في الذاكرة */
  }
}

/** يُبلّغ طبقات لا تعرف React (tokens/motion/document) بالتفضيل الجديد. */
function apply(prefs: A11yPrefs): void {
  setTextScale(prefs.textScale);
  setReducedMotion(prefs.reduceMotion);
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.documentElement.classList.toggle('masar-contrast', prefs.highContrast);
    document.documentElement.classList.toggle('masar-reduce-transparency', prefs.reduceTransparency);
    document.documentElement.dataset.masarTextScale = String(prefs.textScale);
  }
}

export function A11yPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setState] = useState<A11yPrefs>(DEFAULTS);
  const [systemReduceTransparency, setSystemReduceTransparency] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const stored = await loadStored();
      if (!active) return;
      const merged: A11yPrefs = { ...DEFAULTS, ...(stored ?? {}) };
      setState(merged);
      apply(merged);
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    let active = true;
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', (enabled) => {
      if (active) setSystemReduceTransparency(enabled);
    });
    void AccessibilityInfo.isReduceTransparencyEnabled()
      .then((enabled) => { if (active) setSystemReduceTransparency(enabled); })
      .catch(() => { /* إعداد غير متاح على إصدار النظام الحالي */ });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const setPrefs = useCallback((patch: Partial<A11yPrefs>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      apply(next);
      persist(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setState(DEFAULTS);
    apply(DEFAULTS);
    persist(DEFAULTS);
  }, []);

  const effectiveReduceTransparency = systemReduceTransparency || prefs.reduceTransparency;
  const value = useMemo<Ctx>(() => ({
    ...prefs,
    systemReduceTransparency,
    effectiveReduceTransparency,
    setPrefs,
    reset,
  }), [prefs, systemReduceTransparency, effectiveReduceTransparency, setPrefs, reset]);

  return <A11yCtx.Provider value={value}>{children}</A11yCtx.Provider>;
}

export function useA11yPrefs(): Ctx {
  const ctx = useContext(A11yCtx);
  if (!ctx) throw new Error('useA11yPrefs outside A11yPreferencesProvider');
  return ctx;
}

/** نسخة متسامحة لمن يُستخدَم خارج المزوّد (اختبارات/شاشات مستقلة). */
export function useA11yPrefsOptional(): Ctx | null {
  return useContext(A11yCtx);
}
