import axios, { AxiosError, AxiosResponse, Method } from 'axios';
import http from 'node:http';
import https from 'node:https';
import type { Readable } from 'node:stream';
import type net from 'node:net';
import {
  createGuardedLookup,
  isRejectedTarget,
  MAX_REDIRECTS,
  REDIRECT_STATUSES,
  SsrfBlockedError,
  validateMonitorTarget,
} from '../security/ssrf-policy';
import {
  isFiniteByteCount,
  maxResponseBytes,
  RESPONSE_TOO_LARGE_MESSAGE,
} from '../config/response-limit';
import { logger } from '../utils/logger';

export interface CheckResult {
  status: 'up' | 'down' | 'degraded';
  statusCode?: number;
  responseTime: number;
  error?: string;
}

/**
 * Perform one HTTP request that cannot be redirected by the HTTP client.
 *
 * `maxRedirects: 0` makes axios use Node's native `http`/`https` transport instead of
 * `follow-redirects`, so the only destination this can reach is the one in `target`.
 * The agents carry a guarded `lookup` so the address dialled is the address that was
 * classified, which is what prevents a name from being re-resolved to something else
 * between the check and the connection.
 *
 * A fresh agent pair is built per request. Agents pool sockets, and a pooled socket
 * would be reused for a destination whose policy decision was made earlier in the
 * cycle; `keepAlive: false` keeps each attempt's decision bound to that attempt.
 *
 * The response is requested as a stream and is never handed back in buffered form.
 * The default `responseType` collects the entire body into `response.data` before the
 * promise settles, which means a target can decide how much memory this worker uses
 * and how long it waits. Streaming moves that decision to the executor, which caps it.
 */
function requestOnce(
  target: string,
  method: Method,
  headers: Record<string, string>,
  body: string | undefined,
  timeout: number,
  signal: AbortSignal,
  onBlocked: (detail: string) => void
): Promise<AxiosResponse> {
  const guardedLookup = createGuardedLookup(onBlocked);
  return axios({
    method,
    url: target,
    headers: {
      'User-Agent': 'API-Monitor/1.0',
      ...headers,
    },
    data: body,
    timeout,
    maxRedirects: 0,
    validateStatus: () => true,
    signal,
    // The caller gets a stream. Nothing is buffered by the client, so the response
    // size is bounded by `readBoundedBody` rather than by the target.
    responseType: 'stream',
    // Explicit rather than inherited from the client default, because the guarantee
    // below depends on it: with this on, the stream handed back is the *decompressed*
    // byte stream, so counting it counts what would actually occupy memory. Turning it
    // off would silently move the count back onto the compressed bytes and reopen a
    // decompression bomb. See `readBoundedBody`.
    decompress: true,
    // axios's own streamed-response limit is disabled deliberately. It implements the
    // cap by wrapping the stream in a lazily-driven async generator, so the teardown
    // path from "limit exceeded" back to the socket runs through generator and iterator
    // finalization rather than an explicit destroy, and what I hold is the wrapper
    // rather than the real socket stream. This module enforces the cap itself and
    // destroys the stream and the request directly, which is checkable in a test.
    maxContentLength: -1,
    // Never honour proxy environment variables. A configured HTTP_PROXY would send
    // the request to a proxy whose address is not the destination this policy
    // approved, and the proxy's own DNS would be doing the resolving.
    proxy: false,
    httpAgent: new http.Agent({ keepAlive: false, lookup: guardedLookup as unknown as net.LookupFunction }),
    httpsAgent: new https.Agent({ keepAlive: false, lookup: guardedLookup as unknown as net.LookupFunction }),
  });
}

/**
 * Stop and release a response we are not going to finish reading.
 *
 * Both halves matter. Destroying the stream stops the bytes arriving; destroying the
 * request closes the socket underneath it. Doing only the first would leave the
 * connection open and the server still writing into it, and on a monitor that is
 * retried every 30 seconds that is a slow socket leak.
 *
 * A no-op `error` handler is attached first because the socket can fail on its own
 * while the teardown is in progress, and an `error` event on a stream nobody is
 * listening for is an unhandled exception that would take the worker down.
 *
 * Destroying this one stream closes the socket underneath it; see `destroyResponse`.
 */
function discardResponse(response: AxiosResponse): void {
  destroyResponse(response);
}

/**
 * The same teardown, optionally failing the stream with `error`.
 *
 * Destroying with an error is how the deadline reaches a read that is already in
 * progress: a stream destroyed *without* an error simply ends its async iteration, so a
 * body that stopped arriving mid-transfer would look like a short but complete one.
 *
 * Destroying this one stream is enough to close the socket underneath it, and the
 * suite checks that rather than assuming it. With no content encoding the stream *is*
 * the socket's response object. With one, the client composes the response through
 * `stream.pipeline`, which propagates a destroy back up the chain to the socket. So
 * there is no second handle to close, and adding one would be untested code implying
 * a guarantee nothing depends on.
 */
function destroyResponse(response: AxiosResponse, error?: Error): void {
  const stream = response.data as Readable;
  stream.on('error', () => {
    // The response is already being abandoned. A failure here changes nothing.
  });
  stream.destroy(error);
}

/**
 * Read a declared `Content-Length`, or null when there isn't a trustworthy one.
 *
 * Absent on a chunked response, which is the common case for a server streaming an
 * unbounded body, and often absent from a server that would rather not commit to a
 * size. Only a plain run of digits counts: a header like `Content-Length: 0x10` or a
 * duplicate that got joined is a server being wrong, and treating an unparseable value
 * as zero would make the fast path below claim the body is empty.
 */
function declaredContentLength(response: AxiosResponse): number | null {
  const headers = response.headers as unknown as Record<string, unknown> | undefined;
  const raw = headers?.['content-length'];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return isFiniteByteCount(parsed) ? parsed : null;
}

type BoundedBody =
  | { outcome: 'ok'; text: string; bytes: number }
  | { outcome: 'too-large'; bytes: number; declaredLength: number | null };

/**
 * True for a response that cannot carry a body, however large it says it is.
 *
 * A `HEAD` request returns the `Content-Length` the matching `GET` *would* have sent and
 * no body at all, and 204/304 are defined to have none. Applying the limit to the
 * declared length there would fail a monitor that is not transferring anything — a
 * perfectly ordinary `HEAD` probe of a large file would report the size error while
 * having read zero bytes. This is the false-positive direction, which a size limit is
 * supposed to avoid as much as a false negative.
 */
function responseCanCarryBody(response: AxiosResponse, method: Method): boolean {
  // The HTTP client normalises the method to lower case, so an upper-case comparison
  // would silently never match and the guard below would be dead code.
  if (String(method).toLowerCase() === 'head') return false;
  const status = response.status;
  if (status === 204 || status === 304) return false;
  return status >= 200;
}

/**
 * Consume at most `limit` bytes of a response body, aborting the transfer if it exceeds
 * that.
 *
 * The limit is applied to the stream as it is read, so the bytes that would have
 * exceeded it are never collected. Peak memory for one check is the limit plus the one
 * chunk that crossed it; the response is not held after the check and is not returned
 * to the caller in any form.
 *
 * This counts the stream the client hands over, and because `decompress: true` is set,
 * that stream is post-inflation. That ordering is the whole point: a 4 KiB gzip body
 * that expands to 400 MiB has a `Content-Length` of 4096, so the fast path below sees
 * nothing wrong with it and the running count is the only thing that stops it. The
 * consequence is that `Content-Length` is checked *before* decompression — it is the
 * compressed size, so it can only ever be an early-out for a plain body, never the
 * bound. The running count is the bound.
 *
 * `Content-Length` is not trusted as the sole protection even uncompressed. It is a
 * header: a target that is malicious enough to send a huge body is malicious enough to
 * omit it or understate it, and a chunked response carries none at all.
 */
async function readBoundedBody(
  response: AxiosResponse,
  limit: number,
  signal: AbortSignal
): Promise<BoundedBody> {
  const stream = response.data as Readable;
  const carriesBody = responseCanCarryBody(response, response.config?.method as Method);
  const declaredLength = declaredContentLength(response);

  if (carriesBody && declaredLength !== null && declaredLength > limit) {
    discardResponse(response);
    return { outcome: 'too-large', bytes: declaredLength, declaredLength };
  }

  const chunks: Buffer[] = [];
  let total = 0;

  // The deadline abort destroys this stream, so the loop below would normally throw on
  // its own. The check makes the timeout deterministic instead of depending on that
  // teardown propagating, and carrying ECONNABORTED routes it to the same reported
  // timeout rather than a bare "AbortError". It is also re-checked after the loop: a
  // stream destroyed without an error ends the iteration rather than throwing, and
  // treating that as a complete body would let a truncated response be matched for a
  // keyword and reported as a passing check.
  const deadlineExceeded = () => new AxiosError('Request timed out', AxiosError.ECONNABORTED);
  const onAbort = (): void => {
    destroyResponse(response, deadlineExceeded());
  };
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    if (signal.aborted) throw deadlineExceeded();
    for await (const chunk of stream) {
      if (signal.aborted) throw deadlineExceeded();
      const buffer = chunk as Buffer;
      total += buffer.length;
      if (total > limit) {
        discardResponse(response);
        return { outcome: 'too-large', bytes: total, declaredLength };
      }
      chunks.push(buffer);
    }
    if (signal.aborted) throw deadlineExceeded();
  } catch (error) {
    discardResponse(response);
    throw error;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }

  return { outcome: 'ok', text: Buffer.concat(chunks).toString('utf8'), bytes: total };
}

/**
 * Resolve a `Location` header against the URL that produced it.
 *
 * Returns null when the result is not an absolute http(s) URL, which covers both a
 * malformed header and a downgrade attempt through a scheme we do not support.
 */
function resolveRedirect(current: string, location: string | undefined): string | null {
  if (!location) return null;
  let next: URL;
  try {
    next = new URL(location, current);
  } catch {
    return null;
  }
  return next.toString();
}

/**
 * Decide which caller-supplied headers may travel to the next hop.
 *
 * Headers are bound to the origin they were configured for. `follow-redirects`, which
 * the executor used before it walked redirects itself, dropped `Authorization`,
 * `Proxy-Authorization` and `Cookie` at an origin boundary; a hand-rolled loop that
 * dropped nothing would be a regression against that.
 *
 * This is deliberately stricter than the client it replaces. `follow-redirects` had to
 * enumerate known credential headers, and any caller header can be a credential
 * (`X-Api-Key`, `X-Auth-Token`, and every vendor's variant), so an enumeration that
 * misses one leaks silently. The monitor's own `Authorization` header is the common
 * case and is exactly what this exists to stop.
 */
interface HopHeaders {
  headers: Record<string, string>;
  dropped: boolean;
}

function headersForHop(
  headers: Record<string, string>,
  fromUrl: string,
  toUrl: string,
  alreadyDropped: boolean
): HopHeaders {
  const from = new URL(fromUrl);
  const to = new URL(toUrl);
  if (from.origin === to.origin && !alreadyDropped) {
    return { headers, dropped: false };
  }
  // The drop is sticky. Recomputing from the original headers on every hop would let a
  // chain of A -> B -> B/page restore the credentials on the third request, because that
  // hop is same-origin with B. Once a chain has left the origin the user configured, the
  // credentials are gone for the rest of it.
  if (!alreadyDropped) {
    logger.warn('Dropping caller headers on cross-origin redirect', {
      from: from.origin,
      to: to.origin,
    });
  }
  return { headers: {}, dropped: true };
}

/**
 * Guarantee a diagnostic on every failed check.
 *
 * Observed in the running container: an intermittent failure surfaced as
 * `{ status: "down", error: "" }`, which tells an operator nothing and cannot be
 * distinguished from a monitor that was never scheduled. Some client errors carry an
 * empty `message`, so the name and code are used as fallbacks before giving up.
 */
function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    if (error.message) return error.message;
    const code = (error as Error & { code?: string }).code;
    return code ? `${error.name} (${code})` : error.name;
  }
  if (typeof error === 'string' && error) return error;
  return 'Unknown error';
}

export async function executeCheck(
  url: string,
  method: Method = 'GET',
  headers: Record<string, string> = {},
  body?: string,
  timeout: number = 30000,
  expectedStatus?: number,
  expectedKeyword?: string
): Promise<CheckResult> {
  const startTime = Date.now();

  // One deadline for the whole attempt, redirects included, so a chain of hops
  // cannot multiply the time a single monitor occupies.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeout);
  // 303, and 301/302 in practice, turn the follow-up into a GET. Preserving the
  // original method against a new origin would re-send the caller's body somewhere
  // they did not intend.
  let currentMethod = method;
  let currentBody = body;
  let currentUrl: string;
  let currentHeaders = headers;
  let headersDropped = false;
  /**
   * Set when the connect-time guard refuses a destination. Tracked here rather than
   * read off the thrown error, because the HTTP client replaces socket errors with
   * its own and would otherwise both mask the refusal and surface the detail text.
   */
  let blockedDetail: string | null = null;

  try {
    let validation = await validateMonitorTarget(url);
    if (isRejectedTarget(validation)) {
      // The reason is useful to whoever operates this; it names an internal address,
      // so it goes to the log and never to the user.
      logger.warn(`Monitor target refused: ${validation.detail}`, {
        code: validation.code,
      });
      return {
        status: 'down',
        responseTime: Date.now() - startTime,
        error: validation.publicMessage,
      };
    }
    currentUrl = validation.url.toString();

    let response!: AxiosResponse; // assigned on every path that reaches the code below
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      response = await requestOnce(
        currentUrl,
        currentMethod,
        currentHeaders,
        currentBody,
        timeout,
        controller.signal,
        (detail) => {
          blockedDetail = detail;
        }
      );

      const status = response.status;
      if (!REDIRECT_STATUSES.has(status)) break;

      // A redirect's body is never inspected — only its `Location` — so it is
      // discarded before the next request instead of being read and dropped. This
      // matters more with each hop: without it a chain of redirects would leave a
      // socket open per hop, and a target that answers a 302 with a large body would
      // get the worker to pull that body for no reason.
      discardResponse(response);

      const location = (response.headers?.location ?? undefined) as string | undefined;
      const next = resolveRedirect(currentUrl, location);

      if (!next) {
        return {
          status: 'down',
          statusCode: status,
          responseTime: Date.now() - startTime,
          error: 'Redirect could not be followed safely.',
        };
      }

      if (hop === MAX_REDIRECTS) {
        return {
          status: 'down',
          statusCode: status,
          responseTime: Date.now() - startTime,
          error: `Too many redirects (limit ${MAX_REDIRECTS}).`,
        };
      }

      // Re-run the full policy on the new destination. This is the step that stops a
      // public host from bouncing the worker onto the private network, and it is
      // why the client is never allowed to follow redirects itself.
      validation = await validateMonitorTarget(next);
      if (isRejectedTarget(validation)) {
        logger.warn(`Redirect target refused: ${validation.detail}`, {
          code: validation.code,
          from: currentUrl,
        });
        return {
          status: 'down',
          statusCode: status,
          responseTime: Date.now() - startTime,
          error: validation.publicMessage,
        };
      }

      // A 307/308 preserves the method *and* the body by definition, so a cross-origin
      // one would re-send the monitor's request body to a host the user never named.
      // Dropping the body would instead make the check report on a request the user did
      // not configure, which is a wrong result rather than a failed one. Refuse.
      if (
        (status === 307 || status === 308) &&
        currentBody !== undefined &&
        new URL(currentUrl).origin !== new URL(next).origin
      ) {
        logger.warn('Refusing cross-origin 307/308 with a request body', {
          from: new URL(currentUrl).origin,
          to: new URL(next).origin,
        });
        return {
          status: 'down',
          statusCode: status,
          responseTime: Date.now() - startTime,
          error: 'Refusing to re-send a request body to a different origin on a 307/308 redirect.',
        };
      }

      // Resolved against the hop we just left, so the comparison has to happen before
      // `currentUrl` is advanced.
      const hopHeaders = headersForHop(headers, currentUrl, next, headersDropped);
      currentHeaders = hopHeaders.headers;
      headersDropped = hopHeaders.dropped;
      currentUrl = validation.url.toString();
      if (status === 303 || ((status === 301 || status === 302) && currentMethod !== 'HEAD')) {
        currentMethod = 'GET';
        currentBody = undefined;
      }
    }

    const statusCode = response.status;

    // Determine whether the response status is acceptable.
    // - If an explicit expectedStatus is given, require an exact match.
    // - Otherwise (blank), default to "any 2xx" as documented in the UI.
    const statusOk = expectedStatus
      ? statusCode === expectedStatus
      : statusCode >= 200 && statusCode < 300;

    if (!statusOk) {
      // The body is not going to be looked at, so it is not read. Abandoning the
      // stream here is what keeps a monitor against a host that answers 500 with a
      // 2 GB payload from costing anything.
      discardResponse(response);
      const expectedLabel = expectedStatus
        ? `Expected status ${expectedStatus}, got ${statusCode}`
        : `Expected 2xx status, got ${statusCode}`;
      return {
        status: 'down',
        statusCode,
        responseTime: Date.now() - startTime,
        error: expectedLabel,
      };
    }

    if (!expectedKeyword) {
      // The body has no consumer, so it never gets read. This is the common case — a
      // monitor usually asserts on the status code alone — and it means an ordinary
      // check holds no response body in memory at any point.
      discardResponse(response);
    } else {
      // The only path that consumes a body, and the only one bounded by the limit.
      const bounded = await readBoundedBody(response, maxResponseBytes, controller.signal);
      if (bounded.outcome === 'too-large') {
        // The byte counts and the target are operator-facing diagnostics. The monitor's
        // owner gets fixed text, so neither the address nor the size of the payload can
        // be inferred from the check result.
        logger.warn('Monitor response exceeded the size limit', {
          limitBytes: maxResponseBytes,
          receivedBytes: bounded.bytes,
          declaredLength: bounded.declaredLength,
        });
        return {
          status: 'down',
          statusCode,
          responseTime: Date.now() - startTime,
          error: RESPONSE_TOO_LARGE_MESSAGE,
        };
      }

      if (!bounded.text.includes(expectedKeyword)) {
        return {
          status: 'down',
          statusCode,
          responseTime: Date.now() - startTime,
          error: `Expected keyword "${expectedKeyword}" not found`,
        };
      }
    }

    // Timed after the body, so a target that holds the transfer open to the limit is
    // reported as the slow check it is rather than a fast one with a slow body.
    const responseTime = Date.now() - startTime;

    if (responseTime > timeout * 0.8) {
      return { status: 'degraded', statusCode, responseTime };
    }

    return { status: 'up', statusCode, responseTime };

  } catch (error) {
    const responseTime = Date.now() - startTime;

    // A refusal at connect time. This is the DNS-rebinding path: the name passed the
    // pre-flight check and resolved to a restricted address when the socket was
    // dialled. `blockedDetail` carries the operator-facing reason for the log; the
    // user gets the same generic message as any other restricted destination, so the
    // internal address never reaches them.
    if (blockedDetail !== null || error instanceof SsrfBlockedError) {
      logger.warn(`Monitor target refused at connect time: ${blockedDetail ?? 'blocked'}`);
      return {
        status: 'down',
        responseTime,
        error: 'Monitor target resolves to a restricted network destination.',
      };
    }

    if (error instanceof AxiosError) {
      if (error.code === 'ECONNABORTED' || error.code === 'ERR_CANCELED') {
        return { status: 'down', responseTime, error: `Request timed out after ${timeout}ms` };
      }
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        return { status: 'down', responseTime, error: `Connection failed: ${error.message}` };
      }
      if (error.code === 'CERT_HAS_EXPIRED') {
        return { status: 'down', responseTime, error: 'SSL certificate expired' };
      }
      return {
        status: 'down',
        statusCode: error.response?.status,
        responseTime,
        error: describeFailure(error),
      };
    }

    return { status: 'down', responseTime, error: describeFailure(error) };
  } finally {
    clearTimeout(deadline);
  }
}
