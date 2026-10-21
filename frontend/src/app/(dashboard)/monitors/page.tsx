'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useMode } from '@/components/mode-provider';
import { EmptyState, ErrorState, HealthBadge, PageHeader, Pagination, Panel, SimBadge, Spinner, tableCls as t } from '@/components/common/ui';
import { fmtAgo, fmtMs } from '@/lib/format';

export default function MonitorsPage() {
  const { mode } = useMode();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const { data, error, loading, reload } = useFetch(() => Api.monitors({ mode, page, limit: 20, search: search || undefined }), [mode, page, search], { pollMs: 30_000 });

  return (
    <>
      <PageHeader title="Monitors" description="APIs registered for scheduled health checks."
        actions={mode === 'real' ? <Button asChild size="sm"><Link href="/monitors/new"><Plus className="mr-1.5 h-4 w-4" aria-hidden />New monitor</Link></Button> : undefined} />
      <form className="mb-4 flex max-w-sm gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(q.trim()); }} role="search">
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search monitors" placeholder="Search name or URL" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Button type="submit" variant="outline">Search</Button>
      </form>
      <Panel className="[&>div]:p-0">
        {loading && !data ? <Spinner /> : error && !data ? <ErrorState message={error} onRetry={reload} /> : !data || data.monitors.length === 0 ? (
          <EmptyState title={search ? 'No monitors match your search' : mode === 'simulated' ? 'No simulated monitor yet' : 'No monitors yet'}
            description={search ? undefined : mode === 'simulated' ? 'Run a scenario in the Simulation Lab to create it.' : 'Add an API to start monitoring.'}
            action={!search ? (mode === 'simulated' ? { label: 'Simulation Lab', href: '/simulation' } : { label: 'Add a monitor', href: '/monitors/new' }) : undefined} />
        ) : (
          <div className={t.wrap}><table className={t.table}>
            <thead><tr><th className={t.th}>Monitor</th><th className={t.th}>Status</th><th className={t.th}>Last check</th><th className={t.th}>Latency</th><th className={t.th}>Interval</th><th className={t.th}>Rules</th></tr></thead>
            <tbody>{data.monitors.map((m) => (
              <tr key={m.id} className={t.tr}>
                <td className={t.td}><Link href={`/monitors/${m.id}`} className="font-medium hover:text-primary hover:underline">{m.name}</Link> {m.isSimulated && <SimBadge type="SIMULATED" />}
                  <div className="max-w-xs truncate text-xs text-muted-foreground" title={m.url}>{m.method} {m.url}</div></td>
                <td className={t.td}><HealthBadge health={m.health} /></td>
                <td className={`${t.td} text-muted-foreground`}>{fmtAgo(m.lastCheck?.checkedAt)}</td>
                <td className={`${t.td} tabular-nums`}>{m.lastCheck?.success ? fmtMs(m.lastCheck.latencyMs) : '—'}</td>
                <td className={`${t.td} tabular-nums`}>{m.interval}s</td>
                <td className={`${t.td} text-xs text-muted-foreground`}>{m.failureThreshold} fails · &gt;{m.latencyThresholdMs} ms ×{m.latencyBreachThreshold}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Panel>
      {data && <div className="px-1"><Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} /></div>}
    </>
  );
}
