import { sqlDb } from '../config/sql';
import { bucketSeconds, deriveHealth, modeToType, round1, uptimePct, windowSeconds } from './metrics';
import type { WindowKey } from '../schemas/monitor';

/**
 * Dashboard numbers. Every figure is computed from persisted `checks` / `incidents` rows for the
 * requesting user, for ONE observation type (REAL or SIMULATED) - the two are never blended.
 *
 *   window          : last 1h / 24h / 7d / 30d, measured from "now"
 *   avg / p95 / max : successful checks only (failed checks have no meaningful latency)
 *   uptime estimate : successful checks / all checks in the window; an ESTIMATE from sampling
 *   monitor health  : unavailable = open AVAILABILITY incident, degraded = open LATENCY incident
 */
export async function getDashboardSummary(userId: string, mode: 'real' | 'simulated', window: WindowKey) {
  const type = modeToType(mode);
  const simulated = mode === 'simulated';
  const secs = windowSeconds(window);
  const bucket = bucketSeconds(window);
  const cutoff = `(now() AT TIME ZONE 'UTC') - make_interval(secs => $3::int)`;

  const [monitors, openIncidents, totals, series, slowest, recentChecks, recentIncidents] = await Promise.all([
    sqlDb.query(
      `SELECT m.id, m.is_active, m.is_paused,
              COALESCE((SELECT array_agg(i.type) FROM incidents i WHERE i.monitor_id = m.id AND i.status = 'OPEN'), '{}') AS open_types,
              EXISTS (SELECT 1 FROM checks c WHERE c.monitor_id = m.id AND c.observation_type = $2) AS has_checks
         FROM monitors m WHERE m.user_id = $1 AND m.is_simulated = $3::boolean LIMIT 1000`,
      [userId, type, simulated]),
    sqlDb.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM incidents i JOIN monitors m ON m.id = i.monitor_id
        WHERE m.user_id = $1 AND i.status = 'OPEN' AND i.observation_type = $2`, [userId, type]),
    sqlDb.query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE c.success)::int AS ok,
              count(*) FILTER (WHERE NOT c.success)::int AS failed,
              (avg(c.response_time) FILTER (WHERE c.success))::float8 AS avg_ms,
              (percentile_cont(0.95) WITHIN GROUP (ORDER BY c.response_time) FILTER (WHERE c.success))::float8 AS p95_ms
         FROM checks c JOIN monitors m ON m.id = c.monitor_id
        WHERE m.user_id = $1 AND c.observation_type = $2 AND c.checked_at >= ${cutoff}`, [userId, type, secs]),
    sqlDb.query(
      `SELECT (floor(extract(epoch FROM c.checked_at) / $4::int) * $4::int * 1000)::float8 AS t,
              (avg(c.response_time) FILTER (WHERE c.success))::float8 AS avg_ms,
              (percentile_cont(0.95) WITHIN GROUP (ORDER BY c.response_time) FILTER (WHERE c.success))::float8 AS p95_ms,
              count(*) FILTER (WHERE NOT c.success)::int AS failures, count(*)::int AS checks
         FROM checks c JOIN monitors m ON m.id = c.monitor_id
        WHERE m.user_id = $1 AND c.observation_type = $2 AND c.checked_at >= ${cutoff}
        GROUP BY 1 ORDER BY 1`, [userId, type, secs, bucket]),
    sqlDb.query(
      `SELECT m.id, m.name, m.url, (avg(c.response_time))::float8 AS avg_ms,
              (percentile_cont(0.95) WITHIN GROUP (ORDER BY c.response_time))::float8 AS p95_ms, count(*)::int AS samples
         FROM checks c JOIN monitors m ON m.id = c.monitor_id
        WHERE m.user_id = $1 AND c.observation_type = $2 AND c.success AND c.checked_at >= ${cutoff}
        GROUP BY m.id, m.name, m.url ORDER BY p95_ms DESC LIMIT 5`, [userId, type, secs]),
    sqlDb.query(
      `SELECT c.id, c.monitor_id, m.name AS monitor_name, c.status_code, c.response_time, c.success, c.error_category,
              c.observation_type, c.checked_at
         FROM checks c JOIN monitors m ON m.id = c.monitor_id
        WHERE m.user_id = $1 AND c.observation_type = $2
        ORDER BY c.checked_at DESC LIMIT 10`, [userId, type]),
    sqlDb.query(
      `SELECT i.id, i.type, i.status, i.trigger_reason, i.opened_at, i.resolved_at, i.observation_type, m.name AS monitor_name
         FROM incidents i JOIN monitors m ON m.id = i.monitor_id
        WHERE m.user_id = $1 AND i.observation_type = $2 ORDER BY i.opened_at DESC LIMIT 5`, [userId, type]),
  ]);

  const health = { healthy: 0, degraded: 0, unavailable: 0, unknown: 0, paused: 0 };
  for (const m of monitors) {
    health[deriveHealth({ isActive: m.is_active, isPaused: m.is_paused, hasChecks: m.has_checks, openTypes: m.open_types })]++;
  }
  const t = totals[0];
  return {
    mode, window,
    methodology: {
      window: `Last ${window}, measured from the time of the request.`,
      latency: 'Average and p95 use successful checks only.',
      uptime: 'Observation-based estimate: successful checks / total checks. It cannot see outages between checks.',
      health: 'unavailable = open availability incident; degraded = open latency incident.',
    },
    cards: {
      totalMonitors: monitors.length,
      activeMonitors: monitors.filter((m) => m.is_active && !m.is_paused).length,
      healthy: health.healthy, degraded: health.degraded, unavailable: health.unavailable,
      unknown: health.unknown, paused: health.paused,
      openIncidents: openIncidents[0].n,
      totalChecks: t.total, failedChecks: t.failed,
      avgLatencyMs: round1(t.avg_ms), p95LatencyMs: round1(t.p95_ms),
      uptimePercent: uptimePct(t.ok, t.total),
    },
    latencySeries: series.map((r) => ({ t: r.t, avgMs: round1(r.avg_ms), p95Ms: round1(r.p95_ms), failures: r.failures, checks: r.checks })),
    bucketSeconds: bucket,
    slowestEndpoints: slowest.map((r) => ({ id: r.id, name: r.name, url: r.url, avgMs: round1(r.avg_ms), p95Ms: round1(r.p95_ms), samples: r.samples })),
    recentChecks: recentChecks.map((c) => ({
      id: c.id, monitorId: c.monitor_id, monitorName: c.monitor_name, statusCode: c.status_code, latencyMs: c.response_time,
      success: c.success, errorCategory: c.error_category, observationType: c.observation_type, checkedAt: c.checked_at,
    })),
    recentIncidents: recentIncidents.map((i) => ({
      id: i.id, type: i.type, status: i.status, reason: i.trigger_reason, monitorName: i.monitor_name,
      openedAt: i.opened_at, resolvedAt: i.resolved_at, observationType: i.observation_type,
    })),
  };
}
