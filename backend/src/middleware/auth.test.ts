import { Request, Response, NextFunction } from 'express';
import { authMiddleware } from './auth';
import { errorHandler } from './error';
import { resetAuthProviderForTests } from '../auth';
import type { AuthProvider } from '../auth/provider';

/**
 * The 401 contract.
 *
 * `auth/provider.ts` states that the core "maps every failure to a single 401 so that
 * credential validity is not distinguishable by timing or message". These tests exist to keep
 * that sentence true, because it is a property of *this* middleware rather than of the
 * provider, and nothing else in the codebase would notice if it stopped holding.
 */

jest.mock('../config/database', () => ({ prisma: { user: { findUnique: jest.fn() } } }));

const mockRes = () => {
  const res = { statusCode: 200 } as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

const mockReq = (headers: Record<string, string> = {}) =>
  ({ headers, method: 'GET', path: '/api/v1/monitors' }) as unknown as Request;

/**
 * Run the middleware and, if it delegated an error, render it exactly as Express would.
 *
 * `authMiddleware` does not write the response itself: it calls `next(error)` and the
 * application-level `errorHandler` produces the status and body. Asserting on the middleware
 * alone would therefore assert on nothing, so the two are chained here.
 */
async function run(headers: Record<string, string>): Promise<{ status?: number; body?: { error?: string } }> {
  const res = mockRes();
  const req = mockReq(headers);
  let delegated: unknown;
  const next = jest.fn((error?: unknown) => {
    delegated = error;
  }) as NextFunction;

  await authMiddleware(req, res, next);

  if (delegated) {
    errorHandler(delegated as Error, req, res, next);
  }

  const status = (res.status as jest.Mock).mock.calls[0]?.[0];
  const body = (res.json as jest.Mock).mock.calls[0]?.[0];
  return { status, body };
}

const ORIGINAL_ENV = { ...process.env };

/**
 * Install a provider for the duration of one test.
 *
 * Done through the public `AUTH_PROVIDER_MODULE` mechanism rather than by reaching into the
 * module's cache, so the middleware is exercised the same way a real deployment exercises it.
 */
function useProvider(verifyToken: AuthProvider['verifyToken']): void {
  // Path is written relative to *this* file so that it resolves to the same absolute module
  // that `auth/index.ts` requires. Jest keys mocks by resolved path, and a `./provider-x`
  // here would resolve under `src/middleware/` while the resolver looks under `src/auth/`, so
  // the mock would silently not apply and every test would get a 500.
  const moduleId = `../auth/test-provider-${Math.random().toString(36).slice(2)}`;
  process.env.AUTH_PROVIDER_MODULE = moduleId;
  jest.doMock(moduleId, () => ({ __esModule: true, default: { name: 'test-provider', verifyToken } }), {
    virtual: true,
  });
}

beforeEach(() => {
  resetAuthProviderForTests();
});

afterEach(() => {
  resetAuthProviderForTests();
  delete process.env.AUTH_PROVIDER_MODULE;
  jest.resetModules();
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('authMiddleware 401 responses', () => {
  it('rejects a request with no Authorization header', async () => {
    const { status, body } = await run({});
    expect(status).toBe(401);
    expect(body?.error).toBe('Authentication required');
  });

  it('rejects a request whose header is not a bearer token', async () => {
    for (const authorization of ['Basic dXNlcjpwYXNz', 'Bearer', 'Bearer ', 'bearer lower-case']) {
      const { status, body } = await run({ authorization });
      expect(status).toBe(401);
      expect(body?.error).toBe('Authentication required');
    }
  });

  it('rejects a token the provider does not recognise', async () => {
    useProvider(jest.fn().mockResolvedValue(null));

    const { status, body } = await run({ authorization: 'Bearer not-a-real-token' });
    expect(status).toBe(401);
    expect(body?.error).toBe('Authentication required');
  });

  it('gives the same answer whether the token was absent or unusable', async () => {
    // The whole point. Two different messages here tell a caller whether the token it sent
    // was structurally valid, which is information about the credential the caller should
    // not be able to obtain from a failed request.
    useProvider(jest.fn().mockResolvedValue(null));

    const absent = await run({});
    const unusable = await run({ authorization: 'Bearer some-token' });

    expect(unusable.status).toBe(absent.status);
    expect(unusable.body).toEqual(absent.body);
  });

  it('rejects an identity with no matching local user with a 404, not a 401', async () => {
    // The provider resolved a genuine identity, but there is no matching row in this
    // deployment's own `users` table: a deleted account whose provider has not caught up.
    //
    // 404 rather than 401 is deliberate and is the one place the two statuses differ. The
    // caller has proved who they are; there is simply no account here for them, and a 401
    // would tell them to authenticate again, which cannot help. It reveals only that the
    // identity is unknown *to this deployment*, which the caller already knows.
    const { prisma } = require('../config/database');
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    useProvider(jest.fn().mockResolvedValue({ id: 'user_1', email: 'gone@example.com' }));

    const { status } = await run({ authorization: 'Bearer valid-looking-token' });
    expect(status).toBe(404);
  });
});
