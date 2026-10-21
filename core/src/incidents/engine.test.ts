import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  at, createMonitor, createUser, db, deleteUser, FAIL, incidentsFor, OK, pool, SLOW, TIMEOUT,
} from '../test/db';
import { recordObservation } from './engine';
import { deleteOldChecks } from '../maintenance';

let userId: string;
beforeAll(async () => { userId = await createUser(); });
afterAll(async () => { await deleteUser(userId); await pool.end(); });

const feed = async (monitorId: string, obs: Parameters<typeof recordObservation>[2][]) => {
  const outcomes = [];
  for (const o of obs) outcomes.push(await recordObservation(db, monitorId, o));
  return outcomes;
};

describe('availability detection', () => {
  it('opens an incident only after the configured number of consecutive failures (default 3)', async () => {
    const m = await createMonitor(userId);
    const outcomes = await feed(m, [OK(0), FAIL(1), FAIL(2)]);
    expect(outcomes.flatMap((o) => o.opened)).toHaveLength(0);
    expect(await incidentsFor(m)).toHaveLength(0);

    const third = await recordObservation(db, m, FAIL(3));
    expect(third.opened).toHaveLength(1);
    const [inc] = await incidentsFor(m);
    expect(inc).toMatchObject({ type: 'AVAILABILITY', status: 'OPEN', observation_type: 'REAL' });
    // started_at = the FIRST failing check; opened_at = when the engine changed state
    expect(inc.started_at.getTime()).toBe(at(1).getTime());
    expect(inc.opened_at.getTime()).toBeGreaterThanOrEqual(at(3).getTime());
    expect(inc.trigger_reason).toContain('3 consecutive failed checks');
  });

  it('honours a per-monitor failure threshold', async () => {
    const m = await createMonitor(userId, { failureThreshold: 2 });
    const [, second] = await feed(m, [FAIL(0), FAIL(1)]);
    expect(second.opened).toHaveLength(1);
  });

  it('resets the consecutive-failure count after a success', async () => {
    const m = await createMonitor(userId);
    await feed(m, [FAIL(0), FAIL(1), OK(2), FAIL(3), FAIL(4)]);
    expect(await incidentsFor(m)).toHaveLength(0);
    const o = await recordObservation(db, m, FAIL(5));
    expect(o.opened).toHaveLength(1);
  });

  it('records timeouts and HTTP errors with distinct error categories and links them as evidence', async () => {
    const m = await createMonitor(userId);
    await feed(m, [OK(0), FAIL(1), TIMEOUT(2), FAIL(3)]);
    const [inc] = await incidentsFor(m);
    const ev = await pool.query(
      `SELECT e.role, c.error_category, c.success FROM incident_evidence e JOIN checks c ON c.id = e.check_id
        WHERE e.incident_id = $1 ORDER BY c.checked_at`, [inc.id]);
    expect(ev.rows.map((r) => r.role)).toEqual(['LAST_HEALTHY', 'TRIGGER', 'TRIGGER', 'TRIGGER']);
    expect(ev.rows.map((r) => r.error_category)).toEqual([null, 'HTTP_ERROR', 'TIMEOUT', 'HTTP_ERROR']);
  });
});

describe('latency degradation detection', () => {
  it('opens a LATENCY incident after 3 consecutive slow successful responses, never an availability one', async () => {
    const m = await createMonitor(userId, { latencyThresholdMs: 1000 });
    const outcomes = await feed(m, [OK(0), SLOW(1), SLOW(2), SLOW(3)]);
    expect(outcomes[2].opened).toHaveLength(0);
    expect(outcomes[3].opened.map((o) => o.type)).toEqual(['LATENCY']);
    const incidents = await incidentsFor(m);
    expect(incidents.map((i) => i.type)).toEqual(['LATENCY']);
    expect(incidents[0].trigger_reason).toContain('slower than 1000 ms');
  });

  it('resets the slow counter when a response is back within the threshold', async () => {
    const m = await createMonitor(userId);
    await feed(m, [SLOW(0), SLOW(1), OK(2), SLOW(3), SLOW(4)]);
    expect(await incidentsFor(m)).toHaveLength(0);
  });

  it('does not count failed checks as slow responses (a failure resets the slow streak)', async () => {
    const m = await createMonitor(userId);
    await feed(m, [SLOW(0), SLOW(1), FAIL(2), SLOW(3)]);
    expect(await incidentsFor(m)).toHaveLength(0);
  });

  it('treats latency exactly at the threshold as healthy', async () => {
    const m = await createMonitor(userId, { latencyThresholdMs: 1000 });
    await feed(m, [OK(0, 1000), OK(1, 1000), OK(2, 1000), OK(3, 1000)]);
    expect(await incidentsFor(m)).toHaveLength(0);
  });
});

describe('duplicate prevention and concurrency', () => {
  it('never opens a second incident of the same type while one is open', async () => {
    const m = await createMonitor(userId);
    await feed(m, [FAIL(0), FAIL(1), FAIL(2), FAIL(3), FAIL(4), FAIL(5)]);
    const incidents = await incidentsFor(m);
    expect(incidents).toHaveLength(1);
  });

  it('is safe when many observations are recorded concurrently: one incident, no lost counter updates', async () => {
    const m = await createMonitor(userId);
    await Promise.all(Array.from({ length: 12 }, (_, i) => recordObservation(db, m, FAIL(i))));
    const incidents = await incidentsFor(m);
    expect(incidents).toHaveLength(1);
    const row = await pool.query(`SELECT consecutive_failures FROM monitors WHERE id = $1`, [m]);
    expect(row.rows[0].consecutive_failures).toBe(12);
    const count = await pool.query(`SELECT count(*)::int AS n FROM checks WHERE monitor_id = $1`, [m]);
    expect(count.rows[0].n).toBe(12);
  });

  it('the database itself rejects a second OPEN incident of the same type (partial unique index)', async () => {
    const m = await createMonitor(userId);
    await feed(m, [FAIL(0), FAIL(1), FAIL(2)]);
    await expect(
      pool.query(
        `INSERT INTO incidents (id, monitor_id, type, status, trigger_reason, trigger_rule, started_at, opened_at, updated_at)
         VALUES (gen_random_uuid(), $1, 'AVAILABILITY', 'OPEN', 'x', '{}', now(), now(), now())`, [m])
    ).rejects.toThrow(/uq_incidents_one_open_per_monitor_type/);
    // ...but a different type is allowed
    await expect(
      pool.query(
        `INSERT INTO incidents (id, monitor_id, type, status, trigger_reason, trigger_rule, started_at, opened_at, updated_at)
         VALUES (gen_random_uuid(), $1, 'LATENCY', 'OPEN', 'x', '{}', now(), now(), now())`, [m])
    ).resolves.toBeDefined();
  });

  it('keeps availability and latency incidents independent', async () => {
    const m = await createMonitor(userId);
    await feed(m, [SLOW(0), SLOW(1), SLOW(2), FAIL(3), FAIL(4), FAIL(5)]);
    const incidents = await incidentsFor(m);
    expect(incidents.map((i) => i.type).sort()).toEqual(['AVAILABILITY', 'LATENCY']);
  });
});

describe('recovery and resolution', () => {
  it('resolves an availability incident only after the configured consecutive successes', async () => {
    const m = await createMonitor(userId); // recovery threshold 2
    await feed(m, [OK(0), FAIL(1), FAIL(2), FAIL(3)]);
    const afterOne = await recordObservation(db, m, OK(4));
    expect(afterOne.resolved).toHaveLength(0);
    expect((await incidentsFor(m))[0].status).toBe('OPEN');

    const afterTwo = await recordObservation(db, m, OK(5));
    expect(afterTwo.resolved).toHaveLength(1);
    const [inc] = await incidentsFor(m);
    expect(inc.status).toBe('RESOLVED');
    expect(inc.recovery_started_at.getTime()).toBe(at(4).getTime()); // first qualifying recovery check
    expect(inc.resolved_at.getTime()).toBeGreaterThanOrEqual(at(5).getTime()); // when state changed
  });

  it('a failure during recovery resets the recovery streak', async () => {
    const m = await createMonitor(userId);
    await feed(m, [FAIL(0), FAIL(1), FAIL(2), OK(3), FAIL(4), OK(5)]);
    expect((await incidentsFor(m))[0].status).toBe('OPEN');
    await recordObservation(db, m, OK(6));
    expect((await incidentsFor(m))[0].status).toBe('RESOLVED');
  });

  it('resolves a latency incident only after consecutive within-threshold responses', async () => {
    const m = await createMonitor(userId);
    await feed(m, [SLOW(0), SLOW(1), SLOW(2), OK(3), SLOW(4), OK(5)]);
    expect((await incidentsFor(m))[0].status).toBe('OPEN');
    await recordObservation(db, m, OK(6));
    const [inc] = await incidentsFor(m);
    expect(inc.status).toBe('RESOLVED');
    expect(inc.recovery_started_at.getTime()).toBe(at(5).getTime());
  });

  it('preserves history and evidence after resolution and lets a new incident open later', async () => {
    const m = await createMonitor(userId);
    await feed(m, [OK(0), FAIL(1), FAIL(2), FAIL(3), OK(4), OK(5), FAIL(6), FAIL(7), FAIL(8)]);
    const incidents = await incidentsFor(m);
    expect(incidents.map((i) => i.status)).toEqual(['RESOLVED', 'OPEN']);
    const roles = await pool.query(
      `SELECT role, count(*)::int n FROM incident_evidence WHERE incident_id = $1 GROUP BY role ORDER BY role`,
      [incidents[0].id]);
    expect(Object.fromEntries(roles.rows.map((r) => [r.role, r.n]))).toEqual({ LAST_HEALTHY: 1, RECOVERY: 2, TRIGGER: 3 });
    const events = await pool.query(`SELECT type FROM incident_events WHERE incident_id = $1 ORDER BY occurred_at`, [incidents[0].id]);
    expect(events.rows.map((r) => r.type)).toEqual(['OPENED', 'RESOLVED']);
  });

  it('bounds CONTINUING evidence so a long outage cannot grow without limit', async () => {
    const m = await createMonitor(userId);
    await feed(m, Array.from({ length: 70 }, (_, i) => FAIL(i)));
    const [inc] = await incidentsFor(m);
    const r = await pool.query(`SELECT count(*)::int n FROM incident_evidence WHERE incident_id = $1 AND role = 'CONTINUING'`, [inc.id]);
    expect(r.rows[0].n).toBe(50);
  });
});

describe('observation types', () => {
  it('stores simulated monitors’ checks and incidents as SIMULATED and real ones as REAL', async () => {
    const sim = await createMonitor(userId, { isSimulated: true });
    const real = await createMonitor(userId);
    await feed(sim, [FAIL(0), FAIL(1), FAIL(2)]);
    await feed(real, [FAIL(0), FAIL(1), FAIL(2)]);
    const types = async (id: string) => (await pool.query(
      `SELECT DISTINCT observation_type FROM checks WHERE monitor_id = $1`, [id])).rows.map((r) => r.observation_type);
    expect(await types(sim)).toEqual(['SIMULATED']);
    expect(await types(real)).toEqual(['REAL']);
    expect((await incidentsFor(sim))[0].observation_type).toBe('SIMULATED');
    expect((await incidentsFor(real))[0].observation_type).toBe('REAL');
  });

  it('rejects an unknown observation type at the database level', async () => {
    const m = await createMonitor(userId);
    await expect(pool.query(
      `INSERT INTO checks (id, monitor_id, status, response_time, observation_type) VALUES (gen_random_uuid()::text, $1, 'up', 1, 'FAKE')`, [m]
    )).rejects.toThrow(/chk_checks_observation_type/);
  });
});

describe('retention and deletion', () => {
  it('retention cleanup never deletes checks cited as incident evidence', async () => {
    const m = await createMonitor(userId);
    await feed(m, [OK(0), OK(1), FAIL(2), FAIL(3), FAIL(4)]);
    const deleted = await deleteOldChecks(db, new Date(Date.UTC(2030, 0, 1)));
    // 5 checks: OK(1) is LAST_HEALTHY and FAIL(2..4) are TRIGGER; only OK(0) is unreferenced
    expect(deleted).toBeGreaterThanOrEqual(1);
    const left = await pool.query(`SELECT count(*)::int n FROM checks WHERE monitor_id = $1`, [m]);
    expect(left.rows[0].n).toBe(4);
  });

  it('deleting a monitor cascades through checks, incidents and evidence without FK errors', async () => {
    const m = await createMonitor(userId);
    await feed(m, [FAIL(0), FAIL(1), FAIL(2), OK(3), OK(4)]);
    await expect(pool.query(`DELETE FROM monitors WHERE id = $1`, [m])).resolves.toBeDefined();
    const r = await pool.query(
      `SELECT (SELECT count(*) FROM checks WHERE monitor_id = $1)::int c, (SELECT count(*) FROM incidents WHERE monitor_id = $1)::int i`, [m]);
    expect(r.rows[0]).toEqual({ c: 0, i: 0 });
  });
});
