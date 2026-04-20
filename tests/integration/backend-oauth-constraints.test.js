/**
 * Live integration tests against the ABsmartly backend OAuth provider.
 *
 * These hit https://demo-2.absmartly.com directly — they document and
 * regress the constraints the worker has to satisfy when redirecting
 * users into ABsmartly's OAuth flow:
 *
 *   - PKCE is mandatory on the authorize endpoint
 *   - Only ONE scope per request (the backend rejects multi-scope
 *     even though discovery advertises multiple scopes)
 *   - Discovery advertises mcp:access and user:info
 *
 * Skipped automatically if the backend is unreachable so the test
 * runner stays green offline / behind firewalls.
 */

const BACKEND = process.env.ABSMARTLY_TEST_BACKEND || 'https://demo-2.absmartly.com';
const CLIENT_ID = process.env.ABSMARTLY_TEST_CLIENT_ID || 'mcp-absmartly-universal';
const REDIRECT_URI = 'https://mcp.absmartly.com/oauth/callback';
const FETCH_TIMEOUT_MS = 10000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timer);
  }
}

function buildAuthorizeUrl(params) {
  const url = new URL(`${BACKEND}/auth/oauth/authorize`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

const FIXED_VERIFIER = 'test-verifier-1234567890abcdefghijklmnopqrstuvwx';
async function s256Challenge(verifier) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  let binary = '';
  for (const b of new Uint8Array(buf)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default async function run() {
  let passed = 0;
  let failed = 0;
  const details = [];

  async function test(name, fn) {
    try {
      await fn();
      passed++;
      details.push({ name, status: 'PASS' });
    } catch (e) {
      failed++;
      details.push({ name, status: 'FAIL', error: e.message });
    }
  }

  // Reachability gate — skip cleanly if the backend isn't accessible from this environment.
  try {
    const probe = await fetchWithTimeout(`${BACKEND}/auth/oauth/.well-known/oauth-authorization-server`);
    if (!probe.ok) {
      return {
        success: true,
        message: `backend ${BACKEND} returned ${probe.status} on discovery — skipped`,
        testCount: 0,
        details: [],
      };
    }
  } catch (e) {
    return {
      success: true,
      message: `backend ${BACKEND} unreachable (${e.message}) — skipped`,
      testCount: 0,
      details: [],
    };
  }

  await test('discovery advertises mcp:access and user:info', async () => {
    const r = await fetchWithTimeout(`${BACKEND}/auth/oauth/.well-known/oauth-authorization-server`);
    const body = await r.json();
    if (!Array.isArray(body.scopes_supported)) {
      throw new Error(`scopes_supported missing or not an array: ${JSON.stringify(body)}`);
    }
    if (!body.scopes_supported.includes('mcp:access')) {
      throw new Error(`mcp:access not advertised; got ${JSON.stringify(body.scopes_supported)}`);
    }
    if (!body.scopes_supported.includes('user:info')) {
      throw new Error(`user:info not advertised; got ${JSON.stringify(body.scopes_supported)}`);
    }
  });

  await test('discovery advertises S256 PKCE method', async () => {
    const r = await fetchWithTimeout(`${BACKEND}/auth/oauth/.well-known/oauth-authorization-server`);
    const body = await r.json();
    if (!Array.isArray(body.code_challenge_methods_supported) ||
        !body.code_challenge_methods_supported.includes('S256')) {
      throw new Error(`S256 not advertised; got ${JSON.stringify(body.code_challenge_methods_supported)}`);
    }
  });

  await test('authorize without PKCE on unauthenticated request → 302 to login (PKCE check is post-auth)', async () => {
    // The backend redirects to login first; the PKCE rejection (400 invalid_request,
    // "code_challenge parameter must be provided") only surfaces AFTER the user
    // authenticates and the authorize handler re-runs. The redirect Location
    // preserves the original authorize URL via the `oauth_continue` query param.
    const r = await fetchWithTimeout(buildAuthorizeUrl({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'mcp:access',
      response_type: 'code',
      state: 'no-pkce-test',
    }));
    if (r.status !== 302) throw new Error(`expected 302, got ${r.status}`);
    const loc = r.headers.get('location') || '';
    if (!loc.includes('oauth_continue')) {
      throw new Error(`expected oauth_continue in Location, got ${loc}`);
    }
  });

  await test('authorize with valid PKCE (S256) → 302 (login redirect)', async () => {
    const challenge = await s256Challenge(FIXED_VERIFIER);
    const r = await fetchWithTimeout(buildAuthorizeUrl({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'mcp:access',
      response_type: 'code',
      state: 'pkce-test',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }));
    if (r.status !== 302) {
      throw new Error(`expected 302 redirect to login, got ${r.status}: ${await r.text()}`);
    }
  });

  await test('authorize with single scope mcp:access → 302', async () => {
    const challenge = await s256Challenge(FIXED_VERIFIER);
    const r = await fetchWithTimeout(buildAuthorizeUrl({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'mcp:access',
      response_type: 'code',
      state: 'single-scope',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }));
    if (r.status !== 302) throw new Error(`expected 302, got ${r.status}: ${await r.text()}`);
  });

  await test('authorize with multi-scope (space-separated) → 400 invalid_scope (regression)', async () => {
    const challenge = await s256Challenge(FIXED_VERIFIER);
    const r = await fetchWithTimeout(buildAuthorizeUrl({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'mcp:access user:info',
      response_type: 'code',
      state: 'multi-scope',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }));
    if (r.status !== 400) throw new Error(`expected 400, got ${r.status}: ${await r.text()}`);
    const body = await r.json();
    if (body.error !== 'invalid_scope') {
      throw new Error(`expected error=invalid_scope, got ${JSON.stringify(body)}`);
    }
  });

  await test('authorize with multi-scope (comma-separated) → 400 invalid_scope (regression)', async () => {
    const challenge = await s256Challenge(FIXED_VERIFIER);
    const r = await fetchWithTimeout(buildAuthorizeUrl({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'mcp:access,user:info',
      response_type: 'code',
      state: 'multi-scope-comma',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }));
    if (r.status !== 400) throw new Error(`expected 400, got ${r.status}`);
  });

  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed (live: ${BACKEND})`,
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
