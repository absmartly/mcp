import assert from 'node:assert';

const DEFAULT_ABSMARTLY_DOMAIN = "absmartly.com";

function normalizeBaseUrl(endpoint) {
  return endpoint.replace(/\/$/, '').replace(/\/v1$/, '');
}

function pickDefined(source, keys) {
  const result = {};
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}

function buildQueryString(params) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  }
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

function buildAuthHeader(authToken, isApiKey) {
  const authType = isApiKey ? 'Api-Key' : 'JWT';
  return {
    'Authorization': `${authType} ${authToken}`,
    'Content-Type': 'application/json',
  };
}

function extractEndpointFromPath(pathname, prefix) {
  if (!pathname.startsWith(prefix + '/')) return null;
  const hostPart = pathname.slice(prefix.length + 1).replace(/\/+$/, '');
  if (!hostPart) return null;
  const host = hostPart.includes('.') ? hostPart : `${hostPart}.${DEFAULT_ABSMARTLY_DOMAIN}`;
  return `https://${host}`;
}

const HTML_ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char]);
}

const DEFAULT_ABSMARTLY_ENDPOINT = "https://sandbox.absmartly.com";

function detectApiKey(request, defaultEndpoint = DEFAULT_ABSMARTLY_ENDPOINT) {
  const url = new URL(request.url);
  const authHeader = request.headers.get("Authorization");

  const endpointFromPath = extractEndpointFromPath(url.pathname, '/sse');

  const apiKeyFromQuery = url.searchParams.get("api_key") || url.searchParams.get("apikey");
  if (apiKeyFromQuery) {
    const endpoint = url.searchParams.get("absmartly-endpoint") ||
                    request.headers.get("x-absmartly-endpoint") ||
                    endpointFromPath;
    return { apiKey: apiKeyFromQuery, endpoint };
  }

  if (authHeader) {
    const parts = authHeader.trim().split(/\s+/);

    if (parts[0] === "Bearer" && parts.length === 2) {
      return { apiKey: null, endpoint: null };
    }

    let apiKey = "";
    let absmartlyEndpoint = url.searchParams.get("absmartly-endpoint") ||
                            request.headers.get("x-absmartly-endpoint") ||
                            endpointFromPath ||
                            "";

    let startIndex = 0;
    if (parts[0] === "Bearer") startIndex = 1;
    if (parts[startIndex] === "Api-Key") startIndex++;

    if (parts[startIndex] && parts[startIndex + 1]) {
      const potentialEndpoint = parts[startIndex];
      if (!potentialEndpoint.includes('.') && !potentialEndpoint.includes('://')) {
        if (!absmartlyEndpoint) absmartlyEndpoint = `https://${potentialEndpoint}.${DEFAULT_ABSMARTLY_DOMAIN}`;
        apiKey = parts[startIndex + 1];
      } else if (potentialEndpoint.includes('.') || potentialEndpoint.includes('://')) {
        if (!absmartlyEndpoint) absmartlyEndpoint = potentialEndpoint.startsWith('http') ? potentialEndpoint : `https://${potentialEndpoint}`;
        apiKey = parts[startIndex + 1];
      } else {
        apiKey = potentialEndpoint;
      }
    } else if (parts[startIndex]) {
      apiKey = parts[startIndex];
    }

    if (apiKey) {
      if (!absmartlyEndpoint) absmartlyEndpoint = defaultEndpoint;
      return { apiKey, endpoint: absmartlyEndpoint };
    }
  }

  return { apiKey: null, endpoint: null };
}

function makeRequest(url, headers = {}) {
  return new Request(url, { headers });
}

async function safeKvPut(kv, key, value, options) {
  if (!kv) return;
  try {
    await kv.put(key, value, options);
  } catch (error) {
    console.warn(`KV put failed for key "${key}":`, error);
  }
}

async function safeKvGet(kv, key) {
  if (!kv) return null;
  try {
    return await kv.get(key);
  } catch (error) {
    console.warn(`KV get failed for key "${key}":`, error);
    return null;
  }
}

export default async function run() {
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
  }

  async function asyncTest(name, fn) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
  }

  console.log('\n📋 shared.test.js');

  test('normalizeBaseUrl strips trailing slash', () => {
    assert.strictEqual(normalizeBaseUrl('https://example.com/'), 'https://example.com');
  });
  test('normalizeBaseUrl strips /v1 suffix', () => {
    assert.strictEqual(normalizeBaseUrl('https://example.com/v1'), 'https://example.com');
  });
  test('normalizeBaseUrl strips trailing slash then /v1', () => {
    assert.strictEqual(normalizeBaseUrl('https://example.com/v1/'), 'https://example.com');
  });
  test('normalizeBaseUrl leaves clean URL alone', () => {
    assert.strictEqual(normalizeBaseUrl('https://example.com'), 'https://example.com');
  });

  test('pickDefined picks only defined keys', () => {
    const source = { a: 1, b: undefined, c: 'hello', d: null, e: 0 };
    const result = pickDefined(source, ['a', 'b', 'c', 'd', 'e']);
    assert.deepStrictEqual(result, { a: 1, c: 'hello', d: null, e: 0 });
  });
  test('pickDefined ignores keys not in source', () => {
    const result = pickDefined({ a: 1 }, ['a', 'b']);
    assert.deepStrictEqual(result, { a: 1 });
  });

  test('buildQueryString returns empty string for no params', () => {
    assert.strictEqual(buildQueryString({}), '');
  });
  test('buildQueryString returns ?-prefixed string', () => {
    const qs = buildQueryString({ page: 1, items: 10 });
    assert.ok(qs.startsWith('?'));
    assert.ok(qs.includes('page=1'));
    assert.ok(qs.includes('items=10'));
  });
  test('buildQueryString excludes undefined and null', () => {
    const qs = buildQueryString({ a: 1, b: undefined, c: null, d: 'ok' });
    assert.ok(!qs.includes('b='));
    assert.ok(!qs.includes('c='));
    assert.ok(qs.includes('a=1'));
    assert.ok(qs.includes('d=ok'));
  });

  test('buildAuthHeader returns Api-Key header for API keys', () => {
    const h = buildAuthHeader('my-token', true);
    assert.strictEqual(h['Authorization'], 'Api-Key my-token');
    assert.strictEqual(h['Content-Type'], 'application/json');
  });
  test('buildAuthHeader returns JWT header for OAuth', () => {
    const h = buildAuthHeader('jwt-token', false);
    assert.strictEqual(h['Authorization'], 'JWT jwt-token');
  });

  test('extractEndpointFromPath returns null when path does not start with prefix', () => {
    assert.strictEqual(extractEndpointFromPath('/other/path', '/sse'), null);
  });
  test('extractEndpointFromPath returns null for prefix without trailing content', () => {
    assert.strictEqual(extractEndpointFromPath('/sse/', '/sse'), null);
  });
  test('extractEndpointFromPath appends .absmartly.com for shortname', () => {
    assert.strictEqual(extractEndpointFromPath('/sse/dev1', '/sse'), 'https://dev1.absmartly.com');
  });
  test('extractEndpointFromPath keeps dotted hostname as-is', () => {
    assert.strictEqual(extractEndpointFromPath('/sse/custom.example.com', '/sse'), 'https://custom.example.com');
  });

  test('escapeHtml escapes all special chars', () => {
    assert.strictEqual(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  });
  test('escapeHtml passes through safe string', () => {
    assert.strictEqual(escapeHtml('hello world'), 'hello world');
  });
  test('escapeHtml handles empty string', () => {
    assert.strictEqual(escapeHtml(''), '');
  });
  test('escapeHtml prevents script injection', () => {
    const result = escapeHtml('<script>alert("xss")</script>');
    assert.ok(!result.includes('<script>'));
    assert.ok(result.includes('&lt;script&gt;'));
  });

  // detectApiKey
  test('detectApiKey returns null for request with no auth', () => {
    const req = makeRequest('https://mcp.example.com/sse');
    const result = detectApiKey(req);
    assert.strictEqual(result.apiKey, null);
    assert.strictEqual(result.endpoint, null);
  });

  test('detectApiKey extracts api_key from query string', () => {
    const req = makeRequest('https://mcp.example.com/sse?api_key=my-key&absmartly-endpoint=https://backend.com');
    const result = detectApiKey(req);
    assert.strictEqual(result.apiKey, 'my-key');
    assert.strictEqual(result.endpoint, 'https://backend.com');
  });

  test('detectApiKey extracts apikey (no underscore) from query string', () => {
    const req = makeRequest('https://mcp.example.com/sse?apikey=my-key');
    const result = detectApiKey(req);
    assert.strictEqual(result.apiKey, 'my-key');
  });

  test('detectApiKey returns null for Bearer token (OAuth)', () => {
    const req = makeRequest('https://mcp.example.com/sse', { 'Authorization': 'Bearer some-jwt-token' });
    const result = detectApiKey(req);
    assert.strictEqual(result.apiKey, null);
    assert.strictEqual(result.endpoint, null);
  });

  test('detectApiKey extracts Api-Key from Authorization header', () => {
    const req = makeRequest('https://mcp.example.com/sse', { 'Authorization': 'Api-Key my-secret-key' });
    const result = detectApiKey(req);
    assert.strictEqual(result.apiKey, 'my-secret-key');
  });

  test('detectApiKey extracts endpoint from path shortname', () => {
    const req = makeRequest('https://mcp.example.com/sse/dev1', { 'Authorization': 'Api-Key my-key' });
    const result = detectApiKey(req);
    assert.strictEqual(result.apiKey, 'my-key');
    assert.strictEqual(result.endpoint, 'https://dev1.absmartly.com');
  });

  test('detectApiKey uses x-absmartly-endpoint header', () => {
    const req = makeRequest('https://mcp.example.com/sse', {
      'Authorization': 'Api-Key my-key',
      'x-absmartly-endpoint': 'https://custom.backend.com'
    });
    const result = detectApiKey(req);
    assert.strictEqual(result.apiKey, 'my-key');
    assert.strictEqual(result.endpoint, 'https://custom.backend.com');
  });

  test('detectApiKey uses default endpoint when none provided', () => {
    const req = makeRequest('https://mcp.example.com/other', { 'Authorization': 'Api-Key my-key' });
    const result = detectApiKey(req);
    assert.strictEqual(result.apiKey, 'my-key');
    assert.strictEqual(result.endpoint, DEFAULT_ABSMARTLY_ENDPOINT);
  });

  test('detectApiKey parses shortname + key from Authorization header', () => {
    const req = makeRequest('https://mcp.example.com/sse', { 'Authorization': 'Api-Key dev1 my-key' });
    const result = detectApiKey(req);
    assert.strictEqual(result.apiKey, 'my-key');
    assert.strictEqual(result.endpoint, 'https://dev1.absmartly.com');
  });

  test('detectApiKey parses dotted endpoint + key from Authorization header', () => {
    const req = makeRequest('https://mcp.example.com/sse', { 'Authorization': 'Api-Key custom.example.com my-key' });
    const result = detectApiKey(req);
    assert.strictEqual(result.apiKey, 'my-key');
    assert.strictEqual(result.endpoint, 'https://custom.example.com');
  });

  // safeKvPut
  await asyncTest('safeKvPut does nothing when kv is undefined', async () => {
    await safeKvPut(undefined, 'key', 'value');
  });

  await asyncTest('safeKvPut calls kv.put with correct args', async () => {
    let capturedArgs = null;
    const mockKv = {
      put: async (key, value, options) => { capturedArgs = { key, value, options }; }
    };
    await safeKvPut(mockKv, 'test-key', 'test-value', { expirationTtl: 300 });
    assert.strictEqual(capturedArgs.key, 'test-key');
    assert.strictEqual(capturedArgs.value, 'test-value');
    assert.strictEqual(capturedArgs.options.expirationTtl, 300);
  });

  await asyncTest('safeKvPut swallows errors silently', async () => {
    const mockKv = {
      put: async () => { throw new Error('KV write failed'); }
    };
    await safeKvPut(mockKv, 'key', 'value');
  });

  // safeKvGet
  await asyncTest('safeKvGet returns null when kv is undefined', async () => {
    const result = await safeKvGet(undefined, 'key');
    assert.strictEqual(result, null);
  });

  await asyncTest('safeKvGet returns value from kv', async () => {
    const mockKv = { get: async (key) => `value-for-${key}` };
    const result = await safeKvGet(mockKv, 'my-key');
    assert.strictEqual(result, 'value-for-my-key');
  });

  await asyncTest('safeKvGet returns null on error', async () => {
    const mockKv = { get: async () => { throw new Error('KV read failed'); } };
    const result = await safeKvGet(mockKv, 'key');
    assert.strictEqual(result, null);
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: passed + failed,
  };
}
