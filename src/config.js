// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// -----------------------------------------------------------------------------

import { ALTITUDE_SOURCES, DEFAULT_SOURCE, LANGUAGES, RADIUS_KM, SOURCES } from './constants.js';

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = {
  source: DEFAULT_SOURCE,
  radius_km: 10,
  ignore_ground: true,
  altitude: 'geometric',
  language: 'fr',
  poll_seconds: 0,
  active_from: 0,
  active_to: 24,
};

/** Bounds of the number fields (also the manifest's `min` / `max`). */
export const LIMITS = {
  radius_km: [RADIUS_KM.min, RADIUS_KM.max],
  poll_seconds: [0, 3600],
  active_from: [0, 23],
  active_to: [1, 24],
};

const number = (value, key) => {
  const [min, max] = LIMITS[key];
  const n = Number(value);
  return Number.isFinite(n) && value !== '' && value !== null
    ? Math.min(max, Math.max(min, Math.round(n)))
    : DEFAULTS[key];
};

const text = (value) =>
  // A value pasted with spaces or quotes around it is still the value.
  typeof value === 'string' ? value.trim().replace(/^["']|["']$/g, '') : '';

const flag = (value, fallback) =>
  value === undefined || value === null || value === ''
    ? fallback
    : value !== false && value !== 'false';

/**
 * The URL of a receiver's aircraft.json, from what the user typed:
 *   http://192.168.1.30/tar1090/data/aircraft.json   as is
 *   http://192.168.1.30/tar1090/                     + data/aircraft.json
 *   http://192.168.1.30:8080                         + /data/aircraft.json
 * http and https only (a private address is the point: it is the user's own
 * receiver). Credentials typed in the URL become a Basic Authorization header
 * (fetch refuses a URL that holds them). Returns { url, host, where, headers }, or
 * { error: 'missing' | 'invalid' }; the URL itself is never echoed (it may
 * hold a password).
 */
export function receiverTarget(raw) {
  const typed = text(raw);
  if (!typed) {
    return { error: 'missing' };
  }
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `http://${typed}`);
  } catch {
    return { error: 'invalid' };
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return { error: 'invalid' };
  }
  const headers = {};
  if (url.username || url.password) {
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    headers.Authorization = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
    url.username = '';
    url.password = '';
  }
  url.hash = '';
  if (!/\.json$/i.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/data/aircraft.json`;
  }
  // `where` names the receiver in the statuses: host and path, never a query or a password.
  return { url: url.href, host: url.host, where: `${url.host}${url.pathname}`, headers };
}

export function normalizeConfig(raw = {}) {
  const source = String(raw.source ?? DEFAULTS.source).toLowerCase();
  const language = String(raw.language ?? DEFAULTS.language).toLowerCase();
  const altitude = String(raw.altitude ?? DEFAULTS.altitude).toLowerCase();
  const clientId = text(raw.client_id);
  const clientSecret = text(raw.client_secret);
  return {
    source: SOURCES.includes(source) ? source : DEFAULTS.source,
    radiusKm: number(raw.radius_km, 'radius_km'),
    ignoreGround: flag(raw.ignore_ground, DEFAULTS.ignore_ground),
    altitudeSource: ALTITUDE_SOURCES.includes(altitude) ? altitude : DEFAULTS.altitude,
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
    receiver: receiverTarget(raw.receiver_url),
    clientId,
    clientSecret,
    /** An OpenSky account needs both halves of the API client; one alone is reported, not used. */
    account: Boolean(clientId && clientSecret),
    incompleteAccount: Boolean(clientId) !== Boolean(clientSecret),
    pollSeconds: number(raw.poll_seconds, 'poll_seconds'),
    activeFrom: number(raw.active_from, 'active_from'),
    activeTo: number(raw.active_to, 'active_to'),
  };
}

/**
 * What a reading depends on: a change of any of these starts a new baseline
 * (the first reading after it fires nothing). The source is not part of it:
 * the same aircraft (same transponder address) seen through another source is
 * the same passage, and must not be announced twice.
 */
export const readingFingerprint = (config) =>
  JSON.stringify([config.radiusKm, config.ignoreGround, config.altitudeSource]);

/** What the client depends on: a change means another client, another pause and budget. */
export const clientFingerprint = (config) =>
  JSON.stringify([
    config.source,
    config.source === 'receiver' ? (config.receiver.url ?? config.receiver.error) : '',
    config.source === 'receiver' ? (config.receiver.headers?.Authorization ?? '') : '',
    config.source === 'opensky' && config.account ? [config.clientId, config.clientSecret] : '',
  ]);
