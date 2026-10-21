/**
 * IP address classification for monitor targets.
 *
 * Kept free of DNS and HTTP concerns so it can be unit-tested exhaustively and
 * reasoned about on its own. `ssrf-policy.ts` layers URL parsing, DNS and the
 * request path on top.
 *
 * Threat model: the person who creates a monitor is untrusted. The worker runs
 * inside a private network and holds credentials (a database connection, a mail
 * API key). A monitor whose target is attacker-chosen therefore turns the worker
 * into a proxy that can reach anything the worker itself can reach, including
 * services that trust its network position. The rule enforced here is an
 * allowlist of the whole public internet, expressed as a denylist of everything
 * that is not globally routable. A denylist is the weaker of the two designs, so
 * the ranges are deliberately generous; see the module's own tests for coverage.
 */
import net from 'node:net';

/** A blocked range as a base address and prefix length, in the family's own byte width. */
interface Cidr {
  readonly cidr: string;
  readonly reason: string;
}

/**
 * IPv4 ranges that are not globally routable.
 *
 * `240.0.0.0/4` covers 255.255.255.255. `192.88.99.0/24` is the deprecated 6to4
 * relay anycast block. The three TEST-NET blocks are documentation-only, but they
 * are blocked because a monitoring product has no legitimate reason to probe them
 * and a name server may return them for a rebound host.
 */
const BLOCKED_IPV4: readonly Cidr[] = [
  { cidr: '0.0.0.0/8', reason: 'this-network' },
  { cidr: '10.0.0.0/8', reason: 'private' },
  { cidr: '100.64.0.0/10', reason: 'carrier-grade-nat' },
  { cidr: '127.0.0.0/8', reason: 'loopback' },
  { cidr: '169.254.0.0/16', reason: 'link-local' },
  { cidr: '172.16.0.0/12', reason: 'private' },
  { cidr: '192.0.0.0/24', reason: 'ietf-protocol-assignments' },
  { cidr: '192.0.2.0/24', reason: 'documentation' },
  { cidr: '192.88.99.0/24', reason: '6to4-relay-anycast' },
  { cidr: '192.168.0.0/16', reason: 'private' },
  { cidr: '198.18.0.0/15', reason: 'benchmarking' },
  { cidr: '198.51.100.0/24', reason: 'documentation' },
  { cidr: '203.0.113.0/24', reason: 'documentation' },
  { cidr: '224.0.0.0/4', reason: 'multicast' },
  { cidr: '240.0.0.0/4', reason: 'reserved' },
];

/**
 * IPv6 ranges that are not globally routable.
 *
 * Several of these embed a full IPv4 address in their low bits. A destination such
 * as `::ffff:127.0.0.1` reaches loopback through a v4-mapped socket, so blocking the
 * IPv6 range alone is not enough: the embedded IPv4 has to be checked too. That
 * applies to IPv4-mapped, NAT64, 6to4 and Teredo, and is handled by
 * `extractEmbeddedIPv4`.
 */
const BLOCKED_IPV6: readonly Cidr[] = [
  { cidr: '::/128', reason: 'unspecified' },
  { cidr: '::1/128', reason: 'loopback' },
  { cidr: '64:ff9b:1::/48', reason: 'nat64-local' },
  { cidr: '100::/64', reason: 'discard-only' },
  { cidr: '2001:2::/48', reason: 'benchmarking' },
  { cidr: '2001:10::/28', reason: 'orchid' },
  { cidr: '2001:20::/28', reason: 'orchid' },
  { cidr: '2001:db8::/32', reason: 'documentation' },
  { cidr: '3fff::/20', reason: 'documentation' },
  { cidr: 'fc00::/7', reason: 'unique-local' },
  { cidr: 'fe80::/10', reason: 'link-local' },
  { cidr: 'ff00::/8', reason: 'multicast' },
];

/**
 * Prefixes that carry a full IPv4 address in their low-order bits, and therefore are
 * *not* blocked on the strength of the prefix alone.
 *
 * Blocking these unconditionally looks safer and is in fact wrong. A NAT64 or v4-mapped
 * address whose embedded IPv4 is a normal public address is a normal public address,
 * reached through a translation mechanism. Refusing every one of them breaks real
 * deployments: a DNS64/NAT64 resolver is what Docker hands a container on an IPv6-only or
 * NAT64-configured host, so this policy refused *every* hostname it resolved, including
 * well-known public ones, before it ever looked at the embedded address.
 *
 * The question these prefixes actually raise is "which IPv4 does this reach", so that is
 * what gets classified, against the IPv4 table.
 *
 * `64:ff9b:1::/48` is deliberately absent: RFC 8215 reserves it for local-use
 * translation, where the embedded address is not the destination the translator will
 * actually reach. It stays in the unconditional table above.
 */
const IPV4_EMBEDDING_RANGES: readonly Cidr[] = [
  { cidr: '::ffff:0:0/96', reason: 'ipv4-mapped' },
  { cidr: '64:ff9b::/96', reason: 'nat64' },
  { cidr: '2001::/32', reason: 'teredo' },
  { cidr: '2002::/16', reason: '6to4' },
];

export type BlockReason =
  | 'this-network'
  | 'private'
  | 'carrier-grade-nat'
  | 'loopback'
  | 'link-local'
  | 'ietf-protocol-assignments'
  | 'documentation'
  | '6to4-relay-anycast'
  | 'benchmarking'
  | 'multicast'
  | 'reserved'
  | 'unspecified'
  | 'ipv4-mapped'
  | 'nat64'
  | 'nat64-local'
  | 'discard-only'
  | 'teredo'
  | '6to4'
  | 'benchmarking'
  | 'orchid'
  | 'unique-local'
  | 'not-an-ip-address';

/** Result of classifying a single address. */
export type AddressClassification =
  | { allowed: true; address: string; family: 4 | 6 }
  | { allowed: false; reason: BlockReason; family: 4 | 6 | 0 };

/** Parse dotted-quad IPv4 into a 32-bit number, or null if it is not one. */
function parseIPv4(value: string): number | null {
  if (net.isIPv4(value) !== true) return null;
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    result = result * 256 + octet;
  }
  return result >>> 0;
}

/**
 * Parse an IPv6 address into its 16 bytes.
 *
 * Handles `::` compression, an embedded dotted-quad tail, and a `%zone` suffix.
 * `URL.hostname` keeps the surrounding brackets, so callers must strip them; this
 * function tolerates them rather than trusting every caller to have done so.
 */
function parseIPv6(value: string): Uint8Array | null {
  let input = value;
  if (input.startsWith('[') && input.endsWith(']')) {
    input = input.slice(1, -1);
  }
  // A zone index only affects link-local scope selection and never the address
  // itself, so it is dropped before parsing.
  const zoneAt = input.indexOf('%');
  if (zoneAt !== -1) input = input.slice(0, zoneAt);
  if (net.isIPv6(input) !== true) return null;

  // Expand a trailing dotted-quad into the two 16-bit groups it occupies, so that
  // group counting and byte writing stay uniform. `::ffff:127.0.0.1` is
  // 0000:0000:0000:0000:0000:ffff:7f00:0001 — the IPv4 fills the final two slots.
  let text = input;
  const lastColon = text.lastIndexOf(':');
  if (text.slice(lastColon + 1).includes('.')) {
    const embedded = parseIPv4(text.slice(lastColon + 1));
    if (embedded === null) return null;
    const high = ((embedded >>> 16) & 0xffff).toString(16);
    const low = (embedded & 0xffff).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  // Expand `::` into a run of zero groups so the remainder can be read positionally.
  const [headText, tailText] = text.split('::');
  const head = headText ? headText.split(':') : [];
  const tail = tailText ? tailText.split(':') : [];
  if (head.length + tail.length > 8) return null;
  const missing = 8 - (head.length + tail.length);
  const groups = [
    ...head,
    ...new Array(Math.max(0, missing)).fill('0'),
    ...tail,
  ];
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    const parsed = Number.parseInt(groups[i], 16);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffff) return null;
    bytes[i * 2] = (parsed >>> 8) & 0xff;
    bytes[i * 2 + 1] = parsed & 0xff;
  }
  return bytes;
}

function parseCidr(cidr: string, width: number): { bytes: Uint8Array; prefix: number } {
  const [address, prefixText] = cidr.split('/');
  const prefix = Number(prefixText);
  const bytes =
    width === 4
      ? (() => {
          const packed = parseIPv4(address);
          const out = new Uint8Array(4);
          out[0] = (packed! >>> 24) & 0xff;
          out[1] = (packed! >>> 16) & 0xff;
          out[2] = (packed! >>> 8) & 0xff;
          out[3] = packed! & 0xff;
          return out;
        })()
      : parseIPv6(address)!;
  return { bytes, prefix };
}

function matchesCidr(
  bytes: Uint8Array,
  range: { bytes: Uint8Array; prefix: number }
): boolean {
  const fullBytes = range.prefix >> 3;
  for (let i = 0; i < fullBytes; i += 1) {
    if (bytes[i] !== range.bytes[i]) return false;
  }
  const remainingBits = range.prefix & 7;
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (bytes[fullBytes] & mask) === (range.bytes[fullBytes] & mask);
}

const PARSED_IPV4 = BLOCKED_IPV4.map((r) => ({ ...parseCidr(r.cidr, 4), reason: r.reason }));
const PARSED_IPV6 = BLOCKED_IPV6.map((r) => ({ ...parseCidr(r.cidr, 16), reason: r.reason }));
const PARSED_EMBEDDING = IPV4_EMBEDDING_RANGES.map((r) => ({
  ...parseCidr(r.cidr, 16),
  reason: r.reason,
}));

/**
 * Pull the IPv4 address embedded in a transition or translation address, if any.
 *
 * `::ffff:a.b.c.d` and NAT64 put it in the low 32 bits. 6to4 puts it in bytes 2-5.
 * Teredo puts the *server* address in bytes 4-7; its client field is the last 32
 * bits obfuscated by a bitwise complement, which is undone here. The result is
 * checked against the IPv4 policy so `::ffff:169.254.169.254` cannot reach the
 * metadata service through a v6 socket.
 *
 * Consulted against `IPV4_EMBEDDING_RANGES`, not the unconditional table, so that a
 * public address reached through a translation prefix is judged on the IPv4 it carries.
 */
function extractEmbeddedIPv4(bytes: Uint8Array): number | null {
  let matched: { reason: BlockReason; range: { bytes: Uint8Array; prefix: number } } | null = null;
  for (const range of PARSED_EMBEDDING) {
    if (matchesCidr(bytes, range)) {
      matched = { reason: range.reason as BlockReason, range };
      break;
    }
  }
  if (!matched) return null;

  switch (matched.reason) {
    case 'ipv4-mapped':
    case 'nat64':
    case 'nat64-local':
      return ((bytes[12] << 24) | (bytes[13] << 16) | (bytes[14] << 8) | bytes[15]) >>> 0;
    case '6to4':
      return ((bytes[2] << 24) | (bytes[3] << 16) | (bytes[4] << 8) | bytes[5]) >>> 0;
    case 'teredo': {
      // Teredo obfuscates the client IPv4 by complementing it; the server IPv4 sits
      // in bytes 4-7 in the clear.
      const server = ((bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7]) >>> 0;
      const clientObfuscated =
        ((bytes[12] << 24) | (bytes[13] << 16) | (bytes[14] << 8) | bytes[15]) >>> 0;
      // Either half being non-public is enough to refuse the destination.
      return classifyIPv4(server) !== null ? server : (clientObfuscated ^ 0xffffffff) >>> 0;
    }
    default:
      return null;
  }
}

function classifyIPv4(packed: number): BlockReason | null {
  const bytes = new Uint8Array(4);
  bytes[0] = (packed >>> 24) & 0xff;
  bytes[1] = (packed >>> 16) & 0xff;
  bytes[2] = (packed >>> 8) & 0xff;
  bytes[3] = packed & 0xff;
  for (const range of PARSED_IPV4) {
    if (matchesCidr(bytes, range)) return range.reason as BlockReason;
  }
  return null;
}

/**
 * Decide whether a single resolved address may be contacted.
 *
 * Unknown or unparseable input is denied. Failing closed matters more here than
 * reporting precisely: a name that resolves to something this code cannot read is
 * far more likely to be an attack than a legitimate destination.
 */
export function classifyAddress(address: string): AddressClassification {
  const trimmed = typeof address === 'string' ? address.trim() : '';
  if (!trimmed) {
    return { allowed: false, reason: 'not-an-ip-address', family: 0 };
  }

  const asV4 = parseIPv4(trimmed);
  if (asV4 !== null) {
    const reason = classifyIPv4(asV4);
    return reason === null
      ? { allowed: true, address: trimmed, family: 4 }
      : { allowed: false, reason, family: 4 };
  }

  const asV6 = parseIPv6(trimmed);
  if (asV6 === null) {
    return { allowed: false, reason: 'not-an-ip-address', family: 0 };
  }

  // Order matters. An address in an embedding prefix is judged by the IPv4 it carries,
  // so a NAT64 or v4-mapped address pointing at a public host stays usable instead of
  // being refused for the shape of its prefix. Only when it is not an embedding address
  // does the unconditional table apply.
  const embedded = extractEmbeddedIPv4(asV6);
  if (embedded !== null) {
    const reason = classifyIPv4(embedded);
    return reason === null
      ? { allowed: true, address: trimmed, family: 6 }
      : { allowed: false, reason, family: 6 };
  }

  for (const range of PARSED_IPV6) {
    if (matchesCidr(asV6, range)) {
      return { allowed: false, reason: range.reason as BlockReason, family: 6 };
    }
  }

  return { allowed: true, address: trimmed, family: 6 };
}

/** Convenience predicate for call sites that only need a yes/no answer. */
export function isAddressAllowed(address: string): boolean {
  return classifyAddress(address).allowed;
}

/**
 * Narrowing guard for `AddressClassification`.
 *
 * Needed as an explicit function because this workspace compiles with
 * `strictNullChecks` off, where TypeScript does not narrow a union on a boolean
 * discriminant. Written out so the call sites stay readable and stay honest.
 */
export function isBlockedAddress(
  verdict: AddressClassification
): verdict is { allowed: false; reason: BlockReason; family: 4 | 6 | 0 } {
  return verdict.allowed === false;
}
