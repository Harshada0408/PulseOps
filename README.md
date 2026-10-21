# PulseOps

**API monitoring, performance analytics and evidence-driven incident investigation.**

Register an API → monitor its behaviour → detect abnormal conditions → inspect the evidence → investigate possible causes → verify recovery.

PulseOps runs scheduled HTTP checks, stores every measurement in PostgreSQL, opens **availability** and **latency-degradation** incidents with a deterministic rule engine, and shows a chronological **evidence timeline** for each incident: which checks triggered it, what the thresholds were, and which checks proved recovery. It works fully without any AI key or paid service.

> PulseOps is a focused developer tool, not a replacement for commercial observability platforms. Its angle is a small, explainable investigation workflow: every alert can be traced back to stored measurements.

| Dashboard (demo data, dark) | Incident evidence (light) |
|---|---|
| ![Dashboard](docs/screenshots/dashboard-demo-dark.png) | ![Incident](docs/screenshots/incident-detail-light.png) |

More: [dashboard light](docs/screenshots/dashboard-light.png) · [incident dark](docs/screenshots/incident-detail-dark.png) · [monitor detail](docs/screenshots/monitor-detail-dark.png)

---

## Inherited foundation and what was changed

PulseOps is built on **api-monitor-saas** (MIT, © 2026 Darshan Kachare). The original `LICENSE` is unchanged, the original README is kept as [`docs/UPSTREAM_README.md`](docs/UPSTREAM_README.md), and [`NOTICE.md`](NOTICE.md) lists the changes.

**Inherited and kept:** Next.js frontend and Express/Prisma/PostgreSQL backend structure, the hardened HTTP check executor with its SSRF policy (and its tests), the separate worker process, the pluggable auth-provider seam, the public status-page feature.

**Custom work in PulseOps:**

* Incident engine: a transactional state machine for availability and latency incidents, with evidence capture, recovery rules and duplicate prevention (`core/src/incidents`).
* Explainable incident detail: observed facts vs. hypotheses, timeline separating *measurement time* from *state-change time*.
* Deterministic failure **simulation** (labelled `SIMULATED` everywhere, no network access).
* SQL analytics (average / p95 / uptime estimate / slowest endpoints) and a relational schema with constraints, a partial unique index and a composite index.
* Scheduler rewrite (database-driven due-ness, no overlapping checks, bounded concurrency, graceful shutdown).
* Built-in **local authentication** (no Supabase account needed), new UI, theme system, optional AI adapter, and new automated tests for the engine, API, scheduler, simulation and auth (the executor/SSRF tests are inherited).
* The shared `core` workspace package (the executor/SSRF code moved there so the API and worker share one implementation).

## Implemented features (what actually exists)

* Monitors: create, view, edit, pause/resume, delete, **manual check**; configurable name, URL, method, interval, timeout, latency threshold, failure threshold, slow-check count and recovery count; optional expected status / keyword validation.
* **Availability detection:** HTTP errors, network errors, timeouts, validation failures are recorded separately (`error_category`). An incident opens after N consecutive failures (default 3, per monitor); one success resets the count.
* **Latency detection:** N consecutive *successful* responses slower than the threshold (default 3). Distinct from availability.
* **Recovery:** availability resolves after M consecutive successful checks, latency after M consecutive within-threshold checks (default M=2). Evidence and history are preserved after resolution.
* **Incident detail:** type, status, monitor, trigger rule + threshold, triggering checks (status / latency / timestamp / error category), recovery checks, facts vs. hypotheses, investigation checklist, timeline.
* **Dashboard:** active/healthy/degraded/unavailable monitors, open incidents, failures, average / p95 latency, uptime estimate, latency chart, recent incidents, recent checks, slowest endpoints. All numbers are SQL aggregates over persisted rows.
* **Simulation Lab:** healthy → slow → latency recovery → failing → recovery, plus a one-click full walkthrough and reset.
* **Theme:** sun/moon toggle in the header, instant, persisted in `localStorage`, falls back to the OS preference, covers every page, chart tooltips, dialogs and toasts.
* **Optional AI assistant** (off by default) behind a provider adapter; receives sanitised evidence only.
* Security: SSRF protection (create-time and run-time), per-user data scoping, rate limits, header values never returned by the API.

**Not implemented / out of scope:** multi-instance scheduling, notification channels other than the inherited e-mail alert, a mobile layout polish beyond responsive basics, token revocation, billing (inherited code is disabled).

## Technology stack

TypeScript everywhere · Next.js 14 (App Router) + Tailwind + Recharts · Express 4 · PostgreSQL 16 · Prisma 5 (schema + migrations) with plain parameterised SQL for the engine and analytics · Zod validation · Jest + Supertest (tests) · Node.js ≥ 22.

## Architecture

```mermaid
flowchart LR
  UI[Next.js UI] -->|REST /api/v1| API[Express API]
  API --> SVC[Services: monitors, incidents, dashboard, simulation, AI]
  SVC --> CORE
  W[Worker: scheduler] --> CORE
  subgraph CORE[@pulseops/core]
    EXE[Hardened executor + SSRF policy]
    ENG[Incident engine: state machine]
    EXP[Explanation + timeline builder]
    SIM[Simulation fixtures]
  end
  EXE -->|outbound HTTP, validated| T[(Monitored APIs)]
  ENG -->|one transaction per observation| PG[(PostgreSQL)]
  SVC --> PG
  API -.optional.-> AI[AI provider adapter]
```

Request flow of one check: scheduler (or `POST /monitors/:id/check`) → executor performs the request after SSRF validation → `recordObservation()` opens a transaction, **locks the monitor row** (`SELECT … FOR UPDATE`), inserts the check, updates the four counters, opens/continues/resolves incidents and writes evidence → commit.

Repository layout: `core/` shared engine · `backend/` REST API · `worker/` scheduler · `frontend/` UI · `backend/prisma/` schema + migrations · `docs/` documentation.

## Incident state machine

```mermaid
stateDiagram-v2
  [*] --> Healthy
  Healthy --> Open: bad streak ≥ threshold
  Open --> Open: more bad checks (evidence: CONTINUING, capped at 50)
  Open --> Resolved: good streak ≥ recovery count
  Resolved --> [*]
```

| | AVAILABILITY | LATENCY |
|---|---|---|
| "bad" check | failed (non-2xx / wrong status / keyword missing / timeout / network / TLS) | **successful** response slower than `latency_threshold_ms` |
| opens when | `failure_threshold` consecutive bad checks | `latency_breach_threshold` consecutive bad checks |
| streak reset by | any successful check | any check that is not slow (including a failure) |
| resolves when | `recovery_threshold` consecutive **successful** checks | `recovery_threshold` consecutive successful checks **within** the threshold |

A 200 response is not automatically "successful": with `expected_status` or `expected_keyword` configured, a mismatch is a failure. Both incident types can be open at once. `started_at` is the time of the *first triggering check*; `opened_at` / `resolved_at` are when PulseOps *changed state*.

## Database schema

```mermaid
erDiagram
  users ||--o{ monitors : owns
  monitors ||--o{ checks : has
  monitors ||--o{ incidents : has
  incidents ||--o{ incident_evidence : cites
  checks ||--o{ incident_evidence : "cited by"
  incidents ||--o{ incident_events : logs
  monitors { text id PK  text user_id FK  int latency_threshold_ms  int failure_threshold  int consecutive_failures  bool is_simulated }
  checks { text id PK  text monitor_id FK  int status_code  int response_time  bool success  text observation_type  text error_category  timestamp checked_at }
  incidents { uuid id PK  text monitor_id FK  text type  text status  jsonb trigger_rule  timestamp started_at  timestamp opened_at  timestamp resolved_at }
  incident_evidence { uuid id PK  uuid incident_id FK  text check_id FK  text role }
  incident_events { uuid id PK  uuid incident_id FK  text type  timestamp occurred_at }
```

Key decisions (details in [`docs/INTERVIEW_PREP.md`](docs/INTERVIEW_PREP.md) and [`docs/SQL_EXAMPLES.md`](docs/SQL_EXAMPLES.md)):

* `incidents`, `incident_evidence`, `incident_events` use UUID primary keys. The inherited `users` / `monitors` / `checks` tables keep text ids (new rows get UUID strings) so existing data and foreign keys keep working.
* **`UNIQUE (monitor_id, type) WHERE status = 'OPEN'`** makes a duplicate open incident impossible at the database level.
* CHECK constraints on thresholds, statuses, types, lifecycle (`resolved_at` ⇔ `RESOLVED`), observation type and error category.
* `idx_checks_monitor_checked_at (monitor_id, checked_at DESC)` for history queries; indexes for open / recent incidents.
* Evidence foreign key is `NO ACTION … DEFERRABLE INITIALLY DEFERRED`, and retention cleanup skips checks cited as evidence, so incident history survives.
* Deviation from the brief: `checks.response_time` stays `NOT NULL` (it holds elapsed milliseconds even for failures; the inherited column); latency statistics therefore only use rows where `success = true`.

## Prerequisites

* **Node.js 22 LTS** (https://nodejs.org) — includes npm.
* **PostgreSQL 14+** (16 recommended) — https://www.postgresql.org/download/windows/ (EDB installer) *or* Docker Desktop (`docker-compose.db.yml`).

No other service, account or API key is required.

## Windows setup (PowerShell)

```powershell
# 1. Create the database (psql.exe is in "C:\Program Files\PostgreSQL\16\bin"; add it to PATH or use the full path)
psql -U postgres -h localhost
#    then, inside psql (choose your own password):
#    CREATE USER pulseops WITH PASSWORD 'choose-a-password';
#    CREATE DATABASE pulseops OWNER pulseops;
#    \q

# 2. Install dependencies (from the project folder)
npm install

# 3. Create .env with a random JWT_SECRET, then edit DATABASE_URL in it (use your password)
npm run setup:env
notepad .env

# 4. Generate the Prisma client and apply the migrations
npm run db:generate
npm run db:deploy

# 5. Start everything (core build + API :3001 + worker + UI :3000)
npm run dev
```

Open http://localhost:3000, create an account, and either add a monitor or open **Simulation Lab** and run **Full walkthrough** for an instant demo. Docker alternative for step 1: `docker compose -f docker-compose.db.yml up -d` and use `postgresql://pulseops:pulseops_dev@localhost:5432/pulseops`.

Notes: `npm run dev` rebuilds `core` first. If you edit files in `core/`, restart it (or run `npm run dev:core` in a second terminal).

## Environment variables

See [`.env.example`](.env.example) (the file you copy). Essentials:

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | **Required.** PostgreSQL connection string. |
| `JWT_SECRET` | **Required**, ≥ 64 chars. `npm run setup:env` generates one. |
| `AUTH_MODE` | `local` (built-in accounts, recommended) or `supabase` (original). |
| `NEXT_PUBLIC_API_URL` | Where the browser finds the API (default `http://localhost:3001`). |
| `SCHEDULER_TICK_SECONDS`, `MAX_CONCURRENT_CHECKS`, `CLEANUP_DAYS` | Worker tuning. |
| `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | Optional AI assistant. |

Never commit `.env`; it is git-ignored and excluded from the distributable ZIP.

## Tests

```powershell
npm test            # core (227) + backend (93) + worker (7); needs DATABASE_URL in .env and migrated DB
npm run typecheck
npm run lint
npm run build
```

Tests use a real PostgreSQL database (the one in `DATABASE_URL`); each test creates its own random user/monitors and deletes them afterwards. Prefer a throw-away database such as `pulseops_test`: `CREATE DATABASE pulseops_test OWNER pulseops;`, then set `TEST_DATABASE_URL` and run the migrations against it. No test calls a public website; HTTP behaviour is tested with controlled fixtures and unresolvable `.invalid` hostnames.

What the suites cover: configuration validation, executor outcomes (success / HTTP error / timeout / network), SSRF policy, availability and latency incident opening, counter resets, duplicate prevention (including 12 concurrent writers and the database index itself), recovery and resolution, evidence retention, real-vs-simulated separation, dashboard aggregation (exact average, p95, uptime), scheduler behaviour (no overlap, concurrency bound, isolation, shutdown), local authentication.

## REST API

Base URL `http://localhost:3001/api/v1` (the original `/api/v1` prefix is kept). Authenticated routes need `Authorization: Bearer <access_token>`. Errors are JSON: `{ "error": "message", "details"?: [...] }`.

| Method & path | Purpose |
|---|---|
| `GET /health` (also `/api/health`) | Liveness + DB check (public) |
| `POST /auth/signup`, `POST /auth/signin`, `GET /auth/me`, `POST /auth/refresh`, `POST /auth/signout` | Local auth |
| `POST /monitors` | Create (201) |
| `GET /monitors?mode=real\|simulated&page&limit&search` | List, paginated (limit ≤ 100) |
| `GET /monitors/:id?window=1h\|24h\|7d\|30d` | Detail + stats + latency series + incidents |
| `PATCH /monitors/:id` | Partial update |
| `DELETE /monitors/:id` | Delete (204) |
| `POST /monitors/:id/pause`, `/resume` | Pause / resume |
| `POST /monitors/:id/check` | Manual check (rate-limited; refused for simulated monitors) |
| `GET /monitors/:id/results?page&limit` | Check history |
| `GET /monitors/:id/incidents` | Incidents of one monitor |
| `GET /dashboard/summary?mode&window` | Dashboard aggregates |
| `GET /incidents?status&type&mode&page&limit` | List |
| `GET /incidents/:id` | Incident + explanation + timeline |
| `POST /incidents/:id/ai-summary` | Optional AI checklist (503 when not configured) |
| `GET /simulation/scenarios`, `POST /simulation/run`, `POST /simulation/reset` | Demo mode (no URL parameter exists) |
| `GET /meta` | Non-sensitive settings info |

```powershell
$base = "http://localhost:3001/api/v1"
$s = Invoke-RestMethod -Method Post "$base/auth/signin" -ContentType application/json -Body '{"email":"you@example.com","password":"your-password"}'
$h = @{ Authorization = "Bearer $($s.session.access_token)" }

Invoke-RestMethod -Method Post "$base/monitors" -Headers $h -ContentType application/json -Body '{
  "name":"Orders API","url":"https://api.example.com/health",
  "interval":60,"timeout":10,"latencyThresholdMs":800,"failureThreshold":3}'

Invoke-RestMethod "$base/incidents?status=OPEN" -Headers $h
Invoke-RestMethod "$base/dashboard/summary?window=24h" -Headers $h
```

Create-monitor body fields: `name`, `url`, `method` (GET default), `interval` (30–3600 s), `timeout` (1–120 s), `latencyThresholdMs` (50–600000, must be < timeout), `failureThreshold`, `latencyBreachThreshold`, `recoveryThreshold` (1–20 each), optional `expectedStatus`, `expectedKeyword`, `headers`, `body`. Unknown fields are rejected.

## How the metrics are calculated

Window = last 1 h / 24 h / 7 d / 30 d from the time of the request. **Average / p95 / max latency** use successful checks only (`percentile_cont(0.95)`). **Uptime** = successful checks ÷ all checks in the window — an *estimate from sampling*; it cannot see outages between checks and is not an availability guarantee. **Monitor health:** unavailable = open availability incident, degraded = open latency incident, otherwise healthy (or "no data yet"). Real and simulated observations are never combined.

## Security considerations

* **SSRF:** http/https only; no embedded credentials; localhost/loopback/private/link-local/reserved/cloud-metadata addresses rejected; DNS results validated and pinned at connect time; every redirect re-validated; response size and duration capped. Monitor creation also rejects obviously internal hostnames (`localhost`, `*.internal`, `*.local`, `metadata.google.internal`). Covered by the inherited suite (moved to `core/`).
* The demo uses an isolated simulator, **not** a relaxed SSRF policy; the simulation API accepts no URL.
* Per-user scoping on every query; unknown request fields rejected (no mass assignment of `is_simulated` or counters).
* Header values are write-only: the API returns header names only. Error text stored from checks is truncated and stripped of control characters.
* Passwords: scrypt with per-user salt; login errors are identical for unknown user / wrong password. JWT: HS256, only `access` tokens authenticate API calls, `alg: none` refused.
* Rate limits on the API, on auth routes and on manual checks. CORS limited to `FRONTEND_URL`. Secrets only via environment variables.
* AI: only sanitised evidence (no URL/host/headers/error text/ids) is sent, and only when configured.

## Limitations and production improvements

* **Single worker instance.** The scheduler is in-process; two workers would double-check monitors (incident state stays correct because of the row lock, checks would just be duplicated). Scaling out: lease due monitors with `FOR UPDATE SKIP LOCKED` or a queue.
* `checks` is one table; for very large histories use time-partitioning, rollup tables for charts, and retention policies (a daily cleanup exists; evidence-linked rows are kept).
* Stateless JWTs: no server-side revocation. No e-mail verification / password reset in local mode.
* Latency is measured from a single vantage point (the PulseOps server).
* Notifications are limited to the inherited e-mail alert (off by default).
* Docker/Render deployment files are inherited; the `Dockerfile` was updated to build `core`, but **the container build was not run**.

## Verification status (honest summary)

See the final report in the delivery message and [`docs/VERIFICATION.md`](docs/VERIFICATION.md) for exactly what was run and what remains for you to run on Windows.

## License

MIT. Original © 2026 Darshan Kachare; PulseOps modifications are released under the same license. See [`LICENSE`](LICENSE) and [`NOTICE.md`](NOTICE.md).
