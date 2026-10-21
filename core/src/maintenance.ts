import type { SqlDb } from './db/sql';

/**
 * Retention: delete old checks EXCEPT those cited as incident evidence (the foreign key is
 * ON DELETE NO ACTION, so deleting them would fail anyway - this makes it explicit and
 * keeps incident history intact after resolution).
 */
export async function deleteOldChecks(db: SqlDb, cutoff: Date): Promise<number> {
  const rows = await db.query<{ n: number }>(
    `WITH deleted AS (
       DELETE FROM checks c
        WHERE c.checked_at < $1::timestamp
          AND NOT EXISTS (SELECT 1 FROM incident_evidence e WHERE e.check_id = c.id)
        RETURNING 1)
     SELECT count(*)::int AS n FROM deleted`,
    [cutoff.toISOString()]
  );
  return rows[0]?.n ?? 0;
}
