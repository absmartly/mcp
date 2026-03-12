import type { HttpClient, HttpRequestConfig, HttpResponse } from '@absmartly/cli/api-client';
import { debug } from './config';
import { MCP_VERSION } from './version';

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
    if (this.baseUrl.endsWith('/v1')) {
      this.baseUrl = this.baseUrl.substring(0, this.baseUrl.length - 3);
    }
    this.authToken = options.authToken;
    this.authType = options.authType;
    this.timeout = options.timeout ?? 30000;
  }

  async request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    let url = `${this.baseUrl}/v1${config.url}`;

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
    };

    if (config.data !== undefined) {
      fetchOptions.body = JSON.stringify(config.data);
    }

    debug(`🔗 FetchHttpClient: ${config.method} ${url}`);

    const response = await fetch(url, fetchOptions);

    let data: T;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = await response.json() as T;
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

export function createFetchHttpClient(
  baseUrl: string,
  options: FetchHttpClientOptions
): FetchHttpClient {
  return new FetchHttpClient(baseUrl, options);
}
