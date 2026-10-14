// -----------------------------------------------------------------------------
// The dashboard widget "sky": the aircraft count, the closest one's distance
// and altitude, and the closest aircraft (flight, where to look, how high,
// how fast, where to), or "clear sky". Pure.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_AIRCRAFT } from './constants.js';
import { T } from './i18n.js';
import { aircraftSummary, aircraftTitle } from './model.js';

const pick = (text, language) => (typeof text === 'string' ? text : (text[language] ?? text.en));

function aircraftItem(aircraft, isClosest, language) {
  const title = aircraftTitle(aircraft);
  return {
    label: (aircraft.emergency ? `${title} · ${aircraft.squawk}` : title).slice(0, 40),
    value: aircraftSummary(aircraft, language).slice(0, 40),
    icon: aircraft.emergency ? 'alert-triangle' : 'navigation',
    color: aircraft.emergency
      ? WIDGET_COLORS.DANGER
      : isClosest
        ? WIDGET_COLORS.PRIMARY
        : WIDGET_COLORS.INFO,
  };
}

/**
 * `paused`: undefined, or { until: "07:00" } while the readings wait (active
 * hours, a 429, credits used up). `clock`: the time of the reading, already
 * formatted in the time zone of Gladys. `attribution`: { en, fr }, the credit
 * the source in use asks for, in the caption.
 */
export function skyWidget({
  name,
  reading,
  radiusKm,
  language = 'fr',
  paused,
  clock,
  attribution,
}) {
  const components = [
    {
      type: 'text',
      text: (name ?? pick(T.widget.title, language)).slice(0, 40),
      variant: 'heading',
    },
  ];
  if (!reading) {
    components.push({ type: 'text', text: T.widget.notLoaded, variant: 'body' });
    return { ttl_seconds: 60, components };
  }
  const closest = reading.closest;
  components.push(
    {
      type: 'value',
      label: T.widget.aircraft,
      value: reading.count,
      icon: 'navigation',
      color: reading.count > 0 ? WIDGET_COLORS.PRIMARY : WIDGET_COLORS.NEUTRAL,
    },
    closest
      ? {
          type: 'value',
          label: T.widget.closest,
          value: closest.distanceKm,
          unit: 'km',
          icon: 'target',
        }
      : { type: 'value', label: T.widget.closest, value: '—', icon: 'target' },
    closest && closest.altitude !== null
      ? {
          type: 'value',
          label: T.widget.altitude,
          value: closest.altitude,
          unit: 'm',
          icon: 'trending-up',
        }
      : { type: 'value', label: T.widget.altitude, value: '—', icon: 'trending-up' },
  );
  const items = [];
  if (paused) {
    items.push({
      label: pick(T.widget.paused, language),
      value: pick(T.widget.until(paused.until), language),
      icon: 'pause-circle',
      color: WIDGET_COLORS.WARNING,
    });
  }
  if (reading.count === 0) {
    items.push({
      label: pick(T.widget.sky, language),
      value: pick(T.widget.clear(radiusKm), language).slice(0, 40),
      icon: 'sun',
      color: WIDGET_COLORS.SUCCESS,
    });
  } else {
    // The emergencies first, then the closest ones.
    const shown = [
      ...reading.aircraft.filter((a) => a.emergency),
      ...reading.aircraft.filter((a) => !a.emergency),
    ].slice(0, WIDGET_AIRCRAFT);
    items.push(...shown.map((a) => aircraftItem(a, a === closest, language)));
  }
  components.push({ type: 'status', items });
  components.push({
    type: 'text',
    text: T.widget.caption(clock, attribution),
    variant: 'caption',
  });
  return { ttl_seconds: 60, components };
}
