import { WINDOWS, type WindowKey } from '../schemas/monitor';

export const modeToType = (mode: 'real' | 'simulated') => (mode === 'simulated' ? 'SIMULATED' : 'REAL');

export const windowSeconds = (w: WindowKey) => WINDOWS[w];

/** Chart bucket width per window: keeps every chart at roughly 60-120 points. */
export const bucketSeconds = (w: WindowKey): number =>
  ({ '1h': 60, '24h': 900, '7d': 3600, '30d': 21_600 } as const)[w];

export type HealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'unknown' | 'paused';

/** Derived ONLY from persisted incident state: an open availability incident = unavailable, an open latency incident = degraded. */
export function deriveHealth(m: { isActive: boolean; isPaused: boolean; hasChecks: boolean; openTypes: string[] }): HealthStatus {
  if (m.isPaused || !m.isActive) return 'paused';
  if (m.openTypes.includes('AVAILABILITY')) return 'unavailable';
  if (m.openTypes.includes('LATENCY')) return 'degraded';
  return m.hasChecks ? 'healthy' : 'unknown';
}

export const round1 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10) / 10);
/** Observation-based uptime estimate: successful checks / all checks in the window. null when there are no checks. */
export const uptimePct = (ok: number, total: number) => (total === 0 ? null : Math.round((ok / total) * 10_000) / 100);
