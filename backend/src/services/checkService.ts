import { runRealCheck, recordIncidentAlerts, logger } from '@pulseops/core';
import { sqlDb } from '../config/sql';
import { AppError } from '../middleware/error';
import { getMonitorRow } from './monitorService';

/** Per-process guard so two manual checks of one monitor never overlap (the engine is also safe if they do). */
const inFlight = new Set<string>();

export async function runManualCheck(userId: string, monitorId: string) {
  const row = await getMonitorRow(userId, monitorId);
  if (row.is_simulated) {
    throw new AppError('Simulated monitors never make network requests. Use the Simulation Lab instead.', 409);
  }
  if (inFlight.has(monitorId)) throw new AppError('A check for this monitor is already running.', 409);
  inFlight.add(monitorId);
  try {
    const outcome = await runRealCheck(sqlDb, {
      id: row.id, url: row.url, method: row.method, headers: row.headers, body: row.body,
      timeout: row.timeout, expectedStatus: row.expected_status, expectedKeyword: row.expected_keyword,
      isSimulated: false,
    });
    await recordIncidentAlerts(sqlDb, outcome).catch((e) => logger.error('alert write failed', { error: String(e) }));
    const [check] = await sqlDb.query(
      `SELECT id, status_code, response_time, success, error_category, error, observation_type, checked_at
         FROM checks WHERE id = $1`, [outcome.checkId]);
    return {
      result: {
        id: check.id, statusCode: check.status_code, latencyMs: check.response_time, success: check.success,
        errorCategory: check.error_category, error: check.error, observationType: check.observation_type, checkedAt: check.checked_at,
      },
      counters: outcome.counters,
      incidentsOpened: outcome.opened.map((o) => ({ id: o.id, type: o.type })),
      incidentsResolved: outcome.resolved.map((o) => ({ id: o.id, type: o.type })),
    };
  } finally {
    inFlight.delete(monitorId);
  }
}
