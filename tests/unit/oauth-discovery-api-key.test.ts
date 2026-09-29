import assert from 'node:assert';
import { handleOAuthDiscovery, API_KEY_SESSION_KV_PREFIX } from '../../src/shared';

const MCP_ORIGIN = 'https://mcp.absmartly.com';
const API_KEY_FINGERPRINT = '203.0.113.1-api-key-client';
const OAUTH_FINGERPRINT = '203.0.113.2-oauth-client';
const PROVIDER_METADATA = { issuer: MCP_ORIGIN, code_challenge_methods_supported: ['plain', 'S256'] };
const DISCOVERY_PATHS = [
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-authorization-server/mcp',
  '/.well-known/oauth-protected-resource/sse',
];

class MockKv {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
}

function providerResponse() {
  return async () => new Response(JSON.stringify(PROVIDER_METADATA), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function run() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];

  async function asyncTest(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; details.push({ name, status: 'PASS' }); }
    catch (e: any) { failed++; details.push({ name, status: 'FAIL', error: e.message }); }
  }

  const kv = new MockKv();
  kv.store.set(`${API_KEY_SESSION_KV_PREFIX}${API_KEY_FINGERPRINT}`, 'active');

  for (const path of DISCOVERY_PATHS) {
    await asyncTest(`${path} returns 404 oauth_not_available for an API key session`, async () => {
      let providerCalled = false;
      const res = await handleOAuthDiscovery(
        new Request(`${MCP_ORIGIN}${path}`), kv as unknown as KVNamespace, API_KEY_FINGERPRINT, false,
        async () => { providerCalled = true; return providerResponse()(); }
      );
      assert.strictEqual(res?.status, 404);
      assert.strictEqual(((await res!.json()) as { error: string }).error, 'oauth_not_available');
      assert.strictEqual(providerCalled, false, 'the provider metadata must not be reached');
    });

    await asyncTest(`${path} returns 404 when the discovery request itself carries an API key`, async () => {
      const res = await handleOAuthDiscovery(
        new Request(`${MCP_ORIGIN}${path}`), kv as unknown as KVNamespace, OAUTH_FINGERPRINT, true, providerResponse()
      );
      assert.strictEqual(res?.status, 404);
    });
  }

  await asyncTest('authorization server metadata advertises only S256 without an API key session', async () => {
    const res = await handleOAuthDiscovery(
      new Request(`${MCP_ORIGIN}/.well-known/oauth-authorization-server`),
      kv as unknown as KVNamespace, OAUTH_FINGERPRINT, false, providerResponse()
    );
    assert.strictEqual(res?.status, 200);
    const metadata = await res!.json() as { code_challenge_methods_supported: string[] };
    assert.deepStrictEqual(metadata.code_challenge_methods_supported, ['S256']);
  });

  await asyncTest('protected resource metadata passes through without an API key session', async () => {
    const res = await handleOAuthDiscovery(
      new Request(`${MCP_ORIGIN}/.well-known/oauth-protected-resource`),
      kv as unknown as KVNamespace, OAUTH_FINGERPRINT, false, providerResponse()
    );
    assert.strictEqual(res, null);
  });

  await asyncTest('non-discovery paths are not handled', async () => {
    const res = await handleOAuthDiscovery(
      new Request(`${MCP_ORIGIN}/mcp`), kv as unknown as KVNamespace, API_KEY_FINGERPRINT, true, providerResponse()
    );
    assert.strictEqual(res, null);
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
