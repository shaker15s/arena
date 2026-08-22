import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { ar, DictKey } from './ar';
import { en } from './en';

export type Lang = 'ar' | 'en';

const dicts: Record<Lang, Record<DictKey, string>> = { ar, en };

interface I18nCtx {
  lang: Lang;
  rtl: boolean;
  setLang: (l: Lang) => void;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ar');

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.documentElement.lang = l;
      document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
    }
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
