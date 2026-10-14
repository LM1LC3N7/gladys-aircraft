// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACTIONS,
  ALTITUDE_SOURCES,
  ALTITUDE_THRESHOLDS,
  ANY_ALTITUDE,
  DEFAULT_SOURCE,
  DISTANCE_THRESHOLDS,
  EMERGENCY_SQUAWKS,
  LANGUAGES,
  PACE,
  RADIUS_KM,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  SOURCES,
  WIDGETS,
} from '../src/constants.js';
import { DEFAULTS, LIMITS } from '../src/config.js';
import { FEATURE, buildSkyDevice, parseExternalId } from '../src/devices.js';
import { skyReading } from '../src/model.js';
import { snapshotOf } from '../src/sources/readsb.js';
import { skyEvents } from '../src/triggers.js';
import { FIXTURE_NOW, HOME, readsbSample } from './helpers/fakeFetch.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const index = read('index.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics, the terms and the attribution of every source', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.name, 'Aircraft overhead');
  assert.equal(manifest.location, true, 'the aircraft are measured from the houses');
  assert.match(manifest.gladys_version, />=5\.1\.0/);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-aircraft:${manifest.version}`);
  assert.match(manifest.cover_image, /LM1LC3N7\/gladys-aircraft\/main\/cover\.png$/);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.equal(JSON.parse(read('package.json')).name, 'gladys-aircraft');
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.doesNotMatch(manifest.description[lang], /OpenSky/);
  }
  // adsb.lol: ODbL 1.0; adsb.fi: cited with a link to its home page; OpenSky:
  // named with its address, and only with its written agreement.
  const credits = [
    /adsb\.lol \(ODbL 1\.0\)/,
    /adsb\.fi.*https:\/\/adsb\.fi/,
    /The OpenSky Network, https:\/\/opensky-network\.org/,
  ];
  for (const file of ['docs/en.md', 'docs/fr.md', 'README.md']) {
    const text = read(file);
    assert.ok(text.length >= 300, `${file} is too short for the store`);
    for (const credit of credits) {
      assert.match(text, credit, `${file}: ${credit}`);
    }
  }
  assert.match(read('docs/en.md'), /written agreement/);
  assert.match(read('docs/fr.md'), /accord écrit/);
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /non officiel/);
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  const intro = fields.intro.description;
  assert.match(intro.en, /not affiliated with adsb\.lol, adsb\.fi or the OpenSky Network/);
  assert.match(intro.en, /Data: adsb\.lol, ODbL 1\.0/);
  assert.match(intro.en, /https:\/\/adsb\.fi/);
  assert.match(intro.en, /only with OpenSky's written agreement/);
  assert.match(intro.fr, /seulement avec l'accord écrit d'OpenSky/);
  assert.match(fields.account.description.en, /written agreement/);
  assert.match(fields.source.description.en, /written agreement/);
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    for (const lang of ['en', 'fr']) {
      assert.ok(section.description[lang].length <= 1000, `${section.key}.${lang} too long`);
    }
  }
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, key);
  }
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    assert.deepEqual([fields[key].min, fields[key].max], [min, max], key);
  }
  assert.deepEqual([fields.radius_km.min, fields.radius_km.max], [RADIUS_KM.min, RADIUS_KM.max]);
  assert.deepEqual(
    fields.language.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.deepEqual(
    fields.altitude.options.map((o) => o.value),
    ALTITUDE_SOURCES,
  );
  assert.deepEqual(
    fields.source.options.map((o) => o.value),
    SOURCES,
  );
  assert.equal(fields.source.default, DEFAULT_SOURCE);
  assert.equal(DEFAULT_SOURCE, 'adsblol');
  assert.equal(fields.receiver_url.type, 'string');
  assert.equal(fields.client_secret.type, 'secret');
  // The minimums the configuration promises are the ones the code applies.
  assert.match(
    fields.poll_seconds.description.en,
    new RegExp(`${PACE.adsblol.min / 1000} s for adsb`),
  );
  assert.match(
    fields.poll_seconds.description.en,
    new RegExp(`${PACE.receiver.min / 1000} s for a receiver`),
  );
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  assert.deepEqual(manifest.widgets.map((w) => w.key).sort(), Object.values(WIDGETS).sort());
  for (const name of Object.keys(SCENE_ACTIONS)) {
    assert.ok(index.includes(`onSceneAction(SCENE_ACTIONS.${name}`), name);
  }
  const triggers = Object.fromEntries(manifest.scene_triggers.map((t) => [t.key, t]));
  const options = (trigger, key) =>
    triggers[trigger].fields.find((f) => f.key === key).options.map((o) => o.value);
  assert.deepEqual(
    options(SCENE_TRIGGERS.OVERHEAD, 'max_distance'),
    DISTANCE_THRESHOLDS.map(String),
  );
  assert.deepEqual(options(SCENE_TRIGGERS.OVERHEAD, 'max_altitude'), [
    ...ALTITUDE_THRESHOLDS.map(String),
    ANY_ALTITUDE,
  ]);
  assert.deepEqual(options(SCENE_TRIGGERS.EMERGENCY, 'squawk'), EMERGENCY_SQUAWKS);
  // Equality matching: an empty distance or altitude would match every pair of
  // one passage, so both are required.
  for (const key of ['house', 'max_distance', 'max_altitude']) {
    assert.equal(
      triggers[SCENE_TRIGGERS.OVERHEAD].fields.find((f) => f.key === key).required,
      true,
    );
  }
});

test('the events carry every declared field and variable, within the core limits', () => {
  const squawk = (ac) => {
    if (ac.hex === 'f00005') ac.squawk = '7600';
    if (ac.hex === 'f00007') Object.assign(ac, { lat: 50.06, lon: 8.728, track: 270 });
  };
  const options = { radiusKm: 10, ignoreGround: true, altitudeSource: 'geometric' };
  const read = (answer, now) =>
    skyReading(snapshotOf(answer, 'adsb.lol'), HOME, { ...options, now });
  const first = skyEvents('ext:aircraft:sky:home', undefined, read(readsbSample(), FIXTURE_NOW));
  const { events } = skyEvents(
    'ext:aircraft:sky:home',
    first.memory,
    read(readsbSample({ seconds: 30, edit: squawk }), FIXTURE_NOW + 30_000),
  );
  for (const trigger of manifest.scene_triggers) {
    const event = events.find((e) => e.key === trigger.key);
    assert.ok(event, `no ${trigger.key} event`);
    const keys = [...trigger.fields, ...trigger.variables].map((f) => f.key);
    for (const key of keys) {
      assert.ok(key in event.data, `${trigger.key}: ${key} missing`);
    }
    assert.ok(Object.keys(event.data).length <= 30);
    for (const value of Object.values(event.data)) {
      assert.ok(value === null || ['string', 'number', 'boolean'].includes(typeof value));
    }
  }
});

test('feature keys and external ids are forever', () => {
  assert.deepEqual(FEATURE, {
    COUNT: 'count',
    CLOSEST_KM: 'closest_km',
    CLOSEST_ALTITUDE: 'closest_altitude',
    CLOSEST_CALLSIGN: 'closest_callsign',
  });
  const gladys = { externalId: (suffix) => `ext:aircraft:${suffix}` };
  const device = buildSkyDevice(gladys, { name: 'Home', selector: 'main-house' });
  assert.equal(device.external_id, 'ext:aircraft:sky:main-house');
  assert.deepEqual(parseExternalId(device.external_id), { houseSelector: 'main-house' });
  assert.equal(parseExternalId('ext:aircraft:other'), undefined);
  assert.deepEqual(SOURCES, ['adsblol', 'adsbfi', 'receiver', 'opensky']);
});
