import { createMonitorSchema, updateMonitorSchema } from '../schemas/monitor';

describe('Monitor Routes Validation', () => {
  describe('createMonitorSchema', () => {
    it('should validate a valid monitor creation request', () => {
      const validData = {
        name: 'Test Monitor',
        url: 'https://example.com',
        method: 'GET',
        interval: 300,
        timeout: 30,
        expectedStatus: 200,
      };

      const result = createMonitorSchema.safeParse(validData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          ...validData,
          headers: {},
          interval: 300,
          method: 'GET',
          region: 'global',
          timeout: 30,
          // PulseOps detection settings (defaults)
          latencyThresholdMs: 1000,
          failureThreshold: 3,
          latencyBreachThreshold: 3,
          recoveryThreshold: 2,
          isActive: true,
        });
      }
    });

    it('should reject invalid URL', () => {
      const invalidData = {
        name: 'Test Monitor',
        url: 'not-a-url',
        method: 'GET',
      };

      const result = createMonitorSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should require name and url', () => {
      const invalidData = {
        method: 'GET',
      };

      const result = createMonitorSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it.each(['file:///etc/passwd', 'ftp://example.com', 'gopher://example.com', 'ws://example.com'])(
      'should reject a %s target',
      (url) => {
        const result = createMonitorSchema.safeParse({ name: 'Test Monitor', url });
        expect(result.success).toBe(false);
      }
    );

    it.each([
      'http://example.com',
      'https://example.com',
      'HTTPS://example.com',
      'https://example.com:8443/health?x=1',
    ])('should accept %s', (url) => {
      expect(createMonitorSchema.safeParse({ name: 'Test Monitor', url }).success).toBe(true);
    });

    it('should accept a syntactically valid but internal URL, because the worker policy enforces that', () => {
      // Deliberate. This schema checks shape and scheme only. A private or metadata
      // address is syntactically valid and is refused at request time by
      // core/src/security, not here. Asserting rejection here would be a false claim
      // about where the boundary is.
      const result = createMonitorSchema.safeParse({
        name: 'Internal',
        url: 'http://169.254.169.254/latest/meta-data/',
      });
      expect(result.success).toBe(true);
    });

    it('should apply defaults', () => {
      const data = {
        name: 'Test Monitor',
        url: 'https://example.com',
      };

      const result = createMonitorSchema.parse(data);
      expect(result.method).toBe('GET');
      expect(result.interval).toBe(300);
      expect(result.timeout).toBe(30);
      expect(result.headers).toEqual({});
    });
  });

  describe('updateMonitorSchema', () => {
    it('should allow partial updates', () => {
      const partialData = {
        name: 'Updated Name',
      };

      const result = updateMonitorSchema.safeParse(partialData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(partialData);
      }
    });
  });

  describe('PulseOps detection settings', () => {
    const base = { name: 'M', url: 'https://example.com' };
    it('accepts custom thresholds', () => {
      const r = createMonitorSchema.safeParse({ ...base, failureThreshold: 5, latencyThresholdMs: 750, recoveryThreshold: 3 });
      expect(r.success).toBe(true);
    });
    it.each([
      ['failureThreshold', 0], ['failureThreshold', 21], ['latencyThresholdMs', 10], ['recoveryThreshold', 0],
      ['interval', 5], ['timeout', 0], ['latencyBreachThreshold', 99],
    ])('rejects %s=%s', (key, value) => {
      expect(createMonitorSchema.safeParse({ ...base, [key]: value }).success).toBe(false);
    });
    it('rejects a latency threshold that can never trigger (>= timeout)', () => {
      expect(createMonitorSchema.safeParse({ ...base, timeout: 5, latencyThresholdMs: 5000 }).success).toBe(false);
      expect(createMonitorSchema.safeParse({ ...base, timeout: 5, latencyThresholdMs: 4999 }).success).toBe(true);
    });
    it('rejects unknown keys so fields like isSimulated cannot be mass-assigned', () => {
      expect(createMonitorSchema.safeParse({ ...base, isSimulated: true }).success).toBe(false);
      expect(updateMonitorSchema.safeParse({ isSimulated: true }).success).toBe(false);
      expect(updateMonitorSchema.safeParse({ consecutiveFailures: 99 }).success).toBe(false);
    });
    it('rejects an empty update', () => {
      expect(updateMonitorSchema.safeParse({}).success).toBe(false);
    });
  });
});
