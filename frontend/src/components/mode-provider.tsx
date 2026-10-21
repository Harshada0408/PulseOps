'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Mode } from '@/lib/types';

const KEY = 'pulseops-mode';
const ModeContext = createContext<{ mode: Mode; setMode: (m: Mode) => void }>({ mode: 'real', setMode: () => undefined });
export const useMode = () => useContext(ModeContext);

/** 'real' = live monitoring data, 'simulated' = demo data. Never mixed: every API call carries the mode. */
export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<Mode>('real');
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === 'simulated') setModeState('simulated');
    } catch { /* ignore */ }
  }, []);
  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    try { localStorage.setItem(KEY, m); } catch { /* ignore */ }
  }, []);
  return <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>;
}
