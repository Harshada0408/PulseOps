export const fmtMs = (ms: number | null | undefined) =>
  ms == null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;

export const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(v % 1 === 0 ? 0 : 2)}%`);

/** Absolute, unambiguous timestamp (local time + zone). Used everywhere so times read consistently. */
export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    timeZoneName: 'short',
  });
}

export function fmtTime(value: string | number | Date): string {
  return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function fmtAgo(value: string | Date | null | undefined): string {
  if (!value) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export function fmtDuration(from: string | Date, to: string | Date | null | undefined): string {
  const ms = (to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
