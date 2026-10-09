import assert from 'node:assert';
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
