import assert from 'node:assert';
import { ABsmartlyOAuthHandler } from '../../src/absmartly-oauth-handler';

class MockKv {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string, _opts?: any): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function makeOAuthProvider(authRequest: any) {
  return {
    parseAuthRequest: async () => authRequest,
    lookupClient: async (clientId: string) => ({
      clientId,
      clientName: 'Test Client',
      redirectUris: [authRequest.redirectUri],
    }),
    completeAuthorization: async () => ({ redirectTo: 'https://example.com/done' }),
  };
}

async function sha256Base64Url(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  let binary = '';
  for (const b of new Uint8Array(buf)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default async function run() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];

  async function asyncTest(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; details.push({ name, status: 'PASS' }); }
    catch (e: any) { failed++; details.push({ name, status: 'FAIL', error: e.message }); }
  }

  async function approveAndGetRedirect(absmartlyEndpoint: string): Promise<{
    redirectUrl: URL;
    storedState: any;
    kv: MockKv;
  }> {
    const handler = new ABsmartlyOAuthHandler();
    const kv = new MockKv();
    const env = {
      OAUTH_KV: kv,
      ABSMARTLY_OAUTH_CLIENT_ID: 'mcp-absmartly-universal',
      OAUTH_PROVIDER: makeOAuthProvider({
        clientId: 'claude-mcp-test',
        redirectUri: 'https://client.example/cb',
        state: 'orig-state',
        scope: ['mcp:access'],
        responseType: 'code',
      }),
    };

    const formBody = new URLSearchParams({
      action: 'approve',
      client_id: 'claude-mcp-test',
      redirect_uri: 'https://client.example/cb',
      state: 'orig-state',
      scope: 'mcp:access',
      response_type: 'code',
      absmartly_endpoint: absmartlyEndpoint,
    });

    const req = new Request('https://mcp.absmartly.com/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody,
    });

    const res = await handler.fetch(req, env);
    assert.strictEqual(res.status, 302, `expected redirect, got ${res.status}`);
    const location = res.headers.get('location');
    assert.ok(location, 'no Location header on redirect');
    const redirectUrl = new URL(location!);

    const stateToken = redirectUrl.searchParams.get('state');
    assert.ok(stateToken, 'no state in redirect URL');
    const storedRaw = kv.store.get(`oauth:state:${stateToken}`);
    assert.ok(storedRaw, 'state not stored in KV');
    const storedState = JSON.parse(storedRaw!);

    return { redirectUrl, storedState, kv };
  }

  await asyncTest('redirect includes code_challenge_method=S256', async () => {
    const { redirectUrl } = await approveAndGetRedirect('https://demo.absmartly.com');
    assert.strictEqual(redirectUrl.searchParams.get('code_challenge_method'), 'S256');
  });

  await asyncTest('redirect includes a non-empty code_challenge', async () => {
    const { redirectUrl } = await approveAndGetRedirect('https://demo.absmartly.com');
    const challenge = redirectUrl.searchParams.get('code_challenge');
    assert.ok(challenge, 'code_challenge missing from backend redirect');
    assert.ok(challenge!.length === 43, `expected 43-char S256 challenge, got ${challenge!.length}`);
    assert.ok(/^[A-Za-z0-9\-_]+$/.test(challenge!), 'code_challenge not base64url');
  });

  await asyncTest('codeVerifier is stored in KV state, not in the redirect URL', async () => {
    const { redirectUrl, storedState } = await approveAndGetRedirect('https://demo.absmartly.com');
    assert.ok(storedState.codeVerifier, 'codeVerifier missing from stored state — /oauth/callback will not be able to exchange the code');
    assert.ok(typeof storedState.codeVerifier === 'string');
    assert.ok(storedState.codeVerifier.length === 43);
    assert.strictEqual(redirectUrl.searchParams.get('code_verifier'), null,
      'codeVerifier must NEVER appear in the URL — it is the secret half of PKCE');
  });

  await asyncTest('stored codeVerifier hashes to the redirected code_challenge', async () => {
    const { redirectUrl, storedState } = await approveAndGetRedirect('https://demo.absmartly.com');
    const expected = await sha256Base64Url(storedState.codeVerifier);
    assert.strictEqual(redirectUrl.searchParams.get('code_challenge'), expected,
      'code_challenge in the redirect does not match SHA-256(stored codeVerifier) — token exchange will fail with PKCE mismatch');
  });

  await asyncTest('each authorization gets a fresh codeVerifier (no reuse across sessions)', async () => {
    const a = await approveAndGetRedirect('https://demo.absmartly.com');
    const b = await approveAndGetRedirect('https://demo.absmartly.com');
    assert.notStrictEqual(a.storedState.codeVerifier, b.storedState.codeVerifier);
    assert.notStrictEqual(
      a.redirectUrl.searchParams.get('code_challenge'),
      b.redirectUrl.searchParams.get('code_challenge')
    );
  });

  await asyncTest('absmartlyEndpoint is preserved alongside codeVerifier in stored state', async () => {
    const { storedState } = await approveAndGetRedirect('https://demo-2.absmartly.com');
    assert.strictEqual(storedState.absmartlyEndpoint, 'https://demo-2.absmartly.com');
    assert.ok(storedState.authRequest, 'authRequest missing from state');
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
