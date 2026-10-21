# Roadmap

Planned work. **Nothing in this file is implemented.** For what actually exists today, read
[ARCHITECTURE.md](ARCHITECTURE.md) and the feature matrix in [README.md](README.md).

Ordered by priority, not by release. Items marked **P0** are correctness, security, or
reliability problems that affect the current system.

---

## P0 — Correctness and security

These are defects or gaps in shipped code, not feature requests.

### ~~SSRF protection in the monitoring worker~~ — done

**Status:** implemented · 149 tests, mutation-verified

Users supplied arbitrary URLs that the worker fetched on their behalf with no destination
validation, so a monitor could be pointed at `127.0.0.1`, the RFC1918 ranges, the Docker host
gateway, or `169.254.169.254`, and the result read back through the monitor's status code.

Shipped in `worker/src/security/`:

- `ip-policy.ts` classifies one resolved address against the IANA special-purpose registries,
  including the IPv4 embedded in v4-mapped, NAT64, 6to4 and Teredo IPv6 forms. Unknown input
  is denied.
- `ssrf-policy.ts` parses the URL, restricts the scheme to `http`/`https`, rejects embedded
  credentials, resolves the name, and refuses the target if *any* resolved address is
  non-public.
- A `lookup` installed on the request agent re-classifies at connect time, so the address
  dialled is the address approved. This is what closes the DNS rebinding window.
- The executor sets `maxRedirects: 0` (native transport, not `follow-redirects`) and walks
  redirects itself, re-running the full policy per hop, capped at 5.
- Refusals return one uniform message; the address and reason go to the log only.

`executor.e2e.test.ts` runs the real policy against a real listening loopback server and
asserts it is never contacted. Disabling the guard was verified to fail the suite.

Residual risk is documented in [SECURITY.md](SECURITY.md): DNS is still resolved before use,
a rebind on a redirect hop is argued rather than tested, the range table is a denylist, and
`Host` is not pinned.

### Cap monitor response body size — done

**Status:** implemented · **Severity:** was high, now closed

`executeCheck` used to read the whole response into memory to check `expectedKeyword`, so a
monitor pointing at a large file could exhaust the worker's heap. The response is now
requested as a stream and consumed under a running byte count of **1 MiB** by default
(`MAX_RESPONSE_BYTES`, clamped to 64 MiB), so the transfer is aborted rather than measured
afterwards. `Content-Length` is an early-out only; chunked, undeclared and compressed
responses are all bounded, and compression is counted after inflation so a decompression
bomb cannot get through. See [SECURITY.md](SECURITY.md) for the full guarantee and its
limits. 30 tests, mutation-checked — reverting to a buffered read fails 20 of them.

### Test suite is effectively empty — partially addressed

**Status:** backend 21 tests, worker 149 · **Severity:** high

The worker had no tests and CI runs with `--passWithNoTests`, so a fully broken suite still
reported green. The worker now has a jest setup and 149 tests covering the SSRF policy,
redirect handling, and the executor's check semantics, run in CI.

Still missing: the frontend has no tests, and the alert state machine, the billing routes,
and the signup-to-alert path have no integration coverage. `--passWithNoTests` should be
removed once every workspace has a suite.

---

## P1 — Reliability

### Redis-backed job queue

**Status:** dependency present, integration absent · **Severity:** high

`bullmq` and `ioredis` are declared in `worker/package.json` and a Redis service runs in
Compose, but no code path imports either. Scheduling is `setInterval` plus an in-process `Map`.

Required: BullMQ queue and worker, exponential backoff, retry with attempt ceilings,
dead-letter queue, job idempotency keys, graceful drain on shutdown, and a queue-depth admin
view. This single change resolves the multi-replica duplication problem, the lost-transition
problem, and the no-retry problem together.

### Retention and storage growth

`Check` rows accumulate at the full probe rate. The daily sweep deletes rows older than
`CLEANUP_DAYS` (default 90) with a single unbounded `deleteMany`, which can lock and balloon
the WAL on a large table. Required: batched deletion, a covering index on `checkedAt`, and
optional downsampling of old checks into hourly or daily aggregates.

### Health and observability beyond `/health`

`GET /health` checks database and Redis reachability and nothing else. Required: worker
liveness and heartbeat age, queue depth and oldest-job age, error rate and p95 latency,
structured log shipping, and Prometheus-format metrics.

### Graceful shutdown does not drain

`SIGTERM` disconnects Prisma and exits immediately, abandoning any in-flight batch. Required:
stop accepting new work, await in-flight probes up to a deadline, then exit.

---

## P2 — Self-hosted authentication

**Status:** not implemented · **Severity:** high for self-hosting

Auth is delegated to Supabase. `docker compose up` does not produce a working login without a
Supabase project and keys, which blocks fully offline deployment and air-gapped installs.

Required: email/password with verification, password reset, session and refresh-token
rotation stored in the application database, account management, and migration from existing
Supabase accounts. `bcryptjs` and `jsonwebtoken` are already dependencies. Enterprise SSO
(SAML and OIDC) sits on top of this and is a separate item below.

**Foundation now in place:** the core authenticates through the `AuthProvider` interface
(`backend/src/auth/provider.ts`), so an implementation can be supplied via
`AUTH_PROVIDER_MODULE` without forking the monitoring code. That interface is the
extension point; the authentication system itself is still not implemented here.

---

## P3 — Organization and access control

### Workspaces and teams

**Status:** placeholder pages only · **Severity:** medium

`frontend/src/app/(dashboard)/team/page.tsx` and `workspaces/page.tsx` render without backing
API or data model.

Required: `Organization`, `Workspace`, and `Membership` tables; a workspace scoping layer over
the existing `userId`-owned models; member invitations with expiry; and per-workspace
monitor, alert, and status-page isolation.

### RBAC

**Status:** not implemented · **Severity:** medium

Authorization is owner-scoped only. Required: `Owner`, `Admin`, `Member`, `Viewer` roles, a
permission model such as `monitor.read` / `monitor.create` / `monitor.update` /
`monitor.delete` / `incident.manage` / `team.manage` / `billing.manage`, and server-side
enforcement on every route. Hiding controls in the UI is not enforcement.

### Audit log

**Status:** not implemented · **Severity:** medium

Required: an append-only `AuditEvent` table capturing actor, workspace, action, resource,
resource ID, timestamp, and source IP, with an admin query UI. Expected by any organization
running shared infrastructure.

---

## P4 — Alerting and communication

### Multi-channel notification engine

**Status:** email only, hardcoded · **Severity:** medium

The worker calls `sendEmailAlert` directly on status change. There is no provider abstraction
and no per-monitor channel configuration.

Required: a `NotificationProvider` interface with Email, Slack, generic webhook, and SMS
adapters; per-monitor channel selection; retry and backoff per channel; and delivery
attempts recorded against the alert.

### Alert improvements

Maintenance-window suppression, threshold configuration beyond binary up/down, flapping
detection, and configurable escalation policy.

---

## P5 — Status pages and incidents

### Status page management UI

**Status:** API and public view only · **Severity:** medium

CRUD endpoints and the public `/status/[slug]` page work. There is no editor for composing a
page, attaching monitors, or publishing. Required: builder UI, component grouping, and
customization.

### Incident management

**Status:** not implemented · **Severity:** medium

Alerts are individual rows with no grouping, no operator acknowledgement workflow beyond a
single PATCH, and no postmortem field. Required: first-class `Incident` aggregating the checks
and alerts that constitute an outage, `Investigating` / `Identified` / `Monitoring` /
`Resolved` lifecycle, and status-page propagation.

### Maintenance windows

Scheduled suppression that prevents false alerts during planned downtime, and displays
maintenance state on the public status page.

---

## P6 — Billing and entitlements

**Status:** backend only · **Severity:** medium

Stripe checkout, portal, and webhooks are implemented server-side. The frontend billing page
does not complete a purchase, and plan limits are advisory rather than enforced.

Required: complete checkout UI, plan-to-entitlement mapping, server-side enforcement of
monitor count and check-interval limits, a quota-exhaustion path, webhook-driven subscription
state reconciliation, and invoice history.

---

## P7 — Scale and operations

Ordered by value, not by effort. None of this is needed for a single-host deployment.

- Read replicas or a dedicated analytics store as `Check` volume grows
- Regional probe execution, which the `region` field on `Check` already anticipates
- Horizontal API scaling, which is safe today only because the API is stateless
- Bulk import and export of monitors
- Monitor templates and folders
- Synthetic multi-step transaction checks
- TLS certificate management and automated renewal for self-hosted installs
- Kubernetes or Swarm manifests, if multi-host deployment becomes a real requirement

---

## Explicitly not planned

Recording these so they are not mistaken for oversights:

- **Mobile app.** No evidence of demand, and it would consume the whole roadmap.
- **CLI tool.** `curl` against the API covers the same ground today.
- **AI assistant.** Would add an external model dependency to a monitoring tool that should
  fail predictably.
- **Microservice decomposition.** Three services is the right size for this workload.
