import type { SqlDb } from '../db/sql';
import type { RecordOutcome } from './engine';

/**
 * Mirror incident transitions into the pre-existing `alerts` table so the original alerts
 * page keeps working. Simulated incidents never create alert rows (and are never emailed).
 */
export async function recordIncidentAlerts(db: SqlDb, outcome: RecordOutcome): Promise<void> {
  if (outcome.observationType === 'SIMULATED') return;
  const { monitor } = outcome;
  for (const o of outcome.opened) {
    await db.query(
      `INSERT INTO alerts (id, monitor_id, user_id, type, status, message, details, sent_at)
       VALUES (gen_random_uuid()::text, $1, $2, 'incident', 'triggered', $3, $4::jsonb, $5::timestamp)`,
      [
        monitor.id,
        monitor.userId,
        `${monitor.name}: ${o.type === 'AVAILABILITY' ? 'availability' : 'latency'} incident opened`,
        JSON.stringify({ incidentId: o.id, type: o.type, reason: o.reason }),
        o.at.toISOString(),
      ]
    );
  }
  for (const r of outcome.resolved) {
    await db.query(
      `UPDATE alerts SET status = 'resolved', resolved_at = $2::timestamp
        WHERE monitor_id = $1 AND status = 'triggered' AND details->>'incidentId' = $3`,
      [monitor.id, r.at.toISOString(), r.id]
    );
    await db.query(
      `INSERT INTO alerts (id, monitor_id, user_id, type, status, message, details, sent_at, resolved_at)
       VALUES (gen_random_uuid()::text, $1, $2, 'incident', 'resolved', $3, $4::jsonb, $5::timestamp, $5::timestamp)`,
      [
        monitor.id,
        monitor.userId,
        `${monitor.name}: ${r.type === 'AVAILABILITY' ? 'availability' : 'latency'} incident resolved`,
        JSON.stringify({ incidentId: r.id, type: r.type, reason: r.reason }),
        r.at.toISOString(),
      ]
    );
  }
}
