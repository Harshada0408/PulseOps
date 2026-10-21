import { buildExplanation, buildTimeline, type EvidenceCheck } from '@pulseops/core';
import { sqlDb } from '../config/sql';
import { AppError } from '../middleware/error';
import { modeToType } from './metrics';

export async function listIncidents(userId: string, filters: {
  mode?: 'real' | 'simulated'; status?: 'OPEN' | 'RESOLVED'; type?: 'AVAILABILITY' | 'LATENCY'; monitorId?: string; page?: number; limit?: number;
}) {
  const f = { ...filters, mode: filters.mode ?? 'real', page: filters.page ?? 1, limit: filters.limit ?? 20 };
  const where = `m.user_id = $1 AND i.observation_type = $2 AND ($3::text IS NULL OR i.status = $3)
                 AND ($4::text IS NULL OR i.type = $4) AND ($5::text IS NULL OR i.monitor_id = $5)`;
  const base = [userId, modeToType(f.mode), f.status ?? null, f.type ?? null, f.monitorId ?? null];
  const [rows, total] = await Promise.all([
    sqlDb.query(
      `SELECT i.id, i.type, i.status, i.trigger_reason, i.started_at, i.opened_at, i.resolved_at, i.observation_type,
              m.id AS monitor_id, m.name AS monitor_name, m.url AS monitor_url
         FROM incidents i JOIN monitors m ON m.id = i.monitor_id
        WHERE ${where} ORDER BY i.opened_at DESC, i.id LIMIT $6::int OFFSET $7::int`,
      [...base, f.limit, (f.page - 1) * f.limit]),
    sqlDb.query<{ n: number }>(`SELECT count(*)::int AS n FROM incidents i JOIN monitors m ON m.id = i.monitor_id WHERE ${where}`, base),
  ]);
  return {
    incidents: rows.map((i) => ({
      id: i.id, type: i.type, status: i.status, reason: i.trigger_reason, startedAt: i.started_at, openedAt: i.opened_at,
      resolvedAt: i.resolved_at, observationType: i.observation_type,
      monitor: { id: i.monitor_id, name: i.monitor_name, url: i.monitor_url },
    })),
    page: f.page, limit: f.limit, total: total[0].n,
  };
}

export async function loadIncidentEvidence(incidentId: string): Promise<EvidenceCheck[]> {
  const rows = await sqlDb.query(
    `SELECT e.role, c.id, c.checked_at, c.status_code, c.response_time, c.success, c.error_category, c.error, c.observation_type
       FROM incident_evidence e JOIN checks c ON c.id = e.check_id
      WHERE e.incident_id = $1::uuid ORDER BY c.checked_at, c.id`, [incidentId]);
  return rows.map((r) => ({
    id: r.id, role: r.role, checkedAt: r.checked_at, statusCode: r.status_code, latencyMs: r.response_time,
    success: r.success, errorCategory: r.error_category, error: r.error, observationType: r.observation_type,
  }));
}

export async function getIncident(userId: string, incidentId: string) {
  const rows = await sqlDb.query(
    `SELECT i.*, m.id AS m_id, m.name AS m_name, m.url AS m_url, m.method AS m_method, m.latency_threshold_ms
       FROM incidents i JOIN monitors m ON m.id = i.monitor_id
      WHERE i.id = $1::uuid AND m.user_id = $2`, [incidentId, userId]);
  const i = rows[0];
  if (!i) throw new AppError('Incident not found', 404);

  const [evidence, events] = await Promise.all([
    loadIncidentEvidence(incidentId),
    sqlDb.query(`SELECT id, type, occurred_at, message FROM incident_events WHERE incident_id = $1::uuid ORDER BY occurred_at`, [incidentId]),
  ]);

  const explanation = buildExplanation({
    type: i.type, status: i.status, observationType: i.observation_type, triggerReason: i.trigger_reason,
    triggerRule: i.trigger_rule ?? {}, startedAt: i.started_at, openedAt: i.opened_at,
    recoveryStartedAt: i.recovery_started_at, resolvedAt: i.resolved_at, evidence,
  });
  const timeline = buildTimeline(evidence, events.map((e) => ({ id: e.id, type: e.type, occurredAt: e.occurred_at, message: e.message })));

  return {
    incident: {
      id: i.id, type: i.type, status: i.status, observationType: i.observation_type,
      triggerReason: i.trigger_reason, triggerRule: i.trigger_rule,
      // started_at = first bad check observed; opened_at = when PulseOps changed state (different things on purpose)
      startedAt: i.started_at, openedAt: i.opened_at, recoveryStartedAt: i.recovery_started_at,
      resolvedAt: i.resolved_at, resolutionReason: i.resolution_reason,
      monitor: { id: i.m_id, name: i.m_name, url: i.m_url, method: i.m_method, latencyThresholdMs: i.latency_threshold_ms },
    },
    explanation,
    timeline,
  };
}
