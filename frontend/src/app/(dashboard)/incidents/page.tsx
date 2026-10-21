'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Api } from '@/lib/api';
import { useFetch } from '@/hooks/use-fetch';
import { useMode } from '@/components/mode-provider';
import { EmptyState, ErrorState, PageHeader, Pagination, Panel, SimBadge, Spinner, StatusBadge, TypeBadge, tableCls as t } from '@/components/common/ui';
import { fmtDateTime, fmtDuration } from '@/lib/format';

const sel = 'h-9 rounded-lg border border-input bg-background px-2 text-sm';

export default function IncidentsPage() {
  const { mode } = useMode();
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useFetch(
    () => Api.incidents({ mode, status: status || undefined, type: type || undefined, page, limit: 20 }), [mode, status, type, page], { pollMs: 30_000 });

  return (
    <>
      <PageHeader title="Incidents" description="Opened and resolved automatically by the detection rules. Open one to see the evidence." />
      <div className="mb-4 flex flex-wrap gap-2">
        <select aria-label="Filter by status" className={sel} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option><option value="OPEN">Open</option><option value="RESOLVED">Resolved</option></select>
        <select aria-label="Filter by type" className={sel} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
          <option value="">All types</option><option value="AVAILABILITY">Availability</option><option value="LATENCY">Latency</option></select>
      </div>
      <Panel className="[&>div]:p-0">
        {loading && !data ? <Spinner /> : error && !data ? <ErrorState message={error} onRetry={reload} /> : !data || data.incidents.length === 0 ? (
          <EmptyState title="No incidents" description={status || type ? 'No incidents match these filters.' : 'Good news, or no data yet: nothing has met an incident rule.'} />
        ) : (
          <div className={t.wrap}><table className={t.table}>
            <thead><tr><th className={t.th}>Monitor</th><th className={t.th}>Type</th><th className={t.th}>Status</th><th className={t.th}>Started</th><th className={t.th}>Duration</th><th className={t.th}>Trigger</th></tr></thead>
            <tbody>{data.incidents.map((i) => (
              <tr key={i.id} className={t.tr}>
                <td className={t.td}><Link href={`/incidents/${i.id}`} className="font-medium hover:text-primary hover:underline">{i.monitor.name}</Link> <SimBadge type={i.observationType} /></td>
                <td className={t.td}><TypeBadge type={i.type} /></td><td className={t.td}><StatusBadge status={i.status} /></td>
                <td className={`${t.td} whitespace-nowrap`}>{fmtDateTime(i.startedAt)}</td>
                <td className={`${t.td} tabular-nums`}>{fmtDuration(i.startedAt, i.resolvedAt)}{i.status === 'OPEN' ? ' (ongoing)' : ''}</td>
                <td className={`${t.td} max-w-sm truncate text-muted-foreground`} title={i.reason}>{i.reason}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Panel>
      {data && <div className="px-1"><Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} /></div>}
    </>
  );
}
