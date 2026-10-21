/**
 * Response-size enforcement.
 *
 * These are the tests that would notice a return to `await response.data` with no bound.
 * A test asserting "a large body produces the size error" cannot tell the difference
 * between a stream that was cut off at 1 MiB and one that was quietly read to its end
 * and measured afterwards — both can report the same error while one of them already
 * paid the memory. So the assertions here are deliberately about the *transfer*, not
 * just the outcome: the servers count what they managed to write and record whether
 * they ever got to finish. A buffered implementation lets them finish; a streaming one
 * cannot.
 *
 * The destination policy is mocked exactly as in `executor.test.ts` so loopback servers
 * can stand in for public hosts, and every server in this file is real.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { DEFAULT_MAX_RESPONSE_BYTES, RESPONSE_TOO_LARGE_MESSAGE } from '../config/response-limit';

jest.mock('../security/ssrf-policy', () => {
  const actual = jest.requireActual('../security/ssrf-policy');
  const nodeDns = jest.requireActual('node:dns');
  return {
    ...actual,
    validateMonitorTarget: jest.fn(),
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
import { executeCheck } from './executor';

const validateMock = validateMonitorTarget as unknown as jest.Mock;

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

interface TransferLog {
  /** Bytes the server managed to hand to the socket. */
  bytesWritten: number;
  /** True only if the server wrote the whole body it intended to send. */
  finishedSending: boolean;
  /** True if the client closed the connection before the body was complete. */
  clientClosedEarly: boolean;
  /** Resolves when the transfer has ended, so assertions are not racing the socket. */
  settled: Promise<void>;
}

interface Harness {
  url: string;
  close: () => Promise<void>;
}

async function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<Harness> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * Write `totalBytes` of filler, accounting for how much actually left this process.
 *
 * The `drain` dance is what makes the accounting meaningful. Without honouring
 * backpressure the loop would count bytes that were merely accepted into a buffer, and
 * a client that stopped reading would still look like it had received the whole body.
 */
function writeLargeBody(res: http.ServerResponse, log: TransferLog, totalBytes: number): void {
  const chunkSize = 64 * 1024;
  let written = 0;
  let settle: () => void = () => {};
  // Resolves once the transfer has actually ended, one way or the other. Asserting on
  // `clientClosedEarly` before this settles is a race: the client has stopped reading,
  // but the server has not necessarily observed the close yet.
  log.settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const finish = (): void => {
    if (!log.finishedSending) log.clientClosedEarly = true;
    settle();
  };
  const pump = (): void => {
    while (written < totalBytes && !log.clientClosedEarly) {
      const size = Math.min(chunkSize, totalBytes - written);
      written += size;
      log.bytesWritten = written;
      if (!res.write(Buffer.alloc(size, 0x61))) {
        res.once('drain', pump);
        return;
      }
    }
    if (written >= totalBytes && !log.clientClosedEarly) {
      log.finishedSending = true;
      res.end();
      return;
    }
    finish();
  };
  res.on('close', finish);
  res.on('error', finish);
  pump();
}

function freshLog(): TransferLog {
  return { bytesWritten: 0, finishedSending: false, clientClosedEarly: false, settled: Promise.resolve() };
}

/** A body of `bytes` filler, plus a marker at the very end for keyword placement. */
function filler(bytes: number, marker = ''): Buffer {
  const head = Buffer.alloc(Math.max(0, bytes - marker.length), 0x61);
  return Buffer.concat([head, Buffer.from(marker, 'utf8')]);
}

const LIMIT = DEFAULT_MAX_RESPONSE_BYTES;

beforeEach(() => {
  allowAll();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('a response within the limit is unaffected', () => {
  it('reports a small body as up and still finds the keyword', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('{"status":"ok","marker":"HEALTHY"}');
    });

    const result = await executeCheck(server.url, 'GET', {}, undefined, 10000, undefined, 'HEALTHY');

    expect(result).toEqual({ status: 'up', statusCode: 200, responseTime: expect.any(Number) });
    await server.close();
  });

  it('accepts a body of exactly the limit, including a keyword in the final byte', async () => {
    const body = filler(LIMIT, 'EDGE');
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(body);
    });

    const result = await executeCheck(server.url, 'GET', {}, undefined, 15000, undefined, 'EDGE');

    // The defined boundary: `limit` bytes are accepted, `limit + 1` is not. "Exactly at
    // the limit" being a pass is a decision, not an accident of chunking.
    expect(result.status).toBe('up');
    expect(result.error).toBeUndefined();
    await server.close();
  });

  it('still asserts on status without ever reading the body', async () => {
    const log = freshLog();
    const server = await startServer((_req, res) => {
      res.writeHead(200);
      writeLargeBody(res, log, 64 * 1024 * 1024);
    });

    // No expectedKeyword, so the body has no consumer and is abandoned unread. This
    // monitor is legitimately up: a large body is not a failure unless the monitor
    // asked to look inside it.
    const result = await executeCheck(server.url, 'GET', {}, undefined, 15000);

    expect(result.status).toBe('up');
    expect(log.finishedSending).toBe(false);
    await server.close();
  });
});

describe('a response over the limit fails safely', () => {
  it('rejects a body one byte over the limit', async () => {
    const body = filler(LIMIT + 1);
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(body);
    });

    const result = await executeCheck(server.url, 'GET', {}, undefined, 15000, undefined, 'anything');

    expect(result.status).toBe('down');
    expect(result.error).toBe(RESPONSE_TOO_LARGE_MESSAGE);
    await server.close();
  });

  it('rejects a large declared Content-Length without waiting for the body', async () => {
    const log = freshLog();
    const server = await startServer((_req, res) => {
      // Declares 10x the limit, then sends nothing and holds the socket open. If the
      // limit were only checked while reading, this would sit until the deadline and
      // report a timeout instead of the size error.
      res.writeHead(200, { 'Content-Length': String(LIMIT * 10), 'Content-Type': 'application/octet-stream' });
      res.write(Buffer.alloc(1024, 0x61));
    });

    const started = Date.now();
    const result = await executeCheck(server.url, 'GET', {}, undefined, 3000, undefined, 'anything');
    const elapsed = Date.now() - started;

    expect(result.error).toBe(RESPONSE_TOO_LARGE_MESSAGE);
    // Well under the 3000ms deadline: this was decided from the header.
    expect(elapsed).toBeLessThan(2500);
    // The server was still writing when we gave up.
    expect(log.finishedSending).toBe(false);
    await server.close();
  });

  it('protects a chunked response that declares no length', async () => {
    const log = freshLog();
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      writeLargeBody(res, log, 8 * 1024 * 1024);
    });

    const result = await executeCheck(server.url, 'GET', {}, undefined, 15000, undefined, 'anything');

    expect(result.error).toBe(RESPONSE_TOO_LARGE_MESSAGE);
    await log.settled;
    expect(log.finishedSending).toBe(false);
    await server.close();
  });

  it('protects a response framed with no Content-Length and no chunking', async () => {
    const log = freshLog();
    const server = await startServer((_req, res) => {
      // Close-delimited framing: the length is genuinely unknown to the client, which
      // is the case a Content-Length fast path cannot help with at all.
      res.useChunkedEncodingByDefault = false;
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      writeLargeBody(res, log, 8 * 1024 * 1024);
    });

    const result = await executeCheck(server.url, 'GET', {}, undefined, 15000, undefined, 'anything');

    expect(result.error).toBe(RESPONSE_TOO_LARGE_MESSAGE);
    await log.settled;
    expect(log.finishedSending).toBe(false);
    await server.close();
  });

  it('does not apply the limit to a response that cannot have a body', async () => {
    // A HEAD probe of a large file is a normal monitor, and its Content-Length is the
    // size the matching GET would return. Failing that on a size limit while it read
    // zero bytes would be the limit breaking a working check, which is the other half
    // of getting a size limit right.
    const server = await startServer((req, res) => {
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Length': String(LIMIT * 100), 'Content-Type': 'application/octet-stream' });
        res.end();
        return;
      }
      res.writeHead(204, { 'Content-Type': 'application/octet-stream' });
      res.end();
    });

    const head = await executeCheck(server.url, 'HEAD', {}, undefined, 10000);
    const notModified = await executeCheck(server.url, 'GET', {}, undefined, 10000, 204);

    expect(head).toEqual({ status: 'up', statusCode: 200, responseTime: expect.any(Number) });
    expect(head.error).toBeUndefined();
    expect(notModified.status).toBe('up');
    // Specifically not the size error, which is what the declared length would imply.
    expect(head.error).not.toBe(RESPONSE_TOO_LARGE_MESSAGE);
    await server.close();
  });

  it('reports a missing keyword, not a size error, for a body-less HEAD', async () => {
    // Same case, but through the path that consults the limit at all. A HEAD has no
    // body, so a keyword can never match — the honest report is "keyword not found".
    // Reporting the size limit here would tell the monitor's owner their response was
    // too large when the response was empty.
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Length': String(LIMIT * 100), 'Content-Type': 'application/octet-stream' });
      res.end();
    });

    const result = await executeCheck(server.url, 'HEAD', {}, undefined, 10000, undefined, 'NEVER-PRESENT');

    expect(result.status).toBe('down');
    expect(result.error).toBe('Expected keyword "NEVER-PRESENT" not found');
    expect(result.error).not.toBe(RESPONSE_TOO_LARGE_MESSAGE);
    await server.close();
  });
});

describe('compressed responses are bounded after inflation', () => {
  const encodings: Array<{ name: string; encode: (b: Buffer) => Buffer; header: string }> = [
    { name: 'gzip', encode: (b) => zlib.gzipSync(b), header: 'gzip' },
    { name: 'deflate', encode: (b) => zlib.deflateSync(b), header: 'deflate' },
    { name: 'brotli', encode: (b) => zlib.brotliCompressSync(b), header: 'br' },
  ];

  it.each(encodings)(
    'rejects a $name body that inflates past the limit while staying under it on the wire',
    async ({ encode, header }) => {
      const inflated = Buffer.alloc(LIMIT + 64 * 1024, 0x61);
      const compressed = encode(inflated);
      // The point of the case: on the wire this is far below the limit, so the
      // Content-Length fast path sees a perfectly reasonable response.
      expect(compressed.length).toBeLessThan(LIMIT);
      expect(compressed.length).toBeLessThan(inflated.length / 100);

      const server = await startServer((_req, res) => {
        res.writeHead(200, {
          'Content-Encoding': header,
          'Content-Length': String(compressed.length),
          'Content-Type': 'application/octet-stream',
        });
        res.end(compressed);
      });

      const result = await executeCheck(server.url, 'GET', {}, undefined, 15000, undefined, 'anything');

      expect(result.status).toBe('down');
      expect(result.error).toBe(RESPONSE_TOO_LARGE_MESSAGE);
      await server.close();
    }
  );

  it('still matches a keyword in a small compressed body', async () => {
    // Proves the limit did not cost the feature: normal compression still works.
    const compressed = zlib.gzipSync(Buffer.from('{"state":"HEALTHY"}', 'utf8'));
    const server = await startServer((_req, res) => {
      res.writeHead(200, {
        'Content-Encoding': 'gzip',
        'Content-Length': String(compressed.length),
        'Content-Type': 'application/json',
      });
      res.end(compressed);
    });

    const result = await executeCheck(server.url, 'GET', {}, undefined, 10000, undefined, 'HEALTHY');

    expect(result.status).toBe('up');
    await server.close();
  });

  it('closes the socket on a compressed response that overruns the limit', async () => {
    // The compressed case is where tearing down the stream alone is not enough. The
    // stream axios hands back is a zlib pipeline, not the socket, so destroying it
    // leaves the connection under the server still filling. The request has to be
    // destroyed too or every compressed monitor that trips the limit leaks a socket.
    const log = freshLog();
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Type': 'application/octet-stream' });
      let settle: () => void = () => {};
      log.settled = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const finish = (): void => {
        if (!log.finishedSending) log.clientClosedEarly = true;
        settle();
      };
      res.on('close', finish);
      res.on('error', finish);
      // Compressible filler would defeat the point: 256 KiB of a single repeated byte
      // gzips to a few hundred bytes, so the server could finish sending the whole
      // thing in one flush and there would be no transfer left to cut off. Random
      // bytes keep the body genuinely large on the wire while still inflating through
      // a zlib pipeline, which is the case that matters.
      const block = zlib.gzipSync(crypto.randomBytes(256 * 1024));
      let sent = 0;
      const pump = (): void => {
        while (sent < 64 && !log.clientClosedEarly) {
          sent += 1;
          log.bytesWritten += block.length;
          if (!res.write(block)) {
            res.once('drain', pump);
            return;
          }
        }
        if (sent >= 64 && !log.clientClosedEarly) {
          log.finishedSending = true;
          res.end();
          return;
        }
        finish();
      };
      pump();
    });

    const result = await executeCheck(server.url, 'GET', {}, undefined, 15000, undefined, 'anything');

    expect(result.error).toBe(RESPONSE_TOO_LARGE_MESSAGE);
    await log.settled;
    // The server did not get to push all 64 blocks, and it saw the hang-up.
    expect(log.finishedSending).toBe(false);
    expect(log.clientClosedEarly).toBe(true);
    await server.close();
  });
});

describe('redirects do not open an unbounded buffering hole', () => {
  it('discards a redirect body instead of reading it', async () => {
    const log = freshLog();
    const server = await startServer((req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { Location: '/final' });
        writeLargeBody(res, log, 32 * 1024 * 1024);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('done');
    });

    const result = await executeCheck(`${server.url}/start`, 'GET', {}, undefined, 15000);

    expect(result.status).toBe('up');
    // The 302 body was never consumed, so the server could not finish sending 32 MiB.
    await log.settled;
    expect(log.finishedSending).toBe(false);
    expect(log.bytesWritten).toBeLessThan(32 * 1024 * 1024);
    await server.close();
  });

  it('bounds every hop of a redirect chain', async () => {
    const logs: TransferLog[] = [];
    const server = await startServer((req, res) => {
      const hop = Number((req.url ?? '/0').slice(1));
      if (hop < 3) {
        res.writeHead(302, { Location: `/${hop + 1}` });
        const log = freshLog();
        logs.push(log);
        writeLargeBody(res, log, 32 * 1024 * 1024);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('done');
    });

    const result = await executeCheck(`${server.url}/0`, 'GET', {}, undefined, 20000);

    expect(result.status).toBe('up');
    expect(logs).toHaveLength(3);
    for (const log of logs) {
      expect(log.finishedSending).toBe(false);
    }
    await server.close();
  });

  it('fails the final hop on size even after a redirect', async () => {
    const server = await startServer((req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { Location: '/big' });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(filler(LIMIT + 1));
    });

    const result = await executeCheck(`${server.url}/start`, 'GET', {}, undefined, 15000, undefined, 'x');

    expect(result.error).toBe(RESPONSE_TOO_LARGE_MESSAGE);
    await server.close();
  });
});

describe('the limit and the deadline both terminate the request', () => {
  it('times out on a response that never finishes arriving', async () => {
    const log = freshLog();
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      // Headers, then a trickle that never reaches the size limit and never ends.
      const timer = setInterval(() => {
        if (res.writableEnded || res.destroyed) {
          clearInterval(timer);
          return;
        }
        res.write(Buffer.alloc(1024, 0x61));
      }, 100);
      res.on('close', () => clearInterval(timer));
      log.bytesWritten = 0;
    });

    const started = Date.now();
    const result = await executeCheck(server.url, 'GET', {}, undefined, 1200, undefined, 'anything');
    const elapsed = Date.now() - started;

    expect(result.status).toBe('down');
    expect(result.error).toBe('Request timed out after 1200ms');
    // Bounded by the deadline rather than by the body: the body was unbounded.
    expect(elapsed).toBeLessThan(3000);
    await server.close();
  });

  it('does not hang when the size limit and the deadline race', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      const timer = setInterval(() => {
        if (res.writableEnded || res.destroyed) {
          clearInterval(timer);
          return;
        }
        res.write(Buffer.alloc(256 * 1024, 0x61));
      }, 50);
      res.on('close', () => clearInterval(timer));
    });

    const started = Date.now();
    const result = await executeCheck(server.url, 'GET', {}, undefined, 2000, undefined, 'anything');
    const elapsed = Date.now() - started;

    // Either verdict is correct; what matters is that the request ended on one of them
    // and did not sit there.
    expect([RESPONSE_TOO_LARGE_MESSAGE, 'Request timed out after 2000ms']).toContain(result.error);
    expect(elapsed).toBeLessThan(4000);
    await server.close();
  });
});

describe('the reported error is safe and stable', () => {
  it('returns the same fixed message regardless of how far over the limit the body was', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(filler(LIMIT * 3, 'UNIQUE-MARKER-THAT-MUST-NOT-LEAK'));
    });

    const first = await executeCheck(server.url, 'GET', {}, undefined, 15000, undefined, 'x');
    const second = await executeCheck(server.url, 'GET', {}, undefined, 15000, undefined, 'x');

    expect(first.error).toBe(RESPONSE_TOO_LARGE_MESSAGE);
    expect(second.error).toBe(first.error);
    await server.close();
  });

  it('leaks neither the target address nor the response contents nor a stack', async () => {
    const log = freshLog();
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      writeLargeBody(res, log, 8 * 1024 * 1024);
    });

    const result = await executeCheck(server.url, 'GET', {}, undefined, 15000, undefined, 'SECRET-TOKEN-abc123');
    const serialised = JSON.stringify(result);
    const { port } = new URL(server.url);

    expect(result.error).toBe(RESPONSE_TOO_LARGE_MESSAGE);
    expect(serialised).not.toContain('127.0.0.1');
    expect(serialised).not.toContain(port);
    expect(serialised).not.toContain('SECRET-TOKEN-abc123');
    // No stack frames, and no internals naming the mechanism.
    expect(serialised).not.toMatch(/\bat \w+ \(/);
    expect(serialised).not.toMatch(/zlib|decompress|Buffer|stream/i);
    await server.close();
  });

  it('retains nothing from the rejected body', async () => {
    const marker = 'RETAINED-IF-BUFFERED-a7c31f9e';
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(filler(LIMIT + 1, marker));
    });

    const result = await executeCheck(server.url, 'GET', {}, undefined, 15000, undefined, marker);

    // The marker is inside the body, so a result carrying the body would carry it.
    expect(result.error).toBe(RESPONSE_TOO_LARGE_MESSAGE);
    expect(JSON.stringify(result)).not.toContain(marker);
    // And no field anywhere in the contract is a body.
    expect(Object.keys(result).sort()).toEqual(['error', 'responseTime', 'status', 'statusCode']);
    await server.close();
  });
});

describe('the transfer itself is cut off, not merely measured', () => {
  it('cannot be made to finish sending a body far larger than the limit', async () => {
    const log = freshLog();
    const bodySize = 64 * 1024 * 1024;
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      writeLargeBody(res, log, bodySize);
    });

    const rssBefore = process.memoryUsage().rss;
    const result = await executeCheck(server.url, 'GET', {}, undefined, 20000, undefined, 'anything');
    const rssAfter = process.memoryUsage().rss;

    expect(result.error).toBe(RESPONSE_TOO_LARGE_MESSAGE);

    // The regression this whole file exists for. With `await response.data` and no
    // bound, this server would have written all 64 MiB and set `finishedSending`.
    expect(log.finishedSending).toBe(false);
    // What the worker actually pulled is tied to the limit, not to the body. The slack
    // covers the kernel and socket buffers the bytes pass through before the abort
    // lands; it is far below the body, which is the comparison that matters.
    expect(log.bytesWritten).toBeLessThan(LIMIT + 8 * 1024 * 1024);
    // The server saw the worker hang up on it rather than drain the body.
    await log.settled;
    expect(log.clientClosedEarly).toBe(true);

    // Coarse guard on top of the accounting: a buffered read of 64 MiB would show up
    // here, streaming should not. Deliberately loose so it is not a flaky assertion —
    // the byte counts above are the real evidence.
    expect(rssAfter - rssBefore).toBeLessThan(32 * 1024 * 1024);

    await server.close();
  });
});
