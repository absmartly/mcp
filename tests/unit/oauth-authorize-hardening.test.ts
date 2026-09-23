import assert from 'node:assert';
import { ABsmartlyOAuthHandler } from '../../src/absmartly-oauth-handler';
import { isAllowedRedirectUri } from '../../src/shared';

const MCP_ORIGIN = 'https://mcp.absmartly.com';
const VICTIM_ENDPOINT = 'https://victim.absmartly.com';
const LEGIT_CLIENT_ID = 'legit-client';
const LEGIT_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const ATTACKER_REDIRECT = 'https://attacker.example/cb';
const ATTACKER_ENDPOINT = 'https://attacker.example';

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

function makeEnv(authRequest: any, registeredRedirects: string[] = [LEGIT_REDIRECT]) {
  return {
    OAUTH_KV: new MockKv(),
    OAUTH_PROVIDER: {
      parseAuthRequest: async () => authRequest,
      lookupClient: async (clientId: string) => ({
        clientId,
        clientName: 'Test Client',
        redirectUris: clientId === LEGIT_CLIENT_ID ? registeredRedirects : [],
      }),
      completeAuthorization: async () => ({ redirectTo: 'https://example.com/done' }),
    },
  };
}

function validAuthRequest(overrides: Record<string, unknown> = {}) {
  return {
    clientId: LEGIT_CLIENT_ID,
    redirectUri: LEGIT_REDIRECT,
    state: 'orig-state',
    scope: ['mcp:access'],
    responseType: 'code',
    resource: `${MCP_ORIGIN}/mcp?absmartly-endpoint=${VICTIM_ENDPOINT}`,
    codeChallenge: 'client-challenge',
    codeChallengeMethod: 'S256',
    ...overrides,
  };
}

async function startConsent(handler: ABsmartlyOAuthHandler, env: any) {
  const res = await handler.fetch(new Request(`${MCP_ORIGIN}/authorize`), env);
  const page = await res.text();
  const transactionId = page.match(/name="transaction_id" value="([^"]+)"/)?.[1];
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  return { res, page, transactionId, cookie };
}

function postAuthorize(handler: ABsmartlyOAuthHandler, env: any, fields: Record<string, string>, cookie?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (cookie) headers.Cookie = cookie;
  return handler.fetch(new Request(`${MCP_ORIGIN}/authorize`, {
    method: 'POST',
    headers,
    body: new URLSearchParams(fields),
  }), env);
}

export default async function run() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];

  async function asyncTest(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; details.push({ name, status: 'PASS' }); }
    catch (e: any) { failed++; details.push({ name, status: 'FAIL', error: e.message }); }
  }

  await asyncTest('forged approve POST with attacker-chosen redirect_uri is rejected (no transaction)', async () => {
    const handler = new ABsmartlyOAuthHandler();
    const env = makeEnv(validAuthRequest());
    const res = await postAuthorize(handler, env, {
      action: 'approve',
      client_id: LEGIT_CLIENT_ID,
      redirect_uri: ATTACKER_REDIRECT,
      state: 'x',
      scope: 'mcp:access',
      response_type: 'code',
      absmartly_endpoint: VICTIM_ENDPOINT,
    });
    assert.strictEqual(res.status, 400);
    const stateKeys = [...env.OAUTH_KV.store.keys()].filter(k => k.startsWith('oauth:state:'));
    assert.strictEqual(stateKeys.length, 0, 'no backend OAuth state may be created from a forged POST');
  });

  await asyncTest('approve POST without the browser-binding cookie is rejected', async () => {
    const handler = new ABsmartlyOAuthHandler();
    const env = makeEnv(validAuthRequest());
    const { transactionId } = await startConsent(handler, env);
    assert.ok(transactionId);
    const res = await postAuthorize(handler, env, { action: 'approve', transaction_id: transactionId! });
    assert.strictEqual(res.status, 400);
  });

  await asyncTest('approve POST with a different browser cookie is rejected', async () => {
    const handler = new ABsmartlyOAuthHandler();
    const env = makeEnv(validAuthRequest());
    const { transactionId } = await startConsent(handler, env);
    const res = await postAuthorize(handler, env, { action: 'approve', transaction_id: transactionId! },
      `__Host-absmartly-oauth-consent-${transactionId}=attacker-value`);
    assert.strictEqual(res.status, 400);
  });

  await asyncTest('an earlier consent page still works after a second one opens in the same browser', async () => {
    const handler = new ABsmartlyOAuthHandler();
    const env = makeEnv(validAuthRequest());
    const first = await startConsent(handler, env);
    const second = await startConsent(handler, env);
    assert.notStrictEqual(first.transactionId, second.transactionId);
    const bothCookies = `${first.cookie}; ${second.cookie}`;

    const firstRes = await postAuthorize(handler, env, { action: 'cancel', transaction_id: first.transactionId! }, bothCookies);
    assert.strictEqual(firstRes.status, 302);
    const secondRes = await postAuthorize(handler, env, { action: 'cancel', transaction_id: second.transactionId! }, bothCookies);
    assert.strictEqual(secondRes.status, 302);
  });

  await asyncTest("one transaction's cookie does not unlock another transaction", async () => {
    const handler = new ABsmartlyOAuthHandler();
    const env = makeEnv(validAuthRequest());
    const first = await startConsent(handler, env);
    const second = await startConsent(handler, env);
    const res = await postAuthorize(handler, env, { action: 'approve', transaction_id: first.transactionId! }, second.cookie);
    assert.strictEqual(res.status, 400);
  });

  await asyncTest('form fields cannot override the stored redirect_uri or client_id', async () => {
    const handler = new ABsmartlyOAuthHandler();
    const env = makeEnv(validAuthRequest());
    const { transactionId, cookie } = await startConsent(handler, env);
    const res = await postAuthorize(handler, env, {
      action: 'approve',
      transaction_id: transactionId!,
      client_id: 'attacker-client',
      redirect_uri: ATTACKER_REDIRECT,
    }, cookie);
    assert.strictEqual(res.status, 302);
    const stateKey = [...env.OAUTH_KV.store.keys()].find(k => k.startsWith('oauth:state:'));
    const stored = JSON.parse(env.OAUTH_KV.store.get(stateKey!)!);
    assert.strictEqual(stored.authRequest.redirectUri, LEGIT_REDIRECT);
    assert.strictEqual(stored.authRequest.clientId, LEGIT_CLIENT_ID);
    assert.strictEqual(stored.authRequest.codeChallenge, 'client-challenge');
  });

  await asyncTest('consent transaction is single-use', async () => {
    const handler = new ABsmartlyOAuthHandler();
    const env = makeEnv(validAuthRequest());
    const { transactionId, cookie } = await startConsent(handler, env);
    const first = await postAuthorize(handler, env, { action: 'approve', transaction_id: transactionId! }, cookie);
    assert.strictEqual(first.status, 302);
    const replay = await postAuthorize(handler, env, { action: 'approve', transaction_id: transactionId! }, cookie);
    assert.strictEqual(replay.status, 400);
  });

  await asyncTest('cancel redirects only to the stored, registered redirect_uri', async () => {
    const handler = new ABsmartlyOAuthHandler();
    const env = makeEnv(validAuthRequest());
    const { transactionId, cookie } = await startConsent(handler, env);
    const res = await postAuthorize(handler, env, {
      action: 'cancel',
      transaction_id: transactionId!,
      redirect_uri: ATTACKER_REDIRECT,
    }, cookie);
    assert.strictEqual(res.status, 302);
    const location = new URL(res.headers.get('location')!);
    assert.strictEqual(`${location.origin}${location.pathname}`, LEGIT_REDIRECT);
    assert.strictEqual(location.searchParams.get('error'), 'access_denied');
  });

  await asyncTest('forged approvals cookie does not skip the consent page', async () => {
    const handler = new ABsmartlyOAuthHandler();
    const env = makeEnv(validAuthRequest());
    const forged = btoa(JSON.stringify({ clients: [LEGIT_CLIENT_ID] }));
    for (const cookie of [`absmartly-oauth-approvals=${forged}`, `__Host-absmartly-oauth-approvals=${forged}`]) {
      const res = await handler.fetch(new Request(`${MCP_ORIGIN}/authorize`, { headers: { Cookie: cookie } }), env);
      assert.strictEqual(res.status, 200, 'expected consent page, not a redirect');
      assert.ok((await res.text()).includes('Authorize Access'));
    }
  });

  await asyncTest('approved client skips consent on the next visit from the same browser', async () => {
    const handler = new ABsmartlyOAuthHandler();
    const env = makeEnv(validAuthRequest());
    const { transactionId, cookie } = await startConsent(handler, env);
    const approve = await postAuthorize(handler, env, { action: 'approve', transaction_id: transactionId! }, cookie);
    const approvalCookie = approve.headers.getSetCookie().find(c => c.startsWith('__Host-absmartly-oauth-approvals='));
    assert.ok(approvalCookie, 'approval must set a __Host- cookie');
    assert.ok(/Path=\//.test(approvalCookie!) && /Secure/.test(approvalCookie!) && /HttpOnly/.test(approvalCookie!));
    const next = await handler.fetch(new Request(`${MCP_ORIGIN}/authorize`, {
      headers: { Cookie: approvalCookie!.split(';')[0] },
    }), env);
    assert.strictEqual(next.status, 302);
  });

  await asyncTest('approval for one ABsmartly endpoint does not skip consent for another', async () => {
    const handler = new ABsmartlyOAuthHandler();
    const authRequest = validAuthRequest();
    const env = makeEnv(authRequest);
    const { transactionId, cookie } = await startConsent(handler, env);
    const approve = await postAuthorize(handler, env, { action: 'approve', transaction_id: transactionId! }, cookie);
    const approvalCookie = approve.headers.getSetCookie().find(c => c.startsWith('__Host-absmartly-oauth-approvals='))!.split(';')[0];

    authRequest.resource = `${MCP_ORIGIN}/mcp?absmartly-endpoint=${ATTACKER_ENDPOINT}`;
    const next = await handler.fetch(new Request(`${MCP_ORIGIN}/authorize`, { headers: { Cookie: approvalCookie } }), env);
    assert.strictEqual(next.status, 200, 'a different endpoint must show the consent page again');
    assert.ok((await next.text()).includes(ATTACKER_ENDPOINT));
  });

  await asyncTest('consent page cannot be framed', async () => {
    const handler = new ABsmartlyOAuthHandler();
    const env = makeEnv(validAuthRequest());
    const { res } = await startConsent(handler, env);
    assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
    assert.ok(res.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
  });

  await asyncTest('GET /authorize without redirect_uri is rejected', async () => {
    const handler = new ABsmartlyOAuthHandler();
    const env = makeEnv(validAuthRequest({ redirectUri: '' }));
    const res = await handler.fetch(new Request(`${MCP_ORIGIN}/authorize`), env);
    assert.strictEqual(res.status, 400);
  });

  await asyncTest('GET /authorize with an unregistered redirect_uri is rejected', async () => {
    const handler = new ABsmartlyOAuthHandler();
    const env = makeEnv(validAuthRequest({ redirectUri: ATTACKER_REDIRECT }));
    const res = await handler.fetch(new Request(`${MCP_ORIGIN}/authorize`), env);
    assert.strictEqual(res.status, 400);
  });

  await asyncTest('client registered before the allowlist cannot authorize to an attacker redirect', async () => {
    const handler = new ABsmartlyOAuthHandler();
    // The attacker's redirect is registered on its own client (as in the reported PoC),
    // so only the allowlist check at /authorize stops it.
    const env = makeEnv(validAuthRequest({ redirectUri: ATTACKER_REDIRECT }), [ATTACKER_REDIRECT]);
    const res = await handler.fetch(new Request(`${MCP_ORIGIN}/authorize`), env);
    assert.strictEqual(res.status, 400);
    const consentKeys = [...env.OAUTH_KV.store.keys()].filter(k => k.startsWith('oauth:consent:'));
    assert.strictEqual(consentKeys.length, 0, 'no consent page may be offered for a disallowed redirect');
  });

  await asyncTest('GET /authorize without PKCE is rejected', async () => {
    const handler = new ABsmartlyOAuthHandler();
    const env = makeEnv(validAuthRequest({ codeChallenge: undefined }));
    const res = await handler.fetch(new Request(`${MCP_ORIGIN}/authorize`), env);
    assert.strictEqual(res.status, 400);
  });

  await asyncTest('GET /authorize with plain PKCE is rejected', async () => {
    const handler = new ABsmartlyOAuthHandler();
    const env = makeEnv(validAuthRequest({ codeChallengeMethod: 'plain' }));
    const res = await handler.fetch(new Request(`${MCP_ORIGIN}/authorize`), env);
    assert.strictEqual(res.status, 400);
  });

  await asyncTest('consent page names the host that will receive the authorization', async () => {
    const handler = new ABsmartlyOAuthHandler();
    const env = makeEnv(validAuthRequest());
    const { page } = await startConsent(handler, env);
    assert.ok(page.includes('claude.ai'), 'consent page must show the redirect host');
    assert.ok(!page.includes('name="redirect_uri"'), 'consent form must not carry redirect_uri');
  });

  await asyncTest('isAllowedRedirectUri accepts expected client callbacks', async () => {
    for (const uri of [
      'https://claude.ai/api/mcp/auth_callback',
      'http://localhost:6274/oauth/callback',
      'http://127.0.0.1:33418/callback',
      'cursor://anysphere.cursor-mcp/oauth/callback',
    ]) {
      assert.ok(isAllowedRedirectUri(uri), `expected ${uri} to be allowed`);
    }
  });

  await asyncTest('isAllowedRedirectUri rejects dangerous or insecure callbacks', async () => {
    for (const uri of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'http://attacker.example/cb',
      'https://user:pass@attacker.example/cb',
      'https://client.example/cb#frag',
      'not a url',
    ]) {
      assert.ok(!isAllowedRedirectUri(uri), `expected ${uri} to be rejected`);
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
