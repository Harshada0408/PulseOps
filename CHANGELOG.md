# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

## PulseOps 1.0.0

Fork and rebrand of api-monitor-saas as PulseOps. See `NOTICE.md` for the full list of changes.

### Added
- Evidence-driven incident engine (availability + latency), recovery policy, incident timeline, explanations.
- Deterministic failure simulation (SIMULATED data, no network access).
- SQL analytics (average, p95, uptime estimate), new schema constraints/indexes, built-in local auth, optional AI adapter.
- `@pulseops/core` workspace package; scheduler rewrite; new UI with full light/dark theme.

### Changed
- `/api/v1/monitors` responses and request schema (new detection fields; unknown fields rejected).

### Removed
- Marketing pages, billing/team/workspace UI, Supabase browser client dependency.

## Unreleased

The highest-priority security defect in the shipped product is fixed: the worker
fetched user-supplied monitor URLs with no destination validation.

### Added
- **Pluggable identity system for the core.** `authMiddleware` now authenticates through an
  `AuthProvider` (`backend/src/auth/provider.ts`) resolved by `backend/src/auth/index.ts`.
  The bundled Supabase provider is the default and the supported community path, and the
  default configuration is unchanged. Setting `AUTH_PROVIDER_MODULE` to a module exporting
  that one-method interface replaces the identity system without forking the core. The
  local account check and the single-401 error shape stay in the core either way.
  This is the seam the self-hosted authentication work in `ROADMAP.md` (P2) is built on; it
  is not self-hosted authentication itself, which is not implemented.

### Security
- **SSRF in the monitoring worker — fixed.** Users supply monitor URLs and the worker
  fetches them, with no destination validation. Any user who could create a monitor could
  point it at `127.0.0.1`, the RFC1918 ranges, the Docker host gateway, or a cloud metadata
  endpoint such as `169.254.169.254`, then read the outcome back through the monitor's
  status code and timing. On a cloud host that included instance credentials from the
  metadata service. Redirects were followed by the HTTP client with no re-validation, and
  there was no DNS rebinding protection, so a first-hop allowlist alone would not have
  closed it.
- Added `worker/src/security/` as a server-side destination policy, and routed the single
  outbound request path (`services/executor.ts`) through it:
  - `ip-policy.ts` classifies one resolved address against the IANA special-purpose
    registries — loopback, private, link-local, CGNAT, multicast, reserved, benchmarking
    and documentation ranges in both families — and denies anything it cannot classify. The
    IPv4 embedded in IPv4-mapped, NAT64, 6to4 and Teredo addresses is checked too, so
    `http://[::ffff:169.254.169.254]/` is refused like its IPv4 equivalent.
  - Obfuscated hosts are handled by canonicalising with the WHATWG `URL` parser rather than
    by pattern matching, so `2130706433`, `0x7f000001`, `0177.0.0.1`, `127.1` and
    percent-encoded or fullwidth digits are all refused.
  - `ssrf-policy.ts` restricts the scheme to `http`/`https` before any DNS query, rejects
    embedded credentials, and refuses the target if *any* resolved address is non-public
    rather than picking the public one.
  - The classification runs again inside a `lookup` installed on the request's agents, so
    the address dialled is the address approved. This is what closes the rebinding window:
    there is no second, unguarded resolution.
  - The executor sets `maxRedirects: 0`, which puts axios on Node's native transport
    instead of `follow-redirects`, and walks the chain itself — re-running the full policy on
    each hop, capped at 5, dropping the body on a method-changing `301`/`302`/`303`.
  - Refusals return one uniform message, `Monitor target resolves to a restricted network
    destination.`, so a monitor cannot be used to probe which internal addresses exist. The
    address and reason go to the worker log only. This replaced an initial approach that let
    the internal address reach the user through a wrapped client error; see the note below.
  - Walking redirects by hand removed a protection the old client provided:
    `follow-redirects` drops `Authorization`, `Proxy-Authorization` and `Cookie` when a
    redirect crosses to a different host, and a loop that forwards every header re-introduces
    that leak. All caller headers are now dropped at an origin boundary, which is stricter,
    because any caller header can be a credential. A `307`/`308` that crosses origins with a
    request body is refused rather than followed: dropping the body would silently check a
    request the user did not configure.
- **Second bug found while writing the tests.** A block raised inside the guarded socket
  connect could be replaced by the HTTP client's own error, which both masked the refusal
  and exposed the resolved internal address. The guard now reports through a per-request
  callback and the executor substitutes the uniform message.
- Added 149 tests across three suites, wired into `npm test -w worker` and CI:
  `ssrf-policy.test.ts` (range tables, obfuscation, cloud metadata, split-horizon names,
  rebinding, scheme smuggling via `Location`, error text), `executor.test.ts` (redirect
  control flow, method and body handling) and `executor.e2e.test.ts`, which runs the real
  policy against a real server genuinely listening on loopback and asserts it is never
  contacted.
- The suite was mutation-checked rather than assumed sound. Disabling the classification
  produced 64 failures including a check that reported `status: "up"` after a live
  loopback connection; ignoring the redirect verdict produced 7 targeted failures and
  attempts to reach loopback and `169.254.169.254`. Both mutations were reverted.
- **Security review of the full request path.** Every place this codebase fetches a
  user-controlled URL was traced, not just the reported one. The worker path was the only
  gap: the frontend fetches only the configured same-origin API, Resend uses a fixed
  service host, and the Stripe webhook is inbound. There is no second outbound fetch path
  in the repository.
- Residual risk is documented rather than glossed: DNS is still resolved before use, so a
  hostile hostname can cause an outbound query; a rebind on a redirect hop is argued by
  construction rather than covered by a test; the range table is a denylist of
  special-purpose ranges, not an allowlist; and `Host` is not pinned. See
  [SECURITY.md](SECURITY.md).

### Added
- The monitor create/update schema now rejects a non-`http`/`https` target, so the mistake
  is reported when the monitor is created instead of surfacing as a failed check later.
  This is a shape check and deliberately not the security boundary: a syntactically valid
  `http://169.254.169.254/...` is still accepted here and refused by the worker policy, and
  a test asserts exactly that so the boundary is not misrepresented.
- `backend/src/routes/monitors.test.ts` was testing a *copy* of the Zod schema rather than
  the real one, so it would have kept passing if the actual schema changed. The schemas are
  now exported and imported. Backend coverage is 21 tests, up from 12.
- Those schemas moved to `backend/src/schemas/monitor.ts`. Pointing the test at the route
  module fixed the copy problem but broke CI: importing the router pulls in the Prisma
  client, the Supabase client and `config/env`, and `config/env` calls `process.exit(1)`
  when its required variables are missing, which is the normal case on a runner. The
  backend job failed with four `process.exit called with "1"` child-process exceptions while
  passing locally, where a populated `.env` hides it. A schema module that imports nothing
  but `zod` is importable in any environment, and the test now runs with no environment at
  all.
- The worker has a test suite and tooling for the first time: `worker/jest.config.js`,
  an ESLint flat config, `test`/`test:watch`/`test:cov` scripts, and the corresponding CI
  step. CI still uses `--passWithNoTests` for the frontend, which has no tests; that is
  called out in [ROADMAP.md](ROADMAP.md) rather than left to be discovered.
- `docs/AUTH_DESIGN.md` and `docs/COMMERCIAL_BOUNDARY.md` from the R1 documentation pass.

### Fixed
- **The policy refused legitimate public hosts on a NAT64 network.** Found by running it
  against a real public host in the running container, not by reading it. The
  IPv4-embedding prefixes — v4-mapped, NAT64, 6to4, Teredo — were blocked outright, so
  every name resolved by a DNS64/NAT64 resolver was refused, including ordinary public
  ones. A container on an IPv6-only or NAT64-configured host gets exactly such a resolver,
  which made the worker unable to monitor anything. Those four prefixes are now judged by
  the IPv4 address they embed, against the IPv4 table: `::ffff:169.254.169.254` is still
  refused, and `64:ff9b::42f1:7de8`, which embeds the public `66.241.125.232`, is now
  allowed. `64:ff9b:1::/48` stays refused outright because RFC 8215 local-use translation
  does not have a well-defined destination. This also made `extractEmbeddedIPv4`, which
  existed to do this check, reachable code for the first time — it had been dead, shadowed
  by the range loop that ran before it.
- A failed check could report `error: ""`, which tells an operator nothing and cannot be
  distinguished from a monitor that was never scheduled. Observed on a live check against a
  public host in the running container; the client error in that case carried no message.
  Every failure path now resolves a diagnostic, falling back to the error name and code
  before the generic string.

### Response bodies are now bounded while they are read

This was the one gap the SSRF work left open, and it is now closed.

The response is requested with `responseType: 'stream'` instead of being collected by the
HTTP client, and consumed under a running byte count of **1 MiB** by default
(`MAX_RESPONSE_BYTES`, clamped to a 64 MiB ceiling so the setting cannot be used to switch
the protection off). An honest `Content-Length` over the limit is refused from the header
alone; a chunk crossing the limit is never collected, the stream is destroyed, and the
check records `down` with `Response body exceeded the configured size limit.` No address,
byte count or response content appears in the error.

`decompress: true` is set explicitly, so the count is applied **after** inflation. That
ordering is the substance of the fix: a 4 KiB gzip body that expands to 400 MiB has a
`Content-Length` of 4096, so the header check cannot see it and only the running count
stops it. gzip, deflate and Brotli are each covered.

A body is now read only when the monitor has an `expectedKeyword`. A status-only check —
the common case — and every redirect hop and failed-status check abandon the stream
unread, so an ordinary check holds no response body in memory at any point. A response
that cannot have a body (`HEAD`, 204, 304) is exempt, because a `HEAD` declares the
length its matching `GET` would return while sending nothing, and reporting a size failure
there would break a working monitor that read zero bytes.

30 new tests (23 behaviour, 7 configuration). The suite was mutation-checked: reverting
to a buffered `await response.data` fails 20 of the 23, dropping the running count fails
12, counting compressed bytes instead of inflated ones fails the four compression tests,
and making the message vary with the byte count fails 14. The resource proof is
socket-level — a real server that cannot finish pushing a 64 MiB body, with the bytes it
managed to write asserted against the limit.

## [3.5.0-community] — R1 community baseline

The tag `v3.5.0-community` was initially published on a commit that predated the
documentation and licensing pass, so the release contained images whose security
posture could not be traced to the source. The tag has been moved to `774ed99`, the
verified R1 baseline, with no history rewritten.

The Docker development environment had never worked. Six independent defects kept
`docker compose up` from reaching a usable state — CI passed because it only builds
images and never runs the stack. All are fixed and verified end to end.

### Security
- **The real `.env` was baked into the backend image.** No `.dockerignore` existed,
  so `COPY . .` copied host files into the image, including the database password,
  Supabase service-role key, and Stripe and Resend secrets. Anyone pulling that
  image could read them. Added `.dockerignore` at the repository root and in
  `backend/` and `frontend/`, and removed the `.gitignore` rule that listed
  `.dockerignore` as a build artifact — that mistake is why the gap went unnoticed.
- Dockerfiles no longer pin `registry.npmmirror.com`, which broke builds outside
  that network. The registry is now a `NPM_REGISTRY` build argument defaulting to
  the public npm registry.

### Fixed
- Prisma client was pinned to the `linux-musl` engine in `schema.prisma`, so every
  Debian-based image loaded an engine linking against `libssl.so.1.1` that those
  images do not provide. Now `binaryTargets = ["native"]`.
- `node:22-slim` ships neither the `openssl` binary Prisma's platform detection
  reads nor the `libssl` the query engine links against. Installed in all backend
  and worker stages. This is why the Render deployment worked while local Docker
  did not — that image already installed it.
- Compose ran `npx ts-node-dev` against production images built with `--omit=dev`,
  so `npx` fetched a ts-node incompatible with the TypeScript it resolved, and the
  process crashed on startup. Added explicit `development` targets to the backend,
  worker, and frontend Dockerfiles, keeping production the default build target.
- The frontend bind mount shadowed the image's `node_modules`, failing with
  `next: not found`. Added the missing anonymous volume.
- `DATABASE_URL` points at `localhost:5434` for host tooling and is unreachable
  from inside the compose network. Added `DATABASE_URL_DOCKER` for the containers.

### Added
- A one-shot `migrate` service applies the Prisma schema before the API and worker
  start, so a fresh clone no longer needs a manual `db:migrate` step. Wired into
  both `docker-compose.yml` and `docker-compose.prod.yml`.
- Explicit `development` build targets for backend, worker, and frontend.
- `scripts/audit-licenses.js`, runnable as `npm run licenses`, and
  `docs/THIRD_PARTY_LICENSES.md`. All 72 direct dependencies are permissive, with
  no copyleft. The audit reads only the committed lockfile, so it needs no install
  and cannot be skewed by a stale `node_modules`, and it exits non-zero on a
  non-permissive license.
- CI job enforcing that the license inventory is current and contains no copyleft.
- `docs/DEPLOYMENT.md` covering local, single-host, and managed-platform
  deployment, with troubleshooting and a table of known production limitations.
- `docs/COMMERCIAL_BOUNDARY.md` defining what stays MIT and what is proprietary.
- `docs/AUTH_DESIGN.md` specifying self-hosted authentication to replace Supabase.
- `docs/README.md` as a documentation index.

### Changed
- **LICENSE** was truncated to 7 lines, cut off before the warranty disclaimer, so
  GitHub classified the project as "Other" rather than MIT. Restored the full text.
- **ARCHITECTURE.md** documented a mobile app, CLI tool, webhook service, Cloudflare
  CDN, Docker Swarm, Prometheus, Grafana, Loki, Kafka, and row-level security, none
  of which exist. Rewritten to describe only shipped behavior, and to state plainly
  that row-level security is not enabled, that `bullmq` and `ioredis` are declared
  but never imported, and that the worker cannot scale past one replica.
- **ROADMAP.md** now holds everything previously documented as existing but not
  implemented, ordered by priority, with the SSRF exposure at P0.
- `DEVELOPMENT_PLAN.md`, `P1-VALIDATION.md`, and `UBUNTU_SETUP_GUIDE.md` moved to
  `docs/history/`. They are development records, not product documentation, and a
  buyer pays for shipped code rather than a plan.
- `.env.example` and `ENV_GUIDE.txt` rewritten. Both previously implied that
  `ENABLE_WORKSPACES` and `ENABLE_TEAMS` gate working features; neither flag is read
  anywhere in the code.
- `CONTRIBUTING.md` targets `main` rather than `develop`, and documents the license
  policy and the implemented-versus-planned documentation rule.
- `SECURITY.md` discloses the known SSRF exposure, the single-owner tenancy model,
  and the service-role key requirement.
- `docker-compose.prod.yml` pins the worker to one replica, since per-process
  scheduling state makes additional replicas produce duplicate checks and alerts.

### Verified
Clean build of all images, five services healthy, `/health` reporting a connected
database, frontend serving HTTP 200, auth guard and public routes behaving
correctly, and 12/12 tests passing against a live database.

## v3.5.0 - 2026-09-03

### Added
- Full premium redesign of marketing (landing/features/pricing/blog/docs) and dashboard (shell/sidebar/header, all pages, monitor wizard) using the design-system token set and framer-motion animations
- **Light/dark theme toggle** (sun/moon button) on marketing header and dashboard header, with light mode as the default
- Theme persistence across refresh via lazy state init and a pre-hydration `<head>` script (no flash back to light on reload)
- SEO/discoverability on the deployed site: `sitemap.xml` + `robots.txt` (Next app router), accurate `title`/`description`/OpenGraph/Twitter metadata, canonical URLs, and a servable OG banner (`/og.svg`)
- Shared site config (`frontend/src/lib/site.ts`)

### Fixed
- Monitor creation wizard now shows a proper styled glass-card UI with a 3-step stepper and visible input boxes
- **Critical** backend status check: leaving "Expected Status Code" blank now means "any 2xx" everywhere. Removed the `@default(200)` from the Prisma schema (backend + worker) and zod `.nullish()`, and fixed the worker executor so a blank expected status requires a 2xx response (previously a 500/404 was reported as UP)
- Monitor creation wizard is now **plan-aware**: the check interval defaults to and enforces the user's plan minimum (free=300s, basic=60s, pro=30s) instead of defaulting to 60s and failing with "Minimum check interval for free plan is 300 seconds"
- Removed misleading dead-code `?? 300` fallback in the backend monitor update service
- Wired wizard step styles to the design system; removed the unused CSS module and a stray `test.txt`
- Frontend API base URL normalization in `frontend/src/lib/api-url.ts`, preventing a doubled `/api/v1` prefix on the live signup route (`/api/v1/api/v1` → `/api/v1`)
- `DEPLOYMENT_STATUS.md` updated: deployment is live and email/signup confirmation resolved via Resend SMTP (previously listed as an open blocker)
- **Critical** token refresh in `frontend/src/lib/api-client.ts` now reads `session.access_token` from `POST /auth/refresh` (and rotates `refresh_token`); previously read a non-existent `data.access_token`, causing silent logouts when the JWT expired
- Removed stray markdown backtick fences (` ``` `) rendering as literal text on the login and dashboard pages
- Monitor wizard: Cancel button is no longer disabled on step 1; removed the unsupported `OPTIONS` HTTP method option; interval field aligned with backend validation (30–3600s) instead of 10–86400s
- Monitor wizard Advanced Settings trimmed to fields the backend actually supports (`timeout`, `expectedStatus`, `expectedKeyword`, `headers`, `body`) — previously-unsupported auth/alert/retry/redirect/SSL groups were silently discarded, misleading users
- Billing page degrades gracefully (disabled "Not available yet" paid plans) when Stripe/checkout is not configured, instead of offering broken Upgrade buttons
- Accurate marketing claims: removed `real-time`/`instant`/`free trial` overclaims on the landing and features pages; pricing page shows the live Free plan with Basic/Pro marked **Planned**
- Corrected stale version/status strings: sidebar `v2.0.0-enterprise` → accurate "Open source"; backend root `/` version `1.0.0` → `3.5.0`

### Removed
- Old release assets: `release-evidence/` screenshots, stale `package.json.backup`, diagnostic audit/error text files, `worker/doctor-report.txt`, empty `supabase/snippets/`

### Security
- `robots.txt` disallows private routes (`/dashboard`, `/settings`, `/team`, `/workspaces`, `/billing`)

## v3.0.0 - 2026-08-30

### Added
- Repo OG banner (`.github/api-monitor-og.svg`)
- Community files: `SECURITY.md`, `CODE_OF_CONDUCT.md`, `FUNDING.yml`, issue templates, PR template
- `DEPLOYMENT_STATUS.md` documenting free-tier deployment blockers

### Changed
- Standardize on Node.js 22 LTS (`.nvmrc`, `engines`, Dockerfiles, CI) — previously 20 in docs/scripts
- Frontend API client now targets the versioned `/api/v1` backend prefix (fixes login flow 404)
- Rewrote README with an accurate "What works vs Coming next" table and working badges
- Corrected root package description (no longer "v1 MVP")
- Removed unverified marketing claims and dead links across landing/features/docs/blog

### Fixed
- Frontend login flow: API calls now resolve against the `/api/v1` mount
- Remove all `no-explicit-any` lint warnings across backend and worker
- Monitor-create navigation used literal route-group paths (now `/monitors`)
- `/auth/refresh` now sends `refresh_token` (matches backend), enabling session self-heal

## v2.0.0

### Added
- Authentication
- Dashboard
- Monitor Management
- Analytics
- Alerts
- Worker Service

### Fixed
- Dashboard authentication loading issue
- Prisma schema synchronization issues
