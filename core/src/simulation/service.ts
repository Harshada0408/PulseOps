import type { SqlDb } from '../db/sql';
import { recordObservation, type RecordOutcome, type IncidentTransition } from '../incidents/engine';
import { SCENARIOS, SIMULATION_MONITOR, type ScenarioId } from './scenarios';

export class SimulationClockError extends Error {
  constructor() {
    super('Simulated clock would run too far into the future. Reset the demo, then run the scenario again.');
    this.name = 'SimulationClockError';
  }
}
export class NotSimulatedMonitorError extends Error {
  constructor() {
    super('This operation is only allowed on a simulated monitor.');
    this.name = 'NotSimulatedMonitorError';
  }
}

/** The one simulated monitor per user (created on first use). */
export async function ensureSimulationMonitor(db: SqlDb, userId: string): Promise<{ id: string; created: boolean }> {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM monitors WHERE user_id = $1 AND is_simulated = true ORDER BY created_at LIMIT 1`,
    [userId]
  );
  if (existing[0]) return { id: existing[0].id, created: false };
  const s = SIMULATION_MONITOR;
  const created = await db.query<{ id: string }>(
    `INSERT INTO monitors (id, name, url, method, interval, timeout, is_active, is_paused, is_simulated,
                           latency_threshold_ms, failure_threshold, latency_breach_threshold, recovery_threshold,
                           user_id, updated_at)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4::int, $5::int, true, false, true,
             $6::int, $7::int, $8::int, $9::int, $10, (now() AT TIME ZONE 'UTC'))
     RETURNING id`,
    [s.name, s.url, s.method, s.interval, s.timeout, s.latencyThresholdMs, s.failureThreshold,
     s.latencyBreachThreshold, s.recoveryThreshold, userId]
  );
  return { id: created[0].id, created: true };
}

async function assertSimulated(db: SqlDb, monitorId: string): Promise<Date | null> {
  const rows = await db.query<{ is_simulated: boolean; last_checked_at: Date | null }>(
    `SELECT is_simulated, last_checked_at FROM monitors WHERE id = $1`,
    [monitorId]
  );
  if (!rows[0]) throw new Error('Monitor not found');
  if (!rows[0].is_simulated) throw new NotSimulatedMonitorError();
  return rows[0].last_checked_at;
}

export interface ScenarioResult {
  scenario: ScenarioId;
  checksRecorded: number;
  opened: IncidentTransition[];
  resolved: IncidentTransition[];
}

/**
 * Feed a scenario through the real incident engine on a virtual clock.
 * Checks are spaced `interval` apart and end at "now"; if earlier simulated data already
 * occupies that time range the scenario continues right after it, so time never goes backwards.
 */
export async function runScenario(
  db: SqlDb,
  monitorId: string,
  scenario: ScenarioId,
  options: { now?: Date } = {}
): Promise<ScenarioResult> {
  const last = await assertSimulated(db, monitorId);
  const steps = SCENARIOS[scenario].steps;
  const spacing = SIMULATION_MONITOR.interval * 1000;
  const now = options.now ?? new Date();

  let start = now.getTime() - (steps.length - 1) * spacing;
  if (last && start <= last.getTime()) start = last.getTime() + spacing;
  const end = start + (steps.length - 1) * spacing;
  if (end > now.getTime() + 60 * 60 * 1000) throw new SimulationClockError();

  const opened: IncidentTransition[] = [];
  const resolved: IncidentTransition[] = [];
  for (let i = 0; i < steps.length; i++) {
    const observedAt = new Date(start + i * spacing);
    // State changes are stamped one second after the check that caused them, so the timeline
    // visibly separates "when it was measured" from "when PulseOps changed state".
    const outcome: RecordOutcome = await recordObservation(
      db,
      monitorId,
      { ...steps[i], observedAt },
      { now: new Date(observedAt.getTime() + 1000) }
    );
    opened.push(...outcome.opened);
    resolved.push(...outcome.resolved);
  }
  return { scenario, checksRecorded: steps.length, opened, resolved };
}

/** Delete all simulated history for the monitor and zero its counters. Real monitors are never touched. */
export async function resetSimulation(db: SqlDb, monitorId: string): Promise<void> {
  await assertSimulated(db, monitorId);
  await db.transaction(async (tx) => {
    await tx.query(`SELECT 1 FROM monitors WHERE id = $1 FOR UPDATE`, [monitorId]);
    // Incidents first: their evidence rows reference checks with ON DELETE NO ACTION.
    await tx.query(`DELETE FROM incidents WHERE monitor_id = $1`, [monitorId]);
    await tx.query(`DELETE FROM checks WHERE monitor_id = $1 AND observation_type = 'SIMULATED'`, [monitorId]);
    await tx.query(
      `UPDATE monitors SET consecutive_failures = 0, consecutive_slow = 0, consecutive_success = 0,
                           consecutive_fast = 0, last_checked_at = NULL WHERE id = $1`,
      [monitorId]
    );
  });
}
