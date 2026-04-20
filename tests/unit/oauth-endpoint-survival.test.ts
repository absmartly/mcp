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

interface AuthRequest {
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string[];
  responseType: string;
  resource?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}

function makeOAuthProvider(authRequest: AuthRequest) {
  return {
    parseAuthRequest: async (_req: Request) => authRequest,
    lookupClient: async (clientId: string) => ({
      clientId,
      clientName: 'Test Client',
      redirectUris: [authRequest.redirectUri],
    }),
    completeAuthorization: async (_opts: any) => ({ redirectTo: 'https://example.com/done' }),
  };
}

async function callAuthorize(
  handler: ABsmartlyOAuthHandler,
  url: string,
  env: any,
  headers: Record<string, string> = {}
): Promise<Response> {
  const req = new Request(url, { method: 'GET', headers });
  return await handler.fetch(req, env);
}

export default async function run() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];

  async function asyncTest(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; details.push({ name, status: 'PASS' }); }
    catch (e: any) { failed++; details.push({ name, status: 'FAIL', error: e.message }); }
  }

  // Scenario 1: endpoint stored in KV by client_id (the documented path)
  await asyncTest('endpoint persisted to KV per client_id is read by /authorize', async () => {
    const handler = new ABsmartlyOAuthHandler();
    const kv = new MockKv();
    const clientId = 'claude-mcp-abc123';
    const expectedEndpoint = 'https://demo-1.absmartly.com';

    // Simulate the linkage that index.ts does on /register success:
    await kv.put(`oauth_endpoint:client:${clientId}`, expectedEndpoint);

    const env = {
      OAUTH_KV: kv,
      OAUTH_PROVIDER: makeOAuthProvider({
        clientId,
        redirectUri: 'https://client.example/callback',
        state: 'xyz',
        scope: ['api:read'],
        responseType: 'code',
      }),
    };

    // /authorize call WITHOUT the absmartly-endpoint query param (typical OAuth redirect).
    const res = await callAuthorize(handler, 'https://mcp.absmartly.com/authorize?client_id=' + clientId + '&redirect_uri=https://client.example/callback&state=xyz&response_type=code&scope=api:read', env);

    // If endpoint is found, handler renders approval page (200 HTML). If form, it's also 200 HTML but with the endpoint input.
    const body = await res.text();
    assert.ok(!body.includes('id="absmartly_endpoint"'),
      'Expected NO endpoint form input to be rendered, but form was shown. Endpoint did NOT survive. Body snippet:\n' + body.slice(0, 400));
    assert.ok(body.includes('Authorize Access') || body.includes('Approve'),
      'Expected approval page, got something else: ' + body.slice(0, 200));
  });

  // Scenario 2: endpoint passed via resource parameter (per RFC 8707) - what well-behaved MCP clients should do
  await asyncTest('endpoint extracted from resource param survives to /authorize', async () => {
    const handler = new ABsmartlyOAuthHandler();
    const kv = new MockKv();
    const clientId = 'mcp-absmartly-universal';
    const sseUrl = 'https://mcp.absmartly.com/sse?absmartly-endpoint=https://demo-2.absmartly.com';

    const env = {
      OAUTH_KV: kv,
      OAUTH_PROVIDER: makeOAuthProvider({
        clientId,
        redirectUri: 'https://client.example/callback',
        state: 'xyz',
        scope: ['api:read'],
        responseType: 'code',
        resource: sseUrl,
      }),
    };

    const res = await callAuthorize(handler, 'https://mcp.absmartly.com/authorize?client_id=' + clientId + '&state=xyz', env);
    const body = await res.text();
    assert.ok(!body.includes('id="absmartly_endpoint"'),
      'Expected NO endpoint form when resource param contains endpoint, but form was shown.');
  });

  // Scenario 3: NO endpoint anywhere - the form MUST be shown
  await asyncTest('no endpoint anywhere triggers form (control case)', async () => {
    const handler = new ABsmartlyOAuthHandler();
    const kv = new MockKv();
    const clientId = 'mcp-absmartly-universal';

    const env = {
      OAUTH_KV: kv,
      OAUTH_PROVIDER: makeOAuthProvider({
        clientId,
        redirectUri: 'https://client.example/callback',
        state: 'xyz',
        scope: ['api:read'],
        responseType: 'code',
      }),
    };

    const res = await callAuthorize(handler, 'https://mcp.absmartly.com/authorize?client_id=' + clientId + '&state=xyz', env);
    const body = await res.text();
    assert.ok(body.includes('id="absmartly_endpoint"'),
      'Expected endpoint form to be rendered when no endpoint provided. Body: ' + body.slice(0, 400));
  });

  // Scenario 4: pre-registered universal client (no /register call) - the failing case
  await asyncTest('static client_id with NO /register and NO resource param loses the endpoint', async () => {
    const handler = new ABsmartlyOAuthHandler();
    const kv = new MockKv();
    const clientId = 'mcp-absmartly-universal';

    // The /sse handler in index.ts stored: oauth_endpoint_pending:{IP-UA}
    // But because /register was never called (client uses static ID), the
    // endpoint never got linked to the client_id. So when /authorize is hit,
    // the endpoint can't be found.
    await kv.put(`oauth_endpoint_pending:1.2.3.4-claude-desktop`,
                 'https://demo-3.absmartly.com');

    const env = {
      OAUTH_KV: kv,
      OAUTH_PROVIDER: makeOAuthProvider({
        clientId,
        redirectUri: 'https://client.example/callback',
        state: 'xyz',
        scope: ['api:read'],
        responseType: 'code',
        // No resource param either — client doesn't include it.
      }),
    };

    const res = await callAuthorize(handler, 'https://mcp.absmartly.com/authorize?client_id=' + clientId + '&state=xyz', env);
    const body = await res.text();
    assert.ok(body.includes('id="absmartly_endpoint"'),
      'When endpoint is only in oauth_endpoint_pending (per fingerprint) and the client uses a static ID without /register, the form should be shown — endpoint did NOT survive. This proves the survival depends on either /register being called OR the resource param being set.');
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
