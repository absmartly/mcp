import assert from 'node:assert';
import { APIClient } from '@absmartly/cli/api-client';
import { FetchHttpClient } from '../../src/fetch-adapter';

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string | URL | Request, options?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

export default async function runTests() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];

  function ok(condition: boolean, name: string, error = 'Assertion failed') {
    if (condition) { passed++; details.push({ name, status: 'PASS' }); }
    else { failed++; details.push({ name, status: 'FAIL', error }); }
  }

  function assertEquals(actual: unknown, expected: unknown, name: string) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    ok(a === b, name, `Expected ${b}, got ${a}`);
  }

  async function asyncTest(name: string, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e: any) {
      failed++;
      details.push({ name, status: 'FAIL', error: e.message });
    }
  }

  await asyncTest('URL: baseUrl + /v1 + path', async () => {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    let capturedUrl = '';
    mockFetch(async (url) => { capturedUrl = String(url); return new Response('{}', { headers: { 'content-type': 'application/json' } }); });
    await client.request({ method: 'GET', url: '/experiments' });
    assertEquals(capturedUrl, 'https://example.com/v1/experiments', 'URL: baseUrl + /v1 + path');
    restoreFetch();
  });

  await asyncTest('URL: strips trailing slash', async () => {
    const client = new FetchHttpClient('https://example.com/', { authToken: 'tok', authType: 'api-key' });
    let capturedUrl = '';
    mockFetch(async (url) => { capturedUrl = String(url); return new Response('{}', { headers: { 'content-type': 'application/json' } }); });
    await client.request({ method: 'GET', url: '/experiments' });
    assertEquals(capturedUrl, 'https://example.com/v1/experiments', 'URL: strips trailing slash');
    restoreFetch();
  });

  await asyncTest('URL: avoids double /v1/v1', async () => {
    const client = new FetchHttpClient('https://example.com/v1', { authToken: 'tok', authType: 'api-key' });
    let capturedUrl = '';
    mockFetch(async (url) => { capturedUrl = String(url); return new Response('{}', { headers: { 'content-type': 'application/json' } }); });
    await client.request({ method: 'GET', url: '/experiments' });
    assertEquals(capturedUrl, 'https://example.com/v1/experiments', 'URL: avoids double /v1/v1');
    restoreFetch();
  });

  await asyncTest('Auth: JWT format', async () => {
    const client = new FetchHttpClient('https://example.com', { authToken: 'my-jwt', authType: 'jwt' });
    let capturedHeaders = new Headers();
    mockFetch(async (_url, opts) => {
      capturedHeaders = new Headers(opts?.headers);
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    });
    await client.request({ method: 'GET', url: '/test' });
    assertEquals(capturedHeaders.get('Authorization'), 'JWT my-jwt', 'Auth: JWT format');
    restoreFetch();
  });

  await asyncTest('Auth: Api-Key format', async () => {
    const client = new FetchHttpClient('https://example.com', { authToken: 'my-key', authType: 'api-key' });
    let capturedHeaders = new Headers();
    mockFetch(async (_url, opts) => {
      capturedHeaders = new Headers(opts?.headers);
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    });
    await client.request({ method: 'GET', url: '/test' });
    assertEquals(capturedHeaders.get('Authorization'), 'Api-Key my-key', 'Auth: Api-Key format');
    restoreFetch();
  });

  await asyncTest('Query params: appended', async () => {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    let capturedUrl = '';
    mockFetch(async (url) => { capturedUrl = String(url); return new Response('{}', { headers: { 'content-type': 'application/json' } }); });
    await client.request({ method: 'GET', url: '/experiments', params: { limit: 10, offset: 20 } });
    ok(capturedUrl.includes('limit=10') && capturedUrl.includes('offset=20'), 'Query params: appended');
    restoreFetch();
  });

  await asyncTest('Query params: skip undefined/null', async () => {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    let capturedUrl = '';
    mockFetch(async (url) => { capturedUrl = String(url); return new Response('{}', { headers: { 'content-type': 'application/json' } }); });
    await client.request({ method: 'GET', url: '/experiments', params: { limit: 10, skip: undefined, extra: null } });
    ok(capturedUrl.includes('limit=10') && !capturedUrl.includes('skip') && !capturedUrl.includes('extra'), 'Query params: skip undefined/null');
    restoreFetch();
  });

  await asyncTest('Body: JSON serialized', async () => {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    let capturedBody: string | undefined;
    mockFetch(async (_url, opts) => { capturedBody = opts?.body as string; return new Response('{}', { headers: { 'content-type': 'application/json' } }); });
    await client.request({ method: 'POST', url: '/experiments', data: { name: 'test' } });
    assertEquals(capturedBody, JSON.stringify({ name: 'test' }), 'Body: JSON serialized');
    restoreFetch();
  });

  await asyncTest('Response: parsed JSON data', async () => {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    mockFetch(async () => new Response(JSON.stringify({ experiments: [] }), { headers: { 'content-type': 'application/json' } }));
    const result = await client.request({ method: 'GET', url: '/experiments' });
    assertEquals(result.status, 200, 'Response: status 200');
    assertEquals(result.data, { experiments: [] }, 'Response: parsed JSON data');
    restoreFetch();
  });

  await asyncTest('Response: non-JSON wraps in message', async () => {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    mockFetch(async () => new Response('Hello', { headers: { 'content-type': 'text/plain' } }));
    const result = await client.request<{ message: string }>({ method: 'GET', url: '/health' });
    assertEquals(result.data.message, 'Hello', 'Response: non-JSON wraps in { message }');
    restoreFetch();
  });

  await asyncTest('Error: non-OK response throws', async () => {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    mockFetch(async () => new Response('Internal Server Error', { status: 500, headers: { 'content-type': 'text/plain' } }));
    let threw = false;
    try { await client.request({ method: 'GET', url: '/experiments' }); }
    catch (e: any) { threw = true; ok(e.message.includes('HTTP 500'), 'Error: includes status code'); }
    ok(threw, 'Error: non-OK response throws');
    restoreFetch();
  });

  await asyncTest('Error: malformed JSON throws', async () => {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    mockFetch(async () => new Response('not json', { headers: { 'content-type': 'application/json' } }));
    let threw = false;
    try { await client.request({ method: 'GET', url: '/experiments' }); }
    catch (e: any) { threw = true; ok(e.message.includes('Failed to parse JSON'), 'Error: JSON parse failure message'); }
    ok(threw, 'Error: malformed JSON throws');
    restoreFetch();
  });

  await asyncTest('Error: network failure throws', async () => {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    mockFetch(async () => { throw new Error('Connection refused'); });
    let threw = false;
    try { await client.request({ method: 'GET', url: '/experiments' }); }
    catch (e: any) { threw = true; ok(e.message.includes('Network error'), 'Error: network error message'); ok(e.message.includes('Connection refused'), 'Error: includes original message'); }
    ok(threw, 'Error: network failure throws');
    restoreFetch();
  });

  await asyncTest('Auth: Service-Key with impersonated user', async () => {
    const client = new FetchHttpClient('https://example.com', { authToken: 'svc', authType: 'service-key', impersonatedUserId: 42 });
    let capturedHeaders = new Headers();
    mockFetch(async (_url, opts) => { capturedHeaders = new Headers(opts?.headers); return new Response('{}', { headers: { 'content-type': 'application/json' } }); });
    await client.request({ method: 'GET', url: '/test' });
    assertEquals(capturedHeaders.get('Authorization'), 'Service-Key svc', 'Auth: Service-Key scheme');
    assertEquals(capturedHeaders.get('Service-Key-Impersonating-UserId'), '42', 'Auth: impersonated user header');
    restoreFetch();
  });

  await asyncTest('Auth: request headers cannot override the credential', async () => {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'jwt' });
    let capturedHeaders = new Headers();
    mockFetch(async (_url, opts) => { capturedHeaders = new Headers(opts?.headers); return new Response('{}', { headers: { 'content-type': 'application/json' } }); });
    await client.request({ method: 'GET', url: '/test', headers: { Authorization: 'Api-Key stolen', 'X-Extra': '1' } });
    assertEquals(capturedHeaders.get('Authorization'), 'JWT tok', 'Auth: credential wins over request header');
    assertEquals(capturedHeaders.get('X-Extra'), '1', 'Headers: other request headers pass through');
    restoreFetch();
  });

  await asyncTest('Auth: differently cased request headers cannot override the credential', async () => {
    const client = new FetchHttpClient('https://example.com', { authToken: 'svc', authType: 'service-key', impersonatedUserId: 42 });
    let capturedHeaders = new Headers();
    mockFetch(async (_url, opts) => { capturedHeaders = new Headers(opts?.headers); return new Response('{}', { headers: { 'content-type': 'application/json' } }); });
    await client.request({ method: 'GET', url: '/test', headers: { authorization: 'Api-Key stolen', 'service-key-impersonating-userid': '1' } });
    assertEquals(capturedHeaders.get('Authorization'), 'Service-Key svc', 'Auth: credential replaces lower-cased Authorization');
    assertEquals(capturedHeaders.get('Service-Key-Impersonating-UserId'), '42', 'Auth: impersonated user replaces lower-cased header');
    restoreFetch();
  });

  await asyncTest('Redirect: redirects are not followed', async () => {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'jwt' });
    let capturedRedirect: string | undefined;
    mockFetch(async (_url, opts) => { capturedRedirect = opts?.redirect; return new Response(null, { status: 302, headers: { location: 'https://attacker.example/' } }); });
    let threw = false;
    try { await client.request({ method: 'GET', url: '/test' }); }
    catch (e: any) { threw = e.message.includes('HTTP 302'); }
    assertEquals(capturedRedirect, 'manual', 'Redirect: fetch called with redirect: manual');
    ok(threw, 'Redirect: 3xx response is rejected');
    restoreFetch();
  });

  await asyncTest('URL: same-origin absolute URL passes through without /v1', async () => {
    const client = new FetchHttpClient('https://example.com/v1', { authToken: 'tok', authType: 'jwt' });
    let capturedUrl = '';
    mockFetch(async (url) => { capturedUrl = String(url); return new Response('{}', { headers: { 'content-type': 'application/json' } }); });
    await client.request({ method: 'GET', url: 'https://example.com/auth/current-user' });
    assertEquals(capturedUrl, 'https://example.com/auth/current-user', 'URL: same-origin absolute URL kept as-is');
    restoreFetch();
  });

  await asyncTest('URL: cross-origin absolute URL rejected before fetch', async () => {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'jwt' });
    let fetched = false;
    mockFetch(async () => { fetched = true; return new Response('{}'); });
    let threw = false;
    try { await client.request({ method: 'GET', url: 'https://attacker.example/steal' }); }
    catch (e: any) { threw = e.message.includes('other origins'); }
    ok(threw && !fetched, 'URL: cross-origin absolute URL rejected, credential never sent');
    restoreFetch();
  });

  // Raw-request path hardening: nothing may leave /v1 (or the root auth
  // paths), however the escape is encoded, and the check runs before fetch.
  const ESCAPING_PATHS = [
    '/../auth/current-user',
    '/experiments/../../auth/current-user',
    '/%2e%2e/auth/current-user',
    '/%2E%2E/auth/current-user',
    '/.%2e/auth/current-user',
    '/%2e./auth/current-user',
    '/%252e%252e/auth/current-user',
    '/%25252e%25252e/auth/current-user',
    '/..\\auth/current-user',
    '/\\..\\auth/current-user',
    '/experiments%2f..%2f..%2fauth',
    '/experiments%2F..',
    '/experiments%5c..%5cauth',
    '//evil.example/steal',
    '/experiments//1',
    'experiments',
    '/experiments\u0000',
    '/experiments#frag',
    '/experiments#',
    '/.. /auth/current-user',
    '/experiments/.. /..%20/auth/current-user',
    '/%2e%2e%ff/auth/current-user',
    '/%ff%2e%2e/auth/current-user',
    '/x%EF%BC%8F..%EF%BC%8F..%EF%BC%8Fauth',
    '/x\uFF0F..\uFF0F..\uFF0Fauth',
    '/x%EF%BC%BC..%EF%BC%BCauth',
    '/..%3f/auth/current-user',
    '/..%23/auth/current-user',
    '/experiments;jsessionid=1',
    '/goals/50%25off',
    '/goals/50%off',
    '/experiments/%41%42%3B',
    '/experiments\t/../../auth',
    '/experiments/..;/auth/current-user',
    '/experiments/%2e%2e;x/admin',
    '/\uFF0E\uFF0E/auth/current-user',
    '/%EF%BC%8E%EF%BC%8E/auth/current-user',
    '/\u2024\u2024/auth/current-user',
  ];
  for (const path of ESCAPING_PATHS) {
    await asyncTest(`Path hardening: ${JSON.stringify(path)} rejected before fetch`, async () => {
      const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'jwt' });
      let fetched = false;
      mockFetch(async () => { fetched = true; return new Response('{}'); });
      let error = '';
      try { await client.request({ method: 'GET', url: path }); }
      catch (e: any) { error = e.message; }
      ok(error.startsWith('Invalid API path') || error.includes('not permitted'), `Path hardening: ${JSON.stringify(path)} rejected`, `got "${error}"`);
      ok(!fetched, `Path hardening: ${JSON.stringify(path)} never reaches fetch`);
      restoreFetch();
    });
  }

  const ESCAPING_ABSOLUTE_URLS = [
    'https://example.com/v1/%2e%2e/admin',
    'https://example.com/admin',
    'https://example.com/auth/other',
    'https://example.com/auth/current-user/../../admin',
    'https://example.com/v1\\..\\admin',
    'https://example.com\\v1\\..%2f..%2fadmin/v1/x',
    'https://example.com/v1/%2e%2e%2fadmin',
    'https://example.com/v1/x?y=1#frag',
    'https://user:pw@example.com/v1/x',
    'https://example.com/v1/x#',
    'https://example.com/auth/current-user/other',
    'https://example.com/auth/current-user/api_keys/abc',
    'https://example.com/v1/../../admin',
    'https://example.com/v1/..;/admin',
  ];
  for (const url of ESCAPING_ABSOLUTE_URLS) {
    await asyncTest(`Path hardening: same-origin ${JSON.stringify(url)} rejected`, async () => {
      const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'jwt' });
      let fetched = false;
      mockFetch(async () => { fetched = true; return new Response('{}'); });
      let threw = false;
      try { await client.request({ method: 'GET', url }); } catch { threw = true; }
      ok(threw && !fetched, `Path hardening: same-origin ${JSON.stringify(url)} rejected before fetch`);
      restoreFetch();
    });
  }

  await asyncTest('Path hardening: ordinary paths, query params and root auth paths still work', async () => {
    const client = new FetchHttpClient('https://example.com/base', { authToken: 'tok', authType: 'jwt' });
    const urls: string[] = [];
    mockFetch(async (url) => { urls.push(String(url)); return new Response('{}', { headers: { 'content-type': 'application/json' } }); });
    await client.request({ method: 'GET', url: '/experiments/42', params: { q: '../x' } });
    await client.request({ method: 'GET', url: '/experiments/' });
    await client.request({ method: 'GET', url: '/experiments?state=running', params: { items: 5 } });
    await client.request({ method: 'GET', url: 'https://example.com/base/auth/current-user/api_keys/7' });
    assertEquals(urls, [
      'https://example.com/base/v1/experiments/42?q=..%2Fx',
      'https://example.com/base/v1/experiments/',
      'https://example.com/base/v1/experiments?state=running&items=5',
      'https://example.com/base/auth/current-user/api_keys/7',
    ], 'Path hardening: allowed URLs are unchanged');
    restoreFetch();
  });

  await asyncTest('Path hardening: dot segments that resolve inside /v1 stay inside /v1', async () => {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'jwt' });
    const urls: string[] = [];
    mockFetch(async (url) => { urls.push(String(url)); return new Response('{}', { headers: { 'content-type': 'application/json' } }); });
    for (const path of ['/./experiments', '/experiments/%2e', '/experiments/x/../1']) {
      await client.request({ method: 'GET', url: path });
    }
    assertEquals(urls, [
      'https://example.com/v1/experiments',
      'https://example.com/v1/experiments/',
      'https://example.com/v1/experiments/1',
    ], 'Path hardening: in-prefix dot segments resolve within /v1');
    restoreFetch();
  });

  await asyncTest('Base URL: /v1, /V2 and trailing slashes are stripped; query, fragment and userinfo rejected', async () => {
    for (const [input, expected] of [
      ['https://example.com/v1', 'https://example.com/v1'],
      ['https://example.com/V2/', 'https://example.com/v1'],
      ['  https://example.com/tenant/v1/  ', 'https://example.com/tenant/v1'],
      ['https://example.com/tenant', 'https://example.com/tenant/v1'],
    ]) {
      assertEquals(new FetchHttpClient(input, { authToken: 't', authType: 'jwt' }).getBaseUrl(), expected, `Base URL: ${input}`);
    }
    for (const bad of ['https://example.com/?x=1', 'https://example.com/#f', 'https://u:p@example.com', 'ftp://example.com', 'https://example.com/a;b']) {
      let threw = false;
      try { new FetchHttpClient(bad, { authToken: 't', authType: 'jwt' }); } catch { threw = true; }
      ok(threw, `Base URL: ${bad} rejected`);
    }
  });

  // Property test: strings over the dangerous alphabet must either be rejected
  // before fetch, or be fetched at a same-origin URL under the allowed prefix.
  await asyncTest('Path hardening: random dangerous strings never leave the allowed prefix', async () => {
    const ALPHABET = ['.', '..', '/', '\\', '%', '%2e', '%2E', '%2f', '%2F', '%5c', '%25', '%3f', '%23', '%3b', '%00', '%ff', '%EF%BC%8E',
      ';', '?', '#', ' ', '\t', '\n', '@', ':', 'a', 'v1', 'auth', 'current-user', 'api_keys', '1', '\uFF0E', '\uFF0F', '\uFF3C', '\u2024', '~', '-', '_'];
    let seed = 0x5eed;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const bases = ['https://example.com', 'https://example.com/tenant'];
    let leaks: string[] = [];
    let fetchedCount = 0;
    for (let i = 0; i < 6000; i++) {
      const base = bases[i % 2];
      const prefix = new URL(base).pathname.replace(/\/$/, '');
      const body = Array.from({ length: 1 + rand(10) }, () => ALPHABET[rand(ALPHABET.length)]).join('');
      const candidates = [`/${body}`, `${base}/${body}`, `${base}/v1/${body}`, `${base}/auth/current-user/${body}`, `/experiments/${body}`];
      for (const requested of candidates) {
        const client = new FetchHttpClient(base, { authToken: 't', authType: 'jwt' });
        let fetched = '';
        mockFetch(async (url) => { fetched = String(url); return new Response('{}', { headers: { 'content-type': 'application/json' } }); });
        try { await client.request({ method: 'GET', url: requested }); } catch { /* rejected */ }
        if (!fetched) continue;
        fetchedCount++;
        const u = new URL(fetched);
        const auth = `${prefix}/auth/current-user`;
        const ok = u.origin === 'https://example.com' && !u.username && !u.password && !u.hash
          && (u.pathname.startsWith(`${prefix}/v1/`) || u.pathname === auth || /^\/api_keys(\/[0-9]+)?$/.test(u.pathname.slice(auth.length)) && u.pathname.startsWith(`${auth}/`))
          && u.pathname.split('/').every((seg) => !/^(\.|\.\.|%2e|%2e%2e|\.%2e|%2e\.)$/i.test(seg) && /^[A-Za-z0-9._~%-]*$/.test(seg));
        if (!ok) leaks.push(`${requested} -> ${fetched}`);
      }
    }
    restoreFetch();
    ok(leaks.length === 0, 'Path hardening: no random string leaves the allowed prefix', leaks.slice(0, 5).join(' | '));
    ok(fetchedCount > 100, `Path hardening: the property test exercised accepted URLs too (${fetchedCount})`);
  });

  await asyncTest('Path hardening: APIClient.rawRequest cannot escape /v1 through the MCP client', async () => {
    const client = new APIClient(new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'jwt' }));
    let fetched = false;
    mockFetch(async () => { fetched = true; return new Response('{}'); });
    let threw = 0;
    for (const path of ['/v1/../auth/current-user', '/%2e%2e/auth/current-user', '/..%5cauth', '/%252e%252e/auth']) {
      try { await client.rawRequest(path); } catch { threw++; }
    }
    ok(threw === 4 && !fetched, 'Path hardening: rawRequest escapes rejected before fetch', `threw ${threw}/4, fetched=${fetched}`);
    restoreFetch();
  });

  {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'api-key' });
    assertEquals((client as any).timeout, 30000, 'Default timeout: 30000ms');
  }
  {
    const client = new FetchHttpClient('https://example.com', { authToken: 'tok', authType: 'api-key', timeout: 5000 });
    assertEquals((client as any).timeout, 5000, 'Custom timeout: respects value');
  }

  return { success: failed === 0, message: `${passed} passed, ${failed} failed`, testCount: passed + failed, details };
}
