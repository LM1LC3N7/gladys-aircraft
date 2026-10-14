// -----------------------------------------------------------------------------
// The OpenSky source (kept for the users who hold OpenSky's written
// agreement) against a fake fetch: the state vectors, anonymous and account
// requests, the token, the credits headers, the errors. The error answers are
// shaped after real ones (2026-10-14): a 401 with an empty body on a bad
// token, the Keycloak `invalid_client` JSON on a bad API client.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { SourceError } from '../src/sources/common.js';
import { OpenSkyClient, snapshotOf, stateOf } from '../src/sources/opensky.js';
import { FIXTURE_NOW, HOME, fixture, installFetch, json } from './helpers/fakeFetch.js';

const BOX = { lamin: 49.97, lamax: 50.15, lomin: 8.55, lomax: 8.85 };
const SECRET = 'the-very-secret-value';

let fake;
afterEach(() => fake?.restore());

const tokenRoute = (counter = { n: 0 }) => [
  /openid-connect\/token$/,
  () => {
    counter.n += 1;
    return json({ access_token: `token-${counter.n}`, expires_in: 1800, token_type: 'Bearer' });
  },
];

test('a state vector: the documented columns, trimmed, nulls kept', () => {
  const [emergency] = fixture('states-sample.json').states;
  const state = stateOf(emergency, 1791989237);
  assert.equal(state.icao24, 'f00006');
  assert.equal(state.callsign, 'TST606', 'the 8-character padding is trimmed');
  assert.equal(state.country, 'United Kingdom');
  assert.equal(state.baroAltitude, 4358.64);
  assert.equal(state.geoAltitude, 4617.72);
  assert.equal(state.squawk, '7700');
  assert.equal(state.onGround, false);
  assert.equal(state.positionAge, 1);
  assert.equal(state.registration, null, 'not in the state vectors');
  const noCallsign = stateOf(fixture('states-sample.json').states[5]);
  assert.equal(noCallsign.callsign, null);
  assert.equal(noCallsign.squawk, null);
  assert.equal(noCallsign.positionAge, null, 'no answer time: no age');
  assert.equal(stateOf([42, 'TST']), undefined, 'no icao24: not an aircraft');
  assert.equal(stateOf(null), undefined);
  // An empty sky is `"states": null`, as OpenSky answers it.
  assert.deepEqual(snapshotOf(fixture('states-empty.json')), {
    time: 1791989258,
    states: [],
    received: 0,
  });
});

test('anonymous: the box in the query, no credential, the credits left kept', async () => {
  fake = installFetch([
    [/\/api\/states\/all\?/, () => json(fixture('states-sample.json'), { remaining: 365 })],
  ]);
  const client = new OpenSkyClient();
  const snapshot = await client.read(HOME, { radiusKm: 10 });
  assert.equal(snapshot.received, 9);
  assert.equal(client.cost(HOME, { radiusKm: 25 }), 1);
  const call = fake.calls[0];
  assert.deepEqual(call.params, { lamin: '49.97', lomin: '8.55', lamax: '50.15', lomax: '8.85' });
  assert.equal(call.init.headers.Authorization, undefined);
  assert.match(call.init.headers['User-Agent'], /^gladys-aircraft\//);
  assert.equal(client.remaining, 365);
  assert.equal(client.tier, 'anonymous');
});

test('account: one token for 30 minutes, sent as a bearer, renewed before it expires', async () => {
  const tokens = { n: 0 };
  const clock = { now: FIXTURE_NOW };
  fake = installFetch([
    tokenRoute(tokens),
    [/\/api\/states\/all\?/, () => json(fixture('states-empty.json'), { remaining: 3999 })],
  ]);
  const client = new OpenSkyClient({
    clientId: 'me-api-client',
    clientSecret: SECRET,
    now: () => clock.now,
  });
  assert.equal(client.tier, 'account');
  await client.states(BOX);
  await client.states(BOX);
  assert.equal(tokens.n, 1, 'the token is reused');
  const [tokenCall, statesCall] = fake.calls;
  assert.equal(tokenCall.init.method, 'POST');
  assert.equal(tokenCall.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(tokenCall.init.body)), {
    grant_type: 'client_credentials',
    client_id: 'me-api-client',
    client_secret: SECRET,
  });
  assert.equal(statesCall.init.headers.Authorization, 'Bearer token-1');
  assert.ok(!statesCall.url.includes(SECRET));
  clock.now += 29 * 60_000; // within the last minute of the token
  await client.states(BOX);
  assert.equal(tokens.n, 2);
  assert.equal(fake.calls.at(-1).init.headers.Authorization, 'Bearer token-2');
});

test('account: a 401 gets one new token and one retry, then gives up', async () => {
  const tokens = { n: 0 };
  let refuse = 1;
  fake = installFetch([
    tokenRoute(tokens),
    [
      /\/api\/states\/all\?/,
      () => (refuse-- > 0 ? json(undefined, { status: 401 }) : json(fixture('states-empty.json'))),
    ],
  ]);
  const client = new OpenSkyClient({ clientId: 'id', clientSecret: SECRET });
  await client.states(BOX);
  assert.equal(tokens.n, 2);
  refuse = 5;
  await assert.rejects(client.states(BOX), (err) => err.code === 'unauthorized');
});

test('a refused API client is final and never carries the secret', async () => {
  fake = installFetch([
    [
      /openid-connect\/token$/,
      () =>
        json(
          {
            error: 'invalid_client',
            error_description: 'Invalid client or Invalid client credentials',
          },
          { status: 401 },
        ),
    ],
  ]);
  const client = new OpenSkyClient({ clientId: 'id', clientSecret: SECRET });
  await assert.rejects(client.states(BOX), (err) => {
    assert.ok(err instanceof SourceError);
    assert.equal(err.code, 'unauthorized');
    assert.equal(err.final, true);
    assert.ok(!JSON.stringify({ message: err.message, stack: err.stack }).includes(SECRET));
    return true;
  });
  assert.equal(fake.calls.length, 1, 'no states request without a token');
});

test('credits used up: a 429 with the wait OpenSky announces', async () => {
  fake = installFetch([
    [
      /\/api\/states\/all\?/,
      () =>
        json(undefined, {
          status: 429,
          headers: { 'x-rate-limit-retry-after-seconds': '3600' },
        }),
    ],
  ]);
  const client = new OpenSkyClient();
  client.remaining = 3;
  await assert.rejects(client.states(BOX), (err) => {
    assert.equal(err.code, 'rate_limited');
    assert.equal(err.retryAfterMs, 3_600_000);
    return true;
  });
  assert.equal(client.remaining, 0);
});

test('network failures and other statuses', async () => {
  fake = installFetch([
    [
      /\/api\/states\/all\?/,
      () => {
        throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
      },
    ],
  ]);
  const client = new OpenSkyClient();
  await assert.rejects(client.states(BOX), (err) => err.code === 'timeout');
  fake.restore();
  fake = installFetch([[/\/api\/states\/all\?/, () => json({ message: 'boom' }, { status: 503 })]]);
  await assert.rejects(client.states(BOX), (err) => {
    assert.equal(err.code, 'http');
    assert.equal(err.message, 'HTTP 503 on /api/states/all', 'the path only, never the box');
    return true;
  });
});
