// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake network serving
// the synthetic samples of test/fixtures (adsb.lol, adsb.fi, a receiver and
// OpenSky, all shaped after real answers). The clock is fake: the 1.1 s
// between two requests to an aggregator moves it.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { AircraftApp } from '../src/app.js';
import { ACTIONS, SCENE_ACTIONS, SCENE_TRIGGERS, WIDGETS } from '../src/constants.js';
import {
  FIXTURE_NOW,
  HOME,
  fixture,
  installFetch,
  json,
  readsbSample,
  sample,
} from './helpers/fakeFetch.js';
import { createFakeTimers } from './helpers/fakeTimers.js';

const quiet = {
  info() {},
  warn: (...a) => process.env.DEBUG_TEST && console.error(...a),
  error() {},
  debug() {},
};
const MIN = 60_000;
const SKY = 'ext:aircraft:sky:home';
const OFFICE_SKY = 'ext:aircraft:sky:office';
const SECRET = 'the-very-secret-value';
const OFFICE = { id: 3, name: 'Office', selector: 'office', latitude: 50.11, longitude: 8.68 };
const CABIN = { id: 2, name: 'Cabin', selector: 'cabin', latitude: null, longitude: null };
const created = { external_id: SKY, name: 'Aircraft over Home', params: [] };
const office = { external_id: OFFICE_SKY, name: 'Aircraft over Office', params: [] };
const RECEIVER = { source: 'receiver', receiver_url: 'http://192.168.1.30/tar1090/' };
const OPENSKY = { source: 'opensky' };

let fake;
afterEach(() => fake?.restore());

async function setup({
  config = {},
  houses = [HOME, CABIN],
  devices = [],
  now = FIXTURE_NOW,
} = {}) {
  const clock = { now };
  // What the fake network answers; a test changes it as the sky moves.
  const sky = {
    readsb: () => readsbSample(),
    receiver: () => readsbSample({ receiver: true, seconds: (clock.now - now) / 1000 }),
    opensky: () => fixture('states-sample.json'),
    status: 200,
    headers: {},
    remaining: 365,
  };
  const answer = (body, extra = {}) =>
    sky.status === 200
      ? json(body(), extra)
      : json(undefined, { status: sky.status, headers: sky.headers });
  const tokens = { n: 0, refuse: false };
  fake = installFetch(
    [
      [/api\.adsb\.lol\/v2\/lat\//, () => answer(sky.readsb)],
      [/opendata\.adsb\.fi\/api\/v3\/lat\//, () => answer(sky.readsb)],
      [/192\.168\.1\.30\/tar1090\/data\/aircraft\.json$/, () => answer(sky.receiver)],
      [
        /openid-connect\/token$/,
        () => {
          tokens.n += 1;
          return tokens.refuse
            ? json({ error: 'invalid_client' }, { status: 401 })
            : json({ access_token: `token-${tokens.n}`, expires_in: 1800 });
        },
      ],
      [/\/api\/states\/all\?/, () => answer(sky.opensky, { remaining: sky.remaining })],
    ],
    { clock },
  );
  const gladys = createFakeGladys({ selector: 'aircraft', config, houses, devices });
  const timers = createFakeTimers();
  const app = new AircraftApp({
    gladys,
    logger: quiet,
    now: () => clock.now,
    timers,
    timeZone: 'UTC',
    sleep: async (ms) => {
      clock.now += ms;
    },
  });
  gladys.onScanRequest(() => app.scan());
  gladys.onDeviceCreated((device) => app.deviceChanged(device));
  gladys.onDeviceDeleted((device) => app.deviceChanged(device));
  gladys.onSceneAction(SCENE_ACTIONS.GET_AIRCRAFT, (fields) => app.getAircraft(fields));
  gladys.onWidgetGet(WIDGETS.SKY, (request) => app.getWidget(request));
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  await gladys.connect();
  await app.start(config);
  return { app, gladys, timers, clock, sky, tokens };
}

const requests = (pattern = /adsb\.lol|adsb\.fi|192\.168\.1\.30|\/states\/all/) =>
  fake.calls.filter((c) => pattern.test(c.url));
const events = (gladys, key) => gladys.fake.sceneEvents.filter((e) => e.key === key);
const status = (gladys) => gladys.fake.connectionStatus;

/** readsb: an extra aircraft 2 km east of the house, level at 2,950 ft, westbound (straight over it). */
const newcomer = (ac) => {
  if (ac.hex === 'f00007') {
    Object.assign(ac, {
      hex: 'f000aa',
      flight: 'NEW1    ',
      r: 'XX-NEW1',
      t: 'E190',
      lat: 50.06,
      lon: 8.728,
      track: 270,
      baro_rate: 0,
      alt_geom: 2950,
    });
  }
};
/** OpenSky: the same newcomer, as a state vector. */
const newcomerRow = (row) => {
  if (row[0] === 'f00007') {
    Object.assign(row, { 0: 'f000aa', 1: 'NEW1    ', 5: 8.728, 6: 50.06, 10: 270, 11: 0, 13: 900 });
  }
};

/** Move the clock and run the ticks. */
async function later(ctx, ms) {
  ctx.clock.now += ms;
  await ctx.timers.runIntervals();
}

// --- Discovery and houses --------------------------------------------------------------

test('discovery: one device per located house; no device, no request', async () => {
  const { gladys } = await setup();
  const devices = gladys.fake.discoveredDevices;
  assert.equal(devices.length, 1, 'the cabin has no location');
  assert.equal(devices[0].external_id, SKY);
  assert.equal(devices[0].name, 'Aircraft over Home');
  assert.deepEqual(
    devices[0].features.map((f) => f.external_id.split(':').at(-1)),
    ['count', 'closest_km', 'closest_altitude', 'closest_callsign'],
  );
  assert.equal(requests().length, 0, 'nothing is read for nothing');
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.en, /Open Discovery/);
});

test('no located house, or no access to the houses: the status says what to do', async () => {
  const none = await setup({ houses: [CABIN] });
  assert.equal(status(none.gladys).connected, false);
  assert.match(status(none.gladys).message.fr, /Aucune maison localisée/);
  fake.restore();
  const denied = await setup({ devices: [created] });
  denied.gladys.getHouses = async () => {
    throw new Error('403 FORBIDDEN');
  };
  denied.app.areas.clear();
  await denied.app.start({});
  assert.match(status(denied.gladys).message.en, /not available \(403 FORBIDDEN\)/);
});

// --- adsb.lol, the default source ------------------------------------------------------------

test('adsb.lol: read at once around the rounded house, every 30 s, events from the second reading', async () => {
  const ctx = await setup({ devices: [created] });
  const { gladys, timers } = ctx;
  assert.deepEqual(
    requests().map((c) => c.url),
    ['https://api.adsb.lol/v2/lat/50.06/lon/8.70/dist/6'],
  );
  assert.equal(gladys.fake.lastState(`${SKY}:count`), 5);
  assert.equal(gladys.fake.lastState(`${SKY}:closest_km`), 1.2);
  assert.equal(gladys.fake.lastState(`${SKY}:closest_altitude`), 579);
  assert.equal(gladys.fake.lastState(`${SKY}:closest_callsign`), 'TST101');
  assert.equal(gladys.fake.sceneEvents.length, 0, 'nothing on the first reading');
  assert.equal(
    status(gladys).message.en,
    'Watching 1 house with adsb.lol: one reading every 30 s (2,880 requests a day).',
  );
  assert.equal(timers.intervals()[0].ms, 5_000);
  // The ticks before the interval send nothing.
  await later(ctx, 25_000);
  assert.equal(requests().length, 1);
  // 30 s: the next reading, with an aircraft heading over the house.
  ctx.sky.readsb = () => readsbSample({ seconds: 30, edit: newcomer });
  await later(ctx, 5_000);
  assert.equal(requests().length, 2);
  const overhead = events(gladys, SCENE_TRIGGERS.OVERHEAD);
  assert.ok(overhead.length > 0);
  assert.ok(overhead.every((e) => e.data.icao24 === 'f000aa' && e.data.house === SKY));
  const tight = overhead.find((e) => e.data.max_distance === '1' && e.data.max_altitude === '1000');
  assert.equal(tight.data.eta_seconds, 20);
  assert.equal(tight.data.registration, 'XX-NEW1');
  assert.equal(tight.data.aircraft_type, 'E190');
  assert.equal(tight.data.direction, 'E', 'French by default: E is E');
  assert.ok(gladys.fake.widgetRefreshes.length > 0);
});

test('adsb.lol: two houses, one request each, 1.1 s apart; never the exact position', async () => {
  const houses = [HOME, { ...OFFICE, latitude: 50.1149, longitude: 8.6751 }];
  const ctx = await setup({ houses, devices: [created, office] });
  assert.deepEqual(
    requests().map((c) => [c.at - FIXTURE_NOW, c.url.replace(/^.*\/lat\//, '')]),
    [
      [0, '50.06/lon/8.70/dist/6'],
      [1100, '50.11/lon/8.68/dist/6'],
    ],
  );
  assert.equal(ctx.gladys.fake.lastState(`${OFFICE_SKY}:count`), 3);
  await later(ctx, 30_000);
  const [, , third, fourth] = requests();
  assert.equal(fourth.at - third.at, 1100);
  assert.match(status(ctx.gladys).message.en, /2 houses with adsb\.lol.*5,760 requests a day/);
});

test('adsb.lol: a 4xx stops the readings until the configuration is saved', async () => {
  const ctx = await setup({ devices: [created] });
  ctx.sky.status = 403;
  await later(ctx, 30_000);
  assert.equal(requests().length, 2);
  assert.equal(status(ctx.gladys).connected, false);
  assert.match(status(ctx.gladys).message.en, /adsb\.lol refused the request \(HTTP 403\)/);
  await later(ctx, 10 * MIN);
  await ctx.app.start({}); // a reconnection to Gladys is not an answer
  const report = (await ctx.gladys.fake.action(ACTIONS.TEST)).data.message;
  assert.match(report.fr, /adsb\.lol a refusé la requête/);
  assert.equal(requests().length, 2, 'no request at all, not even the test');
  ctx.sky.status = 200;
  await ctx.app.start({}, { saved: true });
  assert.equal(requests().length, 3);
  assert.equal(status(ctx.gladys).connected, true);
});

test('adsb.lol down: the status says so and the next interval tries again', async () => {
  const ctx = await setup({ devices: [created] });
  ctx.sky.status = 503;
  await later(ctx, 30_000);
  assert.equal(status(ctx.gladys).connected, true, 'the last reading still stands');
  assert.match(
    status(ctx.gladys).message.en,
    /adsb\.lol is unreachable: HTTP 503 on api\.adsb\.lol\./,
  );
  assert.ok(!JSON.stringify(status(ctx.gladys)).includes('50.06'), 'no position in a status');
  await later(ctx, 10_000);
  assert.equal(requests().length, 2, 'not every tick');
  ctx.sky.status = 200;
  await later(ctx, 20_000);
  assert.equal(requests().length, 3);
  assert.match(status(ctx.gladys).message.en, /^Watching 1 house/);
});

test('a reconnection neither reads before the interval nor announces twice', async () => {
  const ctx = await setup({ devices: [created] });
  ctx.sky.readsb = () => readsbSample({ seconds: 30, edit: newcomer });
  await later(ctx, 30_000);
  const fired = ctx.gladys.fake.sceneEvents.length;
  assert.ok(fired > 0);
  ctx.clock.now += 10_000;
  await ctx.app.start({}); // Gladys reconnected
  assert.equal(requests().length, 2, 'not re-read 10 s after the last reading');
  await later(ctx, 20_000);
  assert.equal(requests().length, 3);
  assert.equal(ctx.gladys.fake.sceneEvents.length, fired, 'the same passages');
});

test('the scene action: a recent reading is reused, an older one refreshed, no event', async () => {
  const ctx = await setup({ devices: [created], config: { language: 'en' } });
  const answer = await ctx.gladys.fake.sceneAction(SCENE_ACTIONS.GET_AIRCRAFT, { house: SKY });
  assert.equal(answer.success, true);
  assert.deepEqual(answer.data.outputs, {
    count: 5,
    list: [
      'TST101 A319 · 1.2 km E · 579 m · 278 km/h ←',
      'F00005 C172 · 4.5 km S · 533 m · 232 km/h ↓',
      'TST202 B77W · 6 km NW · 10470 m · 989 km/h ↘',
      'TST909 · 7 km N · ? m · 360 km/h →',
      'TST606 B763 · 8 km SW · 4618 m · 535 km/h ↖ · squawk 7700',
    ].join('\n'),
    closest_callsign: 'TST101',
    closest_icao24: 'f00001',
    closest_registration: 'XX-TST1',
    closest_type: 'A319',
    closest_country: null,
    closest_distance: 1.2,
    closest_altitude: 579,
    closest_speed: 278,
    closest_heading: 250,
    closest_bearing: 71,
    closest_direction: 'E',
    emergency: true,
    age_seconds: 0,
  });
  const manifest = JSON.parse(
    readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    Object.keys(answer.data.outputs),
    manifest.scene_actions[0].outputs.map((o) => o.key),
    'the outputs the manifest declares, in its order',
  );
  assert.equal(requests().length, 1, 'the reading of the start is reused');
  ctx.clock.now += 2 * MIN;
  ctx.sky.readsb = () => readsbSample({ seconds: 120, edit: newcomer });
  const fresh = await ctx.gladys.fake.sceneAction(SCENE_ACTIONS.GET_AIRCRAFT, { house: SKY });
  assert.equal(requests().length, 2);
  assert.equal(fresh.data.outputs.closest_callsign, 'NEW1');
  assert.equal(fresh.data.outputs.age_seconds, 0);
  assert.equal(ctx.gladys.fake.sceneEvents.length, 0, 'no event from an action');
  const wrong = await ctx.gladys.fake.sceneAction(SCENE_ACTIONS.GET_AIRCRAFT, { house: 'ext:x:y' });
  assert.equal(wrong.success, false);
  // The next paced reading announces the newcomer.
  ctx.sky.readsb = () => readsbSample({ seconds: 125, edit: newcomer });
  await later(ctx, 5_000);
  assert.ok(events(ctx.gladys, SCENE_TRIGGERS.OVERHEAD).length > 0);
});

test('the widget and the test button name the source and its credit', async () => {
  const ctx = await setup({ devices: [created] });
  const content = (
    await ctx.gladys.fake.widgetGet(WIDGETS.SKY, { settings: { device: SKY }, language: 'fr' })
  ).data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].text, 'Aircraft over Home');
  assert.equal(content.components.at(-1).text.en, '14:47 · Data: adsb.lol (ODbL 1.0) · unofficial');
  const pick = (await ctx.gladys.fake.widgetGet(WIDGETS.SKY, { settings: { device: 'x' } })).data
    .content;
  assert.match(pick.components[0].text.en, /Pick the aircraft device/);
  const report = (await ctx.gladys.fake.action(ACTIONS.TEST)).data.message;
  assert.match(
    report.en,
    /^adsb\.lol answers: 5 aircraft within 10 km of Home, the closest TST101 A319 · 1\.2 km E/,
  );
  assert.match(
    report.fr,
    /Une lecture toutes les 30 s par maison \(2880 requêtes par jour\), espacées d'au moins 1,1 s/,
  );
  assert.equal(requests().length, 2);
  assert.equal(requests()[1].at - requests()[0].at, 1100, 'the test waits its turn too');
  assert.equal(ctx.gladys.fake.sceneEvents.length, 0);
});

// --- adsb.fi ------------------------------------------------------------------------------

test('adsb.fi: a 429 waits for Retry-After, five minutes without it', async () => {
  const ctx = await setup({ devices: [created], config: { source: 'adsbfi' } });
  assert.match(requests()[0].url, /^https:\/\/opendata\.adsb\.fi\/api\/v3\/lat\/50\.06\/lon/);
  ctx.sky.status = 429;
  ctx.sky.headers = { 'retry-after': '120' };
  await later(ctx, 30_000);
  assert.equal(status(ctx.gladys).connected, false);
  assert.match(
    status(ctx.gladys).message.en,
    /adsb\.fi asks to slow down \(HTTP 429\): next reading at 14:49/,
  );
  await later(ctx, 115_000);
  assert.equal(requests().length, 2, 'paused');
  ctx.sky.headers = {};
  await later(ctx, 5_000);
  assert.equal(requests().length, 3);
  await later(ctx, 4 * MIN + 55_000);
  assert.equal(requests().length, 3, 'no Retry-After: five minutes');
  ctx.sky.status = 200;
  await later(ctx, 5_000);
  assert.equal(requests().length, 4);
  assert.match(status(ctx.gladys).message.en, /^Watching 1 house with adsb\.fi/);
  const widget = (await ctx.gladys.fake.widgetGet(WIDGETS.SKY, { settings: {} })).data.content;
  assert.match(widget.components.at(-1).text.en, /Data: adsb\.fi \(https:\/\/adsb\.fi\)/);
});

// --- The receiver ------------------------------------------------------------------------------

test('the receiver: one read every 10 s for every house, the distances computed here', async () => {
  const ctx = await setup({
    config: RECEIVER,
    houses: [HOME, OFFICE],
    devices: [created, office],
  });
  assert.deepEqual(
    requests().map((c) => c.url),
    ['http://192.168.1.30/tar1090/data/aircraft.json'],
  );
  assert.equal(ctx.gladys.fake.lastState(`${SKY}:count`), 5);
  assert.equal(ctx.gladys.fake.lastState(`${OFFICE_SKY}:count`), 3);
  assert.equal(
    status(ctx.gladys).message.en,
    'Watching 2 houses with your receiver (192.168.1.30): one reading every 10 s, 9 aircraft received.',
  );
  await later(ctx, 5_000);
  assert.equal(requests().length, 1);
  await later(ctx, 5_000);
  assert.equal(requests().length, 2, 'one read for both houses');
  const widget = (await ctx.gladys.fake.widgetGet(WIDGETS.SKY, { settings: {} })).data.content;
  assert.match(widget.components.at(-1).text.fr, /Données : votre récepteur ADS-B/);
  // The decoder stops: the same file for two minutes is stale.
  ctx.sky.receiver = () => readsbSample({ receiver: true, seconds: 10 });
  await later(ctx, 2 * MIN);
  assert.match(status(ctx.gladys).message.en, /serves the same aircraft for 2 min/);
  // The receiver goes away.
  ctx.sky.status = 404;
  await later(ctx, 10_000);
  assert.match(
    status(ctx.gladys).message.en,
    /^Your receiver \(192\.168\.1\.30\) is unreachable: HTTP 404 on 192\.168\.1\.30\/tar1090\/data\/aircraft\.json/,
  );
});

test('the receiver without an address: nothing read, the status and the test say what to type', async () => {
  const ctx = await setup({ config: { source: 'receiver' }, devices: [created] });
  assert.equal(requests().length, 0);
  assert.equal(status(ctx.gladys).connected, false);
  assert.match(status(ctx.gladys).message.en, /Type the address of your receiver/);
  const report = (await ctx.gladys.fake.action(ACTIONS.TEST)).data.message;
  assert.match(report.fr, /Saisissez l'adresse de votre récepteur/);
  await ctx.app.start({ source: 'receiver', receiver_url: 'ftp://192.168.1.30/' }, { saved: true });
  assert.match(status(ctx.gladys).message.en, /not an http:\/\/ or https:\/\/ address/);
  assert.equal(requests().length, 0);
});

test('switching the source: read at once from the new one, the same passages kept', async () => {
  const ctx = await setup({ devices: [created] });
  assert.equal(requests(/adsb\.lol/).length, 1);
  ctx.clock.now += 5_000;
  await ctx.app.start(RECEIVER, { saved: true });
  assert.equal(requests(/192\.168\.1\.30/).length, 1, 'at once');
  assert.equal(ctx.gladys.fake.sceneEvents.length, 0, 'the aircraft already seen stay quiet');
  ctx.sky.receiver = () => readsbSample({ receiver: true, seconds: 15, edit: newcomer });
  await later(ctx, 10_000);
  assert.ok(events(ctx.gladys, SCENE_TRIGGERS.OVERHEAD).every((e) => e.data.icao24 === 'f000aa'));
  assert.ok(events(ctx.gladys, SCENE_TRIGGERS.OVERHEAD).length > 0);
  assert.equal(requests(/adsb\.lol/).length, 1, 'adsb.lol is no longer read');
});

// --- OpenSky, with its written agreement ---------------------------------------------------------

test('OpenSky: anonymously, the daily credits set the pace', async () => {
  const ctx = await setup({ devices: [created], config: OPENSKY });
  const { gladys } = ctx;
  assert.equal(requests().length, 1);
  assert.deepEqual(requests()[0].params, {
    lamin: '49.97',
    lomin: '8.55',
    lamax: '50.15',
    lomax: '8.85',
  });
  assert.equal(gladys.fake.lastState(`${SKY}:closest_callsign`), 'TST101');
  assert.equal(
    status(gladys).message.en,
    'Watching 1 house with OpenSky anonymously: one reading every 7 min 15 s, about 199 credits a day. OpenSky reports 365 credits left.',
  );
  await later(ctx, 7 * MIN);
  assert.equal(requests().length, 1);
  ctx.sky.opensky = () => sample({ seconds: 435, edit: newcomerRow });
  await later(ctx, 15_000);
  assert.equal(requests().length, 2);
  const tight = events(gladys, SCENE_TRIGGERS.OVERHEAD).find(
    (e) => e.data.max_distance === '1' && e.data.max_altitude === '1000',
  );
  assert.equal(tight.data.country, 'Qatar');
  assert.equal(tight.data.registration, null);
  const widget = (await gladys.fake.widgetGet(WIDGETS.SKY, { settings: {} })).data.content;
  assert.match(
    widget.components.at(-1).text.en,
    /Data: The OpenSky Network \(opensky-network\.org\)/,
  );
});

test('OpenSky: credits used up, nothing until the time OpenSky announces; few left, every 30 minutes', async () => {
  const ctx = await setup({ devices: [created], config: OPENSKY });
  ctx.sky.status = 429;
  ctx.sky.headers = { 'x-rate-limit-retry-after-seconds': '7200' };
  await later(ctx, 8 * MIN);
  assert.equal(requests().length, 2);
  assert.equal(status(ctx.gladys).connected, false);
  assert.match(status(ctx.gladys).message.en, /credits are used up: next reading at 16:55/);
  await later(ctx, 60 * MIN);
  assert.equal(requests().length, 2, 'paused');
  const widget = (await ctx.gladys.fake.widgetGet(WIDGETS.SKY, { settings: {}, language: 'en' }))
    .data.content;
  assert.equal(widget.components.find((c) => c.type === 'status').items[0].value, 'until 16:55');
  ctx.sky.status = 200;
  ctx.sky.remaining = 12;
  await later(ctx, 61 * MIN);
  assert.equal(requests().length, 3);
  assert.equal(status(ctx.gladys).connected, true);
  assert.match(status(ctx.gladys).message.en, /Few OpenSky credits left \(12\)/);
  await later(ctx, 20 * MIN);
  assert.equal(requests().length, 3);
  await later(ctx, 11 * MIN);
  assert.equal(requests().length, 4);
});

test('OpenSky: an account reads every minute; a refused client stops everything', async () => {
  const config = { ...OPENSKY, client_id: 'me-api-client', client_secret: SECRET };
  const ctx = await setup({ devices: [created], config });
  assert.equal(requests()[0].init.headers.Authorization, 'Bearer token-1');
  assert.match(
    status(ctx.gladys).message.en,
    /with OpenSky and your account: one reading every 1 min/,
  );
  await later(ctx, MIN);
  assert.equal(requests().length, 2);
  // The API client is deleted on OpenSky: the token expires, the new one is refused.
  ctx.tokens.refuse = true;
  ctx.sky.status = 401;
  await later(ctx, MIN);
  assert.equal(status(ctx.gladys).connected, false);
  assert.match(status(ctx.gladys).message.en, /refused the API client/);
  const sent = fake.calls.length;
  await later(ctx, 10 * MIN);
  await ctx.app.start(config); // a reconnection to Gladys is not an answer
  assert.equal(fake.calls.length, sent, 'no request at all');
  // Saving the configuration is.
  ctx.tokens.refuse = false;
  ctx.sky.status = 200;
  await ctx.app.start(config, { saved: true });
  assert.equal(fake.calls.length, sent + 2);
  assert.equal(status(ctx.gladys).connected, true);
  // The secret never shows.
  const shown = JSON.stringify([ctx.gladys.fake.connectionStatus, ctx.gladys.fake.sceneEvents]);
  assert.ok(!shown.includes(SECRET));
});

test('active hours: nothing read at night, the widget says until when', async () => {
  const night = Date.UTC(2026, 9, 14, 3, 0);
  const ctx = await setup({
    devices: [created],
    config: { ...OPENSKY, active_from: 7, active_to: 23 },
    now: night,
  });
  assert.equal(requests().length, 0);
  assert.match(status(ctx.gladys).message.en, /Outside the active hours \(7:00 to 23:00\)/);
  const widget = (await ctx.gladys.fake.widgetGet(WIDGETS.SKY, { settings: {}, language: 'fr' }))
    .data.content;
  assert.match(widget.components[1].text.fr, /première lecture/);
  await later(ctx, 4 * 60 * MIN);
  assert.equal(requests().length, 1, '07:00: the first reading');
  assert.match(status(ctx.gladys).message.en, /one reading every 5 min, about 192 credits a day/);
});

test('OpenSky: never more than 90 % of the daily credits in 24 hours', async () => {
  const ctx = await setup({ devices: [created], config: OPENSKY });
  ctx.app.ledger.spend(359, ctx.clock.now);
  await later(ctx, 8 * MIN);
  assert.equal(requests().length, 1);
  assert.match(status(ctx.gladys).message.en, /360 OpenSky credits spent in the last 24 hours/);
  ctx.clock.now += MIN;
  const answer = await ctx.gladys.fake.sceneAction(SCENE_ACTIONS.GET_AIRCRAFT, { house: SKY });
  assert.equal(answer.data.outputs.age_seconds, 9 * 60, 'the last reading, with its age');
  assert.equal(requests().length, 1);
});
