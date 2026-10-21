# PulseOps - interview preparation

Everything below describes what the code actually does. Where something is a limitation, it says so; that honesty is part of a good answer.

## 60-second introduction

"PulseOps is an API monitoring tool I built on top of an MIT-licensed open-source monitoring project. You register an API; a worker checks it on an interval and stores every measurement in PostgreSQL. A deterministic rule engine opens an incident after three consecutive failures, or after three consecutive slow-but-successful responses, and resolves it after two consecutive healthy checks - all configurable. The part I'm proudest of is the investigation view: each incident links to the exact stored checks that triggered it and recovered it, shows the thresholds, and builds a timeline that separates when a measurement was taken from when the system changed state. Facts from the data are kept separate from hypotheses. I put the engine in a transaction that locks the monitor row, so overlapping checks can't double-count or open duplicate incidents, and a partial unique index enforces that in the database. There's also a simulation lab for demoing failures without any network access, an SSRF-hardened executor, and tests that run against a real PostgreSQL."

## Problem and users

Developers often learn an API is down from users. A green/red indicator doesn't say *when* it degraded, whether it was slow or failing, which measurements justified the alert, or when it recovered. Target users: students, junior backend developers, independent developers and small teams who want a small tool that explains its alerts.

## Differentiating features (real ones)

1. Evidence-driven incidents (`incident_evidence` links incident → specific checks with a role: last healthy / trigger / continuing / recovery).
2. Two independent detectors (availability, latency) with explicit recovery rules.
3. Timeline with *observed time* vs *state-change time*.
4. Simulation (labelled `SIMULATED`, separate in the data model) through the same engine.
5. Observation-based analytics (avg / p95 / uptime estimate) computed in SQL with the method documented.
6. Optional AI assistant that can only read sanitised evidence.

It is not a new category of product; commercial tools do far more. The focus is explainability and a clean engineering story.

## Architecture and request flow

`UI → Express API → services → @pulseops/core → PostgreSQL`, and `worker (scheduler) → core`. `core` holds the hardened executor + SSRF policy, the incident engine, classification, explanation/timeline builders and simulation. API and worker share it so a manual check and a scheduled check take exactly the same path.

One check: executor validates and performs the request → `recordObservation()` → transaction: lock monitor row, insert check, update counters, open/continue/resolve incidents, insert evidence + events, commit → the caller creates alert rows / sends optional e-mail after commit.

## Database design

* Tables: `monitors` (settings + four counters + `is_simulated`), `checks` (one row per observation), `incidents`, `incident_evidence`, `incident_events`.
* Integrity: PKs/FKs, CHECK constraints (types, statuses, threshold ranges, lifecycle `status='RESOLVED' ⇔ resolved_at IS NOT NULL`), partial unique index for one open incident per (monitor, type), composite index `(monitor_id, checked_at DESC)`, deferred `NO ACTION` FK from evidence to checks.
* Pre-existing ids are text (cuid); I kept them for compatibility and used UUIDs for the new tables. New monitors/checks get UUID strings.
* Counters live on the monitor row instead of being recomputed from history: O(1) per observation, and the row lock gives a natural serialisation point.
* Examples and measured `EXPLAIN` output: [`SQL_EXAMPLES.md`](SQL_EXAMPLES.md).

## Incident state machine

See the table in the README. Key points: "bad" streak opens, "good" streak resolves; availability and latency are independent and can be open together; a failure resets the slow streak (a failed request isn't a slow *success*); latency exactly at the threshold counts as healthy; `started_at` = first triggering check, `opened_at` = state change.

## Scheduler and concurrency decisions

* Due-ness is `last_checked_at + interval` stored in PostgreSQL, so restarts don't lose schedule (the original kept it in memory).
* In-flight map per monitor → no overlapping checks; a worker pool bound (`MAX_CONCURRENT_CHECKS`); the tick only dispatches and never waits for slow targets.
* A failure on one monitor is logged and backed off for one interval; it never stops the loop. `SIGINT/SIGTERM` stop scheduling and wait up to 15 s for in-flight checks.
* Limitation: single instance. Scaling: `FOR UPDATE SKIP LOCKED` leasing or a queue, multiple workers, regional vantage points.

## Error handling and security decisions

SSRF: scheme allow-list, DNS-resolved address validation, pinned connect-time lookup, redirect re-validation, size/time limits, and a create-time hostname check. The demo never loosens this: it bypasses the network entirely and the simulation endpoint takes no URL. Per-user scoping, strict request schemas (reject unknown keys), header values never returned, scrypt passwords, uniform login errors, rate limits (API, auth, manual checks). Database or scheduler errors are caught per operation and logged; the API returns consistent JSON errors.

## Likely technical questions

**1. How do you prevent duplicate incidents when two checks finish at the same time?**
Each observation runs in a transaction that starts with `SELECT … FOR UPDATE` on the monitor row, so concurrent observations for the same monitor queue up and each sees the previous counter values. As a backstop, a partial unique index `(monitor_id, type) WHERE status='OPEN'` makes a second open incident impossible, and the insert uses `ON CONFLICT … DO NOTHING`. A test fires 12 concurrent observations and asserts one incident and an exact counter.

**2. Why a row lock instead of SERIALIZABLE isolation or an application mutex?**
A row lock is narrow (one monitor), works across multiple processes (API and worker), and avoids serialization-failure retries. An in-process mutex would not protect API-vs-worker races.

**3. Why store counters on the monitor rather than counting recent checks?**
O(1) update per check, no scan, and the counter *is* the streak. Trade-off: counters are derived state and could drift if updated outside the engine - so only the engine writes them, inside the same transaction as the check insert.

**4. How is uptime calculated and why do you call it an estimate?**
`successful checks / total checks` in the window. With a 60 s interval an outage shorter than the interval can be missed entirely, and the metric weights each check equally regardless of the gap before it, so it's a sampling estimate, not an SLA figure.

**5. Why percentile_cont for p95, and why only successful checks?**
p95 shows tail latency that an average hides. Failed checks have no meaningful latency (a timeout "latency" is just the timeout), so including them would distort the figure; failures are reported separately.

**6. What does the composite index do?**
`(monitor_id, checked_at DESC)` matches "newest N checks for one monitor": PostgreSQL walks the index from the newest entry and stops, no sort. On 300k synthetic rows the plan was an index scan at ~0.1 ms versus a parallel sequential scan plus sort at ~72 ms with no index (single local runs, not a benchmark).

**7. How do you stop the monitor feature becoming an SSRF vector?**
Validation at creation *and* on every request: allowed schemes, no credentials, resolve DNS and reject private/loopback/link-local/metadata ranges, pin the resolved IP for the connection to defeat DNS rebinding, re-validate every redirect hop, cap response size and time. Rate limit manual checks.

**8. How does the AI feature avoid being a liability?**
It is optional and read-only: the deterministic engine decides incidents; the assistant only receives sanitised evidence (no URL, host, headers, error text, ids) and its output is labelled as hypotheses. Provider failure returns 503 for that endpoint only. It sits behind an adapter interface.

**9. Why raw SQL for the engine when the project uses Prisma?**
Row locks, `ON CONFLICT … WHERE` on a partial index, `FILTER` aggregates and `percentile_cont` are awkward or impossible in the ORM. Prisma remains the schema/migration tool and is used by the inherited routes; the new code uses parameterised SQL behind a tiny `SqlDb` interface, which also made it testable against plain `pg`. Trade-off: less compile-time type safety on rows.

**10. How do you keep simulated data from polluting real metrics?**
Simulated monitors have `is_simulated = true`; their checks and incidents carry `observation_type = 'SIMULATED'` set by the engine (callers cannot choose it); the scheduler skips them; manual checks on them are refused; every read API takes `mode=real|simulated` and filters on it; the UI shows a banner and badges.

**11. What happens when a monitor is deleted but its checks are incident evidence?**
Deleting the monitor cascades to checks and incidents. The evidence FK is `NO ACTION DEFERRABLE INITIALLY DEFERRED`: a stand-alone delete of a cited check fails at commit, but the monitor cascade removes evidence rows first in the same transaction, so it succeeds. A test found this (the first version used an immediate constraint and blocked monitor deletion).

**12. How would you scale this?**
See below.

## Design trade-offs and limitations

* In-process scheduler (simple, one instance) vs a distributed queue (more moving parts).
* Counters on monitor row (fast, derived state) vs recomputing from history (always correct, slower).
* Evidence rows capped at 50 CONTINUING per incident (bounded storage) vs a full record (the raw checks remain in `checks` until retention).
* Latency from one vantage point; stateless JWTs without revocation; no password reset in local mode.
* Unverified here: container build, the Prisma CLI steps on my side (see `VERIFICATION.md`).

## Scaling to multiple workers and large histories

* **Multiple workers:** lease due monitors with `SELECT … FOR UPDATE SKIP LOCKED` (or set a `leased_until`), keep the engine as is (already per-monitor serialised).
* **Large histories:** partition `checks` by time (monthly), keep the composite index per partition, add rollup tables (per-monitor per-hour avg/p95/count) for charts and uptime over long windows, move old partitions to cheaper storage; retention already protects incident evidence.
* **Read load:** read replicas for dashboard queries; cache dashboard summaries for a few seconds.
* **Regions:** run workers per region and store `region` on checks (the column exists), alert only when several regions agree to cut false positives.
