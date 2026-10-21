'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Pause, Play, RefreshCw, Trash2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Api } from '@/lib/api';
import { errorMessage, useFetch } from '@/hooks/use-fetch';
import { LatencyChart } from '@/components/common/latency-chart';
import { MonitorForm } from '@/components/common/monitor-form';
import { useToast } from '@/components/common/toast';
import { EmptyState, ErrorState, HealthBadge, PageHeader, Pagination, Panel, ResultBadge, SimBadge, Spinner, StatCard, StatusBadge, TypeBadge, tableCls as t } from '@/components/common/ui';
import { fmtAgo, fmtDateTime, fmtMs, fmtPct } from '@/lib/format';

export default function MonitorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [win, setWin] = useState('24h');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const detail = useFetch(() => Api.monitor(id, win), [id, win], { pollMs: 30_000 });
  const results = useFetch(() => Api.results(id, page, 15), [id, page], { pollMs: 30_000 });

  if (detail.loading && !detail.data) return <Spinner />;
  if (detail.error && !detail.data) return <ErrorState message={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return null;
  const { monitor: m, stats, latencySeries, recentIncidents, bucketSeconds } = detail.data;

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast('error', errorMessage(e)); } finally { setBusy(null); }
  };
  const reloadAll = () => { void detail.reload(); void results.reload(); };

  return (
    <>
      <PageHeader
        title={m.name}
        description={<span className="flex flex-wrap items-center gap-2"><HealthBadge health={m.health} />{m.isSimulated && <SimBadge type="SIMULATED" />}<span className="break-all">{m.method} {m.url}</span></span>}
        actions={!m.isSimulated ? <>
          <Button size="sm" disabled={busy === 'check'} onClick={() => act('check', async () => {
            const r = await Api.check(m.id);
            toast(r.result.success ? 'success' : 'error', `Check ${r.result.success ? 'succeeded' : 'failed'}: ${r.result.statusCode ?? r.result.errorCategory ?? 'no response'} in ${fmtMs(r.result.latencyMs)}.${r.incidentsOpened.length ? ' An incident was opened.' : ''}${r.incidentsResolved.length ? ' An incident was resolved.' : ''}`);
            reloadAll();
          })}><Zap className="mr-1.5 h-4 w-4" aria-hidden />Check now</Button>
          <Button size="sm" variant="outline" disabled={busy === 'pause'} onClick={() => act('pause', async () => { await (m.isPaused ? Api.resume(m.id) : Api.pause(m.id)); toast('success', m.isPaused ? 'Monitoring resumed.' : 'Monitoring paused.'); reloadAll(); })}>
            {m.isPaused ? <><Play className="mr-1.5 h-4 w-4" aria-hidden />Resume</> : <><Pause className="mr-1.5 h-4 w-4" aria-hidden />Pause</>}</Button>
          <Button size="sm" variant="outline" onClick={() => setEditing((e) => !e)}>{editing ? 'Close editor' : 'Edit'}</Button>
          <Button size="sm" variant="outline" className="text-bad hover:text-bad" onClick={() => setConfirmDelete(true)}><Trash2 className="mr-1.5 h-4 w-4" aria-hidden />Delete</Button>
        </> : <Button size="sm" variant="outline" asChild><Link href="/simulation">Simulation Lab</Link></Button>}
      />

      {editing && (
        <Panel title="Edit monitor" className="mb-6 max-w-3xl">
          <MonitorForm initial={m} submitLabel="Save changes" onCancel={() => setEditing(false)}
            onSubmit={async (input) => { await Api.updateMonitor(m.id, input); toast('success', 'Monitor updated.'); setEditing(false); reloadAll(); }} />
        </Panel>
      )}

      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <label htmlFor="win" className="text-sm text-muted-foreground">Window</label>
          <select id="win" value={win} onChange={(e) => setWin(e.target.value)} className="h-9 rounded-lg border border-input bg-background px-2 text-sm">
            {['1h', '24h', '7d', '30d'].map((w) => <option key={w} value={w}>Last {w}</option>)}
          </select>
          <Button variant="ghost" size="sm" onClick={reloadAll}><RefreshCw className="mr-1.5 h-4 w-4" aria-hidden />Refresh</Button>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="Checks" value={stats.totalChecks} hint={`${stats.failedChecks} failed`} />
          <StatCard label="Uptime (estimate)" value={fmtPct(stats.uptimePercent)} />
          <StatCard label="Avg latency" value={fmtMs(stats.avgLatencyMs)} />
          <StatCard label="p95 latency" value={fmtMs(stats.p95LatencyMs)} />
          <StatCard label="Max latency" value={fmtMs(stats.maxLatencyMs)} />
        </div>
        <Panel title="Latency" description={stats.latencyNote}>
          <LatencyChart series={latencySeries} bucketSeconds={bucketSeconds} thresholdMs={m.latencyThresholdMs} />
          <p className="mt-2 text-xs text-muted-foreground">{stats.uptimeNote}</p>
        </Panel>

        <div className="grid gap-6 lg:grid-cols-3">
          <Panel title="Settings" className="lg:col-span-1">
            <dl className="space-y-2 text-sm">
              {[['Interval', `${m.interval} s`], ['Timeout', `${m.timeout} s`], ['Latency threshold', `${m.latencyThresholdMs} ms`],
                ['Availability incident after', `${m.failureThreshold} consecutive failures`], ['Latency incident after', `${m.latencyBreachThreshold} consecutive slow checks`],
                ['Resolve after', `${m.recoveryThreshold} consecutive healthy checks`], ['Expected status', m.expectedStatus ?? 'any 2xx'], ['Expected keyword', m.expectedKeyword ?? '—'],
                ['Last checked', m.lastCheckedAt ? fmtDateTime(m.lastCheckedAt) : 'never']].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{String(v)}</dd></div>))}
            </dl>
          </Panel>
          <Panel title="Incident history" className="lg:col-span-2">
            {recentIncidents.length === 0 ? <EmptyState title="No incidents for this monitor" /> : (
              <ul className="divide-y divide-border">{recentIncidents.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0"><Link href={`/incidents/${i.id}`} className="block truncate text-sm font-medium hover:text-primary hover:underline">{i.reason}</Link>
                    <p className="text-xs text-muted-foreground">Started {fmtDateTime(i.startedAt)}</p></div>
                  <div className="flex shrink-0 gap-1.5"><TypeBadge type={i.type} /><StatusBadge status={i.status} /></div>
                </li>))}</ul>
            )}
          </Panel>
        </div>

        <Panel title="Recent results" className="[&>div]:p-0">
          {results.loading && !results.data ? <Spinner /> : !results.data || results.data.results.length === 0 ? <EmptyState title="No results yet" description="Use “Check now” or wait for the next scheduled check." /> : (
            <div className={t.wrap}><table className={t.table}>
              <thead><tr><th className={t.th}>Time</th><th className={t.th}>Result</th><th className={t.th}>Latency</th><th className={t.th}>Error</th><th className={t.th}>Type</th></tr></thead>
              <tbody>{results.data.results.map((r) => (
                <tr key={r.id} className={t.tr}>
                  <td className={`${t.td} whitespace-nowrap`} title={fmtDateTime(r.checkedAt)}>{fmtDateTime(r.checkedAt)}</td>
                  <td className={t.td}><ResultBadge success={r.success} code={r.statusCode} /></td>
                  <td className={`${t.td} tabular-nums`}>{r.success ? fmtMs(r.latencyMs) : '—'}</td>
                  <td className={`${t.td} max-w-xs truncate text-muted-foreground`} title={r.error ?? ''}>{r.errorCategory ? `${r.errorCategory}${r.error ? ` · ${r.error}` : ''}` : '—'}</td>
                  <td className={t.td}>{r.observationType === 'SIMULATED' ? <SimBadge type="SIMULATED" /> : <span className="text-xs text-muted-foreground">Real</span>}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </Panel>
        {results.data && <div className="px-1"><Pagination page={results.data.page} limit={results.data.limit} total={results.data.total} onPage={setPage} /></div>}
      </div>

      <Modal open={confirmDelete} onOpenChange={setConfirmDelete} title="Delete this monitor?" description="Its check history and incidents are permanently removed. This cannot be undone.">
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="destructive" disabled={busy === 'delete'} onClick={() => act('delete', async () => { await Api.deleteMonitor(m.id); toast('success', 'Monitor deleted.'); router.push('/monitors'); })}>Delete monitor</Button>
        </div>
      </Modal>
    </>
  );
}
