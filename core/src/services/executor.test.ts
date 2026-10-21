/**
 * Redirect control-flow tests for the executor.
 *
 * The destination policy is mocked here so that loopback servers can stand in for
 * public hosts. That splits the two responsibilities cleanly: this file proves the
 * executor re-validates every hop and respects its limits, and
 * `executor.e2e.test.ts` proves the real policy refuses loopback with a real socket
 * listening. Neither test would be meaningful on its own.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { executeCheck } from './executor';

// The mock factory is hoisted above module-level `const`s, so the spies are created
// inside it and pulled back out through the mocked module.
jest.mock('../security/ssrf-policy', () => {
  const actual = jest.requireActual('../security/ssrf-policy');
  const nodeDns = jest.requireActual('node:dns');
  return {
    ...actual,
    validateMonitorTarget: jest.fn(),
    // Resolve honestly but apply no policy, so loopback servers behave like public
    // hosts for the redirect logic under test.
    createGuardedLookup: () => (
      hostname: string,
      options: unknown,
      callback: (err: Error | null, address?: unknown, family?: number) => void
    ) => {
      nodeDns.lookup(hostname, options as never, callback as never);
    },
  };
});

import { validateMonitorTarget } from '../security/ssrf-policy';

const validateMock = validateMonitorTarget as unknown as jest.Mock;

interface Harness {
  url: string;
  port: number;
  hits: number;
  close: () => Promise<void>;
}

/** Start a loopback server and return its address plus a hit counter. */
async function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<Harness> {
  const state = { hits: 0 };
  const server = http.createServer((req, res) => {
    state.hits += 1;
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    get hits() {
      return state.hits;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function allowAll() {
  validateMock.mockImplementation(async (raw: string) => {
    const url = new URL(raw);
    return {
      allowed: true,
      url,
      hostname: url.hostname,
      addresses: [{ address: '93.184.216.34', family: 4 }],
    };
  });
}

function allowThenReject(rejection: { code: string; publicMessage: string; detail: string }) {
  let calls = 0;
  validateMock.mockImplementation(async (raw: string) => {
    calls += 1;
    if (calls === 1) {
      const url = new URL(raw);
      return {
        allowed: true,
        url,
        hostname: url.hostname,
        addresses: [{ address: '93.184.216.34', family: 4 }],
      };
    }
    return { allowed: false, ...rejection };
  });
}

const RESTRICTED = {
  code: 'restricted-destination',
  publicMessage: 'Monitor target resolves to a restricted network destination.',
  detail: '127.0.0.1 is loopback',
};

let servers: Harness[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
  validateMock.mockReset();
  jest.restoreAllMocks();
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('executor — redirect handling', () => {
  it('follows a public to public redirect and reports the final response', async () => {
    const target = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('final');
    });
    servers.push(target);

    const origin = await startServer((_req, res) => {
      res.writeHead(302, { Location: `${target.url}/landing` });
      res.end();
    });
    servers.push(origin);

    allowAll();
    const result = await executeCheck(`${origin.url}/start`);

    expect(result.status).toBe('up');
    expect(result.statusCode).toBe(200);
    expect(target.hits).toBe(1);
    // Both hops were validated, not just the first.
    expect(validateMock).toHaveBeenCalledTimes(2);
    expect(validateMock.mock.calls[1][0]).toBe(`${target.url}/landing`);
  });

  it.each([
    ['private address', 'http://10.0.0.1/admin'],
    ['localhost', 'http://localhost:8080/admin'],
    ['loopback literal', 'http://127.0.0.1:8080/admin'],
    ['metadata endpoint', 'http://169.254.169.254/latest/meta-data/'],
  ])('refuses a redirect to a %s and never contacts it', async (_label, location) => {
    const origin = await startServer((_req, res) => {
      res.writeHead(302, { Location: location });
      res.end();
    });
    servers.push(origin);

    allowThenReject(RESTRICTED);
    const result = await executeCheck(`${origin.url}/start`);

    expect(result.status).toBe('down');
    expect(result.error).toBe(RESTRICTED.publicMessage);
    expect(validateMock).toHaveBeenCalledTimes(2);
  });

  it('follows a chain of allowed redirects', async () => {
    const hops: string[] = [];
    const last = await startServer((_req, res) => {
      hops.push('last');
      res.writeHead(200);
      res.end('done');
    });
    servers.push(last);

    const second = await startServer((_req, res) => {
      hops.push('second');
      res.writeHead(302, { Location: `${last.url}/` });
      res.end();
    });
    servers.push(second);

    const first = await startServer((_req, res) => {
      hops.push('first');
      res.writeHead(301, { Location: `${second.url}/` });
      res.end();
    });
    servers.push(first);

    allowAll();
    const result = await executeCheck(`${first.url}/`);

    expect(result.status).toBe('up');
    expect(hops).toEqual(['first', 'second', 'last']);
    expect(validateMock).toHaveBeenCalledTimes(3);
  });

  it('enforces a finite redirect limit', async () => {
    // A loop: every response points back to the same server.
    let self: Harness;
    self = await startServer((_req, res) => {
      res.writeHead(302, { Location: `${self.url}/again` });
      res.end();
    });
    servers.push(self);

    allowAll();
    const result = await executeCheck(`${self.url}/`);

    expect(result.status).toBe('down');
    expect(result.error).toMatch(/Too many redirects/);
    // One initial request plus MAX_REDIRECTS follow-ups, then it gives up.
    expect(self.hits).toBeLessThanOrEqual(6);
    expect(self.hits).toBeGreaterThan(1);
  });

  it('resolves a relative Location against the current URL', async () => {
    const target = await startServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    servers.push(target);

    const origin = await startServer((_req, res) => {
      res.writeHead(302, { Location: '/relative/path' });
      res.end();
    });
    servers.push(origin);

    allowAll();
    await executeCheck(`${origin.url}/deep/start`);

    expect(validateMock.mock.calls[1][0]).toBe(`${origin.url}/relative/path`);
  });

  it('fails safely when a redirect carries no usable Location', async () => {
    const origin = await startServer((_req, res) => {
      res.writeHead(302);
      res.end();
    });
    servers.push(origin);

    allowAll();
    const result = await executeCheck(`${origin.url}/`);

    expect(result.status).toBe('down');
    expect(result.error).toBe('Redirect could not be followed safely.');
  });

  it('treats an unparseable Location as a relative reference and stops at the limit', async () => {
    // RFC 7231 allows a relative Location, so a malformed one stays on the current
    // origin. The important property is that it terminates instead of looping.
    const origin = await startServer((_req, res) => {
      res.writeHead(302, { Location: 'ht!tp://[bad' });
      res.end();
    });
    servers.push(origin);

    allowAll();
    const result = await executeCheck(`${origin.url}/`);

    expect(result.status).toBe('down');
    expect(result.error).toMatch(/Too many redirects/);
    expect(origin.hits).toBeLessThanOrEqual(6);
  });

  it.each(['file:///etc/passwd', 'gopher://example.com:70/_x', 'javascript:alert(1)'])(
    'refuses a redirect that switches to the %s scheme',
    async (location) => {
      const origin = await startServer((_req, res) => {
        res.writeHead(302, { Location: location });
        res.end();
      });
      servers.push(origin);

      allowThenReject({
        code: 'protocol-not-allowed',
        publicMessage: 'Monitor URL must use http or https.',
        detail: `scheme is not supported: ${location}`,
      });

      const result = await executeCheck(`${origin.url}/`);
      expect(result.status).toBe('down');
      expect(result.error).toBe('Monitor URL must use http or https.');
    }
  );

  it('re-validates a cross-origin redirect as a new destination', async () => {
    const target = await startServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    servers.push(target);

    const origin = await startServer((_req, res) => {
      res.writeHead(302, { Location: `http://internal.example.test${target.port}/` });
      res.end();
    });
    servers.push(origin);

    allowAll();
    await executeCheck(`${origin.url}/`);

    // The second hop was checked as its own destination, hostname and all.
    expect(validateMock).toHaveBeenCalledTimes(2);
    expect(validateMock.mock.calls[1][0]).toContain('internal.example.test');
  });

  it('rejects the very first target when the policy refuses it', async () => {
    validateMock.mockResolvedValue({ allowed: false, ...RESTRICTED });
    const result = await executeCheck('http://169.254.169.254/latest/meta-data/');

    expect(result.status).toBe('down');
    expect(result.error).toBe(RESTRICTED.publicMessage);
    expect(validateMock).toHaveBeenCalledTimes(1);
  });
});

describe('executor — method and body across redirects', () => {
  it('turns a 303 into a GET and drops the body', async () => {
    let observed: { method?: string; body: string } = { body: '' };
    const target = await startServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        observed = { method: req.method, body };
        res.writeHead(200);
        res.end();
      });
    });
    servers.push(target);

    const origin = await startServer((_req, res) => {
      res.writeHead(303, { Location: `${target.url}/` });
      res.end();
    });
    servers.push(origin);

    allowAll();
    await executeCheck(`${origin.url}/`, 'POST', {}, 'payload=1');

    expect(observed.method).toBe('GET');
    expect(observed.body).toBe('');
  });

  it.each([307, 308])('preserves the method and body across a same-origin %i', async (status) => {
    let observed: { method?: string; body: string } = { body: '' };
    const target = await startServer((req, res) => {
      if (req.url === '/redirected') {
        res.writeHead(status, { Location: '/final' });
        res.end();
        return;
      }
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        observed = { method: req.method, body };
        res.writeHead(200);
        res.end();
      });
    });
    servers.push(target);

    allowAll();
    const result = await executeCheck(`${target.url}/redirected`, 'POST', {}, 'payload=1');

    expect(result.error).toBeUndefined();
    expect(observed.method).toBe('POST');
    expect(observed.body).toBe('payload=1');
  });

  it.each([307, 308])(
    'refuses to re-send a body to a different origin on a %i',
    async (status) => {
      let targetWasReached = false;
      const target = await startServer((_req, res) => {
        targetWasReached = true;
        res.writeHead(200);
        res.end();
      });
      servers.push(target);

      const origin = await startServer((_req, res) => {
        res.writeHead(status, { Location: `${target.url}/` });
        res.end();
      });
      servers.push(origin);

      allowAll();
      const result = await executeCheck(`${origin.url}/`, 'POST', {}, 'payload=1');

      expect(result.status).toBe('down');
      expect(result.error).toMatch(/different origin/i);
      // The point of refusing is that the body never leaves the origin it was set for.
      expect(targetWasReached).toBe(false);
    }
  );

  it.each([307, 308])(
    'still follows a cross-origin %i when there is no body',
    async (status) => {
      let targetWasReached = false;
      const target = await startServer((_req, res) => {
        targetWasReached = true;
        res.writeHead(200);
        res.end();
      });
      servers.push(target);

      const origin = await startServer((_req, res) => {
        res.writeHead(status, { Location: `${target.url}/` });
        res.end();
      });
      servers.push(origin);

      allowAll();
      const result = await executeCheck(`${origin.url}/`, 'GET');

      expect(result.status).toBe('up');
      expect(targetWasReached).toBe(true);
    }
  );

  it('does not restore caller headers on a later same-origin hop', async () => {
    // A -> B -> B/page. The third hop is same-origin with B, so a naive per-hop
    // comparison would hand the credentials back after dropping them for B.
    const seen: { url: string; auth?: string }[] = [];
    const middle = await startServer((req, res) => {
      if (req.url === '/enter') {
        res.writeHead(302, { Location: '/deeper' });
        res.end();
        return;
      }
      seen.push({ url: req.url ?? '', auth: req.headers.authorization });
      res.writeHead(200);
      res.end();
    });
    servers.push(middle);

    const first = await startServer((_req, res) => {
      res.writeHead(302, { Location: `${middle.url}/enter` });
      res.end();
    });
    servers.push(first);

    allowAll();
    const result = await executeCheck(`${first.url}/`, 'GET', {
      Authorization: 'Bearer super-secret-token',
    });

    expect(result.status).toBe('up');
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('/deeper');
    expect(seen[0].auth).toBeUndefined();
  });

  it('drops caller headers on a cross-origin redirect but keeps them same-origin', async () => {
    const crossOrigin: { received?: http.IncomingHttpHeaders } = {};
    const crossTarget = await startServer((req, res) => {
      crossOrigin.received = req.headers;
      res.writeHead(200);
      res.end();
    });
    servers.push(crossTarget);

    const crossOriginServer = await startServer((_req, res) => {
      res.writeHead(302, { Location: `${crossTarget.url}/` });
      res.end();
    });
    servers.push(crossOriginServer);

    allowAll();
    await executeCheck(`${crossOriginServer.url}/`, 'GET', {
      Authorization: 'Bearer super-secret-token',
      'X-Api-Key': 'also-secret',
    });

    // A hand-rolled redirect loop that forwards everything re-introduces the leak that
    // follow-redirects used to prevent.
    expect(crossOrigin.received?.authorization).toBeUndefined();
    expect(crossOrigin.received?.['x-api-key']).toBeUndefined();
    // The non-credential default is still applied, so this is a refusal-free request
    // rather than a silently malformed one.
    expect(crossOrigin.received?.['user-agent']).toBe('API-Monitor/1.0');

    const sameOrigin: { received?: http.IncomingHttpHeaders } = {};
    const sameServer = await startServer((req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { Location: '/finish' });
        res.end();
        return;
      }
      sameOrigin.received = req.headers;
      res.writeHead(200);
      res.end();
    });
    servers.push(sameServer);

    allowAll();
    await executeCheck(`${sameServer.url}/start`, 'GET', { Authorization: 'Bearer keep-me' });

    expect(sameOrigin.received?.authorization).toBe('Bearer keep-me');
  });

  it('does not resend a POST body to a new origin on a 302', async () => {
    let observed: { method?: string; body: string } = { body: '' };
    const target = await startServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        observed = { method: req.method, body };
        res.writeHead(200);
        res.end();
      });
    });
    servers.push(target);

    const origin = await startServer((_req, res) => {
      res.writeHead(302, { Location: `${target.url}/` });
      res.end();
    });
    servers.push(origin);

    allowAll();
    await executeCheck(`${origin.url}/`, 'POST', {}, 'secret=1');

    expect(observed.method).toBe('GET');
    expect(observed.body).not.toContain('secret');
  });
});

describe('executor — scheme changes across redirects', () => {
  it('follows a redirect that changes the scheme instead of refusing it', async () => {
    // The second hop points at a plain-HTTP server over https, so the TLS handshake
    // fails. That failure is the proof: the redirect was resolved and accepted, and the
    // executor then tried to dial it. A policy refusal would have stopped before any
    // connection and produced one of the messages asserted against below.
    const target = await startServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    servers.push(target);

    const origin = await startServer((_req, res) => {
      res.writeHead(302, { Location: `https://127.0.0.1:${target.port}/` });
      res.end();
    });
    servers.push(origin);

    allowAll();
    const result = await executeCheck(`${origin.url}/`);

    expect(result.status).toBe('down');
    // If the redirect had not been followed, the result would be the 302 itself
    // ("Expected 2xx status, got 302"). A TLS-level error instead means the executor
    // resolved the Location, accepted the new scheme, and dialled it.
    expect(result.error).not.toMatch(/got 302/);
    expect(result.error).not.toMatch(/restricted network destination/i);
    expect(result.error).not.toMatch(/could not be followed safely/i);
    expect(result.error).toMatch(/TLS|SSL|socket hang up|EPROTO|wrong version/i);
    // The handshake fails before any HTTP request is written, so the plain server
    // records no request. That is why the error above, not the hit count, is the proof.
    expect(target.hits).toBe(0);
  });

  it('still refuses a restricted destination reached by a scheme-changing redirect', async () => {
    // A downgrade must not become a way around the destination policy. This is the
    // property that matters: whatever the scheme becomes, the address is re-checked.
    const target = await startServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    servers.push(target);

    const origin = await startServer((_req, res) => {
      res.writeHead(302, { Location: `https://127.0.0.1:${target.port}/` });
      res.end();
    });
    servers.push(origin);

    // Only the first hop is permitted; the redirect target is not.
    allowAll();
    validateMock.mockResolvedValueOnce({
      allowed: false,
      code: 'loopback',
      detail: 'operator-only detail',
      publicMessage: 'Monitor target resolves to a restricted network destination.',
    });

    const result = await executeCheck(`${origin.url}/`);

    expect(result.status).toBe('down');
    expect(result.error).toBe('Monitor target resolves to a restricted network destination.');
    expect(target.hits).toBe(0);
  });
});

describe('executor — every failure carries a diagnostic', () => {
  it.each([
    ['an Error with no message', new Error('')],
    ['an Error with a code but no message', Object.assign(new Error(''), { code: 'ECONNRESET' })],
    ['a thrown string', 'something went wrong'],
  ])('describes %s', (_label, thrown) => {
    // Observed in the running container as `{ status: "down", error: "" }`, which an
    // operator cannot act on and cannot distinguish from a monitor that never ran.
    const original = http.request;
    http.request = (() => {
      throw thrown;
    }) as unknown as typeof http.request;
    try {
      const result = executeCheck('http://127.0.0.1:1/', 'GET', {}, undefined, 2000);
      return result.then((r) => {
        expect(r.status).toBe('down');
        expect(r.error).toBeTruthy();
      });
    } finally {
      http.request = original;
    }
  });
});

describe('executor — existing check behaviour is preserved', () => {
  it('reports a non-2xx response as down with its status', async () => {
    const target = await startServer((_req, res) => {
      res.writeHead(500);
      res.end();
    });
    servers.push(target);

    allowAll();
    const result = await executeCheck(`${target.url}/`);

    expect(result.status).toBe('down');
    expect(result.statusCode).toBe(500);
    expect(result.error).toBe('Expected 2xx status, got 500');
  });

  it('honours an explicit expectedStatus', async () => {
    const target = await startServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    servers.push(target);

    allowAll();
    const result = await executeCheck(`${target.url}/`, 'GET', {}, undefined, 5000, 404);

    expect(result.status).toBe('up');
    expect(result.statusCode).toBe(404);
  });

  it('still matches an expected keyword', async () => {
    const target = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('service is healthy');
    });
    servers.push(target);

    allowAll();
    const result = await executeCheck(
      `${target.url}/`,
      'GET',
      {},
      undefined,
      5000,
      undefined,
      'healthy'
    );
    expect(result.status).toBe('up');
  });

  it('reports a down result when the keyword is missing', async () => {
    const target = await startServer((_req, res) => {
      res.writeHead(200);
      res.end('degraded');
    });
    servers.push(target);

    allowAll();
    const result = await executeCheck(
      `${target.url}/`,
      'GET',
      {},
      undefined,
      5000,
      undefined,
      'healthy'
    );
    expect(result.status).toBe('down');
    expect(result.error).toContain('healthy');
  });

  it('times out a slow target', async () => {
    const target = await startServer(() => {
      /* never responds */
    });
    servers.push(target);

    allowAll();
    const result = await executeCheck(`${target.url}/`, 'GET', {}, undefined, 300);

    expect(result.status).toBe('down');
    expect(result.error).toMatch(/timed out/i);
  });
});
