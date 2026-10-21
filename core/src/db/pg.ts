import { Pool, types } from 'pg';
import type { PoolClient } from 'pg';
import type { Row, SqlDb, SqlTx } from './sql';

/**
 * node-postgres adapter. Used by the automated tests and by tooling that wants to run the
 * same SQL without Prisma. Production code uses `prismaSqlDb`.
 *
 * `timestamp without time zone` (OID 1114) is what Prisma's DateTime maps to and it stores
 * UTC. node-postgres would parse it in the *local* zone, so we parse it as UTC here.
 */
types.setTypeParser(1114, (value: string) => new Date(value.replace(' ', 'T') + 'Z'));

export function pgSqlDb(pool: Pool): SqlDb {
  const wrap = (client: Pick<PoolClient, 'query'> | Pool): SqlTx => ({
    query: async <T extends Row = Row>(sql: string, params: unknown[] = []) =>
      (await client.query(sql, params as unknown[])).rows as T[],
  });
  return {
    ...wrap(pool),
    transaction: async <T>(fn: (tx: SqlTx) => Promise<T>) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
