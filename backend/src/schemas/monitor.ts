import { z } from 'zod';

/**
 * Request schemas for the monitor routes. They live apart from the route module so tests can
 * import them without pulling in Prisma/env (see git history for why that matters in CI).
 *
 * Shape validation only. The security boundary for WHERE requests may go is the SSRF policy in
 * @pulseops/core (checked again at creation time by the service, and on every real request by
 * the executor, including on redirects).
 */
export const monitorUrlSchema = z
  .string()
  .max(2048)
  .url('Invalid URL')
  .refine((value) => /^https?:\/\//i.test(value), { message: 'URL must use http or https' });

const headersSchema = z
  .record(z.string().min(1).max(100), z.string().max(2000))
  .refine((h) => Object.keys(h).length <= 20, { message: 'At most 20 headers' });

const baseShape = {
  name: z.string().trim().min(1, 'Name is required').max(100),
  url: monitorUrlSchema,
  method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  headers: headersSchema.optional(),
  body: z.string().max(10_000).optional(),
  interval: z.number().int().min(30, 'Minimum interval is 30 seconds').max(3600),
  timeout: z.number().int().min(1).max(120),
  latencyThresholdMs: z.number().int().min(50).max(600_000),
  failureThreshold: z.number().int().min(1).max(20),
  latencyBreachThreshold: z.number().int().min(1).max(20),
  recoveryThreshold: z.number().int().min(1).max(20),
  expectedStatus: z.number().int().min(100).max(599).nullish(),
  expectedKeyword: z.string().max(200).nullish(),
  region: z.string().max(50),
  isActive: z.boolean(),
};

const timeoutVsLatency = (v: { timeout?: number; latencyThresholdMs?: number }) =>
  v.timeout === undefined || v.latencyThresholdMs === undefined || v.latencyThresholdMs < v.timeout * 1000;
const timeoutVsLatencyMessage = {
  message: 'Latency threshold must be lower than the timeout (otherwise it could never trigger)',
  path: ['latencyThresholdMs'],
};

// `.strict()` rejects unknown keys, which blocks mass-assignment of fields such as is_simulated.
export const createMonitorSchema = z
  .object({
    name: baseShape.name,
    url: baseShape.url,
    method: baseShape.method,
    headers: headersSchema.default({}),
    body: baseShape.body,
    interval: baseShape.interval.default(300),
    timeout: baseShape.timeout.default(30),
    latencyThresholdMs: baseShape.latencyThresholdMs.default(1000),
    failureThreshold: baseShape.failureThreshold.default(3),
    latencyBreachThreshold: baseShape.latencyBreachThreshold.default(3),
    recoveryThreshold: baseShape.recoveryThreshold.default(2),
    expectedStatus: baseShape.expectedStatus,
    expectedKeyword: baseShape.expectedKeyword,
    region: baseShape.region.default('global'),
    isActive: baseShape.isActive.default(true),
  })
  .strict()
  .refine(timeoutVsLatency, timeoutVsLatencyMessage);

export const updateMonitorSchema = z
  .object({
    name: baseShape.name,
    url: baseShape.url,
    method: baseShape.method,
    headers: baseShape.headers,
    body: baseShape.body,
    interval: baseShape.interval,
    timeout: baseShape.timeout,
    latencyThresholdMs: baseShape.latencyThresholdMs,
    failureThreshold: baseShape.failureThreshold,
    latencyBreachThreshold: baseShape.latencyBreachThreshold,
    recoveryThreshold: baseShape.recoveryThreshold,
    expectedStatus: baseShape.expectedStatus,
    expectedKeyword: baseShape.expectedKeyword,
    region: baseShape.region,
    isActive: baseShape.isActive,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })
  .refine(timeoutVsLatency, timeoutVsLatencyMessage);

export const WINDOWS = { '1h': 3600, '24h': 86_400, '7d': 604_800, '30d': 2_592_000 } as const;
export type WindowKey = keyof typeof WINDOWS;

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const modeSchema = z.enum(['real', 'simulated']).default('real');
export const windowSchema = z.enum(['1h', '24h', '7d', '30d']).default('24h');
export const uuidSchema = z.string().uuid();
