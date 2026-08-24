import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ar, DictKey } from './ar';
import { en } from './en';

export type Lang = 'ar' | 'en';

const dicts: Record<Lang, Record<DictKey, string>> = { ar, en };
const LANG_KEY = 'masar.lang.v1';

interface I18nCtx {
  lang: Lang;
  rtl: boolean;
  setLang: (l: Lang) => void;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

function applyWebDir(l: Lang) {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.documentElement.lang = l;
    document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
  }
}

async function readSavedLang(): Promise<Lang | null> {
  try {
    const raw = Platform.OS === 'web' && typeof localStorage !== 'undefined'
      ? localStorage.getItem(LANG_KEY)
      : await AsyncStorage.getItem(LANG_KEY);
    return raw === 'ar' || raw === 'en' ? raw : null;
  } catch {
    return null;
  }
}

function saveLang(l: Lang) {
  try {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') localStorage.setItem(LANG_KEY, l);
    else void AsyncStorage.setItem(LANG_KEY, l);
  } catch { /* تجاهل */ }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ar');

  // استرجاع اللغة المحفوظة عند الإقلاع — كانت تُفقد مع كل تشغيل.
  useEffect(() => {
    let mounted = true;
    void readSavedLang().then((saved) => {
      if (mounted && saved && saved !== 'ar') {
        setLangState(saved);
        applyWebDir(saved);
      }
    });
    return () => { mounted = false; };
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    saveLang(l);
    applyWebDir(l);
  }, []);

  const t = useCallback(
    (key: DictKey, vars?: Record<string, string | number>) => {
      let s: string = dicts[lang][key] ?? dicts.ar[key] ?? key;
      if (vars) {
        for (const k of Object.keys(vars)) {
          s = s.replaceAll(`{${k}}`, String(vars[k]));
        }
      }
      return s;
    },
    [lang],
  );

  const value = useMemo(
    () => ({ lang, rtl: lang === 'ar', setLang, t }),
    [lang, setLang, t],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n outside provider');
  return ctx;
}

export function useT() {
  const { t } = useI18n();
  return t;
}
