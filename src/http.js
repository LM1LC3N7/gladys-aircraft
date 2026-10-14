// -----------------------------------------------------------------------------
// The only place that talks to the network: `fetch` with a timeout, an
// identifiable User-Agent and a size cap. The tests replace it with
// `setFetch()`.
//
// The answer keeps its headers: OpenSky reports the credits left in them
// (X-Rate-Limit-Remaining), and every source the wait after a 429.
// Redirects are not followed: an API that moves, or a receiver URL that
// points to a redirect, is reported (with the status) rather than followed
// somewhere the user did not type.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, MAX_ANSWER_BYTES, USER_AGENT } from './constants.js';

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Replace the fetch implementation (tests only). Returns the previous one. */
export function setFetch(impl) {
  const previous = fetchImpl;
  fetchImpl = impl;
  return previous;
}

export class HttpError extends Error {
  /**
   * The message names `label` when given, else the path: never the query
   * string (the OpenSky box) nor a header or a body (the client secret and
   * the token travel in them). The adsb.lol / adsb.fi path holds the rounded
   * house position: their client passes its own label.
   */
  constructor(status, url, body, headers, label) {
    super(`HTTP ${status} on ${label ?? new URL(url).pathname}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

const parse = (text) => {
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** The body as text, abandoned past MAX_ANSWER_BYTES (a receiver URL may point anywhere). */
async function readText(response) {
  if (!response.body?.getReader) {
    return response.text();
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > MAX_ANSWER_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error(`answer larger than ${MAX_ANSWER_BYTES / 1024 / 1024} MB`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * One request. `form` is sent as application/x-www-form-urlencoded; `label`
 * names the target in the errors. Resolves { status, headers, data }; throws
 * an HttpError on a non-2xx status, with the parsed body and the headers.
 */
export async function request(
  url,
  { method = 'GET', headers = {}, form, timeout = HTTP_TIMEOUT, label } = {},
) {
  const init = {
    method,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
    redirect: 'manual',
    signal: AbortSignal.timeout(Math.max(1, timeout)),
  };
  if (form !== undefined) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(form).toString();
  }
  const response = await fetchImpl(url, init);
  const text = await readText(response);
  if (!response.ok) {
    throw new HttpError(response.status, url, parse(text.slice(0, 2000)), response.headers, label);
  }
  return { status: response.status, headers: response.headers, data: parse(text) };
}
