// -----------------------------------------------------------------------------
// What every source shares: the error the app understands, and the reading of
// the HTTP headers that pace the requests. Pure.
// -----------------------------------------------------------------------------

export class SourceError extends Error {
  /**
   * `code`:
   *   unauthorized  OpenSky refused the API client: final until the
   *                 configuration is saved (or the test button pressed);
   *   refused       adsb.lol / adsb.fi answered a 4xx other than 429 ("if you
   *                 get 4xx errors, you are doing something wrong"): final
   *                 until the configuration is saved;
   *   rate_limited  a 429: nothing until `retryAfterMs` (or the source's pause);
   *   invalid       the answer is not what the source should send;
   *   stale         the receiver keeps serving the same aircraft.json;
   *   http | timeout | network   a failure worth retrying at the next reading.
   */
  constructor(code, message, { status, retryAfterMs, minutes } = {}) {
    super(message);
    this.name = 'SourceError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    /** `stale`: for how long the receiver has served the same answer. */
    this.minutes = minutes;
  }

  /** Nothing more is sent until the user acts. */
  get final() {
    return this.code === 'unauthorized' || this.code === 'refused';
  }
}

/** A fetch that threw (no answer at all) as a SourceError; `name` says who did not answer. */
export function transportError(err, name) {
  if (err instanceof SourceError) {
    return err;
  }
  const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
  const cause = err?.cause?.code ?? err?.cause?.message;
  return new SourceError(
    timeout ? 'timeout' : 'network',
    timeout
      ? `${name} did not answer in time`
      : `network error (${err?.message ?? err}${cause ? `: ${cause}` : ''})`,
  );
}

/** A numeric header, or undefined. */
export function numberHeader(headers, name) {
  const value = headers?.get?.(name);
  const n = value === null || value === undefined || value === '' ? NaN : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The wait a 429 announces in `Retry-After` (seconds, or an HTTP date), in
 * milliseconds; undefined when absent or unreadable.
 */
export function retryAfterMs(headers, now) {
  const value = headers?.get?.('retry-after');
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}
