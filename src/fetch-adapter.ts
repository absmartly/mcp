import type { HttpClient, HttpRequestConfig, HttpResponse } from '@absmartly/cli/api-client';
import { debug } from './config.js';
import { MCP_VERSION, CLI_CORE_VERSION } from './version.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const API_VERSION_PREFIX = '/v1';
const ABSOLUTE_URL_PATTERN = /^https?:\/\//i;
const FETCH_REDIRECT_MODE = 'manual';
// APIClient.getRootUrl() requests (getCurrentUser, the auth API-key methods)
// are the only ones outside /v1. Every other path must stay under /v1.
const ROOT_AUTH_PATH = '/auth/current-user';
// Percent-decoding passes applied when looking for hidden dot segments; covers
// double and triple encoding (%252e, %25252e).
const MAX_DECODE_PASSES = 3;
// A path segment that URL parsing turns into "." or "..", in any encoding.
const DOT_SEGMENT = /^\.{1,2}$/;
const ENCODED_SEPARATOR = /%(2f|5c)/i;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/**
 * Rejects a request path that URL parsing could move outside the prefix it
 * was built under: dot segments (also percent-encoded, %2e/%2E, at any depth),
 * backslashes (WHATWG URL treats them as "/"), encoded separators (%2f, %5c),
 * empty segments and control characters. Runs before the URL is built, so
 * fetch never gets the chance to normalise the path.
 */
export function assertSafeRequestPath(path: string): void {
  let decoded = path;
  for (let pass = 0; pass <= MAX_DECODE_PASSES; pass++) {
    if (decoded.includes('\\') || CONTROL_CHARACTER.test(decoded) || ENCODED_SEPARATOR.test(decoded)) {
      throw new Error(`Invalid API path: backslashes, encoded separators and control characters are not allowed: ${path}`);
    }
    const segments = decoded.split('/').slice(1);
    if (segments.some((segment, i) => DOT_SEGMENT.test(segment) || (segment === '' && i < segments.length - 1))) {
      throw new Error(`Invalid API path: dot segments and empty segments are not allowed: ${path}`);
    }
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new Error(`Invalid API path: malformed percent-encoding: ${path}`);
    }
    if (next === decoded) return;
    decoded = next;
  }
  throw new Error(`Invalid API path: too many levels of percent-encoding: ${path}`);
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
  private credentialHeaders: Record<string, string>;
  private timeout: number;

  constructor(baseUrl: string, options: FetchHttpClientOptions) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    if (this.baseUrl.endsWith(API_VERSION_PREFIX)) {
      this.baseUrl = this.baseUrl.substring(0, this.baseUrl.length - API_VERSION_PREFIX.length);
    }
    this.credentialHeaders = credentialHeaders(options);
    this.timeout = options.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  getBaseUrl(): string {
    return `${this.baseUrl}${API_VERSION_PREFIX}`;
  }

  /**
   * Builds the request URL, allowing only paths under the configured base's
   * /v1, plus the same-origin root auth paths APIClient.getRootUrl() builds.
   * A cross-origin absolute URL is rejected: accepting one would send the
   * attached credential to an arbitrary host.
   */
  private resolveUrl(requested: string): string {
    const base = new URL(this.baseUrl);
    const basePath = base.pathname.replace(/\/$/, '');
    const apiPrefix = `${basePath}${API_VERSION_PREFIX}`;
    const authPrefix = `${basePath}${ROOT_AUTH_PATH}`;

    let path: string;
    if (ABSOLUTE_URL_PATTERN.test(requested)) {
      const parsed = new URL(requested);
      if (parsed.origin !== base.origin) {
        throw new Error(`Absolute URLs to other origins are not permitted: ${requested}`);
      }
      // Check the path as written, not as URL parsing normalised it.
      path = requested.slice(requested.indexOf('/', requested.indexOf('//') + 2)).split(/[?#]/)[0];
      assertSafeRequestPath(path);
      if (!(path === authPrefix || path.startsWith(`${authPrefix}/`) || path.startsWith(`${apiPrefix}/`))) {
        throw new Error(`Absolute URLs outside the API base are not permitted: ${requested}`);
      }
    } else {
      if (!requested.startsWith('/') || requested.startsWith('//')) {
        throw new Error(`Invalid API path: must be a single "/"-prefixed path relative to ${API_VERSION_PREFIX}: ${requested}`);
      }
      if (requested.includes('#')) {
        throw new Error(`Invalid API path: fragments are not allowed: ${requested}`);
      }
      const [relativePath] = requested.split('?');
      assertSafeRequestPath(relativePath);
      path = `${apiPrefix}${relativePath}`;
      requested = `${base.origin}${apiPrefix}${requested}`;
    }

    // Defense in depth: what fetch will request must still be under the prefix.
    const resolved = new URL(requested).pathname;
    if (!(resolved === authPrefix || resolved.startsWith(`${authPrefix}/`) || resolved.startsWith(`${apiPrefix}/`))) {
      throw new Error(`Request path resolves outside the API base: ${path}`);
    }
    return requested;
  }

  async request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    let url = this.resolveUrl(config.url);

    if (config.params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(config.params)) {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      }
      const query = searchParams.toString();
      if (query) {
        url += `?${query}`;
      }
    }

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
