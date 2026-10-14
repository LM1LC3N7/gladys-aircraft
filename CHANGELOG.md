# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Fixed

- Docs: the scene variables are written as Gladys reads them,
  `{{triggerEvent.data.<key>}}`, and the action outputs come from the variable
  list.

## [0.1.1] - 2026-10-14

### Added

- One device per located house ("Aircraft over _house_"): the aircraft
  within the radius (1 to 25 km), the distance, altitude and flight of the
  closest one.
- A choice of source: adsb.lol (the default: free, open data under the
  ODbL 1.0), adsb.fi (personal, non-commercial use), the `aircraft.json` of
  your own ADS-B receiver on the LAN (readsb, dump1090-fa, tar1090), or the
  OpenSky Network for the users who hold its written agreement (anonymous,
  or an API client through OAuth2 client credentials).
- A pace per source: adsb.lol and adsb.fi every 30 s per house (15 s at
  least, requests 1.1 s apart, paused after a 429, stopped after another
  4xx until the configuration is saved); the receiver every 10 s for every
  house (5 s at least, a stuck decoder reported); OpenSky from its daily
  credits; optional active hours.
- Scene triggers "aircraft overhead" (within a distance, below an altitude,
  once per aircraft and passage, looking a minute ahead along the track)
  and "aircraft emergency code" (7500, 7600, 7700), with the registration
  and the aircraft type when the source knows them.
- Scene action "aircraft over a house": the count, the list and the closest
  aircraft.
- Dashboard widget "Aircraft overhead": the count, the closest aircraft,
  where to look, altitude, speed and heading, or "clear sky", with the
  credit of the source in use.
- "Test the source" button: one reading and the pace.

[Unreleased]: https://github.com/LM1LC3N7/gladys-aircraft/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-aircraft/releases/tag/v0.1.1
