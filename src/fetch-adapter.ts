import type { HttpClient, HttpRequestConfig, HttpResponse } from '@absmartly/cli/api-client';
import { debug } from './config.js';
import { MCP_VERSION, CLI_CORE_VERSION } from './version.js';
import { parseAbsmartlyEndpoint, PRINTABLE_ASCII } from './oauth/endpoint.js';

export { InvalidEndpointError } from './oauth/endpoint.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const API_VERSION_PREFIX = '/v1';
const ABSOLUTE_URL_PATTERN = /^https?:\/\//i;
const FETCH_REDIRECT_MODE = 'manual';
// APIClient.getRootUrl() requests (getCurrentUser, the auth API-key methods)
// are the only ones outside /v1, and they use exactly these paths.
const ROOT_AUTH_PATH = '/auth/current-user';
const ROOT_AUTH_SUBPATH = /^(?:\/api_keys(?:\/[0-9]+)?)?$/;
// In the path, characters WHATWG URL reinterprets ("\\" as "/") or that start
// a fragment. In the query, only "\\": a literal "#" can be a decoded value.
const PATH_FORBIDDEN = /[\\#]/;
const QUERY_FORBIDDEN = /[\\\u0000-\u001f\u007f]/;
// A path segment: RFC 3986 unreserved characters, or percent-escapes of them.
const PATH_SEGMENT = /^(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+$/;
const UNRESERVED = /^[A-Za-z0-9._~-]+$/;
const DOT_SEGMENT = /^\.{1,2}$/;
const MESSAGE_INVALID_PATH = 'Invalid API path';

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

function invalidPath(detail: string, requested: string): Error {
  return new Error(`${MESSAGE_INVALID_PATH}: ${detail}: ${JSON.stringify(requested)}`);
}

/**
 * Appends a query to `url`. APIClient.rawRequest decodes its whole path, query
 * included, before calling here, so a value's own "&", "=" or "#" can no longer
 * be told from a separator: such a query is split at "&" and "=" as written,
 * which is the only reading available. "&", "=" and "#" inside values survive
 * only when the caller percent-encodes them twice for rawRequest, or uses an
 * APIClient method that passes params separately.
 */
function appendQuery(url: URL, rawQuery: string, requested: string): void {
  if (QUERY_FORBIDDEN.test(rawQuery)) throw invalidPath('backslashes and control characters are not allowed in the query', requested);
  for (const [key, value] of new URLSearchParams(rawQuery)) {
    url.searchParams.append(key, value);
  }
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
  private origin: string;
  private basePath: string;
  private credentialHeaders: Record<string, string>;
  private timeout: number;

  constructor(baseUrl: string, options: FetchHttpClientOptions) {
    const endpoint = parseAbsmartlyEndpoint(baseUrl);
    this.origin = endpoint.origin;
    this.basePath = endpoint.basePath;
    this.credentialHeaders = credentialHeaders(options);
    this.timeout = options.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  private get apiPrefix(): string {
    return `${this.basePath}${API_VERSION_PREFIX}`;
  }

  private get authPrefix(): string {
    return `${this.basePath}${ROOT_AUTH_PATH}`;
  }

  getBaseUrl(): string {
    return `${this.origin}${this.apiPrefix}`;
  }

  /**
   * Builds the request URL and checks the result, so the check sees what fetch
   * will request.
   * - The path (before "?") must be printable ASCII with no "\\" or "#", and
   *   every segment unreserved characters, never "." or ".." in any encoding.
   *   Dot segments are rejected even when they would resolve inside /v1: a
   *   typed command must not reach a different resource.
   * - A relative path lands under <base>/v1/. An absolute URL (only
   *   APIClient.getRootUrl() builds them) must be same-origin, carry no
   *   credentials, and be one of the root auth paths exactly as written.
   * - The query is re-encoded through URLSearchParams (see appendQuery).
   */
  private resolveUrl(requested: string): URL {
    const queryStart = requested.indexOf('?');
    const rawPath = queryStart === -1 ? requested : requested.slice(0, queryStart);
    const rawQuery = queryStart === -1 ? '' : requested.slice(queryStart + 1);
    if (!PRINTABLE_ASCII.test(rawPath) || PATH_FORBIDDEN.test(rawPath)) {
      throw invalidPath('only printable ASCII without "\\" or "#" is allowed in the path', requested);
    }

    let url: URL;
    if (ABSOLUTE_URL_PATTERN.test(rawPath)) {
      try {
        url = new URL(rawPath);
      } catch {
        throw invalidPath('malformed absolute URL', requested);
      }
      if (url.origin !== this.origin) {
        throw new Error(`Absolute URLs to other origins are not permitted: ${requested}`);
      }
      if (url.username || url.password) {
        throw invalidPath('absolute URLs may not carry credentials', requested);
      }
      // URL parsing already resolved any dot segments, so compare the path as
      // written: it starts at the first "/" after the authority.
      const afterScheme = rawPath.slice(rawPath.indexOf('//') + 2);
      const pathStart = afterScheme.indexOf('/');
      const writtenPath = pathStart === -1 ? '/' : afterScheme.slice(pathStart);
      if (url.pathname !== writtenPath || !url.pathname.startsWith(this.authPrefix)
        || !ROOT_AUTH_SUBPATH.test(url.pathname.slice(this.authPrefix.length))) {
        throw invalidPath('absolute URLs may only be the root auth paths', requested);
      }
    } else {
      if (!rawPath.startsWith('/') || rawPath.startsWith('//') || !isAllowedPathSuffix(rawPath)) {
        throw invalidPath('must be "/"-prefixed segments of unreserved characters, without "." or ".."', requested);
      }
      url = new URL(`${this.origin}${this.apiPrefix}${rawPath}`);
    }
    appendQuery(url, rawQuery, requested);
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
