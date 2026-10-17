// The single parser for ABsmartly endpoints. Every place an endpoint enters the
// server (OAuth consent, API-key headers/paths, stored session props, the HTTP
// client) goes through it, so they agree on what is valid and how it is written.
// Web APIs only, so it runs on Workers and Node alike.

const API_VERSION_PREFIX = "/v1";
// An endpoint given with its API version (".../v1", ".../V1/") is accepted.
const API_VERSION_SUFFIX = /\/v1$/i;
const ALLOWED_PROTOCOLS = ["http:", "https:"];
const HTTP_SCHEME = "http://";
const HTTPS_SCHEME = "https://";
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const REPEATED_SLASHES = /\/{2,}/g;
const TRAILING_SLASHES = /\/+$/;
// In the operator's base path: anything URL parsing keeps, except an encoded
// separator, and no "." / ".." segment in any encoding.
const ENCODED_SEPARATOR = /%(?:2f|5c)/i;
/** A path segment URL parsing treats as "." or ".." (once decoded). */
export const DOT_SEGMENT = /^\.{1,2}$/;
const DOUBLE_ENCODED = /%25/i;

export const MESSAGE_INVALID_ENDPOINT = "Invalid ABsmartly endpoint";

/**
 * Printable ASCII only. WHATWG URL silently strips tabs, newlines and
 * surrounding spaces and percent-encodes non-ASCII, so a check done before
 * parsing must refuse them, or "/a/.\t./b" would pass as written and then
 * resolve as "/a/../b". Shared with FetchHttpClient's path check.
 */
export const PRINTABLE_ASCII = /^[\x21-\x7e]*$/;

/** Thrown for a malformed ABsmartly endpoint, so callers can tell it from an auth failure. */
export class InvalidEndpointError extends Error {
  constructor(detail: string) {
    super(`${MESSAGE_INVALID_ENDPOINT}: ${detail}`);
    this.name = "InvalidEndpointError";
  }
}

export interface AbsmartlyEndpoint {
  origin: string;
  /** The operator's base path, without "/v1" and trailing "/" ("" for none). */
  basePath: string;
  /** origin + basePath, e.g. "https://acme.absmartly.com". */
  baseUrl: string;
  /** baseUrl + "/v1", the form stored in session props. */
  apiUrl: string;
}

/** decodeURIComponent, or null for malformed percent-encoding. */
export function decodeOrNull(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function isSafeBaseSegment(segment: string): boolean {
  const decoded = decodeOrNull(segment);
  return decoded !== null
    && !ENCODED_SEPARATOR.test(segment)
    && !DOUBLE_ENCODED.test(segment)
    && PRINTABLE_ASCII.test(decoded)
    && !DOT_SEGMENT.test(decoded)
    && !decoded.includes("\\");
}

/**
 * Parses an ABsmartly endpoint. A scheme-less endpoint ("acme.absmartly.com")
 * means https. A trailing "/v1" is optional and stripped; any other path
 * (including a proxy prefix like "/absmartly/v2") is the operator's base path.
 * Rejected: non-http(s) schemes, credentials, a query or fragment, and a base
 * path with an encoded separator or a "."/".." segment in any encoding.
 */
export function parseAbsmartlyEndpoint(raw: string): AbsmartlyEndpoint {
  const trimmed = raw.trim();
  if (!trimmed) throw new InvalidEndpointError("empty");
  if (!PRINTABLE_ASCII.test(trimmed)) {
    throw new InvalidEndpointError(`only printable ASCII is allowed: ${JSON.stringify(raw)}`);
  }
  // WHATWG URL treats "\\" as "/" and resolves what follows, so reject it
  // before parsing rather than letting "base\\..\\x" become "/x".
  if (trimmed.includes("\\")) throw new InvalidEndpointError(`backslashes are not allowed: ${raw}`);
  // Even an empty "?" or "#" is refused: WHATWG drops it, and the written
  // path below must be the whole path.
  if (/[?#]/.test(trimmed)) throw new InvalidEndpointError(`a query or fragment is not allowed: ${raw}`);
  const withScheme = URL_SCHEME_PATTERN.test(trimmed) ? trimmed : `${HTTPS_SCHEME}${trimmed}`;
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
  // URL parsing resolves dot segments, encoded ("%2e%2e") or not, so check
  // the path as written for those; check the parsed path for separators.
  const writtenPath = withScheme.slice(withScheme.indexOf("//") + 2).replace(/^[^/]*/, "");
  if (writtenPath.split("/").slice(1).some((segment) => DOT_SEGMENT.test(decodeOrNull(segment) ?? segment))) {
    throw new InvalidEndpointError(`dot segments are not allowed in the path: ${raw}`);
  }
  const basePath = url.pathname
    .replace(REPEATED_SLASHES, "/")
    .replace(TRAILING_SLASHES, "")
    .replace(API_VERSION_SUFFIX, "")
    .replace(TRAILING_SLASHES, "");
  if (!basePath.split("/").slice(1).every(isSafeBaseSegment)) {
    throw new InvalidEndpointError(`encoded separators and dot segments are not allowed in the path: ${raw}`);
  }
  const baseUrl = `${url.origin}${basePath}`;
  return { origin: url.origin, basePath, baseUrl, apiUrl: `${baseUrl}${API_VERSION_PREFIX}` };
}

/** parseAbsmartlyEndpoint, or null for an invalid endpoint. */
export function tryParseAbsmartlyEndpoint(raw: string | null | undefined): AbsmartlyEndpoint | null {
  if (!raw) return null;
  try {
    return parseAbsmartlyEndpoint(raw);
  } catch {
    return null;
  }
}

/** True when `raw` parses as an ABsmartly endpoint. */
export function isValidAbsmartlyEndpoint(raw: string): boolean {
  return tryParseAbsmartlyEndpoint(raw) !== null;
}

/**
 * The canonical form of an ABsmartly endpoint (origin + base path, no API
 * version), or "" when it is empty or invalid.
 */
export function canonicalizeEndpoint(raw: string): string {
  return tryParseAbsmartlyEndpoint(raw)?.baseUrl ?? "";
}

/**
 * Trims the endpoint, removes trailing "/" and adds "https://" when there is
 * no http(s) scheme. Does not validate.
 * @deprecated Kept for compatibility with @absmartly/mcp 2.0. Use
 * canonicalizeEndpoint, which also validates and drops "/v1".
 */
export function normalizeEndpoint(raw: string): string {
  let endpoint = raw.trim().replace(TRAILING_SLASHES, "");
  if (endpoint && !endpoint.startsWith(HTTP_SCHEME) && !endpoint.startsWith(HTTPS_SCHEME)) {
    endpoint = HTTPS_SCHEME + endpoint;
  }
  return endpoint;
}
