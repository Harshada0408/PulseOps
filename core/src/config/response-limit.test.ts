/**
 * Resolution of the response-size limit.
 *
 * The interesting cases here are the ones where an operator's input is wrong. A
 * configurable limit is only a protection while a bad value degrades to something safe,
 * so those paths are tested as deliberately as the happy one.
 */
import { DEFAULT_MAX_RESPONSE_BYTES, MAX_RESPONSE_BYTES_CEILING } from './response-limit';

/**
 * Re-import the module with a given environment.
 *
 * The limit is read once at load time, which is what keeps it an operator setting rather
 * than a per-monitor one. Testing the resolution means reloading, so this reaches for
 * `jest.resetModules` instead of exporting the resolver.
 */
function resolveWith(raw: string | undefined): number {
  let resolved: typeof import('./response-limit').maxResponseBytes | undefined;
  jest.isolateModules(() => {
    if (raw === undefined) {
      delete process.env.MAX_RESPONSE_BYTES;
    } else {
      process.env.MAX_RESPONSE_BYTES = raw;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    resolved = require('./response-limit').maxResponseBytes as number;
  });
  return resolved as unknown as number;
}

const original = process.env.MAX_RESPONSE_BYTES;

afterAll(() => {
  if (original === undefined) {
    delete process.env.MAX_RESPONSE_BYTES;
  } else {
    process.env.MAX_RESPONSE_BYTES = original;
  }
});

describe('the response-size limit resolves to something bounded', () => {
  it('defaults when nothing is configured', () => {
    expect(resolveWith(undefined)).toBe(DEFAULT_MAX_RESPONSE_BYTES);
  });

  it('defaults on an empty or whitespace value', () => {
    expect(resolveWith('')).toBe(DEFAULT_MAX_RESPONSE_BYTES);
    expect(resolveWith('   ')).toBe(DEFAULT_MAX_RESPONSE_BYTES);
  });

  it('honours a smaller configured value', () => {
    expect(resolveWith('4096')).toBe(4096);
  });

  it('clamps a value above the ceiling rather than honouring it', () => {
    // Without this, `MAX_RESPONSE_BYTES` would be a documented way to switch the
    // protection off, and the only trace would be an environment variable.
    expect(resolveWith('100000000000')).toBe(MAX_RESPONSE_BYTES_CEILING);
    expect(resolveWith(String(MAX_RESPONSE_BYTES_CEILING))).toBe(MAX_RESPONSE_BYTES_CEILING);
  });

  it('ignores values that are not a usable size', () => {
    for (const bad of ['abc', '0', '-1', '1e999', 'NaN', '12abc', ' ']) {
      expect(resolveWith(bad)).toBe(DEFAULT_MAX_RESPONSE_BYTES);
    }
  });

  it('truncates a fractional value to whole bytes', () => {
    expect(resolveWith('4096.9')).toBe(4096);
  });

  it('defaults to 1 MiB and caps at 64 MiB', () => {
    // Pinned so a change to either constant is a deliberate act with a test to update,
    // rather than something that shifts silently.
    expect(DEFAULT_MAX_RESPONSE_BYTES).toBe(1024 * 1024);
    expect(MAX_RESPONSE_BYTES_CEILING).toBe(64 * 1024 * 1024);
  });
});
