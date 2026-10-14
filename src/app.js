// -----------------------------------------------------------------------------
// The integration itself: the located houses of Gladys, discovery (one device
// per house), the paced readings of the configured source (only for the
// houses whose device exists, only during the active hours), the scene
// triggers, the scene action, the widget and the test button. index.js only
// wires the SDK handlers to it.
//
// Sources (src/sources/): adsb.lol (default) and adsb.fi, one request per
// house, at least 1.1 s apart; the user's receiver, one read of its
// aircraft.json for every house; OpenSky (only with its written agreement),
// one request per house paced on its daily credits.
//
// Pace (see CLAUDE.md): a tick every 5 s decides; a house is read when its
// interval is over (30 s for the aggregators, 10 s for the receiver, from the
// credits for OpenSky). A 429: nothing until the source says (5 minutes, an
// hour for OpenSky, without a date). A final refusal (a 4xx of adsb.lol or
// adsb.fi, a refused OpenSky API client): nothing until the configuration is
// saved.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { clientFingerprint, normalizeConfig, readingFingerprint } from './config.js';
import {
  ACTION_MAX_AGE,
  AGGREGATOR_PAUSE,
  LIST_AIRCRAFT,
  MAX_EVENTS_PER_READING,
  RATE_LIMIT_PAUSE,
  SCENE_TRIGGERS,
  STATE_HEARTBEAT,
  TICK_INTERVAL,
  WIDGETS,
} from './constants.js';
import { buildSkyDevice, ids, parseExternalId, skyStates } from './devices.js';
import { compassPoint } from './geo.js';
import { T } from './i18n.js';
import { aircraftLine, skyReading } from './model.js';
import {
  CreditLedger,
  activeHours,
  clockTime,
  isActive,
  localHour,
  readingInterval,
  spendLimit,
} from './pacing.js';
import { ATTRIBUTION, SourceError, createClient, sourceName } from './sources/index.js';
import { skyEvents } from './triggers.js';
import { skyWidget } from './widget.js';

const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };
const located = (house) => Number.isFinite(house?.latitude) && Number.isFinite(house?.longitude);
const hh = (hour) => `${String(hour % 24).padStart(2, '0')}:00`;

export class AircraftApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'aircraft' }),
    now = Date.now,
    timers = defaultTimers,
    // The time zone of Gladys (the supervisor sets TZ): the active hours are local.
    timeZone = process.env.TZ || undefined,
    // The wait between two requests to adsb.lol / adsb.fi (the tests move a fake clock).
    sleep,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.timeZone = timeZone;
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => this.timers.setTimeout(resolve, ms)));
    this.config = normalizeConfig();
    /** The client of the configured source (undefined: a receiver without a usable URL). */
    this.client = undefined;
    this.clientKey = undefined;
    /** OpenSky: the credits spent over the last 24 hours with the current API client. */
    this.ledger = new CreditLedger();
    /**
     * house selector -> { house, deviceId, latitude, longitude, fingerprint,
     * watched, reading, memory, lastReadAt }. Kept across restarts of the same
     * process: a reconnection to Gladys neither re-reads a house before its
     * interval nor announces an aircraft twice.
     */
    this.areas = new Map();
    this.housesError = undefined;
    /** A 429: no request before this instant. */
    this.pausedUntil = 0;
    /** A final refusal: its status message ({ en, fr }), until the configuration is saved. */
    this.stopped = undefined;
    /** The aircraft in the receiver's last answer (the whole sky it hears). */
    this.received = undefined;
    this.tickTimer = undefined;
    this.ticking = undefined;
    this.lastStatus = undefined;
    this.statusDue = true;
    this.generation = 0;
  }

  // --- Lifecycle -------------------------------------------------------------

  /** `saved`: the user saved the configuration (a stopped source may be tried again). */
  async start(raw = {}, { saved = false } = {}) {
    this.stop();
    const generation = ++this.generation;
    this.config = normalizeConfig(raw);
    const clientKey = clientFingerprint(this.config);
    if (clientKey !== this.clientKey) {
      // Another source (or receiver, or OpenSky client): the old pause, stop and count do not
      // apply, and the houses are read at once from the new one.
      if (this.clientKey !== undefined) {
        for (const area of this.areas.values()) {
          area.lastReadAt = 0;
        }
      }
      this.clientKey = clientKey;
      this.client = createClient(this.config, { now: this.now, sleep: (ms) => this.sleep(ms) });
      this.ledger = new CreditLedger();
      this.pausedUntil = 0;
      this.stopped = undefined;
      this.received = undefined;
    }
    if (saved) {
      this.stopped = undefined;
    }
    this.statusDue = true;
    try {
      await this.loadHouses();
      await this.publishDevices();
    } catch (err) {
      this.logger.warn(`Discovery failed: ${err.message}`);
    }
    if (generation !== this.generation) {
      return;
    }
    this.tickTimer = this.timers.setInterval(
      () => this.tick().catch((err) => this.logger.warn(`Tick failed: ${err.message}`)),
      TICK_INTERVAL,
    );
    await this.tick();
  }

  stop() {
    this.generation += 1;
    this.timers.clearInterval(this.tickTimer);
    this.tickTimer = undefined;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  get opensky() {
    return this.config.source === 'opensky';
  }

  /** Why the configured source cannot be read at all ({ en, fr }), or undefined. */
  sourceProblem() {
    if (this.client) {
      return undefined;
    }
    return this.config.receiver.error === 'missing' ? T.receiverMissing : T.receiverInvalid;
  }

  // --- Houses and discovery ----------------------------------------------------

  /** The located houses of Gladys become areas (the reading of a kept area stays). */
  async loadHouses() {
    let houses;
    try {
      houses = await this.gladys.getHouses();
      this.housesError = undefined;
    } catch (err) {
      // Keep the areas we know: a hiccup of Gladys must not forget the passages.
      this.housesError = err.message;
      this.logger.warn(`Houses unavailable (location not granted?): ${err.message}`);
      return;
    }
    const fingerprint = readingFingerprint(this.config);
    const areas = new Map();
    for (const house of houses ?? []) {
      if (!located(house)) {
        continue;
      }
      const known = this.areas.get(house.selector);
      // A moved house or another radius: a new baseline, read at once.
      const same =
        known &&
        known.latitude === house.latitude &&
        known.longitude === house.longitude &&
        known.fingerprint === fingerprint;
      areas.set(house.selector, {
        reading: undefined,
        memory: undefined,
        lastReadAt: 0,
        ...(same ? known : {}),
        house,
        deviceId: ids.sky(this.gladys, house.selector),
        latitude: house.latitude,
        longitude: house.longitude,
        fingerprint,
        watched: false,
      });
    }
    this.areas = areas;
  }

  async publishDevices() {
    await this.gladys.publishDiscoveredDevices(
      [...this.areas.values()].map((area) => buildSkyDevice(this.gladys, area.house)),
    );
  }

  /** Discovery asked by the user: the houses may have moved since the start. */
  async scan() {
    await this.loadHouses();
    await this.publishDevices();
    this.statusDue = true;
    await this.tick();
  }

  async deviceChanged(device) {
    if (parseExternalId(device?.external_id)) {
      this.statusDue = true;
      await this.tick();
    }
  }

  /** The areas whose device the user created: the only ones read. */
  watchedAreas() {
    const created = new Set((this.gladys.devices ?? []).map((d) => d.external_id));
    const watched = [];
    for (const area of this.areas.values()) {
      area.watched = created.has(area.deviceId);
      if (area.watched) {
        watched.push(area);
      }
    }
    return watched;
  }

  // --- Pace --------------------------------------------------------------------------

  active(now) {
    return isActive(localHour(now, this.timeZone), this.config.activeFrom, this.config.activeTo);
  }

  /** The OpenSky credits one reading of a house costs (1 for the other sources). */
  cost(area) {
    return this.client?.cost?.(area, { radiusKm: this.config.radiusKm }) ?? 1;
  }

  pace(watched = this.watchedAreas()) {
    return readingInterval({
      source: this.config.source,
      tier: this.client?.tier,
      houses: watched.length,
      cost: Math.max(1, ...watched.map((a) => this.cost(a))),
      hours: activeHours(this.config.activeFrom, this.config.activeTo),
      pollSeconds: this.config.pollSeconds,
      remaining: this.client?.remaining,
    });
  }

  /** OpenSky: would one more reading of `area` pass 90 % of the day's credits? */
  overBudget(area, now) {
    return this.opensky && this.ledger.spent(now) + this.cost(area) > spendLimit(this.client.tier);
  }

  /** May a request be sent now? Never past a 429, a final refusal or (OpenSky) the credits. */
  canRequest(area, now = this.now()) {
    return (
      Boolean(this.client) &&
      !this.stopped &&
      now >= this.pausedUntil &&
      !this.overBudget(area, now)
    );
  }

  /** While the readings wait: { until: "07:00" }, else undefined. */
  pausedInfo(now = this.now()) {
    if (now < this.pausedUntil) {
      return { until: clockTime(this.pausedUntil, this.timeZone) };
    }
    if (!this.active(now)) {
      return { until: hh(this.config.activeFrom) };
    }
    return undefined;
  }

  // --- Reading -----------------------------------------------------------------------

  tick() {
    if (!this.ticking) {
      this.ticking = this.doTick().finally(() => {
        this.ticking = undefined;
      });
    }
    return this.ticking;
  }

  async doTick() {
    const generation = this.generation;
    const now = this.now();
    const watched = this.watchedAreas();
    if (watched.length === 0) {
      if (this.housesError) {
        await this.setStatus(false, T.housesUnavailable(this.housesError));
      } else if (this.areas.size === 0) {
        await this.setStatus(false, T.noHouse);
      } else {
        await this.setStatus(true, T.noDevice);
      }
      return;
    }
    const problem = this.sourceProblem();
    if (problem) {
      await this.setStatus(false, problem);
      return;
    }
    if (this.stopped) {
      await this.setStatus(false, this.stopped);
      return;
    }
    if (now < this.pausedUntil) {
      await this.setStatus(
        false,
        T.rateLimited(
          this.config.source,
          sourceName(this.config),
          clockTime(this.pausedUntil, this.timeZone),
        ),
      );
      return;
    }
    if (!this.active(now)) {
      await this.setStatus(true, T.inactive(this.config.activeFrom, this.config.activeTo));
      this.statusDue = true;
      return;
    }
    const { interval } = this.pace(watched);
    // Half a tick of slack: the timers are not exact.
    const due = watched.filter(
      (area) => !area.lastReadAt || now - area.lastReadAt >= interval - TICK_INTERVAL / 2,
    );
    // The receiver: one read for every house, as soon as one is due.
    const batches = this.client.shared ? (due.length > 0 ? [watched] : []) : due.map((a) => [a]);
    let read = 0;
    for (const areas of batches) {
      if (this.overBudget(areas[0], this.now())) {
        const limit = spendLimit(this.client.tier);
        await this.setStatus(true, T.budgetSpent(this.ledger.spent(now), limit));
        return;
      }
      try {
        await this.readAreas(areas, { background: true });
        read += 1;
      } catch (err) {
        if (generation === this.generation) {
          await this.reportError(err);
        }
        return;
      }
      if (generation !== this.generation) {
        return;
      }
    }
    if (read > 0 || this.statusDue) {
      this.statusDue = false;
      await this.reportOk(watched);
    }
  }

  async reportOk(watched = this.watchedAreas()) {
    const pace = this.pace(watched);
    if (pace.low) {
      await this.setStatus(true, T.lowCredits(this.client.remaining));
    } else if (this.opensky && this.config.incompleteAccount) {
      await this.setStatus(true, T.incompleteAccount);
    } else {
      await this.setStatus(
        true,
        T.ok({
          source: this.config.source,
          name: sourceName(this.config),
          houses: watched.length,
          pace,
          account: this.client?.account,
          remaining: this.client?.remaining,
          received: this.received,
        }),
      );
    }
  }

  /** The status of a failed request; the message, for the test button. */
  async reportError(err) {
    this.logger.warn(`${this.client?.name ?? this.config.source}: ${err.message}`);
    const name = sourceName(this.config);
    const code = err instanceof SourceError ? err.code : undefined;
    let message;
    let connected = false;
    if (err instanceof SourceError && err.final) {
      // A refused client, a 4xx of an aggregator: nothing more until the user saves.
      message = code === 'unauthorized' ? T.unauthorized : T.refused(name, err.status);
      this.stopped = message;
    } else if (code === 'rate_limited') {
      const pause = this.opensky ? RATE_LIMIT_PAUSE : AGGREGATOR_PAUSE;
      this.pausedUntil = this.now() + (err.retryAfterMs ?? pause);
      message = T.rateLimited(this.config.source, name, clockTime(this.pausedUntil, this.timeZone));
    } else {
      message =
        code === 'stale'
          ? T.stale(name, err.minutes)
          : code === 'invalid'
            ? T.invalid(this.config.source, name)
            : T.unreachable(name, err.message);
      // The last readings still stand: green while some house has one.
      connected = [...this.areas.values()].some((a) => a.reading);
    }
    await this.setStatus(connected, message);
    this.statusDue = true;
    return message;
  }

  /**
   * One read of the source for some houses: one request per house, or one for
   * all of them with the receiver. `background`: the paced reading, which
   * dates the houses and fires the scene events; the scene action and the test
   * button read for their answer only (no event from an action: no scene
   * loop), and the next paced reading announces what they saw.
   */
  async readAreas(areas, { background = false } = {}) {
    if (background) {
      // The attempt counts: a failing house is retried at the same pace, not every tick.
      const now = this.now();
      for (const area of areas) {
        area.lastReadAt = now;
      }
    }
    const options = { radiusKm: this.config.radiusKm };
    if (this.client.shared) {
      const snapshot = await this.client.read(undefined, options);
      this.received = snapshot.received;
      for (const area of areas) {
        await this.applyReading(area, snapshot, { background });
      }
      return;
    }
    for (const area of areas) {
      if (this.opensky) {
        this.ledger.spend(this.cost(area), this.now());
      }
      const snapshot = await this.client.read(area, options);
      await this.applyReading(area, snapshot, { background });
    }
  }

  async applyReading(area, snapshot, { background }) {
    const reading = skyReading(snapshot, area, {
      now: this.now(),
      radiusKm: this.config.radiusKm,
      ignoreGround: this.config.ignoreGround,
      altitudeSource: this.config.altitudeSource,
    });
    area.reading = reading;
    if (background) {
      const { events, memory } = skyEvents(area.deviceId, area.memory, reading, {
        language: this.config.language,
      });
      area.memory = memory;
      await this.publishEvents(area, events);
    }
    if (area.watched) {
      await this.gladys
        .publishChangedStates(skyStates(area.deviceId, reading, this.config), {
          heartbeat: STATE_HEARTBEAT,
        })
        .catch((err) => this.logger.warn(`States of ${area.house.name} failed: ${err.message}`));
      this.gladys.requestWidgetRefresh(WIDGETS.SKY);
    }
  }

  async publishEvents(area, events) {
    // Emergencies first: the safety net below must never drop one.
    const sorted = [
      ...events.filter((e) => e.key === SCENE_TRIGGERS.EMERGENCY),
      ...events.filter((e) => e.key !== SCENE_TRIGGERS.EMERGENCY),
    ];
    if (sorted.length > MAX_EVENTS_PER_READING) {
      this.logger.warn(
        `${area.house.name}: ${sorted.length} scene events in one reading, ${MAX_EVENTS_PER_READING} sent`,
      );
    }
    for (const event of sorted.slice(0, MAX_EVENTS_PER_READING)) {
      await this.gladys
        .publishSceneEvent(event.key, event.data)
        .catch((err) => this.logger.warn(`Scene event ${event.key} failed: ${err.message}`));
    }
  }

  // --- Scene action ------------------------------------------------------------------

  areaOf(externalId) {
    const parsed = parseExternalId(externalId);
    const area = parsed && this.areas.get(parsed.houseSelector);
    if (!area) {
      throw new Error(T.unknownDevice(externalId).en);
    }
    return area;
  }

  /** "Aircraft over a house": the reading of a house, fresh within the interval (a minute at most). */
  async getAircraft(fields = {}) {
    const area = this.areaOf(fields.house);
    const watched = this.watchedAreas();
    const now = this.now();
    const maxAge = Math.min(ACTION_MAX_AGE, this.pace(watched).interval);
    if ((!area.reading || now - area.reading.at >= maxAge) && this.canRequest(area, now)) {
      try {
        await this.readAreas([area]);
      } catch (err) {
        // The last reading (with its age) is better than nothing.
        await this.reportError(err);
      }
    }
    const reading = area.reading;
    if (!reading) {
      throw new Error(T.noReading.en);
    }
    const language = this.config.language;
    const closest = reading.closest;
    return {
      count: reading.count,
      list: reading.aircraft
        .slice(0, LIST_AIRCRAFT)
        .map((a) => aircraftLine(a, language))
        .join('\n'),
      closest_callsign: closest?.name ?? null,
      closest_icao24: closest?.icao24 ?? null,
      closest_registration: closest?.registration ?? null,
      closest_type: closest?.aircraftType ?? null,
      closest_country: closest?.country ?? null,
      closest_distance: closest?.distanceKm ?? null,
      closest_altitude: closest?.altitude ?? null,
      closest_speed: closest?.speedKmh ?? null,
      closest_heading: closest?.heading ?? null,
      closest_bearing: closest?.bearing ?? null,
      closest_direction: closest ? compassPoint(closest.bearing, language) : null,
      emergency: reading.aircraft.some((a) => a.emergency),
      age_seconds: Math.max(0, Math.round((this.now() - reading.at) / 1000)),
    };
  }

  // --- Widget ------------------------------------------------------------------------

  async getWidget({ settings = {}, language } = {}) {
    const lang = language === 'en' || language === 'fr' ? language : this.config.language;
    const watched = this.watchedAreas();
    // No device picked: the first house; a device that no longer exists: say so.
    const parsed = parseExternalId(settings.device);
    const area = settings.device ? parsed && this.areas.get(parsed.houseSelector) : watched[0];
    if (!area) {
      return {
        ttl_seconds: 300,
        components: [{ type: 'text', text: T.widget.pickHouse, variant: 'body' }],
      };
    }
    const device = (this.gladys.devices ?? []).find((d) => d.external_id === area.deviceId);
    return skyWidget({
      name: device?.name ?? `Aircraft over ${area.house.name}`,
      reading: area.reading,
      radiusKm: this.config.radiusKm,
      language: lang,
      paused: this.pausedInfo(),
      clock: area.reading ? clockTime(area.reading.at, this.timeZone) : '',
      attribution: ATTRIBUTION[this.config.source],
    });
  }

  // --- Configuration screen button ------------------------------------------------------

  async testConnection() {
    const lines = { en: [], fr: [] };
    const add = (text) => {
      lines.en.push(text.en);
      lines.fr.push(text.fr);
    };
    const done = () => ({ en: lines.en.join('\n'), fr: lines.fr.join('\n') });
    if (this.opensky && this.config.incompleteAccount) {
      add(T.incompleteAccount);
    }
    const problem = this.sourceProblem();
    if (problem) {
      add(problem);
      return done();
    }
    const watched = this.watchedAreas();
    const area = watched[0] ?? [...this.areas.values()][0];
    if (!area) {
      add(this.housesError ? T.housesUnavailable(this.housesError) : T.noHouse);
      return done();
    }
    const name = sourceName(this.config);
    const now = this.now();
    if (now < this.pausedUntil) {
      add(T.rateLimited(this.config.source, name, clockTime(this.pausedUntil, this.timeZone)));
      return done();
    }
    if (this.overBudget(area, now)) {
      add(T.budgetSpent(this.ledger.spent(now), spendLimit(this.client.tier)));
      return done();
    }
    if (this.stopped) {
      if (!this.opensky) {
        // adsb.lol / adsb.fi: a 4xx stops the source until the configuration is saved.
        add(this.stopped);
        return done();
      }
      // OpenSky: a test is the user asking to try again; a refused client gets one more chance.
      this.stopped = undefined;
    }
    try {
      await this.readAreas([area]);
      const reading = area.reading;
      const closest = reading.closest;
      add(
        T.test.answers({
          source: this.config.source,
          name,
          account: this.client.account,
          received: reading.received,
          count: reading.count,
          radius: this.config.radiusKm,
          house: area.house.name,
          closest: closest && { en: aircraftLine(closest, 'en'), fr: aircraftLine(closest, 'fr') },
        }),
      );
      add(
        T.test.pace({
          source: this.config.source,
          pace: this.pace(watched.length > 0 ? watched : [area]),
          active: this.active(now),
          spent: this.ledger.spent(this.now()),
          remaining: this.client.remaining,
        }),
      );
      this.statusDue = true;
    } catch (err) {
      add(await this.reportError(err));
    }
    return done();
  }
}
