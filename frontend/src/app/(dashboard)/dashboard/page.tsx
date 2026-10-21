'use client';

import { useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useMode } from '@/components/mode-provider';
import { LatencyChart } from '@/components/common/latency-chart';
import { EmptyState, ErrorState, HealthBadge, Panel, PageHeader, ResultBadge, SimBadge, Spinner, StatCard, StatusBadge, TypeBadge, tableCls as t } from '@/components/common/ui';
import { fmtAgo, fmtMs, fmtPct } from '@/lib/format';

export default function DashboardPage() {
  const { mode } = useMode();
  const [win, setWin] = useState('24h');
  const { data, error, loading, refreshing, reload } = useFetch(() => Api.summary(mode, win), [mode, win], { pollMs: 30_000 });

  if (loading && !data) return <Spinner label="Loading dashboard…" />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  const c = data.cards;

  return (
    <>
      <PageHeader title="Dashboard" description={mode === 'simulated' ? 'Simulated demo data.' : 'Live data from your monitors, refreshed every 30 seconds.'}
        actions={<>
          <select aria-label="Time window" value={win} onChange={(e) => setWin(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-2 text-sm">
            {['1h', '24h', '7d', '30d'].map((w) => <option key={w} value={w}>Last {w}</option>)}
          </select>
          <Button variant="outline" size="sm" onClick={reload} disabled={refreshing}><RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />Refresh</Button>
        </>} />
      {error && <p role="alert" className="mb-4 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">Could not refresh: {error}. Showing the last data received.</p>}

      {c.totalMonitors === 0 ? (
        <Panel><EmptyState title={mode === 'simulated' ? 'No demo data yet' : 'No monitors yet'}
          description={mode === 'simulated' ? 'Open the Simulation Lab and run a scenario to generate demo data.' : 'Register an API to start collecting checks. PulseOps will detect repeated failures and slow responses and open incidents with their evidence.'}
          action={mode === 'simulated' ? { label: 'Open Simulation Lab', href: '/simulation' } : { label: 'Add your first monitor', href: '/monitors/new' }} /></Panel>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <StatCard label="Active monitors" value={c.activeMonitors} hint={`${c.totalMonitors} total · ${c.paused} paused`} />
            <StatCard label="Healthy" value={c.healthy} tone="ok" />
            <StatCard label="Degraded" value={c.degraded} tone={c.degraded ? 'warn' : undefined} hint="open latency incident" />
            <StatCard label="Unavailable" value={c.unavailable} tone={c.unavailable ? 'bad' : undefined} hint="open availability incident" />
            <StatCard label="Open incidents" value={c.openIncidents} tone={c.openIncidents ? 'bad' : undefined} />
            <StatCard label={`Failures (${win})`} value={c.failedChecks} hint={`of ${c.totalChecks} checks`} tone={c.failedChecks ? 'warn' : undefined} />
            <StatCard label="Avg latency" value={fmtMs(c.avgLatencyMs)} hint="successful checks" />
            <StatCard label="p95 latency" value={fmtMs(c.p95LatencyMs)} hint="successful checks" />
            <StatCard label="Uptime (estimate)" value={fmtPct(c.uptimePercent)} hint="successful / total checks" />
          </div>

          <Panel title="Response latency" description={`Average per ${data.bucketSeconds >= 3600 ? `${data.bucketSeconds / 3600} h` : `${Math.round(data.bucketSeconds / 60)} min`} bucket, successful checks only.`}>
            <LatencyChart series={data.latencySeries} bucketSeconds={data.bucketSeconds} showP95 />
            <p className="mt-2 text-xs text-muted-foreground">Blue: average. Red: p95. Uptime is an estimate from sampled checks; it cannot see outages between checks.</p>
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Recent incidents" actions={<Link href="/incidents" className="text-xs text-primary hover:underline">View all</Link>}>
              {data.recentIncidents.length === 0 ? <EmptyState title="No incidents" description="Nothing has crossed an incident threshold." /> : (
                <ul className="divide-y divide-border">
                  {data.recentIncidents.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <Link href={`/incidents/${i.id}`} className="block truncate text-sm font-medium hover:text-primary hover:underline">{i.monitorName}</Link>
                        <p className="text-xs text-muted-foreground">Opened {fmtAgo(i.openedAt)}</p>
                      </div>
                      <div className="flex shrink-0 gap-1.5"><SimBadge type={i.observationType} /><TypeBadge type={i.type} /><StatusBadge status={i.status} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Slowest endpoints" description={`Ranked by p95 latency, last ${win}.`}>
              {data.slowestEndpoints.length === 0 ? <EmptyState title="No latency data" /> : (
                <div className={t.wrap}><table className={t.table}>
                  <thead><tr><th className={t.th}>Monitor</th><th className={t.th}>Avg</th><th className={t.th}>p95</th><th className={t.th}>Samples</th></tr></thead>
                  <tbody>{data.slowestEndpoints.map((s) => (
                    <tr key={s.id} className={t.tr}><td className={t.td}><Link href={`/monitors/${s.id}`} className="font-medium hover:text-primary hover:underline">{s.name}</Link></td>
                      <td className={`${t.td} tabular-nums`}>{fmtMs(s.avgMs)}</td><td className={`${t.td} tabular-nums`}>{fmtMs(s.p95Ms)}</td><td className={`${t.td} tabular-nums`}>{s.samples}</td></tr>))}</tbody>
                </table></div>
              )}
            </Panel>
          </div>

          <Panel title="Recent checks">
            {data.recentChecks.length === 0 ? <EmptyState title="No checks recorded yet" description="Checks appear here once the worker has run them, or after a manual check." /> : (
              <div className={t.wrap}><table className={t.table}>
                <thead><tr><th className={t.th}>Monitor</th><th className={t.th}>Result</th><th className={t.th}>Latency</th><th className={t.th}>Error</th><th className={t.th}>When</th></tr></thead>
                <tbody>{data.recentChecks.map((r) => (
                  <tr key={r.id} className={t.tr}>
                    <td className={t.td}><Link href={`/monitors/${r.monitorId}`} className="hover:text-primary hover:underline">{r.monitorName}</Link> <SimBadge type={r.observationType} /></td>
                    <td className={t.td}><ResultBadge success={r.success} code={r.statusCode} /></td>
                    <td className={`${t.td} tabular-nums`}>{r.success ? fmtMs(r.latencyMs) : '—'}</td>
                    <td className={`${t.td} text-muted-foreground`}>{r.errorCategory ?? '—'}</td>
                    <td className={`${t.td} text-muted-foreground`}>{fmtAgo(r.checkedAt)}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </Panel>
          <details className="rounded-xl border border-border bg-card px-5 py-3 text-sm">
            <summary className="cursor-pointer font-medium">How these numbers are calculated</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>{data.methodology.window}</li><li>{data.methodology.latency}</li><li>{data.methodology.uptime}</li><li>{data.methodology.health}</li>
            </ul>
          </details>
        </div>
      )}
    </>
  );
}
