// -----------------------------------------------------------------------------
// Fake `fetch` for the tests: routes requests to handlers, records every
// call, and fails loudly on an unexpected URL. No test touches the network.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { setFetch } from '../../src/http.js';

setFetch(async (url) => {
  throw new Error(`Network call without a fake fetch in a test: ${url}`);
});

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}

/** A JSON answer; `remaining` becomes X-Rate-Limit-Remaining, like OpenSky's. */
export const json = (body, { status = 200, remaining, headers = {} } = {}) =>
  new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(remaining === undefined ? {} : { 'x-rate-limit-remaining': String(remaining) }),
      ...headers,
    },
  });

/**
 * Install a fake fetch; `routes` is a list of [RegExp, handler({ url, params,
 * init, at })]. `clock` (optional, { now }) dates each call in `at`.
 */
export function installFetch(routes, { clock } = {}) {
  const calls = [];
  const previous = setFetch(async (url, init = {}) => {
    const call = {
      url,
      params: Object.fromEntries(new URL(url).searchParams),
      init,
      at: clock?.now,
    };
    calls.push(call);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) {
      throw new Error(`Unexpected network call in a test: ${url}`);
    }
    return route[1](call);
  });
  return { calls, restore: () => setFetch(previous) };
}

/** The house of the fixtures, under the approach of a busy airport. */
export const HOME = { id: 1, name: 'Home', selector: 'home', latitude: 50.06, longitude: 8.7 };

/**
 * The time of the samples (OpenSky `time`, readsb `now`), and the reception
 * a moment later. The three samples hold the same synthetic sky: the readsb
 * ones were derived from states-sample.json (feet, knots, ft/min), shaped
 * after the answers of adsb.lol, adsb.fi and a receiver.
 */
export const FIXTURE_TIME = 1791989237;
export const FIXTURE_NOW = FIXTURE_TIME * 1000 + 1500;

const KM_PER_DEGREE = (Math.PI * 6371) / 180;
const KNOT = 1852 / 3600;

/** A point `km` ahead along `track` degrees. */
function ahead(lat, lon, km, track) {
  const rad = (track * Math.PI) / 180;
  return [
    lat + (km * Math.cos(rad)) / KM_PER_DEGREE,
    lon + (km * Math.sin(rad)) / (KM_PER_DEGREE * Math.cos((lat * Math.PI) / 180)),
  ];
}

/**
 * states-sample.json, `seconds` later: every airborne aircraft flown straight
 * ahead along its track and speed, the times moved on. `edit(row)` changes a
 * row afterwards (row[0] is the icao24).
 */
export function sample({ seconds = 0, edit = () => {} } = {}) {
  const answer = fixture('states-sample.json');
  answer.time += seconds;
  for (const row of answer.states) {
    row[3] = row[3] === null ? null : row[3] + seconds;
    row[4] += seconds;
    const [lon, lat, , ground, speed, track] = row.slice(5, 11);
    if (lat !== null && !ground && speed && track !== null) {
      [row[6], row[5]] = ahead(lat, lon, (speed * seconds) / 1000, track);
    }
    edit(row);
  }
  return answer;
}

/**
 * The readsb sample `seconds` later, as adsb.lol / adsb.fi answer it
 * ({ ac, now in ms }), or with `receiver` as a receiver's aircraft.json
 * ({ aircraft, now in s }). Every airborne aircraft flown straight ahead;
 * `edit(ac)` changes an aircraft afterwards (ac.hex is the address).
 */
export function readsbSample({ seconds = 0, edit = () => {}, receiver = false } = {}) {
  const answer = fixture(receiver ? 'receiver-sample.json' : 'readsb-sample.json');
  answer.now += receiver ? seconds : seconds * 1000;
  if (!receiver) {
    answer.ctime = answer.now;
  }
  for (const ac of answer.ac ?? answer.aircraft) {
    if (ac.lat !== undefined && ac.alt_baro !== 'ground' && ac.gs && ac.track !== undefined) {
      [ac.lat, ac.lon] = ahead(ac.lat, ac.lon, (ac.gs * KNOT * seconds) / 1000, ac.track);
    }
    edit(ac);
  }
  return answer;
}
