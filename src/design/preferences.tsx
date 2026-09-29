/**
 * design/preferences.tsx — تفضيلات الوصول والإتاحة (FUNC-10 + WCAG 1.4.4/1.4.8).
 *
 * ثلاثة إعدادات يطلبها المعيار والخطة، وكلها تُطبَّق فورًا على كل الشاشات:
 *  • **حجم النص** (100% / 115% / 130%) — WCAG 1.4.4 «Resize text»: يجب أن يصل
 *    النص إلى 200% بلا فقدان محتوى؛ نغطي 130% داخل التطبيق لأنه الحد الذي
 *    يحافظ على تخطيط البطاقات، ويبقى تكبير المتصفح متاحًا حتى 200%.
 *  • **تباين عالٍ** — WCAG 1.4.6 (Enhanced): نرفع قوة الحدود والفواصل بدل تغيير
 *    الألوان (تغيير الألوان كان سيُخلّ بنسب التباين المقيسة في check-contrast).
 *  • **تقليل الحركة** — WCAG 2.3.3 + `prefers-reduced-motion`: يُطبَّق على
 *    محرّك الحركة المركزي (design/motion) فلا تبقى أنيميشن واحد شارد.
 *
 * القيم تُخزَّن محليًا (localStorage على الويب / AsyncStorage على الجوال) لأنها
 * تفضيل جهاز لا بيانات حساب.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setTextScale } from './tokens';
import { setReducedMotion } from './motion';

const STORAGE_KEY = 'masar.a11y.v1';

export type TextScale = 1 | 1.15 | 1.3;

export interface A11yPrefs {
  textScale: TextScale;
  highContrast: boolean;
  reduceMotion: boolean;
}

const DEFAULTS: A11yPrefs = { textScale: 1, highContrast: false, reduceMotion: false };

interface Ctx extends A11yPrefs {
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
    document.documentElement.dataset.masarTextScale = String(prefs.textScale);
  }
}

export function A11yPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setState] = useState<A11yPrefs>(DEFAULTS);

  useEffect(() => {
    void (async () => {
      const stored = await loadStored();
      const merged: A11yPrefs = { ...DEFAULTS, ...(stored ?? {}) };
      setState(merged);
      apply(merged);
    })();
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

  const value = useMemo<Ctx>(() => ({ ...prefs, setPrefs, reset }), [prefs, setPrefs, reset]);
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
