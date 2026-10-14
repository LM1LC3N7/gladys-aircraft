// -----------------------------------------------------------------------------
// The two community aggregators, adsb.lol and adsb.fi: the aircraft within a
// distance of a point, as readsb JSON (readsb.js parses it).
//
// Their rules (READMEs read on 2026-10-14):
//   adsb.lol  no key today ("in the future, you will require an API key which
//             you can obtain by feeding"), "rate limits are dynamic", "if you
//             get 4xx errors, you are doing something wrong"; data ODbL 1.0.
//   adsb.fi   "personal, non-commercial use only", public endpoints "rate
//             limited to 1 request per second", the 4xx and 429 answers
//             "count toward the limit"; cite adsb.fi with a link.
// Hence: every request at least AGGREGATOR_SPACING after the previous one of
// this client (readings, scene action and test button alike); a 4xx other
// than 429 stops the source until the configuration is saved; a 429 pauses
// it for Retry-After (5 minutes without it). The query point is the house
// rounded to 0.01 degree: the exact position never leaves Gladys.
// -----------------------------------------------------------------------------

import { AGGREGATOR_SPACING, AGGREGATOR_URLS } from '../constants.js';
import { queryPoint } from '../geo.js';
import { HttpError, request } from '../http.js';
import { SourceError, retryAfterMs, transportError } from './common.js';
import { snapshotOf } from './readsb.js';

export const AGGREGATOR_NAMES = { adsblol: 'adsb.lol', adsbfi: 'adsb.fi' };

/** The URL of one "around a point" request. */
export function aggregatorUrl(source, { latitude, longitude, nm }) {
  return AGGREGATOR_URLS[source]
    .replace('{lat}', latitude.toFixed(2))
    .replace('{lon}', longitude.toFixed(2))
    .replace('{nm}', String(nm));
}

export class AggregatorClient {
  constructor({
    source,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    spacing = AGGREGATOR_SPACING,
  }) {
    this.source = source;
    this.name = AGGREGATOR_NAMES[source];
    this.now = now;
    this.sleep = sleep;
    this.spacing = spacing;
    /** One read per house: the app asks for each house in turn. */
    this.shared = false;
    /** When the last request left (0: none yet), and the requests sent (tests, status). */
    this.lastAt = 0;
    this.requests = 0;
    this.turn = Promise.resolve();
  }

  /**
   * Waits for the turn of a request: the callers queue, each one leaves at
   * least `spacing` after the previous one, whatever its answer was.
   */
  slot() {
    const turn = this.turn.then(async () => {
      const wait = this.lastAt + this.spacing - this.now();
      if (wait > 0) {
        await this.sleep(wait);
      }
      this.lastAt = this.now();
    });
    this.turn = turn.catch(() => {});
    return turn;
  }

  /** The aircraft within `radiusKm` of a house { latitude, longitude }: a readsb snapshot. */
  async read(house, { radiusKm }) {
    const url = aggregatorUrl(this.source, queryPoint(house, radiusKm));
    await this.slot();
    this.requests += 1;
    let answer;
    try {
      // The path holds the (rounded) house position: errors name the host only.
      answer = await request(url, { label: new URL(url).host });
    } catch (err) {
      if (!(err instanceof HttpError)) {
        throw transportError(err, this.name);
      }
      if (err.status === 429) {
        throw new SourceError('rate_limited', `${this.name} asks to slow down (HTTP 429)`, {
          status: 429,
          retryAfterMs: retryAfterMs(err.headers, this.now()),
        });
      }
      if (err.status >= 400 && err.status < 500) {
        throw new SourceError('refused', `${this.name} refused the request (HTTP ${err.status})`, {
          status: err.status,
        });
      }
      throw new SourceError('http', err.message, { status: err.status });
    }
    return snapshotOf(answer.data, this.name);
  }
}
