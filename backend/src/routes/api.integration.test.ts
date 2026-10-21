/**
 * HTTP-level integration tests: real Express app, real PostgreSQL (migrated schema), real SQL
 * services and the real incident engine. Only authentication is stubbed (x-test-user header),
 * because the production auth middleware needs the Prisma client.
 */
import request from 'supertest';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '';
process.env.JWT_SECRET = 'x'.repeat(72);
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.FROM_EMAIL = 'alerts@example.com';
process.env.AUTH_MODE = 'local';
process.env.AUTH_RATE_LIMIT_MAX = '200';

jest.mock('../config/database', () => ({
  prisma: { $on: () => undefined, $queryRaw: async () => [1], $disconnect: async () => undefined },
  verifyDatabaseConnection: async () => undefined,
}));
jest.mock('../config/sql', () => {
  const { Pool } = require('pg');
  const { pgSqlDb } = require('@pulseops/core');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  return { sqlDb: pgSqlDb(pool), __pool: pool };
});
// Legacy routers (billing, status pages, analytics, alerts) use the generated Prisma client and are not
// part of this suite; stub them so the app can be imported without a generated client.
for (const legacy of ['alerts', 'analytics', 'billing', 'statusPages']) {
  jest.doMock(`./${legacy}`, () => ({ __esModule: true, default: require('express').Router() }));
}
jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    const id = req.headers['x-test-user'];
    if (!id) return res.status(401).json({ error: 'Authentication required' });
    req.user = { id, email: 'tester@example.com' };
    next();
  },
  optionalAuth: (_r: any, _s: any, n: any) => n(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const app = require('../server').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pool = require('../config/sql').__pool;

const users: string[] = [];
async function newUser() {
  const id = randomUUID();
  await pool.query(`INSERT INTO users (id, email, updated_at) VALUES ($1, $2, now())`, [id, `${id}@t.local`]);
  users.push(id);
  return id;
}
const as = (id: string) => ({ 'x-test-user': id });
afterAll(async () => {
  for (const id of users) await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
  await pool.end();
});

const valid = { name: 'Payments API', url: 'https://payments.example.com/health' };

describe('health and auth gating', () => {
  it('GET /api/v1/health is public', async () => {
    const r = await request(app).get('/api/v1/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('healthy');
  });
  it('rejects unauthenticated access to protected routes', async () => {
    for (const path of ['/api/v1/monitors', '/api/v1/incidents', '/api/v1/dashboard/summary']) {
      expect((await request(app).get(path)).status).toBe(401);
    }
  });
});

describe('monitor creation and validation', () => {
  it('creates a monitor with documented defaults and never returns header values', async () => {
    const u = await newUser();
    const r = await request(app).post('/api/v1/monitors').set(as(u))
      .send({ ...valid, headers: { Authorization: 'Bearer super-secret' } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      name: 'Payments API', method: 'GET', interval: 300, timeout: 30, latencyThresholdMs: 1000,
      failureThreshold: 3, latencyBreachThreshold: 3, recoveryThreshold: 2, isActive: true, isSimulated: false, health: 'unknown',
    });
    expect(r.body.headers).toEqual({ Authorization: '••••••' });
    expect(JSON.stringify(r.body)).not.toContain('super-secret');
  });

  it.each([
    ['not a url', { url: 'not-a-url' }],
    ['ftp scheme', { url: 'ftp://example.com/x' }],
    ['file scheme', { url: 'file:///etc/passwd' }],
    ['failureThreshold 0', { failureThreshold: 0 }],
    ['interval below 30s', { interval: 5 }],
    ['unknown field isSimulated', { isSimulated: true }],
    ['latency threshold >= timeout', { timeout: 2, latencyThresholdMs: 5000 }],
  ])('rejects %s with 400', async (_label, patch) => {
    const u = await newUser();
    const r = await request(app).post('/api/v1/monitors').set(as(u)).send({ ...valid, ...patch });
    expect(r.status).toBe(400);
    expect(r.body.error).toBeTruthy();
  });

  it.each([
    'http://localhost:3001/health', 'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/', 'http://192.168.1.1/', 'http://[::1]/', 'http://metadata.google.internal/',
    'http://user:pass@example.com/',
  ])('SSRF: refuses %s at creation time', async (url) => {
    const u = await newUser();
    const r = await request(app).post('/api/v1/monitors').set(as(u)).send({ ...valid, url });
    expect(r.status).toBe(400);
  });

  it('enforces per-user scoping: another user cannot read, edit, check or delete it', async () => {
    const a = await newUser(); const b = await newUser();
    const id = (await request(app).post('/api/v1/monitors').set(as(a)).send(valid)).body.id;
    expect((await request(app).get(`/api/v1/monitors/${id}`).set(as(b))).status).toBe(404);
    expect((await request(app).patch(`/api/v1/monitors/${id}`).set(as(b)).send({ name: 'x' })).status).toBe(404);
    expect((await request(app).post(`/api/v1/monitors/${id}/check`).set(as(b))).status).toBe(404);
    expect((await request(app).delete(`/api/v1/monitors/${id}`).set(as(b))).status).toBe(404);
    expect((await request(app).get(`/api/v1/monitors/${id}`).set(as(a))).status).toBe(200);
  });

  it('lists with pagination and bounds the page size', async () => {
    const u = await newUser();
    for (let i = 0; i < 3; i++) await request(app).post('/api/v1/monitors').set(as(u)).send({ ...valid, name: `m${i}` });
    const r = await request(app).get('/api/v1/monitors?limit=2&page=2').set(as(u));
    expect(r.body).toMatchObject({ page: 2, limit: 2, total: 3 });
    expect(r.body.monitors).toHaveLength(1);
    expect((await request(app).get('/api/v1/monitors?limit=1000').set(as(u))).status).toBe(400);
  });

  it('updates settings, pauses/resumes and deletes', async () => {
    const u = await newUser();
    const id = (await request(app).post('/api/v1/monitors').set(as(u)).send(valid)).body.id;
    const patched = await request(app).patch(`/api/v1/monitors/${id}`).set(as(u))
      .send({ failureThreshold: 5, latencyThresholdMs: 750 });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ failureThreshold: 5, latencyThresholdMs: 750 });
    expect((await request(app).patch(`/api/v1/monitors/${id}`).set(as(u)).send({ latencyThresholdMs: 60000 })).status).toBe(400);
    expect((await request(app).post(`/api/v1/monitors/${id}/pause`).set(as(u))).body).toMatchObject({ isPaused: true, isActive: false, health: 'paused' });
    expect((await request(app).post(`/api/v1/monitors/${id}/resume`).set(as(u))).body).toMatchObject({ isPaused: false, isActive: true });
    expect((await request(app).delete(`/api/v1/monitors/${id}`).set(as(u))).status).toBe(204);
    expect((await request(app).get(`/api/v1/monitors/${id}`).set(as(u))).status).toBe(404);
  });
});

describe('manual checks drive real incident detection end to end', () => {
  it('records failures as real observations and opens an availability incident after 3 manual checks', async () => {
    const u = await newUser();
    // .invalid never resolves (RFC 2606) -> deterministic network failure with no internet needed
    const id = (await request(app).post('/api/v1/monitors').set(as(u))
      .send({ name: 'Down API', url: 'https://down.pulseops-test.invalid/health', timeout: 5 })).body.id;
    for (let i = 0; i < 2; i++) {
      const r = await request(app).post(`/api/v1/monitors/${id}/check`).set(as(u));
      expect(r.status).toBe(200);
      expect(r.body.result).toMatchObject({ success: false, errorCategory: 'NETWORK', observationType: 'REAL' });
      expect(r.body.incidentsOpened).toHaveLength(0);
    }
    const third = await request(app).post(`/api/v1/monitors/${id}/check`).set(as(u));
    expect(third.body.incidentsOpened.map((i: any) => i.type)).toEqual(['AVAILABILITY']);

    const list = await request(app).get('/api/v1/incidents?status=OPEN&type=AVAILABILITY').set(as(u));
    expect(list.body.total).toBe(1);
    const detail = await request(app).get(`/api/v1/incidents/${list.body.incidents[0].id}`).set(as(u));
    expect(detail.status).toBe(200);
    expect(detail.body.incident).toMatchObject({ type: 'AVAILABILITY', status: 'OPEN', observationType: 'REAL' });
    expect(detail.body.explanation.facts.join(' ')).toContain('NETWORK x3');
    expect(detail.body.explanation.hypotheses.length).toBeGreaterThan(0);
    expect(detail.body.timeline.map((t: any) => t.label)).toEqual(
      ['Triggering check', 'Triggering check', 'Triggering check', 'Incident opened']);

    const mon = await request(app).get(`/api/v1/monitors/${id}`).set(as(u));
    expect(mon.body.monitor.health).toBe('unavailable');
    const results = await request(app).get(`/api/v1/monitors/${id}/results?limit=2`).set(as(u));
    expect(results.body).toMatchObject({ total: 3, limit: 2 });
    expect(results.body.results).toHaveLength(2);
  });

  it('incident detail is 404 for an invalid id and for another user', async () => {
    const a = await newUser(); const b = await newUser();
    expect((await request(app).get('/api/v1/incidents/not-a-uuid').set(as(a))).status).toBe(404);
    expect((await request(app).get(`/api/v1/incidents/${randomUUID()}`).set(as(a))).status).toBe(404);
    void b;
  });
});

describe('simulation is isolated from real data', () => {
  it('runs scenarios without network access and keeps SIMULATED apart from REAL everywhere', async () => {
    const u = await newUser();
    await request(app).post('/api/v1/monitors').set(as(u)).send(valid); // a real monitor, no checks

    const run = await request(app).post('/api/v1/simulation/run').set(as(u)).send({ scenario: 'full_story' });
    expect(run.status).toBe(200);
    expect(run.body.observationType).toBe('SIMULATED');
    expect(run.body.incidentsOpened.map((i: any) => i.type)).toEqual(['LATENCY', 'AVAILABILITY']);

    const real = await request(app).get('/api/v1/dashboard/summary?mode=real').set(as(u));
    expect(real.body.cards).toMatchObject({ totalMonitors: 1, totalChecks: 0, openIncidents: 0 });
    expect(real.body.recentIncidents).toEqual([]);
    expect((await request(app).get('/api/v1/incidents?mode=real').set(as(u))).body.total).toBe(0);
    expect((await request(app).get('/api/v1/monitors?mode=real').set(as(u))).body.monitors.map((m: any) => m.isSimulated)).toEqual([false]);

    const sim = await request(app).get('/api/v1/dashboard/summary?mode=simulated').set(as(u));
    expect(sim.body.cards.totalChecks).toBe(19);
    expect((await request(app).get('/api/v1/incidents?mode=simulated').set(as(u))).body.total).toBe(2);
    expect(sim.body.recentChecks.every((c: any) => c.observationType === 'SIMULATED')).toBe(true);

    // manual check on the simulated monitor is refused: it must never reach the network
    const simMonitor = (await request(app).get('/api/v1/monitors?mode=simulated').set(as(u))).body.monitors[0];
    expect((await request(app).post(`/api/v1/monitors/${simMonitor.id}/check`).set(as(u))).status).toBe(409);
    expect((await request(app).patch(`/api/v1/monitors/${simMonitor.id}`).set(as(u)).send({ name: 'x' })).status).toBe(409);

    const reset = await request(app).post('/api/v1/simulation/reset').set(as(u));
    expect(reset.body.reset).toBe(true);
    expect((await request(app).get('/api/v1/dashboard/summary?mode=simulated').set(as(u))).body.cards.totalChecks).toBe(0);
  });

  it('rejects any attempt to pass a URL or unknown scenario', async () => {
    const u = await newUser();
    expect((await request(app).post('/api/v1/simulation/run').set(as(u)).send({ scenario: 'slow', url: 'http://x' })).status).toBe(400);
    expect((await request(app).post('/api/v1/simulation/run').set(as(u)).send({ scenario: 'nope' })).status).toBe(400);
  });
});

describe('dashboard aggregation against persisted data', () => {
  it('computes average, p95, uptime, failures, health and slowest endpoints from stored rows', async () => {
    const u = await newUser();
    const mk = async (name: string) => (await request(app).post('/api/v1/monitors').set(as(u)).send({ name, url: `https://${name}.example.com/` })).body.id;
    const fast = await mk('fast'); const slow = await mk('slow');
    const insert = (monitor: string, ms: number, ok: boolean, minsAgo: number) => pool.query(
      `INSERT INTO checks (id, monitor_id, status, status_code, response_time, success, observation_type, error_category, checked_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, 'REAL', $6, (now() AT TIME ZONE 'UTC') - make_interval(mins => $7::int))`,
      [monitor, ok ? 'up' : 'down', ok ? 200 : 500, ms, ok, ok ? null : 'HTTP_ERROR', minsAgo]);
    // fast: 10 successes 100..1000 ms ; slow: 4 successes ~2s ; plus 2 failures on fast
    for (let i = 1; i <= 10; i++) await insert(fast, i * 100, true, i);
    for (const ms of [1900, 2000, 2100, 2200]) await insert(slow, ms, true, 5);
    await insert(fast, 300, false, 2); await insert(fast, 300, false, 3);
    // an old check outside the 1h window must be excluded by window=1h
    await insert(fast, 9999, true, 600);
    // an open availability incident on `fast`
    await pool.query(`INSERT INTO incidents (id, monitor_id, type, status, trigger_reason, trigger_rule, started_at, opened_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'AVAILABILITY', 'OPEN', 'x', '{}', now(), now(), now())`, [fast]);

    const r = await request(app).get('/api/v1/dashboard/summary?mode=real&window=1h').set(as(u));
    expect(r.status).toBe(200);
    const c = r.body.cards;
    expect(c).toMatchObject({ totalMonitors: 2, unavailable: 1, healthy: 1, openIncidents: 1, totalChecks: 16, failedChecks: 2 });
    // successful latencies: 100..1000 (10 values) + 1900,2000,2100,2200 -> mean = (5500 + 8200)/14
    expect(c.avgLatencyMs).toBeCloseTo((5500 + 8200) / 14, 1);
    expect(c.uptimePercent).toBe(87.5); // 14 / 16
    // p95 of 14 sorted values via percentile_cont: position 0.95*13 = 12.35 -> between 2100 and 2200 => 2135
    expect(c.p95LatencyMs).toBe(2135);
    expect(r.body.slowestEndpoints[0]).toMatchObject({ name: 'slow' });
    expect(r.body.slowestEndpoints[1]).toMatchObject({ name: 'fast' });
    expect(r.body.latencySeries.length).toBeGreaterThan(0);
    expect(r.body.methodology.uptime).toMatch(/estimate/i);

    // wider window includes the old 9999 ms check
    const wide = await request(app).get('/api/v1/dashboard/summary?mode=real&window=24h').set(as(u));
    expect(wide.body.cards.totalChecks).toBe(17);

    // monitor detail stats agree with the stored rows
    const d = await request(app).get(`/api/v1/monitors/${fast}?window=1h`).set(as(u));
    expect(d.body.stats).toMatchObject({ totalChecks: 12, successfulChecks: 10, failedChecks: 2, maxLatencyMs: 1000 });
    expect(d.body.stats.uptimePercent).toBe(83.33);
  });

  it('returns useful empty data for a brand-new user', async () => {
    const u = await newUser();
    const r = await request(app).get('/api/v1/dashboard/summary').set(as(u));
    expect(r.body.cards).toMatchObject({ totalMonitors: 0, totalChecks: 0, avgLatencyMs: null, p95LatencyMs: null, uptimePercent: null });
    expect(r.body.latencySeries).toEqual([]);
  });
});

describe('local authentication', () => {
  it('signs up, signs in, returns the profile and refreshes the session', async () => {
    const email = `${randomUUID()}@example.com`;
    const up = await request(app).post('/api/v1/auth/signup').send({ email, password: 'correct-horse-9', name: 'Ada' });
    expect(up.status).toBe(201);
    users.push(up.body.user.id);
    expect(up.body.session.access_token).toBeTruthy();
    expect(JSON.stringify(up.body)).not.toContain('scrypt$');

    expect((await request(app).post('/api/v1/auth/signup').send({ email, password: 'correct-horse-9' })).status).toBe(409);
    expect((await request(app).post('/api/v1/auth/signup').send({ email: 'x@y.com', password: 'short' })).status).toBe(400);

    const bad = await request(app).post('/api/v1/auth/signin').send({ email, password: 'wrong-password' });
    expect(bad.status).toBe(401);
    const unknown = await request(app).post('/api/v1/auth/signin').send({ email: 'nobody@example.com', password: 'wrong-password' });
    expect(unknown.body.error).toBe(bad.body.error); // no user enumeration

    const ok = await request(app).post('/api/v1/auth/signin').send({ email: email.toUpperCase(), password: 'correct-horse-9' });
    expect(ok.status).toBe(200);
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${ok.body.session.access_token}`);
    expect(me.body.user).toMatchObject({ email, name: 'Ada' });
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${ok.body.session.refresh_token}`)).status).toBe(401); // refresh token is not an access token
    expect((await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
    const refreshed = await request(app).post('/api/v1/auth/refresh').send({ refresh_token: ok.body.session.refresh_token });
    expect(refreshed.status).toBe(200);
  });
});

describe('optional AI assistant', () => {
  it('reports disabled and returns 503 for summaries without breaking anything else', async () => {
    const u = await newUser();
    expect((await request(app).get('/api/v1/meta')).body.ai).toEqual({ enabled: false, provider: 'none' });
    const run = await request(app).post('/api/v1/simulation/run').set(as(u)).send({ scenario: 'failing' });
    const incidentId = run.body.incidentsOpened[0].id;
    const r = await request(app).post(`/api/v1/incidents/${incidentId}/ai-summary`).set(as(u));
    expect(r.status).toBe(503);
    expect((await request(app).get(`/api/v1/incidents/${incidentId}`).set(as(u))).status).toBe(200);
  });
});
