import type { HttpClient, HttpRequestConfig, HttpResponse } from '@absmartly/cli/api-client';
import { debug } from './config.js';
import { MCP_VERSION, CLI_CORE_VERSION } from './version.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const API_VERSION_PREFIX = '/v1';
// A base given with its API version (".../v1", ".../V1/") is accepted.
const API_VERSION_SUFFIX = /\/v1$/i;
const OTHER_API_VERSION_SUFFIX = /\/v\d+$/i;
const ALLOWED_PROTOCOLS = ['http:', 'https:'];
const DEFAULT_SCHEME = 'https://';
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const ABSOLUTE_URL_PATTERN = /^https?:\/\//i;
const FETCH_REDIRECT_MODE = 'manual';
// APIClient.getRootUrl() requests (getCurrentUser, the auth API-key methods)
// are the only ones outside /v1, and they use exactly these paths.
const ROOT_AUTH_PATH = '/auth/current-user';
const ROOT_AUTH_SUBPATH = /^(?:\/api_keys(?:\/[0-9]+)?)?$/;
// Printable ASCII only in the path: WHATWG URL silently strips tabs, newlines
// and surrounding spaces, and percent-encodes non-ASCII.
const PRINTABLE_ASCII = /^[\x21-\x7e]*$/;
// Characters WHATWG URL reinterprets ("\\" as "/") or that start a fragment.
const RAW_URL_FORBIDDEN = /[\\#]/;
// A path segment: RFC 3986 unreserved characters, or percent-escapes of them.
const PATH_SEGMENT = /^(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+$/;
const UNRESERVED = /^[A-Za-z0-9._~-]+$/;
const DOT_SEGMENT = /^\.{1,2}$/;

/** Thrown for a malformed API base URL, so callers can tell it from an auth failure. */
export class InvalidEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEndpointError';
  }
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * True when every segment of `path` (starting with "/") is unreserved
 * characters only, raw or percent-escaped, and none is "." or ".." in any
 * encoding. A trailing "/" is allowed; empty middle segments are not.
 */
function isAllowedPathSuffix(path: string): boolean {
  const segments = path.split('/').slice(1);
  return segments.every((segment, i) => {
    if (segment === '') return i === segments.length - 1 && i > 0;
    const decoded = PATH_SEGMENT.test(segment) ? decodeSegment(segment) : null;
    return decoded !== null && UNRESERVED.test(decoded) && !DOT_SEGMENT.test(decoded);
  });
}

/** Parses an API base URL; a scheme-less endpoint ("sandbox.absmartly.com") means https. */
function parseBaseUrl(raw: string): URL {
  const trimmed = raw.trim();
  const withScheme = URL_SCHEME_PATTERN.test(trimmed) ? trimmed : `${DEFAULT_SCHEME}${trimmed}`;
  let base: URL;
  try {
    base = new URL(withScheme);
  } catch {
    throw new InvalidEndpointError(`Invalid ABsmartly endpoint: ${raw}`);
  }
  if (!ALLOWED_PROTOCOLS.includes(base.protocol)) {
    throw new InvalidEndpointError(`Invalid ABsmartly endpoint: must be http(s): ${raw}`);
  }
  if (base.username || base.password || base.search || base.hash) {
    throw new InvalidEndpointError(`Invalid ABsmartly endpoint: credentials, query and fragment are not allowed: ${raw}`);
  }
  return base;
}

export type FetchHttpClientOptions =
  | { authToken: string; authType: 'jwt' | 'api-key'; timeout?: number }
  | { authToken: string; authType: 'service-key'; impersonatedUserId: number; timeout?: number };

function credentialHeaders(options: FetchHttpClientOptions): Record<string, string> {
  if (options.authType === 'service-key') {
    return {
      'Authorization': `Service-Key ${options.authToken}`,
      'Service-Key-Impersonating-UserId': String(options.impersonatedUserId),
    };
  }
  return { 'Authorization': options.authType === 'jwt' ? `JWT ${options.authToken}` : `Api-Key ${options.authToken}` };
}

export class FetchHttpClient implements HttpClient {
  private baseUrl: string;
  private origin: string;
  private apiPrefix: string;
  private authPrefix: string;
  private credentialHeaders: Record<string, string>;
  private timeout: number;

  constructor(baseUrl: string, options: FetchHttpClientOptions) {
    const base = parseBaseUrl(baseUrl);
    // The operator controls the base path, so only collapse empty segments.
    let basePath = base.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '').replace(API_VERSION_SUFFIX, '');
    if (OTHER_API_VERSION_SUFFIX.test(basePath)) {
      throw new InvalidEndpointError(`Invalid ABsmartly endpoint: only API ${API_VERSION_PREFIX} is supported: ${baseUrl}`);
    }
    basePath = basePath.replace(/\/+$/, '');
    this.origin = base.origin;
    this.baseUrl = `${base.origin}${basePath}`;
    this.apiPrefix = `${basePath}${API_VERSION_PREFIX}`;
    this.authPrefix = `${basePath}${ROOT_AUTH_PATH}`;
    this.credentialHeaders = credentialHeaders(options);
    this.timeout = options.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  getBaseUrl(): string {
    return `${this.baseUrl}${API_VERSION_PREFIX}`;
  }

  /**
   * Builds the request URL and checks the result, so the check sees what fetch
   * will request.
   * - The path (before "?") must be printable ASCII with no "\\" or "#", and
   *   every segment unreserved characters, never "." or ".." in any encoding.
   *   Dot segments are rejected even when they would resolve inside /v1: a
   *   typed command must not reach a different resource.
   * - A relative path lands under <base>/v1/; an absolute URL (only
   *   APIClient.getRootUrl() builds them) may also be a root auth path.
   * - Same origin, no userinfo. The query is re-encoded through URLSearchParams,
   *   so a decoded query (rawRequest decodes before calling here) still works.
   */
  private resolveUrl(requested: string): URL {
    const queryStart = requested.indexOf('?');
    const rawPath = queryStart === -1 ? requested : requested.slice(0, queryStart);
    const rawQuery = queryStart === -1 ? '' : requested.slice(queryStart + 1);
    if (!PRINTABLE_ASCII.test(rawPath) || RAW_URL_FORBIDDEN.test(requested)) {
      throw new Error(`Invalid API path: only printable ASCII without "\\" or "#" is allowed: ${JSON.stringify(requested)}`);
    }

    let url: URL;
    if (ABSOLUTE_URL_PATTERN.test(rawPath)) {
      // Only APIClient.getRootUrl() builds absolute URLs, and only for the root
      // auth paths, so require one of those exactly as written (case-folded
      // scheme and host aside): nothing for URL parsing to normalise.
      url = new URL(rawPath);
      if (url.origin !== this.origin) {
        throw new Error(`Absolute URLs to other origins are not permitted: ${requested}`);
      }
      const written = rawPath.slice(rawPath.indexOf('//') + 2);
      const writtenPath = written.slice(written.indexOf('/') >>> 0);
      if (written.includes('@') || url.pathname !== writtenPath || !url.pathname.startsWith(this.authPrefix)
        || !ROOT_AUTH_SUBPATH.test(url.pathname.slice(this.authPrefix.length))) {
        throw new Error(`Invalid API path: absolute URLs may only be the root auth paths: ${requested}`);
      }
    } else {
      if (!rawPath.startsWith('/') || rawPath.startsWith('//') || !isAllowedPathSuffix(rawPath)) {
        throw new Error(`Invalid API path: must be "/"-prefixed segments of unreserved characters, without "." or "..": ${requested}`);
      }
      url = new URL(`${this.origin}${this.apiPrefix}${rawPath}`);
      if (!url.pathname.startsWith(`${this.apiPrefix}/`)) {
        throw new Error(`Invalid API path: outside the API base: ${requested}`);
      }
    }
    for (const [key, value] of new URLSearchParams(rawQuery)) {
      url.searchParams.append(key, value);
    }
    return url;
  }

  async request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    const target = this.resolveUrl(config.url);
    // Merged with any query already in the path, never a second "?".
    for (const [key, value] of Object.entries(config.params ?? {})) {
      if (value !== undefined && value !== null) {
        target.searchParams.append(key, String(value));
      }
    }
    const url = target.toString();

    // Header names are case-insensitive, so set() replaces a request header
    // of any casing. Credential headers go last so a request header can never
    // replace them.
    const headers = new Headers({
      'Content-Type': 'application/json',
      'User-Agent': `ABsmartly-MCP-Server/${MCP_VERSION} (CLI-core/${CLI_CORE_VERSION})`,
    });
    for (const [name, value] of Object.entries(config.headers ?? {})) {
      headers.set(name, value);
    }
    for (const [name, value] of Object.entries(this.credentialHeaders)) {
      headers.set(name, value);
    }

    // Redirects are not followed: the origin check above covers only the first
    // URL, and a followed redirect would carry the credential to wherever it
    // points. A 3xx response fails the !response.ok check below.
    const fetchOptions: RequestInit = {
      method: config.method,
      headers,
      redirect: FETCH_REDIRECT_MODE,
      signal: AbortSignal.timeout(this.timeout),
    };

    if (config.data !== undefined) {
      fetchOptions.body = JSON.stringify(config.data);
    }

    debug(`🔗 FetchHttpClient: ${config.method} ${url}`);

    let response: Response;
    try {
      response = await fetch(url, fetchOptions);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new Error(`Request timed out after ${this.timeout}ms: ${config.method} ${url}`);
      }
      throw new Error(`Network error for ${config.method} ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!response.ok) {
      let errorBody: string;
      try {
        errorBody = await response.text();
      } catch {
        errorBody = 'Unable to read response body';
      }
      throw new Error(`HTTP ${response.status} for ${config.method} ${url}: ${errorBody}`);
    }

    let data: T;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        data = await response.json() as T;
      } catch (error) {
        throw new Error(`Failed to parse JSON response for ${config.method} ${url}: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      const text = await response.text();
      data = { message: text } as T;
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    debug(`📡 FetchHttpClient: ${response.status} ${config.method} ${url}`);

    return {
      status: response.status,
      data,
      headers: responseHeaders,
    };
  }
}
