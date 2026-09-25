import assert from 'node:assert';
import {
  beginAuthorization,
  submitConsent,
  type AuthorizationRequest,
  type ConsentOptions,
  type OAuthStateStore,
} from '../../src/oauth/index.js';

const LEGIT_REDIRECT = 'http://localhost:3118/callback';
const CIMD_CLIENT = 'https://claude.ai/oauth/claude-code-client-metadata';
const FORM_ACTION = '/auth/oauth/authorize';

function memoryStore(): OAuthStateStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    put: async (k, v) => { data.set(k, v); },
    delete: async (k) => { data.delete(k); },
  };
}

function options(store: OAuthStateStore, extra: Partial<ConsentOptions> = {}): ConsentOptions {
  return {
    store,
    formAction: FORM_ACTION,
    lookupClient: async (id) => id === CIMD_CLIENT
      ? { clientId: id, clientName: 'Claude Code', redirectUris: ['http://localhost/callback'] }
      : null,
    ...extra,
  };
}

function request(overrides: Partial<AuthorizationRequest> = {}): AuthorizationRequest {
  return {
    responseType: 'code',
    clientId: CIMD_CLIENT,
    redirectUri: LEGIT_REDIRECT,
    scope: ['mcp:access'],
    state: 's1',
    codeChallenge: 'challenge',
    codeChallengeMethod: 'S256',
    ...overrides,
  };
}

function cookiePair(setCookie: string): string {
  return setCookie.split(';')[0];
}

async function start(store: OAuthStateStore, extra: Partial<ConsentOptions> = {}) {
  const outcome = await beginAuthorization({ authRequest: request(), endpoint: null, cookieHeader: null }, options(store, extra));
  assert.strictEqual(outcome.type, 'respond');
  if (outcome.type !== 'respond') throw new Error('unreachable');
  const body = outcome.response.body || '';
  const transactionId = body.match(/name="transaction_id" value="([^"]+)"/)?.[1] || '';
  return { outcome, body, transactionId, cookie: cookiePair(outcome.response.setCookies[0] || '') };
}

export default async function run() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];

  async function asyncTest(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; details.push({ name, status: 'PASS' }); }
    catch (e: any) { failed++; details.push({ name, status: 'FAIL', error: e.message }); }
  }

  await asyncTest('backend mode (no endpoint needed) shows consent with loopback warning and framing protection', async () => {
    const { outcome, body, transactionId, cookie } = await start(memoryStore());
    if (outcome.type !== 'respond') return;
    assert.ok(body.includes('Authorize Access'));
    assert.ok(body.includes('Claude Code'));
    assert.ok(body.includes('an app running on this computer'), 'loopback redirect must show the extra warning');
    assert.ok(body.includes(`action="${FORM_ACTION}"`));
    assert.strictEqual(outcome.response.headers['X-Frame-Options'], 'DENY');
    assert.ok(transactionId);
    assert.ok(cookie.startsWith(`__Host-absmartly-oauth-consent-${transactionId}=`));
  });

  await asyncTest('approve returns the stored request, ignoring nothing from the form', async () => {
    const store = memoryStore();
    const { transactionId, cookie } = await start(store);
    const outcome = await submitConsent({ form: { action: 'approve', transactionId }, cookieHeader: cookie }, options(store));
    assert.strictEqual(outcome.type, 'approved');
    if (outcome.type === 'approved') {
      assert.strictEqual(outcome.authRequest.redirectUri, LEGIT_REDIRECT);
      assert.strictEqual(outcome.authRequest.codeChallenge, 'challenge');
      assert.ok(outcome.setCookies.some((c) => c.includes('Max-Age=0')), 'binding cookie must be cleared');
    }
  });

  await asyncTest('two consent pages in the same browser can both be completed', async () => {
    const store = memoryStore();
    const a = await start(store);
    const b = await start(store);
    const bothCookies = `${a.cookie}; ${b.cookie}`;
    const first = await submitConsent({ form: { action: 'approve', transactionId: a.transactionId }, cookieHeader: bothCookies }, options(store));
    const second = await submitConsent({ form: { action: 'cancel', transactionId: b.transactionId }, cookieHeader: bothCookies }, options(store));
    assert.strictEqual(first.type, 'approved');
    assert.strictEqual(second.type, 'respond');
    if (second.type === 'respond') assert.strictEqual(second.response.status, 302);
  });

  await asyncTest('consent from another browser, or replayed, is rejected', async () => {
    const store = memoryStore();
    const { transactionId, cookie } = await start(store);
    const other = await submitConsent({ form: { action: 'approve', transactionId }, cookieHeader: null }, options(store));
    assert.strictEqual(other.type, 'respond');
    const ok = await submitConsent({ form: { action: 'approve', transactionId }, cookieHeader: cookie }, options(store));
    assert.strictEqual(ok.type, 'approved');
    const replay = await submitConsent({ form: { action: 'approve', transactionId }, cookieHeader: cookie }, options(store));
    assert.strictEqual(replay.type, 'respond');
  });

  await asyncTest('attacker redirect and missing PKCE never reach consent', async () => {
    const store = memoryStore();
    const bad = options(store, { lookupClient: async (id) => ({ clientId: id, redirectUris: ['https://attacker.com/cb'] }) });
    const redirect = await beginAuthorization({ authRequest: request({ redirectUri: 'https://attacker.com/cb' }), endpoint: null, cookieHeader: null }, bad);
    const pkce = await beginAuthorization({ authRequest: request({ codeChallengeMethod: 'plain' }), endpoint: null, cookieHeader: null }, options(store));
    for (const outcome of [redirect, pkce]) {
      assert.strictEqual(outcome.type, 'respond');
      if (outcome.type === 'respond') assert.strictEqual(outcome.response.status, 400);
    }
    assert.strictEqual(store.data.size, 0, 'no transaction may be stored');
  });

  await asyncTest('secure:false drops the __Host- prefix and Secure for local http', async () => {
    const { outcome } = await start(memoryStore(), { secure: false });
    if (outcome.type !== 'respond') return;
    const cookie = outcome.response.setCookies[0];
    assert.ok(cookie.startsWith('absmartly-oauth-consent-'));
    assert.ok(!cookie.includes('Secure'));
  });

  await asyncTest('an approval for one ABsmartly endpoint does not skip consent for another', async () => {
    const store = memoryStore();
    const extra: Partial<ConsentOptions> = { rememberApprovals: true, requireEndpoint: true };
    const ENDPOINT_A = 'https://a.absmartly.com';
    const ENDPOINT_B = 'https://b.absmartly.com';

    const beginA = await beginAuthorization({ authRequest: request(), endpoint: ENDPOINT_A, cookieHeader: null }, options(store, extra));
    assert.strictEqual(beginA.type, 'respond');
    if (beginA.type !== 'respond') return;
    const bodyA = beginA.response.body || '';
    const transactionIdA = bodyA.match(/name="transaction_id" value="([^"]+)"/)?.[1] || '';
    const bindingCookieA = cookiePair(beginA.response.setCookies[0] || '');

    const approveA = await submitConsent(
      { form: { action: 'approve', transactionId: transactionIdA }, cookieHeader: bindingCookieA },
      options(store, extra),
    );
    assert.strictEqual(approveA.type, 'approved');
    if (approveA.type !== 'approved') return;
    const approvalCookie = cookiePair(approveA.setCookies.find((c) => c.includes('absmartly-oauth-approvals=')) || '');
    assert.ok(approvalCookie, 'approving must set the approvals cookie');

    // Same client, same approvals cookie, but a different ABsmartly endpoint: must still show consent.
    const beginB = await beginAuthorization({ authRequest: request(), endpoint: ENDPOINT_B, cookieHeader: approvalCookie }, options(store, extra));
    assert.strictEqual(beginB.type, 'respond', 'a different endpoint must not be skipped by an approval for another endpoint');
    if (beginB.type === 'respond') assert.strictEqual(beginB.response.status, 200);

    // The original endpoint is still remembered.
    const beginAAgain = await beginAuthorization({ authRequest: request(), endpoint: ENDPOINT_A, cookieHeader: approvalCookie }, options(store, extra));
    assert.strictEqual(beginAAgain.type, 'approved', 'the originally approved endpoint must still skip consent');
  });

  await asyncTest('onApprove failing keeps the transaction so approve can be retried', async () => {
    const store = memoryStore();
    const { transactionId, cookie } = await start(store);
    let failNext = true;
    const seen: Array<string | null> = [];
    const extra: Partial<ConsentOptions> = {
      onApprove: async (_authRequest, endpoint) => {
        seen.push(endpoint);
        if (failNext) {
          failNext = false;
          throw new Error('endpoint write failed');
        }
      },
    };

    const failed = await submitConsent({ form: { action: 'approve', transactionId }, cookieHeader: cookie }, options(store, extra));
    assert.strictEqual(failed.type, 'respond');
    if (failed.type === 'respond') assert.strictEqual(failed.response.status, 503);
    // The transaction must still be there for a retry.
    assert.ok(store.data.has(`oauth:consent:${transactionId}`), 'transaction must survive a failed onApprove');

    const retry = await submitConsent({ form: { action: 'approve', transactionId }, cookieHeader: cookie }, options(store, extra));
    assert.strictEqual(retry.type, 'approved');
    assert.strictEqual(seen.length, 2, 'onApprove must be called again on retry');
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
