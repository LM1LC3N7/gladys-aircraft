# Aircraft overhead

**Unofficial connector, not affiliated with adsb.lol, adsb.fi or the OpenSky
Network.** It shows in Gladys the aircraft flying over your house: their
transponders broadcast their position (ADS-B), and networks of receivers run
by volunteers collect it. You choose where the aircraft come from:

| Source                         | What it is                                                                                     | Terms                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **adsb.lol** (default)         | A free, open community network. No account.                                                    | Open data under the ODbL 1.0. Data: adsb.lol (ODbL 1.0), https://adsb.lol                 |
| **adsb.fi**                    | Another community network. No account.                                                         | Personal, non-commercial use only. Data: adsb.fi, https://adsb.fi                         |
| **Your own ADS-B receiver**    | A Raspberry Pi with readsb, dump1090-fa or tar1090 on your network. Nothing leaves your house. | Yours.                                                                                    |
| **OpenSky Network** (optional) | The research network. Only if OpenSky granted you its written agreement (see below).           | Non-profit research and education. Data: The OpenSky Network, https://opensky-network.org |

Never resell or republish the data.

## What you get

| Surface                      | Content                                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One device per located house | **Aircraft over _house_**: aircraft within the radius, distance of the closest one (km), its altitude (m), its flight (callsign)                                           |
| Scene triggers               | **Aircraft overhead** (within a distance, below an altitude, once per passage), **aircraft emergency code** (7500, 7600, 7700)                                             |
| Scene action                 | **Aircraft over a house**: the count, the list, the closest flight with its registration, type, distance, altitude, speed, heading and where to look                       |
| Dashboard widget             | **Aircraft overhead**: the count, the closest distance and altitude, the closest aircraft (flight and type, where to look, altitude, speed, heading arrow), or "clear sky" |

## Setup

1. Set the location of your house in Gladys (**Settings → Houses**), then
   install the integration and accept the location access.
2. Choose the **source** (adsb.lol by default: nothing else to do).
3. Open **Discovery** and add **Aircraft over _house_**. Nothing is read
   before a device exists.
4. Put the **Aircraft overhead** widget on a dashboard and pick the house.

Options: the **radius** (1 to 25 km, 10 by default), **ignore the aircraft on
the ground** (on by default: an airport nearby is full of them), the
**altitude** shown (geometric by default, or barometric), the **language of
the directions**, the **interval** and the **active hours**.

### Your own ADS-B receiver

Type the address of its map page or of its `aircraft.json` file:

- tar1090: `http://192.168.1.30/tar1090/`
- dump1090-fa / SkyAware: `http://192.168.1.30:8080/` or
  `http://192.168.1.30/skyaware/`
- the file itself: `http://192.168.1.30/tar1090/data/aircraft.json`

When the address does not end with `.json`, `/data/aircraft.json` is added.
A user name and password, when the page asks for one, go in the address
(`http://user:password@192.168.1.30/tar1090/`). The file is read every 10
seconds for all your houses at once, and the distances are computed in
Gladys. If the receiver keeps serving the same file for two minutes (its
decoder stopped), the status says so.

### OpenSky Network: only with its written agreement

OpenSky's [terms of use](https://opensky-network.org/about/terms-of-use)
reserve its API for non-profit research and education, and require a
written agreement for any "operational" use in a live product, service or
automated system, which a home automation box is. Choose this source only if
OpenSky granted you that agreement. Anonymously, OpenSky grants 400 credits
a day per internet address (a reading costs one); with an API client (on
opensky-network.org, **Account** page, create an **API client** and copy its
id and secret into the configuration), 4,000 a day.

## Pace

| Source             | One reading                    | Minimum                                 |
| ------------------ | ------------------------------ | --------------------------------------- |
| adsb.lol, adsb.fi  | every 30 s per house           | 15 s, two requests at least 1.1 s apart |
| Your receiver      | every 10 s for all the houses  | 5 s                                     |
| OpenSky, anonymous | every 7 min 15 s for one house | from the daily credits                  |
| OpenSky, account   | every minute                   | a minute                                |

A longer **interval** can be typed in the configuration (0 means
automatic). Outside the **active hours** (the time of Gladys), nothing is
read, and the values stay as they were. When adsb.lol or adsb.fi answers
"too many requests" (429), the integration waits the time they announce (5
minutes otherwise). When they refuse a request (another 4xx answer, which
their rules call a misuse), the readings stop until you save the
configuration again. With OpenSky, the integration spends at most half of the
anonymous credits (three quarters of an account's) on its readings, never
more than 90 % of them in 24 hours, and waits when OpenSky says they are
used up.

An airliner crosses a 10 km circle in about a minute. "Aircraft overhead"
looks one minute ahead along each aircraft's track, so a reading every 30
seconds sees almost every passage.

## Scenes

- **Aircraft overhead**: pick the house, the distance (1 to 25 km) and the
  altitude (500 m to 10,000 m, or any altitude). The scene runs once per
  aircraft and passage when an aircraft is, or will be within the minute,
  that close and that low; an aircraft seen again within 10 minutes is the
  same passage. `{{eta_seconds}}` tells how many seconds before it is
  closest (0: now). Beyond the radius of the configuration, the radius
  applies. Variables: the flight `{{callsign}}` (the transponder address
  when no callsign is received), `{{icao24}}`, `{{registration}}` and
  `{{aircraft_type}}` (adsb.lol, adsb.fi, a receiver with its database),
  `{{country}}` (OpenSky only), `{{distance}}` (km), `{{altitude}}` (m),
  `{{speed}}` (km/h), `{{heading}}`, `{{vertical_rate}}`, where to look
  `{{direction}}` and `{{bearing}}`, `{{squawk}}`.
- **Aircraft emergency code**: an aircraft within the radius transmits
  7500 (unlawful interference), 7600 (radio failure) or 7700 (emergency);
  once per aircraft, code and passage. `{{emergency}}` says what the code
  means.
- The first reading after a start announces nothing: it only records what
  is already in the sky. Changing the source does not announce the aircraft
  already seen again.

The action **Aircraft over a house** gives `{{count}}`, `{{list}}` (one line
per aircraft) and the closest one: `{{closest_callsign}}`,
`{{closest_registration}}`, `{{closest_type}}`, `{{closest_distance}}`,
`{{closest_altitude}}`, `{{closest_speed}}`, `{{closest_direction}}`... A
recent reading (within the interval, a minute at most) is reused; an action
never fires a trigger.

## Good to know

- The altitude is above sea level, not above your house. The barometric one
  can be off by a few hundred metres, and even negative near the ground.
- With a clear sky, the distance of the closest aircraft is the radius (a
  condition "closer than 2 km" stays false), and its altitude keeps the
  last value: combine a condition on the altitude with the count.
- Not every aircraft is visible: the coverage depends on the receivers near
  you, and some aircraft do not broadcast their position.

## Troubleshooting

- **No located house**: set the location of the house in Gladys, then open
  Discovery again.
- **adsb.lol (or adsb.fi) refused the request**: look for an update of the
  integration (the API may have changed) or choose another source, then save
  the configuration.
- **Your receiver is unreachable**: open the address in a browser on the
  same network; it should show a JSON file with an `aircraft` list.
- **OpenSky refused the API client**: check the client id and secret, then
  save the configuration (nothing is sent until then).
- The **Test the source** button reads the sky over the first house now and
  shows the pace.

## Privacy

With adsb.lol and adsb.fi, the integration sends only the position of the
house rounded to 0.01 degree (about a kilometre) and a distance; with
OpenSky, a box around the house rounded outward the same way. The exact
position of the house never leaves Gladys, and it is never logged. With your
receiver, nothing leaves your network. The OpenSky client secret only goes
to OpenSky's sign-in server. Nothing is written on disk.
