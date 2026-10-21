import { prismaSqlDb, type PrismaRawClient, type SqlDb } from '@pulseops/core';
import { prisma } from './database';

/**
 * The raw-SQL handle used by the PulseOps services (incident engine, analytics, simulation).
 * Prisma remains the schema/migration tool and is still used by the pre-existing routes;
 * the new code uses plain parameterised SQL through this adapter.
 */
export const sqlDb: SqlDb = prismaSqlDb(prisma as unknown as PrismaRawClient);
