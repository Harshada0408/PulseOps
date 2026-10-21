import {
  logger, recordIncidentAlerts, runRealCheck, type RecordOutcome, type RunnableMonitor, type SqlDb,
} from '@pulseops/core';

export interface DueMonitor extends RunnableMonitor {
  name: string;
  userId: string;
  interval: number;
}

export type CheckRunner = (db: SqlDb, monitor: RunnableMonitor) => Promise<RecordOutcome>;
export type OutcomeHandler = (outcome: RecordOutcome) => Promise<void>;

export interface SchedulerOptions {
  /** How often the scheduler looks for due monitors. */
  tickMs: number;
  /** Upper bound on simultaneous outbound checks. */
  maxConcurrent: number;
}

/**
 * In-process scheduler.
 *
 *  - Due-ness comes from the database (`monitors.last_checked_at + interval`), so a restart does
 *    not lose track of when each monitor was last checked (the original worker kept this in memory).
 *  - A monitor already in flight is never started again: checks for one monitor cannot overlap.
 *  - At most `maxConcurrent` checks run at once. The tick only dispatches work and returns; it never
 *    waits for a slow target, so one slow endpoint cannot delay the others.
 *  - A failure while checking one monitor is logged and backed off; it never reaches the others.
 *  - Simulated and paused monitors are never selected.
 *
 * Limitation: this is single-instance. Two worker processes would both pick the same due monitor
 * (the incident engine stays correct because it serialises per monitor, but checks would be doubled).
 * Scaling out would add `FOR UPDATE SKIP LOCKED` leasing in `findDue`.
 */
export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly backoffUntil = new Map<string, number>();
  private stopped = false;

  constructor(
    private readonly db: SqlDb,
    private readonly options: SchedulerOptions,
    private readonly deps: { runCheck?: CheckRunner; onOutcome?: OutcomeHandler } = {}
  ) {}

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), this.options.tickMs);
    void this.tick();
  }

  /** Stop scheduling and wait (up to `timeoutMs`) for checks that are already running. */
  async stop(timeoutMs = 15_000): Promise<{ drained: boolean }> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const pending = Promise.allSettled([...this.inFlight.values()]).then(() => true);
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs).unref());
    return { drained: await Promise.race([pending, timeout]) };
  }

  get running(): number {
    return this.inFlight.size;
  }

  async findDue(limit: number): Promise<DueMonitor[]> {
    if (limit <= 0) return [];
    const rows = await this.db.query(
      `SELECT m.id, m.name, m.url, m.method, m.headers, m.body, m."timeout", m.expected_status, m.expected_keyword,
              m.user_id, m."interval"
         FROM monitors m
        WHERE m.is_active AND NOT m.is_paused AND NOT m.is_simulated
          AND (m.last_checked_at IS NULL
               OR m.last_checked_at + make_interval(secs => m."interval") <= (now() AT TIME ZONE 'UTC'))
        ORDER BY m.last_checked_at NULLS FIRST
        LIMIT $1::int`,
      [limit + this.inFlight.size + 50] // over-fetch so in-flight/backed-off rows cannot starve the rest
    );
    const now = Date.now();
    return rows
      .filter((r) => !this.inFlight.has(r.id) && (this.backoffUntil.get(r.id) ?? 0) <= now)
      .slice(0, limit)
      .map((r) => ({
        id: r.id, name: r.name, url: r.url, method: r.method, headers: r.headers, body: r.body,
        timeout: r.timeout, expectedStatus: r.expected_status, expectedKeyword: r.expected_keyword,
        isSimulated: false, userId: r.user_id, interval: r.interval,
      }));
  }

  /** One scheduling pass. Exposed for tests; normally driven by the interval timer. */
  async tick(): Promise<number> {
    if (this.stopped) return 0;
    const capacity = this.options.maxConcurrent - this.inFlight.size;
    if (capacity <= 0) return 0;
    let due: DueMonitor[];
    try {
      due = await this.findDue(capacity);
    } catch (error) {
      logger.error('Scheduler could not query due monitors', { error: String(error) });
      return 0;
    }
    for (const monitor of due) this.dispatch(monitor);
    return due.length;
  }

  private dispatch(monitor: DueMonitor): void {
    const run = (async () => {
      try {
        const runCheck = this.deps.runCheck ?? runRealCheck;
        const outcome = await runCheck(this.db, monitor);
        await recordIncidentAlerts(this.db, outcome).catch((e) =>
          logger.error('Failed to write incident alert rows', { error: String(e) })
        );
        if (this.deps.onOutcome && (outcome.opened.length || outcome.resolved.length)) {
          await this.deps.onOutcome(outcome).catch((e) =>
            logger.error('Incident notification failed', { error: String(e) })
          );
        }
      } catch (error) {
        // Isolated: back this monitor off for one interval and carry on with the rest.
        this.backoffUntil.set(monitor.id, Date.now() + monitor.interval * 1000);
        logger.error(`Check failed unexpectedly for monitor ${monitor.id}`, { error: String(error) });
      } finally {
        this.inFlight.delete(monitor.id);
      }
    })();
    this.inFlight.set(monitor.id, run);
  }
}
