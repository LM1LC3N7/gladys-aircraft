// -----------------------------------------------------------------------------
// The pure parts: a snapshot -> the aircraft around a house, geometry, pacing.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boundingBox,
  closestApproach,
  compassPoint,
  creditCost,
  distanceKm,
  headingArrow,
} from '../src/geo.js';
import { aircraftLine, altitudeOf, skyReading as read } from '../src/model.js';
import {
  CreditLedger,
  activeHours,
  isActive,
  localHour,
  readingInterval,
  spendLimit,
} from '../src/pacing.js';
import { snapshotOf } from '../src/sources/opensky.js';
import { FIXTURE_NOW, HOME, fixture, sample } from './helpers/fakeFetch.js';

/** The model reads snapshots: the OpenSky sample goes through its source parser. */
const skyReading = (answer, house, opts) => read(snapshotOf(answer), house, opts);

const options = {
  now: FIXTURE_NOW,
  radiusKm: 10,
  ignoreGround: true,
  altitudeSource: 'geometric',
};

test('the reading of a house: within the radius, recent, airborne, closest first', () => {
  const reading = skyReading(fixture('states-sample.json'), HOME, options);
  assert.equal(reading.at, FIXTURE_NOW);
  assert.equal(reading.time, 1791989237);
  assert.equal(reading.received, 9, 'the aircraft of the whole answer');
  // Out: the stale position (8 minutes old), the aircraft on the ground, the
  // one at 13 km (inside the box, outside the circle), the one with no position.
  assert.deepEqual(
    reading.aircraft.map((a) => a.icao24),
    ['f00001', 'f00005', 'f00002', 'f00009', 'f00006'],
  );
  assert.equal(reading.count, 5);
  const closest = reading.closest;
  assert.equal(closest.name, 'TST101');
  assert.equal(closest.distanceKm, 1.2);
  assert.equal(closest.bearing, 71);
  assert.equal(closest.altitude, 579, 'geometric first');
  assert.equal(closest.speedKmh, 278);
  assert.equal(closest.heading, 250);
  assert.equal(closest.verticalRate, -3.9);
  // Flying straight towards the house: overhead in 15 s, a little lower.
  assert.deepEqual(closest.approach, { distanceKm: 0, seconds: 15, altitude: 521 });
  assert.equal(reading.aircraft[1].name, 'F00005', 'no callsign: the transponder address');
  assert.equal(reading.aircraft[3].altitude, null, 'no altitude at all');
  assert.equal(reading.aircraft[4].emergency, true);
  assert.equal(aircraftLine(closest, 'fr'), 'TST101 · 1.2 km E · 579 m · 278 km/h ←');
  assert.equal(
    aircraftLine(reading.aircraft[4], 'en'),
    'TST606 · 8 km SW · 4618 m · 536 km/h ↖ · squawk 7700',
  );
});

test('the options: barometric altitude, aircraft on the ground, a smaller radius', () => {
  const baro = skyReading(fixture('states-sample.json'), HOME, {
    ...options,
    altitudeSource: 'barometric',
    ignoreGround: false,
    radiusKm: 9.5,
  });
  assert.equal(baro.closest.altitude, 389);
  const ground = baro.aircraft.find((a) => a.icao24 === 'f00003');
  assert.equal(ground.onGround, true);
  assert.equal(ground.altitude, null);
  assert.match(aircraftLine(ground, 'en'), /on ground/);
  assert.equal(
    skyReading(fixture('states-sample.json'), HOME, { ...options, radiusKm: 2 }).count,
    1,
  );
  assert.equal(altitudeOf({ geoAltitude: null, baroAltitude: -30.48 }, 'geometric'), -30);
  assert.equal(skyReading(fixture('states-empty.json'), HOME, options).closest, null);
});

test('geometry: distance, compass, arrows, closest approach', () => {
  assert.equal(Math.round(distanceKm(HOME, { latitude: 50.06, longitude: 8.8 })), 7);
  assert.equal(compassPoint(250, 'en'), 'W');
  assert.equal(compassPoint(250, 'fr'), 'O');
  assert.equal(compassPoint(-10, 'en'), 'N');
  assert.equal(headingArrow(90), '→');
  assert.equal(headingArrow(337), '↖');
  assert.equal(headingArrow(350), '↑');
  // Flying away: the closest is now.
  const away = closestApproach(
    HOME,
    { latitude: 50.08, longitude: 8.7 },
    { speed: 200, track: 0, seconds: 60 },
  );
  assert.equal(away.seconds, 0);
  // Crossing 1 km south of the house, eastbound at 100 m/s from 3 km west.
  const crossing = closestApproach(
    HOME,
    { latitude: 50.051, longitude: 8.658 },
    { speed: 100, track: 90, seconds: 60 },
  );
  assert.ok(crossing.seconds > 25 && crossing.seconds < 35, `${crossing.seconds} s`);
  assert.ok(Math.abs(crossing.distanceKm - 1) < 0.05, `${crossing.distanceKm} km`);
  // Unknown speed: no projection.
  assert.equal(closestApproach(HOME, HOME, { speed: null, track: 90, seconds: 60 }).distanceKm, 0);
});

test('the box asked to OpenSky: rounded outward, holding the circle, one credit', () => {
  const box = boundingBox(HOME, 10);
  assert.deepEqual(box, { lamin: 49.97, lamax: 50.15, lomin: 8.55, lomax: 8.85 });
  for (const bearing of [0, 90, 180, 270]) {
    const rad = (bearing * Math.PI) / 180;
    const edge = {
      latitude: HOME.latitude + (10 / 111.2) * Math.cos(rad),
      longitude:
        HOME.longitude + (10 / (111.2 * Math.cos((HOME.latitude * Math.PI) / 180))) * Math.sin(rad),
    };
    assert.ok(edge.latitude >= box.lamin && edge.latitude <= box.lamax, `${bearing}`);
    assert.ok(edge.longitude >= box.lomin && edge.longitude <= box.lomax, `${bearing}`);
  }
  assert.equal(creditCost(boundingBox({ latitude: 69, longitude: 18 }, 25)), 1);
  // The published table, at its edges.
  assert.equal(creditCost({ lamin: 0, lamax: 5, lomin: 0, lomax: 5 }), 1);
  assert.equal(creditCost({ lamin: 0, lamax: 5, lomin: 0, lomax: 5.2 }), 2);
  assert.equal(creditCost({ lamin: 0, lamax: 20, lomin: 0, lomax: 20 }), 3);
  assert.equal(creditCost({ lamin: -90, lamax: 90, lomin: -180, lomax: 180 }), 4);
  // Next to the antimeridian, the box stays valid.
  assert.equal(boundingBox({ latitude: -17.7, longitude: 179.99 }, 25).lomax, 180);
});

test('the pace of adsb.lol, adsb.fi and the receiver: automatic, or typed above a minimum', () => {
  assert.deepEqual(readingInterval({ source: 'adsblol', houses: 1 }), {
    interval: 30_000,
    floor: 15_000,
    perDay: 2880,
    low: false,
  });
  assert.equal(readingInterval({ source: 'adsbfi', houses: 2 }).perDay, 5760, 'one per house');
  assert.equal(readingInterval({ source: 'adsbfi', houses: 1, pollSeconds: 5 }).interval, 15_000);
  assert.equal(
    readingInterval({ source: 'adsblol', houses: 1, pollSeconds: 120 }).interval,
    120_000,
  );
  const receiver = readingInterval({ source: 'receiver', houses: 3, hours: 16 });
  assert.equal(receiver.interval, 10_000);
  assert.equal(receiver.perDay, 5760, 'one read for every house, 16 hours a day');
  assert.equal(readingInterval({ source: 'receiver', houses: 1, pollSeconds: 1 }).interval, 5_000);
});

test('the pace of OpenSky: the daily credits spread over the houses and the active hours', () => {
  const anonymous = readingInterval({ tier: 'anonymous', houses: 1 });
  assert.equal(anonymous.interval, 435_000, '200 readings a day: every 7 min 15 s');
  assert.equal(anonymous.perDay, 199);
  assert.equal(readingInterval({ tier: 'anonymous', houses: 2 }).interval, 870_000);
  assert.equal(readingInterval({ tier: 'anonymous', houses: 1, hours: 16 }).interval, 300_000);
  assert.equal(
    readingInterval({ tier: 'account', houses: 1 }).interval,
    60_000,
    'a minute at best',
  );
  assert.equal(readingInterval({ tier: 'account', houses: 3 }).interval, 90_000);
  assert.equal(
    readingInterval({ tier: 'anonymous', houses: 1, pollSeconds: 900 }).interval,
    900_000,
    'a longer interval typed by the user wins',
  );
  assert.equal(
    readingInterval({ tier: 'anonymous', houses: 1, pollSeconds: 60 }).interval,
    435_000,
    'a shorter one does not',
  );
  const low = readingInterval({ tier: 'anonymous', houses: 1, remaining: 15 });
  assert.equal(low.low, true);
  assert.equal(low.interval, 30 * 60_000);
  assert.equal(readingInterval({ tier: 'account', houses: 1, remaining: 300 }).low, false);
  assert.equal(spendLimit('anonymous'), 360);
});

test('active hours, in the time zone of Gladys', () => {
  assert.equal(isActive(3, 0, 24), true);
  assert.equal(isActive(6, 7, 23), false);
  assert.equal(isActive(7, 7, 23), true);
  assert.equal(isActive(23, 7, 23), false);
  assert.equal(isActive(23, 22, 6), true, 'through the night');
  assert.equal(isActive(12, 22, 6), false);
  assert.equal(isActive(12, 7, 7), true, 'the same hour twice: all day');
  assert.equal(activeHours(7, 23), 16);
  assert.equal(activeHours(22, 6), 8);
  assert.equal(activeHours(0, 24), 24);
  const noonUtc = Date.UTC(2026, 9, 14, 12, 0);
  assert.equal(localHour(noonUtc, 'UTC'), 12);
  assert.equal(localHour(noonUtc, 'Europe/Paris'), 14);
  assert.equal(localHour(noonUtc, 'Not/AZone'), 12, 'an unknown zone falls back on UTC');
});

test('the ledger counts the credits of the last 24 hours', () => {
  const ledger = new CreditLedger();
  ledger.spend(1, 0);
  ledger.spend(1, 3_600_000);
  assert.equal(ledger.spent(3_600_000), 2);
  assert.equal(ledger.spent(24 * 3_600_000 + 1), 1, 'the first one left the window');
});

test('an aircraft flown straight ahead by the test helper leaves the house behind', () => {
  const later = skyReading(sample({ seconds: 60 }), HOME, {
    ...options,
    now: FIXTURE_NOW + 60_000,
  });
  const tst101 = later.aircraft.find((a) => a.icao24 === 'f00001');
  assert.equal(tst101.distanceKm, 3.5);
  assert.equal(compassPoint(tst101.bearing, 'en'), 'W');
  assert.equal(tst101.approach.seconds, 0);
});
