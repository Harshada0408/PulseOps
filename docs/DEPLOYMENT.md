# Deployment

How to run API Monitor SaaS outside local development.

- [Local development](#local-development)
- [Production, single host](#production-single-host)
- [Managed platform, combined container](#managed-platform-combined-container)
- [Updating a deployment](#updating-a-deployment)
- [Backup and restore](#backup-and-restore)
- [Troubleshooting](#troubleshooting)
- [Known production limitations](#known-production-limitations)

---

## Local development

The stack comes up on its own. A one-shot `migrate` service applies the Prisma
schema before the API and worker start, so there is no manual migration step.

```bash
cp .env.example .env
# Required: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
docker compose up -d
```

Verify:

```bash
curl -s localhost:3001/health
# {"status":"healthy","database":"connected","environment":"development",...}
```

| Service | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| API | http://localhost:3001 |
| Health | http://localhost:3001/health |

The `migrate` container exits 0 once the schema is applied. That is expected:

```bash
docker compose ps          # migrate shows "Exited (0)"
docker compose logs migrate
```

Behind a mirror or proxy, pass the registry at build time:

```bash
docker compose build --build-arg NPM_REGISTRY=https://registry.example.com
```

Running services outside Docker instead:

```bash
npm install
npm run db:migrate
npm run db:generate
npm run dev
```

---

## Production, single host

`docker-compose.prod.yml` adds NGINX for TLS termination and restart policies.
It expects certificates already present at `nginx/ssl/`.

### 1. Host preparation

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # log out and back in
```

### 2. Clone and configure

```bash
git clone https://github.com/dsk-dev-ai/api-monitor-saas.git
cd api-monitor-saas
cp .env.example .env
```

Set at minimum:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Production PostgreSQL. This one URL serves the host tooling and the containers here, so no `DATABASE_URL_DOCKER` is needed. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Authentication |
| `JWT_SECRET` | `openssl rand -base64 48` |
| `FRONTEND_URL` | Public frontend origin, used for CORS |
| `NEXT_PUBLIC_API_URL` | Public API base URL including `/api/v1` |

Optional, feature-gated: `STRIPE_*` with `ENABLE_BILLING=true`, `RESEND_API_KEY`
and `FROM_EMAIL` with `ENABLE_EMAILS=true`.

### Using a different identity system

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are required for the
default configuration. If you set `AUTH_PROVIDER_MODULE` instead, the three Supabase values
are not required and the backend does not load the Supabase client at all. The named module
is then responsible for the whole auth surface, including sign-in, sign-out and session
lifetime, and the core's own `/api/v1/auth` routes are not mounted.

The module must be resolvable by the compiled backend (an installed package name, or a path
relative to the backend's working directory) and must export an object with a `name` string
and a `verifyToken(token)` method, as either a default export, a named `authProvider`
export, or `module.exports`. A module that fails to load, or that does not match this shape,
stops the process at startup rather than falling back to Supabase — a silent fallback would
authenticate you against the wrong identity system.

A provider must be a full identity system. The core's middleware verifies the token the
provider issues and will not mint, refresh, or revoke tokens for it.

### 3. TLS certificates

```bash
sudo mkdir -p nginx/ssl
sudo cp /etc/letsencrypt/live/<your-domain>/* nginx/ssl/
```

Then adjust `nginx/nginx.conf` for your domain. The committed config is a
reference and expects certificates at those paths.

### 4. Start

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

Confirm the health endpoint reports a connected database before pointing DNS at
the host.

### Topology

```
                    ┌──────────────┐
   internet ───────▶│    NGINX     │  TLS termination, :80 :443
                    └──────┬───────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
      ┌───────────────┐         ┌───────────────┐
      │   frontend    │         │    backend    │
      │ Next.js       │         │ Express       │
      │ replicas: 2   │         │ replicas: 2   │
      └───────────────┘         └───────┬───────┘
                                       │
                        ┌──────────────┼──────────────┐
                        ▼              ▼              ▼
                 ┌───────────┐  ┌───────────┐  ┌──────────┐
                 │ postgres  │  │   redis   │  │  worker  │
                 │           │  │           │  │ replicas │
                 │           │  │           │  │    = 1   │
                 └───────────┘  └───────────┘  └──────────┘
```

The API and frontend scale horizontally because they are stateless. **The worker
must run as exactly one replica** — see
[known limitations](#known-production-limitations).

---

## Managed platform, combined container

The root `Dockerfile` builds the API and worker into a single image for hosts
that bill per container. `docker/start-combined.sh` runs both processes.

`render.yaml` is a ready import for Render's free tier. The free tier sleeps
after roughly 15 minutes of inactivity, and `.github/workflows/keep-alive.yml`
pings `/health` every 5 minutes to prevent that.

For Vercel or similar, deploy `frontend/` as a standalone Next.js application.
Note that the worker cannot run there — a persistent background process is
required for monitoring to continue.

---

## Updating a deployment

```bash
cd /opt/api-monitor
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

`scripts/deploy.sh` wraps this sequence. Migrations apply automatically via the
`migrate` service, which both application services wait on. Check its exit
status after a release that includes schema changes:

```bash
docker compose -f docker-compose.prod.yml logs migrate
```

---

## Backup and restore

`scripts/backup.sh` runs `pg_dump`. Schedule it with cron or a systemd timer.

```bash
./scripts/backup.sh
```

Restoring is currently manual. There is no automated restore path, no
point-in-time recovery, and no replication configuration in this repository.

```bash
gunzip -c backup.sql.gz | psql "$DATABASE_URL"
```

Test a restore before you need one. An untested backup is not a backup.

---

## Troubleshooting

### `Prisma cannot find the required libssl system library`

The image is missing OpenSSL, which the query engine links against at runtime.
Every backend and worker stage installs it. If you hit this on a custom image,
add:

```dockerfile
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
```

The same error appears if `binaryTargets` in `backend/prisma/schema.prisma` is
pinned to a platform other than the one running. Leave it as `["native"]`.

### `The table public.checks does not exist`

Migrations have not run. Confirm the `migrate` service succeeded:

```bash
docker compose logs migrate
```

Apply them by hand if needed:

```bash
docker compose exec backend npx prisma migrate deploy --schema prisma/schema.prisma
```

### `next: not found` in the frontend

The bind mount at `./frontend:/app` is shadowing the image's `node_modules`. The
anonymous volume on `/app/node_modules` prevents this; removing it reintroduces
the fault.

### Backend reports `database: disconnected`

Almost always `DATABASE_URL` pointing at `localhost`, which does not resolve
inside the compose network. Use the `postgres` service name and port 5432, or
set `DATABASE_URL_DOCKER`.

### Duplicate alerts for a single outage

More than one worker replica is running. Last-check state is per-process, so
every replica probes and alerts independently. Scale the worker to exactly one
until the Redis-backed queue lands.

### Build fails fetching packages

A registry mirror is unreachable. The Dockerfiles default to the public npm
registry and accept an override:

```bash
docker compose build --build-arg NPM_REGISTRY=https://registry.example.com
```

### Worker exits immediately on startup

Check the logs. Common causes are an unreachable database or a missing
`SUPABASE_*` value. In development the worker has `restart: unless-stopped` and
recovers on its own; in production, investigate rather than relying on restarts.

---

## Known production limitations

These are real constraints of the current implementation, not oversights.

| Limitation | Impact | Mitigation |
|---|---|---|
| Worker cannot scale past one replica | Duplicate probes and alerts | Keep `replicas: 1`. Requires the Redis queue in `ROADMAP.md` (P1) |
| No job queue, retry, or backoff | A failed probe is recorded, not retried | Monitor for gaps; queue work is in `ROADMAP.md` (P1) |
| Worker state is in memory | Status transitions can be lost across a restart | State is rehydrated from recent `Check` rows at boot; narrow the window by avoiding restarts |
| `SIGTERM` does not drain | At most one batch of in-flight checks is lost on shutdown | Results are written per monitor, so partial loss is bounded |
| No automated restore | Recovery is manual | Test restores on a schedule |
| Single-host topology | No multi-node failover | Use a managed platform if high availability is required |
| Unbounded retention sweep | A single `deleteMany` can lock a large `Check` table | Keep `CLEANUP_DAYS` modest; batching is in `ROADMAP.md` (P1) |
| A monitor with an `expectedKeyword` fails if its response exceeds `MAX_RESPONSE_BYTES` | The check records `down` with `Response body exceeded the configured size limit.` | Raise `MAX_RESPONSE_BYTES` for that deployment, or drop the keyword. Values above 64 MiB are clamped |

### Response size limit

`MAX_RESPONSE_BYTES` bounds how much of a monitored response the worker reads, in bytes.
It defaults to `1048576` (1 MiB) and is clamped to 64 MiB, so it cannot be set high
enough to remove the protection.

A monitor is only affected if it has an `expectedKeyword`, because that is the only thing
that makes the worker read a body. A status-only check reads no body at all, and neither
does a redirect hop. Raise it only if a real monitor needs a keyword matched in a larger
payload; the limit is applied to the decompressed stream, so a compressed response is
judged on what it expands to, not on its size on the wire.

Full list in [ROADMAP.md](../ROADMAP.md).
