// -----------------------------------------------------------------------------
// Readings of a house -> scene events. Pure.
//
// The core matches the trigger fields by equality only, so "within 5 km below
// 3,000 m" is one value of each field: an aircraft fires one event per
// (distance, altitude) pair it satisfies, the first time it satisfies it in
// its passage. A scene, with one pair, runs once per passage.
//
// A passage: the same icao24 seen in the previous reading, or seen again
// within PASSAGE_GAP, is the same passage (a helicopter circling, a glider
// thermalling). The first reading of a house fires nothing: it only records
// what is already overhead.
// -----------------------------------------------------------------------------

import {
  ALTITUDE_THRESHOLDS,
  ANY_ALTITUDE,
  DISTANCE_THRESHOLDS,
  PASSAGE_GAP,
  SCENE_TRIGGERS,
} from './constants.js';
import { compassPoint } from './geo.js';

const ALTITUDES = [...ALTITUDE_THRESHOLDS, ANY_ALTITUDE];

/** What a transponder emergency code means, for the `emergency` variable. */
export const SQUAWK_MEANINGS = {
  7500: { en: 'unlawful interference (hijacking)', fr: 'intervention illicite (détournement)' },
  7600: { en: 'radio failure', fr: 'panne radio' },
  7700: { en: 'general emergency', fr: 'urgence générale' },
};

/** Does the closest approach of an aircraft fall within a distance and below an altitude? */
export function satisfies(aircraft, distance, altitude) {
  if (aircraft.approach.distanceKm > distance) {
    return false;
  }
  if (altitude === ANY_ALTITUDE || aircraft.onGround) {
    return true;
  }
  return aircraft.approach.altitude !== null && aircraft.approach.altitude <= altitude;
}

function details(deviceId, aircraft, language) {
  return {
    house: deviceId,
    callsign: aircraft.name,
    icao24: aircraft.icao24,
    registration: aircraft.registration,
    aircraft_type: aircraft.aircraftType,
    country: aircraft.country,
    speed: aircraft.speedKmh,
    heading: aircraft.heading,
    vertical_rate: aircraft.verticalRate,
    bearing: aircraft.bearing,
    direction: compassPoint(aircraft.bearing, language),
    squawk: aircraft.squawk,
  };
}

/**
 * The events of a house between its memory and a new reading.
 *   memory: { at, passages: Map<icao24, { lastSeen, fired: Set, squawks: Set }> } | undefined
 * Returns { events, memory } (the new memory to keep).
 */
export function skyEvents(deviceId, memory, reading, { language = 'en' } = {}) {
  const first = !memory;
  const now = reading.at;
  const passages = new Map();
  for (const [icao24, passage] of memory?.passages ?? []) {
    const inLastReading = passage.lastSeen >= memory.at;
    if (inLastReading || now - passage.lastSeen <= PASSAGE_GAP) {
      passages.set(icao24, {
        lastSeen: passage.lastSeen,
        fired: new Set(passage.fired),
        squawks: new Set(passage.squawks),
      });
    }
  }
  const events = [];
  for (const aircraft of reading.aircraft) {
    let passage = passages.get(aircraft.icao24);
    if (!passage) {
      passage = { lastSeen: now, fired: new Set(), squawks: new Set() };
      passages.set(aircraft.icao24, passage);
    }
    passage.lastSeen = now;
    for (const distance of DISTANCE_THRESHOLDS) {
      for (const altitude of ALTITUDES) {
        const key = `${distance}|${altitude}`;
        if (passage.fired.has(key) || !satisfies(aircraft, distance, altitude)) {
          continue;
        }
        passage.fired.add(key);
        if (!first) {
          events.push({
            key: SCENE_TRIGGERS.OVERHEAD,
            data: {
              ...details(deviceId, aircraft, language),
              max_distance: String(distance),
              max_altitude: String(altitude),
              distance: aircraft.approach.distanceKm,
              altitude: aircraft.approach.altitude,
              eta_seconds: aircraft.approach.seconds,
            },
          });
        }
      }
    }
    if (aircraft.emergency && !passage.squawks.has(aircraft.squawk)) {
      passage.squawks.add(aircraft.squawk);
      if (!first) {
        const meaning = SQUAWK_MEANINGS[aircraft.squawk];
        events.push({
          key: SCENE_TRIGGERS.EMERGENCY,
          data: {
            ...details(deviceId, aircraft, language),
            emergency: meaning[language] ?? meaning.en,
            distance: aircraft.distanceKm,
            altitude: aircraft.altitude,
          },
        });
      }
    }
  }
  return { events, memory: { at: now, passages } };
}
