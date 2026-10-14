# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15). It
turns the aircraft around each located house into a device, scene triggers
("aircraft overhead", "aircraft emergency code"), a scene action and a "sky"
widget. The aircraft come from one `source` of the configuration:
**adsb.lol** (default) or **adsb.fi** (community ADS-B aggregators, readsb
JSON around a point), the `aircraft.json` of the user's own **receiver** on
the LAN (readsb, dump1090-fa, tar1090), or the **OpenSky Network** (only for
users who hold its written agreement). Unofficial: not affiliated with
adsb.lol, adsb.fi or the OpenSky Network. Built first as `gladys-opensky`,
renamed before its first push when OpenSky's terms ruled it out as a default.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js                  SDK wiring only (handlers registered before connect())
src/app.js                AircraftApp: houses, discovery, source client, paced
                          loop, readings, events, scene action, widget, test
                          button, status
src/sources/index.js      createClient (the configured source), sourceName,
                          ATTRIBUTION (the credit each source asks for)
src/sources/aggregator.js adsb.lol / adsb.fi: the point URL, the 1.1 s spacing,
                          4xx = stop, 429 = pause
src/sources/receiver.js   the user's receiver: one read for every house, stale
                          detection
src/sources/readsb.js     readsb JSON -> plain states; every readsb field name
                          and unit lives here (pure)
src/sources/opensky.js    /states/all on a box, OAuth2 client credentials,
                          credits headers; every OpenSky column (`stateOf`)
src/sources/common.js     SourceError, transport errors, Retry-After (pure)
src/model.js              plain states -> aircraft around a house (pure)
src/geo.js                distance, bearing, compass, the point asked to the
                          aggregators, the OpenSky box + credit cost, closest
                          approach (pure)
src/pacing.js             interval per source, OpenSky credits, active hours,
                          CreditLedger (pure)
src/devices.js            the house device, feature keys, states (pure)
src/triggers.js           readings -> scene events, passages (pure)
src/widget.js             the "sky" widget (pure)
src/config.js             config_schema normalized (DEFAULTS, LIMITS), the
                          receiver URL, the fingerprints
src/constants.js          sources, endpoints, pacing, credits, units,
                          thresholds, manifest keys
src/i18n.js               runtime texts (en/fr)
src/http.js               the only network access (fetch, timeout, size cap,
                          no redirect followed, headers kept)
test/fixtures/            SYNTHETIC answers of every source shaped after real ones
test/helpers/             fake fetch (+ samples flown ahead), fake timers;
                          Gladys is the SDK's fake
```

## Rules

- **Unofficial.** Every user-facing surface says "unofficial connector, not
  affiliated with adsb.lol, adsb.fi or the OpenSky Network". Never use a logo
  of any of them.
- **Attribution and terms** (read on 2026-10-14; `ATTRIBUTION` in
  `src/sources/index.js`, the widget caption names the source in use,
  `test/manifest.test.js` checks the docs, the README and the intro):
  - adsb.lol: data under the ODbL 1.0, "Data: adsb.lol (ODbL 1.0)"; free,
    no key today; its API page asks production users to get in touch.
  - adsb.fi: "personal, non-commercial use only", "you must cite adsb.fi and
    include a link to our home page": "adsb.fi (https://adsb.fi)".
  - OpenSky: "Data: The OpenSky Network, https://opensky-network.org". Its
    terms reserve the REST API for non-profit research and education and
    require a written license for any "operational" use "in a live product,
    service, or automated system": a Gladys integration is one. OpenSky is
    therefore never the default, and the docs, the config section and the
    source option say "only with OpenSky's written agreement".
- **Keys are forever**: the manifest keys (`src/constants.js`), the source
  values (`SOURCES`: `adsblol`, `adsbfi`, `receiver`, `opensky`), the config
  keys, the trigger thresholds (`DISTANCE_THRESHOLDS`, `ALTITUDE_THRESHOLDS`,
  `any`), the event variables, the action outputs, the feature keys
  (`FEATURE` in `src/devices.js`) and the external id shape
  `sky:<houseSelector>` are stored in user configurations, scenes and
  dashboards. Never rename them.
- **Be polite with every source** (`PACE`, `src/pacing.js`):
  - only the houses whose device exists are read; a 5 s tick decides, most
    ticks send nothing; the attempt dates a house (a failing house is
    retried at the same pace), kept across reconnections of the same
    process; outside the active hours nothing is read;
  - adsb.lol / adsb.fi: one request per house every 30 s (`poll_seconds` 0),
    never below 15 s; every request of the client (readings, scene action,
    test button) at least 1.1 s after the previous one (`AGGREGATOR_SPACING`:
    adsb.fi allows 1 per second and counts the errors); a 429 pauses the
    source for `Retry-After` (seconds or a date), 5 minutes without it; any
    other 4xx ("if you get 4xx errors, you are doing something wrong")
    stops it until the configuration is saved, never on a reconnection nor
    with the test button; identified by the User-Agent;
  - the receiver: one read of its `aircraft.json` for every house every 10 s
    (5 s at least); no terms, no quota, the distance filter is local;
  - OpenSky, unchanged since the first build: /states/\* has its own daily
    bucket, 400 credits anonymously (per IP address), 4,000 with an account;
    the interval spreads `CREDIT_SHARE` of them (half anonymously, three
    quarters with an account) over the active hours and the houses, rounded
    up to 15 s, never below 60 s (one house anonymously: 7 min 15 s); below
    5 % left (`X-Rate-Limit-Remaining`) every 30 minutes; a 429 waits
    `X-Rate-Limit-Retry-After-Seconds` (an hour without it); never more than
    90 % of the daily credits over a rolling 24 hours (`CreditLedger`); a
    refused API client sends nothing until the configuration is saved or the
    test button is pressed;
  - the scene action reuses a reading younger than the interval (a minute at
    most).
- **Secrets**: the OpenSky client secret goes only in the form body to the
  token endpoint, the token only in the `Authorization` header. A password
  typed in the receiver URL becomes a Basic `Authorization` header to that
  receiver. None of them ever reaches a URL, a log line, an error or a
  status: errors carry a label (the host, or the receiver's host and path),
  never the query string.
- **The house position stays in Gladys**: adsb.lol and adsb.fi get the house
  rounded to 0.01 degree and a radius in whole nautical miles widened by the
  rounding (`queryPoint`); OpenSky a box rounded outward to 0.01 degree; the
  receiver nothing. The aggregator path holds the rounded position, so their
  errors name the host only. Coordinates are never logged.
- **The receiver URL** (`receiverTarget`): http and https only, private
  addresses allowed (it is the point); a URL not ending in `.json` gets
  `/data/aircraft.json`; redirects are reported, not followed; answers past
  8 MB are abandoned. A receiver whose `now` has not moved for 2 minutes of
  our clock is stale (a stopped decoder behind a still-running web server):
  reported, its aircraft not used.
- **Units**: readsb speaks feet, knots and ft/min; `src/sources/readsb.js`
  converts to metres and m/s (the model shows km/h). The ADS-B `emergency`
  status `general` / `nordo` / `unlawful` stands for 7700 / 7600 / 7500 when
  no squawk is received.
- **One event per transition** (`src/triggers.js`): the core matches fields
  by equality, so an aircraft fires one `aircraft_overhead` event per
  (distance, altitude) pair it satisfies, the first time in its passage
  (both fields required, "any altitude" is a value); the same icao24 in the
  previous reading, or seen again within 10 minutes, is the same passage.
  `emergency_squawk` fires once per aircraft, code and passage. The first
  reading of a house fires nothing; a change of source keeps the passages
  (the same transponder seen through another source is not new). At most
  `MAX_EVENTS_PER_READING` per house and reading, emergencies first. No
  event from the scene action or the test button (no scene loop): the next
  paced reading announces.
- **Looking ahead**: between two readings an airliner can cross a 10 km
  circle unseen, so "overhead" uses the closest approach of the next
  `LOOKAHEAD_SECONDS` (60) along the current track and speed; the states
  stay what was observed.
- **Read-only rootfs**: write nothing on disk; the token, the ledger and the
  passages live in memory.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag
  (the User-Agent reads `package.json`).
- **Changelog**: every user-visible change adds a line under
  `## [Unreleased]` in `CHANGELOG.md`.
- **Manifest texts** are `{ en, fr }` objects; the catalog description holds
  10 to 100 characters per language; `test/manifest.test.js` ties the
  manifest to the code (keys, defaults, bounds, sources, trigger options,
  the fields and variables against the events the code fires).
- **User-facing text** is bilingual, `docs/en.md` and `docs/fr.md` kept in
  sync. Comments explain why, in English.
- **Tests never touch the network** (`installFetch` replaces `fetch`).

## Choices made where the spec left room

- **adsb.fi v3, not v2**: its README (2026-10-14) marks
  `/v2/lat/{lat}/lon/{lon}/dist/{nm}` deprecated ("returned data in a
  different format", indeed the `aircraft` / seconds shape of a receiver)
  and asks new integrations to use `/api/v3/...`, which answers the `ac` /
  milliseconds shape of adsb.lol. The parser reads both shapes anyway.
- **No `api_key` field**: adsb.lol's OpenAPI document declares no security
  scheme and no key header today; a TODO line waits for one.
- **`poll_seconds` 0 = automatic** for every source (30 s, 10 s, or the
  OpenSky credits), a typed value raised to the source's minimum: one field
  instead of one per source, and the existing OpenSky meaning kept.
- **The test button does not retry a stopped aggregator** (the spec: "until
  the config is saved"); with OpenSky it still gives a refused client one
  more chance, as before.
- **A new source reads at once** and resets the pause, the stop and the
  ledger; the passages are kept (no second announcement of the same
  aircraft).
- **`transports: ["cloud"]`**: declaring `local` too would add Gladys's
  "prefer local connection" toggle, which means nothing here; the receiver
  is a source choice.
- **`country` is null with readsb sources** (they have none); `registration`
  and `aircraft_type` were added to both triggers, the scene action
  (`closest_registration`, `closest_type`) and the widget.
- **The tick went from 15 s to 5 s** so the receiver can be read every 5 to
  10 s; a tick still sends nothing unless a house is due.

## CI and pushes

- Group the commits and push **at most once a day**, unless the maintainer
  explicitly asks otherwise: the GitHub Actions quota is limited.
- If every CI job fails in under 2 seconds, the quota is exhausted: it is
  not a bug in the code.
- The Docker image cannot be built in the Claude Code cloud container (no
  network for `apk` inside `docker build`): the CI builds it.

## The sources, as measured on 2026-10-14

- **adsb.lol** `GET https://api.adsb.lol/v2/lat/50.06/lon/8.7/dist/14`: 200,
  `{ "ac": [...], "msg": "No error", "now": 1791992593000, "total": 19,
"ctime": ..., "ptime": 0 }` (`now` in ms), `cache-control: no-store`, no
  rate limit header. Its OpenAPI (`https://api.adsb.lol/api/openapi.json`,
  the `/docs` page answered 503) declares the radius an integer 0-250 (nm),
  a 422 for a bad parameter, no security scheme.
- **adsb.fi** `GET https://opendata.adsb.fi/api/v3/lat/50.06/lon/8.7/dist/14`:
  the same `ac` shape as adsb.lol (+ `desc`, `ownOp`, `year`, `calc_track`);
  `/api/v2/...` answered `{ "now": 1791992594.001, "aircraft": [...],
"resultCount": 18 }` (seconds, `aircraft`). Behind Cloudflare, no rate
  limit header on a 200.
- Both: `alt_baro` "ground" on the ground, `emergency` "none" or absent,
  mlat aircraft without `alt_geom` nor `category`, ground aircraft with
  `seen_pos` near 30 s, `dst` / `dir` relative to the point asked (unused:
  distances are computed from the exact house).
- **Receivers: built blind** (no receiver at hand). The shape follows
  readsb's `README-json.md` (raw.githubusercontent.com/wiedehopf/readsb):
  `now` in seconds, `aircraft`, keys omitted when unknown, positions older
  than 60 s no longer valid. `TODO.md` lists what to confirm.
- **OpenSky** (first build): `{ "time", "states": [[17 columns]] }`,
  `"states": null` for an empty sky, callsigns padded to 8 characters,
  `x-rate-limit-remaining` not monotonic, a bad token a 401 with an empty
  body, a bad API client the Keycloak `invalid_client` JSON. A real account
  and a real 429 were not seen.
- Not checked: a real 429 of adsb.lol or adsb.fi (whether `Retry-After`
  comes with it), their 4xx bodies.

## The fixtures: synthetic, and it stays that way

One invented sky around a test house at 50.06, 8.70 (fake addresses
`f0000x`, callsigns `TST...`, registrations `XX-TST...`), written three
ways: `states-sample.json` (OpenSky state vectors), `readsb-sample.json`
(adsb.lol / adsb.fi `ac`, `now` in ms) and `receiver-sample.json` (a
receiver's `aircraft`, `now` in s), the readsb ones derived from the OpenSky
one in readsb units (feet, knots, ft/min, multiples of 64 ft/min) with the
oddities of the real answers (stale position, "ground", negative and
missing altitudes, an mlat aircraft, a 7700 squawk with `emergency:
"general"`, no callsign, no position). Never commit a real answer: OpenSky
and adsb.fi forbid redistributing their data, and an extract of adsb.lol's
would fall under the ODbL's share-alike. To check a field, capture into a
scratch directory outside the repository, a handful of requests over a
second apart:

```bash
UA='gladys-aircraft/dev (+https://github.com/LM1LC3N7/gladys-aircraft)'
curl -sA "$UA" 'https://api.adsb.lol/v2/lat/50.06/lon/8.7/dist/14' -o /tmp/lol.json
sleep 2
curl -sA "$UA" 'https://opendata.adsb.fi/api/v3/lat/50.06/lon/8.7/dist/14' -o /tmp/fi.json
```

`FIXTURE_NOW` in `test/helpers/fakeFetch.js` is the time of the samples
plus 1.5 s; `sample()` (OpenSky) and `readsbSample()` fly every airborne
aircraft straight ahead, and the expected distances of the tests follow.
