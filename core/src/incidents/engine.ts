import type { SqlDb, SqlTx } from '../db/sql';
import type { ErrorCategory } from '../checks/classify';

export type IncidentType = 'AVAILABILITY' | 'LATENCY';
export type ObservationType = 'REAL' | 'SIMULATED';
export type EvidenceRole = 'LAST_HEALTHY' | 'TRIGGER' | 'CONTINUING' | 'RECOVERY';

/** One measurement, independent of how it was obtained (real HTTP call or simulation). */
export interface Observation {
  observedAt: Date;
  /** Response satisfied the monitor's validation rules (status + optional keyword). */
  success: boolean;
  /** Legacy tri-state kept for the existing UI: up | degraded | down. */
  status: 'up' | 'down' | 'degraded';
  statusCode: number | null;
  latencyMs: number;
  errorCategory: ErrorCategory | null;
  /** Already sanitised (see safeErrorDetail). */
  error: string | null;
}

export interface Counters {
  consecutiveFailures: number;
  consecutiveSlow: number;
  consecutiveSuccess: number;
  consecutiveFast: number;
}

export interface IncidentTransition {
  id: string;
  type: IncidentType;
  monitorId: string;
  reason: string;
  at: Date;
}

export interface RecordOutcome {
  checkId: string;
  observationType: ObservationType;
  monitor: { id: string; userId: string; name: string; url: string };
  counters: Counters;
  opened: IncidentTransition[];
  resolved: IncidentTransition[];
}

export class MonitorNotFoundError extends Error {
  constructor(id: string) {
    super(`Monitor ${id} not found`);
    this.name = 'MonitorNotFoundError';
  }
}

/** Upper bound on CONTINUING evidence rows per incident so a long outage cannot grow unbounded. */
export const MAX_CONTINUING_EVIDENCE = 50;

interface MonitorStateRow {
  id: string;
  user_id: string;
  name: string;
  url: string;
  region: string;
  latency_threshold_ms: number;
  failure_threshold: number;
  latency_breach_threshold: number;
  recovery_threshold: number;
  consecutive_failures: number;
  consecutive_slow: number;
  consecutive_success: number;
  consecutive_fast: number;
  is_simulated: boolean;
}

interface Rule {
  type: IncidentType;
  /** Does THIS observation satisfy the "bad" condition? */
  bad: boolean;
  /** Current length of the consecutive "bad" streak (after this observation). */
  badStreak: number;
  openAfter: number;
  /** Current length of the consecutive "good" streak for this type (after this observation). */
  goodStreak: number;
  resolveAfter: number;
  /** SQL predicate (on checks) selecting rows that count as "bad" / "good" for this type. The latency predicates use $4 for the latency threshold. */
  badSql: string;
  goodSql: string;
}

/**
 * THE incident state machine.
 *
 *   consecutive_failures  : failed checks in a row                      (reset by any success)
 *   consecutive_slow      : successful-but-slow checks in a row         (reset by any check that is not slow)
 *   consecutive_success   : successful checks in a row                  (reset by any failure)   -> availability recovery
 *   consecutive_fast      : successful AND fast checks in a row         (reset by failure or slow) -> latency recovery
 *
 *   AVAILABILITY  opens when consecutive_failures >= failure_threshold
 *                 resolves when consecutive_success >= recovery_threshold
 *   LATENCY       opens when consecutive_slow >= latency_breach_threshold
 *                 resolves when consecutive_fast >= recovery_threshold
 *
 * Everything happens in ONE transaction that first locks the monitor row (SELECT ... FOR UPDATE).
 * Concurrent observations for the same monitor therefore queue up and see each other's counter
 * updates, so counters cannot be lost and an incident cannot be opened twice. The partial unique
 * index uq_incidents_one_open_per_monitor_type is the database-level backstop for the same rule.
 *
 * Nothing in here is probabilistic and nothing calls an external service; AI (if enabled) only
 * ever reads the incidents this function produced.
 */
export async function recordObservation(
  db: SqlDb,
  monitorId: string,
  obs: Observation,
  options: { now?: Date } = {}
): Promise<RecordOutcome> {
  return db.transaction(async (tx) => {
    const rows = await tx.query<MonitorStateRow>(
      `SELECT id, user_id, name, url, region, latency_threshold_ms, failure_threshold,
              latency_breach_threshold, recovery_threshold, consecutive_failures, consecutive_slow,
              consecutive_success, consecutive_fast, is_simulated
         FROM monitors WHERE id = $1 FOR UPDATE`,
      [monitorId]
    );
    const m = rows[0];
    if (!m) throw new MonitorNotFoundError(monitorId);

    const observationType: ObservationType = m.is_simulated ? 'SIMULATED' : 'REAL';
    const latency = Math.max(0, Math.round(obs.latencyMs));
    const threshold = m.latency_threshold_ms;
    const slow = obs.success && latency > threshold;
    const fast = obs.success && latency <= threshold;
    const now = new Date(Math.max((options.now ?? new Date()).getTime(), obs.observedAt.getTime()));

    const counters: Counters = {
      consecutiveFailures: obs.success ? 0 : m.consecutive_failures + 1,
      consecutiveSlow: slow ? m.consecutive_slow + 1 : 0,
      consecutiveSuccess: obs.success ? m.consecutive_success + 1 : 0,
      consecutiveFast: fast ? m.consecutive_fast + 1 : 0,
    };

    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO checks (id, monitor_id, status, status_code, response_time, error, checked_at,
                           region, success, observation_type, error_category)
       VALUES (gen_random_uuid()::text, $1, $2, $3::int, $4::int, $5, $6::timestamp, $7, $8::boolean, $9, $10)
       RETURNING id`,
      [
        m.id,
        obs.status,
        obs.statusCode,
        latency,
        obs.error,
        obs.observedAt.toISOString(),
        m.region,
        obs.success,
        observationType,
        obs.errorCategory,
      ]
    );
    const checkId = inserted[0].id;

    await tx.query(
      `UPDATE monitors
          SET consecutive_failures = $2::int, consecutive_slow = $3::int,
              consecutive_success = $4::int, consecutive_fast = $5::int,
              last_checked_at = GREATEST(COALESCE(last_checked_at, $6::timestamp), $6::timestamp)
        WHERE id = $1`,
      [
        m.id,
        counters.consecutiveFailures,
        counters.consecutiveSlow,
        counters.consecutiveSuccess,
        counters.consecutiveFast,
        obs.observedAt.toISOString(),
      ]
    );

    const rules: Rule[] = [
      {
        type: 'AVAILABILITY',
        bad: !obs.success,
        badStreak: counters.consecutiveFailures,
        openAfter: m.failure_threshold,
        goodStreak: counters.consecutiveSuccess,
        resolveAfter: m.recovery_threshold,
        badSql: 'success = false',
        goodSql: 'success = true',
      },
      {
        type: 'LATENCY',
        bad: slow,
        badStreak: counters.consecutiveSlow,
        openAfter: m.latency_breach_threshold,
        goodStreak: counters.consecutiveFast,
        resolveAfter: m.recovery_threshold,
        badSql: 'success = true AND response_time > $4::int',
        goodSql: 'success = true AND response_time <= $4::int',
      },
    ];

    const openIncidents = await tx.query<{ id: string; type: IncidentType; opened_at: Date }>(
      `SELECT id, type, opened_at FROM incidents WHERE monitor_id = $1 AND status = 'OPEN'`,
      [m.id]
    );

    const outcome: RecordOutcome = {
      checkId,
      observationType,
      monitor: { id: m.id, userId: m.user_id, name: m.name, url: m.url },
      counters,
      opened: [],
      resolved: [],
    };

    for (const rule of rules) {
      const open = openIncidents.find((i) => i.type === rule.type);

      if (!open) {
        if (rule.bad && rule.badStreak >= rule.openAfter) {
          const opened = await openIncident(tx, m, rule, observationType, threshold, now, obs, checkId);
          if (opened) outcome.opened.push(opened);
        }
        continue;
      }

      if (rule.bad) {
        await addContinuingEvidence(tx, open.id, checkId);
      } else if (rule.goodStreak >= rule.resolveAfter) {
        const resolved = await resolveIncident(tx, m, rule, open, observationType, threshold, now);
        if (resolved) outcome.resolved.push(resolved);
      }
    }

    return outcome;
  });
}

/** The latency predicates reference the threshold as $4; availability predicates take no extra parameter. */
function withThreshold(rule: Rule, params: unknown[], threshold: number): unknown[] {
  return rule.type === 'LATENCY' ? [...params, threshold] : params;
}

async function openIncident(
  tx: SqlTx,
  m: MonitorStateRow,
  rule: Rule,
  observationType: ObservationType,
  threshold: number,
  now: Date,
  obs: Observation,
  currentCheckId: string
): Promise<IncidentTransition | null> {
  // The streak itself: the newest `openAfter` checks that satisfy the bad predicate.
  const triggers = await tx.query<{ id: string; checked_at: Date }>(
    `SELECT id, checked_at FROM checks
      WHERE monitor_id = $1 AND observation_type = $2 AND ${rule.badSql}
      ORDER BY checked_at DESC, id DESC LIMIT $3::int`,
    withThreshold(rule, [m.id, observationType, rule.openAfter], threshold)
  );
  const startedAt = triggers.length
    ? new Date(Math.min(...triggers.map((t) => t.checked_at.getTime())))
    : obs.observedAt;

  const lastHealthy = await tx.query<{ id: string }>(
    `SELECT id FROM checks
      WHERE monitor_id = $1 AND observation_type = $2 AND checked_at < $3::timestamp AND ${rule.goodSql}
      ORDER BY checked_at DESC, id DESC LIMIT 1`,
    withThreshold(rule, [m.id, observationType, startedAt.toISOString()], threshold)
  );

  const reason =
    rule.type === 'AVAILABILITY'
      ? `${rule.badStreak} consecutive failed checks (configured threshold: ${m.failure_threshold}).`
      : `${rule.badStreak} consecutive successful responses slower than ${m.latency_threshold_ms} ms ` +
        `(configured threshold: ${m.latency_breach_threshold} consecutive).`;

  const triggerRule =
    rule.type === 'AVAILABILITY'
      ? {
          rule: 'CONSECUTIVE_FAILURES',
          consecutiveRequired: m.failure_threshold,
          recoveryRule: 'CONSECUTIVE_SUCCESSES',
          recoveryRequired: m.recovery_threshold,
        }
      : {
          rule: 'CONSECUTIVE_SLOW_RESPONSES',
          consecutiveRequired: m.latency_breach_threshold,
          latencyThresholdMs: m.latency_threshold_ms,
          recoveryRule: 'CONSECUTIVE_FAST_RESPONSES',
          recoveryRequired: m.recovery_threshold,
        };

  const created = await tx.query<{ id: string }>(
    `INSERT INTO incidents (id, monitor_id, type, status, observation_type, trigger_reason, trigger_rule,
                            started_at, opened_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, 'OPEN', $3, $4, $5::jsonb, $6::timestamp, $7::timestamp, $7::timestamp)
     ON CONFLICT (monitor_id, type) WHERE status = 'OPEN' DO NOTHING
     RETURNING id`,
    [m.id, rule.type, observationType, reason, JSON.stringify(triggerRule), startedAt.toISOString(), now.toISOString()]
  );
  if (created.length === 0) return null; // someone else already holds the open incident: never duplicate

  const incidentId = created[0].id;
  if (lastHealthy[0]) await addEvidence(tx, incidentId, lastHealthy[0].id, 'LAST_HEALTHY');
  const triggerIds = triggers.length ? triggers.map((t) => t.id) : [currentCheckId];
  for (const id of triggerIds) await addEvidence(tx, incidentId, id, 'TRIGGER');

  await tx.query(
    `INSERT INTO incident_events (id, incident_id, type, occurred_at, check_id, message)
     VALUES (gen_random_uuid(), $1::uuid, 'OPENED', $2::timestamp, $3, $4)`,
    [incidentId, now.toISOString(), currentCheckId, `Incident opened: ${reason}`]
  );

  return { id: incidentId, type: rule.type, monitorId: m.id, reason, at: now };
}

async function resolveIncident(
  tx: SqlTx,
  m: MonitorStateRow,
  rule: Rule,
  open: { id: string; opened_at: Date },
  observationType: ObservationType,
  threshold: number,
  now: Date
): Promise<IncidentTransition | null> {
  const recovery = await tx.query<{ id: string; checked_at: Date }>(
    `SELECT id, checked_at FROM checks
      WHERE monitor_id = $1 AND observation_type = $2 AND ${rule.goodSql}
      ORDER BY checked_at DESC, id DESC LIMIT $3::int`,
    withThreshold(rule, [m.id, observationType, rule.resolveAfter], threshold)
  );
  const recoveryStartedAt = recovery.length
    ? new Date(Math.min(...recovery.map((r) => r.checked_at.getTime())))
    : now;
  const resolvedAt = new Date(Math.max(now.getTime(), open.opened_at.getTime()));

  const reason =
    rule.type === 'AVAILABILITY'
      ? `${rule.goodStreak} consecutive successful checks (required: ${m.recovery_threshold}).`
      : `${rule.goodStreak} consecutive successful responses within ${m.latency_threshold_ms} ms (required: ${m.recovery_threshold}).`;

  const updated = await tx.query<{ id: string }>(
    `UPDATE incidents
        SET status = 'RESOLVED', resolved_at = $2::timestamp, recovery_started_at = $3::timestamp,
            resolution_reason = $4, updated_at = $2::timestamp
      WHERE id = $1::uuid AND status = 'OPEN'
      RETURNING id`,
    [open.id, resolvedAt.toISOString(), recoveryStartedAt.toISOString(), reason]
  );
  if (updated.length === 0) return null;

  for (const r of recovery) await addEvidence(tx, open.id, r.id, 'RECOVERY');
  await tx.query(
    `INSERT INTO incident_events (id, incident_id, type, occurred_at, check_id, message)
     VALUES (gen_random_uuid(), $1::uuid, 'RESOLVED', $2::timestamp, $3, $4)`,
    [open.id, resolvedAt.toISOString(), recovery[0]?.id ?? null, `Incident resolved: ${reason}`]
  );
  return { id: open.id, type: rule.type, monitorId: m.id, reason, at: resolvedAt };
}

async function addEvidence(tx: SqlTx, incidentId: string, checkId: string, role: EvidenceRole): Promise<void> {
  await tx.query(
    `INSERT INTO incident_evidence (id, incident_id, check_id, role)
     VALUES (gen_random_uuid(), $1::uuid, $2, $3)
     ON CONFLICT (incident_id, check_id, role) DO NOTHING`,
    [incidentId, checkId, role]
  );
}

async function addContinuingEvidence(tx: SqlTx, incidentId: string, checkId: string): Promise<void> {
  await tx.query(
    `INSERT INTO incident_evidence (id, incident_id, check_id, role)
     SELECT gen_random_uuid(), $1::uuid, $2, 'CONTINUING'
      WHERE (SELECT count(*) FROM incident_evidence WHERE incident_id = $1::uuid AND role = 'CONTINUING') < $3::int
     ON CONFLICT (incident_id, check_id, role) DO NOTHING`,
    [incidentId, checkId, MAX_CONTINUING_EVIDENCE]
  );
}
