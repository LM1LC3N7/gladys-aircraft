// -----------------------------------------------------------------------------
// The Gladys devices and their states. Pure.
//
// External ids (forever):
//   sky:<houseSelector>   the aircraft around one located house of Gladys
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { RADIUS_KM } from './constants.js';

export const FEATURE = {
  COUNT: 'count',
  CLOSEST_KM: 'closest_km',
  CLOSEST_ALTITUDE: 'closest_altitude',
  CLOSEST_CALLSIGN: 'closest_callsign',
};

export const ids = {
  sky: (gladys, houseSelector) => gladys.externalId(`sky:${houseSelector}`),
  feature: (deviceId, key) => `${deviceId}:${key}`,
};

/** The house selector of a sky device, or undefined for any other id. */
export function parseExternalId(externalId) {
  const match = /:sky:([^:]+)$/.exec(String(externalId ?? ''));
  return match ? { houseSelector: match[1] } : undefined;
}

const feature = (deviceId, key, name, category, type, extra = {}) => ({
  name,
  external_id: ids.feature(deviceId, key),
  category,
  type,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

/** The device of one located house: `house` is a getHouses() entry. */
export function buildSkyDevice(gladys, house) {
  const id = ids.sky(gladys, house.selector);
  return {
    name: `Aircraft over ${house.name}`,
    external_id: id,
    features: [
      feature(id, FEATURE.COUNT, 'Aircraft within the radius', C.COUNTER_SENSOR, T.SENSOR.INTEGER, {
        min: 0,
        max: 500,
      }),
      feature(id, FEATURE.CLOSEST_KM, 'Closest aircraft', C.DISTANCE_SENSOR, T.SENSOR.DECIMAL, {
        unit: U.KM,
        min: 0,
        max: RADIUS_KM.max,
      }),
      feature(
        id,
        FEATURE.CLOSEST_ALTITUDE,
        'Altitude of the closest aircraft',
        C.DISTANCE_SENSOR,
        T.SENSOR.INTEGER,
        { unit: U.M, min: -500, max: 20_000 },
      ),
      feature(id, FEATURE.CLOSEST_CALLSIGN, 'Closest flight', C.TEXT, T.TEXT.TEXT, {
        min: 0,
        max: 0,
        keep_history: false,
      }),
    ],
    params: [{ name: 'house', value: house.selector }],
  };
}

const state = (deviceId, key, value) =>
  value === null || value === undefined
    ? []
    : [
        typeof value === 'string'
          ? { device_feature_external_id: ids.feature(deviceId, key), text: value }
          : { device_feature_external_id: ids.feature(deviceId, key), state: value },
      ];

/**
 * The states of a house. With a clear sky the closest distance is the radius
 * (a condition "closer than 2 km" stays false, never a stale value), the
 * flight is "—" and the altitude keeps the last aircraft's (a condition on it
 * goes with the count or the distance).
 */
export function skyStates(deviceId, reading, { radiusKm }) {
  const closest = reading.closest;
  return [
    ...state(deviceId, FEATURE.COUNT, reading.count),
    ...state(deviceId, FEATURE.CLOSEST_KM, closest ? closest.distanceKm : radiusKm),
    ...state(deviceId, FEATURE.CLOSEST_ALTITUDE, closest?.altitude ?? null),
    ...state(deviceId, FEATURE.CLOSEST_CALLSIGN, closest ? closest.name : '—'),
  ];
}
