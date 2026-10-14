// -----------------------------------------------------------------------------
// The "sky" widget: valid content in every state, the attribution of the
// source in use always.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { skyReading } from '../src/model.js';
import { ATTRIBUTION } from '../src/sources/index.js';
import { snapshotOf } from '../src/sources/opensky.js';
import { snapshotOf as readsbSnapshot } from '../src/sources/readsb.js';
import { skyWidget } from '../src/widget.js';
import { FIXTURE_NOW, HOME, fixture } from './helpers/fakeFetch.js';

const options = { now: FIXTURE_NOW, radiusKm: 10, ignoreGround: true, altitudeSource: 'geometric' };
const reading = skyReading(snapshotOf(fixture('states-sample.json')), HOME, options);
const statusOf = (content) => content.components.find((c) => c.type === 'status');

test('aircraft around the house: tiles, the emergency first, then the closest ones', () => {
  const content = skyWidget({
    name: 'Aircraft over Home',
    reading,
    radiusKm: 10,
    language: 'en',
    clock: '14:47',
    attribution: ATTRIBUTION.opensky,
  });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].text, 'Aircraft over Home');
  const tiles = content.components.filter((c) => c.type === 'value');
  assert.deepEqual(
    tiles.map((t) => [t.value, t.unit]),
    [
      [5, undefined],
      [1.2, 'km'],
      [579, 'm'],
    ],
  );
  const items = statusOf(content).items;
  assert.equal(items.length, 5);
  assert.deepEqual(items[0], {
    label: 'TST606 · 7700',
    value: '8 km SW · 4618 m · 536 km/h ↖',
    icon: 'alert-triangle',
    color: 'danger',
  });
  assert.equal(items[1].label, 'TST101');
  assert.equal(items[1].value, '1.2 km E · 579 m · 278 km/h ←');
  assert.equal(items[1].color, 'primary');
  const caption = content.components.at(-1);
  assert.equal(caption.variant, 'caption');
  assert.match(caption.text.en, /^14:47 · Data: The OpenSky Network \(opensky-network\.org\)/);
  assert.match(caption.text.fr, /non officiel/);
  assert.ok(caption.text.fr.length <= 80);
});

test('clear sky, paused readings, no reading yet', () => {
  const clear = skyWidget({
    name: 'Aircraft over Home',
    reading: skyReading(snapshotOf(fixture('states-empty.json')), HOME, options),
    radiusKm: 10,
    language: 'fr',
    paused: { until: '07:00' },
    clock: '03:00',
  });
  assert.deepEqual(validateWidgetContent(clear), []);
  const items = statusOf(clear).items;
  assert.deepEqual(
    items.map((i) => [i.label, i.value]),
    [
      ['Lectures en pause', "jusqu'à 07:00"],
      ['Ciel', 'Ciel dégagé dans un rayon de 10 km'],
    ],
  );
  assert.equal(clear.components.find((c) => c.type === 'value' && c.icon === 'target').value, '—');
  const waiting = skyWidget({ name: 'Aircraft over Home', reading: undefined, language: 'fr' });
  assert.deepEqual(validateWidgetContent(waiting), []);
  assert.match(waiting.components[1].text.fr, /première lecture/);
});

test('the type of each aircraft, and the credit every source asks for', () => {
  const readsb = skyReading(
    readsbSnapshot(fixture('readsb-sample.json'), 'adsb.lol'),
    HOME,
    options,
  );
  const content = skyWidget({
    name: 'Aircraft over Home',
    reading: readsb,
    radiusKm: 10,
    language: 'fr',
    clock: '14:47',
    attribution: ATTRIBUTION.adsblol,
  });
  assert.deepEqual(validateWidgetContent(content), []);
  const items = statusOf(content).items;
  assert.equal(items[0].label, 'TST606 B763 · 7700');
  assert.equal(items[1].label, 'TST101 A319');
  assert.equal(items[4].label, 'TST909', 'no type known');
  assert.equal(
    content.components.at(-1).text.fr,
    '14:47 · Données : adsb.lol (ODbL 1.0) · non officiel',
  );
  for (const [source, attribution] of Object.entries(ATTRIBUTION)) {
    const caption = skyWidget({ reading: readsb, clock: '14:47', attribution }).components.at(-1);
    for (const lang of ['en', 'fr']) {
      assert.ok(caption.text[lang].length <= 80, `${source}.${lang}: ${caption.text[lang]}`);
    }
  }
  assert.match(ATTRIBUTION.adsbfi.en, /https:\/\/adsb\.fi/, 'adsb.fi: cited with a link');
});
