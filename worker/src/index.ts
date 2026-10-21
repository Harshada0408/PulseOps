import cron from 'node-cron';
import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { deleteOldChecks, logger, prismaSqlDb, type PrismaRawClient, type RecordOutcome } from '@pulseops/core';
import { Scheduler } from './scheduler';
import { sendEmailAlert } from './services/alert-service';

const TICK_SECONDS = Math.max(1, parseInt(process.env.SCHEDULER_TICK_SECONDS || '5', 10));
const MAX_CONCURRENT = Math.max(1, Math.min(100, parseInt(process.env.MAX_CONCURRENT_CHECKS || '10', 10)));
const CLEANUP_DAYS = parseInt(process.env.CLEANUP_DAYS || '90', 10);

const prisma = new PrismaClient({ log: ['error'] });
const db = prismaSqlDb(prisma as unknown as PrismaRawClient);

async function notify(outcome: RecordOutcome): Promise<void> {
  if (outcome.observationType === 'SIMULATED') return;
  const user = await db.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [outcome.monitor.userId]);
  const to = user[0]?.email;
  if (!to) return;
  for (const o of outcome.opened) {
    await sendEmailAlert(to, outcome.monitor.name, outcome.monitor.url, o.type === 'AVAILABILITY' ? 'down' : 'degraded', o.reason);
  }
  for (const r of outcome.resolved) {
    await sendEmailAlert(to, outcome.monitor.name, outcome.monitor.url, 'up', r.reason);
  }
}

const scheduler = new Scheduler(db, { tickMs: TICK_SECONDS * 1000, maxConcurrent: MAX_CONCURRENT }, { onOutcome: notify });

async function shutdown(signal: string) {
  logger.info(`${signal} received, stopping scheduler...`);
  const { drained } = await scheduler.stop(15_000);
  if (!drained) logger.warn('Shutdown timeout: some checks were still running');
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection', { reason: String(reason) }));

async function main() {
  logger.info('PulseOps worker starting', { tickSeconds: TICK_SECONDS, maxConcurrent: MAX_CONCURRENT, cleanupDays: CLEANUP_DAYS });
  await db.query('SELECT 1');
  scheduler.start();
  // Daily retention sweep. Checks cited as incident evidence are never deleted.
  cron.schedule('0 3 * * *', async () => {
    try {
      const n = await deleteOldChecks(db, new Date(Date.now() - CLEANUP_DAYS * 86_400_000));
      logger.info(`Retention: deleted ${n} old checks`);
    } catch (error) {
      logger.error('Retention sweep failed', { error: String(error) });
    }
  });
  logger.info('Scheduler running');
}

main().catch((error) => {
  logger.error('Fatal error starting worker', { error: String(error) });
  process.exit(1);
});
