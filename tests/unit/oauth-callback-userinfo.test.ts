import assert from 'node:assert';
import { ABsmartlyOAuthHandler } from '../../src/absmartly-oauth-handler';

class MockKv {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> { return this.store.get(key) ?? null; }
  async put(key: string, value: string, _opts?: any): Promise<void> { this.store.set(key, value); }
  async delete(key: string): Promise<void> { this.store.delete(key); }
}

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function installFetchMock(responses: Array<(call: FetchCall) => { status: number; body: any }>): {
  restore: () => void;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const headers: Record<string, string> = {};
    const reqHeaders = init.headers || {};
    if (reqHeaders instanceof Headers) {
      reqHeaders.forEach((v: string, k: string) => { headers[k.toLowerCase()] = v; });
    } else {
      for (const [k, v] of Object.entries(reqHeaders)) headers[k.toLowerCase()] = String(v);
    }
    const call: FetchCall = {
      url,
      method: init.method || 'GET',
      headers,
      body: typeof init.body === 'string' ? init.body : init.body?.toString(),
    };
    calls.push(call);
    if (i >= responses.length) throw new Error(`unexpected extra fetch to ${url}`);
    const responder = responses[i++];
    const { status, body } = responder(call);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;
  return { restore: () => { globalThis.fetch = original; }, calls };
}

function makeOAuthProvider(captured: { auth?: any }) {
  return {
    parseAuthRequest: async () => ({}),
    lookupClient: async () => ({}),
    completeAuthorization: async (opts: any) => {
      captured.auth = opts;
      return { redirectTo: 'https://client.example/cb?code=worker-code' };
    },
  };
}

async function setupCallback(opts: {
  storedState: any;
  state?: string;
  code?: string;
  endpoint?: string;
}): Promise<{
  handler: ABsmartlyOAuthHandler;
  kv: MockKv;
  env: any;
  captured: { auth?: any };
  state: string;
  code: string;
}> {
  const handler = new ABsmartlyOAuthHandler();
  const kv = new MockKv();
  const captured: { auth?: any } = {};
  const state = opts.state || 'test-state';
  const code = opts.code || 'backend-auth-code';
  await kv.put(`oauth:state:${state}`, JSON.stringify(opts.storedState));
  const env = {
    OAUTH_KV: kv,
    ABSMARTLY_OAUTH_CLIENT_ID: 'mcp-absmartly-universal',
    ABSMARTLY_OAUTH_CLIENT_SECRET: 'test-secret',
    OAUTH_PROVIDER: makeOAuthProvider(captured),
  };
  return { handler, kv, env, captured, state, code };
}

export default async function run() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];

  async function asyncTest(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; details.push({ name, status: 'PASS' }); }
    catch (e: any) { failed++; details.push({ name, status: 'FAIL', error: e.message }); }
  }

  await asyncTest('callback fetches /userinfo with the access_token bearer and uses the result', async () => {
    const { handler, env, captured, state, code } = await setupCallback({
      storedState: {
        authRequest: { clientId: 'cli', scope: ['mcp:access'], redirectUri: 'https://client.example/cb' },
        absmartlyEndpoint: 'https://demo.absmartly.com',
        codeVerifier: 'v'.repeat(43),
      },
      state: 's-userinfo',
      code: 'c-userinfo',
    });

    const mock = installFetchMock([
      // 1st call: token exchange
      (call) => {
        assert.ok(call.url.endsWith('/auth/oauth/token'));
        assert.strictEqual(call.method, 'POST');
        assert.ok(call.body!.includes('code_verifier=' + 'v'.repeat(43)),
          'token request must replay the stored PKCE verifier');
        return { status: 200, body: { access_token: 'opaque-or-jwt-token-no-claims' } };
      },
      // 2nd call: userinfo
      (call) => {
        assert.ok(call.url.endsWith('/auth/oauth/userinfo'),
          `expected /userinfo call, got ${call.url}`);
        assert.strictEqual(call.method, 'GET');
        assert.strictEqual(call.headers['authorization'], 'Bearer opaque-or-jwt-token-no-claims');
        return {
          status: 200,
          body: {
            sub: '42',
            email: 'alice@example.com',
            given_name: 'Alice',
            family_name: 'Smith',
            absmartly_user_id: 42,
          },
        };
      },
    ]);

    try {
      const req = new Request(`https://mcp.absmartly.com/oauth/callback?code=${code}&state=${state}`);
      const res = await handler.fetch(req, env);
      assert.strictEqual(res.status, 302, `expected 302, got ${res.status}: ${await res.text()}`);
      assert.strictEqual(mock.calls.length, 2, 'expected exactly token + userinfo calls');
      assert.ok(captured.auth, 'completeAuthorization was not called');
      assert.strictEqual(captured.auth.userId, '42');
      assert.strictEqual(captured.auth.props.email, 'alice@example.com');
      assert.strictEqual(captured.auth.props.name, 'Alice Smith');
      assert.strictEqual(captured.auth.props.user_id, '42');
    } finally {
      mock.restore();
    }
  });

  await asyncTest('callback works when token has no JWT claims (regression: opaque tokens)', async () => {
    const { handler, env, captured, state, code } = await setupCallback({
      storedState: {
        authRequest: { clientId: 'cli', scope: ['mcp:access'], redirectUri: 'https://x/cb' },
        absmartlyEndpoint: 'https://demo.absmartly.com',
        codeVerifier: 'v'.repeat(43),
      },
      state: 's-opaque',
    });

    const mock = installFetchMock([
      () => ({ status: 200, body: { access_token: 'completely-opaque-not-a-jwt' } }),
      () => ({ status: 200, body: { sub: '7', email: 'bob@example.com' } }),
    ]);

    try {
      const req = new Request(`https://mcp.absmartly.com/oauth/callback?code=${code}&state=${state}`);
      const res = await handler.fetch(req, env);
      assert.strictEqual(res.status, 302);
      assert.strictEqual(captured.auth.props.email, 'bob@example.com');
      assert.strictEqual(captured.auth.props.name, 'bob@example.com',
        'name falls back to email when userinfo has no given/family name');
    } finally {
      mock.restore();
    }
  });

  await asyncTest('callback returns 500 when /userinfo fails', async () => {
    const { handler, env, state, code } = await setupCallback({
      storedState: {
        authRequest: { clientId: 'cli', scope: ['mcp:access'], redirectUri: 'https://x/cb' },
        absmartlyEndpoint: 'https://demo.absmartly.com',
        codeVerifier: 'v'.repeat(43),
      },
      state: 's-userinfo-fail',
    });

    const mock = installFetchMock([
      () => ({ status: 200, body: { access_token: 'token' } }),
      () => ({ status: 401, body: { error: 'invalid_token' } }),
    ]);

    try {
      const req = new Request(`https://mcp.absmartly.com/oauth/callback?code=${code}&state=${state}`);
      const res = await handler.fetch(req, env);
      assert.strictEqual(res.status, 500);
      assert.ok((await res.text()).toLowerCase().includes('user identity'));
    } finally {
      mock.restore();
    }
  });

  await asyncTest('callback returns 400 when /userinfo response has no email/sub', async () => {
    const { handler, env, state, code } = await setupCallback({
      storedState: {
        authRequest: { clientId: 'cli', scope: ['mcp:access'], redirectUri: 'https://x/cb' },
        absmartlyEndpoint: 'https://demo.absmartly.com',
        codeVerifier: 'v'.repeat(43),
      },
      state: 's-noemail',
    });

    const mock = installFetchMock([
      () => ({ status: 200, body: { access_token: 'token' } }),
      () => ({ status: 200, body: { absmartly_user_id: 99 } }),
    ]);

    try {
      const req = new Request(`https://mcp.absmartly.com/oauth/callback?code=${code}&state=${state}`);
      const res = await handler.fetch(req, env);
      assert.strictEqual(res.status, 400);
    } finally {
      mock.restore();
    }
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
