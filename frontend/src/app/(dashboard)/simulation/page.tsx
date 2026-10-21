'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FlaskConical, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Api } from '@/lib/api';
import { errorMessage, useFetch } from '@/hooks/use-fetch';
import { useMode } from '@/components/mode-provider';
import { useToast } from '@/components/common/toast';
import { ErrorState, PageHeader, Panel, SimBadge, Spinner } from '@/components/common/ui';

export default function SimulationPage() {
  const { setMode } = useMode();
  const toast = useToast();
  const { data, error, loading, reload } = useFetch(() => Api.simScenarios(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const run = async (id: string, title: string) => {
    setBusy(id);
    try {
      const r = await Api.simRun(id);
      const parts = [`${r.checksRecorded} simulated checks`, ...r.incidentsOpened.map((o) => `opened ${o.type.toLowerCase()} incident`), ...r.incidentsResolved.map((o) => `resolved ${o.type.toLowerCase()} incident`)];
      setLog((l) => [`${title}: ${parts.join(', ')}.`, ...l].slice(0, 8));
      toast('success', `${title} done.`);
      setMode('simulated');
    } catch (e) { toast('error', errorMessage(e)); } finally { setBusy(null); }
  };
  const reset = async () => {
    setBusy('reset');
    try { await Api.simReset(); setLog([]); toast('success', 'Demo data reset.'); } catch (e) { toast('error', errorMessage(e)); } finally { setBusy(null); }
  };

  return (
    <>
      <PageHeader title="Simulation Lab" description="Reproducible failure scenarios for demos. No network requests are made."
        actions={<Button variant="outline" size="sm" onClick={reset} disabled={busy !== null}><RotateCcw className="mr-1.5 h-4 w-4" aria-hidden />Reset demo data</Button>} />
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-sim/30 bg-sim/10 p-4 text-sm">
        <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-sim" aria-hidden />
        <p>Scenarios feed fixed, deterministic measurements through the <strong>same incident engine</strong> used for real checks, on a dedicated simulated monitor. Everything produced is stored and labelled <SimBadge type="SIMULATED" /> and is kept out of your live dashboard. Use the <strong>Live data / Demo data</strong> switch in the header to view it.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {data.scenarios.map((s) => (
          <Panel key={s.id} title={s.title} description={`${s.checks} checks`} actions={
            <Button size="sm" onClick={() => run(s.id, s.title)} disabled={busy !== null}><Play className="mr-1.5 h-4 w-4" aria-hidden />{busy === s.id ? 'Running…' : 'Run'}</Button>}>
            <p className="text-sm text-muted-foreground">{s.description}</p>
          </Panel>
        ))}
      </div>
      <Panel title="Activity" className="mt-6">
        {log.length === 0 ? <p className="text-sm text-muted-foreground">Run a scenario to see what happened.</p> : <ul className="space-y-1.5 text-sm">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
        <div className="mt-4 flex gap-3 text-sm">
          <Link href="/incidents" onClick={() => setMode('simulated')} className="text-primary hover:underline">View simulated incidents</Link>
          <Link href="/dashboard" onClick={() => setMode('simulated')} className="text-primary hover:underline">View demo dashboard</Link>
        </div>
      </Panel>
    </>
  );
}
