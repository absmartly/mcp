import type { HttpClient, HttpRequestConfig, HttpResponse } from '@absmartly/cli/api-client';
import { debug } from './config.js';
import { MCP_VERSION, CLI_CORE_VERSION } from './version.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const API_VERSION_PREFIX = '/v1';
const ABSOLUTE_URL_PATTERN = /^https?:\/\//i;

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

  async request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    // A cross-origin absolute URL is rejected: accepting one would let a caller
    // send the attached credential to an arbitrary host. APIClient.getRootUrl()
    // (getCurrentUser, the auth API-key methods) builds a same-origin absolute
    // URL without /v1, so that case passes through as-is.
    let url: string;
    if (ABSOLUTE_URL_PATTERN.test(config.url)) {
      if (new URL(config.url).origin !== new URL(this.baseUrl).origin) {
        throw new Error(`Absolute URLs to other origins are not permitted: ${config.url}`);
      }
      url = config.url;
    } else {
      url = `${this.baseUrl}${API_VERSION_PREFIX}${config.url}`;
    }

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

    // Credential headers go last so a request header can never replace them.
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': `ABsmartly-MCP-Server/${MCP_VERSION} (CLI-core/${CLI_CORE_VERSION})`,
      ...config.headers,
      ...this.credentialHeaders,
    };

    const fetchOptions: RequestInit = {
      method: config.method,
      headers,
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
