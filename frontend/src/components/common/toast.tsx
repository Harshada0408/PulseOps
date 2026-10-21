'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';

type Kind = 'success' | 'error';
interface ToastItem { id: number; kind: Kind; message: string }
const ToastContext = createContext<(kind: Kind, message: string) => void>(() => undefined);

export const useToast = () => useContext(ToastContext);

/** Theme-aware notifications; announced to screen readers via aria-live. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: Kind, message: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, kind, message }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} role="status" className="pointer-events-auto flex items-start gap-2 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg">
            {t.kind === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-bad" aria-hidden />}
            <span className="flex-1">{t.message}</span>
            <button aria-label="Dismiss" className="text-muted-foreground hover:text-foreground" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}>
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
