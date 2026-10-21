const DEFAULT_API_URL = 'http://localhost:3001';

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function stripApiV1(url: string): string {
  return url.replace(/\/api\/v1\/?$/, '');
}

/**
 * Returns the backend root URL (without the `/api/v1` version prefix).
 *
 * This is resilient to `NEXT_PUBLIC_API_URL` being configured either as the
 * bare backend root (e.g. `https://api.example.com`) or as the versioned
 * endpoint (e.g. `https://api.example.com/api/v1`): a stray `/api/v1` suffix
 * is stripped so callers can always append `/api/v1` themselves without
 * producing a doubled `/api/v1/api/v1` path.
 */
export function getApiRoot(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL;
  return stripTrailingSlash(stripApiV1(raw));
}

/**
 * The full versioned API base URL (backend root + `/api/v1`).
 */
export function getApiV1BaseUrl(): string {
  return `${getApiRoot()}/api/v1`;
}
