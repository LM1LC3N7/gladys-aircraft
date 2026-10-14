// -----------------------------------------------------------------------------
// The user's own ADS-B receiver: the aircraft.json that readsb, dump1090-fa,
// tar1090 or dump1090-mutability serve on the LAN (readsb.js parses it).
//
// No terms, no quota: one read covers every house (the distance filter is
// local), every 10 s by default. A receiver whose decoder stopped often keeps
// serving its last aircraft.json: when its `now` has not moved for
// RECEIVER_STALE (measured on our clock, so a receiver with a wrong clock
// still works), the reading is refused as stale rather than showing aircraft
// long gone. The URL may hold a password: errors name the host only.
// -----------------------------------------------------------------------------

import { RECEIVER_STALE } from '../constants.js';
import { HttpError, request } from '../http.js';
import { SourceError, transportError } from './common.js';
import { snapshotOf } from './readsb.js';

export class ReceiverClient {
  /** `target`: { url, host, where, headers } from receiverTarget() (src/config.js). */
  constructor({ target, now = Date.now }) {
    this.target = target;
    this.name = `receiver ${target.host}`;
    this.now = now;
    /** One read for every house. */
    this.shared = true;
    this.requests = 0;
    /** The receiver's last `now`, and since when (our clock) it has not moved. */
    this.lastTime = undefined;
    this.sameSince = 0;
  }

  async read() {
    this.requests += 1;
    let answer;
    try {
      answer = await request(this.target.url, {
        headers: this.target.headers,
        label: this.target.where,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        throw new SourceError('http', err.message, { status: err.status });
      }
      throw transportError(err, `The receiver (${this.target.host})`);
    }
    const snapshot = snapshotOf(answer.data, `The receiver (${this.target.host})`);
    const now = this.now();
    if (snapshot.time === null || snapshot.time !== this.lastTime) {
      this.lastTime = snapshot.time;
      this.sameSince = now;
    } else if (now - this.sameSince >= RECEIVER_STALE) {
      const minutes = Math.floor((now - this.sameSince) / 60_000);
      throw new SourceError(
        'stale',
        `the aircraft.json of ${this.target.host} has not changed for ${minutes} min (is the decoder running?)`,
        { minutes },
      );
    }
    return snapshot;
  }
}
