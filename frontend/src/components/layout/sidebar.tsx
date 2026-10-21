'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, FlaskConical, LayoutDashboard, Monitor, Settings, Siren } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/common/logo';

export const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/monitors', label: 'Monitors', icon: Monitor },
  { href: '/incidents', label: 'Incidents', icon: Siren },
  { href: '/simulation', label: 'Simulation Lab', icon: FlaskConical },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1 p-3">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} onClick={onNavigate} aria-current={active ? 'page' : undefined}
            className={cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
            <Icon className="h-4 w-4" aria-hidden />{label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-card lg:flex">
      <div className="flex h-14 items-center border-b border-border px-5"><Link href="/dashboard" aria-label="PulseOps home"><Logo /></Link></div>
      <NavLinks />
      <div className="mt-auto flex items-center gap-2 border-t border-border p-4 text-xs text-muted-foreground">
        <Activity className="h-3.5 w-3.5" aria-hidden />Open-source foundation: MIT
      </div>
    </aside>
  );
}
