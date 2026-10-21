'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
const KEY = 'theme';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const systemTheme = (): Theme =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

function stored(): Theme | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function apply(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

/**
 * Saved choice wins; with no saved choice the OS preference is used (and followed live).
 * The same resolution runs in an inline <head> script (see app/layout.tsx) before first paint,
 * so there is no flash of the wrong theme. Every colour in the app is a CSS variable keyed off
 * the `dark` class, so toggling re-themes the whole UI instantly with no reload.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light');

  useEffect(() => {
    const initial = stored() ?? systemTheme();
    setThemeState(initial);
    apply(initial);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (stored() === null) {
        const next = systemTheme();
        setThemeState(next);
        apply(next);
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    apply(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable: the choice still applies for this session */
    }
  }, []);

  const toggleTheme = useCallback(() => setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark'), [setTheme]);

  return <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
