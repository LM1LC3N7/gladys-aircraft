// -----------------------------------------------------------------------------
// A source's snapshot -> the aircraft around a house, closest first. Pure.
//
// The sources (src/sources/) turn their answers into plain states, the same
// for all of them (every source-specific field name lives there):
//   { icao24, callsign, country, registration, aircraftType, latitude,
//     longitude, positionAge (s), baroAltitude (m), geoAltitude (m), onGround,
//     velocity (m/s), track (degrees), verticalRate (m/s), squawk }
// and a snapshot is { time (s, the source's clock), states, received }.
// -----------------------------------------------------------------------------

import { EMERGENCY_SQUAWKS, LOOKAHEAD_SECONDS, MAX_POSITION_AGE } from './constants.js';
import { bearingDeg, closestApproach, compassPoint, distanceKm, headingArrow } from './geo.js';

const round = (value, digits = 0) =>
  value === null || value === undefined ? null : Math.round(value * 10 ** digits) / 10 ** digits;

/** The altitude to show: the chosen source, else the other one. */
export function altitudeOf(state, source = 'geometric') {
  const [first, second] =
    source === 'barometric'
      ? [state.baroAltitude, state.geoAltitude]
      : [state.geoAltitude, state.baroAltitude];
  return round(first ?? second);
}

/**
 * One aircraft as seen from a house, or undefined when it does not count:
 * no position, a position older than MAX_POSITION_AGE (OpenSky keeps a vector
 * up to 5 minutes after the last message, readsb an aircraft on the ground
 * long after its last position), on the ground when ignored, or outside the
 * radius.
 */
export function aircraftOf(state, house, { radiusKm, ignoreGround, altitudeSource }) {
  if (!Number.isFinite(state.latitude) || !Number.isFinite(state.longitude)) {
    return undefined;
  }
  if (Number.isFinite(state.positionAge) && state.positionAge > MAX_POSITION_AGE) {
    return undefined;
  }
  if (state.onGround && ignoreGround) {
    return undefined;
  }
  const point = { latitude: state.latitude, longitude: state.longitude };
  const distance = distanceKm(house, point);
  if (distance > radiusKm) {
    return undefined;
  }
  const altitude = state.onGround ? null : altitudeOf(state, altitudeSource);
  // Where it will be closest within the next minute, flying straight ahead.
  const approach = state.onGround
    ? { distanceKm: distance, seconds: 0 }
    : closestApproach(house, point, {
        speed: state.velocity,
        track: state.track,
        seconds: LOOKAHEAD_SECONDS,
      });
  const climb = state.verticalRate ?? 0;
  const approachAltitude =
    altitude === null ? null : Math.max(0, Math.round(altitude + climb * approach.seconds));
  return {
    icao24: state.icao24,
    callsign: state.callsign,
    /** The callsign, or the transponder address when no callsign was received. */
    name: state.callsign ?? state.icao24.toUpperCase(),
    country: state.country ?? null,
    registration: state.registration ?? null,
    aircraftType: state.aircraftType ?? null,
    distanceKm: round(distance, 1),
    bearing: bearingDeg(house, point),
    altitude,
    onGround: state.onGround,
    speedKmh: state.velocity === null ? null : Math.round(state.velocity * 3.6),
    heading: state.track === null ? null : Math.round(state.track) % 360,
    verticalRate: round(state.verticalRate, 1),
    squawk: state.squawk,
    emergency: EMERGENCY_SQUAWKS.includes(state.squawk),
    approach: {
      distanceKm: round(Math.min(distance, approach.distanceKm), 1),
      seconds: approach.seconds,
      altitude: approach.seconds === 0 ? altitude : approachAltitude,
    },
    _distance: distance,
  };
}

/**
 * The reading of a house from a snapshot: the aircraft within the radius,
 * closest first.
 *   { at (ms, reception), time (s, the source's), aircraft: [...], count,
 *     closest, received (aircraft in the whole answer) }
 */
export function skyReading(snapshot, house, options) {
  const { time = null, states = [], received = states.length } = snapshot ?? {};
  const aircraft = states
    .map((state) => aircraftOf(state, house, options))
    .filter(Boolean)
    .sort((a, b) => a._distance - b._distance || a.icao24.localeCompare(b.icao24))
    .map(({ _distance, ...rest }) => rest);
  return {
    at: options.now,
    time,
    aircraft,
    count: aircraft.length,
    closest: aircraft[0] ?? null,
    received,
  };
}

/** "1.2 km NE · 380 m · 278 km/h ↙": where to look, how high, how fast, where to. */
export function aircraftSummary(aircraft, language = 'en') {
  const parts = [`${aircraft.distanceKm} km ${compassPoint(aircraft.bearing, language)}`];
  if (aircraft.onGround) {
    parts.push(language === 'fr' ? 'au sol' : 'on ground');
  } else {
    parts.push(aircraft.altitude === null ? '? m' : `${aircraft.altitude} m`);
  }
  if (aircraft.speedKmh !== null) {
    parts.push(
      `${aircraft.speedKmh} km/h${aircraft.heading === null ? '' : ` ${headingArrow(aircraft.heading)}`}`,
    );
  }
  return parts.join(' · ');
}

/** "DLH1LA A320": the flight and, when the source knows it, the aircraft type. */
export const aircraftTitle = (aircraft) =>
  aircraft.aircraftType ? `${aircraft.name} ${aircraft.aircraftType}` : aircraft.name;

/** "DLH1LA A320 · 1.2 km NE · 380 m · 278 km/h ↙": one line per aircraft, for a message. */
export function aircraftLine(aircraft, language = 'en') {
  const squawk = aircraft.emergency ? ` · squawk ${aircraft.squawk}` : '';
  return `${aircraftTitle(aircraft)} · ${aircraftSummary(aircraft, language)}${squawk}`;
}
