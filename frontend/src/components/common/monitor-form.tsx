'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { MonitorInput } from '@/lib/types';
import { errorMessage } from '@/hooks/use-fetch';

const DEFAULTS = {
  name: '', url: '', method: 'GET', interval: '60', timeout: '10', latencyThresholdMs: '1000',
  failureThreshold: '3', latencyBreachThreshold: '3', recoveryThreshold: '2', expectedStatus: '', expectedKeyword: '',
};
type Form = typeof DEFAULTS;

export function toForm(m: Partial<MonitorInput>): Form {
  return {
    name: m.name ?? '', url: m.url ?? '', method: m.method ?? 'GET', interval: String(m.interval ?? 60), timeout: String(m.timeout ?? 10),
    latencyThresholdMs: String(m.latencyThresholdMs ?? 1000), failureThreshold: String(m.failureThreshold ?? 3),
    latencyBreachThreshold: String(m.latencyBreachThreshold ?? 3), recoveryThreshold: String(m.recoveryThreshold ?? 2),
    expectedStatus: m.expectedStatus ? String(m.expectedStatus) : '', expectedKeyword: m.expectedKeyword ?? '',
  };
}

function validate(f: Form): Record<string, string> {
  const e: Record<string, string> = {};
  const int = (k: keyof Form, min: number, max: number, label: string) => {
    const n = Number(f[k]);
    if (!Number.isInteger(n) || n < min || n > max) e[k] = `${label} must be a whole number between ${min} and ${max}.`;
  };
  if (!f.name.trim()) e.name = 'Name is required.';
  try { const u = new URL(f.url); if (!/^https?:$/.test(u.protocol)) e.url = 'URL must start with http:// or https://'; } catch { e.url = 'Enter a valid URL, e.g. https://api.example.com/health'; }
  int('interval', 30, 3600, 'Check interval'); int('timeout', 1, 120, 'Timeout');
  int('latencyThresholdMs', 50, 600000, 'Latency threshold'); int('failureThreshold', 1, 20, 'Failure threshold');
  int('latencyBreachThreshold', 1, 20, 'Slow-check count'); int('recoveryThreshold', 1, 20, 'Recovery checks');
  if (!e.timeout && !e.latencyThresholdMs && Number(f.latencyThresholdMs) >= Number(f.timeout) * 1000) e.latencyThresholdMs = 'Latency threshold must be lower than the timeout (otherwise it can never trigger).';
  if (f.expectedStatus && (!Number.isInteger(Number(f.expectedStatus)) || Number(f.expectedStatus) < 100 || Number(f.expectedStatus) > 599)) e.expectedStatus = 'Use a status code between 100 and 599, or leave empty for any 2xx.';
  return e;
}

export function MonitorForm({ initial, submitLabel, onSubmit, onCancel }: {
  initial?: Partial<MonitorInput>; submitLabel: string; onSubmit: (input: MonitorInput) => Promise<void>; onCancel?: () => void;
}) {
  const [f, setF] = useState<Form>(toForm(initial ?? {}));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Form) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: ev.target.value }));

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const e = validate(f); setErrors(e); setServerError('');
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await onSubmit({
        name: f.name.trim(), url: f.url.trim(), method: f.method, interval: +f.interval, timeout: +f.timeout,
        latencyThresholdMs: +f.latencyThresholdMs, failureThreshold: +f.failureThreshold,
        latencyBreachThreshold: +f.latencyBreachThreshold, recoveryThreshold: +f.recoveryThreshold,
        expectedStatus: f.expectedStatus ? +f.expectedStatus : null, expectedKeyword: f.expectedKeyword.trim() || null,
      });
    } catch (err) { setServerError(errorMessage(err)); } finally { setBusy(false); }
  };

  const field = (k: keyof Form, label: string, hint: string, type = 'text') => (
    <div className="space-y-1.5">
      <Label htmlFor={k}>{label}</Label>
      <Input id={k} type={type} value={f[k]} onChange={set(k)} aria-invalid={!!errors[k]} aria-describedby={`${k}-h`} />
      <p id={`${k}-h`} className={errors[k] ? 'text-xs text-bad' : 'text-xs text-muted-foreground'}>{errors[k] || hint}</p>
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {serverError && <p role="alert" className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{serverError}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {field('name', 'Name', 'A label for this monitor.')}
        <div className="space-y-1.5">
          <Label htmlFor="method">HTTP method</Label>
          <select id="method" value={f.method} onChange={set('method')} className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">GET is the best-tested option.</p>
        </div>
      </div>
      {field('url', 'URL', 'Public http(s) address. Private, loopback and cloud-metadata addresses are refused.', 'url')}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Scheduling</legend>
        <div className="grid gap-4 md:grid-cols-2">
          {field('interval', 'Check interval (seconds)', '30 – 3600.', 'number')}
          {field('timeout', 'Timeout (seconds)', 'A check slower than this counts as a timeout failure.', 'number')}
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Incident rules</legend>
        <div className="grid gap-4 md:grid-cols-2">
          {field('failureThreshold', 'Open an availability incident after N consecutive failures', 'Default 3.', 'number')}
          {field('latencyThresholdMs', 'Latency threshold (ms)', 'A successful response slower than this counts as slow.', 'number')}
          {field('latencyBreachThreshold', 'Open a latency incident after N consecutive slow checks', 'Default 3.', 'number')}
          {field('recoveryThreshold', 'Resolve after N consecutive healthy checks', 'Default 2.', 'number')}
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Response validation (optional)</legend>
        <div className="grid gap-4 md:grid-cols-2">
          {field('expectedStatus', 'Expected status code', 'Empty = any 2xx counts as success.', 'number')}
          {field('expectedKeyword', 'Expected keyword in body', 'A 200 response without it counts as a failure.')}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}{submitLabel}</Button>
        {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}
