# Architecture

How API Monitor SaaS actually works today.

**This document describes only what is implemented in this repository.** Anything not built
is listed in [ROADMAP.md](ROADMAP.md) and must not be presented as existing here.

Last verified against commit `v3.5.0-community`.

---

## 1. System overview

```
┌────────────────────────────────────────────────────────────────────┐
│                         BROWSER                                   │
│                                                                    │
│   Next.js 14 dashboard (App Router) — frontend/src/app              │
│   • login / signup                                                 │
│   • monitors list, create wizard, detail                           │
│   • analytics overview + per-monitor charts                        │
│   • alerts list                                                     │
│   • billing page                                                    │
│   • settings, team, workspaces  ← placeholder pages, no backend   │
│   • public status page  /status/[slug]                             │
└───────────────────────────┬────────────────────────────────────────┘
                            │ HTTPS, Bearer JWT
                            ▼
┌────────────────────────────────────────────────────────────────────┐
│                     API  (Express, port 3001)                       │
│   backend/src                                                      │
│   • helmet, CORS allowlist, morgan, express-rate-limit             │
│   • GET /health — DB + Redis reachability                          │
│   • /api/v1/auth        Supabase-backed session lifecycle         │
│   • /api/v1/monitors    CRUD, pause/resume, check history         │
│   • /api/v1/analytics   overview, uptime, response time           │
│   • /api/v1/alerts      list, stats, acknowledge                   │
│   • /api/v1/status-pages  CRUD + unauthenticated public/:slug     │
│   • /api/v1/billing     plans, subscription, checkout, portal,    │
│                         webhook (raw-body signature verified)     │
└───────────┬───────────────────────────────────┬────────────────────┘
            │ Prisma                            │
            ▼                                   ▼
┌────────────────────────┐        ┌──────────────────────────────────┐
│  PostgreSQL 16         │        │  Redis 7                         │
│  7 models              │        │  Provisioned for the queue work  │
│  (backend/prisma)      │        │  tracked in ROADMAP.md.           │
│                        │        │  Not read by any code path yet.   │
└───────────▲────────────┘        └──────────────────────────────────┘
            │
            │ Prisma
┌───────────┴────────────────────────────────────────────────────────┐
│                   WORKER  (Node, port 3002)                        │
│   worker/src                                                       │
│   • setInterval — check cycle, min 30s (CHECK_INTERVAL_SECONDS)    │
│   • node-cron  — daily 03:00 retention sweep (CLEANUP_DAYS = 90)   │
│   • fetches active, non-paused monitors in batches of 10           │
│   • in-process Map holds last status per monitor to diff state     │
│   • on change: writes Alert row, sends Resend email, resolves      │
│     sibling triggered alerts                                       │
└────────────────────────────────────────────────────────────────────┘
```

### Reverse proxy (optional)

`nginx/nginx.conf` is provided as a reference config for TLS termination and proxying to the
API and frontend. It is not required to run locally and is not started by
`docker-compose.yml`.

---

## 2. Technology stack

Versions are the resolved versions in the lockfiles, not aspirational ones.

### Runtime and infrastructure

| Component | Technology | Version | Role |
|---|---|---|---|
| Runtime | Node.js | 22 (`.nvmrc`) | Application runtime |
| Orchestration | Docker Compose | — | Local and single-host deployment |
| Reverse proxy | NGINX | — | Optional TLS termination, `nginx/nginx.conf` |
| Database | PostgreSQL | 16-alpine | Primary datastore |
| Cache/queue | Redis | 7-alpine | Provisioned; queue integration pending |

There is no Docker Swarm, Kubernetes, or Kafka orchestration in this repository. Single-host
Docker Compose is the supported deployment topology.

### Backend

| Component | Technology | Version | Role |
|---|---|---|---|
| Framework | Express | 4.22.2 | HTTP server and routing |
| ORM | Prisma | 5.22.0 | Query builder and migrations |
| Validation | Zod | 3.25.76 | Environment and request validation |
| Auth | `@supabase/supabase-js` | 2.108.0 | Signup, signin, token verification |
| Security | helmet, cors, express-rate-limit | 7.2.0 / 2.8.6 / 7.5.1 | Hardening and throttling |
| Logging | morgan, winston | 1.11.0 / 3.19.0 | Request and structured logs |
| Payments | stripe | 14.25.0 | Checkout, portal, webhooks |
| Email | resend | 2.1.0 | Alert delivery |
| Auth hashing | bcryptjs | 2.4.3 | Password hashing helper |

### Worker

| Component | Technology | Version | Role |
|---|---|---|---|
| Scheduling | node-cron | 3.0.3 | Daily retention sweep |
| Scheduling | `setInterval` | — | Check cycle |
| HTTP | axios | 1.17.0 | Outbound probe requests |
| Alerts | resend | 2.1.0 | Email notification |

### Frontend

| Component | Technology | Version | Role |
|---|---|---|---|
| Framework | Next.js | 14.2.35 | App Router, React 18 |
| Styling | Tailwind CSS | 3.4.19 | Utility-first styling |
| Components | Radix UI primitives | 1.x | Accessible headless components |
| Charts | Recharts | 2.15.4 | Latency and uptime visualization |
| Client state | Zustand | 4.5.7 | Client-side state |
| Icons | lucide-react | 0.294.0 | Icon set |

### Not present

Prometheus, Grafana, Loki, Alertmanager, PM2, and object storage are **not** part of this
repository. Health is exposed through `GET /health` and structured Winston logs only.

---

## 3. Data model

Seven models in `backend/prisma/schema.prisma`, with a committed SQL migration at
`backend/prisma/migrations/20260101000000_init/migration.sql`.

```
User (id, email, …)
  ├─1:N─ Monitor
  ├─1:N─ Alert
  ├─1:N─ StatusPage
  └─1:1─ Subscription

Monitor (id, userId, url, method, headers, body, interval, timeout,
         expectedStatus, expectedKeyword, region, isActive, isPaused)
  ├─1:N─ Check
  ├─1:N─ Alert
  └─1:N─ StatusPageItem

Check       (id, monitorId, status, statusCode, responseTime, error, region, checkedAt)
Alert       (id, monitorId, userId, type, status, message, details, triggeredAt, resolvedAt)
Subscription(id, userId, stripeCustomerId, stripeSubscriptionId, plan, status, …)
StatusPage  (id, userId, name, slug, …)
  └─1:N─ StatusPageItem (statusPageId, monitorId)
```

### Tenancy model

Every model is scoped to a single `userId`, and authorization is enforced in the Express
route handlers by comparing the authenticated user against the record owner.

**Row Level Security is not enabled.** The `supabase/migrations/` files manage the Supabase
auth schema only and contain no `CREATE POLICY` or `ENABLE ROW LEVEL SECURITY` statements.
Do not rely on database-level isolation; the application layer is the only enforcement point.

Teams, workspaces, and membership tables do not exist yet. The `team` and `workspaces`
frontend routes are placeholder pages.

---

## 4. HTTP API

Base path `/api/v1`. All routes except the public status page and the Stripe webhook require a
valid Supabase access token as `Authorization: Bearer <token>`.

### Auth — `backend/src/routes/auth.ts`

Mounted only when the bundled Supabase provider is in use. See
[Replacing the identity system](#replacing-the-identity-system).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/signup` | no | Create credentials, provisions local `User` |
| POST | `/auth/signin` | no | Exchange credentials for tokens |
| POST | `/auth/signout` | no | Invalidate session |
| GET | `/auth/me` | yes | Current user profile |
| POST | `/auth/refresh` | no | Rotate access token |
| POST | `/auth/reset-password` | no | Send reset email |
| POST | `/auth/update-password` | no | Complete reset |

### Monitors — `backend/src/routes/monitors.ts`

| Method | Path | Purpose |
|---|---|---|
| GET | `/monitors` | List with aggregate stats |
| GET | `/monitors/:id` | Detail with recent checks |
| POST | `/monitors` | Create |
| PATCH | `/monitors/:id` | Update |
| DELETE | `/monitors/:id` | Delete with cascade |
| POST | `/monitors/:id/pause` | Stop checking |
| POST | `/monitors/:id/resume` | Resume checking |
| GET | `/monitors/:id/checks` | Paginated check history |

### Analytics — `backend/src/routes/analytics.ts`

| Method | Path | Purpose |
|---|---|---|
| GET | `/analytics/overview` | Dashboard rollup |
| GET | `/analytics/uptime/:monitorId` | Uptime percentage over a window |
| GET | `/analytics/response-time/:monitorId` | Latency series |

### Alerts — `backend/src/routes/alerts.ts`

| Method | Path | Purpose |
|---|---|---|
| GET | `/alerts` | Alert history |
| GET | `/alerts/stats` | Counts by status |
| PATCH | `/alerts/:id/acknowledge` | Acknowledge |

### Status pages — `backend/src/routes/statusPages.ts`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/status-pages` | yes | List own pages |
| POST | `/status-pages` | yes | Create page |
| PATCH | `/status-pages/:id` | yes | Update page |
| DELETE | `/status-pages/:id` | yes | Delete page |
| GET | `/status-pages/public/:slug` | **no** | Public, unauthenticated read |

The public route is the only intentional unauthenticated data endpoint. The management UI for
status pages is not built.

### Billing — `backend/src/routes/billing.ts`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/billing/plans` | no | Plan catalogue |
| GET | `/billing/subscription` | yes | Current subscription |
| POST | `/billing/checkout` | yes | Create Stripe Checkout session |
| POST | `/billing/portal` | yes | Stripe billing portal session |
| POST | `/billing/webhook` | signature | Stripe events, raw-body verified |

Billing is implemented server-side only. The frontend billing page does not yet complete the
checkout flow, and entitlements are not enforced on the API — plan limits are advisory.

### Health

`GET /health` returns database and Redis reachability. It is exempt from rate limiting.

---

## 5. Security model

### Authentication flow

```
Browser → POST /api/v1/auth/signin
        → Supabase Auth verifies credentials
        → access + refresh tokens returned to client
        → client sends Authorization: Bearer <access_token>
        → backend authMiddleware calls Supabase auth.getUser(token)
        → request proceeds only if the token is valid
```

Tokens are issued and validated by Supabase. A local `User` row is provisioned on signup and
used for data ownership. Passwords never reach application code — `bcryptjs` is retained as a
dependency for the self-hosted auth work tracked in `ROADMAP.md`.

### Replacing the identity system

`authMiddleware` does not talk to Supabase directly. It asks whichever `AuthProvider` the
resolver in `backend/src/auth/index.ts` selects, and the default answer is the bundled
Supabase provider. The interface is one method — `verifyToken(token)` — because that is the
only thing the core needs from an identity system.

```ts
interface AuthProvider {
  readonly name: string;
  verifyToken(token: string): Promise<AuthenticatedUser | null>;
}
```

Set `AUTH_PROVIDER_MODULE` to the module id of an implementation to authenticate against
something else. Resolution is lazy: the Supabase client is constructed only when the bundled
provider is the one selected, so a deployment using another identity system needs no Supabase
configuration and never loads `config/supabase` or the Supabase `/api/v1/auth` routes.

Two things deliberately stay in the core regardless of provider:

- **The account check.** The core still looks the user up in its own database and rejects
  unknown, disabled, or missing accounts, so an identity system cannot authenticate someone
  this installation has disabled.
- **The error shape.** Every credential failure is a single 401. A provider cannot leak
  whether a token existed, was expired, or was revoked, because the core collapses the
  distinctions.

Whatever module is named owns the entire auth surface, including sign-in, sign-out, and
session lifetime. The core ships no fallback routes for it.

**This seam covers the API, not the dashboard.** The bundled frontend in `frontend/` is
written against the Supabase SDK and its sign-in, sign-out and token-refresh calls are not
pluggable, so a deployment using another identity system supplies its own front end and
points `NEXT_PUBLIC_API_URL` at the core. That is the honest boundary: the monitoring core
becomes identity-agnostic, and the shipped dashboard does not follow it automatically.

### Authorization

Authorization is **owner-scoped, not role-based.** Each handler compares the record's `userId`
to the authenticated user and returns 404 or 403 on mismatch. There are no roles, permissions,
or membership tables.

Plan limits (monitor count, check interval) are read from the subscription and applied in the
monitors route. They are not a security boundary — no entitlement enforcement exists.

### Transport and input hardening

| Control | Implementation |
|---|---|
| Security headers | `helmet` with explicit CSP and HSTS configuration |
| CORS | Explicit origin allowlist, not a wildcard |
| Rate limiting | Global limiter plus a stricter limiter on `/api` |
| SQL injection | Prisma parameterizes all queries; no raw SQL in application code |
| Input validation | Zod schemas on environment and request payloads |
| Webhook integrity | Stripe signature verified against the raw request body |
| Secrets | `.env` is gitignored; `.env.example` contains placeholders only |
| Logging | Winston with redaction; morgan request logging |

#### Outbound request policy

The worker is the only component that fetches user-supplied URLs, and it does so through a
single path: `services/executor.ts` → `security/ssrf-policy.ts`. There is no second fetch
path in the repository.

| Module | Responsibility |
|---|---|
| `security/ip-policy.ts` | Classify one resolved address against the IANA special-purpose registries. Pure — no DNS, no HTTP. IPv4-embedding prefixes (v4-mapped, NAT64, 6to4, Teredo) are judged by the address they carry, not blocked wholesale |
| `security/ssrf-policy.ts` | Parse the URL, enforce the `http`/`https` allowlist, reject embedded credentials, resolve the name, and supply the connect-time guard |
| `services/executor.ts` | Perform the request with `maxRedirects: 0` and walk redirects itself, re-validating every hop |

Two details are load-bearing:

**The guard lives on the socket, not in front of it.** `maxRedirects: 0` selects Node's
native `http`/`https` transport instead of `follow-redirects`, and the agents carry a custom
`lookup` that classifies the address it is about to return. The address validated is therefore
the address dialled, so a name cannot answer `93.184.216.34` for the check and `127.0.0.1` for
the connection.

**Refusals do not trust the error object.** A block raised inside a socket connect can be
replaced by the HTTP client, which would both mask the refusal and let the internal address
reach the user. The guard reports the refusal through a per-request callback instead, and the
executor substitutes one uniform message: `Monitor target resolves to a restricted network
destination.`

Covered by 149 tests in `worker/src`; see `SECURITY.md` for the range tables, the redirect
policy, and the residual risks.

## Known gaps

These are real and are tracked in `ROADMAP.md`:

- **No RBAC.** Single-owner tenancy only.
- **SSRF residual risk.** The destination policy is in place and covered by tests, but DNS
  is still resolved before use, the range table is a denylist rather than an allowlist, and
  a rebind on a redirect hop is argued rather than tested. See `SECURITY.md`.
- **No audit log.** Security-relevant actions are not recorded.
- **Row Level Security is not enabled** on PostgreSQL.
- **Worker state is in-memory.** Last-known status lives in a `Map` and is lost on restart; it
  is rehydrated from the most recent `Check` rows at boot.

---

## 6. Worker and check execution

### Scheduling

```ts
// worker/src/index.ts
const intervalSeconds = Math.max(CHECK_INTERVAL, 30);  // floor of 30s
setInterval(runChecks, intervalSeconds * 1000);
cron.schedule('0 3 * * *', cleanupOldChecks);          // CLEANUP_DAYS, default 90
```

`setInterval` is used rather than cron for the check cycle because sub-minute intervals are
required and `node-cron` cannot express them portably.

### Check cycle

```
1. SELECT all Monitor where isActive = true AND isPaused = false
2. Filter by per-monitor interval using the in-memory last-check timestamp
3. Process in batches of 10, monitors within a batch in parallel via Promise.all
4. Per monitor:
     a. executeCheck(url, method, headers, body, timeout, expectedStatus, expectedKeyword)
     b. INSERT Check { status, statusCode, responseTime, error, region }
     c. Diff current status against last known status
     d. On transition:
          - INSERT Alert { type: 'email', status: triggered|resolved }
          - send Resend email to the monitor owner
          - if recovered, mark sibling triggered alerts resolved with resolvedAt
5. Log cycle completion
```

Probe outcomes are `up`, `down`, or `degraded`, where degraded covers slow or partial
responses. A monitor counts as up when the status code matches `expectedStatus` and, if
`expectedKeyword` is set, the response body contains that string.

### Response body consumption

The body is requested as a stream and consumed under a running byte count
(`worker/src/config/response-limit.ts`, 1 MiB by default). It is read **only** when the
monitor has an `expectedKeyword` — a status-only check, which is the common case, never
reads a body at all, and the redirect and failed-status paths destroy the stream unread.
An oversized response aborts the transfer rather than being measured afterwards, and the
limit is applied to the inflated stream so a small compressed payload cannot expand past
it. The check then records `down` with a fixed message that carries no address, byte count
or response content; the detail goes to the worker log. See `SECURITY.md`.

### Graceful shutdown

`SIGTERM` and `SIGINT` both disconnect Prisma and exit 0. In-flight checks are not awaited to
completion; because results are written per monitor, at most one batch is lost on shutdown.

### Scaling characteristics

This design has known limits worth stating plainly:

- The interval filter is per-process, so **running more than one worker replica causes
  duplicate checks**. The system is designed for exactly one worker instance.
- There is no job queue. A probe that hangs is bounded only by its configured `timeout`.
- No retry, backoff, or dead-letter handling exists. A failed probe is recorded as a failed
  probe, not retried.
- `Promise.all` per batch means one slow monitor delays its whole batch up to its timeout.

Redis-backed queues with retry, backoff, dead-letter handling, and multi-replica safety are the
first item in `ROADMAP.md`.

---

## 7. Deployment

### Local development

```bash
cp .env.example .env
docker compose up -d
```

A one-shot `migrate` service applies the Prisma schema and exits 0; the API and
worker wait for it via `depends_on: condition: service_completed_successfully`, so
no manual migration step is required. Confirm with:

```bash
curl -s localhost:3001/health
# {"status":"healthy","database":"connected",...}
```

The frontend and API require a reachable Supabase project for auth. This is the
main obstacle to a fully offline startup; self-hosted auth is tracked in
`ROADMAP.md` (P2) and designed in `docs/AUTH_DESIGN.md`.

### Container topology

| Service | Image | Port | Notes |
|---|---|---|---|
| `postgres` | postgres:16-alpine | 5432 (published as 5434) | Named volume `postgres_data` |
| `redis` | redis:7-alpine | 6379 | Provisioned, not yet consumed by any code path |
| `migrate` | backend `development` target | — | Runs `prisma migrate deploy`, then exits 0 |
| `backend` | backend `development` target | 3001 | Depends on postgres, redis, migrate |
| `worker` | worker `development` target | 3002 | Single replica only, see below |
| `frontend` | frontend `development` target | 3000 | Next.js dev server with hot reload |

Each Dockerfile has a `development` target retaining devDependencies and a
production target that is the default when no `--target` is given. The
development targets exist because the compose file runs `ts-node-dev` and
`next dev`; invoking those against a production image built with `--omit=dev`
makes `npx` fetch a toolchain that does not match the installed TypeScript.

Backend and worker use `node:22-slim` with `openssl` installed. The Prisma query
engine links against the system OpenSSL at runtime, and Prisma's platform
detection reads the `openssl` binary to choose which engine to build. The
`node:*-slim` base image ships neither, so without it `prisma generate` silently
falls back to the OpenSSL 1.1.x engine and the service cannot start.

`.dockerignore` files exist at the repository root and in `backend/` and
`frontend/`. They exclude `.env` and `node_modules` from the build context.
Without them, `COPY . .` copies the host working tree into the image, which both
overwrites the image's Prisma client with a host-platform one and bakes real
credentials — database password, Supabase service-role key, Stripe and Resend
secrets — into an image layer.

The worker must run as exactly one replica. Its last-check timestamps live in
process memory, so additional replicas issue duplicate probes and duplicate
alerts. `docker-compose.prod.yml` pins `replicas: 1` for this reason.

`docker-compose.prod.yml` and `render.yaml` provide production variants with
NGINX for TLS termination. Full instructions in `docs/DEPLOYMENT.md`.

### Database addressing

Two variables exist because one URL cannot serve both cases:

| Variable | Used by | Points at |
|---|---|---|
| `DATABASE_URL` | Host tooling — `npm run db:migrate`, Prisma CLI | `localhost:5434` |
| `DATABASE_URL_DOCKER` | Backend and worker containers | `postgres:5432` |

`localhost` does not resolve inside the compose network. `DATABASE_URL_DOCKER`
defaults to the bundled database and can be set to target an external instance.

### Operational scripts

| Script | Purpose |
|---|---|
| `scripts/setup-ubuntu.sh` | Host preparation |
| `scripts/deploy.sh` | Pull, build, migrate, restart |
| `scripts/backup.sh` | `pg_dump` backup |
| `scripts/validate-env.js` | Fail-fast environment validation |
| `scripts/audit-licenses.js` | Regenerate or verify `docs/THIRD_PARTY_LICENSES.md` |
| `docker/start-combined.sh` | Local combined startup |

### Backup and recovery

`scripts/backup.sh` performs `pg_dump`. There is no automated restore procedure, no
point-in-time recovery, and no replication configuration in this repository. Recovery
objectives are not established. Restoring is manual — see `docs/DEPLOYMENT.md`.

---

## 8. CI

`.github/workflows/ci.yml` runs on pushes to `main`, `develop`, `release/**`, `feature/**`,
`hotfix/**`, and on pull requests targeting `main`, `develop`, `release/**`.

| Job | What it verifies |
|---|---|
| `backend` | `npm ci`, Prisma generate, migrate against a real postgres:16 service, build, lint, typecheck, test |
| `frontend` | `npm ci`, Next.js production build, lint, typecheck |
| `worker` | `npm ci`, build, lint, typecheck |
| `docker` | Builds all three images with no push |
| `summary` | Aggregates pass/fail |

`.github/workflows/deploy.yml` handles deployment and `keep-alive.yml` pings the hosted
demo.

### Test coverage

Two test files exist, both in the backend:

- `backend/src/middleware/error.test.ts`
- `backend/src/routes/monitors.test.ts`

The worker and frontend have no automated tests. There are no end-to-end tests and no
benchmark suite. The test command runs with `--passWithNoTests` in CI, so an empty suite
passes silently. Expanding coverage is a release blocker for any commercial listing.

---

## 9. Repository conventions

### Layout

```
backend/    Express API, Prisma schema and migrations
worker/     Monitoring scheduler and probe executor
frontend/   Next.js dashboard and public status page
supabase/   Supabase auth schema migrations
nginx/      Reference reverse proxy config
scripts/    Setup, deploy, backup, license audit
docs/       Reference documentation, see docs/README.md
```

### Branching

`main` is the default branch and carries releases. `develop` is the integration branch.
Feature work uses `feature/*`, releases use `release/vX.Y`, and urgent fixes use `hotfix/*`.
Release tags in history: `v1.0.0`, `v1.1.0`, `v1.2.0`, `v2.0.0`, `v2.0.1-stable`, `v3.0.0`,
`v3.5.0`.

### Commit convention

`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `perf:`, `build:`, `ci:`.

### Documentation rule

Implemented behavior belongs in this file. Planned behavior belongs in `ROADMAP.md`. The
`README.md` feature matrix follows the same rule and is the customer-facing view of it.
