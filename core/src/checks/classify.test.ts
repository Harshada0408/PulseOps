import { describe, expect, it } from '@jest/globals';
import { classifyFailure, safeErrorDetail } from './classify';
import { RESPONSE_TOO_LARGE_MESSAGE } from '../config/response-limit';

const down = (error: string, statusCode?: number) => ({ status: 'down' as const, responseTime: 10, error, statusCode });

describe('classifyFailure (uses the executor’s literal messages)', () => {
  it('returns null for up and degraded results (both are successful responses)', () => {
    expect(classifyFailure({ status: 'up', statusCode: 200, responseTime: 5 })).toBeNull();
    expect(classifyFailure({ status: 'degraded', statusCode: 200, responseTime: 5 })).toBeNull();
  });
  it.each([
    ['Request timed out after 5000ms', undefined, 'TIMEOUT'],
    ['Connection failed: getaddrinfo ENOTFOUND nope.example', undefined, 'NETWORK'],
    ['Connection failed: connect ECONNREFUSED 1.2.3.4:80', undefined, 'NETWORK'],
    ['SSL certificate expired', undefined, 'TLS'],
    ['Expected 2xx status, got 503', 503, 'HTTP_ERROR'],
    ['Expected status 201, got 200', 200, 'HTTP_ERROR'],
    ['Expected keyword "ok" not found', 200, 'VALIDATION'],
    ['Monitor target resolves to a restricted network destination.', undefined, 'BLOCKED'],
    ['Monitor target hostname could not be resolved.', undefined, 'NETWORK'],
    ['Monitor URL must use http or https.', undefined, 'BLOCKED'],
    [RESPONSE_TOO_LARGE_MESSAGE, 200, 'RESPONSE_TOO_LARGE'],
    ['Too many redirects (limit 5).', 302, 'NETWORK'],
    ['something odd', 502, 'HTTP_ERROR'],
    ['something odd', undefined, 'UNKNOWN'],
  ])('%s -> %s', (error, code, expected) => {
    expect(classifyFailure(down(error as string, code as number | undefined))).toBe(expected);
  });
});

describe('safeErrorDetail', () => {
  it('strips control characters and truncates', () => {
    expect(safeErrorDetail('a\u0000b\nc')).toBe('a b c');
    expect(safeErrorDetail('x'.repeat(500))!.length).toBe(300);
    expect(safeErrorDetail(undefined)).toBeNull();
  });
});
