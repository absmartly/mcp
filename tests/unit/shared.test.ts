import assert from 'node:assert';
import {
  normalizeBaseUrl,
  pickDefined,
  buildQueryString,
  buildAuthHeader,
  extractEndpointFromPath,
  isAllowedRedirectUri,
  rejectDisallowedRedirectUris,
  escapeHtml,
  detectApiKey,
  safeKvPut,
  safeKvGet,
  DEFAULT_ABSMARTLY_ENDPOINT,
  DEFAULT_ABSMARTLY_DOMAIN,
} from '../../src/shared';

const TEST_API_KEY = 'test-api-key-fixture';

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
  test('extractEndpointFromPath returns null for /mcp without trailing content', () => {
    assert.strictEqual(extractEndpointFromPath('/mcp/', '/mcp'), null);
  });
  test('extractEndpointFromPath appends domain for /mcp shortname', () => {
    assert.strictEqual(extractEndpointFromPath('/mcp/dev1', '/mcp'), `https://dev1.${DEFAULT_ABSMARTLY_DOMAIN}`);
  });
  test('extractEndpointFromPath keeps dotted /mcp hostname as-is', () => {
    assert.strictEqual(extractEndpointFromPath('/mcp/custom.example.com', '/mcp'), 'https://custom.example.com');
  });
  test('extractEndpointFromPath accepts an array of prefixes and matches /sse', () => {
    assert.strictEqual(
      extractEndpointFromPath('/sse/dev1', ['/sse', '/mcp']),
      `https://dev1.${DEFAULT_ABSMARTLY_DOMAIN}`
    );
  });
  test('extractEndpointFromPath accepts an array of prefixes and matches /mcp', () => {
    assert.strictEqual(
      extractEndpointFromPath('/mcp/dev1', ['/sse', '/mcp']),
      `https://dev1.${DEFAULT_ABSMARTLY_DOMAIN}`
    );
  });
  test('extractEndpointFromPath returns null when none of the prefixes match', () => {
    assert.strictEqual(extractEndpointFromPath('/other/dev1', ['/sse', '/mcp']), null);
  });
  test('extractEndpointFromPath returns null for OAuth discovery probes under the transport prefix', () => {
    assert.strictEqual(
      extractEndpointFromPath('/mcp/.well-known/openid-configuration', ['/sse', '/mcp']),
      null
    );
    assert.strictEqual(
      extractEndpointFromPath('/mcp/.well-known/oauth-authorization-server', ['/sse', '/mcp']),
      null
    );
    assert.strictEqual(extractEndpointFromPath('/mcp/.well-known', ['/sse', '/mcp']), null);
  });
  test('extractEndpointFromPath returns null for multi-segment paths', () => {
    assert.strictEqual(extractEndpointFromPath('/mcp/foo/bar', ['/sse', '/mcp']), null);
  });
  test('extractEndpointFromPath returns null for labels with leading or trailing hyphens', () => {
    assert.strictEqual(extractEndpointFromPath('/mcp/-demo.example.com', ['/sse', '/mcp']), null);
    assert.strictEqual(extractEndpointFromPath('/mcp/demo-.example.com', ['/sse', '/mcp']), null);
    assert.strictEqual(extractEndpointFromPath('/mcp/---.example.com', ['/sse', '/mcp']), null);
    assert.strictEqual(extractEndpointFromPath('/mcp/demo.-example.com', ['/sse', '/mcp']), null);
    assert.strictEqual(extractEndpointFromPath('/mcp/demo.example-.com', ['/sse', '/mcp']), null);
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

  test('detectApiKey extracts endpoint from /mcp path with Authorization header', () => {
    const request = new Request('https://mcp.absmartly.com/mcp/demo-1', {
      headers: { 'Authorization': TEST_API_KEY }
    });
    const result = detectApiKey(request);
    assert.strictEqual(result.apiKey, TEST_API_KEY);
    assert.strictEqual(result.endpoint, `https://demo-1.${DEFAULT_ABSMARTLY_DOMAIN}`);
  });

  test('detectApiKey extracts endpoint from /mcp path with api_key query param', () => {
    const request = new Request(`https://mcp.absmartly.com/mcp/demo-1?api_key=${TEST_API_KEY}`);
    const result = detectApiKey(request);
    assert.strictEqual(result.apiKey, TEST_API_KEY);
    assert.strictEqual(result.endpoint, `https://demo-1.${DEFAULT_ABSMARTLY_DOMAIN}`);
  });

  test('detectApiKey still extracts endpoint from /sse path (regression guard)', () => {
    const request = new Request('https://mcp.absmartly.com/sse/demo-1', {
      headers: { 'Authorization': TEST_API_KEY }
    });
    const result = detectApiKey(request);
    assert.strictEqual(result.endpoint, `https://demo-1.${DEFAULT_ABSMARTLY_DOMAIN}`);
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

  for (const uri of [
    'https://claude.ai/api/mcp/auth_callback',
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'https://chatgpt.com/connector/oauth/abc123',
    'https://playground.ai.cloudflare.com/oauth/callback',
    'http://localhost:33418/callback',
    'http://127.0.0.1:5000/cb',
    'http://[::1]:8080/cb',
    'cursor://anysphere.cursor-mcp/oauth/callback',
    'https://www.cursor.com/agents/mcp/oauth/callback',
    'https://vscode.dev/redirect',
    'https://insiders.vscode.dev/redirect',
    'http://127.0.0.1:33418/',
    'claude://claude.ai/mcp-auth-callback/sdk',
    'https://integrations.productboard.com/oauth2/callback',
  ]) {
    test(`isAllowedRedirectUri allows ${uri}`, () => {
      assert.strictEqual(isAllowedRedirectUri(uri), true);
    });
  }

  for (const uri of [
    'https://attacker.com/cb',
    'https://claude.ai/not-a-callback',
    'https://claude.ai/api/mcp/auth_callback/extra',
    'https://chatgpt.com/connector/oauth/',
    'https://chatgpt.com/share/abc',
    'https://integrations.productboard.com/other',
    'https://vscode.dev/',
    'https://claude.ai.attacker.com/cb',
    'https://attacker.com/claude.ai',
    'http://claude.ai/api/mcp/auth_callback',
    'https://localhost/cb',
    'http://localhost.attacker.com/cb',
    'vscode://vscode.github-authentication/did-authenticate',
    'windsurf://oauth/callback',
    'https://cursor.com.attacker.com/cb',
    'javascript:alert(1)',
    'data:text/html,hi',
    'not a url',
  ]) {
    test(`isAllowedRedirectUri rejects ${uri}`, () => {
      assert.strictEqual(isAllowedRedirectUri(uri), false);
    });
  }

  function registrationRequest(body: unknown): Request {
    return new Request('https://mcp.absmartly.com/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  await asyncTest('rejectDisallowedRedirectUris rejects registration with attacker redirect', async () => {
    const response = await rejectDisallowedRedirectUris(registrationRequest({
      redirect_uris: ['http://localhost:3000/cb', 'https://attacker.com/cb'],
    }));
    assert.ok(response);
    assert.strictEqual(response!.status, 400);
    const body = await response!.json() as { error: string };
    assert.strictEqual(body.error, 'invalid_redirect_uri');
  });

  await asyncTest('rejectDisallowedRedirectUris rejects non-string redirect entries', async () => {
    const response = await rejectDisallowedRedirectUris(registrationRequest({ redirect_uris: [42] }));
    assert.strictEqual(response?.status, 400);
  });

  await asyncTest('rejectDisallowedRedirectUris returns 413 for oversized bodies without reflecting them', async () => {
    const oversizedUri = `https://attacker.com/${'a'.repeat(1024 * 1024)}`;
    const response = await rejectDisallowedRedirectUris(registrationRequest({ redirect_uris: [oversizedUri] }));
    assert.strictEqual(response?.status, 413);
    assert.ok((await response!.text()).length < 200);
  });

  await asyncTest('rejectDisallowedRedirectUris does not reflect the rejected URI', async () => {
    const response = await rejectDisallowedRedirectUris(registrationRequest({ redirect_uris: ['https://attacker.com/cb'] }));
    assert.ok(!(await response!.text()).includes('attacker.com'));
  });

  await asyncTest('rejectDisallowedRedirectUris accepts the full VS Code DCR redirect set', async () => {
    const response = await rejectDisallowedRedirectUris(registrationRequest({
      redirect_uris: [
        'http://127.0.0.1', 'http://127.0.0.1/', 'http://127.0.0.1:33418', 'http://127.0.0.1:33418/',
        'http://localhost', 'http://localhost/', 'http://localhost:33418', 'http://localhost:33418/',
        'https://insiders.vscode.dev/redirect', 'https://vscode.dev/redirect',
      ],
    }));
    assert.strictEqual(response, null);
  });

  await asyncTest('rejectDisallowedRedirectUris passes allowed redirects and leaves body readable', async () => {
    const request = registrationRequest({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
    assert.strictEqual(await rejectDisallowedRedirectUris(request), null);
    const body = await request.json() as { redirect_uris: string[] };
    assert.deepStrictEqual(body.redirect_uris, ['https://claude.ai/api/mcp/auth_callback']);
  });

  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: passed + failed,
    details,
  };
}
