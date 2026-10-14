// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, action results, widget).
// A source is named by { en, fr } (src/sources/index.js: sourceName).
// -----------------------------------------------------------------------------

import { AGGREGATOR_SPACING } from './constants.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const spacing = AGGREGATOR_SPACING / 1000;
/** "your receiver" starts a sentence as "Your receiver"; a domain name (adsb.lol) stays as it is. */
const cap = (text) =>
  /^[a-z0-9-]+\.[a-z]/.test(text) ? text : text.charAt(0).toUpperCase() + text.slice(1);
const thousands = { en: (n) => n.toLocaleString('en-US'), fr: (n) => String(n) };

/** "7 min 15 s", "1 min", "45 s". */
export function duration(ms) {
  const seconds = Math.round(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) {
    return `${s} s`;
  }
  return s === 0 ? `${m} min` : `${m} min ${s} s`;
}

const remainingText = (remaining) =>
  remaining === undefined
    ? { en: '', fr: '' }
    : {
        en: ` OpenSky reports ${remaining} credits left.`,
        fr: ` OpenSky indique ${remaining} crédits restants.`,
      };

export const T = {
  /** The status of a working source. `pace`: readingInterval(); `received`: aircraft in the receiver's answer. */
  ok: ({ source, name, houses, pace, account, remaining, received }) => {
    const watching = {
      en: `Watching ${plural(houses, 'house', 'houses')}`,
      fr: plural(houses, 'maison surveillée', 'maisons surveillées'),
    };
    if (source === 'opensky') {
      const left = remainingText(remaining);
      return {
        en: `${watching.en} with OpenSky ${account ? 'and your account' : 'anonymously'}: one reading every ${duration(pace.interval)}, about ${pace.perDay} credits a day.${left.en}`,
        fr: `${watching.fr} avec OpenSky ${account ? 'et votre compte' : 'en anonyme'} : une lecture toutes les ${duration(pace.interval)}, environ ${pace.perDay} crédits par jour.${left.fr}`,
      };
    }
    if (source === 'receiver') {
      const got = received ?? 0;
      return {
        en: `${watching.en} with ${name.en}: one reading every ${duration(pace.interval)}, ${plural(got, 'aircraft', 'aircraft')} received.`,
        fr: `${watching.fr} avec ${name.fr} : une lecture toutes les ${duration(pace.interval)}, ${plural(got, 'avion reçu', 'avions reçus')}.`,
      };
    }
    return {
      en: `${watching.en} with ${name.en}: one reading every ${duration(pace.interval)} (${thousands.en(pace.perDay)} requests a day).`,
      fr: `${watching.fr} avec ${name.fr} : une lecture toutes les ${duration(pace.interval)} (${thousands.fr(pace.perDay)} requêtes par jour).`,
    };
  },
  lowCredits: (remaining) => ({
    en: `Few OpenSky credits left (${remaining}): one reading every 30 minutes until they come back.`,
    fr: `Peu de crédits OpenSky restants (${remaining}) : une lecture toutes les 30 minutes jusqu'à leur retour.`,
  }),
  inactive: (from, to) => ({
    en: `Outside the active hours (${from}:00 to ${to}:00): no reading until ${from}:00.`,
    fr: `Hors des heures actives (${from} h à ${to} h) : aucune lecture avant ${from} h.`,
  }),
  rateLimited: (source, name, clock) =>
    source === 'opensky'
      ? {
          en: `The OpenSky credits are used up: next reading at ${clock}. Anonymously, they are shared by every OpenSky user of your internet address.`,
          fr: `Les crédits OpenSky sont épuisés : prochaine lecture à ${clock}. En anonyme, ils sont partagés par tous les utilisateurs d'OpenSky de votre adresse internet.`,
        }
      : {
          en: `${cap(name.en)} asks to slow down (HTTP 429): next reading at ${clock}. Another program of your internet address may use it too.`,
          fr: `${cap(name.fr)} demande de ralentir (HTTP 429) : prochaine lecture à ${clock}. Un autre programme de votre adresse internet l'utilise peut-être aussi.`,
        },
  unauthorized: {
    en: 'OpenSky refused the API client: check the client id and secret (OpenSky account page, "API client"), then save the configuration.',
    fr: "OpenSky a refusé le client API : vérifiez l'identifiant et le secret (page compte OpenSky, « API client »), puis enregistrez la configuration.",
  },
  refused: (name, status) => ({
    en: `${cap(name.en)} refused the request (HTTP ${status}): the readings stop, as its rules ask (a 4xx answer means a misuse). Look for an update of the integration or choose another source, then save the configuration to try again.`,
    fr: `${cap(name.fr)} a refusé la requête (HTTP ${status}) : les lectures s'arrêtent, comme ses règles le demandent (une réponse 4xx signale un mauvais usage). Cherchez une mise à jour de l'intégration ou choisissez une autre source, puis enregistrez la configuration pour réessayer.`,
  }),
  incompleteAccount: {
    en: 'The OpenSky account needs both the client id and the client secret: reading anonymously meanwhile.',
    fr: "Le compte OpenSky demande l'identifiant ET le secret du client : lecture en anonyme en attendant.",
  },
  unreachable: (name, message) => ({
    en: `${cap(name.en)} is unreachable: ${message}. Retrying at the next reading.`,
    fr: `${cap(name.fr)} est injoignable : ${message}. Nouvel essai à la prochaine lecture.`,
  }),
  invalid: (source, name) =>
    source === 'receiver'
      ? {
          en: `${cap(name.en)} did not answer an aircraft.json (readsb, dump1090-fa, tar1090): check the URL in the configuration.`,
          fr: `${cap(name.fr)} n'a pas répondu un aircraft.json (readsb, dump1090-fa, tar1090) : vérifiez l'URL dans la configuration.`,
        }
      : {
          en: `${cap(name.en)} sent an answer this version does not understand: look for an update of the integration.`,
          fr: `${cap(name.fr)} a envoyé une réponse que cette version ne comprend pas : cherchez une mise à jour de l'intégration.`,
        },
  stale: (name, minutes) => ({
    en: `${cap(name.en)} serves the same aircraft for ${minutes} min: is its decoder (readsb, dump1090) running?`,
    fr: `${cap(name.fr)} sert les mêmes avions depuis ${minutes} min : son décodeur (readsb, dump1090) tourne-t-il ?`,
  }),
  receiverMissing: {
    en: 'Type the address of your receiver in the configuration, e.g. http://192.168.1.30/tar1090/ or http://192.168.1.30:8080/data/aircraft.json.',
    fr: "Saisissez l'adresse de votre récepteur dans la configuration, par ex. http://192.168.1.30/tar1090/ ou http://192.168.1.30:8080/data/aircraft.json.",
  },
  receiverInvalid: {
    en: 'The address of the receiver is not an http:// or https:// address: check it in the configuration.',
    fr: "L'adresse du récepteur n'est pas une adresse http:// ou https:// : vérifiez-la dans la configuration.",
  },
  noHouse: {
    en: 'No located house: set the location of your house in Gladys (Settings → Houses), then open Discovery.',
    fr: "Aucune maison localisée : renseignez l'emplacement de votre maison dans Gladys (Paramètres → Maisons), puis ouvrez Découverte.",
  },
  housesUnavailable: (message) => ({
    en: `The location of the houses is not available (${message}): reinstall the integration and accept the location access.`,
    fr: `L'emplacement des maisons n'est pas disponible (${message}) : réinstallez l'intégration et acceptez l'accès à la localisation.`,
  }),
  noDevice: {
    en: 'Open Discovery and add the aircraft device of your house: nothing is read before a device exists.',
    fr: "Ouvrez Découverte et ajoutez l'appareil avions de votre maison : rien n'est lu tant qu'aucun appareil n'existe.",
  },
  unknownDevice: (id) => ({
    en: `Unknown aircraft device ${id}`,
    fr: `Appareil avions inconnu ${id}`,
  }),
  noReading: {
    en: 'No reading of this house yet (outside the active hours, readings paused or the source unreachable).',
    fr: 'Pas encore de lecture de cette maison (hors des heures actives, lectures en pause ou source injoignable).',
  },
  budgetSpent: (spent, limit) => ({
    en: `${spent} OpenSky credits spent in the last 24 hours (limit ${limit}): no new request now.`,
    fr: `${spent} crédits OpenSky dépensés sur les dernières 24 heures (limite ${limit}) : pas de nouvelle requête maintenant.`,
  }),
  test: {
    answers: ({ source, name, account, received, count, radius, house, closest }) => {
      const who =
        source === 'opensky'
          ? account
            ? { en: ' with your account', fr: ' avec votre compte' }
            : { en: ' anonymously', fr: ' en anonyme' }
          : { en: '', fr: '' };
      const all =
        source === 'receiver'
          ? {
              en: `${plural(received, 'aircraft', 'aircraft')} received, `,
              fr: `${plural(received, 'avion reçu', 'avions reçus')}, `,
            }
          : { en: '', fr: '' };
      return {
        en: `${cap(name.en)} answers${who.en}: ${all.en}${count} aircraft within ${radius} km of ${house}${closest ? `, the closest ${closest.en}` : ''}.`,
        fr: `${cap(name.fr)} répond${who.fr} : ${all.fr}${count} avion(s) à moins de ${radius} km de ${house}${closest ? `, le plus proche ${closest.fr}` : ''}.`,
      };
    },
    pace: ({ source, pace, active, spent, remaining }) => {
      const now = active
        ? { en: '', fr: '' }
        : {
            en: ' (outside the active hours: none now)',
            fr: ' (hors des heures actives : aucune maintenant)',
          };
      if (source === 'opensky') {
        return {
          en: `One reading every ${duration(pace.interval)} per house${now.en}, about ${pace.perDay} credits a day; ${spent} spent in the last 24 hours${remaining === undefined ? '' : `, ${remaining} left according to OpenSky`}.`,
          fr: `Une lecture toutes les ${duration(pace.interval)} par maison${now.fr}, environ ${pace.perDay} crédits par jour ; ${spent} dépensés sur les dernières 24 heures${remaining === undefined ? '' : `, ${remaining} restants selon OpenSky`}.`,
        };
      }
      if (source === 'receiver') {
        return {
          en: `One reading every ${duration(pace.interval)} for every house${now.en}.`,
          fr: `Une lecture toutes les ${duration(pace.interval)} pour toutes les maisons${now.fr}.`,
        };
      }
      return {
        en: `One reading every ${duration(pace.interval)} per house${now.en} (${thousands.en(pace.perDay)} requests a day), at least ${spacing} s apart.`,
        fr: `Une lecture toutes les ${duration(pace.interval)} par maison${now.fr} (${thousands.fr(pace.perDay)} requêtes par jour), espacées d'au moins ${String(spacing).replace('.', ',')} s.`,
      };
    },
  },
  widget: {
    title: { en: 'Sky', fr: 'Ciel' },
    pickHouse: {
      en: 'Pick the aircraft device of a house in the widget settings',
      fr: "Choisissez l'appareil avions d'une maison dans les réglages du widget",
    },
    notLoaded: { en: 'Waiting for the first reading…', fr: 'En attente de la première lecture…' },
    aircraft: { en: 'Aircraft', fr: 'Avions' },
    closest: { en: 'Closest', fr: 'Le plus proche' },
    altitude: { en: 'Altitude', fr: 'Altitude' },
    sky: { en: 'Sky', fr: 'Ciel' },
    clear: (radiusKm) => ({
      en: `Clear sky within ${radiusKm} km`,
      fr: `Ciel dégagé dans un rayon de ${radiusKm} km`,
    }),
    paused: { en: 'Readings paused', fr: 'Lectures en pause' },
    until: (clock) => ({ en: `until ${clock}`, fr: `jusqu'à ${clock}` }),
    caption: (clock, attribution = { en: '', fr: '' }) => ({
      en: `${clock} · Data: ${attribution.en} · unofficial`,
      fr: `${clock} · Données : ${attribution.fr} · non officiel`,
    }),
  },
};
