import type { HttpClient, HttpRequestConfig, HttpResponse } from '@absmartly/cli/api-client';
import { debug } from './config.js';
import { MCP_VERSION, CLI_CORE_VERSION } from './version.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const API_VERSION_PREFIX = '/v1';
const API_VERSION_SUFFIX = /\/v\d+$/i;
const ABSOLUTE_URL_PATTERN = /^https?:\/\//i;
const FETCH_REDIRECT_MODE = 'manual';
// APIClient.getRootUrl() requests (getCurrentUser, the auth API-key methods)
// are the only ones outside /v1, and they use exactly these paths.
const ROOT_AUTH_PATH = '/auth/current-user';
const ROOT_AUTH_SUBPATHS = [/^$/, /^\/api_keys$/, /^\/api_keys\/[0-9]+$/];
// Printable ASCII only: WHATWG URL silently strips tabs, newlines and
// surrounding spaces, and percent-encodes non-ASCII, so none may reach it.
const RAW_URL_CHARACTERS = /^[\x21-\x7e]+$/;
// Characters WHATWG URL reinterprets ("\\" as "/") or that start a fragment.
const RAW_URL_FORBIDDEN = /[\\#]/;
// A path segment: unreserved characters (RFC 3986), or percent-escapes of them.
const PATH_SEGMENT = /^(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+$/;
const UNRESERVED_CHARACTER = /^[A-Za-z0-9._~-]$/;
const DOT_SEGMENT = /^\.{1,2}$/;

/**
 * True when every segment of `path` (a parsed, percent-encoded pathname
 * suffix starting with "/") is unreserved characters only, escaped or not,
 * and not "." or "..". A trailing "/" is allowed; empty middle segments are not.
 */
function isAllowedPathSuffix(path: string): boolean {
  const segments = path.split('/').slice(1);
  return segments.every((segment, i) => {
    if (segment === '') return i === segments.length - 1 && i > 0;
    if (!PATH_SEGMENT.test(segment)) return false;
    const decoded = segment.replace(/%([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    return [...decoded].every((c) => UNRESERVED_CHARACTER.test(c)) && !DOT_SEGMENT.test(decoded);
  });
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
    const base = new URL(baseUrl.trim());
    if (!['http:', 'https:'].includes(base.protocol)) {
      throw new Error(`Invalid API base URL: must be http(s): ${baseUrl}`);
    }
    if (base.username || base.password || base.search || base.hash) {
      throw new Error(`Invalid API base URL: credentials, query and fragment are not allowed: ${baseUrl}`);
    }
    if (!isAllowedPathSuffix(base.pathname) && base.pathname !== '/') {
      throw new Error(`Invalid API base URL path: ${baseUrl}`);
    }
    // Accept the base with or without its API version (".../v1", ".../V2/").
    const basePath = base.pathname.replace(/\/+$/, '').replace(API_VERSION_SUFFIX, '');
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
   * Builds the request URL and checks it after parsing, so the check sees
   * exactly what fetch will request. A relative path must land under
   * <base>/v1/; an absolute URL (only APIClient.getRootUrl() builds them) may
   * also be one of the root auth paths. Every path segment past the prefix
   * must be unreserved characters. Anything else is rejected before fetch,
   * including cross-origin URLs, which would carry the credential elsewhere.
   */
  private resolveUrl(requested: string): URL {
    if (!RAW_URL_CHARACTERS.test(requested) || RAW_URL_FORBIDDEN.test(requested)) {
      throw new Error(`Invalid API path: only printable ASCII without "\\" or "#" is allowed: ${JSON.stringify(requested)}`);
    }
    const absolute = ABSOLUTE_URL_PATTERN.test(requested);
    if (!absolute && (!requested.startsWith('/') || requested.startsWith('//'))) {
      throw new Error(`Invalid API path: must be a single "/"-prefixed path relative to ${API_VERSION_PREFIX}: ${requested}`);
    }
    const url = new URL(absolute ? requested : `${this.origin}${this.apiPrefix}${requested}`);

    if (url.origin !== this.origin) {
      throw new Error(`Absolute URLs to other origins are not permitted: ${requested}`);
    }
    if (url.username || url.password || url.hash) {
      throw new Error(`Invalid API path: credentials and fragments are not permitted: ${requested}`);
    }
    const { pathname } = url;
    const underApi = pathname.startsWith(`${this.apiPrefix}/`) && isAllowedPathSuffix(pathname.slice(this.apiPrefix.length));
    const rootAuth = absolute && (pathname === this.authPrefix || pathname.startsWith(`${this.authPrefix}/`))
      && ROOT_AUTH_SUBPATHS.some((p) => p.test(pathname.slice(this.authPrefix.length)));
    if (!underApi && !rootAuth) {
      throw new Error(`Invalid API path: outside the API base or not an allowed path: ${requested}`);
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
