# Security Policy

## Reporting a Vulnerability

If you discover a security issue in **API Monitor SaaS**, **please do not** open a public issue.

Report it privately by emailing **darshan.kachare.dev@gmail.com**, or by opening a
[private security advisory](https://github.com/dsk-dev-ai/api-monitor-saas/security/advisories/new).

Please include as much of the following as possible:

- The type of issue (e.g. SSRF, auth bypass, token leak, SQL injection, XSS).
- Full paths of the source file(s) related to the issue.
- The location of the affected source code (tag, branch, or commit).
- Any special configuration required to reproduce.
- Step-by-step instructions to reproduce.
- Proof-of-concept or exploit code, if any.
- Impact of the issue, including what an attacker could achieve.

You can expect an acknowledgement within a few days. Fixes for confirmed issues
are prioritised by severity; the maintainer is a single developer, so complex
reports may take longer to resolve than you would like.

## Supported versions

Only the latest tagged release on `main` receives security fixes.

## SSRF in the monitoring worker

### History and current status — **fixed, see "SSRF policy" below**

This was a live vulnerability. It is now mitigated in the worker, and the
mitigation is covered by tests. The residual risks are listed under
[SSRF policy](#ssrf-policy-mitigations-and-residual-risk) and are real; read them
before exposing the product to untrusted users.

**What it was.** Monitors are user-supplied URLs that the worker fetches on the
user's behalf. The worker originally had no destination validation at all, so any
user could point a monitor at loopback, the RFC1918 ranges, the Docker host
gateway, or a cloud metadata endpoint such as `169.254.169.254`, and read the
result back through the monitor's status code and timing. On a cloud host this
included instance credentials from the metadata service. Redirects were followed
by the HTTP client with no re-validation, and there was no DNS rebinding
protection, so a first-hop allowlist alone would not have closed it.

**Fixed in** the commits that introduced `worker/src/security/` — see
[CHANGELOG.md](CHANGELOG.md).

## SSRF policy: mitigations and residual risk

The policy lives in two files, both in `worker/src/security/`, and nowhere else:

- `ip-policy.ts` — classifies a single resolved address. No DNS, no HTTP.
- `ssrf-policy.ts` — URL parsing, scheme allowlist, DNS resolution, and the
  connect-time guard.

`worker/src/services/executor.ts` is the only caller. There is no second fetch
path; see the security review note in [CHANGELOG.md](CHANGELOG.md).

### What is blocked

A destination is refused unless **every** address it resolves to is globally
routable. Blocked IPv4 ranges:

| Range | Why |
|---|---|
| `0.0.0.0/8` | this-network |
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | RFC1918 private; `172.16/12` covers the Docker bridge |
| `100.64.0.0/10` | carrier-grade NAT; also Alibaba metadata `100.100.100.200` |
| `127.0.0.0/8` | loopback |
| `169.254.0.0/16` | link-local; includes AWS/Azure/GCP/DO/Oracle IMDS `169.254.169.254` |
| `192.0.0.0/24` | IETF protocol assignments |
| `192.88.99.0/24` | 6to4 relay anycast |
| `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` | documentation |
| `198.18.0.0/15` | benchmarking |
| `224.0.0.0/4` | multicast |
| `240.0.0.0/4` | reserved, includes broadcast `255.255.255.255` |

Blocked IPv6 ranges, on the strength of the range alone:

| Range | Why |
|---|---|
| `::/128`, `::1/128` | unspecified, loopback |
| `64:ff9b:1::/48` | NAT64 local-use; the translation is not well defined, so it is refused outright |
| `100::/64` | discard-only |
| `2001:2::/48` | benchmarking |
| `2001:10::/28`, `2001:20::/28` | ORCHID |
| `2001:db8::/32`, `3fff::/20` | documentation |
| `fc00::/7` | unique-local; includes AWS IPv6 metadata `fd00:ec2::254` |
| `fe80::/10` | link-local |
| `ff00::/8` | multicast |

Four further prefixes are **not** blocked on the strength of the prefix, because
they carry a full IPv4 address that can be classified on its own:

| Prefix | Embedded IPv4 | Judged as |
|---|---|---|
| `::ffff:0:0/96` | last 32 bits | IPv4-mapped |
| `64:ff9b::/96` | last 32 bits | NAT64 |
| `2001::/32` | bytes 4-7, with the client field un-complemented | Teredo |
| `2002::/16` | bytes 2-5 | 6to4 |

For these, the question is not "is this prefix special" but "which IPv4 does it
reach", so the embedded address is classified against the IPv4 table above.
`http://[::ffff:169.254.169.254]/` reaches the metadata service through a v6
socket and is refused; `64:ff9b::42f1:7de8` embeds the ordinary public address
`66.241.125.232` and is allowed.

This distinction was found by running the policy, not by reading it. An earlier
version refused these four prefixes outright, which looks stricter and is wrong: a
DNS64/NAT64 resolver is what a container gets on an IPv6-only host, so the policy
refused *every* hostname it resolved, including public ones. Refusing a prefix
whose payload is checked elsewhere is only safe if you never intend to allow
anything in it.

### Obfuscated representations

The policy does not match strings. It relies on the WHATWG `URL` parser, which
canonicalises the host before the policy sees it, so all of these are classified as
`127.0.0.1` and refused: `2130706433`, `0x7f000001`, `0177.0.0.1`, `0x7f.0.0.1`,
`127.1`, `%31%32%37.0.0.1`, and fullwidth digits. Any future encoding the parser
canonicalises is covered for free.

### Scheme policy

Only `http:` and `https:` are accepted. `file:`, `ftp:`, `gopher:`, `data:`,
`javascript:`, `ws:` and any other scheme are rejected **before** resolution, so
a rejected scheme never causes a DNS query. A redirect cannot change the scheme
either: each hop is re-validated, so a `302` to `file:///etc/passwd` is refused.

### DNS and rebinding

A name is resolved once for validation and **again at connect time**. The second
resolution happens inside a `lookup` function installed on the request's agent, so
the address that is classified is the address that is dialled. There is no window
in which a validated name can be re-resolved to something else, because there is no
second, unguarded resolution. A test drives a name that returns a public address
for validation and a loopback address for the connection and asserts the
connection is refused.

A name that resolves to *any* mix of public and private addresses is refused
outright, rather than picking the public one. Choosing for the caller would hand
the decision back to the resolver, which is the component an attacker controls.

### Redirect policy

The HTTP client is never allowed to follow a redirect. `maxRedirects: 0` puts
axios on Node's native `http`/`https` transport instead of `follow-redirects`, and
the executor walks the chain itself: request, read `Location`, resolve it relative
to the current URL, run the full policy on the new destination, and only then
continue. At most **5** hops. A `Location` that cannot be resolved safely ends the
attempt. On `303`, and on `301`/`302` for anything but `HEAD`, the follow-up
becomes a `GET` and the request body is dropped, so a `POST` body is not re-sent to
a different origin.

## SSRF error behaviour

A refused target returns:

```
Monitor target resolves to a restricted network destination.
```

The same message is used for every member of the "restricted" family, so a monitor
cannot be used to discover which internal addresses exist. The specific reason and
the address go to the worker log, not to the user. The project already had two
error shapes for this and neither was used: this is not an API response, it is the
`error` field of a `Check` record shown in the dashboard.

### Residual risk — read before exposing this to untrusted users

1. **DNS is still resolved before use.** A hostile hostname causes one outbound DNS
   query for attacker-chosen data. That is blind exfiltration of a few bits per
   check, not a read of internal state, and application code cannot prevent it. The
   fix is an egress-restricted resolver or a network policy, not a code change.
2. **A rebinding attack on a redirect hop is not covered by an automated test.** The
   guard is installed per request and therefore applies to every hop, and redirect
   re-validation is tested, but the specific combination needs a routable public
   address or a network-level interceptor to exercise. It is argued, not proven.
3. **The policy is a denylist of special-purpose ranges, not an allowlist of
   destinations.** A range that is genuinely special-purpose but missing from
   `ip-policy.ts` would pass. The table is derived from the IANA special-purpose
   registry; additions to that registry are not tracked automatically. If you need a
   hard guarantee, run the worker in a network with no route to anything internal —
   that control is stronger than any list.
4. **The `Host` header is not pinned.** Redirects are validated, so a redirect cannot
   reach a private address, but a public server can still reflect a `Host` of its
   choosing into virtual-host routing. This is normal client behaviour and is out of
   scope.

### Testing coverage

`worker/src/security/ssrf-policy.test.ts`, `worker/src/services/executor.test.ts`
and `worker/src/services/executor.e2e.test.ts` — 149 tests, run with
`npm test -w worker`. They cover every range in the tables above, the obfuscated
encodings, the cloud metadata addresses, split-horizon names, DNS rebinding, every
redirect case in the list, scheme smuggling via `Location`, and the error text.

`executor.e2e.test.ts` runs the **real** policy against a **real** server that is
genuinely listening on loopback, and asserts the server never received a request.
Removing the guard was verified to fail these tests — with the guard disabled the
check returns `status: "up"` after a successful connection to the live server.

## Response body size limit

### What it bounds

A monitored response body is capped at **1 MiB (1,048,576 bytes)** by default,
overridable with `MAX_RESPONSE_BYTES` and clamped to a hard ceiling of **64 MiB**.

The number is sized from what the product does with a body. The worker reads one only
to match the monitor's `expectedKeyword`; it never stores or returns a body. A status
check and a small marker string in a JSON or HTML response is kilobytes, so 1 MiB is
a wide margin over any realistic endpoint while putting a ceiling on what one check can
cost. Raising it to a large value to accommodate one monitor would be choosing the
number to avoid failures rather than to bound the resource.

**A limit that can be configured without bound is not a limit**, so a configured value
above 64 MiB is clamped rather than honoured. Otherwise `MAX_RESPONSE_BYTES` would be a
documented way to switch the protection off, recorded only in an environment variable
nobody reads. Anyone who needs to watch a payload that large wants a different tool.

### How it is enforced

Enforced while the response is consumed, not measured afterwards:

```
validate destination → request → Content-Length fast path → bounded read → verdict
```

* The response is requested with `responseType: 'stream'`. The client's default
  collects the entire body into `response.data` *before the promise settles*, which
  hands the choice of how much memory the worker uses to the target. Streaming moves
  that decision into the executor.
* **Before reading:** an honest `Content-Length` above the limit aborts the transfer
  from the header alone, without buffering.
* **While reading:** a running byte count is checked on every chunk. The chunk that
  crosses the limit is never collected, the stream is destroyed, and the check fails.
  Peak memory for one check is the limit plus the one chunk that crossed it.
* `Content-Length` is only a fast path. It is a header from an untrusted party: a
  target that will send a huge body will omit it, and a chunked response carries none
  at all. Both are protected by the running count, and both are tested.

### Compressed responses

`decompress: true` is set explicitly, so the stream that is counted is the
**post-inflation** byte stream — the bytes that would actually occupy memory.

This ordering is the whole point. A 4 KiB gzip body that expands to 400 MiB carries
`Content-Length: 4096`, so the fast path sees a perfectly reasonable response and
**only** the running count catches it. The consequence, stated plainly: `Content-Length`
is therefore checked *before* decompression and is the *compressed* size, so it can
only ever be an early-out for a plain body. It is never the bound. gzip, deflate and
Brotli are each tested with a payload that is far under the limit on the wire and far
over it inflated.

### Redirects and timeouts

A redirect's body is never inspected — only its `Location` — so it is destroyed before
the next hop rather than read and dropped. A chain therefore cannot accumulate a body
per hop, and a host answering a 302 with a large payload costs nothing.

The existing deadline is unchanged and covers the whole attempt, redirects included.
It tears down an in-progress body read; a response that drips forever fails on the
deadline and a response that overruns the limit fails on the limit, and a check cannot
outlive either.

### When a monitor exceeds it

The check is recorded as `down` with exactly:

```
Response body exceeded the configured size limit.
```

Fixed text. It does not vary with the byte count, the target or the response contents,
because the monitor's owner supplied the target and is untrusted: a message built from
response data would be an oracle, and one naming the target would leak the address the
SSRF policy above goes to such lengths to hide. The limit, the received byte count and
the declared length go to the worker log. No part of the body is retained or returned.

### What the limit does *not* do

* It does not apply to a response that cannot have a body. A `HEAD` request returns the
  `Content-Length` its matching `GET` would have sent, and 204/304 have none; reporting
  a size failure there would break a working monitor that read zero bytes. An empty
  body simply cannot match a keyword, which is reported as a missing keyword.
* It does not bound time-to-first-byte, total transfer duration, or the *compressed*
  bytes in flight. Those are bounded by the existing timeouts.
* It does not limit the request body the worker sends, only what it reads back.

## Known security limitations

Disclosed rather than hidden. These are unrelated to SSRF and are all still open.

### Single-owner tenancy, no RBAC

Authorization is owner-scoped: each handler compares the record's `userId` to the
authenticated user. There are no roles, permissions, or membership tables.
PostgreSQL row-level security is **not** enabled, so the application layer is the
only enforcement point and a query bug in any handler would expose cross-tenant
data. Tracked in [ROADMAP.md](ROADMAP.md) (P3).

### The backend requires a Supabase service-role key

This is true of the default configuration only. When `AUTH_PROVIDER_MODULE`
selects a different identity system, no Supabase key is needed and none is loaded.

In the default configuration the backend holds a service-role key to verify tokens.
Anyone with access to that key has full administrative control of the Supabase auth
schema. Treat it as a production secret: set it in the environment only, never in a
committed file, and rotate it if it is exposed.

### A replacement identity system is trusted, not verified

`AUTH_PROVIDER_MODULE` lets an operator substitute the whole authentication surface, and the
core accepts whatever that module returns. The core still requires a matching local `User`
row, but it has no way to check *how* the provider established that identity — a provider
that returns a user for any non-empty token turns the API into an unauthenticated one. The
module id is therefore an operator decision with the same weight as the service-role key
above: treat a provider you did not write as trusted code that runs inside the request path.
The contract is documented in `backend/src/auth/provider.ts`.

The seam applies to the API only. The bundled frontend in `frontend/` calls the Supabase SDK
directly and has no equivalent provider indirection, so a deployment using a different
identity system must supply its own front end; the shipped dashboard is not covered by the
`AUTH_PROVIDER_MODULE` guarantee.

`.dockerignore` files exclude `.env` from the build context specifically so this
key is not baked into image layers. Verify that exclusion still holds after any
Dockerfile change — see [ENV_GUIDE.txt](ENV_GUIDE.txt).

### No audit log

Security-relevant actions are not recorded. There is no way to answer "who
changed this, and when" after the fact. Tracked in [ROADMAP.md](ROADMAP.md) (P3).

## Hardening already in place

| Control | Implementation |
|---|---|
| SQL injection | Prisma parameterizes all queries; no raw SQL in application code |
| Secrets in images | `.dockerignore` excludes `.env` at the root, `backend/`, and `frontend/` |
| Secrets in git | `.env` is gitignored; `.env.example` contains placeholders only |
| Security headers | `helmet` with explicit CSP and HSTS |
| CORS | Explicit origin allowlist, not a wildcard |
| Rate limiting | Global limiter plus a stricter limiter on `/api` |
| Webhook integrity | Stripe signatures verified against the raw request body |
| Input validation | Zod schemas on environment and request payloads |
| SSRF | Server-side destination policy: scheme allowlist, resolved-address classification, and a guarded connect-time lookup. See above |
| Response size | Streamed and consumed under a 1 MiB running byte count; decompression counted after inflation. See above |
| Dependency licensing | All 73 direct dependencies are permissive; CI enforces it |

## Deployment recommendations

- Terminate TLS in front of the application. `nginx/nginx.conf` is a reference
  configuration.
- Read [SSRF policy](#ssrf-policy-mitigations-and-residual-risk) before exposing
  the product to untrusted users. The four residual risks there are not theoretical.
- Run the worker in a network with no route to internal services. That is a stronger
  control than the in-process destination policy and the two compose well.
- Keep `.env` out of version control and out of images.
- Rotate `SUPABASE_SERVICE_ROLE_KEY` and `JWT_SECRET` if either is ever exposed.
- Back up the database and **test the restore**. Recovery is currently manual.
