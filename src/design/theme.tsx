/**
 * design/theme.tsx — مزوّد الثيم: Apple Liquid Glass هو الثيم الأساسي.
 * يدعم «حسب النظام» + فاتح + داكن + OLED، ويحفظ اختيار المستخدم.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, Platform } from 'react-native';
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
}

const Ctx = createContext<ThemeCtx | null>(null);

function systemTheme(): ThemeName {
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<ThemePref>('system');
  const [system, setSystem] = useState<ThemeName>(systemTheme());

  // استرجاع اختيار المستخدم
  useEffect(() => {
    void (async () => {
      try {
        const raw = Platform.OS === 'web' && typeof localStorage !== 'undefined'
          ? localStorage.getItem(STORAGE_KEY)
          : await AsyncStorage.getItem(STORAGE_KEY);
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
    }),
    [themeName, preference],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme outside provider');
  return ctx;
}
