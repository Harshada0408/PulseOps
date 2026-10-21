'use client';

import { Moon, Sun } from 'lucide-react';
import { Api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useTheme } from '@/components/theme-provider';
import { useMode } from '@/components/mode-provider';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { PageHeader, Panel, SimBadge, Spinner } from '@/components/common/ui';

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { mode, setMode } = useMode();
  const { user } = useAuth() as any;
  const { data: meta, loading } = useFetch(() => Api.meta(), []);

  const row = (k: string, v: React.ReactNode) => (<div className="flex flex-wrap justify-between gap-3 py-2.5 text-sm"><dt className="text-muted-foreground">{k}</dt><dd className="max-w-md text-right font-medium">{v}</dd></div>);

  return (
    <>
      <PageHeader title="Settings" />
      <div className="max-w-3xl space-y-6">
        <Panel title="Appearance" description="Saved in this browser. With no saved choice, PulseOps follows your system theme.">
          <div role="radiogroup" aria-label="Theme" className="flex gap-2">
            {(['light', 'dark'] as const).map((t) => (
              <Button key={t} role="radio" aria-checked={theme === t} variant={theme === t ? 'default' : 'outline'} size="sm" onClick={() => setTheme(t)}>
                {t === 'light' ? <Sun className="mr-1.5 h-4 w-4" aria-hidden /> : <Moon className="mr-1.5 h-4 w-4" aria-hidden />}{t === 'light' ? 'Light' : 'Dark'}
              </Button>))}
          </div>
        </Panel>
        <Panel title="Data mode" description="Which observations the dashboard, monitors and incidents pages show. The two are never mixed.">
          <div role="radiogroup" aria-label="Data mode" className="flex flex-wrap gap-2">
            <Button role="radio" aria-checked={mode === 'real'} size="sm" variant={mode === 'real' ? 'default' : 'outline'} onClick={() => setMode('real')}>Live data</Button>
            <Button role="radio" aria-checked={mode === 'simulated'} size="sm" variant={mode === 'simulated' ? 'default' : 'outline'} onClick={() => setMode('simulated')}>Demo data</Button>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">Current: <strong>{mode === 'real' ? 'Live data (real HTTP checks)' : 'Demo data'}</strong> {mode === 'simulated' && <SimBadge type="SIMULATED" />}</p>
        </Panel>
        <Panel title="Account">
          <dl className="divide-y divide-border">{row('Email', user?.email ?? '—')}{row('Name', user?.name ?? '—')}</dl>
        </Panel>
        <Panel title="System & integrations">
          {loading ? <Spinner /> : meta && (
            <dl className="divide-y divide-border">
              {row('Version', meta.version)}
              {row('Authentication', meta.authMode === 'local' ? 'Built-in (email + password in PostgreSQL)' : 'Supabase')}
              {row('Scheduler', meta.scheduler)}
              {row('Monitor limit per user', meta.maxMonitorsPerUser)}
              {row('AI assistant', meta.ai.enabled ? `Enabled (${meta.ai.provider})` : 'Not configured. Optional; core features do not need it. Set AI_PROVIDER, AI_BASE_URL, AI_API_KEY, AI_MODEL in the backend .env.')}
              {row('Email alerts', meta.email.enabled ? 'Enabled' : 'Not configured. Optional. Set RESEND_API_KEY and ENABLE_EMAILS=true in .env.')}
            </dl>
          )}
        </Panel>
      </div>
    </>
  );
}
