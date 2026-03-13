export default async function runTests() {
  let passed = 0;
  let failed = 0;
  const details = [];

  function assert(condition, name, error = 'Assertion failed') {
    if (condition) {
      passed++;
      details.push({ name, status: 'PASS' });
    } else {
      failed++;
      details.push({ name, status: 'FAIL', error });
    }
  }

  function assertEquals(actual, expected, name) {
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expected);
    assert(actualStr === expectedStr, name, `Expected ${expectedStr}, got ${actualStr}`);
  }

  class FetchHttpClient {
    constructor(baseUrl, options) {
      this.baseUrl = baseUrl.replace(/\/$/, '');
      if (this.baseUrl.endsWith('/v1')) {
        this.baseUrl = this.baseUrl.substring(0, this.baseUrl.length - 3);
      }
      this.authToken = options.authToken;
      this.authType = options.authType;
      this.timeout = options.timeout ?? 30000;
      this.lastFetchArgs = null;
    }

    async request(config) {
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

      const headers = {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'User-Agent': 'ABsmartly-MCP-Server/test',
        ...config.headers,
      };

      const fetchOptions = {
        method: config.method,
        headers,
      };

      if (config.data !== undefined) {
        fetchOptions.body = JSON.stringify(config.data);
      }

      this.lastFetchArgs = { url, options: fetchOptions };

      return this._mockFetch(url, fetchOptions);
    }
  }

  // --- URL Construction ---

  {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    client._mockFetch = async () => ({ status: 200, data: {}, headers: {} });
    await client.request({ method: 'GET', url: '/experiments' });
    assertEquals(client.lastFetchArgs.url, 'https://example.com/v1/experiments', 'URL construction: baseUrl + /v1 + path');
  }

  {
    const client = new FetchHttpClient('https://example.com/', { authToken: 'tok', authType: 'api-key' });
    client._mockFetch = async () => ({ status: 200, data: {}, headers: {} });
    await client.request({ method: 'GET', url: '/experiments' });
    assertEquals(client.lastFetchArgs.url, 'https://example.com/v1/experiments', 'URL construction: strips trailing slash from baseUrl');
  }

  // --- /v1 stripping ---

  {
    const client = new FetchHttpClient('https://example.com/v1', { authToken: 'tok', authType: 'api-key' });
    client._mockFetch = async () => ({ status: 200, data: {}, headers: {} });
    await client.request({ method: 'GET', url: '/experiments' });
    assertEquals(client.lastFetchArgs.url, 'https://example.com/v1/experiments', 'URL construction: strips /v1 suffix to avoid double /v1/v1');
  }

  {
    const client = new FetchHttpClient('https://example.com/v1/', { authToken: 'tok', authType: 'api-key' });
    client._mockFetch = async () => ({ status: 200, data: {}, headers: {} });
    await client.request({ method: 'GET', url: '/experiments' });
    assertEquals(client.lastFetchArgs.url, 'https://example.com/v1/experiments', 'URL construction: strips trailing slash then /v1');
  }

  // --- Auth header ---

  {
    const client = new FetchHttpClient('https://example.com', { authToken: 'my-jwt-token', authType: 'jwt' });
    client._mockFetch = async () => ({ status: 200, data: {}, headers: {} });
    await client.request({ method: 'GET', url: '/experiments' });
    assertEquals(
      client.lastFetchArgs.options.headers['Authorization'],
      'JWT my-jwt-token',
      'Auth header: JWT format for jwt authType'
    );
  }

  {
    const client = new FetchHttpClient('https://example.com', { authToken: 'my-api-key', authType: 'api-key' });
    client._mockFetch = async () => ({ status: 200, data: {}, headers: {} });
    await client.request({ method: 'GET', url: '/experiments' });
    assertEquals(
      client.lastFetchArgs.options.headers['Authorization'],
      'Api-Key my-api-key',
      'Auth header: Api-Key format for api-key authType'
    );
  }

  // --- Query params ---

  {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    client._mockFetch = async () => ({ status: 200, data: {}, headers: {} });
    await client.request({ method: 'GET', url: '/experiments', params: { limit: 10, offset: 20 } });
    assert(
      client.lastFetchArgs.url.includes('limit=10') && client.lastFetchArgs.url.includes('offset=20'),
      'Query params: appended to URL',
      `URL was ${client.lastFetchArgs.url}`
    );
  }

  {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    client._mockFetch = async () => ({ status: 200, data: {}, headers: {} });
    await client.request({ method: 'GET', url: '/experiments', params: { limit: 10, skip: undefined, extra: null } });
    assert(
      client.lastFetchArgs.url.includes('limit=10') &&
      !client.lastFetchArgs.url.includes('skip') &&
      !client.lastFetchArgs.url.includes('extra'),
      'Query params: skips undefined and null values'
    );
  }

  {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    client._mockFetch = async () => ({ status: 200, data: {}, headers: {} });
    await client.request({ method: 'GET', url: '/experiments' });
    assert(
      !client.lastFetchArgs.url.includes('?'),
      'Query params: no ? when no params provided'
    );
  }

  // --- Request body ---

  {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    client._mockFetch = async () => ({ status: 200, data: {}, headers: {} });
    const body = { name: 'test_experiment' };
    await client.request({ method: 'POST', url: '/experiments', data: body });
    assertEquals(
      client.lastFetchArgs.options.body,
      JSON.stringify(body),
      'Request body: JSON-serialized data'
    );
  }

  {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    client._mockFetch = async () => ({ status: 200, data: {}, headers: {} });
    await client.request({ method: 'GET', url: '/experiments' });
    assert(
      client.lastFetchArgs.options.body === undefined,
      'Request body: undefined when no data provided'
    );
  }

  // --- Default timeout ---

  {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    assertEquals(client.timeout, 30000, 'Default timeout: 30000ms');
  }

  {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'api-key', timeout: 5000 });
    assertEquals(client.timeout, 5000, 'Custom timeout: respects provided value');
  }

  // --- Custom headers override ---

  {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    client._mockFetch = async () => ({ status: 200, data: {}, headers: {} });
    await client.request({ method: 'GET', url: '/experiments', headers: { 'X-Custom': 'value' } });
    assertEquals(
      client.lastFetchArgs.options.headers['X-Custom'],
      'value',
      'Custom headers: merged into request headers'
    );
  }

  // --- Method passthrough ---

  {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    client._mockFetch = async () => ({ status: 200, data: {}, headers: {} });
    await client.request({ method: 'PUT', url: '/experiments/1' });
    assertEquals(client.lastFetchArgs.options.method, 'PUT', 'Method: passed through to fetch options');
  }

  // --- Response parsing (re-implements the response handling logic from FetchHttpClient) ---

  class ResponseParsingClient {
    constructor(baseUrl, options) {
      this.baseUrl = baseUrl.replace(/\/$/, '');
      if (this.baseUrl.endsWith('/v1')) {
        this.baseUrl = this.baseUrl.substring(0, this.baseUrl.length - 3);
      }
      this.authToken = options.authToken;
      this.authType = options.authType;
      this.timeout = options.timeout ?? 30000;
    }

    async request(config) {
      const url = `${this.baseUrl}/v1${config.url}`;
      const response = await this._mockFetch(url, {});

      if (!response.ok) {
        let errorBody;
        try { errorBody = await response.text(); } catch { errorBody = 'Unable to read response body'; }
        throw new Error(`HTTP ${response.status} for ${config.method} ${url}: ${errorBody}`);
      }

      let data;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        try {
          data = await response.json();
        } catch (error) {
          throw new Error(`Failed to parse JSON response for ${config.method} ${url}: ${error.message}`);
        }
      } else {
        const text = await response.text();
        data = { message: text };
      }

      const responseHeaders = {};
      for (const [key, value] of response.headers.entries()) {
        responseHeaders[key] = value;
      }

      return { status: response.status, data, headers: responseHeaders };
    }
  }

  {
    const client = new ResponseParsingClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    client._mockFetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ experiments: [] }),
    });
    const result = await client.request({ method: 'GET', url: '/experiments' });
    assertEquals(result.status, 200, 'Response parsing: JSON response returns parsed data');
    assertEquals(result.data, { experiments: [] }, 'Response parsing: JSON data is correct');
  }

  {
    const client = new ResponseParsingClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    client._mockFetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'text/plain']]),
      text: async () => 'Hello, world!',
    });
    const result = await client.request({ method: 'GET', url: '/health' });
    assertEquals(result.data, { message: 'Hello, world!' }, 'Response parsing: non-JSON wraps text in { message }');
  }

  {
    const client = new ResponseParsingClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    client._mockFetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'text/plain']]),
      text: async () => { throw new Error('Stream interrupted'); },
    });
    let threw = false;
    try {
      await client.request({ method: 'GET', url: '/data' });
    } catch (e) {
      threw = true;
      assert(e.message.includes('Stream interrupted'), 'Response parsing: body read error propagates', e.message);
    }
    assert(threw, 'Response parsing: non-JSON body read failure throws instead of returning fake object');
  }

  {
    const client = new ResponseParsingClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    client._mockFetch = async () => ({
      ok: false,
      status: 500,
      headers: new Map(),
      text: async () => 'Internal Server Error',
    });
    let threw = false;
    try {
      await client.request({ method: 'GET', url: '/experiments' });
    } catch (e) {
      threw = true;
      assert(e.message.includes('HTTP 500'), 'Response parsing: HTTP error includes status code', e.message);
      assert(e.message.includes('Internal Server Error'), 'Response parsing: HTTP error includes body', e.message);
    }
    assert(threw, 'Response parsing: non-OK response throws error');
  }

  {
    const client = new ResponseParsingClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    client._mockFetch = async () => ({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => { throw new SyntaxError('Unexpected token'); },
    });
    let threw = false;
    try {
      await client.request({ method: 'GET', url: '/experiments' });
    } catch (e) {
      threw = true;
      assert(e.message.includes('Failed to parse JSON'), 'Response parsing: JSON parse failure throws descriptive error', e.message);
    }
    assert(threw, 'Response parsing: malformed JSON throws error');
  }

  const total = passed + failed;
  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: total,
    details
  };
}
