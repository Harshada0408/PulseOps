import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { pgSqlDb, recordObservation, type RunnableMonitor, type SqlDb } from '@pulseops/core';
import { Scheduler, type CheckRunner } from './scheduler';

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL, max: 10 });
const db: SqlDb = pgSqlDb(pool);
let userId: string;

beforeAll(async () => {
  userId = randomUUID();
  await pool.query(`INSERT INTO users (id, email, updated_at) VALUES ($1, $2, now())`, [userId, `${userId}@t.local`]);
});
afterAll(async () => {
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await pool.end();
});
// every test starts from a clean slate for this user's monitors
beforeEach(async () => { await pool.query(`DELETE FROM monitors WHERE user_id = $1`, [userId]); });

async function monitor(o: { active?: boolean; paused?: boolean; simulated?: boolean; interval?: number; lastCheckedSecAgo?: number | null } = {}) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO monitors (id, name, url, user_id, updated_at, is_active, is_paused, is_simulated, "interval", last_checked_at)
     VALUES ($1, 'm', 'https://example.com', $2, now(), $3, $4, $5, $6,
             CASE WHEN $7::int IS NULL THEN NULL ELSE (now() AT TIME ZONE 'UTC') - make_interval(secs => $7::int) END)`,
    [id, userId, o.active ?? true, o.paused ?? false, o.simulated ?? false, o.interval ?? 60, o.lastCheckedSecAgo ?? null]
  );
  return id;
}

/** A runner that records a healthy observation (so last_checked_at advances) without any network access. */
const okRunner = (log: string[] = [], delayMs = 0): CheckRunner => async (d, m: RunnableMonitor) => {
  log.push(m.id);
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  return recordObservation(d, m.id, { observedAt: new Date(), success: true, status: 'up', statusCode: 200, latencyMs: 50, errorCategory: null, error: null });
};

const opts = { tickMs: 60_000, maxConcurrent: 10 };

describe('Scheduler', () => {
  it('selects only active, non-paused, non-simulated monitors that are due', async () => {
    const due = await monitor();                                   // never checked
    const dueByTime = await monitor({ interval: 30, lastCheckedSecAgo: 45 });
    await monitor({ interval: 300, lastCheckedSecAgo: 10 });        // not due yet
    await monitor({ paused: true, active: false });
    await monitor({ simulated: true });
    const s = new Scheduler(db, opts, { runCheck: okRunner() });
    const ids = (await s.findDue(50)).map((m) => m.id).sort();
    expect(ids).toEqual([due, dueByTime].sort());
  });

  it('runs each due monitor once and then waits for its interval (state survives in the database)', async () => {
    const id = await monitor({ interval: 3600 });
    const log: string[] = [];
    const s = new Scheduler(db, opts, { runCheck: okRunner(log) });
    await s.tick();
    await s.stop();
    expect(log).toEqual([id]);
    const again = new Scheduler(db, opts, { runCheck: okRunner(log) }); // simulates a restart: new instance, no memory
    expect(await again.tick()).toBe(0);
  });

  it('never overlaps checks for the same monitor', async () => {
    await monitor();
    const log: string[] = [];
    const s = new Scheduler(db, opts, { runCheck: okRunner(log, 300) });
    await s.tick();
    await s.tick(); // first check still running
    await s.tick();
    expect(s.running).toBe(1);
    await s.stop();
    expect(log).toHaveLength(1);
  });

  it('bounds concurrent outbound checks', async () => {
    for (let i = 0; i < 6; i++) await monitor();
    let active = 0; let peak = 0;
    const runner: CheckRunner = async (d, m) => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 150));
      active--;
      return okRunner()(d, m);
    };
    const s = new Scheduler(db, { tickMs: 60_000, maxConcurrent: 2 }, { runCheck: runner });
    for (let i = 0; i < 12; i++) { await s.tick(); await new Promise((r) => setTimeout(r, 60)); }
    await s.stop();
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(0);
  });

  it('isolates a failing monitor: others still run and the failing one is backed off', async () => {
    const bad = await monitor();
    const good = await monitor();
    const log: string[] = [];
    const runner: CheckRunner = async (d, m) => {
      if (m.id === bad) throw new Error('boom');
      return okRunner(log)(d, m);
    };
    const s = new Scheduler(db, opts, { runCheck: runner });
    await s.tick();
    await s.stop();
    expect(log).toEqual([good]);
    expect((await s.findDue(10)).map((m) => m.id)).not.toContain(bad); // backed off, not hot-looping
  });

  it('stop() waits for in-flight checks and prevents new ones', async () => {
    await monitor();
    const log: string[] = [];
    const s = new Scheduler(db, opts, { runCheck: okRunner(log, 200) });
    await s.tick();
    const { drained } = await s.stop(5000);
    expect(drained).toBe(true);
    expect(s.running).toBe(0);
    await monitor();
    expect(await s.tick()).toBe(0);
  });

  it('opens an incident through the real engine when its runner reports repeated failures', async () => {
    const id = await monitor({ interval: 30 });
    const fail: CheckRunner = (d, m) => recordObservation(d, m.id, {
      observedAt: new Date(), success: false, status: 'down', statusCode: 503, latencyMs: 10, errorCategory: 'HTTP_ERROR', error: 'x' });
    const alerts: string[] = [];
    for (let i = 0; i < 3; i++) {
      await pool.query(`UPDATE monitors SET last_checked_at = NULL WHERE id = $1`, [id]); // make due again
      const s = new Scheduler(db, opts, { runCheck: fail, onOutcome: async (o) => { alerts.push(...o.opened.map((x) => x.type)); } });
      await s.tick(); await s.stop();
    }
    expect(alerts).toEqual(['AVAILABILITY']);
    const rows = await pool.query(`SELECT status FROM incidents WHERE monitor_id = $1`, [id]);
    expect(rows.rows).toEqual([{ status: 'OPEN' }]);
    const a = await pool.query(`SELECT status, type FROM alerts WHERE monitor_id = $1`, [id]);
    expect(a.rows).toEqual([{ status: 'triggered', type: 'incident' }]);
  });
});
