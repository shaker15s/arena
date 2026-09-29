/**
 * design/theme.tsx — مزوّد الثيم: Apple Liquid Glass هو الثيم الأساسي.
 * يدعم «حسب النظام» + فاتح + داكن + OLED، ويحفظ اختيار المستخدم.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, Platform, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeColors, ThemeName, themes } from './tokens';

export type ThemePref = ThemeName | 'system';

const STORAGE_KEY = 'masar.theme.v1';

interface ThemeCtx {
  theme: ThemeColors;
  /** الثيم الفعلي المطبّق */
  themeName: ThemeName;
  /** اختيار المستخدم (قد يكون «حسب النظام») */
  preference: ThemePref;
  setTheme: (t: ThemePref) => void;
  isDark: boolean;
  /**
   * عرض النافذة الحالي — يُقرأ مرة واحدة هنا (CMP-05) بدل أن يشترك كل مكوّن
   * نصّي `Txt` في useWindowDimensions (كانت كل شاشة تدفع ثمن عشرات الاشتراكات).
   */
  windowWidth: number;
}

const Ctx = createContext<ThemeCtx | null>(null);

function systemTheme(): ThemeName {
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

/** قراءة متزامنة لاختيار الويب — تمنع وميض الثيم الخاطئ عند أول رسم React (UX-08). */
function initialPreference(): ThemePref {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === 'light' || raw === 'dark' || raw === 'oled' || raw === 'system') return raw;
    }
  } catch {
    /* تجاهل */
  }
  return 'system';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<ThemePref>(initialPreference);
  const [system, setSystem] = useState<ThemeName>(systemTheme());
  const { width } = useWindowDimensions();

  // استرجاع اختيار المستخدم (على الجوال فقط — الويب قرأه متزامنًا في initialPreference)
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw === 'light' || raw === 'dark' || raw === 'oled' || raw === 'system') setPreference(raw);
      } catch {
        /* تجاهل */
      }
    })();
  }, []);

  // متابعة ثيم النظام
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystem(colorScheme === 'dark' ? 'dark' : 'light');
    });
    return () => sub.remove();
  }, []);

  const setTheme = (t: ThemePref) => {
    setPreference(t);
    try {
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, t);
      else void AsyncStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* تجاهل */
    }
  };

  const themeName: ThemeName = preference === 'system' ? system : preference;

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.style.colorScheme = themeName === 'light' ? 'light' : 'dark';
    document.documentElement.style.backgroundColor = themes[themeName].bg;
    document.body.style.backgroundColor = themes[themeName].bg;
  }, [themeName]);

  const value = useMemo<ThemeCtx>(
    () => ({
      theme: themes[themeName],
      themeName,
      preference,
      setTheme,
      isDark: themeName !== 'light',
      windowWidth: width,
    }),
    [themeName, preference, width],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme outside provider');
  return ctx;
}
