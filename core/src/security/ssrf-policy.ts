/**
 * Server-side policy for user-supplied monitor targets.
 *
 * The worker fetches URLs that any signed-up user controls, from inside a network
 * that holds a database connection and a mail API key. Without a policy here, a
 * monitor is a request proxy: point one at `169.254.169.254` or an internal admin
 * endpoint and the worker performs the request, returning the status and timing to
 * whoever created the monitor.
 *
 * This module is the only place that decides whether a destination may be
 * contacted. It is deliberately isolated from the executor so the rules can be
 * tested directly and so a future reviewer can audit one file.
 *
 * ## Layers
 *
 * 1. **Parse and normalise.** `new URL()` is WHATWG-compliant and canonicalises every
 *    obfuscated IPv4 form before this code sees it: `2130706433`, `0x7f000001`,
 *    `0177.0.0.1`, `127.1`, `%31%32%37.0.0.1` and fullwidth digits all become
 *    `127.0.0.1`. Relying on that is what lets this policy be short; matching strings
 *    would have to enumerate encodings forever.
 * 2. **Scheme allowlist.** Only `http:` and `https:`. `file:`, `gopher:`, `data:`
 *    and friends are rejected outright.
 * 3. **Resolve, then classify.** Every address the name resolves to is classified by
 *    `ip-policy`. If *any* is non-public the target is refused, including the
 *    split-horizon case where a name returns both a public and a private address.
 * 4. **Enforce again at connect time.** See `createGuardedLookup`.
 *
 * ## DNS rebinding
 *
 * Resolving a name and then handing the *name* to the HTTP client would leave a gap:
 * an attacker controlling DNS can answer `93.184.216.34` for the check and
 * `127.0.0.1` for the connection that follows it. Closing that requires the address
 * that is validated to be the address that is dialled.
 *
 * `createGuardedLookup` does exactly that. It replaces the resolver on the socket, so
 * the classification happens inside the connect path and the address handed to the
 * socket is the one that was just approved. There is no second resolution to race.
 * This is the strongest guarantee available without replacing the HTTP client or
 * moving checks to the network layer.
 *
 * ## Residual risks
 *
 * A name is still resolved before use, so a hostile hostname can cause one outbound
 * DNS query for data it chooses. That is blind exfiltration of a few bits per check,
 * not a read of internal state, and it cannot be prevented by application code —
 * it needs an egress-restricted resolver or network policy. Redirect handling is
 * the executor's responsibility; see `services/executor.ts`.
 */
import dns from 'node:dns';
import net from 'node:net';
import { classifyAddress, isBlockedAddress, type BlockReason } from './ip-policy';

/** Schemes the monitoring product intentionally supports. */
export const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Response statuses treated as a redirect hop. */
export const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Hard ceiling on redirect hops, independent of any per-request timeout. */
export const MAX_REDIRECTS = 5;

export type RejectionCode =
  | 'invalid-url'
  | 'protocol-not-allowed'
  | 'credentials-not-allowed'
  | 'restricted-destination'
  | 'unresolvable-hostname'
  | 'no-addresses';

export interface AllowedTarget {
  allowed: true;
  url: URL;
  /** Hostname with IPv6 brackets removed, suitable for `dns.lookup`. */
  hostname: string;
  /** Every address the name resolved to, all of which passed the policy. */
  addresses: Array<{ address: string; family: number }>;
}

export interface RejectedTarget {
  allowed: false;
  code: RejectionCode;
  /** Operator-facing detail. Never returned to the user. */
  detail: string;
  /** Message safe to show the user who created the monitor. */
  publicMessage: string;
}

export type TargetValidation = AllowedTarget | RejectedTarget;

/**
 * Narrowing guard for `TargetValidation`, for the same `strictNullChecks` reason as
 * `isBlockedAddress`. Callers must treat a rejection as terminal.
 */
export function isRejectedTarget(
  validation: TargetValidation
): validation is RejectedTarget {
  return validation.allowed === false;
}

/**
 * Messages shown to the user who owns the monitor.
 *
 * Deliberately uniform across the "restricted" family. Telling a caller that
 * `10.0.0.1` exists, or that a name resolved but was refused, turns the monitor
 * feature into a scanner for the host's internal network. Every refusal below the
 * "restricted" umbrella returns the same string.
 */
const PUBLIC_MESSAGES: Record<RejectionCode, string> = {
  'invalid-url': 'Invalid monitor URL.',
  'protocol-not-allowed': 'Monitor URL must use http or https.',
  'credentials-not-allowed': 'Monitor URL must not contain embedded credentials.',
  'restricted-destination': 'Monitor target resolves to a restricted network destination.',
  'unresolvable-hostname': 'Monitor target hostname could not be resolved.',
  'no-addresses': 'Monitor target hostname could not be resolved.',
};

function reject(code: RejectionCode, detail: string): RejectedTarget {
  return { allowed: false, code, detail, publicMessage: PUBLIC_MESSAGES[code] };
}

/** Strip the brackets `URL.hostname` keeps around an IPv6 literal. */
function unbracket(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

interface ResolvedAddresses {
  addresses: Array<{ address: string; family: number }>;
}

/**
 * Resolve a hostname to every address it maps to.
 *
 * `verbatim` is set so Node does not silently reorder v4 and v6 results; the set of
 * addresses is policy-relevant, so its order should not be an implementation detail.
 */
async function resolveAll(hostname: string): Promise<ResolvedAddresses> {
  const results = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return {
    addresses: results.map((r) => ({ address: r.address, family: r.family })),
  };
}

function describeAddresses(addresses: Array<{ address: string; family: number }>): string {
  return addresses.map((a) => `${a.address}/${a.family}`).join(', ');
}

/**
 * Classify a resolved set of addresses as a whole.
 *
 * Every address must pass. Accepting a name because *one* of its addresses is public
 * would hand the decision back to the resolver, which is the component an attacker
 * controls.
 */
type SetVerdict =
  | { allowed: true }
  | { allowed: false; reason: BlockReason; address: string };

function classifySet(
  addresses: Array<{ address: string; family: number }>
): SetVerdict | SetVerdict {
  for (const { address } of addresses) {
    const verdict = classifyAddress(address);
    if (isBlockedAddress(verdict)) {
      return { allowed: false, reason: verdict.reason, address };
    }
  }
  return { allowed: true };
}

/**
 * Narrowing guard for the result of `classifySet`.
 *
 * `ssrf-policy` cannot use a boolean discriminant to narrow because this workspace
 * compiles without `strictNullChecks`; see `isBlockedAddress` for the same note.
 */
function isSetBlocked(verdict: SetVerdict): verdict is { allowed: false; reason: BlockReason; address: string } {
  return verdict.allowed === false;
}

/**
 * Validate a monitor target URL.
 *
 * Returns the parsed URL and its resolved addresses when the destination is
 * acceptable. Callers must treat a rejection as terminal for this attempt: there is
 * no "warn and continue" mode, because the alternative is a policy that can be
 * overridden.
 */
export async function validateMonitorTarget(rawUrl: string): Promise<TargetValidation> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return reject('invalid-url', 'URL constructor rejected the input');
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return reject('protocol-not-allowed', `scheme ${url.protocol} is not supported`);
  }

  // Credentials in a monitor URL are never legitimate here. They are also a
  // phishing and log-poisoning vector, and `http://trusted.example@evil.test/`
  // reads as the trusted host in most displays.
  if (url.username || url.password) {
    return reject('credentials-not-allowed', 'URL carried a username or password component');
  }

  const hostname = unbracket(url.hostname);
  if (!hostname) {
    return reject('invalid-url', 'URL had no hostname');
  }

  // An IP literal needs no resolution, so classify it directly. This also keeps
  // obfuscated forms working: `URL` has already canonicalised them by this point.
  if (net.isIP(hostname) !== 0) {
    const verdict = classifyAddress(hostname);
    if (isBlockedAddress(verdict)) {
      return reject(
        'restricted-destination',
        `literal address ${verdict.family ? `${hostname} (${verdict.family})` : hostname} ` +
          `is ${verdict.reason}`
      );
    }
    const family = verdict.family as 4 | 6;
    return {
      allowed: true,
      url,
      hostname,
      addresses: [{ address: hostname, family }],
    };
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    ({ addresses } = await resolveAll(hostname));
  } catch (error) {
    return reject(
      'unresolvable-hostname',
      `resolution failed: ${error instanceof Error ? error.message : 'unknown error'}`
    );
  }

  if (addresses.length === 0) {
    return reject('no-addresses', 'resolution returned no addresses');
  }

  const verdict = classifySet(addresses);
  if (isSetBlocked(verdict)) {
    return reject(
      'restricted-destination',
      `${verdict.address} is ${verdict.reason} (resolved to ${describeAddresses(addresses)})`
    );
  }

  return { allowed: true, url, hostname, addresses };
}

/** Error raised from inside the connect path when a destination is refused. */
export class SsrfBlockedError extends Error {
  readonly code = 'SSRF_BLOCKED';
  constructor(detail: string) {
    super(detail);
    this.name = 'SsrfBlockedError';
  }
}

type LookupCallback = (
  err: Error | null,
  address?: string | dns.LookupAddress[],
  family?: number
) => void;

/**
 * A `lookup` implementation for `http.Agent` / `https.Agent` that classifies the
 * address it is about to return.
 *
 * Installing this on the agent is what makes the check unbypassable in the normal
 * path: the classification and the connection happen in the same resolution, so a
 * name that answers differently on a second lookup is simply never given a second
 * lookup. The executor pairs this with `maxRedirects: 0` and validates every hop
 * itself, so the only destinations that reach a socket are ones this function has
 * just approved.
 *
 * `onBlocked` exists because the refusal has to survive the HTTP client. The block
 * is raised from inside a socket connect, and an HTTP client is free to replace the
 * error with one of its own, which would both hide the refusal and let the detail
 * text reach the caller. Reporting the refusal out of band keeps the decision
 * observable no matter what the client does with the error, and lets the executor
 * substitute a safe message.
 */
export function createGuardedLookup(onBlocked?: (detail: string) => void) {
  function refuse(detail: string): void {
    if (onBlocked) onBlocked(detail);
  }

  return function guardedLookup(
    hostname: string,
    options: dns.LookupOptions | number | undefined,
    callback: LookupCallback
  ): void {
    const wantsAll = typeof options === 'object' && options !== null && options.all === true;

    // A literal never reaches the resolver on the happy path, but be explicit: the
    // address still has to pass.
    if (net.isIP(hostname) !== 0) {
      const verdict = classifyAddress(hostname);
      if (isBlockedAddress(verdict)) {
        const detail = `literal ${hostname} is ${verdict.reason}`;
        refuse(detail);
        callback(new SsrfBlockedError(detail));
        return;
      }
      const entry = { address: hostname, family: verdict.family };
      if (wantsAll) callback(null, [entry]);
      else callback(null, entry.address, entry.family);
      return;
    }

    resolveAll(hostname)
      .then(({ addresses }) => {
        const verdict = classifySet(addresses);
        if (isSetBlocked(verdict)) {
          const detail =
            `${verdict.address} is ${verdict.reason} at connect time ` +
            `(resolved to ${describeAddresses(addresses)})`;
          refuse(detail);
          callback(new SsrfBlockedError(detail));
          return;
        }
        if (wantsAll) {
          callback(null, addresses);
          return;
        }
        callback(null, addresses[0].address, addresses[0].family);
      })
      .catch((error: unknown) => {
        callback(
          error instanceof Error
            ? error
            : new SsrfBlockedError('resolution failed at connect time')
        );
      });
  };
}
