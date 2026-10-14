# Aircraft overhead (avions au-dessus)

**Connecteur non officiel, sans lien avec adsb.lol, adsb.fi ou l'OpenSky
Network.** Il affiche dans Gladys les avions qui survolent votre maison :
leurs transpondeurs diffusent leur position (ADS-B), et des réseaux de
récepteurs tenus par des bénévoles la collectent. Vous choisissez d'où
viennent les avions :

| Source                           | Ce que c'est                                                                                     | Conditions                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| **adsb.lol** (par défaut)        | Un réseau communautaire gratuit et ouvert. Sans compte.                                          | Données ouvertes sous licence ODbL 1.0. Données : adsb.lol (ODbL 1.0), https://adsb.lol             |
| **adsb.fi**                      | Un autre réseau communautaire. Sans compte.                                                      | Usage personnel et non commercial seulement. Données : adsb.fi, https://adsb.fi                     |
| **Votre propre récepteur ADS-B** | Un Raspberry Pi avec readsb, dump1090-fa ou tar1090 sur votre réseau. Rien ne sort de chez vous. | Les vôtres.                                                                                         |
| **OpenSky Network** (facultatif) | Le réseau de recherche. Seulement si OpenSky vous a accordé son accord écrit (voir plus bas).    | Recherche et enseignement non lucratifs. Données : The OpenSky Network, https://opensky-network.org |

Ne revendez et ne republiez jamais les données.

## Ce que vous obtenez

| Surface                          | Contenu                                                                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un appareil par maison localisée | **Aircraft over _maison_** : avions dans le rayon, distance du plus proche (km), son altitude (m), son vol (indicatif)                                                                   |
| Déclencheurs de scène            | **Avion au-dessus** (à moins d'une distance, sous une altitude, une fois par passage), **code d'urgence d'un avion** (7500, 7600, 7700)                                                  |
| Action de scène                  | **Avions au-dessus d'une maison** : le nombre, la liste, le vol le plus proche avec son immatriculation, son type, sa distance, son altitude, sa vitesse, son cap et où regarder         |
| Widget de tableau de bord        | **Avions au-dessus** : le nombre, la distance et l'altitude du plus proche, les avions les plus proches (vol et type, où regarder, altitude, vitesse, flèche du cap), ou « ciel dégagé » |

## Mise en route

1. Renseignez l'emplacement de votre maison dans Gladys (**Paramètres →
   Maisons**), puis installez l'intégration et acceptez l'accès à la
   localisation.
2. Choisissez la **source** (adsb.lol par défaut : rien d'autre à faire).
3. Ouvrez **Découverte** et ajoutez **Aircraft over _maison_**. Rien n'est
   lu tant qu'aucun appareil n'existe.
4. Ajoutez le widget **Avions au-dessus** à un tableau de bord et choisissez
   la maison.

Options : le **rayon** (1 à 25 km, 10 par défaut), **ignorer les avions au
sol** (activé par défaut : un aéroport proche en est plein), l'**altitude**
affichée (géométrique par défaut, ou barométrique), la **langue des
directions**, l'**intervalle** et les **heures actives**.

### Votre propre récepteur ADS-B

Saisissez l'adresse de sa page de carte ou de son fichier `aircraft.json` :

- tar1090 : `http://192.168.1.30/tar1090/`
- dump1090-fa / SkyAware : `http://192.168.1.30:8080/` ou
  `http://192.168.1.30/skyaware/`
- le fichier lui-même : `http://192.168.1.30/tar1090/data/aircraft.json`

Quand l'adresse ne se termine pas par `.json`, `/data/aircraft.json` est
ajouté. Un nom d'utilisateur et un mot de passe, quand la page en demande,
vont dans l'adresse (`http://utilisateur:motdepasse@192.168.1.30/tar1090/`).
Le fichier est lu toutes les 10 secondes pour toutes vos maisons à la fois,
et les distances sont calculées dans Gladys. Si le récepteur sert le même
fichier pendant deux minutes (son décodeur s'est arrêté), le statut le dit.

### OpenSky Network : seulement avec son accord écrit

Les [conditions d'utilisation](https://opensky-network.org/about/terms-of-use)
d'OpenSky réservent son API à la recherche et à l'enseignement non
lucratifs, et exigent un accord écrit pour tout usage « opérationnel » dans
un produit, un service ou un système automatisé en fonctionnement, ce qu'est
une box domotique. Ne choisissez cette source que si OpenSky vous a accordé cet
accord. En anonyme, OpenSky accorde 400 crédits par jour et par adresse
internet (une lecture en coûte un) ; avec un client API (sur
opensky-network.org, page **Account**, créez un **API client** et copiez son
identifiant et son secret dans la configuration), 4 000 par jour.

## Rythme

| Source            | Une lecture                             | Minimum                                       |
| ----------------- | --------------------------------------- | --------------------------------------------- |
| adsb.lol, adsb.fi | toutes les 30 s par maison              | 15 s, deux requêtes espacées d'au moins 1,1 s |
| Votre récepteur   | toutes les 10 s pour toutes les maisons | 5 s                                           |
| OpenSky, anonyme  | toutes les 7 min 15 s pour une maison   | selon les crédits du jour                     |
| OpenSky, compte   | toutes les minutes                      | une minute                                    |

Un **intervalle** plus long peut être saisi dans la configuration (0 veut
dire automatique). Hors des **heures actives** (l'heure de Gladys), rien
n'est lu et les valeurs restent en l'état. Quand adsb.lol ou adsb.fi répond
« trop de requêtes » (429), l'intégration attend le délai annoncé (5 minutes
sinon). Quand ils refusent une requête (une autre réponse 4xx, que leurs
règles appellent un mauvais usage), les lectures s'arrêtent jusqu'à ce que
vous enregistriez à nouveau la configuration. Avec OpenSky, l'intégration
dépense au plus la moitié des crédits anonymes (les trois quarts de ceux
d'un compte) pour ses lectures, jamais plus de 90 % sur 24 heures, et attend
quand OpenSky les dit épuisés.

Un avion de ligne traverse un cercle de 10 km en une minute environ.
« Avion au-dessus » regarde une minute en avant sur la route de chaque
avion : avec une lecture toutes les 30 secondes, il voit presque tous les
passages.

## Scènes

- **Avion au-dessus** : choisissez la maison, la distance (1 à 25 km) et
  l'altitude (500 m à 10 000 m, ou toute altitude). La scène se lance une
  fois par avion et par passage quand un avion est, ou sera dans la minute,
  aussi proche et aussi bas ; un avion revu dans les 10 minutes reste le
  même passage. `{{triggerEvent.data.eta_seconds}}` donne le nombre de
  secondes avant le point le plus proche (0 : maintenant). Au-delà du rayon
  de la configuration, c'est le rayon qui compte. Variables : le vol
  `{{triggerEvent.data.callsign}}` (l'adresse du transpondeur quand aucun
  indicatif n'est reçu), `{{triggerEvent.data.icao24}}`,
  `{{triggerEvent.data.registration}}` et
  `{{triggerEvent.data.aircraft_type}}` (adsb.lol, adsb.fi, un récepteur
  avec sa base), `{{triggerEvent.data.country}}` (OpenSky seulement),
  `{{triggerEvent.data.distance}}` (km), `{{triggerEvent.data.altitude}}`
  (m), `{{triggerEvent.data.speed}}` (km/h),
  `{{triggerEvent.data.heading}}`, `{{triggerEvent.data.vertical_rate}}`,
  où regarder `{{triggerEvent.data.direction}}` et
  `{{triggerEvent.data.bearing}}`, `{{triggerEvent.data.squawk}}`.
- **Code d'urgence d'un avion** : un avion dans le rayon émet 7500
  (intervention illicite), 7600 (panne radio) ou 7700 (urgence) ; une fois
  par avion, code et passage. `{{triggerEvent.data.emergency}}` dit ce que
  signifie le code.
- La première lecture après un démarrage n'annonce rien : elle note
  seulement ce qui est déjà dans le ciel. Changer de source n'annonce pas à
  nouveau les avions déjà vus.

L'action **Avions au-dessus d'une maison** donne `count`, `list` (un avion
par ligne) et le plus proche : `closest_callsign`, `closest_registration`,
`closest_type`, `closest_distance`, `closest_altitude`, `closest_speed`,
`closest_direction`... Les actions suivantes de la scène les trouvent dans
leur liste de variables (écrites `{{<étape>.<action>.<clé>}}`, par exemple
`{{0.0.count}}` quand cette action est la première de la scène). Une lecture
récente (dans l'intervalle, une minute au plus) est réutilisée ; une action
ne lance jamais de déclencheur.

## Bon à savoir

- L'altitude est au-dessus du niveau de la mer, pas au-dessus de votre
  maison. La barométrique peut s'écarter de quelques centaines de mètres, et
  même être négative près du sol.
- Ciel dégagé : la distance du plus proche vaut le rayon (une condition
  « plus près que 2 km » reste fausse) et son altitude garde la dernière
  valeur : associez une condition sur l'altitude au nombre d'avions.
- Tous les avions ne sont pas visibles : la couverture dépend des récepteurs
  proches de chez vous, et certains avions ne diffusent pas leur position.

## Dépannage

- **Aucune maison localisée** : renseignez l'emplacement de la maison dans
  Gladys, puis rouvrez Découverte.
- **adsb.lol (ou adsb.fi) a refusé la requête** : cherchez une mise à jour
  de l'intégration (l'API a pu changer) ou choisissez une autre source, puis
  enregistrez la configuration.
- **Votre récepteur est injoignable** : ouvrez l'adresse dans un navigateur
  sur le même réseau ; elle doit afficher un fichier JSON avec une liste
  `aircraft`.
- **OpenSky a refusé le client API** : vérifiez l'identifiant et le secret,
  puis enregistrez la configuration (rien n'est envoyé d'ici là).
- Le bouton **Tester la source** lit le ciel de la première maison
  maintenant et affiche le rythme.

## Vie privée

Avec adsb.lol et adsb.fi, l'intégration n'envoie que la position de la
maison arrondie au centième de degré (environ un kilomètre) et une distance ;
avec OpenSky, un cadre autour de la maison arrondi vers l'extérieur de la
même façon. La position exacte de la maison ne quitte jamais Gladys et n'est
jamais journalisée. Avec votre récepteur, rien ne quitte votre réseau. Le
secret du client OpenSky ne va qu'au serveur de connexion d'OpenSky. Rien
n'est écrit sur le disque.
