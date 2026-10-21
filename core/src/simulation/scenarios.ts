import type { Observation } from '../incidents/engine';

/**
 * Deterministic demo fixtures. There is no randomness and NO network access: a scenario is
 * just a list of observations that is fed through the same incident engine as real checks.
 * The monitor they belong to is flagged is_simulated, every resulting check is stored with
 * observation_type = 'SIMULATED', and the scheduler never touches simulated monitors.
 */
export type ScenarioId =
  | 'healthy'
  | 'slow'
  | 'failing'
  | 'recover_failure'
  | 'recover_latency'
  | 'full_story';

export const SIMULATION_MONITOR = {
  name: 'Orders API [SIMULATED]',
  // .invalid is reserved by RFC 2606 and can never resolve; it is shown only as a label.
  url: 'https://orders.simulated.invalid/health',
  method: 'GET',
  interval: 30,
  timeout: 5,
  latencyThresholdMs: 1000,
  failureThreshold: 3,
  latencyBreachThreshold: 3,
  recoveryThreshold: 2,
} as const;

type Step = Omit<Observation, 'observedAt'>;

const ok = (latencyMs: number): Step => ({
  success: true, status: 'up', statusCode: 200, latencyMs, errorCategory: null, error: null,
});
const http503 = (latencyMs: number): Step => ({
  success: false, status: 'down', statusCode: 503, latencyMs, errorCategory: 'HTTP_ERROR',
  error: 'Expected 2xx status, got 503',
});
const timeout = (): Step => ({
  success: false, status: 'down', statusCode: null, latencyMs: 5000, errorCategory: 'TIMEOUT',
  error: 'Request timed out after 5000ms',
});

const HEALTHY: Step[] = [118, 124, 131, 119, 127].map(ok);
const SLOW: Step[] = [2310, 2480, 2395, 2520].map(ok);
const FAILING: Step[] = [http503(212), http503(198), timeout(), http503(205)];
const RECOVER_FAILURE: Step[] = [140, 133, 129].map(ok);
const RECOVER_LATENCY: Step[] = [180, 150, 145].map(ok);

export const SCENARIOS: Record<ScenarioId, { title: string; description: string; steps: Step[] }> = {
  healthy: {
    title: '1. Healthy endpoint',
    description: '5 fast 200 responses (~120 ms). No incident should open.',
    steps: HEALTHY,
  },
  slow: {
    title: '2. Slow but responding',
    description: '4 HTTP 200 responses at ~2.4 s against a 1000 ms threshold. A LATENCY incident opens on the 3rd slow check.',
    steps: SLOW,
  },
  failing: {
    title: '3. Repeated failures',
    description: 'HTTP 503s and a timeout. An AVAILABILITY incident opens on the 3rd consecutive failure.',
    steps: FAILING,
  },
  recover_failure: {
    title: '4. Recovery after failure',
    description: '3 healthy responses. The AVAILABILITY incident resolves after 2 consecutive successes.',
    steps: RECOVER_FAILURE,
  },
  recover_latency: {
    title: '5. Latency back under threshold',
    description: '3 fast responses. The LATENCY incident resolves after 2 consecutive within-threshold responses.',
    steps: RECOVER_LATENCY,
  },
  full_story: {
    title: 'Full walkthrough (1 → 5)',
    description: 'Runs all five scenarios in order: healthy, slow, recover latency, failing, recover availability.',
    steps: [...HEALTHY, ...SLOW, ...RECOVER_LATENCY, ...FAILING, ...RECOVER_FAILURE],
  },
};

export const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];
