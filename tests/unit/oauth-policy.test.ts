import assert from 'node:assert';
import {
  CimdError,
  createClientCredentials,
  createMemoryCimdCache,
  isCimdClientId,
  isRegisteredRedirectUri,
  parseCimdDocument,
  readRegistrationBody,
  redirectUriMatches,
  resolveCimdClient,
  sha256Hex,
  validateClientRegistration,
  verifyPkceS256,
  generatePkcePair,
  isAllowedRedirectUri,
  TRUSTED_CIMD_CLIENT_IDS,
} from '../../src/oauth/index.js';

const CLAUDE_CODE_CIMD = 'https://claude.ai/oauth/claude-code-client-metadata';
const CLAUDE_CIMD = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const GOOSE_CIMD = 'https://goose-docs.ai/oauth/client-metadata.json';
const GOOSE_DOCUMENT = {
  client_id: GOOSE_CIMD,
  client_name: 'goose',
  redirect_uris: ['http://127.0.0.1/oauth_callback', 'http://[::1]/oauth_callback'],
  token_endpoint_auth_method: 'none',
};
const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const UNTRUSTED_CIMD = 'https://attacker.example/client.json';
const CLAUDE_CODE_DOCUMENT = {
  client_id: CLAUDE_CODE_CIMD,
  client_name: 'Claude Code',
  redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
  token_endpoint_auth_method: 'none',
};

type FetchCall = { url: string; init: RequestInit };

function mockFetch(respond: (url: string) => Response): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = (async (input: any, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, init });
    return respond(url);
  }) as typeof fetch;
  return { fetch: fn, calls };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
}

export default async function run() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];

  async function asyncTest(name: string, fn: () => Promise<void> | void) {
    try { await fn(); passed++; details.push({ name, status: 'PASS' }); }
    catch (e: any) { failed++; details.push({ name, status: 'FAIL', error: e.message }); }
  }

  // --- CIMD ---
  await asyncTest('trusted CIMD list is exactly the Claude, Claude Code, VS Code and Goose documents', () => {
    assert.deepStrictEqual([...TRUSTED_CIMD_CLIENT_IDS].sort(), [
      CLAUDE_CODE_CIMD,
      CLAUDE_CIMD,
      GOOSE_CIMD,
      'https://insiders.vscode.dev/oauth/client-metadata.json',
      'https://vscode.dev/oauth/client-metadata.json',
    ].sort());
  });

  await asyncTest('resolves the Claude Desktop and claude.ai document to its allowlisted callback', async () => {
    const document = { client_id: CLAUDE_CIMD, client_name: 'Claude', redirect_uris: [CLAUDE_CALLBACK], token_endpoint_auth_method: 'none' };
    const mock = mockFetch(() => new Response(JSON.stringify(document), { headers: { 'Content-Type': 'application/json' } }));
    const client = await resolveCimdClient(CLAUDE_CIMD, { fetch: mock.fetch });
    assert.deepStrictEqual(client.redirectUris, [CLAUDE_CALLBACK]);
    assert.ok(isAllowedRedirectUri(CLAUDE_CALLBACK));
  });

  await asyncTest('resolves the Goose document and matches its loopback callback on any port', async () => {
    const mock = mockFetch(() => jsonResponse(GOOSE_DOCUMENT));
    const client = await resolveCimdClient(GOOSE_CIMD, { fetch: mock.fetch });
    assert.deepStrictEqual(client.redirectUris, GOOSE_DOCUMENT.redirect_uris);
    assert.ok(isRegisteredRedirectUri('http://127.0.0.1:63752/oauth_callback', client.redirectUris));
    assert.ok(!isRegisteredRedirectUri('http://127.0.0.1:63752/other', client.redirectUris));
  });

  await asyncTest('isCimdClientId requires https with a non-root path', () => {
    assert.ok(isCimdClientId(CLAUDE_CODE_CIMD));
    assert.ok(!isCimdClientId('https://claude.ai/'));
    assert.ok(!isCimdClientId('http://claude.ai/oauth/x'));
    assert.ok(!isCimdClientId('tp9FX2O10Lljv68C'));
    assert.ok(!isCimdClientId(null));
  });

  await asyncTest('untrusted CIMD client_id is rejected without any fetch', async () => {
    const mock = mockFetch(() => jsonResponse({}));
    await assert.rejects(resolveCimdClient(UNTRUSTED_CIMD, { fetch: mock.fetch }), CimdError);
    await assert.rejects(resolveCimdClient('http://169.254.169.254/latest/meta-data', { fetch: mock.fetch }), CimdError);
    assert.strictEqual(mock.calls.length, 0, 'no outbound request may be made for an untrusted client_id');
  });

  await asyncTest('trusted CIMD document resolves, refuses redirects, and is cached', async () => {
    const mock = mockFetch(() => jsonResponse(CLAUDE_CODE_DOCUMENT));
    const cache = createMemoryCimdCache();
    const client = await resolveCimdClient(CLAUDE_CODE_CIMD, { fetch: mock.fetch, cache });
    assert.strictEqual(client.clientName, 'Claude Code');
    assert.deepStrictEqual(client.redirectUris, CLAUDE_CODE_DOCUMENT.redirect_uris);
    assert.strictEqual(mock.calls[0].init.redirect, 'error');
    await resolveCimdClient(CLAUDE_CODE_CIMD, { fetch: mock.fetch, cache });
    assert.strictEqual(mock.calls.length, 1, 'second resolve must come from the cache');
  });

  await asyncTest('CIMD document with mismatched client_id is rejected', async () => {
    const mock = mockFetch(() => jsonResponse({ ...CLAUDE_CODE_DOCUMENT, client_id: 'https://claude.ai/other' }));
    await assert.rejects(resolveCimdClient(CLAUDE_CODE_CIMD, { fetch: mock.fetch }), /does not match/);
  });

  await asyncTest('oversized CIMD document is rejected', async () => {
    const big = { ...CLAUDE_CODE_DOCUMENT, client_name: 'x'.repeat(10 * 1024) };
    const mock = mockFetch(() => new Response(JSON.stringify(big), { status: 200 }));
    await assert.rejects(resolveCimdClient(CLAUDE_CODE_CIMD, { fetch: mock.fetch }), /too large/);
  });

  await asyncTest('CIMD non-200 and fetch failures surface as CimdError', async () => {
    await assert.rejects(resolveCimdClient(CLAUDE_CODE_CIMD, { fetch: mockFetch(() => new Response('', { status: 404 })).fetch }), CimdError);
    const throwing = (async () => { throw new TypeError('redirect not allowed'); }) as typeof fetch;
    await assert.rejects(resolveCimdClient(CLAUDE_CODE_CIMD, { fetch: throwing }), CimdError);
  });

  await asyncTest('CIMD drops disallowed redirect URIs and rejects confidential clients', () => {
    const client = parseCimdDocument(CLAUDE_CODE_CIMD, { ...CLAUDE_CODE_DOCUMENT, redirect_uris: ['https://attacker.com/cb', 'http://localhost/callback'] });
    assert.deepStrictEqual(client.redirectUris, ['http://localhost/callback']);
    assert.throws(() => parseCimdDocument(CLAUDE_CODE_CIMD, { ...CLAUDE_CODE_DOCUMENT, redirect_uris: ['https://attacker.com/cb'] }), CimdError);
    assert.throws(() => parseCimdDocument(CLAUDE_CODE_CIMD, { ...CLAUDE_CODE_DOCUMENT, token_endpoint_auth_method: 'private_key_jwt' }), CimdError);
  });

  // --- Loopback redirect matching (Claude Code publishes portless loopback URIs) ---
  await asyncTest('loopback redirect matches a registered loopback URI on any port', () => {
    assert.ok(redirectUriMatches('http://localhost:3118/callback', 'http://localhost/callback'));
    assert.ok(redirectUriMatches('http://127.0.0.1:33418/', 'http://127.0.0.1:33418/'));
    assert.ok(!redirectUriMatches('http://localhost:3118/other', 'http://localhost/callback'));
    assert.ok(!redirectUriMatches('http://127.0.0.1:3118/callback', 'http://localhost/callback'));
    assert.ok(!redirectUriMatches('https://claude.ai/api/mcp/auth_callback?x=1', 'https://claude.ai/api/mcp/auth_callback'));
    assert.ok(isRegisteredRedirectUri('http://localhost:3118/callback', CLAUDE_CODE_DOCUMENT.redirect_uris));
  });

  // --- Registration ---
  await asyncTest('validateClientRegistration accepts allowed redirects and public clients', () => {
    const result = validateClientRegistration({ client_name: 'Cursor', redirect_uris: ['cursor://anysphere.cursor-mcp/oauth/callback'], token_endpoint_auth_method: 'none' });
    assert.ok(result.ok);
    if (result.ok) assert.strictEqual(result.registration.tokenEndpointAuthMethod, 'none');
  });

  await asyncTest('validateClientRegistration rejects the reported PoC registration', () => {
    const result = validateClientRegistration({ client_name: 'probe-A', redirect_uris: ['https://attacker.com/cb'], token_endpoint_auth_method: 'client_secret_basic' });
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.strictEqual(result.error.error, 'invalid_redirect_uri');
      assert.ok(!result.error.description.includes('attacker.com'), 'must not reflect the rejected URI');
    }
  });

  await asyncTest('validateClientRegistration rejects missing redirects and unknown auth methods', () => {
    assert.ok(!validateClientRegistration({}).ok);
    assert.ok(!validateClientRegistration({ redirect_uris: [] }).ok);
    const bad = validateClientRegistration({ redirect_uris: ['http://localhost/cb'], token_endpoint_auth_method: 'private_key_jwt' });
    assert.ok(!bad.ok && bad.error.error === 'invalid_client_metadata');
  });

  await asyncTest('readRegistrationBody counts bytes, not characters', async () => {
    // 600k two-byte characters: under 1 MiB of UTF-16 code units, over 1 MiB of UTF-8.
    const body = JSON.stringify({ redirect_uris: ['http://localhost/' + 'é'.repeat(600 * 1024)] });
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } });
    const request = new Request('https://x/register', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    const result = await readRegistrationBody(request);
    assert.ok(!result.ok && result.error.status === 413);
  });

  await asyncTest('createClientCredentials omits a secret for public clients and hashes confidential ones', async () => {
    const pub = await createClientCredentials('none');
    assert.strictEqual(pub.clientSecret, undefined);
    assert.strictEqual(pub.clientId.length, 16);
    const conf = await createClientCredentials('client_secret_basic');
    assert.ok(conf.clientSecret && conf.clientSecret.length === 32);
    assert.strictEqual(conf.clientSecretHash, await sha256Hex(conf.clientSecret!));
  });

  // --- PKCE ---
  await asyncTest('verifyPkceS256 accepts the matching verifier only', async () => {
    const { codeVerifier, codeChallenge } = await generatePkcePair();
    assert.ok(await verifyPkceS256(codeVerifier, codeChallenge));
    assert.ok(!await verifyPkceS256(codeVerifier + 'x', codeChallenge));
    assert.ok(!await verifyPkceS256('short', codeChallenge));
    assert.ok(!await verifyPkceS256(undefined, codeChallenge));
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
