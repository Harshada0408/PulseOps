export type Mode = 'real' | 'simulated';
export type Health = 'healthy' | 'degraded' | 'unavailable' | 'unknown' | 'paused';
export type IncidentType = 'AVAILABILITY' | 'LATENCY';
export type IncidentStatus = 'OPEN' | 'RESOLVED';
export type ObservationType = 'REAL' | 'SIMULATED';

export interface Monitor {
  id: string; name: string; url: string; method: string; headers: Record<string, string>; hasBody: boolean;
  interval: number; timeout: number; expectedStatus: number | null; expectedKeyword: string | null;
  isActive: boolean; isPaused: boolean; isSimulated: boolean; region: string;
  latencyThresholdMs: number; failureThreshold: number; latencyBreachThreshold: number; recoveryThreshold: number;
  consecutiveFailures: number; consecutiveSlow: number;
  createdAt: string; updatedAt: string; lastCheckedAt: string | null;
  openIncidentTypes: IncidentType[]; health: Health;
  lastCheck: { checkedAt: string; statusCode: number | null; latencyMs: number; success: boolean } | null;
}
export interface Paged<T> { page: number; limit: number; total: number; items?: T[] }

export interface CheckResult {
  id: string; statusCode: number | null; latencyMs: number; success: boolean; errorCategory: string | null;
  error: string | null; observationType: ObservationType; checkedAt: string;
}
export interface SeriesPoint { t: number; avgMs: number | null; p95Ms?: number | null; maxMs?: number | null; failures: number; checks: number }

export interface IncidentRow {
  id: string; type: IncidentType; status: IncidentStatus; reason: string; startedAt: string; openedAt: string;
  resolvedAt: string | null; observationType: ObservationType; monitor: { id: string; name: string; url: string };
}

export interface DashboardSummary {
  mode: Mode; window: string;
  methodology: { window: string; latency: string; uptime: string; health: string };
  cards: {
    totalMonitors: number; activeMonitors: number; healthy: number; degraded: number; unavailable: number; unknown: number;
    paused: number; openIncidents: number; totalChecks: number; failedChecks: number;
    avgLatencyMs: number | null; p95LatencyMs: number | null; uptimePercent: number | null;
  };
  latencySeries: SeriesPoint[]; bucketSeconds: number;
  slowestEndpoints: { id: string; name: string; url: string; avgMs: number | null; p95Ms: number | null; samples: number }[];
  recentChecks: (CheckResult & { monitorId: string; monitorName: string })[];
  recentIncidents: { id: string; type: IncidentType; status: IncidentStatus; reason: string; monitorName: string; openedAt: string; resolvedAt: string | null; observationType: ObservationType }[];
}

export interface MonitorDetail {
  monitor: Monitor; window: string; bucketSeconds: number;
  stats: { totalChecks: number; successfulChecks: number; failedChecks: number; avgLatencyMs: number | null; p95LatencyMs: number | null; maxLatencyMs: number | null; uptimePercent: number | null; uptimeNote: string; latencyNote: string };
  latencySeries: SeriesPoint[];
  recentIncidents: { id: string; type: IncidentType; status: IncidentStatus; reason: string; startedAt: string; openedAt: string; resolvedAt: string | null; observationType: ObservationType }[];
}

export interface TimelineEntry {
  at: string; kind: 'CHECK' | 'EVENT'; timeBasis: 'observed' | 'state_change'; label: string; detail: string;
  role?: 'LAST_HEALTHY' | 'TRIGGER' | 'CONTINUING' | 'RECOVERY'; eventType?: 'OPENED' | 'RESOLVED';
  statusCode?: number | null; latencyMs?: number; success?: boolean; errorCategory?: string | null;
}
export interface IncidentDetail {
  incident: {
    id: string; type: IncidentType; status: IncidentStatus; observationType: ObservationType; triggerReason: string;
    triggerRule: { rule?: string; consecutiveRequired?: number; latencyThresholdMs?: number; recoveryRule?: string; recoveryRequired?: number };
    startedAt: string; openedAt: string; recoveryStartedAt: string | null; resolvedAt: string | null; resolutionReason: string | null;
    monitor: { id: string; name: string; url: string; method: string; latencyThresholdMs: number };
  };
  explanation: { headline: string; facts: string[]; hypotheses: string[]; investigationSteps: string[]; recovery: string | null; caveat: string };
  timeline: TimelineEntry[];
}

export interface MonitorInput {
  name: string; url: string; method: string; interval: number; timeout: number; latencyThresholdMs: number;
  failureThreshold: number; latencyBreachThreshold: number; recoveryThreshold: number;
  expectedStatus?: number | null; expectedKeyword?: string | null; headers?: Record<string, string>; isActive?: boolean;
}
export interface Meta {
  name: string; version: string; authMode: string; ai: { enabled: boolean; provider: string };
  email: { enabled: boolean }; scheduler: string; maxMonitorsPerUser: number;
}
