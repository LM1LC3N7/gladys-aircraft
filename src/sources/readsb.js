// -----------------------------------------------------------------------------
// The readsb JSON -> plain aircraft states. Pure.
//
// adsb.lol, adsb.fi and the receivers of the users (readsb, dump1090-fa,
// tar1090, dump1090-mutability) all speak readsb's aircraft JSON: every
// readsb field name and unit lives here, so a change is fixed in one place.
//
//   adsb.lol v2 / adsb.fi v3   { "ac": [...], "now": 1791992593000 (ms), "total", "msg", ... }
//   a receiver's aircraft.json { "now": 1791992594.0 (s), "messages", "aircraft": [...] }
//
// One aircraft (readsb's README-json.md; the answers of 2026-10-14):
//   hex       transponder address (hex, "~" first for a non-ICAO address)
//   flight    callsign, padded with spaces to 8 characters
//   r, t      registration and ICAO type (from the aggregator's database;
//             a receiver only when it has one)
//   alt_baro  feet, or the string "ground"; alt_geom feet (GNSS)
//   gs        knots over ground; track degrees; baro_rate / geom_rate ft/min
//   squawk    "7700"...; emergency "none" | "general" | "nordo" | "unlawful" |
//             "lifeguard" | "minfuel" | "downed" | "reserved"
//   lat, lon  degrees; seen_pos seconds since the position was received
// -----------------------------------------------------------------------------

import { FEET, FEET_PER_MINUTE, KNOT } from '../constants.js';
import { SourceError } from './common.js';

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const str = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const times = (value, factor) => (num(value) === null ? null : value * factor);

/**
 * The ADS-B emergency status that goes with a squawk code: an aircraft that
 * sets it without sending the code still counts (the code is what the
 * trigger and the variables speak).
 */
const EMERGENCY_STATUS = { general: '7700', nordo: '7600', unlawful: '7500' };

/** One readsb aircraft -> the plain state every source produces, or undefined. */
export function stateOf(ac) {
  if (!ac || typeof ac !== 'object' || !str(ac.hex)) {
    return undefined;
  }
  const onGround = ac.alt_baro === 'ground';
  return {
    icao24: str(ac.hex).toLowerCase(),
    callsign: str(ac.flight),
    country: null, // readsb has no country of registration
    registration: str(ac.r),
    aircraftType: str(ac.t),
    latitude: num(ac.lat),
    longitude: num(ac.lon),
    positionAge: num(ac.seen_pos),
    baroAltitude: onGround ? null : times(ac.alt_baro, FEET),
    geoAltitude: onGround ? null : times(ac.alt_geom, FEET),
    onGround,
    velocity: times(ac.gs, KNOT), // m/s
    track: num(ac.track),
    verticalRate: times(ac.baro_rate ?? ac.geom_rate, FEET_PER_MINUTE), // m/s
    squawk: str(ac.squawk) ?? EMERGENCY_STATUS[ac.emergency] ?? null,
  };
}

/**
 * A readsb answer -> { time (s), states, received }. `ac` (the aggregators)
 * or `aircraft` (a receiver); `now` in milliseconds or seconds. An answer
 * without either list is not a readsb answer: a SourceError `invalid`.
 */
export function snapshotOf(answer, name) {
  const list = Array.isArray(answer?.ac)
    ? answer.ac
    : Array.isArray(answer?.aircraft)
      ? answer.aircraft
      : answer && typeof answer === 'object' && answer.ac === null && num(answer.now) !== null
        ? [] // an empty sky, as some aggregators may write it
        : undefined;
  if (!list) {
    throw new SourceError('invalid', `${name} sent no aircraft list (not a readsb answer)`);
  }
  const now = num(answer.now);
  const states = list.map(stateOf).filter(Boolean);
  return {
    // Milliseconds since 1970 are above 1e11, seconds far below.
    time: now === null ? null : now > 1e11 ? now / 1000 : now,
    states,
    received: states.length,
  };
}
