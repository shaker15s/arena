import React, { createContext, useContext, useMemo, useState } from 'react';
import { ThemeColors, ThemeName, themes } from './tokens';

interface ThemeCtx {
  theme: ThemeColors;
  themeName: ThemeName;
  setTheme: (t: ThemeName) => void;
  isDark: boolean;
}

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeName, setTheme] = useState<ThemeName>('light');
  const value = useMemo<ThemeCtx>(
    () => ({
      theme: themes[themeName],
      themeName,
      setTheme,
      isDark: themeName !== 'light',
    }),
    [themeName],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme outside provider');
  return ctx;
}
