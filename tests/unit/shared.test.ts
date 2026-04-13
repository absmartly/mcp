import assert from 'node:assert';
import {
  normalizeBaseUrl,
  pickDefined,
  buildQueryString,
  buildAuthHeader,
  extractEndpointFromPath,
  escapeHtml,
  detectApiKey,
  safeKvPut,
  safeKvGet,
  DEFAULT_ABSMARTLY_ENDPOINT,
  DEFAULT_ABSMARTLY_DOMAIN,
} from '../../src/shared';

export default async function run() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];

  function test(name: string, fn: () => void) {
    try { fn(); passed++; details.push({ name, status: 'PASS' }); }
    catch (e: any) { failed++; details.push({ name, status: 'FAIL', error: e.message }); }
  }

  async function asyncTest(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; details.push({ name, status: 'PASS' }); }
    catch (e: any) { failed++; details.push({ name, status: 'FAIL', error: e.message }); }
  }

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
    const result = pickDefined(source as Record<string, unknown>, ['a', 'b', 'c', 'd', 'e']);
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
  test('extractEndpointFromPath appends domain for shortname', () => {
    assert.strictEqual(extractEndpointFromPath('/sse/dev1', '/sse'), `https://dev1.${DEFAULT_ABSMARTLY_DOMAIN}`);
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

  test('detectApiKey returns null for request with no auth', () => {
    const req = new Request('https://mcp.example.com/sse');
    const result = detectApiKey(req);
    assert.strictEqual(result.apiKey, null);
    assert.strictEqual(result.endpoint, null);
  });
  test('detectApiKey extracts api_key from query string', () => {
    const req = new Request('https://mcp.example.com/sse?api_key=my-key&absmartly-endpoint=https://backend.com');
    const result = detectApiKey(req);
    assert.strictEqual(result.apiKey, 'my-key');
    assert.strictEqual(result.endpoint, 'https://backend.com');
  });
  test('detectApiKey extracts apikey (no underscore) from query string', () => {
    const req = new Request('https://mcp.example.com/sse?apikey=my-key');
    const result = detectApiKey(req);
    assert.strictEqual(result.apiKey, 'my-key');
  });
  test('detectApiKey returns null for Bearer token (OAuth)', () => {
    const req = new Request('https://mcp.example.com/sse', { headers: { 'Authorization': 'Bearer some-jwt-token' } });
    const result = detectApiKey(req);
    assert.strictEqual(result.apiKey, null);
  });
  test('detectApiKey extracts Api-Key from Authorization header', () => {
    const req = new Request('https://mcp.example.com/sse', { headers: { 'Authorization': 'Api-Key my-secret-key' } });
    const result = detectApiKey(req);
    assert.strictEqual(result.apiKey, 'my-secret-key');
  });
  test('detectApiKey extracts endpoint from path shortname', () => {
    const req = new Request('https://mcp.example.com/sse/dev1', { headers: { 'Authorization': 'Api-Key my-key' } });
    const result = detectApiKey(req);
    assert.strictEqual(result.apiKey, 'my-key');
    assert.strictEqual(result.endpoint, `https://dev1.${DEFAULT_ABSMARTLY_DOMAIN}`);
  });
  test('detectApiKey uses x-absmartly-endpoint header', () => {
    const req = new Request('https://mcp.example.com/sse', {
      headers: { 'Authorization': 'Api-Key my-key', 'x-absmartly-endpoint': 'https://custom.backend.com' }
    });
    const result = detectApiKey(req);
    assert.strictEqual(result.endpoint, 'https://custom.backend.com');
  });
  test('detectApiKey uses default endpoint when none provided', () => {
    const req = new Request('https://mcp.example.com/other', { headers: { 'Authorization': 'Api-Key my-key' } });
    const result = detectApiKey(req);
    assert.strictEqual(result.endpoint, DEFAULT_ABSMARTLY_ENDPOINT);
  });
  test('detectApiKey parses shortname + key from Authorization header', () => {
    const req = new Request('https://mcp.example.com/sse', { headers: { 'Authorization': 'Api-Key dev1 my-key' } });
    const result = detectApiKey(req);
    assert.strictEqual(result.apiKey, 'my-key');
    assert.strictEqual(result.endpoint, `https://dev1.${DEFAULT_ABSMARTLY_DOMAIN}`);
  });
  test('detectApiKey parses Bearer endpoint key (3-token)', () => {
    const req = new Request('https://mcp.example.com/sse', { headers: { 'Authorization': 'Bearer dev1 my-key' } });
    const result = detectApiKey(req);
    assert.strictEqual(result.apiKey, 'my-key');
    assert.strictEqual(result.endpoint, `https://dev1.${DEFAULT_ABSMARTLY_DOMAIN}`);
  });
  test('detectApiKey query param path falls back to default endpoint', () => {
    const req = new Request('https://mcp.example.com/other?api_key=my-key');
    const result = detectApiKey(req);
    assert.strictEqual(result.apiKey, 'my-key');
    assert.strictEqual(result.endpoint, DEFAULT_ABSMARTLY_ENDPOINT);
  });

  await asyncTest('safeKvPut does nothing when kv is undefined', async () => {
    await safeKvPut(undefined, 'key', 'value');
  });
  await asyncTest('safeKvPut calls kv.put with correct args', async () => {
    let capturedArgs: any = null;
    const mockKv = { put: async (key: string, value: string, options: any) => { capturedArgs = { key, value, options }; } } as unknown as KVNamespace;
    await safeKvPut(mockKv, 'test-key', 'test-value', { expirationTtl: 300 });
    assert.strictEqual(capturedArgs.key, 'test-key');
    assert.strictEqual(capturedArgs.value, 'test-value');
    assert.strictEqual(capturedArgs.options.expirationTtl, 300);
  });
  await asyncTest('safeKvPut swallows errors silently', async () => {
    const mockKv = { put: async () => { throw new Error('KV write failed'); } } as unknown as KVNamespace;
    await safeKvPut(mockKv, 'key', 'value');
  });

  await asyncTest('safeKvGet returns null when kv is undefined', async () => {
    const result = await safeKvGet(undefined, 'key');
    assert.strictEqual(result, null);
  });
  await asyncTest('safeKvGet returns value from kv', async () => {
    const mockKv = { get: async (key: string) => `value-for-${key}` } as unknown as KVNamespace;
    const result = await safeKvGet(mockKv, 'my-key');
    assert.strictEqual(result, 'value-for-my-key');
  });
  await asyncTest('safeKvGet returns null on error', async () => {
    const mockKv = { get: async () => { throw new Error('KV read failed'); } } as unknown as KVNamespace;
    const result = await safeKvGet(mockKv, 'key');
    assert.strictEqual(result, null);
  });

  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: passed + failed,
    details,
  };
}
