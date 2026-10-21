# Commercial Boundary

How the community edition and the proprietary edition relate, and why the line falls where it
does.

## The problem this solves

The community edition in this repository is public and MIT licensed. Anyone can clone it and
use it forever. That is correct for adoption and fatal for asset value: a buyer will not pay
for something they can download in thirty seconds.

So the proprietary edition cannot be this code. It must be code that does not exist in any
public repository.

## The rule

> **The community edition is the demo. The proprietary edition is the product.**

Everything a buyer can obtain by cloning the public repository is free, permanently, and
should stay that way. Everything a buyer pays for must be absent from the public tree.

This is not a trick. It is the standard shape of commercial open source, and it is the only
structure in which both goals are honestly served: adoption stays high because the core is
genuinely useful, and paid value is real because it cannot be obtained for free.

## What is deliberately community

Free forever, MIT, in the public repository.

| Capability | Notes |
|---|---|
| HTTP/HTTPS uptime monitoring | Core product value |
| Periodic probe execution | The worker and probe executor |
| Uptime and response-time analytics | Dashboard and per-monitor charts |
| Check history with retention | `Check` table, 90-day default |
| Single-owner tenancy | Every record scoped to one `userId` |
| Email alerts on status change | Resend integration |
| Public status page, read-only | API and public view |
| Docker Compose self-hosting | Single host |
| Stripe checkout, backend only | Integration code, not entitlement logic |

The rationale: a single engineer monitoring twenty endpoints gets real value from this and
should never hit a paywall. That user is also the growth engine for the enterprise tier.

## What is proprietary

Absent from the public repository, developed and released separately, licensed under a
commercial EULA.

| Capability | Why it is defensible |
|---|---|
| Self-hosted authentication | Removes the Supabase dependency; substantial security-critical work |
| Organizations and workspaces | New data model plus a scoping layer over every existing query |
| RBAC | Permission model plus server-side enforcement across all routes |
| Member invitations | Token lifecycle, expiry, revocation, email |
| Audit log | Append-only event store plus admin query UI |
| SSO — SAML and OIDC | Protocol implementations, certificate and metadata handling |
| Redis job queue | BullMQ integration, retry, backoff, dead-letter, multi-replica safety |
| SSRF protection | Destination validation, DNS rebinding defence, redirect control |
| Notification engine | Provider abstraction with Slack, webhook, and SMS adapters |
| Status page builder | Composition UI, component grouping, publishing workflow |
| Incident management | First-class incident lifecycle aggregating checks and alerts |
| Entitlement enforcement | Server-side quota enforcement, not UI hints |
| Benchmarks and load characterization | Measured results nobody else has |
| Operations tooling | Queue dashboard, retention management, backup and restore |

Two of these deserve emphasis, because they are the difference between a demonstration and a
product a paying organization can run.

**Self-hosted auth plus SSO** is what makes air-gapped and regulated deployment possible. It is
also the highest-risk code in the system, and risk is what organizations pay to transfer.

**The queue with SSRF protection** is what makes the platform safe to run at scale and safe to
expose to untrusted users. It also resolves the two reliability defects documented in
`ROADMAP.md`, which means the proprietary work is not artificial — it is the work the public
edition demonstrably needs next.

## Boundary rules

These constraints keep the split honest and legally clean.

1. **No proprietary code in this repository.** Not in a directory, not behind a flag, not in a
   stub. If it is here, it is MIT.
2. **The proprietary edition depends on the community edition, never the reverse.** The public
   core must remain buildable and useful alone.
3. **No copyleft in the community edition.** Verified by `scripts/audit-licenses.js`, which
   exits non-zero on any non-permissive dependency. See `docs/THIRD_PARTY_LICENSES.md`.
4. **No third-party code claimed as proprietary.** The proprietary edition contains only code
   we authored. Stripe, Supabase, and every npm dependency remain under their own licenses.
5. **The proprietary edition ships with its own license, attribution, and third-party
   inventory.** It does not relicense any community code.
6. **Documentation states the boundary explicitly.** A buyer must be able to determine what
   they are purchasing without asking us.

## How the editions interoperate

```
┌──────────────────────────────────────────────────────────────────┐
│  COMMUNITY CORE — MIT, public                                     │
│  backend, worker, frontend                                        │
│  probe engine · analytics · email alerts · status page (read)     │
└────────────────────────────┬─────────────────────────────────────┘
                             │  depends on (never reverse)
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  ENTERPRISE EDITION — proprietary EULA, separate repository        │
│                                                                   │
│  ORGANIZATION     orgs · workspaces · members · invitations       │
│  ACCESS           RBAC · SSO (SAML/OIDC) · audit log              │
│  IDENTITY          self-hosted auth, replacing Supabase           │
│  RELIABILITY       BullMQ queues · retry · DLQ · multi-replica    │
│  SECURITY          SSRF defence · rate limits · hardening         │
│  COMMUNICATION     Slack · webhook · SMS · notification engine     │
│  INCIDENTS         incident lifecycle · status page builder        │
│  COMMERCIAL        entitlements · metering · quota enforcement    │
└──────────────────────────────────────────────────────────────────┘
```

Deployment shape for an enterprise customer: the community core services plus the enterprise
services, sharing one PostgreSQL database and one Redis instance. The enterprise edition adds
migrations against the same schema rather than replacing it, so an upgrade does not require a
data migration.

## Licensing

| | Community | Enterprise |
|---|---|---|
| License | MIT | Commercial EULA, per-seat or per-deployment |
| Repository | Public | Private or delivered as an archive |
| Redistribution | Unrestricted, including closed-source and commercial | Prohibited without a separate agreement |
| Modification | Unrestricted | Permitted for the licensed deployment |
| Support | Community, best-effort | Contractual SLA |
| Trademarks | No grant | Grant of limited use rights |

The MIT license of the community core permits relicensing and commercial redistribution of
that code without restriction. That is intentional — it is what makes adoption credible — and
it is why the proprietary value must live entirely outside this repository.

## Why this is defensible to a buyer

A skeptical buyer will ask how this differs from a thin wrapper they could build themselves.
The honest answer is what they are actually buying.

- **Reproducible setup.** `docker compose up` yields a working system with no external SaaS
  dependency. Their engineer is not waiting on a vendor signup.
- **Security work they would otherwise own.** SSRF defence, session rotation, RBAC
  enforcement, audit trails. This is unglamorous and expensive.
- **Operational maturity.** Retry, dead-letter, retention, backups, restore. What separates a
  demo from something on the critical path.
- **Measured limits.** Benchmarks stating what the system actually sustains, so they can size
  it instead of guessing.
- **Transferable ownership.** They own the deployment, not a subscription.

That is a real product. The alternative — listing the public repository — has no defensible
answer at all.

## Sequencing

The proprietary edition is built in the order that produces the most defensible asset soonest.

1. **Identity** — self-hosted auth. Unblocks offline deployment, removes an external
   dependency, and SSO depends on it.
2. **Organization** — orgs, workspaces, members, invitations. Every access-control feature
   depends on this data model.
3. **Access** — RBAC, then audit log, then SSO on top of real sessions.
4. **Reliability** — BullMQ queue and SSRF defence together. Fixes two public defects and
   creates the multi-replica story.
5. **Communication** — notification engine and status page builder.
6. **Incidents** — incident lifecycle.
7. **Commercial** — entitlements and quota enforcement.
8. **Verification** — full test suite, benchmarks, security review, buyer documentation.

Identity and Organization come first because everything else in the list needs them, and
because the boundary is only meaningful once there is a substantial body of code on the
proprietary side of it.
