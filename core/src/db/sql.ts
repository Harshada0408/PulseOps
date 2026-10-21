/**
 * A deliberately tiny SQL abstraction.
 *
 * The incident engine, analytics and simulation code are written as plain parameterised
 * SQL (row locks, partial-index conflict handling and percentile aggregates are all things
 * an ORM expresses badly). They talk to the database through this interface so the same
 * code runs against:
 *   - Prisma in production            -> `prismaSqlDb(prisma)`
 *   - node-postgres in tests/tooling  -> `pgSqlDb(pool)` (see ./pg.ts)
 *
 * Conventions every caller follows (they keep both adapters behaving identically):
 *   - Placeholders are `$1, $2, ...`; every parameter that is not plain text carries an
 *     explicit cast in the SQL (`$1::timestamp`, `$2::uuid`, `$3::jsonb`).
 *   - Timestamps are passed as UTC ISO-8601 strings. Columns are `timestamp(3)` (no zone),
 *     which Prisma treats as UTC; casting an ISO string to `timestamp` keeps the UTC wall time.
 *   - Aggregates are cast to int/float8 in SQL so no adapter hands back BigInt or Decimal.
 */
export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface SqlTx {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface SqlDb extends SqlTx {
  /** Run `fn` inside one transaction. Rolls back if `fn` throws. */
  transaction<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T>;
}

/** The only parts of PrismaClient we rely on, declared locally so core does not need generated types. */
export interface PrismaRawClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $transaction<R>(
    fn: (tx: PrismaRawClient) => Promise<R>,
    options?: { maxWait?: number; timeout?: number }
  ): Promise<R>;
}

export function prismaSqlDb(prisma: PrismaRawClient): SqlDb {
  const wrap = (client: PrismaRawClient): SqlTx => ({
    query: <T extends Row = Row>(sql: string, params: unknown[] = []) =>
      client.$queryRawUnsafe<T[]>(sql, ...params),
  });
  return {
    ...wrap(prisma),
    transaction: <T>(fn: (tx: SqlTx) => Promise<T>) =>
      prisma.$transaction((tx) => fn(wrap(tx)), { maxWait: 5000, timeout: 15000 }),
  };
}
