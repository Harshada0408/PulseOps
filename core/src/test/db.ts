import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pgSqlDb } from '../db/pg';
import type { SqlDb } from '../db/sql';
import type { Observation } from '../incidents/engine';

/**
 * Integration-test helpers. Tests run against a REAL PostgreSQL database (the schema comes
 * from the Prisma migrations). Set TEST_DATABASE_URL (or DATABASE_URL).
 * Every test creates its own user and monitors with random ids and removes them afterwards,
 * so tests never collide with each other or with real data.
 */
const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  throw new Error('Set TEST_DATABASE_URL (or DATABASE_URL) to a migrated PostgreSQL database to run the integration tests.');
}

export const pool = new Pool({ connectionString: url, max: 12 });
export const db: SqlDb = pgSqlDb(pool);

export async function createUser(): Promise<string> {
  const id = randomUUID();
  await pool.query(`INSERT INTO users (id, email, updated_at) VALUES ($1, $2, now())`, [id, `${id}@test.local`]);
  return id;
}

export interface MonitorOptions {
  failureThreshold?: number;
  latencyThresholdMs?: number;
  latencyBreachThreshold?: number;
  recoveryThreshold?: number;
  isSimulated?: boolean;
}

export async function createMonitor(userId: string, o: MonitorOptions = {}): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO monitors (id, name, url, user_id, updated_at, failure_threshold, latency_threshold_ms,
                           latency_breach_threshold, recovery_threshold, is_simulated)
     VALUES ($1, 'test monitor', 'https://example.com/health', $2, now(), $3, $4, $5, $6, $7)`,
    [id, userId, o.failureThreshold ?? 3, o.latencyThresholdMs ?? 1000, o.latencyBreachThreshold ?? 3,
     o.recoveryThreshold ?? 2, o.isSimulated ?? false]
  );
  return id;
}

export async function deleteUser(userId: string): Promise<void> {
  // Cascades to monitors -> checks / incidents -> evidence / events.
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
}

const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);
/** n-th observation of a test run: 30 s apart, strictly increasing. */
export const at = (n: number) => new Date(T0 + n * 30_000);

export const OK = (n: number, latencyMs = 120): Observation => ({
  observedAt: at(n), success: true, status: 'up', statusCode: 200, latencyMs, errorCategory: null, error: null,
});
export const SLOW = (n: number, latencyMs = 2500): Observation => OK(n, latencyMs);
export const FAIL = (n: number): Observation => ({
  observedAt: at(n), success: false, status: 'down', statusCode: 503, latencyMs: 200,
  errorCategory: 'HTTP_ERROR', error: 'Expected 2xx status, got 503',
});
export const TIMEOUT = (n: number): Observation => ({
  observedAt: at(n), success: false, status: 'down', statusCode: null, latencyMs: 5000,
  errorCategory: 'TIMEOUT', error: 'Request timed out after 5000ms',
});

export async function incidentsFor(monitorId: string) {
  const r = await pool.query(
    `SELECT id, type, status, started_at, opened_at, recovery_started_at, resolved_at, trigger_reason, observation_type
       FROM incidents WHERE monitor_id = $1 ORDER BY opened_at`,
    [monitorId]
  );
  return r.rows;
}
