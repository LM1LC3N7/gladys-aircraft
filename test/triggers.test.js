// -----------------------------------------------------------------------------
// Readings -> scene events: the first reading fires nothing, one event per
// (distance, altitude) pair and passage, one per emergency code.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_TRIGGERS } from '../src/constants.js';
import { skyReading } from '../src/model.js';
import { snapshotOf } from '../src/sources/opensky.js';
import { snapshotOf as readsbSnapshot } from '../src/sources/readsb.js';
import { satisfies, skyEvents } from '../src/triggers.js';
import { FIXTURE_NOW, HOME, readsbSample, sample } from './helpers/fakeFetch.js';

const DEVICE = 'ext:aircraft:sky:home';
const options = { radiusKm: 10, ignoreGround: true, altitudeSource: 'geometric' };

/** The sample `seconds` after the fixture, read `seconds` later. */
const readingAt = (seconds, edit) =>
  skyReading(snapshotOf(sample({ seconds, edit })), HOME, {
    ...options,
    now: FIXTURE_NOW + seconds * 1000,
  });

/** An extra aircraft heading straight over the house, 2 km east, at 900 m. */
const newcomer = (row) => {
  if (row[0] === 'f00007') {
    row[0] = 'f000aa';
    row[1] = 'NEW1    ';
    row[5] = 8.728; // 2 km east
    row[6] = 50.06;
    row[10] = 270; // westbound
    row[11] = 0;
    row[13] = 900;
  }
};

const overhead = (events) => events.filter((e) => e.key === SCENE_TRIGGERS.OVERHEAD);
const pairs = (events) =>
  overhead(events).map((e) => `${e.data.max_distance}|${e.data.max_altitude}`);

test('the first reading only records what is already overhead', () => {
  const { events, memory } = skyEvents(DEVICE, undefined, readingAt(0));
  assert.deepEqual(events, []);
  assert.equal(memory.passages.size, 5);
  assert.ok(memory.passages.get('f00001').fired.has('1|1000'), 'TST101, overhead in 15 s');
  // The emergency already on air is recorded, not announced.
  assert.ok(memory.passages.get('f00006').squawks.has('7700'));
});

test('a newcomer fires each pair it satisfies, once per passage', () => {
  const first = skyEvents(DEVICE, undefined, readingAt(0));
  const second = skyEvents(DEVICE, first.memory, readingAt(30, newcomer));
  const events = overhead(second.events);
  // TST202 (cruising, 1.1 km in 21 s at the first reading) and TST101 are known:
  // only the newcomer fires: 6 distances x 6 altitudes (1,000 m and up, any).
  assert.ok(events.every((e) => e.data.icao24 === 'f000aa'));
  assert.equal(events.length, 36);
  assert.ok(!pairs(events).includes('1|500'), 'at 900 m, not below 500 m');
  const tight = events.find((e) => e.data.max_distance === '1' && e.data.max_altitude === '1000');
  assert.deepEqual(tight.data, {
    house: DEVICE,
    callsign: 'NEW1',
    icao24: 'f000aa',
    registration: null,
    aircraft_type: null,
    country: 'Qatar',
    speed: 356,
    heading: 270,
    vertical_rate: 0,
    bearing: 90,
    direction: 'E',
    squawk: null,
    max_distance: '1',
    max_altitude: '1000',
    distance: 0,
    altitude: 900,
    eta_seconds: 20,
  });
  // The next reading: the same passage, nothing new to say.
  const third = skyEvents(DEVICE, second.memory, readingAt(60, newcomer));
  assert.deepEqual(pairs(third.events), []);
});

test('a pair satisfied later in the passage fires then, and only that one', () => {
  const first = skyEvents(
    DEVICE,
    undefined,
    readingAt(0, (row) => {
      if (row[0] === 'f00005') row[13] = 2500; // at 4.5 km, 2,500 m
    }),
  );
  const later = skyEvents(
    DEVICE,
    first.memory,
    readingAt(30, (row) => {
      if (row[0] === 'f00005') {
        row[13] = 1800; // descending below 2,000 m, still 4.5 km south
        [row[5], row[6]] = [8.7, 50.0195];
      }
    }),
  );
  assert.deepEqual(pairs(later.events).sort(), ['10|2000', '25|2000', '5|2000']);
});

test('a passage ends after 10 minutes out of sight', () => {
  // TST101 circles 1.2 km east of the house, out of sight now and then.
  const pinned = (row) => {
    if (row[0] === 'f00001') [row[5], row[6]] = [8.7155, 50.0635];
  };
  const gone = (row) => {
    if (row[0] === 'f00001') row[6] = null;
  };
  const first = skyEvents(DEVICE, undefined, readingAt(0));
  const away = skyEvents(DEVICE, first.memory, readingAt(30, gone));
  // Back 5 minutes later: the same passage.
  const back = skyEvents(DEVICE, away.memory, readingAt(300, pinned));
  assert.ok(!overhead(back.events).some((e) => e.data.icao24 === 'f00001'));
  // Gone again for 11 minutes: a new passage, announced again.
  const longAway = skyEvents(DEVICE, back.memory, readingAt(310, gone));
  const newPassage = skyEvents(DEVICE, longAway.memory, readingAt(310 + 11 * 60, pinned));
  assert.ok(overhead(newPassage.events).some((e) => e.data.icao24 === 'f00001'));
});

test('an aircraft seen at two readings far apart is still the same passage', () => {
  // Two houses anonymously: 15 minutes between two readings of a house.
  const first = skyEvents(DEVICE, undefined, readingAt(0));
  const next = skyEvents(
    DEVICE,
    first.memory,
    readingAt(15 * 60, (row) => {
      if (row[0] === 'f00001') {
        row[5] = 8.7;
        row[6] = 50.06;
      }
    }),
  );
  assert.ok(!next.events.some((e) => e.data.icao24 === 'f00001'));
});

test('emergency codes: once per aircraft, code and passage', () => {
  // F00005 keeps 4.5 km south of the house (pinned), its code changes.
  const squawk = (code) => (row) => {
    if (row[0] === 'f00005') {
      row[14] = code;
      [row[5], row[6]] = [8.7, 50.0195];
    }
  };
  const first = skyEvents(DEVICE, undefined, readingAt(0));
  const radio = skyEvents(DEVICE, first.memory, readingAt(30, squawk('7600')), { language: 'fr' });
  const emergencies = radio.events.filter((e) => e.key === SCENE_TRIGGERS.EMERGENCY);
  assert.equal(emergencies.length, 1);
  assert.equal(emergencies[0].data.squawk, '7600');
  assert.equal(emergencies[0].data.emergency, 'panne radio');
  assert.equal(emergencies[0].data.callsign, 'F00005');
  assert.equal(emergencies[0].data.direction, 'S');
  assert.equal(emergencies[0].data.distance, 4.5);
  const again = skyEvents(DEVICE, radio.memory, readingAt(60, squawk('7600')));
  assert.equal(again.events.filter((e) => e.key === SCENE_TRIGGERS.EMERGENCY).length, 0);
  const worse = skyEvents(DEVICE, again.memory, readingAt(90, squawk('7700')));
  const general = worse.events.filter((e) => e.key === SCENE_TRIGGERS.EMERGENCY);
  assert.deepEqual(
    general.map((e) => [e.data.squawk, e.data.emergency]),
    [['7700', 'general emergency']],
  );
});

test('satisfies: the distance and the altitude of the closest approach', () => {
  const aircraft = { onGround: false, approach: { distanceKm: 1.5, altitude: 1200 } };
  assert.equal(satisfies(aircraft, 1, 'any'), false);
  assert.equal(satisfies(aircraft, 2, 1000), false);
  assert.equal(satisfies(aircraft, 2, 2000), true);
  assert.equal(
    satisfies({ ...aircraft, approach: { distanceKm: 1, altitude: null } }, 2, 5000),
    false,
  );
  assert.equal(
    satisfies({ onGround: true, approach: { distanceKm: 1, altitude: null } }, 2, 500),
    true,
  );
});

test('with adsb.lol, adsb.fi or a receiver: the registration and the type, no country', () => {
  const at = (seconds, edit) =>
    skyReading(readsbSnapshot(readsbSample({ seconds, edit }), 'adsb.lol'), HOME, {
      ...options,
      now: FIXTURE_NOW + seconds * 1000,
    });
  // TST707 turned towards the house, 2 km east, level at 2,950 ft.
  const turn = (ac) => {
    if (ac.hex === 'f00007') {
      Object.assign(ac, { lat: 50.06, lon: 8.728, track: 270, alt_geom: 2950, baro_rate: 0 });
    }
  };
  const first = skyEvents(DEVICE, undefined, at(0));
  const { events } = skyEvents(DEVICE, first.memory, at(30, turn), { language: 'en' });
  const tight = events.find((e) => e.data.max_distance === '1' && e.data.max_altitude === '1000');
  assert.equal(tight.data.callsign, 'TST707');
  assert.equal(tight.data.registration, 'XX-TST7');
  assert.equal(tight.data.aircraft_type, 'A20N');
  assert.equal(tight.data.country, null);
  assert.equal(tight.data.altitude, 899, '2,950 ft');
  assert.equal(tight.data.speed, 356, '192.2 kn');
  assert.equal(tight.data.direction, 'E');
});
