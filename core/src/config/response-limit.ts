/**
 * Hard ceiling on how much of a monitored response the worker will hold in memory.
 *
 * The worker only ever needs a response body for one thing: matching the monitor's
 * `expectedKeyword`. It never stores or returns the body, so a limit does not cost a
 * monitored capability — it costs a monitor whose body is enormous the ability to be
 * keyword-matched at all, which is a much smaller loss than the worker running out of
 * memory because a target streamed a large file.
 */

/**
 * 1 MiB by default.
 *
 * Sized from what the product actually does, not from what would be convenient. The
 * common checks are a status code and occasionally a small marker string in a JSON or
 * HTML body, which is kilobytes. 1 MiB leaves a wide margin over any realistic API
 * health endpoint and HTML landing page, so a legitimate monitor essentially never
 * notices the cap, while bounding a single check's memory to something the worker can
 * survive being asked to do a few hundred times.
 *
 * A deliberately small value would start breaking real monitors; a deliberately large
 * one would be picking the number to avoid the failures rather than to bound the
 * resource. This is the smallest value with real headroom.
 */
export const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

/**
 * Absolute ceiling on the configured value.
 *
 * Without this, the setting would be a way to switch the protection off: an operator
 * who sets `MAX_RESPONSE_BYTES=100000000000` has silently restored the unbounded
 * behaviour this limit exists to prevent, and the only record of it is an environment
 * variable nobody reads. A limit that can be configured without bound is not a limit.
 *
 * 64 MiB is far above what a keyword match needs and far below what a monitored host
 * can use to exhaust a container's memory. Anyone genuinely needing to watch a payload
 * this large wants a different tool, not an unbounded monitor check.
 */
export const MAX_RESPONSE_BYTES_CEILING = 64 * 1024 * 1024;

/**
 * The only thing a monitor's owner is told when their response was too large.
 *
 * Fixed text on purpose. It must not vary with the byte count, the target's name or
 * address, or the response contents, because a monitor's owner is an untrusted party
 * who supplied the target — a message built from response data would be an oracle and
 * a message built from the target would leak the address the SSRF policy went to such
 * lengths to hide. The diagnostic detail goes to the worker log.
 */
export const RESPONSE_TOO_LARGE_MESSAGE =
  'Response body exceeded the configured size limit.';

function resolveMaxResponseBytes(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_MAX_RESPONSE_BYTES;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    // Not fatal. A typo in one environment variable should not stop the worker from
    // checking monitors, and falling back to the default is the safe direction: the
    // fallback is bounded, whereas honouring a nonsense value would not be.
    return DEFAULT_MAX_RESPONSE_BYTES;
  }
  const requested = Math.floor(parsed);
  if (requested > MAX_RESPONSE_BYTES_CEILING) {
    return MAX_RESPONSE_BYTES_CEILING;
  }
  return requested;
}

/**
 * Bytes of response body this worker will consume for one check.
 *
 * Read once at module load. It is read from the environment rather than taken as a
 * parameter because it is an operator setting, not a per-monitor one: a per-monitor
 * limit would mean the operator's protection depends on a value supplied by the
 * untrusted party who created the monitor.
 */
export const maxResponseBytes: number = resolveMaxResponseBytes(process.env.MAX_RESPONSE_BYTES);

/** True when `value` is a usable, non-negative byte count, for header parsing. */
export function isFiniteByteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
