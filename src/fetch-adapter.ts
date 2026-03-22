import type { HttpClient, HttpRequestConfig, HttpResponse } from '@absmartly/cli/api-client';
import { debug } from './config';
import { MCP_VERSION } from './version';

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const API_VERSION_PREFIX = '/v1';

export interface FetchHttpClientOptions {
  authToken: string;
  authType: 'jwt' | 'api-key';
  timeout?: number;
}

export class FetchHttpClient implements HttpClient {
  private baseUrl: string;
  private authToken: string;
  private authType: 'jwt' | 'api-key';
  private timeout: number;

  constructor(baseUrl: string, options: FetchHttpClientOptions) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    if (this.baseUrl.endsWith(API_VERSION_PREFIX)) {
      this.baseUrl = this.baseUrl.substring(0, this.baseUrl.length - API_VERSION_PREFIX.length);
    }
    this.authToken = options.authToken;
    this.authType = options.authType;
    this.timeout = options.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  getBaseUrl(): string {
    return `${this.baseUrl}${API_VERSION_PREFIX}`;
  }

  async request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    let url = config.url.startsWith('http://') || config.url.startsWith('https://')
      ? config.url
      : `${this.baseUrl}${API_VERSION_PREFIX}${config.url}`;

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

    const authHeader = this.authType === 'jwt'
      ? `JWT ${this.authToken}`
      : `Api-Key ${this.authToken}`;

    const headers: Record<string, string> = {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'User-Agent': `ABsmartly-MCP-Server/${MCP_VERSION}`,
      ...config.headers,
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
    for (const [key, value] of response.headers.entries()) {
      responseHeaders[key] = value;
    }

    debug(`📡 FetchHttpClient: ${response.status} ${config.method} ${url}`);

    return {
      status: response.status,
      data,
      headers: responseHeaders,
    };
  }
}
