// The single parser for ABsmartly endpoints. Every place an endpoint enters the
// server (OAuth consent, API-key headers/paths, stored session props, the HTTP
// client) goes through it, so they agree on what is valid and how it is written.
// Web APIs only, so it runs on Workers and Node alike.

const API_VERSION_PREFIX = "/v1";
// An endpoint given with its API version (".../v1", ".../V1/") is accepted.
const API_VERSION_SUFFIX = /\/v1$/i;
const OTHER_API_VERSION_SUFFIX = /\/v\d+$/i;
const ALLOWED_PROTOCOLS = ["http:", "https:"];
const DEFAULT_SCHEME = "https://";
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const REPEATED_SLASHES = /\/{2,}/g;
const TRAILING_SLASHES = /\/+$/;

export const MESSAGE_INVALID_ENDPOINT = "Invalid ABsmartly endpoint";

/** Thrown for a malformed ABsmartly endpoint, so callers can tell it from an auth failure. */
export class InvalidEndpointError extends Error {
  constructor(detail: string) {
    super(`${MESSAGE_INVALID_ENDPOINT}: ${detail}`);
    this.name = "InvalidEndpointError";
  }
}

export interface AbsmartlyEndpoint {
  origin: string;
  /** The operator's base path, without the API version and trailing "/" ("" for none). */
  basePath: string;
  /** origin + basePath, e.g. "https://acme.absmartly.com". */
  baseUrl: string;
  /** baseUrl + "/v1", the form stored in session props. */
  apiUrl: string;
}

/**
 * Parses an ABsmartly endpoint. A scheme-less endpoint ("acme.absmartly.com")
 * means https. A trailing "/v1" is optional; another API version, a non-http(s)
 * scheme, credentials, a query or a fragment are rejected. The base path is the
 * operator's choice, so only empty segments are collapsed.
 */
export function parseAbsmartlyEndpoint(raw: string): AbsmartlyEndpoint {
  const trimmed = raw.trim();
  if (!trimmed) throw new InvalidEndpointError("empty");
  const withScheme = URL_SCHEME_PATTERN.test(trimmed) ? trimmed : `${DEFAULT_SCHEME}${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new InvalidEndpointError(raw);
  }
  if (!ALLOWED_PROTOCOLS.includes(url.protocol)) {
    throw new InvalidEndpointError(`must be http(s): ${raw}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new InvalidEndpointError(`credentials, query and fragment are not allowed: ${raw}`);
  }
  const basePath = url.pathname
    .replace(REPEATED_SLASHES, "/")
    .replace(TRAILING_SLASHES, "")
    .replace(API_VERSION_SUFFIX, "")
    .replace(TRAILING_SLASHES, "");
  if (OTHER_API_VERSION_SUFFIX.test(basePath)) {
    throw new InvalidEndpointError(`only API ${API_VERSION_PREFIX} is supported: ${raw}`);
  }
  const baseUrl = `${url.origin}${basePath}`;
  return { origin: url.origin, basePath, baseUrl, apiUrl: `${baseUrl}${API_VERSION_PREFIX}` };
}

/** True when `raw` parses as an ABsmartly endpoint. */
export function isValidAbsmartlyEndpoint(raw: string): boolean {
  try {
    parseAbsmartlyEndpoint(raw);
    return true;
  } catch {
    return false;
  }
}
