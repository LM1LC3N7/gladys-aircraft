# gladys-aircraft

[Gladys Assistant](https://gladysassistant.com) external integration for
aircraft flying over your home (adsb.lol, adsb.fi, your own ADS-B receiver
or OpenSky): the closest flight, its altitude and heading, an "aircraft
overhead" scene trigger and a dashboard widget. **Unofficial, not affiliated
with adsb.lol, adsb.fi or the OpenSky Network.**

Data, depending on the source chosen in the configuration:

- **adsb.lol** (default): adsb.lol (ODbL 1.0), https://adsb.lol. Free, no
  account; production users are asked to get in touch.
- **adsb.fi**: adsb.fi, https://adsb.fi. Personal, non-commercial use only,
  1 request per second.
- **Your own receiver**: the `aircraft.json` of readsb, dump1090-fa or
  tar1090 on your network.
- **OpenSky Network**: The OpenSky Network, https://opensky-network.org.
  Only for users who hold OpenSky's written agreement: its
  [terms](https://opensky-network.org/about/terms-of-use) require one for any
  operational use in an automated system.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (AircraftApp)
                 ├─ src/sources/          one client per source, one plain state shape
                 │    ├─ aggregator.js    adsb.lol / adsb.fi: a point and a distance, 1.1 s apart
                 │    ├─ receiver.js      the aircraft.json of the user's receiver (LAN)
                 │    ├─ readsb.js        readsb JSON -> states (feet, knots -> metres, km/h)
                 │    └─ opensky.js       /states/all on a box, OAuth2 client credentials, credits
                 ├─ src/model.js          states -> aircraft around a house (pure)
                 ├─ src/geo.js            distance, bearing, point, box, closest approach (pure)
                 ├─ src/pacing.js         interval per source, OpenSky credits, active hours (pure)
                 ├─ src/devices.js        one device per located house, states (pure)
                 ├─ src/triggers.js       readings -> "aircraft overhead" / "emergency code" (pure)
                 └─ src/widget.js         the "sky" widget (pure)
```

- **Discovery** offers one device per located house of Gladys
  (`location: true`); only the houses whose device exists are read.
- **Reading**: adsb.lol / adsb.fi, one `GET .../lat/{lat}/lon/{lon}/dist/{nm}`
  per house every 30 s, the house rounded to 0.01°, requests at least 1.1 s
  apart; a receiver, one read of its `aircraft.json` every 10 s for all the
  houses; OpenSky, one `GET /api/states/all` per house on a box, paced on
  its daily credits. States go through `publishChangedStates`.
- **Triggers**: the core matches the fields by equality, so an aircraft
  fires one "aircraft overhead" event per (distance, altitude) pair it
  satisfies, once per passage; the first reading fires nothing.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npx github:GladysAssistant/integration-store .  # store admission checks
```

The fixtures in `test/fixtures/` are synthetic: one invented sky, written as
OpenSky state vectors, as adsb.lol / adsb.fi answers and as a receiver's
`aircraft.json`, shaped after real answers recorded on 2026-10-14. The terms
of the sources forbid redistributing their data (adsb.fi, OpenSky) or would
put a committed extract under share-alike (ODbL), so the repository holds no
real aircraft.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0.
