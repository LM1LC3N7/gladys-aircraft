// -----------------------------------------------------------------------------
// The OpenSky Network REST API: /states/all on a bounding box, and its state
// vectors -> plain aircraft states (every OpenSky column lives in `stateOf`).
//
// Kept ONLY for the users who hold OpenSky's written agreement: its terms
// (read on 2026-10-14) reserve the REST API for non-profit research and
// education and ask for a written license for any "operational" use "in a
// live product, service, or automated system". The docs and the config say so.
//
// Anonymous by default. With an account's API client (id + secret), the
// OAuth2 client credentials flow: the access token (30 minutes) is kept in
// memory, renewed a minute before it expires, and once more on a 401. The
// secret and the token never appear in a URL, a log line or an error.
//
// Every answer carries the credits left (X-Rate-Limit-Remaining); a 429 the
// wait before the next request (X-Rate-Limit-Retry-After-Seconds). The client
// keeps both for the app's pacing (src/pacing.js).
// -----------------------------------------------------------------------------

import { OPENSKY_API_URL, TOKEN_MARGIN, TOKEN_URL } from '../constants.js';
import { boundingBox, creditCost } from '../geo.js';
import { HttpError, request } from '../http.js';
import { SourceError, numberHeader, transportError } from './common.js';

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const str = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/**
 * One state vector (an array of 17 columns, 18 with `extended=1`) -> the plain
 * state every source produces. `time` is the answer's time (s), for the age
 * of the position. The columns are documented at
 * https://openskynetwork.github.io/opensky-api/rest.html#all-state-vectors.
 */
export function stateOf(row, time = null) {
  if (!Array.isArray(row) || typeof row[0] !== 'string') {
    return undefined;
  }
  const timePosition = num(row[3]);
  return {
    icao24: row[0].trim().toLowerCase(),
    callsign: str(row[1]), // 8 characters padded with spaces, or null
    country: str(row[2]),
    registration: null, // not in the state vectors
    aircraftType: null,
    latitude: num(row[6]),
    longitude: num(row[5]),
    positionAge: time === null || timePosition === null ? null : time - timePosition,
    baroAltitude: num(row[7]), // metres; can be negative near the ground
    onGround: row[8] === true,
    velocity: num(row[9]), // m/s over ground
    track: num(row[10]), // degrees clockwise from north
    verticalRate: num(row[11]), // m/s, positive when climbing
    geoAltitude: num(row[13]), // metres
    squawk: str(row[14]),
  };
}

/** { time (s), states, received } from an answer; `states: null` (an empty sky) is []. */
export function snapshotOf(answer) {
  const time = num(answer?.time);
  const rows = Array.isArray(answer?.states) ? answer.states : [];
  const states = rows.map((row) => stateOf(row, time)).filter(Boolean);
  return { time, states, received: states.length };
}

export class OpenSkyClient {
  constructor({
    clientId = '',
    clientSecret = '',
    now = Date.now,
    baseUrl = OPENSKY_API_URL,
  } = {}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.now = now;
    this.baseUrl = baseUrl;
    this.name = 'OpenSky';
    /** One request (one credit) per house. */
    this.shared = false;
    this.token = undefined;
    this.tokenExpiresAt = 0;
    /** Credits left according to the last answer (X-Rate-Limit-Remaining), or undefined. */
    this.remaining = undefined;
    /** Requests sent to /states/all (tests and the status use it). */
    this.requests = 0;
  }

  get account() {
    return Boolean(this.clientId && this.clientSecret);
  }

  get tier() {
    return this.account ? 'account' : 'anonymous';
  }

  /** The credits one reading of a house costs (the published table, by box area). */
  cost(house, { radiusKm }) {
    return creditCost(boundingBox(house, radiusKm));
  }

  /** A valid access token, from memory or from the token endpoint. */
  async accessToken({ force = false } = {}) {
    if (!force && this.token && this.now() < this.tokenExpiresAt) {
      return this.token;
    }
    this.token = undefined;
    let answer;
    try {
      answer = await request(TOKEN_URL, {
        method: 'POST',
        form: {
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
        },
      });
    } catch (err) {
      if (err instanceof HttpError) {
        // Keycloak answers 400/401 { error: "invalid_client" | "unauthorized_client" }.
        const code = typeof err.body === 'object' ? err.body?.error : undefined;
        if (err.status === 401 || /client|grant/.test(code ?? '')) {
          throw new SourceError(
            'unauthorized',
            'OpenSky refused the API client (check the client id and secret)',
            { status: err.status },
          );
        }
        throw new SourceError('http', `${err.message} (token)`, { status: err.status });
      }
      throw transportError(err, 'OpenSky');
    }
    const token = answer.data?.access_token;
    if (typeof token !== 'string' || !token) {
      throw new SourceError('invalid', 'OpenSky sent no access token');
    }
    const expiresIn = Number(answer.data?.expires_in) || 1800;
    this.token = token;
    this.tokenExpiresAt = this.now() + Math.max(60_000, expiresIn * 1000 - TOKEN_MARGIN);
    return token;
  }

  track(headers) {
    const remaining = numberHeader(headers, 'x-rate-limit-remaining');
    if (remaining !== undefined) {
      this.remaining = remaining;
    }
  }

  async get(url, { retried = false } = {}) {
    const headers = {};
    if (this.account) {
      headers.Authorization = `Bearer ${await this.accessToken({ force: retried })}`;
    }
    this.requests += 1;
    try {
      const answer = await request(url, { headers });
      this.track(answer.headers);
      return answer.data;
    } catch (err) {
      if (!(err instanceof HttpError)) {
        throw transportError(err, 'OpenSky');
      }
      this.track(err.headers);
      if (err.status === 401 && this.account && !retried) {
        // The token expired early (or the server restarted): one new token, one retry.
        return this.get(url, { retried: true });
      }
      if (err.status === 401 && this.account) {
        throw new SourceError('unauthorized', 'OpenSky refused the access token', {
          status: 401,
        });
      }
      if (err.status === 429) {
        const seconds = numberHeader(err.headers, 'x-rate-limit-retry-after-seconds');
        this.remaining = 0;
        throw new SourceError('rate_limited', 'OpenSky credits used up', {
          status: 429,
          retryAfterMs: seconds === undefined ? undefined : seconds * 1000,
        });
      }
      throw new SourceError('http', err.message, { status: err.status });
    }
  }

  /** The state vectors inside a box { lamin, lomin, lamax, lomax } (current time), raw. */
  states(box) {
    const search = new URLSearchParams({
      lamin: box.lamin.toFixed(2),
      lomin: box.lomin.toFixed(2),
      lamax: box.lamax.toFixed(2),
      lomax: box.lomax.toFixed(2),
    });
    return this.get(`${this.baseUrl}/states/all?${search}`);
  }

  /**
   * The aircraft around a house: the box of the radius, rounded outward to
   * 0.01 degree (the exact position never leaves Gladys), as a snapshot.
   */
  async read(house, { radiusKm }) {
    return snapshotOf(await this.states(boundingBox(house, radiusKm)));
  }
}
