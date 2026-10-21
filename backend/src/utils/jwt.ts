import { createHmac, timingSafeEqual } from 'node:crypto';

/** Minimal HS256 JWT (header.payload.signature). Used only by the built-in local auth mode. */
const b64 = (input: Buffer | string) => Buffer.from(input).toString('base64url');

export interface TokenPayload {
  sub: string;
  email: string;
  typ: 'access' | 'refresh';
  iat: number;
  exp: number;
}

export function signToken(
  claims: { sub: string; email: string; typ: 'access' | 'refresh' },
  secret: string,
  ttlSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000)
): string {
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64(JSON.stringify({ ...claims, iat: nowSeconds, exp: nowSeconds + ttlSeconds }));
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

/** Returns the payload for a valid, unexpired token of the expected type; otherwise null (never throws). */
export function verifyToken(
  token: string,
  secret: string,
  expectedType: 'access' | 'refresh',
  nowSeconds = Math.floor(Date.now() / 1000)
): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts;
    const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    if (parsedHeader.alg !== 'HS256') return null; // refuse "none" and any other algorithm
    const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
    const actual = Buffer.from(sig, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenPayload;
    if (claims.typ !== expectedType || typeof claims.sub !== 'string' || claims.exp <= nowSeconds) return null;
    return claims;
  } catch {
    return null;
  }
}
