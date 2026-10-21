# SQL examples

All queries run against the PulseOps schema. They are the same shapes the application uses (the application passes parameters instead of literals). Replace the ids with real ones from your database. Timestamp columns are `timestamp(3)` holding UTC, so "now" is written `now() AT TIME ZONE 'UTC'`.

## 1. Recent check results for one monitor

```sql
SELECT id, checked_at, status_code, response_time AS latency_ms, success, error_category
FROM checks
WHERE monitor_id = '<monitor-id>' AND observation_type = 'REAL'
ORDER BY checked_at DESC, id DESC
LIMIT 20;
```

## 2. Incidents joined with their monitors

```sql
SELECT i.id, i.type, i.status, m.name, m.url,
       i.started_at, i.opened_at, i.resolved_at,
       COALESCE(i.resolved_at, now() AT TIME ZONE 'UTC') - i.started_at AS duration
FROM incidents i
JOIN monitors m ON m.id = i.monitor_id
WHERE m.user_id = '<user-id>' AND i.observation_type = 'REAL'
ORDER BY i.opened_at DESC
LIMIT 20;
```

## 3. The evidence behind one incident

```sql
SELECT e.role, c.checked_at, c.status_code, c.response_time, c.success, c.error_category
FROM incident_evidence e
JOIN checks c ON c.id = e.check_id
WHERE e.incident_id = '<incident-uuid>'
ORDER BY c.checked_at;
```

## 4. Average latency and failures per monitor (last 24 h)

```sql
SELECT m.name,
       count(*)                                         AS checks,
       count(*) FILTER (WHERE NOT c.success)            AS failures,
       round(avg(c.response_time) FILTER (WHERE c.success)) AS avg_latency_ms
FROM checks c
JOIN monitors m ON m.id = c.monitor_id
WHERE m.user_id = '<user-id>' AND c.observation_type = 'REAL'
  AND c.checked_at >= (now() AT TIME ZONE 'UTC') - interval '24 hours'
GROUP BY m.id, m.name
ORDER BY failures DESC, avg_latency_ms DESC;
```

## 5. Observation-based uptime and p95 over a window

```sql
SELECT count(*)                                                           AS total_checks,
       count(*) FILTER (WHERE success)                                     AS ok_checks,
       round(100.0 * count(*) FILTER (WHERE success) / count(*), 2)        AS uptime_pct,
       (percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time)
          FILTER (WHERE success))::int                                     AS p95_latency_ms
FROM checks
WHERE monitor_id = '<monitor-id>' AND observation_type = 'REAL'
  AND checked_at >= (now() AT TIME ZONE 'UTC') - interval '7 days';
```

Uptime here is `successful / total` checks. It is an **estimate**: if checks run every 60 s, a 30-second outage between two checks is invisible, and the figure says nothing about time between samples.

## 6. Time-bucketed latency (what the dashboard chart uses)

```sql
SELECT floor(extract(epoch FROM checked_at) / 900) * 900 * 1000 AS bucket_ms,   -- 15-minute buckets
       avg(response_time) FILTER (WHERE success)                 AS avg_ms,
       count(*) FILTER (WHERE NOT success)                       AS failures
FROM checks
WHERE monitor_id = '<monitor-id>' AND checked_at >= (now() AT TIME ZONE 'UTC') - interval '24 hours'
GROUP BY 1 ORDER BY 1;
```

## 7. Query plans and the role of the composite index

`idx_checks_monitor_checked_at (monitor_id, checked_at DESC)` serves "the newest N checks of ONE monitor": the index is ordered by exactly that, so PostgreSQL walks it from the newest entry and stops after N rows, without sorting.

Measured locally (PostgreSQL 16, 300,000 synthetic check rows spread over 20 monitors, `EXPLAIN (ANALYZE, BUFFERS)`):

```
-- Query 1, with only the composite index available
Limit (actual rows=20 loops=1)
  Buffers: shared hit=50 read=13
  ->  Index Scan using idx_checks_monitor_checked_at on checks (actual rows=20)
        Index Cond: (monitor_id = 'explain-m3'::text)
Execution Time: 0.115 ms

-- Same query with NO index on checks (all dropped inside a rolled-back transaction)
Limit (actual rows=20 loops=1)
  ->  Gather Merge
        ->  Sort (Sort Key: checked_at DESC, top-N heapsort)
              ->  Parallel Seq Scan on checks (actual rows=5000 loops=3)
                    Filter: (monitor_id = 'explain-m3'::text)
                    Rows Removed by Filter: 95000
Execution Time: 72.080 ms        Buffers: shared hit=6806 read=2054
```

The 24-hour window count for one monitor uses a *Bitmap Index Scan* on the same index (`Index Cond: monitor_id = … AND checked_at >= …`), ~1.2 ms.

Caveats worth saying out loud: these are single local runs on synthetic data, not a benchmark. With round-robin synthetic data, PostgreSQL may also pick the older single-column `checks_checked_at_idx` and scan it backwards, because every recent row is close together; with real, uneven traffic the composite index is the one whose cost does not depend on how monitors interleave in time. The inherited single-column `checks_monitor_id_idx` is now largely redundant and could be dropped to save write cost.

To run an `EXPLAIN` yourself:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, checked_at, response_time FROM checks
WHERE monitor_id = '<monitor-id>' ORDER BY checked_at DESC LIMIT 20;
```

## 8. The duplicate-incident guarantee

```sql
-- Defined in the migration:
CREATE UNIQUE INDEX uq_incidents_one_open_per_monitor_type
  ON incidents (monitor_id, type) WHERE status = 'OPEN';

-- The engine opens incidents with:
INSERT INTO incidents (...) VALUES (...)
ON CONFLICT (monitor_id, type) WHERE status = 'OPEN' DO NOTHING
RETURNING id;          -- zero rows = somebody already holds the open incident
```

## 9. Seeing the serialisation point

The engine starts every observation with:

```sql
BEGIN;
SELECT ... FROM monitors WHERE id = $1 FOR UPDATE;   -- concurrent observations for this monitor queue here
INSERT INTO checks ...;
UPDATE monitors SET consecutive_failures = ..., consecutive_slow = ..., ...;
-- open / continue / resolve incidents, write evidence + events
COMMIT;
```
