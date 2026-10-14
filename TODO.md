# TODO

## Before announcing

- [ ] Test on a real Gladys 5.1+ with adsb.lol: discovery with a located
      house, the device states, the widget, the "aircraft overhead" trigger
      under a busy approach path, the test button.
- [ ] Test with a real receiver: tar1090 (`/tar1090/`), dump1090-fa /
      SkyAware (`:8080/`, `/skyaware/`), dump1090-mutability
      (`/dump1090/`), and a receiver whose decoder is stopped (stale).
- [ ] Tell adsb.lol about the integration: its API page says "if you want to
      use the API for production purposes, please contact me so I do not
      break your application by accident". The User-Agent names the
      repository.
- [ ] Reserve the module in the forum thread, then add the
      `gladys-assistant-integration` topic to publish in the store.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).

## To confirm

- [ ] adsb.lol API key: its README says one will be required "in the
      future" (obtained by feeding). When its OpenAPI document names a
      header, add an optional `api_key` secret field (sent only in that
      header, never logged).
- [ ] adsb.lol and adsb.fi: a real 429 (does `Retry-After` come with it?),
      the body of their 4xx answers, whether 30 s per house stays welcome
      ("rate limits are dynamic").
- [ ] adsb.fi: v3 answered on 2026-10-14 and v2 is "deprecated"; watch its
      README for the removal of v2 or a v4.
- [ ] Receivers: the `aircraft.json` of dump1090-mutability and of old
      dump1090-fa versions (keys, `now` in seconds), a receiver behind a
      reverse proxy that redirects http to https (reported, not followed:
      the user types the final address).
- [ ] A receiver without a database: no `r` / `t` (the variables are then
      empty); with tar1090's database: both present.
- [ ] OpenSky (only with its written agreement): a real 429 and its
      `X-Rate-Limit-Retry-After-Seconds`; when the anonymous daily bucket
      refills; `X-Rate-Limit-Remaining` with an account; the token
      endpoint's `expires_in`.
- [ ] `getHouses()` is granted with `location: true` on the install screen,
      and a house without coordinates is skipped quietly.
- [ ] The `distance-sensor` / `m` feature for the altitude renders well in
      the device widget (negative values near the ground).
- [ ] The TZ variable reaches the container (the active hours are local).

## Ideas

- The country of registration with the readsb sources, from the ICAO
  address blocks (readsb has no country; OpenSky's is its own lookup).
- The aircraft category (readsb `category`: A7 rotorcraft, B1 glider...):
  "helicopter overhead".
- One request for several houses close to each other (adsb.lol / adsb.fi:
  one point, a larger distance).
- The route of a flight (adsb.lol `POST /api/0/routeset`): origin and
  destination in the scene variables.
- Imperial units in the widget (`units: "us"`): feet, miles, knots.
- A link to the aircraft on the map of the source (globe.adsb.lol,
  globe.adsb.fi) in the scene action.
