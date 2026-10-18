/**
 * Live integration tests against the ABsmartly backend OAuth provider.
 *
 * These hit https://demo-2.absmartly.com directly — they document and
 * regress the constraints the worker has to satisfy when redirecting
 * users into ABsmartly's OAuth flow:
 *
 *   - PKCE is mandatory on the authorize endpoint, checked before login
 *   - Space-separated multi-scope is accepted; comma-separated is rejected
 *     (the worker sends the single scope mcp:access either way)
 *   - Discovery advertises mcp:access and user:info
 *
 * Outside a gated run it skips (and logs) when the backend is unreachable,
 * so it can run offline. A gated run fails instead.
 */

import { skipSuite } from './gate.js';

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

  // Reachability check. Outside a gated run, skip (and log) when the backend is unreachable.
  try {
    const probe = await fetchWithTimeout(`${BACKEND}/auth/oauth/.well-known/oauth-authorization-server`);
    if (!probe.ok) {
      return skipSuite(`backend ${BACKEND} returned ${probe.status} on discovery`);
    }
  } catch (e) {
    return skipSuite(`backend ${BACKEND} unreachable (${e.message})`);
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

  await test('authorize without PKCE on unauthenticated request → 400 invalid_request (PKCE checked before login)', async () => {
    // The backend used to redirect to login first and only reject the
    // missing code_challenge after authentication. It now rejects it up front.
    const r = await fetchWithTimeout(buildAuthorizeUrl({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'mcp:access',
      response_type: 'code',
      state: 'no-pkce-test',
    }));
    if (r.status !== 400) throw new Error(`expected 400, got ${r.status}`);
    const body = await r.json();
    if (body.error !== 'invalid_request' || !/PKCE/i.test(body.error_description || '')) {
      throw new Error(`expected invalid_request mentioning PKCE, got ${JSON.stringify(body)}`);
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

  await test('authorize with multi-scope (space-separated) → 302 (accepted)', async () => {
    // The backend used to reject any multi-scope request with
    // invalid_scope. It now accepts the standard space-separated form.
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
    if (r.status !== 302) throw new Error(`expected 302, got ${r.status}: ${await r.text()}`);
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

  await test('userinfo endpoint exists and is advertised in discovery', async () => {
    const r = await fetchWithTimeout(`${BACKEND}/auth/oauth/.well-known/oauth-authorization-server`);
    const body = await r.json();
    if (!body.userinfo_endpoint) {
      throw new Error(`userinfo_endpoint missing from discovery: ${JSON.stringify(body)}`);
    }
  });

  await test('userinfo without bearer token → 401', async () => {
    const r = await fetchWithTimeout(`${BACKEND}/auth/oauth/userinfo`);
    if (r.status !== 401) {
      throw new Error(`expected 401 for unauthenticated userinfo, got ${r.status}: ${await r.text()}`);
    }
  });

  await test('userinfo with bogus bearer token → 401', async () => {
    const r = await fetchWithTimeout(`${BACKEND}/auth/oauth/userinfo`, {
      headers: { 'Authorization': 'Bearer not-a-real-token' },
    });
    if (r.status !== 401) {
      throw new Error(`expected 401 for bogus token, got ${r.status}: ${await r.text()}`);
    }
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
