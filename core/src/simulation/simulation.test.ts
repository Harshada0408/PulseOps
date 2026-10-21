import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createMonitor, createUser, db, deleteUser, incidentsFor, pool } from '../test/db';
import { ensureSimulationMonitor, NotSimulatedMonitorError, resetSimulation, runScenario, SimulationClockError } from './service';
import { SCENARIOS, SIMULATION_MONITOR } from './scenarios';
import { runRealCheck } from '../checks/runner';

let userId: string;
beforeAll(async () => { userId = await createUser(); });
afterAll(async () => { await deleteUser(userId); await pool.end(); });

describe('simulation module', () => {
  it('creates exactly one simulated monitor per user, flagged is_simulated', async () => {
    const a = await ensureSimulationMonitor(db, userId);
    const b = await ensureSimulationMonitor(db, userId);
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
    const row = (await pool.query(`SELECT is_simulated, url FROM monitors WHERE id = $1`, [a.id])).rows[0];
    expect(row.is_simulated).toBe(true);
    expect(row.url).toContain('.invalid'); // can never resolve
  });

  it('runs the full story deterministically: latency incident resolves, then availability incident opens and resolves', async () => {
    const { id } = await ensureSimulationMonitor(db, userId);
    await resetSimulation(db, id);
    const result = await runScenario(db, id, 'full_story');
    expect(result.checksRecorded).toBe(SCENARIOS.full_story.steps.length);
    expect(result.opened.map((o) => o.type)).toEqual(['LATENCY', 'AVAILABILITY']);
    expect(result.resolved.map((o) => o.type)).toEqual(['LATENCY', 'AVAILABILITY']);
    const incidents = await incidentsFor(id);
    expect(incidents.map((i) => [i.type, i.status, i.observation_type])).toEqual([
      ['LATENCY', 'RESOLVED', 'SIMULATED'],
      ['AVAILABILITY', 'RESOLVED', 'SIMULATED'],
    ]);
    const types = (await pool.query(`SELECT DISTINCT observation_type FROM checks WHERE monitor_id = $1`, [id])).rows;
    expect(types).toEqual([{ observation_type: 'SIMULATED' }]);
  });

  it('is reproducible: two resets + runs give the same incident sequence', async () => {
    const { id } = await ensureSimulationMonitor(db, userId);
    const run = async () => {
      await resetSimulation(db, id);
      await runScenario(db, id, 'full_story');
      return (await incidentsFor(id)).map((i) => `${i.type}:${i.status}`);
    };
    expect(await run()).toEqual(await run());
  });

  it('individual scenarios behave as documented', async () => {
    const { id } = await ensureSimulationMonitor(db, userId);
    await resetSimulation(db, id);
    expect((await runScenario(db, id, 'healthy')).opened).toHaveLength(0);
    expect((await runScenario(db, id, 'slow')).opened.map((o) => o.type)).toEqual(['LATENCY']);
    expect((await runScenario(db, id, 'failing')).opened.map((o) => o.type)).toEqual(['AVAILABILITY']);
    // The latency incident from 'slow' is still open, and these fast 200s satisfy BOTH recovery rules.
    expect((await runScenario(db, id, 'recover_failure')).resolved.map((o) => o.type).sort()).toEqual(['AVAILABILITY', 'LATENCY']);
    const open = (await incidentsFor(id)).filter((i) => i.status === 'OPEN');
    expect(open.map((i) => i.type)).toEqual([]);
  });

  it('keeps time monotonic and refuses to run far into the future', async () => {
    const { id } = await ensureSimulationMonitor(db, userId);
    await resetSimulation(db, id);
    for (let i = 0; i < 4; i++) await runScenario(db, id, 'full_story');
    const times = (await pool.query(`SELECT checked_at FROM checks WHERE monitor_id = $1 ORDER BY checked_at`, [id])).rows;
    const unique = new Set(times.map((t) => t.checked_at.getTime()));
    expect(unique.size).toBe(times.length); // strictly increasing, no overlap
    await expect((async () => { for (let i = 0; i < 20; i++) await runScenario(db, id, 'full_story'); })())
      .rejects.toBeInstanceOf(SimulationClockError);
  });

  it('reset deletes simulated history and counters and leaves real monitors untouched', async () => {
    const { id } = await ensureSimulationMonitor(db, userId);
    const real = await createMonitor(userId);
    await pool.query(`INSERT INTO checks (id, monitor_id, status, response_time) VALUES (gen_random_uuid()::text, $1, 'up', 10)`, [real]);
    await runScenario(db, id, 'failing');
    await resetSimulation(db, id);
    const c = (await pool.query(`SELECT (SELECT count(*) FROM checks WHERE monitor_id = $1)::int sim,
      (SELECT count(*) FROM incidents WHERE monitor_id = $1)::int inc, (SELECT count(*) FROM checks WHERE monitor_id = $2)::int real`, [id, real])).rows[0];
    expect(c).toEqual({ sim: 0, inc: 0, real: 1 });
    const m = (await pool.query(`SELECT consecutive_failures, last_checked_at FROM monitors WHERE id = $1`, [id])).rows[0];
    expect(m).toEqual({ consecutive_failures: 0, last_checked_at: null });
  });

  it('refuses to simulate on, or reset, a real monitor, and refuses real HTTP checks on a simulated one', async () => {
    const real = await createMonitor(userId);
    await expect(runScenario(db, real, 'healthy')).rejects.toBeInstanceOf(NotSimulatedMonitorError);
    await expect(resetSimulation(db, real)).rejects.toBeInstanceOf(NotSimulatedMonitorError);
    await expect(runRealCheck(db, {
      id: 'x', url: SIMULATION_MONITOR.url, method: 'GET', headers: {}, body: null, timeout: 5,
      expectedStatus: null, expectedKeyword: null, isSimulated: true,
    })).rejects.toThrow(/never perform network requests/);
  });
});
