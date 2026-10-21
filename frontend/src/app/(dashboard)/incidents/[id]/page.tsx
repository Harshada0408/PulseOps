'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Api } from '@/lib/api';
import { errorMessage, useFetch } from '@/hooks/use-fetch';
import { ErrorState, Panel, SimBadge, Spinner, StatusBadge, TypeBadge } from '@/components/common/ui';
import { fmtDateTime, fmtDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { TimelineEntry } from '@/lib/types';

const ROLE_STYLE: Record<string, string> = {
  LAST_HEALTHY: 'bg-ok', TRIGGER: 'bg-bad', CONTINUING: 'bg-warn', RECOVERY: 'bg-ok',
};

function TimelineRow({ e }: { e: TimelineEntry }) {
  const event = e.kind === 'EVENT';
  return (
    <li className="relative flex gap-4 pb-6 last:pb-0">
      <span aria-hidden className="absolute left-[7px] top-4 h-full w-px bg-border last:hidden" />
      <span aria-hidden className={cn('relative mt-1 h-4 w-4 shrink-0 rounded-full border-2 border-card', event ? 'bg-primary ring-2 ring-primary/40' : ROLE_STYLE[e.role ?? ''] ?? 'bg-muted-foreground')} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <p className="text-sm font-semibold">{e.label}</p>
          <p className="text-xs tabular-nums text-muted-foreground">{fmtDateTime(e.at)}</p>
          <span className={cn('rounded border px-1.5 text-[10px] font-medium uppercase tracking-wide', event ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground')}>
            {event ? 'state change' : 'check observed'}
          </span>
        </div>
        <p className="mt-0.5 break-words text-sm text-muted-foreground">{e.detail}</p>
      </div>
    </li>
  );
}

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useFetch(() => Api.incident(id), [id], { pollMs: 20_000 });
  const meta = useFetch(() => Api.meta(), []);
  const [ai, setAi] = useState<{ label: string; text: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  const { incident: i, explanation: x, timeline } = data;
  const rule = i.triggerRule;

  const runAi = async () => {
    setAiBusy(true); setAiError('');
    try { setAi(await Api.aiSummary(i.id)); } catch (e) { setAiError(errorMessage(e)); } finally { setAiBusy(false); }
  };

  return (
    <>
      <Link href="/incidents" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden />All incidents</Link>
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2"><TypeBadge type={i.type} /><StatusBadge status={i.status} /><SimBadge type={i.observationType} />
          <span className="font-mono text-xs text-muted-foreground">#{i.id}</span></div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{x.headline}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <Link href={`/monitors/${i.monitor.id}`} className="font-medium text-foreground hover:text-primary hover:underline">{i.monitor.name}</Link> · {i.monitor.method} <span className="break-all">{i.monitor.url}</span>
        </p>
      </div>

      <div className="space-y-6">
        <Panel title="Lifecycle" description="Measurement times and state-change times are different things and are labelled separately.">
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Problem first observed (first triggering check)</dt><dd className="font-medium tabular-nums">{fmtDateTime(i.startedAt)}</dd></div>
            <div><dt className="text-muted-foreground">Incident opened (state change)</dt><dd className="font-medium tabular-nums">{fmtDateTime(i.openedAt)}</dd></div>
            <div><dt className="text-muted-foreground">Recovery first observed (first qualifying check)</dt><dd className="font-medium tabular-nums">{fmtDateTime(i.recoveryStartedAt)}</dd></div>
            <div><dt className="text-muted-foreground">Incident resolved (state change)</dt><dd className="font-medium tabular-nums">{i.resolvedAt ? fmtDateTime(i.resolvedAt) : 'Still open'}</dd></div>
            <div><dt className="text-muted-foreground">Duration</dt><dd className="font-medium">{fmtDuration(i.startedAt, i.resolvedAt)}{i.status === 'OPEN' ? ' and counting' : ''}</dd></div>
          </dl>
        </Panel>

        <Panel title="Why this incident opened" description="Rule and threshold configured on the monitor when it fired.">
          <p className="text-sm">{i.triggerReason}</p>
          <dl className="mt-3 grid gap-2 rounded-lg bg-muted/60 p-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Rule</dt><dd className="font-mono text-xs">{rule.rule}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Consecutive checks required</dt><dd>{rule.consecutiveRequired}</dd></div>
            {rule.latencyThresholdMs != null && <div><dt className="text-xs text-muted-foreground">Latency threshold</dt><dd>{rule.latencyThresholdMs} ms</dd></div>}
            <div><dt className="text-xs text-muted-foreground">Recovery rule</dt><dd><span className="font-mono text-xs">{rule.recoveryRule}</span> × {rule.recoveryRequired}</dd></div>
          </dl>
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Observed facts" description="Derived directly from stored check results.">
            <ul className="list-disc space-y-2 pl-5 text-sm">{x.facts.map((f, k) => <li key={k}>{f}</li>)}</ul>
            {x.recovery && <p className="mt-4 rounded-lg border border-ok/30 bg-ok/10 p-3 text-sm text-ok">{x.recovery}</p>}
          </Panel>
          <Panel title="Hypotheses to investigate" description="Possible causes. Not confirmed: PulseOps has no telemetry from inside your service.">
            <ul className="list-disc space-y-2 pl-5 text-sm">{x.hypotheses.map((h, k) => <li key={k}>{h}</li>)}</ul>
            <h3 className="mt-4 text-sm font-semibold">Suggested investigation steps</h3>
            <ol className="mt-1 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">{x.investigationSteps.map((s, k) => <li key={k}>{s}</li>)}</ol>
          </Panel>
        </div>

        <Panel title="Evidence timeline" description="Chronological. Dots mark checks (red = triggering, green = healthy/recovery); blue marks state changes made by PulseOps.">
          <ol aria-label="Incident timeline">{timeline.map((e, k) => <TimelineRow key={k} e={e} />)}</ol>
        </Panel>

        <Panel title="AI investigation assistant (optional)" description="Summarises sanitised evidence only. It never decides whether an incident exists.">
          {!meta.data?.ai.enabled ? (
            <p className="text-sm text-muted-foreground">Not configured. Everything above works without it. To enable it, set <code className="rounded bg-muted px-1">AI_PROVIDER</code>, <code className="rounded bg-muted px-1">AI_BASE_URL</code>, <code className="rounded bg-muted px-1">AI_API_KEY</code> and <code className="rounded bg-muted px-1">AI_MODEL</code> in the backend <code className="rounded bg-muted px-1">.env</code>.</p>
          ) : (
            <div className="space-y-3">
              <Button size="sm" onClick={runAi} disabled={aiBusy}><Sparkles className="mr-1.5 h-4 w-4" aria-hidden />{aiBusy ? 'Thinking…' : 'Suggest troubleshooting checklist'}</Button>
              {aiError && <p role="alert" className="text-sm text-bad">{aiError}</p>}
              {ai && <div className="rounded-lg border border-border p-3"><p className="mb-2 text-xs font-medium uppercase text-warn">{ai.label}</p><p className="whitespace-pre-wrap text-sm">{ai.text}</p></div>}
            </div>
          )}
        </Panel>
        <p className="text-xs text-muted-foreground">{x.caveat}</p>
      </div>
    </>
  );
}
