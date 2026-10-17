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
const AGENTCORE_CLIENT = 'agentcore-client';
const AGENTCORE_REDIRECT = 'https://bedrock-agentcore.eu-west-1.amazonaws.com/identities/oauth2/callback/3f2b8c1e-9d4a-4e7b-a1c2-5d6e7f8a9b0c';
const SHARED_HOST_WARNING = 'hosts agents and connectors for many organizations';
const LOOPBACK_WARNING = 'an app running on this computer';

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
    lookupClient: async (id) => {
      if (id === CIMD_CLIENT) return { clientId: id, clientName: 'Claude Code', redirectUris: ['http://localhost/callback'] };
      if (id === AGENTCORE_CLIENT) return { clientId: id, clientName: 'mcp-gateway-prod', redirectUris: [AGENTCORE_REDIRECT] };
      return null;
    },
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

async function start(store: OAuthStateStore, extra: Partial<ConsentOptions> = {}, authRequest: AuthorizationRequest = request()) {
  const outcome = await beginAuthorization({ authRequest, endpoint: null, cookieHeader: null }, options(store, extra));
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
    assert.ok(body.includes(LOOPBACK_WARNING), 'loopback redirect must show the extra warning');
    assert.ok(!body.includes(SHARED_HOST_WARNING), 'loopback redirect is not a shared platform host');
    assert.ok(body.includes(`action="${FORM_ACTION}"`));
    assert.strictEqual(outcome.response.headers['X-Frame-Options'], 'DENY');
    assert.ok(transactionId);
    assert.ok(cookie.startsWith(`__Host-absmartly-oauth-consent-${transactionId}=`));
  });

  await asyncTest('shared agent platform callback shows the shared host warning', async () => {
    const { body } = await start(memoryStore(), {}, request({ clientId: AGENTCORE_CLIENT, redirectUri: AGENTCORE_REDIRECT }));
    assert.ok(body.includes('bedrock-agentcore.eu-west-1.amazonaws.com'));
    assert.ok(body.includes(SHARED_HOST_WARNING), 'shared platform host must show the extra warning');
    assert.ok(!body.includes(LOOPBACK_WARNING));
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

  await asyncTest('an invalid stored endpoint mapping shows the endpoint form, and a corrected one works', async () => {
    const store = memoryStore();
    const extra: Partial<ConsentOptions> = { requireEndpoint: true };
    for (const endpoint of ['https://acme.absmartly.com/%2e%2e', 'ftp://acme.absmartly.com', 'https://u:p@acme.absmartly.com', 'https://acme.absmartly.com/?x=1']) {
      const begin = await beginAuthorization({ authRequest: request(), endpoint, cookieHeader: null }, options(store, extra));
      assert.ok(begin.type === 'respond' && begin.response.status === 200 && (begin.response.body ?? '').includes('name="absmartly_endpoint"'), `begin with ${endpoint} shows the endpoint form`);
    }
    const begin = await beginAuthorization({ authRequest: request(), endpoint: 'ftp://acme.absmartly.com', cookieHeader: null }, options(store, extra));
    if (begin.type !== 'respond') throw new Error('unreachable');
    const transactionId = (begin.response.body ?? '').match(/name="transaction_id" value="([^"]+)"/)?.[1] || '';
    const cookie = cookiePair(begin.response.setCookies[0] || '');
    const fixed = await submitConsent({ form: { action: 'set_endpoint', transactionId, endpoint: 'acme.absmartly.com' }, cookieHeader: cookie }, options(store, extra));
    assert.ok(fixed.type === 'respond' && fixed.response.status === 200 && (fixed.response.body ?? '').includes('acme.absmartly.com'), 'the corrected endpoint reaches the consent page');
    const approved = await submitConsent({ form: { action: 'approve', transactionId }, cookieHeader: cookie }, options(store, extra));
    assert.ok(approved.type === 'approved' && approved.endpoint === 'https://acme.absmartly.com', 'and approval carries the canonical endpoint');
  });

  await asyncTest('an invalid endpoint typed into the form is rejected with 400 "Invalid ABsmartly endpoint"', async () => {
    const store = memoryStore();
    const extra: Partial<ConsentOptions> = { requireEndpoint: true };
    const { transactionId, cookie } = await start(store, extra);
    const set = await submitConsent({ form: { action: 'set_endpoint', transactionId, endpoint: 'https://acme.absmartly.com/%2e%2e' }, cookieHeader: cookie }, options(store, extra));
    assert.ok(set.type === 'respond' && set.response.status === 400, 'set_endpoint rejects an invalid endpoint with 400');
    const body = set.type === 'respond' ? set.response.body ?? '' : '';
    assert.ok(body.includes('name="absmartly_endpoint"') && body.includes('Invalid ABsmartly endpoint') && body.includes('role="alert"'), 'and re-renders the endpoint form with the error');
    assert.ok(body.includes(`value="${transactionId}"`), 'keeping the same transaction');
    const empty = await submitConsent({ form: { action: 'set_endpoint', transactionId, endpoint: '  ' }, cookieHeader: cookie }, options(store, extra));
    assert.ok(empty.type === 'respond' && empty.response.status === 400 && empty.response.body === 'ABsmartly endpoint is required', 'an empty endpoint is still "required"');
  });

  await asyncTest('a valid endpoint entering consent is stored in canonical form', async () => {
    const store = memoryStore();
    const extra: Partial<ConsentOptions> = { requireEndpoint: true };
    const { transactionId, cookie } = await start(store, extra);
    await submitConsent({ form: { action: 'set_endpoint', transactionId, endpoint: ' acme.absmartly.com/v1/ ' }, cookieHeader: cookie }, options(store, extra));
    const stored = JSON.parse(store.data.get(`oauth:consent:${transactionId}`) ?? [...store.data.values()].find((v) => v.includes('absmartlyEndpoint')) ?? '{}');
    assert.strictEqual(stored.absmartlyEndpoint, 'https://acme.absmartly.com');
  });

  await asyncTest('a pre-validation transaction with a bad endpoint is rejected before onApprove persists it', async () => {
    const store = memoryStore();
    const persisted: unknown[] = [];
    const extra: Partial<ConsentOptions> = { requireEndpoint: true, onApprove: async (_r, endpoint) => { persisted.push(endpoint); } };
    const { transactionId, cookie } = await start(store, extra);
    const key = [...store.data.keys()].find((k) => k.includes(transactionId))!;
    const tx = JSON.parse(store.data.get(key)!);
    tx.absmartlyEndpoint = 'https://acme.absmartly.com/%2e%2e/admin';
    store.data.set(key, JSON.stringify(tx));
    const outcome = await submitConsent({ form: { action: 'approve', transactionId }, cookieHeader: cookie }, options(store, extra));
    assert.ok(outcome.type === 'respond' && outcome.response.status === 400 && outcome.response.body === 'Invalid ABsmartly endpoint', 'rejected with 400');
    assert.deepStrictEqual(persisted, [], 'onApprove never ran');
  });

  await asyncTest('approvals stored before canonicalisation (with /v1 or an upper-case host) still match', async () => {
    const store = memoryStore();
    const extra: Partial<ConsentOptions> = { requireEndpoint: true, rememberApprovals: true };
    const first = await beginAuthorization({ authRequest: request(), endpoint: 'https://acme.absmartly.com', cookieHeader: null }, options(store, extra));
    if (first.type !== 'respond') throw new Error('unreachable');
    const transactionId = (first.response.body ?? '').match(/name="transaction_id" value="([^"]+)"/)?.[1] || '';
    const cookie = cookiePair(first.response.setCookies[0] || '');
    const approved = await submitConsent({ form: { action: 'approve', transactionId }, cookieHeader: cookie }, options(store, extra));
    if (approved.type !== 'approved') throw new Error('expected approval');
    const approvalsCookie = cookiePair(approved.setCookies.find((c) => c.includes('approv')) ?? '');
    // Rewrite the stored approval into the pre-2.1 shape.
    const approvalsKey = [...store.data.keys()].find((k) => k.startsWith('oauth:approvals:'))!;
    store.data.set(approvalsKey, JSON.stringify([JSON.stringify([CIMD_CLIENT, 'https://ACME.absmartly.com/v1/'])]));
    const again = await beginAuthorization({ authRequest: request(), endpoint: 'https://acme.absmartly.com/v1', cookieHeader: approvalsCookie }, options(store, extra));
    assert.strictEqual(again.type, 'approved', 'the legacy-shaped approval still skips consent');
  });

  await asyncTest('an invalid explicit endpoint falls back to the valid stored mapping, with a visible notice', async () => {
    const store = memoryStore();
    const extra: Partial<ConsentOptions> = { requireEndpoint: true };
    const begin = await beginAuthorization(
      { authRequest: request(), endpoint: 'https://acme.absmartly.com/%2e%2e', fallbackEndpoint: 'https://stored.absmartly.com/v1', cookieHeader: null },
      options(store, extra),
    );
    if (begin.type !== 'respond') throw new Error('unreachable');
    const body = begin.response.body ?? '';
    assert.ok(body.includes('stored.absmartly.com') && !body.includes('name="absmartly_endpoint"'), 'consent is shown for the stored endpoint');
    assert.ok(body.includes('role="status"') && body.includes('is not valid, so https://stored.absmartly.com is used instead'), 'with a notice that the supplied one was ignored');
    const plain = await beginAuthorization({ authRequest: request(), endpoint: null, fallbackEndpoint: 'https://stored.absmartly.com', cookieHeader: null }, options(store, extra));
    assert.ok(plain.type === 'respond' && !(plain.response.body ?? '').includes('role="status"'), 'no notice when no endpoint was supplied');
  });

  await asyncTest('a fallback endpoint is never auto-approved silently, even with a remembered approval', async () => {
    const store = memoryStore();
    const extra: Partial<ConsentOptions> = { requireEndpoint: true, rememberApprovals: true };
    const first = await beginAuthorization({ authRequest: request(), endpoint: 'https://stored.absmartly.com', cookieHeader: null }, options(store, extra));
    if (first.type !== 'respond') throw new Error('unreachable');
    const transactionId = (first.response.body ?? '').match(/name="transaction_id" value="([^"]+)"/)?.[1] || '';
    const approved = await submitConsent({ form: { action: 'approve', transactionId }, cookieHeader: cookiePair(first.response.setCookies[0] || '') }, options(store, extra));
    if (approved.type !== 'approved') throw new Error('expected approval');
    const approvalsCookie = cookiePair(approved.setCookies.find((c) => c.includes('approv')) ?? '');
    const remembered = await beginAuthorization({ authRequest: request(), endpoint: 'https://stored.absmartly.com', cookieHeader: approvalsCookie }, options(store, extra));
    assert.strictEqual(remembered.type, 'approved', 'a valid explicit endpoint still uses the remembered approval');
    const fallback = await beginAuthorization(
      { authRequest: request(), endpoint: 'ftp://bad', fallbackEndpoint: 'https://stored.absmartly.com', cookieHeader: approvalsCookie },
      options(store, extra),
    );
    assert.ok(fallback.type === 'respond' && (fallback.response.body ?? '').includes('role="status"'), 'the fallback shows the consent page with the notice');
  });

  await asyncTest('an invalid explicit endpoint with no fallback shows the endpoint form with an error', async () => {
    const store = memoryStore();
    const begin = await beginAuthorization({ authRequest: request(), endpoint: 'ftp://bad.example', cookieHeader: null }, options(store, { requireEndpoint: true }));
    if (begin.type !== 'respond') throw new Error('unreachable');
    const body = begin.response.body ?? '';
    assert.ok(body.includes('name="absmartly_endpoint"') && body.includes('role="alert"') && body.includes('ftp://bad.example') && body.includes('is not valid'), 'form with the rejection');
    const none = await beginAuthorization({ authRequest: request(), endpoint: null, cookieHeader: null }, options(store, { requireEndpoint: true }));
    assert.ok(none.type === 'respond' && !(none.response.body ?? '').includes('role="alert"'), 'no error when nothing was supplied');
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
