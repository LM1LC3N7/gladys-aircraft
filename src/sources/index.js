// -----------------------------------------------------------------------------
// The sources of the aircraft, behind one interface:
//   client.read(house, { radiusKm }) -> { time (s), states, received }
//   client.shared   true when one read covers every house (the receiver)
//   client.name     for the logs and the error messages
// and what the app shows of each one: its name and the attribution its terms
// ask for (the widget caption, the test button).
// -----------------------------------------------------------------------------

import { AGGREGATOR_NAMES, AggregatorClient } from './aggregator.js';
import { OpenSkyClient } from './opensky.js';
import { ReceiverClient } from './receiver.js';

export { SourceError } from './common.js';

/** The source as the statuses name it. */
export function sourceName(config) {
  if (config.source === 'receiver') {
    const where = config.receiver.host ? ` (${config.receiver.host})` : '';
    return { en: `your receiver${where}`, fr: `votre récepteur${where}` };
  }
  const name = AGGREGATOR_NAMES[config.source] ?? 'OpenSky';
  return { en: name, fr: name };
}

/**
 * The credit each source asks for: adsb.lol's data is ODbL 1.0 ("Data:
 * adsb.lol (ODbL 1.0)"), adsb.fi asks to be cited with a link to its home
 * page, OpenSky to be named with its address.
 */
export const ATTRIBUTION = {
  adsblol: { en: 'adsb.lol (ODbL 1.0)', fr: 'adsb.lol (ODbL 1.0)' },
  adsbfi: { en: 'adsb.fi (https://adsb.fi)', fr: 'adsb.fi (https://adsb.fi)' },
  receiver: { en: 'your ADS-B receiver', fr: 'votre récepteur ADS-B' },
  opensky: {
    en: 'The OpenSky Network (opensky-network.org)',
    fr: 'The OpenSky Network (opensky-network.org)',
  },
};

/** The client of the configured source; undefined when the receiver has no usable URL. */
export function createClient(config, { now, sleep }) {
  if (config.source === 'receiver') {
    return config.receiver.url ? new ReceiverClient({ target: config.receiver, now }) : undefined;
  }
  if (config.source === 'opensky') {
    return new OpenSkyClient({
      clientId: config.account ? config.clientId : '',
      clientSecret: config.account ? config.clientSecret : '',
      now,
    });
  }
  return new AggregatorClient({ source: config.source, now, sleep });
}
