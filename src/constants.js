// -----------------------------------------------------------------------------
// Constants of the Aircraft overhead integration.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// --- Sources -------------------------------------------------------------------------
// The `source` of the configuration (forever: stored in user configurations).
//   adsblol   adsb.lol, the default: free, open data (ODbL 1.0), no key today
//   adsbfi    adsb.fi open data: personal, non-commercial use, 1 request a second
//   receiver  the aircraft.json of the user's own ADS-B receiver on the LAN
//   opensky   the OpenSky Network: only with OpenSky's written agreement (terms)
export const SOURCES = ['adsblol', 'adsbfi', 'receiver', 'opensky'];
export const DEFAULT_SOURCE = 'adsblol';

/**
 * The "around a point" endpoints of the two community aggregators: the same
 * readsb JSON ({ ac: [...], now (ms) }), a distance in nautical miles (an
 * integer, 250 at most). adsb.fi's README (2026-10-14) marks its v2 route
 * deprecated ("returned data in a different format") and asks new
 * integrations to use v3, whose answer is the shape adsb.lol's v2 returns.
 */
export const AGGREGATOR_URLS = {
  adsblol: 'https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{nm}',
  adsbfi: 'https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{nm}',
};
export const MAX_DISTANCE_NM = 250;

/** The REST API of the OpenSky Network (https://openskynetwork.github.io/opensky-api/rest.html). */
export const OPENSKY_API_URL = 'https://opensky-network.org/api';
/** OAuth2 client credentials: an account's API client trades its id and secret here. */
export const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

export const USER_AGENT = `gladys-aircraft/${version} (+https://github.com/LM1LC3N7/gladys-aircraft)`;
export const HTTP_TIMEOUT = 15_000;
/** A busy receiver's aircraft.json is a few hundred KB: anything far bigger is not one. */
export const MAX_ANSWER_BYTES = 8 * 1024 * 1024;

// --- Credits ----------------------------------------------------------------------
// OpenSky counts "credits" per day in a bucket per endpoint family (see
// CLAUDE.md): 400 for anonymous use (per IP address, shared with every
// OpenSky client behind the same address), 4,000 for a standard account. A
// bounding box of at most 25 square degrees costs 1 credit: the largest box
// this integration asks for (25 km around a house) is below 1 square degree.

/** The daily credits of /states/* per tier (the published table). */
export const DAILY_CREDITS = { anonymous: 400, account: 4_000 };
/**
 * The share of those credits the background readings may spend: the rest is
 * left to the scene action, the test button and, anonymously, the other
 * OpenSky users of the same IP address (a phone on the OpenSky map, another
 * home automation box).
 */
export const CREDIT_SHARE = { anonymous: 0.5, account: 0.75 };
/** The published cost of a /states/all bounding box, by area in square degrees. */
export const CREDIT_COST = [
  { maxArea: 25, credits: 1 },
  { maxArea: 100, credits: 2 },
  { maxArea: 400, credits: 3 },
  { maxArea: Infinity, credits: 4 },
];

// --- Pacing -------------------------------------------------------------------------

/**
 * The interval between two readings of the sources without credits:
 * `poll_seconds` 0 means `auto`, a typed value is never below `min`.
 *   adsb.lol / adsb.fi: one request per house; adsb.fi allows 1 request a
 *   second, adsb.lol publishes no figure ("dynamic"): 30 s is far below both.
 *   receiver: one read of the LAN for every house; readsb rewrites its
 *   aircraft.json every second, so 5 s is still gentle.
 */
export const PACE = {
  adsblol: { auto: 30_000, min: 15_000 },
  adsbfi: { auto: 30_000, min: 15_000 },
  receiver: { auto: 10_000, min: 5_000 },
};
/** Two requests to adsb.lol / adsb.fi at least this far apart (adsb.fi: 1 a second). */
export const AGGREGATOR_SPACING = 1_100;
/** A 429 from adsb.lol / adsb.fi without Retry-After: wait that long. */
export const AGGREGATOR_PAUSE = 5 * 60_000;
/** A receiver whose aircraft.json did not change for that long is stuck (decoder stopped). */
export const RECEIVER_STALE = 2 * 60_000;

/** OpenSky: never read a house more often than this, whatever the credits allow. */
export const MIN_INTERVAL = 60_000;
/** The computed interval is rounded up to this step (readable, never below the budget). */
export const INTERVAL_STEP = 15_000;
/** The loop wakes up this often (the receiver may be read every 5 s); most ticks make no request. */
export const TICK_INTERVAL = 5_000;
/** Below this share of the daily credits left, the houses are read at LOW_CREDITS_INTERVAL. */
export const LOW_CREDITS_SHARE = 0.05;
export const LOW_CREDITS_INTERVAL = 30 * 60_000;
/** An OpenSky 429 without X-Rate-Limit-Retry-After-Seconds: wait that long. */
export const RATE_LIMIT_PAUSE = 60 * 60_000;
/** The scene action reuses a reading younger than this (and than the interval) instead of a request. */
export const ACTION_MAX_AGE = 60_000;
/** States re-sent unchanged after this long, so a quiet sky stays dated. */
export const STATE_HEARTBEAT = 30 * 60_000;
/** An access token is renewed this long before OpenSky says it expires. */
export const TOKEN_MARGIN = 60_000;

// --- Aircraft -------------------------------------------------------------------------

export const RADIUS_KM = { min: 1, max: 25 };
/**
 * A position older than this (seconds) is not where the aircraft is: OpenSky
 * keeps a vector up to 5 minutes, readsb an aircraft on the ground 30 s or
 * more after its last position.
 */
export const MAX_POSITION_AGE = 60;
/**
 * "Aircraft overhead" looks this far ahead along the current track and speed:
 * between two readings a minute apart, an airliner crosses a 10 km circle
 * unseen. Short enough for a straight line to hold.
 */
export const LOOKAHEAD_SECONDS = 60;
/** The same icao24 seen again within this time is the same passage. */
export const PASSAGE_GAP = 10 * 60_000;
/** A safety net for the core's 300 events per minute: per house and per reading. */
export const MAX_EVENTS_PER_READING = 100;
/** The aircraft listed by the widget and the scene action. */
export const WIDGET_AIRCRAFT = 5;
export const LIST_AIRCRAFT = 10;

/** The "within" distances (km) of the aircraft_overhead trigger. */
export const DISTANCE_THRESHOLDS = [1, 2, 3, 5, 10, 25];
/** The "below" altitudes (m) of the aircraft_overhead trigger, and "any altitude". */
export const ALTITUDE_THRESHOLDS = [500, 1000, 2000, 3000, 5000, 10000];
export const ANY_ALTITUDE = 'any';
/** The emergency transponder codes, and what they mean. */
export const EMERGENCY_SQUAWKS = ['7500', '7600', '7700'];
/** The unit conversions of the readsb JSON (feet, knots, feet per minute). */
export const FEET = 0.3048;
export const KNOT = 1852 / 3600;
export const FEET_PER_MINUTE = FEET / 60;
export const KM_PER_NM = 1.852;

export const LANGUAGES = ['fr', 'en'];
export const ALTITUDE_SOURCES = ['geometric', 'barometric'];

/** Manifest keys (forever: stored in user scenes and dashboards). */
export const ACTIONS = { TEST: 'test_connection' };
export const SCENE_ACTIONS = { GET_AIRCRAFT: 'get_aircraft' };
export const SCENE_TRIGGERS = { OVERHEAD: 'aircraft_overhead', EMERGENCY: 'emergency_squawk' };
export const WIDGETS = { SKY: 'sky' };
