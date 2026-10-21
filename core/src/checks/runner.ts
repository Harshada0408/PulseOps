import type { Method } from 'axios';
import { executeCheck, type CheckResult } from '../services/executor';
import type { SqlDb } from '../db/sql';
import { recordObservation, type Observation, type RecordOutcome } from '../incidents/engine';
import { classifyFailure, safeErrorDetail } from './classify';

export interface RunnableMonitor {
  id: string;
  url: string;
  method: string;
  headers: unknown;
  body: string | null;
  /** seconds */
  timeout: number;
  expectedStatus: number | null;
  expectedKeyword: string | null;
  isSimulated: boolean;
}

export function toObservation(result: CheckResult, observedAt: Date): Observation {
  return {
    observedAt,
    success: result.status !== 'down',
    status: result.status,
    statusCode: result.statusCode ?? null,
    latencyMs: result.responseTime,
    errorCategory: classifyFailure(result),
    error: safeErrorDetail(result.error),
  };
}

/**
 * One real check: the hardened executor (SSRF policy, redirect re-validation, response-size
 * cap, hard timeout) followed by the transactional incident engine.
 * Simulated monitors are refused here: they must never cause outbound requests.
 */
export async function runRealCheck(db: SqlDb, monitor: RunnableMonitor): Promise<RecordOutcome> {
  if (monitor.isSimulated) {
    throw new Error('Simulated monitors never perform network requests.');
  }
  const headers =
    monitor.headers && typeof monitor.headers === 'object' ? (monitor.headers as Record<string, string>) : {};
  const result = await executeCheck(
    monitor.url,
    monitor.method as Method,
    headers,
    monitor.body ?? undefined,
    monitor.timeout * 1000,
    monitor.expectedStatus ?? undefined,
    monitor.expectedKeyword ?? undefined
  );
  return recordObservation(db, monitor.id, toObservation(result, new Date()));
}
