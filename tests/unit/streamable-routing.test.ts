import assert from 'node:assert';
import { extractEndpointFromPath, detectApiKey, DEFAULT_ABSMARTLY_DOMAIN } from '../../src/shared';

export default async function run() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];

  function test(name: string, fn: () => void) {
    try { fn(); passed++; details.push({ name, status: 'PASS' }); }
    catch (e: any) { failed++; details.push({ name, status: 'FAIL', error: e.message }); }
  }

  // describe: /mcp transport request shape
  test('detectApiKey falls back to default endpoint when /mcp path has no subdomain', () => {
    const request = new Request('https://mcp.absmartly.com/mcp', {
      headers: { 'Authorization': 'BxYKd1U2_abc123' }
    });
    const result = detectApiKey(request);
    assert.strictEqual(result.apiKey, 'BxYKd1U2_abc123');
    assert.strictEqual(result.endpoint, 'https://sandbox.absmartly.com');
  });

  test('detectApiKey prefers explicit x-absmartly-endpoint over /mcp path', () => {
    const request = new Request('https://mcp.absmartly.com/mcp/demo-1', {
      headers: {
        'Authorization': 'BxYKd1U2_abc123',
        'x-absmartly-endpoint': 'https://override.absmartly.com'
      }
    });
    const result = detectApiKey(request);
    assert.strictEqual(result.endpoint, 'https://override.absmartly.com');
  });

  test('extractEndpointFromPath under /mcp matches the same shape as /sse', () => {
    assert.strictEqual(
      extractEndpointFromPath('/mcp/demo-1', ['/sse', '/mcp']),
      `https://demo-1.${DEFAULT_ABSMARTLY_DOMAIN}`
    );
  });

  return {
    success: failed === 0,
    message: `${passed}/${passed + failed} tests passed`,
    testCount: passed + failed,
    details,
  };
}
