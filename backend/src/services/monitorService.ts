import { validateMonitorTarget, isRejectedTarget, type Row } from '@pulseops/core';
import { sqlDb } from '../config/sql';
import { AppError } from '../middleware/error';
import { env } from '../config/env';
import { PLAN_LIMITS } from '../types';
import { deriveHealth, uptimePct, round1, bucketSeconds, windowSeconds, modeToType } from './metrics';
import type { WindowKey } from '../schemas/monitor';
import { createMonitorSchema, updateMonitorSchema } from '../schemas/monitor';
import type { z } from 'zod';

type CreateInput = z.infer<typeof createMonitorSchema>;
type UpdateInput = z.infer<typeof updateMonitorSchema>;

const MONITOR_COLUMNS = `m.id, m.name, m.url, m.method, m.headers, m.body, m.interval, m.timeout, m.expected_status,
  m.expected_keyword, m.is_active, m.is_paused, m.is_simulated, m.region, m.created_at, m.updated_at, m.last_checked_at,
  m.latency_threshold_ms, m.failure_threshold, m.latency_breach_threshold, m.recovery_threshold,
  m.consecutive_failures, m.consecutive_slow`;

/** Header NAMES are shown; values never leave the server (they commonly hold tokens). */
const redactHeaders = (h: unknown): Record<string, string> =>
  Object.fromEntries(Object.keys(h && typeof h === 'object' ? (h as object) : {}).map((k) => [k, '••••••']));

export function toMonitorDto(r: Row) {
  const openTypes: string[] = r.open_types ?? [];
  return {
    id: r.id as string,
    name: r.name as string,
    url: r.url as string,
    method: r.method as string,
    headers: redactHeaders(r.headers),
    hasBody: !!r.body,
    interval: r.interval as number,
    timeout: r.timeout as number,
    expectedStatus: (r.expected_status ?? null) as number | null,
    expectedKeyword: (r.expected_keyword ?? null) as string | null,
    isActive: r.is_active as boolean,
    isPaused: r.is_paused as boolean,
    isSimulated: r.is_simulated as boolean,
    region: r.region as string,
    latencyThresholdMs: r.latency_threshold_ms as number,
    failureThreshold: r.failure_threshold as number,
    latencyBreachThreshold: r.latency_breach_threshold as number,
    recoveryThreshold: r.recovery_threshold as number,
    consecutiveFailures: r.consecutive_failures as number,
    consecutiveSlow: r.consecutive_slow as number,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
    lastCheckedAt: (r.last_checked_at ?? null) as Date | null,
    openIncidentTypes: openTypes,
    health: deriveHealth({
      isActive: r.is_active, isPaused: r.is_paused, hasChecks: r.last_check_at != null, openTypes,
    }),
    lastCheck: r.last_check_at
      ? { checkedAt: r.last_check_at as Date, statusCode: (r.last_status_code ?? null) as number | null,
          latencyMs: r.last_response_time as number, success: r.last_success as boolean }
      : null,
  };
}

const LIST_SELECT = `
  SELECT ${MONITOR_COLUMNS},
         COALESCE((SELECT array_agg(i.type) FROM incidents i WHERE i.monitor_id = m.id AND i.status = 'OPEN'), '{}') AS open_types,
         lc.checked_at AS last_check_at, lc.status_code AS last_status_code, lc.response_time AS last_response_time, lc.success AS last_success
    FROM monitors m
    LEFT JOIN LATERAL (
      SELECT checked_at, status_code, response_time, success FROM checks c
       WHERE c.monitor_id = m.id ORDER BY c.checked_at DESC LIMIT 1) lc ON true`;

export async function listMonitors(userId: string, opts: { mode?: 'real' | 'simulated'; page?: number; limit?: number; search?: string }) {
  const simulated = (opts.mode ?? 'real') === 'simulated';
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;
  const search = opts.search?.trim() ? `%${opts.search.trim().replace(/[%_\\]/g, '\\$&')}%` : null;
  const where = `m.user_id = $1 AND m.is_simulated = $2::boolean AND ($3::text IS NULL OR m.name ILIKE $3 OR m.url ILIKE $3)`;
  const [rows, total] = await Promise.all([
    sqlDb.query(`${LIST_SELECT} WHERE ${where} ORDER BY m.created_at DESC LIMIT $4::int OFFSET $5::int`,
      [userId, simulated, search, limit, (page - 1) * limit]),
    sqlDb.query<{ n: number }>(`SELECT count(*)::int AS n FROM monitors m WHERE ${where}`, [userId, simulated, search]),
  ]);
  return { monitors: rows.map(toMonitorDto), page, limit, total: total[0].n };
}

export async function getMonitorRow(userId: string, id: string): Promise<Row> {
  const rows = await sqlDb.query(`${LIST_SELECT} WHERE m.id = $1 AND m.user_id = $2`, [id, userId]);
  if (!rows[0]) throw new AppError('Monitor not found', 404);
  return rows[0];
}

export async function getMonitorDetail(userId: string, id: string, window: WindowKey) {
  const row = await getMonitorRow(userId, id);
  const type = row.is_simulated ? 'SIMULATED' : 'REAL';
  const secs = windowSeconds(window);
  const bucket = bucketSeconds(window);
  const cutoff = `(now() AT TIME ZONE 'UTC') - make_interval(secs => $3::int)`;
  const [stats, series, recentIncidents] = await Promise.all([
    sqlDb.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE success)::int AS ok,
              count(*) FILTER (WHERE NOT success)::int AS failed,
              (avg(response_time) FILTER (WHERE success))::float8 AS avg_ms,
              (percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time) FILTER (WHERE success))::float8 AS p95_ms,
              (max(response_time) FILTER (WHERE success))::int AS max_ms
         FROM checks WHERE monitor_id = $1 AND observation_type = $2 AND checked_at >= ${cutoff}`,
      [id, type, secs]),
    sqlDb.query(
      `SELECT (floor(extract(epoch FROM checked_at) / $4::int) * $4::int * 1000)::float8 AS t,
              (avg(response_time) FILTER (WHERE success))::float8 AS avg_ms,
              (max(response_time) FILTER (WHERE success))::int AS max_ms,
              count(*) FILTER (WHERE NOT success)::int AS failures,
              count(*)::int AS checks
         FROM checks WHERE monitor_id = $1 AND observation_type = $2 AND checked_at >= ${cutoff}
        GROUP BY 1 ORDER BY 1`,
      [id, type, secs, bucket]),
    sqlDb.query(
      `SELECT id, type, status, trigger_reason, started_at, opened_at, resolved_at, observation_type
         FROM incidents WHERE monitor_id = $1 ORDER BY opened_at DESC LIMIT 10`, [id]),
  ]);
  const s = stats[0];
  return {
    monitor: toMonitorDto(row),
    window,
    stats: {
      totalChecks: s.total, successfulChecks: s.ok, failedChecks: s.failed,
      avgLatencyMs: round1(s.avg_ms), p95LatencyMs: round1(s.p95_ms), maxLatencyMs: s.max_ms,
      uptimePercent: uptimePct(s.ok, s.total),
      uptimeNote: 'Estimate from recorded checks in this window (successful / total). It says nothing about the time between checks.',
      latencyNote: 'Average, p95 and max use successful checks only; failed checks have no meaningful latency.',
    },
    latencySeries: series.map((r) => ({ t: r.t, avgMs: round1(r.avg_ms), maxMs: r.max_ms, failures: r.failures, checks: r.checks })),
    recentIncidents: recentIncidents.map((i) => ({
      id: i.id, type: i.type, status: i.status, reason: i.trigger_reason, startedAt: i.started_at,
      openedAt: i.opened_at, resolvedAt: i.resolved_at, observationType: i.observation_type,
    })),
    bucketSeconds: bucket,
  };
}

async function assertUnderLimit(userId: string) {
  const [{ n }] = await sqlDb.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM monitors WHERE user_id = $1 AND NOT is_simulated`, [userId]);
  let max = env.MAX_MONITORS_PER_USER;
  if (env.ENABLE_BILLING) {
    const sub = await sqlDb.query<{ plan: string }>(`SELECT plan FROM subscriptions WHERE user_id = $1`, [userId]);
    max = (PLAN_LIMITS[sub[0]?.plan ?? 'free'] ?? PLAN_LIMITS.free).maxMonitors;
  }
  if (n >= max) throw new AppError(`Monitor limit reached (${max}).`, 403);
}

/** Immediate SSRF feedback. Unresolvable names are allowed (the service may simply be down); the executor re-checks on every request. */
const BLOCKED_HOSTNAMES = ['localhost', 'metadata', 'metadata.google.internal'];
const BLOCKED_SUFFIXES = ['.localhost', '.internal', '.local', '.localdomain'];

async function assertTargetAllowed(url: string) {
  // Defence in depth: names that are internal by convention are refused even if DNS is unavailable here.
  const host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTNAMES.includes(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new AppError('Monitor target resolves to a restricted network destination.', 400);
  }
  const v = await validateMonitorTarget(url);
  if (isRejectedTarget(v) && v.code !== 'unresolvable-hostname' && v.code !== 'no-addresses') {
    throw new AppError(v.publicMessage, 400);
  }
}

export async function createMonitor(userId: string, input: CreateInput) {
  await assertTargetAllowed(input.url);
  await assertUnderLimit(userId);
  const rows = await sqlDb.query<{ id: string }>(
    `INSERT INTO monitors (id, name, url, method, headers, body, interval, timeout, expected_status, expected_keyword,
                           is_active, is_paused, region, latency_threshold_ms, failure_threshold,
                           latency_breach_threshold, recovery_threshold, user_id, updated_at)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4::jsonb, $5, $6::int, $7::int, $8::int, $9, $10::boolean, NOT $10::boolean,
             $11, $12::int, $13::int, $14::int, $15::int, $16, (now() AT TIME ZONE 'UTC'))
     RETURNING id`,
    [input.name, input.url, input.method, JSON.stringify(input.headers ?? {}), input.body ?? null, input.interval,
     input.timeout, input.expectedStatus ?? null, input.expectedKeyword ?? null, input.isActive, input.region,
     input.latencyThresholdMs, input.failureThreshold, input.latencyBreachThreshold, input.recoveryThreshold, userId]
  );
  return toMonitorDto(await getMonitorRow(userId, rows[0].id));
}

const UPDATABLE: Record<string, { column: string; cast?: string; json?: boolean }> = {
  name: { column: 'name' }, url: { column: 'url' }, method: { column: 'method' },
  headers: { column: 'headers', cast: '::jsonb', json: true }, body: { column: 'body' },
  interval: { column: 'interval', cast: '::int' }, timeout: { column: 'timeout', cast: '::int' },
  expectedStatus: { column: 'expected_status', cast: '::int' }, expectedKeyword: { column: 'expected_keyword' },
  region: { column: 'region' }, latencyThresholdMs: { column: 'latency_threshold_ms', cast: '::int' },
  failureThreshold: { column: 'failure_threshold', cast: '::int' },
  latencyBreachThreshold: { column: 'latency_breach_threshold', cast: '::int' },
  recoveryThreshold: { column: 'recovery_threshold', cast: '::int' },
};

export async function updateMonitor(userId: string, id: string, patch: UpdateInput) {
  const existing = await getMonitorRow(userId, id);
  if (existing.is_simulated) throw new AppError('The simulated monitor cannot be edited.', 409);
  if (patch.url) await assertTargetAllowed(patch.url);

  // Cross-field rule against the stored values when only one side is patched.
  const timeout = patch.timeout ?? existing.timeout;
  const latency = patch.latencyThresholdMs ?? existing.latency_threshold_ms;
  if (latency >= timeout * 1000) throw new AppError('Latency threshold must be lower than the timeout', 400);

  const sets: string[] = [];
  const params: unknown[] = [id, userId];
  for (const [key, spec] of Object.entries(UPDATABLE)) {
    if (!(key in patch)) continue;
    const value = (patch as Record<string, unknown>)[key];
    params.push(spec.json ? JSON.stringify(value ?? {}) : value ?? null);
    sets.push(`${spec.column} = $${params.length}${spec.cast ?? ''}`);
  }
  if ('isActive' in patch) {
    params.push(patch.isActive);
    sets.push(`is_active = $${params.length}::boolean`, `is_paused = NOT $${params.length}::boolean`);
  }
  sets.push(`updated_at = (now() AT TIME ZONE 'UTC')`);
  await sqlDb.query(`UPDATE monitors SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2`, params);
  return toMonitorDto(await getMonitorRow(userId, id));
}

export async function setPaused(userId: string, id: string, paused: boolean) {
  const rows = await sqlDb.query(
    `UPDATE monitors SET is_paused = $3::boolean, is_active = NOT $3::boolean, updated_at = (now() AT TIME ZONE 'UTC')
      WHERE id = $1 AND user_id = $2 AND NOT is_simulated RETURNING id`, [id, userId, paused]);
  if (!rows[0]) throw new AppError('Monitor not found', 404);
  return toMonitorDto(await getMonitorRow(userId, id));
}

export async function deleteMonitor(userId: string, id: string) {
  const rows = await sqlDb.query(`DELETE FROM monitors WHERE id = $1 AND user_id = $2 RETURNING id`, [id, userId]);
  if (!rows[0]) throw new AppError('Monitor not found', 404);
}

export async function listResults(userId: string, id: string, page: number, limit: number) {
  const row = await getMonitorRow(userId, id);
  const type = modeToType(row.is_simulated ? 'simulated' : 'real');
  const [items, total] = await Promise.all([
    sqlDb.query(
      `SELECT id, status_code, response_time, success, error_category, error, observation_type, checked_at
         FROM checks WHERE monitor_id = $1 AND observation_type = $2
        ORDER BY checked_at DESC, id DESC LIMIT $3::int OFFSET $4::int`,
      [id, type, limit, (page - 1) * limit]),
    sqlDb.query<{ n: number }>(`SELECT count(*)::int AS n FROM checks WHERE monitor_id = $1 AND observation_type = $2`, [id, type]),
  ]);
  return {
    results: items.map((c) => ({
      id: c.id, statusCode: c.status_code, latencyMs: c.response_time, success: c.success,
      errorCategory: c.error_category, error: c.error, observationType: c.observation_type, checkedAt: c.checked_at,
    })),
    page, limit, total: total[0].n,
  };
}
