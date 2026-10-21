# Documentation

Reference documentation for API Monitor SaaS.

## Start here

| Document | What it covers |
|---|---|
| [../README.md](../README.md) | What the product is, feature status, quick start |
| [../ARCHITECTURE.md](../ARCHITECTURE.md) | How the system actually works, component by component |
| [../ROADMAP.md](../ROADMAP.md) | What is planned, ordered by priority, with known gaps |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Running it locally, on a single host, and on managed platforms |

## Reference

| Document | What it covers |
|---|---|
| [../ENV_GUIDE.txt](../ENV_GUIDE.txt) | Where to obtain each environment variable |
| [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) | Every direct dependency, its license, and the obligations |
| [../SECURITY.md](../SECURITY.md) | Reporting a vulnerability, and known security limitations |

## Commercial

| Document | What it covers |
|---|---|
| [COMMERCIAL_BOUNDARY.md](COMMERCIAL_BOUNDARY.md) | What stays MIT, what is proprietary, and why the split holds |
| [AUTH_DESIGN.md](AUTH_DESIGN.md) | Self-hosted authentication design, replacing Supabase |

## History

[history/](history/) holds development records kept for provenance. These
describe work that was planned or performed at a point in time and are **not**
current product documentation:

| Document | What it is |
|---|---|
| [history/DEVELOPMENT_PLAN_v2.md](history/DEVELOPMENT_PLAN_v2.md) | The v2.0 build plan that produced the current codebase |
| [history/P1-VALIDATION_v3.md](history/P1-VALIDATION_v3.md) | Node 22 migration validation record |
| [history/UBUNTU_SETUP_GUIDE_v2.md](history/UBUNTU_SETUP_GUIDE_v2.md) | Original single-host setup guide, superseded by [DEPLOYMENT.md](DEPLOYMENT.md) |

## Documentation rule

Implemented behavior is documented in [../ARCHITECTURE.md](../ARCHITECTURE.md).
Planned behavior is documented in [../ROADMAP.md](../ROADMAP.md). Development
history lives in [history/](history/). Nothing belongs in a product document
because it was once intended.

This rule exists because the previous `ARCHITECTURE.md` described a mobile app, a
CLI, a webhook service, Cloudflare, Docker Swarm, Prometheus, Grafana, Loki,
Kafka, and row-level security — none of which exist. Over-claiming in
documentation reads to a technical buyer as either carelessness or inflated
numbers, and both suppress what a working system is worth.

## Regenerating reference docs

```bash
node scripts/audit-licenses.js          # rewrites THIRD_PARTY_LICENSES.md
node scripts/audit-licenses.js --check  # CI mode: fails if stale
```
