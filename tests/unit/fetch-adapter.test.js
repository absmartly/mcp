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

  const total = passed + failed;
  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: total,
    details
  };
}
