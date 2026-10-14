// -----------------------------------------------------------------------------
// Geometry around a house: great-circle distance and bearing, compass points,
// the point asked to adsb.lol / adsb.fi, the bounding box asked to OpenSky and
// its credit cost, and the closest approach of an aircraft flying straight
// ahead. Pure.
// -----------------------------------------------------------------------------

import { CREDIT_COST, KM_PER_NM, MAX_DISTANCE_NM } from './constants.js';

const EARTH_KM = 6371;
const KM_PER_DEGREE = (Math.PI * EARTH_KM) / 180; // ~111.2 km
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Great-circle distance in km between { latitude, longitude } points. */
export function distanceKm(a, b) {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, in degrees clockwise from north (0-359). */
export function bearingDeg(a, b) {
  const phi1 = rad(a.latitude);
  const phi2 = rad(b.latitude);
  const dLambda = rad(b.longitude - a.longitude);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (Math.round(deg(Math.atan2(y, x))) + 360) % 360;
}

const POINTS = {
  en: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
  fr: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'],
};
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
const octant = (degrees) => Math.round((((degrees % 360) + 360) % 360) / 45) % 8;

/** The 8-point compass name of a bearing: 0 -> N, 45 -> NE, 250 -> W (O in French). */
export function compassPoint(degrees, language = 'en') {
  return (POINTS[language] ?? POINTS.en)[octant(degrees)];
}

/** An arrow pointing where a heading goes: 90 -> →. */
export const headingArrow = (degrees) => ARROWS[octant(degrees)];

const floor2 = (x) => Math.floor(x * 100) / 100;
const ceil2 = (x) => Math.ceil(x * 100) / 100;
const clamp = (x, min, max) => Math.min(max, Math.max(min, x));

/**
 * The OpenSky bounding box holding every point within `km` of the house,
 * rounded OUTWARD to 0.01 degree: the box still holds the circle, and the
 * exact house position never leaves Gladys. Clamped to the valid ranges (a
 * house next to the antimeridian loses the part of its circle beyond it).
 */
export function boundingBox(point, km) {
  const dLat = km / KM_PER_DEGREE;
  const cos = Math.cos(rad(Math.min(89, Math.abs(point.latitude) + dLat)));
  const dLon = Math.min(180, km / (KM_PER_DEGREE * cos));
  return {
    lamin: clamp(floor2(point.latitude - dLat), -90, 90),
    lamax: clamp(ceil2(point.latitude + dLat), -90, 90),
    lomin: clamp(floor2(point.longitude - dLon), -180, 180),
    lomax: clamp(ceil2(point.longitude + dLon), -180, 180),
  };
}

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * The point and distance asked to adsb.lol / adsb.fi: the house rounded to
 * 0.01 degree (about a kilometre: the exact position never leaves Gladys),
 * and the radius in whole nautical miles, widened by the rounding so the
 * circle asked for still holds the circle around the house.
 *   { latitude, longitude, nm }
 */
export function queryPoint(house, km) {
  const point = { latitude: round2(house.latitude), longitude: round2(house.longitude) };
  const margin = distanceKm(house, point);
  const nm = Math.ceil((km + margin) / KM_PER_NM - 1e-9);
  return { ...point, nm: clamp(nm, 1, MAX_DISTANCE_NM) };
}

/** The area of a box in square degrees, the unit of OpenSky's credit table. */
export const boxArea = (box) => (box.lamax - box.lamin) * (box.lomax - box.lomin);

/** What one /states/all request on that box costs (the published table). */
export function creditCost(box) {
  const area = boxArea(box);
  return CREDIT_COST.find((step) => area <= step.maxArea).credits;
}

/**
 * The closest approach to the house of an aircraft at `point` flying straight
 * at `speed` m/s on `track` degrees, within the next `seconds`. A flat local
 * plane is exact enough for a few tens of kilometres.
 *   { distanceKm, seconds }   seconds = 0 when the closest is now
 */
export function closestApproach(house, point, { speed, track, seconds }) {
  const now = distanceKm(house, point);
  if (!Number.isFinite(speed) || !Number.isFinite(track) || speed <= 0 || seconds <= 0) {
    return { distanceKm: now, seconds: 0 };
  }
  // Position (km) east and north of the house, velocity (km/s).
  const x = (point.longitude - house.longitude) * KM_PER_DEGREE * Math.cos(rad(house.latitude));
  const y = (point.latitude - house.latitude) * KM_PER_DEGREE;
  const vx = (speed / 1000) * Math.sin(rad(track));
  const vy = (speed / 1000) * Math.cos(rad(track));
  const t = clamp(-(x * vx + y * vy) / (vx * vx + vy * vy), 0, seconds);
  if (t === 0) {
    return { distanceKm: now, seconds: 0 };
  }
  return { distanceKm: Math.hypot(x + vx * t, y + vy * t), seconds: Math.round(t) };
}
