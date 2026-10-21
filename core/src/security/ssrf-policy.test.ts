/**
 * Regression suite for the monitor destination policy.
 *
 * DNS is mocked throughout. That is deliberate: the policy's job is to classify
 * addresses, and a real resolver would make these assertions depend on whatever
 * the machine running them happens to be able to reach. Resolver behaviour is
 * covered separately in `executor.test.ts`, which binds real sockets.
 */
import dns from 'node:dns';
import {
  ALLOWED_PROTOCOLS,
  isRejectedTarget,
  validateMonitorTarget,
  createGuardedLookup,
  SsrfBlockedError,
} from './ssrf-policy';
import { classifyAddress, isBlockedAddress } from './ip-policy';

interface LookupEntry {
  address: string;
  family: number;
}

/** Make every hostname resolve to the given addresses. */
function mockResolution(...addresses: LookupEntry[]) {
  return jest
    .spyOn(dns.promises, 'lookup')
    .mockImplementation((async () => addresses) as never);
}

/** Accept any lookup and return a public address, for "should be allowed" cases. */
function mockPublic() {
  return mockResolution({ address: '93.184.216.34', family: 4 });
}

const PUBLIC_MESSAGE =
  'Monitor target resolves to a restricted network destination.';

describe('translation prefixes are judged by the address they embed', () => {
  it.each([
    ['64:ff9b::42f1:7de8', 'NAT64 embedding 66.241.125.232', 'a NAT64 host on a DNS64 resolver'],
    ['::ffff:5db8:d822', 'v4-mapped 93.184.216.34', 'a v4-mapped public address'],
    ['2002:5db8:d822::', '6to4 embedding 93.184.216.34', 'a 6to4 public address'],
  ])('allows %s (%s) — %s', (candidate) => {
    // Regression: this policy previously refused the whole prefix, which made every
    // hostname resolved by a NAT64/DNS64 resolver unreachable, including public ones.
    expect(classifyAddress(candidate).allowed).toBe(true);
  });

  it.each([
    ['64:ff9b::7f00:1', 'loopback'],
    ['64:ff9b::a9fe:a9fe', 'link-local'],
    ['::ffff:127.0.0.1', 'loopback'],
  ])('refuses %s because the embedded address is %s', (candidate, reason) => {
    const verdict = classifyAddress(candidate);
    expect(verdict.allowed).toBe(false);
    // `strictNullChecks` is off in this workspace, so the discriminant does not narrow
    // the union on its own; the module exports a guard for exactly that.
    if (isBlockedAddress(verdict)) expect(verdict.reason).toBe(reason);
  });
});

describe('validateMonitorTarget — URL parsing and scheme policy', () => {
  afterEach(() => jest.restoreAllMocks());

  it('allows http and https and rejects everything else', () => {
    expect(Array.from(ALLOWED_PROTOCOLS).sort()).toEqual(['http:', 'https:']);
  });

  it.each([
    'file:///etc/passwd',
    'ftp://example.com/x',
    'gopher://example.com:70/_x',
    'data:text/plain,hello',
    'javascript:alert(1)',
    'ws://example.com/socket',
    'chrome://settings',
    'about:blank',
  ])('rejects %s before any resolution happens', async (candidate) => {
    const lookup = mockPublic();
    const result = await validateMonitorTarget(candidate);

    expect(isRejectedTarget(result)).toBe(true);
    if (isRejectedTarget(result)) {
      expect(result.code).toBe('protocol-not-allowed');
      expect(result.publicMessage).toBe('Monitor URL must use http or https.');
    }
    // A rejected scheme must never reach the resolver, or it becomes a DNS oracle.
    expect(lookup).not.toHaveBeenCalled();
  });

  it('preserves http and https monitoring for public hosts', async () => {
    mockPublic();
    const https = await validateMonitorTarget('https://example.com/health');
    const http = await validateMonitorTarget('http://example.com/health');

    expect(https.allowed).toBe(true);
    expect(http.allowed).toBe(true);
  });

  it.each([
    'not a url',
    '',
    'http://',
    '://example.com',
    'http://exa mple.com',
    'https://example.com:99999',
  ])('rejects malformed URL %p', async (candidate) => {
    mockPublic();
    const result = await validateMonitorTarget(candidate);
    expect(isRejectedTarget(result)).toBe(true);
    if (isRejectedTarget(result)) {
      expect(['invalid-url', 'protocol-not-allowed']).toContain(result.code);
    }
  });

  it('rejects URLs carrying embedded credentials', async () => {
    mockPublic();
    const result = await validateMonitorTarget('http://admin:hunter2@example.com/');

    expect(isRejectedTarget(result)).toBe(true);
    if (isRejectedTarget(result)) {
      expect(result.code).toBe('credentials-not-allowed');
      expect(result.publicMessage).toBe(
        'Monitor URL must not contain embedded credentials.'
      );
      // The secret must not be echoed back to the caller.
      expect(JSON.stringify(result.publicMessage)).not.toContain('hunter2');
    }
  });

  it('accepts an unusual but legal public port', async () => {
    mockPublic();
    const result = await validateMonitorTarget('http://example.com:8080/deep/path?q=1#frag');
    expect(result.allowed).toBe(true);
  });
});

describe('validateMonitorTarget — IPv4 literals', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.1.2.3', 'loopback within 127.0.0.0/8'],
    ['127.255.255.254', 'top of loopback range'],
    ['0.0.0.0', 'this-network'],
    ['10.0.0.1', 'RFC1918 10/8'],
    ['10.255.255.255', 'top of 10/8'],
    ['172.16.0.1', 'RFC1918 172.16/12'],
    ['172.31.255.255', 'top of 172.16/12'],
    ['192.168.0.1', 'RFC1918 192.168/16'],
    ['192.168.255.255', 'top of 192.168/16'],
    ['169.254.1.1', 'link-local'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['198.18.0.1', 'benchmarking'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
  ])('blocks %s (%s)', async (address) => {
    const lookup = mockPublic();
    const result = await validateMonitorTarget(`http://${address}/`);

    expect(isRejectedTarget(result)).toBe(true);
    if (isRejectedTarget(result)) {
      expect(result.code).toBe('restricted-destination');
      expect(result.publicMessage).toBe(PUBLIC_MESSAGE);
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each(['172.15.0.1', '172.32.0.1', '100.63.255.255', '100.128.0.1', '198.20.0.1'])(
    'allows %s, which is adjacent to a blocked range but public',
    async (address) => {
      mockPublic();
      const result = await validateMonitorTarget(`http://${address}/`);
      expect(result.allowed).toBe(true);
    }
  );
});

describe('validateMonitorTarget — IPv6 literals', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['[::1]', 'IPv6 loopback'],
    ['[0:0:0:0:0:0:0:1]', 'uncompressed IPv6 loopback'],
    ['[fe80::1]', 'IPv6 link-local'],
    ['[fe80::a9fe:a9fe]', 'IPv6 link-local at the metadata address'],
    ['[fc00::1]', 'unique-local'],
    ['[fd12:3456:789a::1]', 'unique-local'],
    ['[ff02::1]', 'IPv6 multicast'],
    ['[::]', 'unspecified'],
    ['[::ffff:127.0.0.1]', 'IPv4-mapped loopback'],
    ['[::ffff:7f00:1]', 'IPv4-mapped loopback, hex form'],
    ['[64:ff9b::7f00:1]', 'NAT64-embedded loopback'],
    ['[2001:db8::1]', 'documentation range'],
    ['[100::1]', 'discard-only'],
    ['[3fff::1]', 'documentation range (RFC 9637)'],
  ])('blocks %s (%s)', async (literal) => {
    mockPublic();
    const result = await validateMonitorTarget(`http://${literal}/`);

    expect(isRejectedTarget(result)).toBe(true);
    if (isRejectedTarget(result)) {
      expect(result.code).toBe('restricted-destination');
    }
  });

  it('allows a public IPv6 literal', async () => {
    mockPublic();
    const result = await validateMonitorTarget('http://[2606:4700:4700::1111]/');
    expect(result.allowed).toBe(true);
  });

  it('returns an unbracketed hostname so the resolver accepts it', async () => {
    mockPublic();
    const result = await validateMonitorTarget('http://[2606:4700:4700::1111]/');
    if (result.allowed) {
      expect(result.hostname).toBe('2606:4700:4700::1111');
    }
  });
});

describe('validateMonitorTarget — obfuscated literals', () => {
  afterEach(() => jest.restoreAllMocks());

  // `new URL()` canonicalises these before the policy sees them. The assertions
  // exist to prove that still holds, because string matching would not catch them.
  it.each([
    ['http://2130706433/', 'decimal loopback'],
    ['http://0x7f000001/', 'hex loopback'],
    ['http://0177.0.0.1/', 'octal loopback'],
    ['http://0x7f.0.0.1/', 'mixed-radix loopback'],
    ['http://127.1/', 'short-form loopback'],
    ['http://%31%32%37.0.0.1/', 'percent-encoded loopback'],
    ['http://①②⑦.0.0.1/', 'fullwidth-digit loopback'],
    ['http://0/', 'decimal 0'],
    ['http://[::ffff:7f00:1]/', 'hex IPv4-mapped loopback'],
    ['http://[::ffff:a9fe:a9fe]/', 'IPv4-mapped link-local'],
    // The translation prefixes are judged by the IPv4 they carry, so a public address
    // behind one of them must not be refused. Refusing these broke every hostname on a
    // DNS64/NAT64 network, which is what a container gets on an IPv6-only host.
    ['http://[64:ff9b::7f00:1]/', 'NAT64 embedding loopback'],
    ['http://[64:ff9b::a9fe:a9fe]/', 'NAT64 embedding link-local'],
    ['http://[64:ff9b::a00:1]/', 'NAT64 embedding a private address'],
    ['http://[2002:7f00:1::]/', '6to4 embedding loopback'],
    ['http://[2001::7f00:1]/', 'Teredo server field is loopback'],
    ['http://[64:ff9b:1::1]/', 'local-use NAT64 is refused outright'],
  ])('blocks %s (%s)', async (candidate) => {
    mockPublic();
    const result = await validateMonitorTarget(candidate);
    expect(isRejectedTarget(result)).toBe(true);
    if (isRejectedTarget(result)) {
      expect(result.code).toBe('restricted-destination');
    }
  });

  it('blocks a decimal-encoded private address', async () => {
    mockPublic();
    // 10.0.0.1 as a single decimal integer
    const result = await validateMonitorTarget('http://167772161/');
    expect(isRejectedTarget(result)).toBe(true);
  });
});

describe('validateMonitorTarget — cloud metadata endpoints', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['169.254.169.254', 'AWS, Azure, GCP, DigitalOcean, Oracle IMDS over IPv4'],
    ['169.254.169.253', 'AWS VPC DNS (IMDS adjacent)'],
    ['100.100.100.200', 'Alibaba Cloud metadata'],
    ['192.0.0.192', 'Oracle Cloud IMDS'],
  ])('blocks the metadata address %s (%s)', async (address) => {
    mockPublic();
    const result = await validateMonitorTarget(`http://${address}/latest/meta-data/`);
    expect(isRejectedTarget(result)).toBe(true);
  });

  it('blocks a hostname that resolves to the metadata address', async () => {
    mockResolution({ address: '169.254.169.254', family: 4 });
    const result = await validateMonitorTarget('http://metadata.google.internal/computeMetadata/v1/');
    expect(isRejectedTarget(result)).toBe(true);
  });

  it('blocks the AWS IPv6 metadata address', async () => {
    mockPublic();
    const result = await validateMonitorTarget('http://[fd00:ec2::254]/latest/meta-data/');
    expect(isRejectedTarget(result)).toBe(true);
  });
});

describe('validateMonitorTarget — DNS resolution', () => {
  afterEach(() => jest.restoreAllMocks());

  it('allows a hostname that resolves only to public addresses', async () => {
    mockResolution(
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }
    );
    const result = await validateMonitorTarget('https://example.com/');
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.addresses).toHaveLength(2);
  });

  it.each([
    ['a hostname resolving to loopback', [{ address: '127.0.0.1', family: 4 }]],
    ['a hostname resolving to RFC1918', [{ address: '10.1.2.3', family: 4 }]],
    ['a hostname resolving to link-local', [{ address: '169.254.169.254', family: 4 }]],
    ['a hostname resolving to unique-local v6', [{ address: 'fd00::1', family: 6 }]],
    ['a hostname resolving to v4-mapped loopback', [{ address: '::ffff:127.0.0.1', family: 6 }]],
  ])('blocks %s', async (_label, addresses) => {
    mockResolution(...(addresses as LookupEntry[]));
    const result = await validateMonitorTarget('http://sneaky.example.com/');
    expect(isRejectedTarget(result)).toBe(true);
  });

  it('blocks a split-horizon name that mixes public and private addresses', async () => {
    mockResolution(
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 }
    );
    const result = await validateMonitorTarget('http://split-horizon.example.com/');
    expect(isRejectedTarget(result)).toBe(true);
    if (isRejectedTarget(result)) {
      expect(result.detail).toContain('127.0.0.1');
    }
  });

  it('reports an unresolvable hostname without leaking resolver detail', async () => {
    jest.spyOn(dns.promises, 'lookup').mockRejectedValue(
      Object.assign(new Error('getaddrinfo ENOTFOUND nope.invalid'), { code: 'ENOTFOUND' })
    );
    const result = await validateMonitorTarget('http://nope.invalid/');

    expect(isRejectedTarget(result)).toBe(true);
    if (isRejectedTarget(result)) {
      expect(result.code).toBe('unresolvable-hostname');
      expect(result.publicMessage).toBe('Monitor target hostname could not be resolved.');
    }
  });

  it('resolves with verbatim ordering so the address set is predictable', async () => {
    const lookup = mockPublic();
    await validateMonitorTarget('https://example.com/');
    expect(lookup).toHaveBeenCalledWith('example.com', { all: true, verbatim: true });
  });
});

describe('createGuardedLookup — connect-time enforcement', () => {
  afterEach(() => jest.restoreAllMocks());

  it('yields a public address to the socket layer', async () => {
    mockResolution({ address: '93.184.216.34', family: 4 });
    const lookup = createGuardedLookup();

    const address = await new Promise((resolve, reject) => {
      lookup('example.com', {}, (err, addr, family) =>
        err ? reject(err) : resolve({ addr, family })
      );
    });

    expect(address).toEqual({ addr: '93.184.216.34', family: 4 });
  });

  it('refuses to hand back an address that resolves privately at connect time', async () => {
    mockResolution({ address: '127.0.0.1', family: 4 });
    const lookup = createGuardedLookup();

    const error = await new Promise<Error>((resolve) => {
      lookup('rebind.example.com', {}, (err) => resolve(err as Error));
    });

    expect(error).toBeInstanceOf(SsrfBlockedError);
    expect((error as Error).message).toContain('loopback');
  });

  it('refuses a v4-mapped loopback at connect time', async () => {
    mockResolution({ address: '::ffff:127.0.0.1', family: 6 });
    const lookup = createGuardedLookup();

    const error = await new Promise<Error>((resolve) => {
      lookup('mapped.example.com', {}, (err) => resolve(err as Error));
    });
    expect(error).toBeInstanceOf(SsrfBlockedError);
  });

  it('refuses an IP literal passed straight to the socket layer', async () => {
    const lookup = createGuardedLookup();
    const error = await new Promise<Error>((resolve) => {
      lookup('169.254.169.254', {}, (err) => resolve(err as Error));
    });
    expect(error).toBeInstanceOf(SsrfBlockedError);
  });

  it('supports the all-addresses callback form', async () => {
    mockResolution(
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800::1', family: 6 }
    );
    const lookup = createGuardedLookup();

    const addresses = await new Promise((resolve, reject) => {
      lookup('example.com', { all: true }, (err, addrs) =>
        err ? reject(err) : resolve(addrs)
      );
    });

    expect(addresses).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800::1', family: 6 },
    ]);
  });

  it('propagates a resolution failure rather than allowing the request', async () => {
    jest.spyOn(dns.promises, 'lookup').mockRejectedValue(new Error('ENOTFOUND'));
    const lookup = createGuardedLookup();

    const error = await new Promise<Error>((resolve) => {
      lookup('broken.example.com', {}, (err) => resolve(err as Error));
    });
    expect(error).toBeInstanceOf(Error);
  });
});

describe('public error messages', () => {
  afterEach(() => jest.restoreAllMocks());

  it('never discloses the blocked address or the reason to the caller', async () => {
    mockPublic();
    const result = await validateMonitorTarget('http://10.0.0.1/admin');

    if (isRejectedTarget(result)) {
      expect(result.publicMessage).toBe(PUBLIC_MESSAGE);
      expect(result.publicMessage).not.toContain('10.0.0.1');
      expect(result.publicMessage).not.toContain('private');
      expect(result.publicMessage).not.toContain('RFC1918');
      // The operator-facing detail is retained separately for logs.
      expect(result.detail).toContain('10.0.0.1');
    }
  });
});
