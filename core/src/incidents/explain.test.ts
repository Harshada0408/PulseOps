import { describe, expect, it } from '@jest/globals';
import { buildExplanation, buildTimeline, type EvidenceCheck, type IncidentForExplanation } from './explain';

const ev = (id: string, role: EvidenceCheck['role'], sec: number, o: Partial<EvidenceCheck> = {}): EvidenceCheck => ({
  id, role, checkedAt: new Date(Date.UTC(2026, 0, 1, 12, 0, sec)), statusCode: 200, latencyMs: 120, success: true,
  errorCategory: null, error: null, observationType: 'REAL', ...o,
});

const latencyIncident = (): IncidentForExplanation => ({
  type: 'LATENCY', status: 'RESOLVED', observationType: 'REAL',
  triggerReason: '3 consecutive successful responses slower than 1000 ms (configured threshold: 3 consecutive).',
  triggerRule: { rule: 'CONSECUTIVE_SLOW_RESPONSES', consecutiveRequired: 3, latencyThresholdMs: 1000, recoveryRequired: 2 },
  startedAt: new Date(Date.UTC(2026, 0, 1, 12, 0, 30)), openedAt: new Date(Date.UTC(2026, 0, 1, 12, 1, 31)),
  recoveryStartedAt: new Date(Date.UTC(2026, 0, 1, 12, 2, 0)), resolvedAt: new Date(Date.UTC(2026, 0, 1, 12, 2, 31)),
  evidence: [
    ev('h', 'LAST_HEALTHY', 0, { latencyMs: 100 }),
    ev('t1', 'TRIGGER', 30, { latencyMs: 2000 }), ev('t2', 'TRIGGER', 60, { latencyMs: 2400 }), ev('t3', 'TRIGGER', 90, { latencyMs: 2200 }),
    ev('r1', 'RECOVERY', 120, { latencyMs: 150 }), ev('r2', 'RECOVERY', 150, { latencyMs: 140 }),
  ],
});

describe('buildExplanation', () => {
  it('latency incident: states the endpoint is slow but responding, and keeps hypotheses separate from facts', () => {
    const x = buildExplanation(latencyIncident());
    expect(x.headline).toMatch(/responding but slower than 1000 ms/);
    expect(x.facts.join(' ')).toContain('slow but responding');
    expect(x.facts.join(' ')).toContain('2000, 2400, 2200 ms (median 2200 ms');
    expect(x.hypotheses.join(' ')).toMatch(/database/i);
    // hypotheses must never be phrased as established causes
    expect(x.facts.join(' ')).not.toMatch(/caused by/i);
    expect(x.caveat).toMatch(/not confirmed causes/);
    expect(x.recovery).toContain('2 consecutive qualifying checks');
  });

  it('availability incident: derives hypotheses from the observed error categories only', () => {
    const x = buildExplanation({
      type: 'AVAILABILITY', status: 'OPEN', observationType: 'REAL', triggerReason: '3 consecutive failed checks',
      triggerRule: { consecutiveRequired: 3 }, startedAt: new Date(), openedAt: new Date(), recoveryStartedAt: null, resolvedAt: null,
      evidence: [
        ev('t1', 'TRIGGER', 1, { success: false, statusCode: null, errorCategory: 'TIMEOUT', latencyMs: 5000 }),
        ev('t2', 'TRIGGER', 2, { success: false, statusCode: null, errorCategory: 'TIMEOUT', latencyMs: 5000 }),
        ev('t3', 'TRIGGER', 3, { success: false, statusCode: null, errorCategory: 'TIMEOUT', latencyMs: 5000 }),
      ],
    });
    expect(x.facts.join(' ')).toContain('TIMEOUT x3');
    expect(x.hypotheses.join(' ')).toMatch(/did not answer within the timeout/);
    expect(x.hypotheses.join(' ')).not.toMatch(/certificate/);
    expect(x.facts.join(' ')).toMatch(/No healthy observation is stored/);
    expect(x.recovery).toBeNull();
  });

  it('labels simulated incidents', () => {
    const inc = latencyIncident();
    inc.observationType = 'SIMULATED';
    expect(buildExplanation(inc).headline).toContain('SIMULATED');
  });
});

describe('buildTimeline', () => {
  it('orders chronologically and distinguishes observed time from state-change time', () => {
    const inc = latencyIncident();
    const t = buildTimeline(inc.evidence, [
      { id: 'e1', type: 'OPENED', occurredAt: new Date(Date.UTC(2026, 0, 1, 12, 1, 31)), message: 'opened' },
      { id: 'e2', type: 'RESOLVED', occurredAt: new Date(Date.UTC(2026, 0, 1, 12, 2, 31)), message: 'resolved' },
    ]);
    expect(t.map((x) => x.label)).toEqual([
      'Last healthy observation', 'Triggering check', 'Triggering check', 'Triggering check',
      'Incident opened', 'Recovery check', 'Recovery check', 'Incident resolved',
    ]);
    expect(t.filter((x) => x.kind === 'EVENT').every((x) => x.timeBasis === 'state_change')).toBe(true);
    expect(t.filter((x) => x.kind === 'CHECK').every((x) => x.timeBasis === 'observed')).toBe(true);
    expect([...t].map((x) => x.at)).toEqual([...t].map((x) => x.at).sort());
  });
});
