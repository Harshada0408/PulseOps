# Notice and attribution

PulseOps is a derivative work of **api-monitor-saas**, MIT License, Copyright (c) 2026 Darshan Kachare.
The original `LICENSE` file is included unchanged and continues to apply to the whole project, including the modifications below.
The upstream README is preserved at `docs/UPSTREAM_README.md`.

## Summary of changes made in PulseOps

* Added workspace `core/` (`@pulseops/core`): the pre-existing hardened check executor and SSRF policy (moved from `worker/`, tests moved with them, only type annotations adjusted for strict mode), plus a new transactional incident engine, failure classification, explanation/timeline builder, deterministic simulation, retention helper and SQL abstraction.
* Database: new migration `20261020000000_pulseops_incidents` (monitor detection settings and counters; check observation metadata; `incidents`, `incident_evidence`, `incident_events`; constraints and indexes). Earlier migrations untouched.
* Backend: monitor routes rewritten as thin controllers over SQL services; new dashboard, incident, simulation, meta and optional AI routes; built-in local authentication (`AUTH_MODE=local`); configurable rate limits.
* Worker: scheduler rewritten (database-driven, non-overlapping, bounded concurrency, graceful shutdown).
* Frontend: new UI (dashboard, monitors, incidents with evidence timeline, simulation lab, settings), new design tokens and a complete light/dark theme system. Removed the marketing site, billing/team/workspace placeholder pages and the Supabase browser client.
* Rebranded to PulseOps. Billing/Stripe code in the backend is inherited and disabled by default.
