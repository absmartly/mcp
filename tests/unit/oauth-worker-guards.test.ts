import assert from 'node:assert';
import { checkBackendSessionOnRefresh, normalizeResourceParameter, protectedResourceMetadataUrl, rejectUntrustedCimdClient } from '../../src/oauth-worker-guards';

const ORIGIN = 'https://mcp.absmartly.com';
const TRUSTED_CIMD = 'https://claude.ai/oauth/claude-code-client-metadata';
const UNTRUSTED_CIMD = 'https://attacker.example/client.json';
const BACKEND = 'https://demo.absmartly.com/v1';

// Stand-in for the provider's OAuthError; the real one lives in a module that imports
// cloudflare:workers, which Node cannot load.
class OAuthError extends Error {
  constructor(readonly code: string, readonly options: { description: string; statusCode?: number }) { super(options.description); }
}

function tokenRequest(body: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body),
  });
}

function refreshOptions(overrides: Record<string, unknown> = {}): any {
  return {
    grantType: 'refresh_token',
    clientId: 'c',
    userId: '7',
    grantId: 'g',
    scope: ['mcp:access'],
    requestedScope: ['mcp:access'],
    props: { oauth_jwt: 'backend-jwt', absmartly_endpoint: BACKEND },
    ...overrides,
  };
}

async function withFetch(status: number | 'throw', fn: (calls: string[]) => Promise<void>) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: any, init: any = {}) => {
    calls.push(`${typeof input === 'string' ? input : input.url} ${init.headers?.Authorization ?? ''}`);
    if (status === 'throw') throw new TypeError('network down');
    return new Response('{}', { status });
  }) as typeof fetch;
  try { await fn(calls); } finally { globalThis.fetch = original; }
}

export default async function run() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];

  async function asyncTest(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; details.push({ name, status: 'PASS' }); }
    catch (e: any) { failed++; details.push({ name, status: 'FAIL', error: e.message }); }
  }

  // --- CIMD gate ---
  await asyncTest('untrusted CIMD client_id is rejected at /authorize', async () => {
    const url = new URL(`${ORIGIN}/authorize?client_id=${encodeURIComponent(UNTRUSTED_CIMD)}`);
    const res = await rejectUntrustedCimdClient(new Request(url), url);
    assert.strictEqual(res?.status, 401);
    assert.strictEqual((await res!.json() as any).error, 'invalid_client');
  });

  await asyncTest('untrusted CIMD client_id is rejected at /token (form body and Basic auth)', async () => {
    const url = new URL(`${ORIGIN}/token`);
    const form = await rejectUntrustedCimdClient(tokenRequest({ grant_type: 'authorization_code', client_id: UNTRUSTED_CIMD }), url);
    assert.strictEqual(form?.status, 401);
    const basic = `Basic ${btoa(`${encodeURIComponent(UNTRUSTED_CIMD)}:x`)}`;
    const viaBasic = await rejectUntrustedCimdClient(tokenRequest({ grant_type: 'refresh_token' }, { Authorization: basic }), url);
    assert.strictEqual(viaBasic?.status, 401);
  });

  await asyncTest('gate leaves the token request body readable for the provider', async () => {
    const url = new URL(`${ORIGIN}/token`);
    const request = tokenRequest({ grant_type: 'authorization_code', client_id: TRUSTED_CIMD, code: 'abc' });
    assert.strictEqual(await rejectUntrustedCimdClient(request, url), null);
    assert.strictEqual(new URLSearchParams(await request.text()).get('code'), 'abc');
  });

  await asyncTest('trusted CIMD and ordinary registered client_ids pass the gate', async () => {
    for (const clientId of [TRUSTED_CIMD, 'tp9FX2O10Lljv68C']) {
      const url = new URL(`${ORIGIN}/authorize?client_id=${encodeURIComponent(clientId)}`);
      assert.strictEqual(await rejectUntrustedCimdClient(new Request(url), url), null);
    }
    const other = new URL(`${ORIGIN}/register?client_id=${encodeURIComponent(UNTRUSTED_CIMD)}`);
    assert.strictEqual(await rejectUntrustedCimdClient(new Request(other), other), null, 'only /authorize and /token are gated');
  });

  // --- Refresh check ---
  await asyncTest('refresh with a live backend session succeeds after calling userinfo with the JWT', async () => {
    await withFetch(200, async (calls) => {
      await checkBackendSessionOnRefresh(refreshOptions(), OAuthError as any);
      assert.deepStrictEqual(calls, ['https://demo.absmartly.com/auth/oauth/userinfo Bearer backend-jwt']);
    });
  });

  await asyncTest('refresh after the backend session ended fails with invalid_grant', async () => {
    await withFetch(401, async () => {
      await assert.rejects(checkBackendSessionOnRefresh(refreshOptions(), OAuthError as any), (e: any) => e instanceof OAuthError && e.code === 'invalid_grant');
    });
  });

  await asyncTest('backend 5xx or network failure is temporary, not invalid_grant', async () => {
    for (const status of [502, 'throw'] as const) {
      await withFetch(status, async () => {
        await assert.rejects(checkBackendSessionOnRefresh(refreshOptions(), OAuthError as any), (e: any) => e instanceof OAuthError && e.code === 'temporarily_unavailable');
      });
    }
  });

  await asyncTest('authorization_code grants and API-key props are not checked', async () => {
    await withFetch(401, async (calls) => {
      await checkBackendSessionOnRefresh(refreshOptions({ grantType: 'authorization_code' }), OAuthError as any);
      await checkBackendSessionOnRefresh(refreshOptions({ props: { absmartly_api_key: 'k', absmartly_endpoint: BACKEND } }), OAuthError as any);
      assert.strictEqual(calls.length, 0);
    });
  });

  await asyncTest('401 challenge points at per-transport protected-resource metadata', async () => {
    assert.strictEqual(protectedResourceMetadataUrl(new URL(`${ORIGIN}/mcp?x=1`), '/mcp'), `${ORIGIN}/.well-known/oauth-protected-resource/mcp`);
  });

  // --- Resource normalization (tokens must work on /mcp, /mcp?..., and /sse) ---
  await asyncTest('authorize: same-origin resource becomes the origin, endpoint moves to the query', async () => {
    const resource = `${ORIGIN}/mcp?absmartly-endpoint=https://demo.absmartly.com`;
    const url = new URL(`${ORIGIN}/authorize?client_id=c&resource=${encodeURIComponent(resource)}`);
    const out = new URL((await normalizeResourceParameter(new Request(url), url)).url);
    assert.deepStrictEqual(out.searchParams.getAll('resource'), [ORIGIN]);
    assert.strictEqual(out.searchParams.get('absmartly-endpoint'), 'https://demo.absmartly.com');
    assert.strictEqual(out.searchParams.get('client_id'), 'c');
  });

  await asyncTest('authorize: an explicit absmartly-endpoint query wins over the resource', async () => {
    const resource = `${ORIGIN}/mcp?absmartly-endpoint=https://a.absmartly.com`;
    const url = new URL(`${ORIGIN}/authorize?absmartly-endpoint=https://b.absmartly.com&resource=${encodeURIComponent(resource)}`);
    const out = new URL((await normalizeResourceParameter(new Request(url), url)).url);
    assert.strictEqual(out.searchParams.get('absmartly-endpoint'), 'https://b.absmartly.com');
  });

  await asyncTest('token: resource is rewritten and the rest of the form is kept', async () => {
    const url = new URL(`${ORIGIN}/token`);
    const out = await normalizeResourceParameter(tokenRequest({
      grant_type: 'authorization_code', code: 'abc', resource: `${ORIGIN}/sse?absmartly-endpoint=x`,
    }), url);
    const form = new URLSearchParams(await out.text());
    assert.deepStrictEqual(form.getAll('resource'), [ORIGIN]);
    assert.strictEqual(form.get('code'), 'abc');
  });

  await asyncTest('foreign resources and requests without one are left alone', async () => {
    const url = new URL(`${ORIGIN}/authorize?resource=${encodeURIComponent('https://evil.example/mcp')}`);
    const out = new URL((await normalizeResourceParameter(new Request(url), url)).url);
    assert.deepStrictEqual(out.searchParams.getAll('resource'), ['https://evil.example/mcp']);
    const plain = new URL(`${ORIGIN}/authorize?client_id=c`);
    const request = new Request(plain);
    assert.strictEqual(await normalizeResourceParameter(request, plain), request);
  });

  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: passed + failed,
    details,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  });
}
