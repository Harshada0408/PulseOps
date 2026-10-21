-- PulseOps: incident engine schema.
-- Hand-written (not `migrate dev` output) because it contains constructs Prisma cannot model:
-- CHECK constraints and a PARTIAL UNIQUE INDEX. Apply with `prisma migrate deploy`.

-- ── users ───────────────────────────────────────────────────────────────────
ALTER TABLE "users" ADD COLUMN "password_hash" TEXT;

-- ── monitors ────────────────────────────────────────────────────────────────
ALTER TABLE "monitors"
  ADD COLUMN "latency_threshold_ms"     INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN "failure_threshold"        INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "latency_breach_threshold" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "recovery_threshold"       INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "consecutive_failures"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "consecutive_slow"         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "consecutive_success"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "consecutive_fast"         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_checked_at"          TIMESTAMP(3),
  ADD COLUMN "is_simulated"             BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "monitors"
  ADD CONSTRAINT "chk_monitors_latency_threshold" CHECK ("latency_threshold_ms" BETWEEN 1 AND 600000),
  ADD CONSTRAINT "chk_monitors_failure_threshold" CHECK ("failure_threshold" BETWEEN 1 AND 20),
  ADD CONSTRAINT "chk_monitors_latency_breach_threshold" CHECK ("latency_breach_threshold" BETWEEN 1 AND 20),
  ADD CONSTRAINT "chk_monitors_recovery_threshold" CHECK ("recovery_threshold" BETWEEN 1 AND 20),
  ADD CONSTRAINT "chk_monitors_interval" CHECK ("interval" BETWEEN 10 AND 86400),
  ADD CONSTRAINT "chk_monitors_timeout" CHECK ("timeout" BETWEEN 1 AND 120),
  ADD CONSTRAINT "chk_monitors_counters_nonneg" CHECK (
    "consecutive_failures" >= 0 AND "consecutive_slow" >= 0 AND
    "consecutive_success" >= 0 AND "consecutive_fast" >= 0);

CREATE INDEX "monitors_is_simulated_idx" ON "monitors"("is_simulated");

-- ── checks ──────────────────────────────────────────────────────────────────
ALTER TABLE "checks"
  ADD COLUMN "success"          BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "observation_type" TEXT    NOT NULL DEFAULT 'REAL',
  ADD COLUMN "error_category"   TEXT;

-- Back-fill the new column for rows written by the original worker.
UPDATE "checks" SET "success" = ("status" <> 'down');

ALTER TABLE "checks"
  ADD CONSTRAINT "chk_checks_observation_type" CHECK ("observation_type" IN ('REAL', 'SIMULATED')),
  ADD CONSTRAINT "chk_checks_error_category" CHECK (
    "error_category" IS NULL OR "error_category" IN
      ('HTTP_ERROR','TIMEOUT','NETWORK','TLS','BLOCKED','VALIDATION','RESPONSE_TOO_LARGE','UNKNOWN')),
  ADD CONSTRAINT "chk_checks_status_code" CHECK ("status_code" IS NULL OR "status_code" BETWEEN 100 AND 599),
  ADD CONSTRAINT "chk_checks_response_time" CHECK ("response_time" >= 0);

-- Supports "last N checks for monitor M" and time-window scans for one monitor.
CREATE INDEX "idx_checks_monitor_checked_at" ON "checks"("monitor_id", "checked_at" DESC);

-- ── incidents ───────────────────────────────────────────────────────────────
CREATE TABLE "incidents" (
  "id"                  UUID         NOT NULL,
  "monitor_id"          TEXT         NOT NULL,
  "type"                TEXT         NOT NULL,
  "status"              TEXT         NOT NULL DEFAULT 'OPEN',
  "observation_type"    TEXT         NOT NULL DEFAULT 'REAL',
  "trigger_reason"      TEXT         NOT NULL,
  "trigger_rule"        JSONB        NOT NULL,
  "started_at"          TIMESTAMP(3) NOT NULL,
  "opened_at"           TIMESTAMP(3) NOT NULL,
  "recovery_started_at" TIMESTAMP(3),
  "resolved_at"         TIMESTAMP(3),
  "resolution_reason"   TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "incidents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "incidents_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "chk_incidents_type" CHECK ("type" IN ('AVAILABILITY', 'LATENCY')),
  CONSTRAINT "chk_incidents_status" CHECK ("status" IN ('OPEN', 'RESOLVED')),
  CONSTRAINT "chk_incidents_observation_type" CHECK ("observation_type" IN ('REAL', 'SIMULATED')),
  CONSTRAINT "chk_incidents_lifecycle" CHECK (
    ("status" = 'OPEN' AND "resolved_at" IS NULL) OR
    ("status" = 'RESOLVED' AND "resolved_at" IS NOT NULL AND "resolved_at" >= "opened_at")),
  CONSTRAINT "chk_incidents_opened_after_start" CHECK ("opened_at" >= "started_at")
);

-- THE duplicate-prevention guarantee: at most one OPEN incident per (monitor, type).
-- The engine also serialises per monitor with SELECT ... FOR UPDATE; this index is the
-- database-level backstop that makes a duplicate impossible even if that logic had a bug.
CREATE UNIQUE INDEX "uq_incidents_one_open_per_monitor_type"
  ON "incidents"("monitor_id", "type") WHERE "status" = 'OPEN';

CREATE INDEX "idx_incidents_opened_at"          ON "incidents"("opened_at" DESC);
CREATE INDEX "idx_incidents_monitor_opened_at"  ON "incidents"("monitor_id", "opened_at" DESC);
CREATE INDEX "idx_incidents_open"               ON "incidents"("opened_at" DESC) WHERE "status" = 'OPEN';

-- ── incident_evidence ───────────────────────────────────────────────────────
CREATE TABLE "incident_evidence" (
  "id"          UUID         NOT NULL,
  "incident_id" UUID         NOT NULL,
  "check_id"    TEXT         NOT NULL,
  "role"        TEXT         NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "incident_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "incident_evidence_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- NO ACTION: deleting a check that is cited as evidence is an error, not a cascade.
  -- DEFERRABLE INITIALLY DEFERRED: the check happens at COMMIT, so deleting a whole monitor
  -- (which cascades to both the checks and the incidents/evidence that cite them) still works,
  -- while deleting a cited check on its own is rejected.
  CONSTRAINT "incident_evidence_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "checks"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "chk_incident_evidence_role" CHECK ("role" IN ('LAST_HEALTHY', 'TRIGGER', 'CONTINUING', 'RECOVERY'))
);
CREATE UNIQUE INDEX "incident_evidence_incident_id_check_id_role_key" ON "incident_evidence"("incident_id", "check_id", "role");
CREATE INDEX "incident_evidence_incident_id_idx" ON "incident_evidence"("incident_id");
CREATE INDEX "incident_evidence_check_id_idx"    ON "incident_evidence"("check_id");

-- ── incident_events ─────────────────────────────────────────────────────────
CREATE TABLE "incident_events" (
  "id"          UUID         NOT NULL,
  "incident_id" UUID         NOT NULL,
  "type"        TEXT         NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "check_id"    TEXT,
  "message"     TEXT         NOT NULL,
  CONSTRAINT "incident_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "incident_events_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "chk_incident_events_type" CHECK ("type" IN ('OPENED', 'RESOLVED'))
);
CREATE INDEX "incident_events_incident_id_occurred_at_idx" ON "incident_events"("incident_id", "occurred_at");
