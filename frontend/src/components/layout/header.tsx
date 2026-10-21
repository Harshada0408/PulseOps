'use client';

import { useState } from 'react';
import { LogOut, Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { useAuth } from '@/hooks/use-auth';
import { useMode } from '@/components/mode-provider';
import { NavLinks } from './sidebar';
import { Logo } from '@/components/common/logo';
import { cn } from '@/lib/utils';

export function ModeSwitch() {
  const { mode, setMode } = useMode();
  const opt = (m: 'real' | 'simulated', label: string) => (
    <button type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
      className={cn('rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        mode === m ? (m === 'simulated' ? 'bg-sim/15 text-sim' : 'bg-primary/15 text-primary') : 'text-muted-foreground hover:text-foreground')}>
      {label}
    </button>
  );
  return (
    <div role="radiogroup" aria-label="Data source" className="flex items-center rounded-lg border border-border bg-muted p-0.5">
      {opt('real', 'Live data')}{opt('simulated', 'Demo data')}
    </div>
  );
}

export function Header() {
  const { user, signOut } = useAuth() as any;
  const [open, setOpen] = useState(false);
  const { mode } = useMode();
  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur md:px-8">
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></Button>
        <div className="lg:hidden"><Logo compact /></div>
        <div className="ml-auto flex items-center gap-2">
          <ModeSwitch />
          <ThemeToggle />
          <span className="hidden max-w-[12rem] truncate text-sm text-muted-foreground md:inline" title={user?.email}>{user?.name || user?.email}</span>
          <Button variant="ghost" size="icon" aria-label="Sign out" title="Sign out" onClick={() => signOut?.()}><LogOut className="h-4 w-4" /></Button>
        </div>
      </header>
      {mode === 'simulated' && (
        <div role="status" className="border-b border-sim/30 bg-sim/10 px-4 py-1.5 text-center text-xs font-medium text-sim md:px-8">
          Demo mode: you are viewing SIMULATED data. Nothing here comes from a real endpoint.
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64 border-r border-border bg-card">
            <div className="flex h-14 items-center justify-between border-b border-border px-4"><Logo />
              <Button variant="ghost" size="icon" aria-label="Close navigation" onClick={() => setOpen(false)}><X className="h-5 w-5" /></Button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
