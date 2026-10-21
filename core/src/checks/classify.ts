import { RESPONSE_TOO_LARGE_MESSAGE } from '../config/response-limit';

export const ERROR_CATEGORIES = [
  'HTTP_ERROR',
  'TIMEOUT',
  'NETWORK',
  'TLS',
  'BLOCKED',
  'VALIDATION',
  'RESPONSE_TOO_LARGE',
  'UNKNOWN',
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export interface ExecutorResultLike {
  status: 'up' | 'down' | 'degraded';
  statusCode?: number;
  responseTime: number;
  error?: string;
}

/**
 * Map the executor's result onto an error category.
 *
 * The hardened executor reports failures as human-readable strings. Rather than change its
 * (heavily tested) return contract, categories are derived here from those messages. The
 * mapping is covered by tests that use the executor's literal message formats, and anything
 * unrecognised falls back to HTTP_ERROR (if a status code exists) or UNKNOWN - it is never
 * silently treated as healthy.
 *
 * Returns null for a result that counts as a success ('up' or 'degraded').
 */
export function classifyFailure(result: ExecutorResultLike): ErrorCategory | null {
  if (result.status !== 'down') return null;
  const message = (result.error ?? '').toLowerCase();

  if (message.includes('timed out') || message.includes('timeout')) return 'TIMEOUT';
  if (message === RESPONSE_TOO_LARGE_MESSAGE.toLowerCase()) return 'RESPONSE_TOO_LARGE';
  if (message.includes('restricted network destination') || message.includes('redirect could not be followed safely')) {
    return 'BLOCKED';
  }
  if (
    message.includes('must use http') ||
    message.includes('invalid monitor url') ||
    message.includes('embedded credentials')
  ) {
    return 'BLOCKED';
  }
  // DNS failure is a reachability problem (the name may simply have been removed), not a policy block.
  if (message.includes('could not be resolved')) return 'NETWORK';
  if (message.includes('certificate') || message.includes('ssl') || message.includes('tls')) return 'TLS';
  if (message.startsWith('expected keyword')) return 'VALIDATION';
  if (message.startsWith('expected status') || message.startsWith('expected 2xx')) return 'HTTP_ERROR';
  if (
    message.includes('connection failed') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('econnreset') ||
    message.includes('socket hang up') ||
    message.includes('too many redirects')
  ) {
    return 'NETWORK';
  }
  if (typeof result.statusCode === 'number' && result.statusCode >= 100) return 'HTTP_ERROR';
  return 'UNKNOWN';
}

/** Truncate and strip control characters so stored error text is safe to display. */
export function safeErrorDetail(error: string | undefined | null, max = 300): string | null {
  if (!error) return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = error.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}
