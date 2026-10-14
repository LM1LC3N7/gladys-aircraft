// -----------------------------------------------------------------------------
// The readsb sources against a fake fetch: the parser and its units, adsb.lol
// and adsb.fi (the point asked, the spacing, the 4xx and 429 rules) and the
// user's receiver (the URL typed, the shared read, a stuck decoder). The
// answers are synthetic, shaped after the real ones of 2026-10-14.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { receiverTarget } from '../src/config.js';
import { queryPoint } from '../src/geo.js';
import { skyReading } from '../src/model.js';
import { AggregatorClient, aggregatorUrl } from '../src/sources/aggregator.js';
import { retryAfterMs } from '../src/sources/common.js';
import { snapshotOf, stateOf } from '../src/sources/readsb.js';
import { ReceiverClient } from '../src/sources/receiver.js';
import {
  FIXTURE_NOW,
  FIXTURE_TIME,
  HOME,
  fixture,
  installFetch,
  json,
  readsbSample,
} from './helpers/fakeFetch.js';

let fake;
afterEach(() => fake?.restore());

const options = { now: FIXTURE_NOW, radiusKm: 10, ignoreGround: true, altitudeSource: 'geometric' };

/** A clock whose sleep moves it: the spacing shows in the dates of the calls. */
function fakeClock(now = FIXTURE_NOW) {
  const clock = { now, slept: [] };
  clock.sleep = async (ms) => {
    clock.slept.push(ms);
    clock.now += ms;
  };
  return clock;
}

test('readsb: feet, knots and feet per minute become metres, m/s and m/s', () => {
  const [emergency] = fixture('readsb-sample.json').ac;
  const state = stateOf(emergency);
  assert.equal(state.icao24, 'f00006');
  assert.equal(state.callsign, 'TST606', 'the 8-character padding is trimmed');
  assert.equal(state.registration, 'XX-TST6');
  assert.equal(state.aircraftType, 'B763');
  assert.equal(state.baroAltitude, 14300 * 0.3048);
  assert.equal(state.geoAltitude, 15150 * 0.3048);
  assert.equal(Math.round(state.velocity * 3.6), 535, '289.1 kn');
  assert.equal(Math.round(state.verticalRate * 100) / 100, 9.43, '1,856 ft/min');
  assert.equal(state.positionAge, 1);
  assert.equal(state.country, null, 'readsb has no country');
  const ground = stateOf({ hex: 'F0000A', alt_baro: 'ground', gs: 12.5, lat: 50, lon: 8 });
  assert.equal(ground.onGround, true);
  assert.equal(ground.baroAltitude, null);
  assert.equal(ground.icao24, 'f0000a');
  // The ADS-B emergency status stands for the code when no squawk is received.
  assert.equal(stateOf({ hex: 'f0000b', emergency: 'nordo' }).squawk, '7600');
  assert.equal(stateOf({ hex: 'f0000b', emergency: 'minfuel' }).squawk, null);
  assert.equal(stateOf({ hex: 'f0000b', squawk: '1000', emergency: 'general' }).squawk, '1000');
  assert.equal(stateOf({ flight: 'NOHEX' }), undefined, 'no address: not an aircraft');
});

test('readsb: the aggregators and the receivers answer the same sky', () => {
  const api = snapshotOf(readsbSample(), 'adsb.lol');
  const receiver = snapshotOf(readsbSample({ receiver: true }), 'receiver');
  assert.equal(api.time, FIXTURE_TIME, '`now` in milliseconds');
  assert.equal(receiver.time, FIXTURE_TIME + 0.4, '`now` in seconds');
  assert.equal(api.received, 9);
  const reading = skyReading(api, HOME, options);
  // Out: the stale position (488 s), the aircraft on the ground, the one at
  // 13 km, the one without a position.
  assert.deepEqual(
    reading.aircraft.map((a) => a.icao24),
    ['f00001', 'f00005', 'f00002', 'f00009', 'f00006'],
  );
  assert.deepEqual(
    skyReading(receiver, HOME, options).aircraft.map((a) => a.icao24),
    reading.aircraft.map((a) => a.icao24),
  );
  const closest = reading.closest;
  assert.equal(closest.name, 'TST101');
  assert.equal(closest.registration, 'XX-TST1');
  assert.equal(closest.aircraftType, 'A319');
  assert.equal(closest.distanceKm, 1.2);
  assert.equal(closest.altitude, 579, '1,900 ft');
  assert.equal(closest.speedKmh, 278, '150 kn');
  assert.deepEqual(snapshotOf(fixture('readsb-empty.json'), 'adsb.lol').states, []);
  assert.throws(
    () => snapshotOf('<html>tar1090</html>', 'receiver'),
    (err) => err.code === 'invalid',
  );
});

test('the point asked to adsb.lol / adsb.fi: rounded, the radius in whole nautical miles', () => {
  const house = { latitude: 50.0649, longitude: 8.6951 };
  assert.deepEqual(queryPoint(house, 10), { latitude: 50.06, longitude: 8.7, nm: 6 });
  // The circle asked for holds the circle around the house, rounding included.
  const { nm, ...point } = queryPoint(house, 25);
  assert.equal(nm, 14);
  assert.ok(nm * 1.852 >= 25 + 0.6);
  assert.equal(
    aggregatorUrl('adsblol', { ...point, nm }),
    'https://api.adsb.lol/v2/lat/50.06/lon/8.70/dist/14',
  );
  assert.equal(
    aggregatorUrl('adsbfi', { latitude: -33.87, longitude: 151.21, nm: 6 }),
    'https://opendata.adsb.fi/api/v3/lat/-33.87/lon/151.21/dist/6',
  );
});

test('adsb.lol: one request per house, 1.1 s apart, identified, no position in an error', async () => {
  const clock = fakeClock();
  fake = installFetch([[/api\.adsb\.lol\/v2\/lat\//, () => json(readsbSample())]], { clock });
  const client = new AggregatorClient({
    source: 'adsblol',
    now: () => clock.now,
    sleep: clock.sleep,
  });
  const snapshot = await client.read(HOME, { radiusKm: 10 });
  assert.equal(snapshot.received, 9);
  await client.read(HOME, { radiusKm: 10 });
  await client.read({ latitude: 48.85, longitude: 2.35 }, { radiusKm: 10 });
  assert.deepEqual(
    fake.calls.map((c) => c.at - FIXTURE_NOW),
    [0, 1100, 2200],
  );
  assert.match(
    fake.calls[0].init.headers['User-Agent'],
    /^gladys-aircraft\/\d+\.\d+\.\d+ \(\+https/,
  );
  assert.equal(fake.calls[0].url, 'https://api.adsb.lol/v2/lat/50.06/lon/8.70/dist/6');
  fake.restore();
  fake = installFetch([[/adsb\.lol/, () => json({ message: 'boom' }, { status: 502 })]]);
  await assert.rejects(client.read(HOME, { radiusKm: 10 }), (err) => {
    assert.equal(err.code, 'http');
    assert.equal(
      err.message,
      'HTTP 502 on api.adsb.lol',
      'the host only: the path holds the house',
    );
    return true;
  });
});

test('adsb.fi: a 4xx is final, a 429 announces its wait', async () => {
  const clock = fakeClock();
  let status = 403;
  let headers = {};
  fake = installFetch([
    [/opendata\.adsb\.fi\/api\/v3\//, () => json({ detail: 'nope' }, { status, headers })],
  ]);
  const client = new AggregatorClient({
    source: 'adsbfi',
    now: () => clock.now,
    sleep: clock.sleep,
  });
  await assert.rejects(client.read(HOME, { radiusKm: 10 }), (err) => {
    assert.equal(err.code, 'refused');
    assert.equal(err.final, true);
    assert.equal(err.status, 403);
    return true;
  });
  status = 429;
  headers = { 'retry-after': '120' };
  await assert.rejects(client.read(HOME, { radiusKm: 10 }), (err) => {
    assert.equal(err.code, 'rate_limited');
    assert.equal(err.final, false);
    assert.equal(err.retryAfterMs, 120_000);
    return true;
  });
  assert.deepEqual(clock.slept, [1100], 'errors count: the next request still waits');
  // An HTTP date (to the second).
  const at = Date.UTC(2026, 9, 14, 15, 0);
  const date = { get: () => new Date(at + 90_000).toUTCString() };
  assert.equal(retryAfterMs(date, at), 90_000, 'an HTTP date');
  assert.equal(retryAfterMs({ get: () => null }, FIXTURE_NOW), undefined);
});

test('the receiver URL: completed, http(s) only, the password moved to a header', () => {
  assert.deepEqual(receiverTarget(' http://192.168.1.30/tar1090/ '), {
    url: 'http://192.168.1.30/tar1090/data/aircraft.json',
    host: '192.168.1.30',
    where: '192.168.1.30/tar1090/data/aircraft.json',
    headers: {},
  });
  assert.equal(
    receiverTarget('192.168.1.30:8080').url,
    'http://192.168.1.30:8080/data/aircraft.json',
  );
  assert.equal(
    receiverTarget('http://pi.local/skyaware/data/aircraft.json').url,
    'http://pi.local/skyaware/data/aircraft.json',
  );
  const secured = receiverTarget('https://me:p%40ss@feeder.lan/tar1090/');
  assert.equal(secured.url, 'https://feeder.lan/tar1090/data/aircraft.json');
  assert.equal(secured.headers.Authorization, `Basic ${Buffer.from('me:p@ss').toString('base64')}`);
  assert.ok(!JSON.stringify([secured.url, secured.where]).includes('p@ss'));
  assert.deepEqual(receiverTarget(''), { error: 'missing' });
  assert.deepEqual(receiverTarget('ftp://192.168.1.30/aircraft.json'), { error: 'invalid' });
  assert.deepEqual(receiverTarget('http://'), { error: 'invalid' });
});

test('the receiver: one read, errors name the address, a stuck decoder is stale', async () => {
  const clock = { now: FIXTURE_NOW };
  let answer = () => json(readsbSample({ receiver: true }));
  fake = installFetch([[/192\.168\.1\.30/, () => answer()]]);
  const client = new ReceiverClient({
    target: receiverTarget('http://admin:secret@192.168.1.30/tar1090/'),
    now: () => clock.now,
  });
  assert.equal(client.shared, true);
  const snapshot = await client.read();
  assert.equal(snapshot.received, 9);
  assert.equal(fake.calls[0].init.headers.Authorization, 'Basic YWRtaW46c2VjcmV0');
  // The same file a minute later: fine; two minutes: the decoder stopped.
  clock.now += 60_000;
  await client.read();
  clock.now += 60_000;
  await assert.rejects(client.read(), (err) => err.code === 'stale' && err.minutes === 2);
  // It moves again.
  answer = () => json(readsbSample({ receiver: true, seconds: 130 }));
  assert.equal((await client.read()).received, 9);
  answer = () => json(undefined, { status: 404 });
  await assert.rejects(client.read(), (err) => {
    assert.equal(err.message, 'HTTP 404 on 192.168.1.30/tar1090/data/aircraft.json');
    assert.ok(!err.message.includes('secret'));
    return true;
  });
  answer = () => new Response('<html>lighttpd</html>', { status: 200 });
  await assert.rejects(client.read(), (err) => err.code === 'invalid');
  answer = () => new Response(null, { status: 302, headers: { location: 'https://x/' } });
  await assert.rejects(client.read(), (err) => err.status === 302, 'a redirect is not followed');
  // Not an aircraft.json either: an endless answer is abandoned past 8 MB.
  answer = () => new Response('x'.repeat(9 * 1024 * 1024));
  await assert.rejects(client.read(), (err) => err.code === 'network' && /8 MB/.test(err.message));
});
