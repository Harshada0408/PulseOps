import { api } from './api-client';
import type {
  DashboardSummary, IncidentDetail, IncidentRow, Meta, Mode, Monitor, MonitorDetail, MonitorInput, CheckResult,
} from './types';

const get = async <T,>(url: string, params?: Record<string, unknown>) => (await api.get<T>(url, { params })).data;

export const Api = {
  meta: () => get<Meta>('/meta'),
  summary: (mode: Mode, window: string) => get<DashboardSummary>('/dashboard/summary', { mode, window }),
  monitors: (p: { mode: Mode; page?: number; limit?: number; search?: string }) =>
    get<{ monitors: Monitor[]; page: number; limit: number; total: number }>('/monitors', p),
  monitor: (id: string, window: string) => get<MonitorDetail>(`/monitors/${id}`, { window }),
  results: (id: string, page: number, limit = 20) =>
    get<{ results: CheckResult[]; page: number; limit: number; total: number }>(`/monitors/${id}/results`, { page, limit }),
  createMonitor: async (input: MonitorInput) => (await api.post<Monitor>('/monitors', input)).data,
  updateMonitor: async (id: string, input: Partial<MonitorInput>) => (await api.patch<Monitor>(`/monitors/${id}`, input)).data,
  deleteMonitor: async (id: string) => { await api.delete(`/monitors/${id}`); },
  pause: async (id: string) => (await api.post<Monitor>(`/monitors/${id}/pause`)).data,
  resume: async (id: string) => (await api.post<Monitor>(`/monitors/${id}/resume`)).data,
  check: async (id: string) =>
    (await api.post<{ result: CheckResult; incidentsOpened: { id: string; type: string }[]; incidentsResolved: { id: string; type: string }[] }>(`/monitors/${id}/check`)).data,
  incidents: (p: { mode: Mode; status?: string; type?: string; page?: number; limit?: number }) =>
    get<{ incidents: IncidentRow[]; page: number; limit: number; total: number }>('/incidents', p),
  incident: (id: string) => get<IncidentDetail>(`/incidents/${id}`),
  aiSummary: async (id: string) =>
    (await api.post<{ label: string; provider: string; text: string }>(`/incidents/${id}/ai-summary`)).data,
  simScenarios: () => get<{ monitorId: string; scenarios: { id: string; title: string; description: string; checks: number }[] }>('/simulation/scenarios'),
  simRun: async (scenario: string) =>
    (await api.post<{ checksRecorded: number; incidentsOpened: { id: string; type: string }[]; incidentsResolved: { id: string; type: string }[] }>('/simulation/run', { scenario })).data,
  simReset: async () => (await api.post('/simulation/reset')).data,
};
