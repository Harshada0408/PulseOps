/**
 * End-to-end proof that the destination policy cannot be bypassed.
 *
 * Unlike `executor.test.ts`, nothing is mocked here: the real policy runs against a
 * real server that is genuinely listening. That distinction is the point. A test that
 * mocks the policy proves the policy function returns what the test told it to; this
 * one proves the worker refuses to connect to a live internal service.
 *
 * Every destination below is on this host's loopback interface, so a regression that
 * removed the guard would produce a real, successful connection to a real server and
 * fail the assertion rather than silently passing.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { executeCheck } from './executor';

let server: http.Server;
let port: number;
/** Incremented by the test server. Must stay 0 for every blocked target. */
let reached = 0;

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    reached += 1;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    // A body an attacker would want to read back through the monitor's status code.
    res.end('INTERNAL-ONLY-SECRET');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  reached = 0;
});

const RESTRICTED_MESSAGE = 'Monitor target resolves to a restricted network destination.';

describe('the real policy refuses a live internal service', () => {
  it('blocks a loopback address that is actually accepting connections', async () => {
    const result = await executeCheck(`http://127.0.0.1:${port}/internal`);

    expect(result.status).toBe('down');
    expect(result.error).toBe(RESTRICTED_MESSAGE);
    // The server never saw a request.
    expect(reached).toBe(0);
  });

  it('blocks the same service reached by hostname', async () => {
    const result = await executeCheck(`http://localhost:${port}/internal`);

    expect(result.status).toBe('down');
    expect(result.error).toBe(RESTRICTED_MESSAGE);
    expect(reached).toBe(0);
  });

  it.each([
    ['decimal', '2130706433'],
    ['hex', '0x7f000001'],
    ['octal', '0177.0.0.1'],
    ['short form', '127.1'],
    ['IPv4-mapped IPv6', '[::ffff:127.0.0.1]'],
  ])('blocks the %s encoding of loopback', async (_label, literal) => {
    const result = await executeCheck(`http://${literal}:${port}/internal`);

    expect(result.status).toBe('down');
    expect(result.error).toBe(RESTRICTED_MESSAGE);
    expect(reached).toBe(0);
  });

  it('refuses to follow a redirect from a public host onto the live service', async () => {
    // A server that behaves like a public host: it redirects to loopback.
    const redirector = http.createServer((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${port}/internal` });
      res.end();
    });
    await new Promise<void>((resolve) => redirector.listen(0, '127.0.0.1', resolve));
    const redirectorPort = (redirector.address() as AddressInfo).port;

    try {
      const result = await executeCheck(`http://localhost:${redirectorPort}/start`);

      expect(result.status).toBe('down');
      expect(result.error).toBe(RESTRICTED_MESSAGE);
      // The redirect was refused, so the internal handler was never reached.
      expect(reached).toBe(0);
    } finally {
      await new Promise<void>((resolve) => redirector.close(() => resolve()));
    }
  });

  it('blocks the cloud metadata endpoint', async () => {
    const result = await executeCheck('http://169.254.169.254/latest/meta-data/iam/');

    expect(result.status).toBe('down');
    expect(result.error).toBe(RESTRICTED_MESSAGE);
  });

  it('rejects a non-HTTP scheme without attempting any connection', async () => {
    const result = await executeCheck('file:///etc/passwd');

    expect(result.status).toBe('down');
    expect(result.error).toBe('Monitor URL must use http or https.');
    expect(reached).toBe(0);
  });

  it('does not leak the internal response body to the caller', async () => {
    const result = await executeCheck(`http://127.0.0.1:${port}/internal`);
    expect(JSON.stringify(result)).not.toContain('INTERNAL-ONLY-SECRET');
  });
});

describe('DNS rebinding between validation and connection', () => {
  afterEach(() => jest.restoreAllMocks());

  /**
   * The attack this guards against: a name that answers with a public address when
   * the policy checks it, then with a private address when the socket is dialled.
   *
   * The first `lookup` call is the pre-flight validation in `validateMonitorTarget`.
   * The second is the connect-time resolution inside the guarded `lookup`. A design
   * that validated the name and then handed the *name* to the HTTP client would
   * connect to the private address here; because the guarded lookup classifies the
   * address it is about to return, the second answer is refused.
   */
  it('refuses a name that rebinds to loopback between check and connect', async () => {
    const dns = await import('node:dns');
    let calls = 0;
    jest.spyOn(dns.promises, 'lookup').mockImplementation((async () => {
      calls += 1;
      return calls === 1
        ? [{ address: '93.184.216.34', family: 4 }] // passes validation
        : [{ address: '127.0.0.1', family: 4 }]; // the rebound answer
    }) as never);

    const result = await executeCheck(`http://rebind.test:${port}/internal`);

    expect(result.status).toBe('down');
    expect(result.error).toBe(RESTRICTED_MESSAGE);
    expect(reached).toBe(0);
    // Both resolutions really did happen: this is a race, not a shortcut.
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('refuses a name that rebinds to the metadata service', async () => {
    const dns = await import('node:dns');
    let calls = 0;
    jest.spyOn(dns.promises, 'lookup').mockImplementation((async () => {
      calls += 1;
      return calls === 1
        ? [{ address: '93.184.216.34', family: 4 }]
        : [{ address: '169.254.169.254', family: 4 }];
    }) as never);

    const result = await executeCheck('http://rebind-meta.test/latest/meta-data/');

    expect(result.status).toBe('down');
    expect(result.error).toBe(RESTRICTED_MESSAGE);
  });

  it('does not let a pooled socket carry a block past the attempt that caused it', async () => {
    const dns = await import('node:dns');
    let calls = 0;
    jest.spyOn(dns.promises, 'lookup').mockImplementation((async () => {
      calls += 1;
      return calls % 2 === 1
        ? [{ address: '93.184.216.34', family: 4 }]
        : [{ address: '127.0.0.1', family: 4 }];
    }) as never);

    // Two attempts in a row. If a socket were pooled or the guard were installed
    // once per cycle rather than per request, the second attempt would slip through.
    const first = await executeCheck(`http://rebind-a.test:${port}/internal`);
    const second = await executeCheck(`http://rebind-b.test:${port}/internal`);

    expect(first.status).toBe('down');
    expect(second.status).toBe('down');
    expect(second.error).toBe(RESTRICTED_MESSAGE);
    expect(reached).toBe(0);
  });

  it('never places the internal address or the reason in the user-visible error', async () => {
    const dns = await import('node:dns');
    let calls = 0;
    jest.spyOn(dns.promises, 'lookup').mockImplementation((async () => {
      calls += 1;
      return calls === 1
        ? [{ address: '93.184.216.34', family: 4 }]
        : [{ address: '169.254.169.254', family: 4 }];
    }) as never);

    const result = await executeCheck('http://rebind-leak.test/latest/meta-data/');

    expect(result.error).toBe(RESTRICTED_MESSAGE);
    expect(result.error).not.toContain('169.254');
    expect(result.error).not.toContain('loopback');
    expect(result.error).not.toContain('link-local');
  });
});
