// -----------------------------------------------------------------------------
// The pace of the readings: a fixed interval for adsb.lol, adsb.fi and the
// receiver (automatic, or typed, never below the source's minimum); for
// OpenSky, derived from its daily credits, the number of houses and the
// active hours, with the ledger of the credits this integration spent over
// the last 24 hours. Pure (the ledger takes the time).
// -----------------------------------------------------------------------------

import {
  CREDIT_SHARE,
  DAILY_CREDITS,
  INTERVAL_STEP,
  LOW_CREDITS_INTERVAL,
  LOW_CREDITS_SHARE,
  MIN_INTERVAL,
  PACE,
} from './constants.js';

const DAY = 24 * 60 * 60_000;

/** The hour (0-23) of an instant in a time zone (the one of Gladys, TZ). */
export function localHour(ms, timeZone) {
  try {
    const hour = new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone,
    }).format(new Date(ms));
    return Number(hour) % 24;
  } catch {
    return new Date(ms).getUTCHours();
  }
}

/** "07:00": the clock time of an instant in a time zone. */
export function clockTime(ms, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(11, 16);
  }
}

/** Hours `from` (included) to `to` (excluded); from > to spans midnight; from = to is all day. */
export function isActive(hour, from, to) {
  if (from === to || (from === 0 && to === 24)) {
    return true;
  }
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** How many hours a day the readings run. */
export function activeHours(from, to) {
  if (from === to) {
    return 24;
  }
  return from < to ? to - from : 24 - from + to;
}

/**
 * The time between two readings of a house.
 *
 * adsb.lol, adsb.fi, the receiver (PACE): `pollSeconds` 0 is the automatic
 * interval, a typed one is never below the source's minimum. perDay counts
 * the requests a day: one per house, one for every house with the receiver.
 *
 * OpenSky:
 *   - the floor spreads the share of the daily credits (CREDIT_SHARE) over
 *     the active hours and the houses, rounded up to INTERVAL_STEP, never
 *     below MIN_INTERVAL;
 *   - a longer interval typed by the user wins;
 *   - with few credits left (LOW_CREDITS_SHARE), LOW_CREDITS_INTERVAL.
 *   perDay is the credits a day at that interval.
 * { interval, floor, perDay, low }
 */
export function readingInterval({
  source = 'opensky',
  tier = 'anonymous',
  houses,
  cost = 1,
  hours = 24,
  pollSeconds = 0,
  remaining,
}) {
  if (PACE[source]) {
    const { auto, min } = PACE[source];
    const interval = Math.max(min, pollSeconds > 0 ? pollSeconds * 1000 : auto);
    const requests = source === 'receiver' ? 1 : Math.max(1, houses);
    const perDay = Math.ceil((hours * 3_600_000 * requests) / interval);
    return { interval, floor: min, perDay, low: false };
  }
  const budget = DAILY_CREDITS[tier] * CREDIT_SHARE[tier];
  const raw = (hours * 3_600_000 * Math.max(1, houses) * cost) / budget;
  const floor = Math.max(MIN_INTERVAL, Math.ceil(raw / INTERVAL_STEP) * INTERVAL_STEP);
  let interval = Math.max(floor, pollSeconds * 1000);
  const low = Number.isFinite(remaining) && remaining < DAILY_CREDITS[tier] * LOW_CREDITS_SHARE;
  if (low) {
    interval = Math.max(interval, LOW_CREDITS_INTERVAL);
  }
  const perDay = Math.ceil((hours * 3_600_000 * Math.max(1, houses) * cost) / interval);
  return { interval, floor, perDay, low };
}

/** The most credits this integration spends in 24 hours, readings and scene actions together. */
export const spendLimit = (tier) => Math.floor(DAILY_CREDITS[tier] * 0.9);

/**
 * The credits spent over the last 24 hours (a rolling window: OpenSky does
 * not say when its daily bucket refills). Kept in memory only.
 */
export class CreditLedger {
  constructor() {
    this.entries = [];
  }

  spend(credits, at) {
    this.entries.push([at, credits]);
  }

  /** The credits spent in the 24 hours before `at`. */
  spent(at) {
    this.entries = this.entries.filter(([t]) => at - t < DAY);
    return this.entries.reduce((sum, [, credits]) => sum + credits, 0);
  }
}
