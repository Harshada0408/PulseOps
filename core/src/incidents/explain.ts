import type { EvidenceRole, IncidentType, ObservationType } from './engine';

/**
 * Deterministic explanation of an incident, derived ONLY from persisted rows.
 *
 * Output is split on purpose:
 *   facts        - statements that follow directly from stored measurements
 *   hypotheses   - possible causes to INVESTIGATE; never asserted as the cause
 *   steps        - a checklist for a human
 * No model, no randomness, no network: the same rows always give the same text.
 */
export interface EvidenceCheck {
  id: string;
  role: EvidenceRole;
  checkedAt: Date;
  statusCode: number | null;
  latencyMs: number;
  success: boolean;
  errorCategory: string | null;
  error: string | null;
  observationType: ObservationType;
}

export interface IncidentForExplanation {
  type: IncidentType;
  status: 'OPEN' | 'RESOLVED';
  observationType: ObservationType;
  triggerReason: string;
  triggerRule: {
    rule?: string;
    consecutiveRequired?: number;
    latencyThresholdMs?: number;
    recoveryRequired?: number;
  };
  startedAt: Date;
  openedAt: Date;
  recoveryStartedAt: Date | null;
  resolvedAt: Date | null;
  evidence: EvidenceCheck[];
}

export interface Explanation {
  headline: string;
  facts: string[];
  hypotheses: string[];
  investigationSteps: string[];
  recovery: string | null;
  caveat: string;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

const iso = (d: Date) => d.toISOString();

export function buildExplanation(incident: IncidentForExplanation): Explanation {
  const triggers = incident.evidence.filter((e) => e.role === 'TRIGGER');
  const healthy = incident.evidence.find((e) => e.role === 'LAST_HEALTHY');
  const recovery = incident.evidence.filter((e) => e.role === 'RECOVERY');
  const facts: string[] = [];
  const hypotheses: string[] = [];
  const steps: string[] = [];
  let headline: string;

  const simulatedNote = incident.observationType === 'SIMULATED' ? ' (SIMULATED data - no real endpoint was contacted)' : '';

  if (incident.type === 'AVAILABILITY') {
    headline = `Availability incident: ${triggers.length || incident.triggerRule.consecutiveRequired || 'several'} consecutive checks failed${simulatedNote}.`;
    facts.push(incident.triggerReason);
    const categories = new Map<string, number>();
    const codes = new Set<number>();
    for (const t of triggers) {
      const c = t.errorCategory ?? 'UNKNOWN';
      categories.set(c, (categories.get(c) ?? 0) + 1);
      if (t.statusCode) codes.add(t.statusCode);
    }
    if (categories.size) {
      facts.push(
        `Failure categories in the triggering checks: ${[...categories.entries()].map(([k, v]) => `${k} x${v}`).join(', ')}.`
      );
    }
    if (codes.size) facts.push(`HTTP status codes observed: ${[...codes].sort().join(', ')}.`);
    if (healthy) {
      facts.push(
        `Last healthy observation before the streak: ${iso(healthy.checkedAt)} (HTTP ${healthy.statusCode ?? 'n/a'}, ${healthy.latencyMs} ms).`
      );
    } else {
      facts.push('No healthy observation is stored before this streak (monitor may be new).');
    }

    if (categories.has('TIMEOUT')) {
      hypotheses.push('The service accepted or attempted connections but did not answer within the timeout: overloaded, deadlocked, or waiting on a slow dependency.');
      steps.push('Check whether the application process is running and whether its request queue / thread pool is saturated.');
    }
    if (categories.has('NETWORK')) {
      hypotheses.push('The host could not be reached (DNS failure, refused connection, or reset): process down, port closed, DNS record changed, or a network/firewall change.');
      steps.push('Resolve the hostname and test the port from another machine; compare with recent DNS or firewall changes.');
    }
    if (categories.has('TLS')) {
      hypotheses.push('A TLS problem such as an expired or mismatched certificate.');
      steps.push('Inspect the certificate chain and expiry date.');
    }
    if (categories.has('HTTP_ERROR') || [...codes].some((c) => c >= 500)) {
      hypotheses.push('The server answered but reported an error (5xx/unexpected status): application exception, failed dependency, or bad deployment.');
      steps.push('Read application error logs for the failure window and check for a deployment or config change near the start time.');
    }
    if (categories.has('VALIDATION')) {
      hypotheses.push('The endpoint responded, but the response did not satisfy the monitor’s validation rule (expected keyword/status), e.g. an error page served with HTTP 200.');
      steps.push('Fetch the endpoint manually and compare the body/status with the monitor’s validation settings.');
    }
    if (categories.has('BLOCKED')) {
      hypotheses.push('The monitor target was refused by PulseOps’ network safety policy (restricted or unresolvable destination).');
      steps.push('Verify the URL points to a public host that resolves from the PulseOps server.');
    }
    if (hypotheses.length === 0) {
      hypotheses.push('Cause cannot be narrowed from the stored measurements alone.');
    }
    steps.push('Confirm the failure from a second vantage point (manual request) to rule out a PulseOps-side network problem.');
  } else {
    const threshold = incident.triggerRule.latencyThresholdMs;
    const latencies = triggers.map((t) => t.latencyMs);
    const med = latencies.length ? median(latencies) : null;
    headline = `Latency incident: endpoint is responding but slower than ${threshold ?? '?'} ms${simulatedNote}.`;
    facts.push(incident.triggerReason);
    if (latencies.length) {
      facts.push(`Triggering latencies: ${latencies.join(', ')} ms (median ${med} ms vs threshold ${threshold} ms).`);
    }
    const codes = [...new Set(triggers.map((t) => t.statusCode).filter((c): c is number => c != null))];
    if (codes.length) facts.push(`HTTP status during the slow responses: ${codes.join(', ')} - the endpoint is slow but responding.`);
    if (healthy) {
      facts.push(
        `Last observation within the threshold: ${iso(healthy.checkedAt)} at ${healthy.latencyMs} ms` +
          (med && healthy.latencyMs > 0 ? ` (slow median is ${(med / healthy.latencyMs).toFixed(1)}x that).` : '.')
      );
    } else {
      facts.push('No within-threshold observation is stored before this streak.');
    }
    hypotheses.push(
      'Slow database queries or lock contention.',
      'A slow or degraded upstream/third-party dependency.',
      'Increased request load or resource saturation (CPU, memory, connection pool).',
      'Application-side processing change, e.g. a recent deployment or cache miss storm.'
    );
    steps.push(
      'Compare request volume and CPU/memory around the start time with the baseline.',
      'Check database slow-query logs and connection-pool metrics for the window.',
      'Trace one slow request end-to-end to see which dependency consumes the time.',
      'Check whether a deployment or configuration change landed near the start time.'
    );
  }

  let recoveryText: string | null = null;
  if (incident.status === 'RESOLVED' && incident.resolvedAt) {
    const lat = recovery.map((r) => `${r.latencyMs} ms`).join(', ');
    recoveryText =
      `Resolved at ${iso(incident.resolvedAt)}. Recovery began with the check at ${incident.recoveryStartedAt ? iso(incident.recoveryStartedAt) : 'n/a'}; ` +
      `${recovery.length} consecutive qualifying checks` +
      (lat ? ` (${lat})` : '') +
      ` satisfied the recovery rule (${incident.triggerRule.recoveryRequired ?? '?'} required).`;
  }

  return {
    headline,
    facts,
    hypotheses,
    investigationSteps: steps,
    recovery: recoveryText,
    caveat:
      'Facts come directly from stored check results. Hypotheses are possible areas to investigate, not confirmed causes; PulseOps has no telemetry from inside your service.',
  };
}

// ── Timeline ─────────────────────────────────────────────────────────────────

export interface TimelineEventRow {
  id: string;
  type: 'OPENED' | 'RESOLVED';
  occurredAt: Date;
  message: string;
}

export interface TimelineEntry {
  /** Instant the entry refers to. For a CHECK that is when the check ran; for an EVENT when the state changed. */
  at: string;
  kind: 'CHECK' | 'EVENT';
  /** 'observed' = a measurement; 'state_change' = PulseOps changed the incident state. */
  timeBasis: 'observed' | 'state_change';
  label: string;
  detail: string;
  role?: EvidenceRole;
  eventType?: 'OPENED' | 'RESOLVED';
  checkId?: string;
  statusCode?: number | null;
  latencyMs?: number;
  success?: boolean;
  errorCategory?: string | null;
  observationType?: ObservationType;
}

const ROLE_LABEL: Record<EvidenceRole, string> = {
  LAST_HEALTHY: 'Last healthy observation',
  TRIGGER: 'Triggering check',
  CONTINUING: 'Condition continued',
  RECOVERY: 'Recovery check',
};

export function buildTimeline(evidence: EvidenceCheck[], events: TimelineEventRow[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const e of evidence) {
    const parts = [
      e.statusCode != null ? `HTTP ${e.statusCode}` : 'no HTTP response',
      `${e.latencyMs} ms`,
      e.success ? 'success' : `failed${e.errorCategory ? ` (${e.errorCategory})` : ''}`,
    ];
    entries.push({
      at: e.checkedAt.toISOString(),
      kind: 'CHECK',
      timeBasis: 'observed',
      label: ROLE_LABEL[e.role],
      detail: parts.join(' · ') + (e.error ? ` · ${e.error}` : ''),
      role: e.role,
      checkId: e.id,
      statusCode: e.statusCode,
      latencyMs: e.latencyMs,
      success: e.success,
      errorCategory: e.errorCategory,
      observationType: e.observationType,
    });
  }
  for (const ev of events) {
    entries.push({
      at: ev.occurredAt.toISOString(),
      kind: 'EVENT',
      timeBasis: 'state_change',
      label: ev.type === 'OPENED' ? 'Incident opened' : 'Incident resolved',
      detail: ev.message,
      eventType: ev.type,
    });
  }
  // Chronological. At equal instants, measurements sort before the state change they caused.
  return entries.sort((a, b) => a.at.localeCompare(b.at) || (a.kind === b.kind ? 0 : a.kind === 'CHECK' ? -1 : 1));
}
