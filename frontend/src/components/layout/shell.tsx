'use client';

import { Sidebar } from './sidebar';
import { Header } from './header';
import { ModeProvider } from '@/components/mode-provider';
import { cn } from '@/lib/utils';

export function DashboardShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <ModeProvider>
      <div className="min-h-screen bg-background">
        <Sidebar />
        <div className="lg:pl-60">
          <Header />
          <main id="main" className={cn('mx-auto w-full max-w-7xl p-4 md:p-8', className)}>{children}</main>
        </div>
      </div>
    </ModeProvider>
  );
}
