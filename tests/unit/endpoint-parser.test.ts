// parseAbsmartlyEndpoint is the one parser every endpoint entry point uses
// (OAuth consent, API-key requests, stored props, FetchHttpClient).
import { canonicalizeEndpoint, firstValidEndpoint, InvalidEndpointError, isValidAbsmartlyEndpoint, normalizeEndpoint, parseAbsmartlyEndpoint, tryParseAbsmartlyEndpoint } from '../../src/oauth/index.js';

export default async function runTests() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];
  function assertEquals(actual: unknown, expected: unknown, name: string) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a === b) { passed++; details.push({ name, status: 'PASS' }); }
    else { failed++; details.push({ name, status: 'FAIL', error: `Expected ${b}, got ${a}` }); }
  }

  for (const [input, baseUrl, apiUrl] of [
    ['https://acme.absmartly.com', 'https://acme.absmartly.com', 'https://acme.absmartly.com/v1'],
    ['https://acme.absmartly.com/v1/', 'https://acme.absmartly.com', 'https://acme.absmartly.com/v1'],
    ['https://acme.absmartly.com/V1', 'https://acme.absmartly.com', 'https://acme.absmartly.com/v1'],
    ['  acme.absmartly.com  ', 'https://acme.absmartly.com', 'https://acme.absmartly.com/v1'],
    ['http://localhost:3000/v1', 'http://localhost:3000', 'http://localhost:3000/v1'],
    ['https://h.example//tenant//v1', 'https://h.example/tenant', 'https://h.example/tenant/v1'],
    ['https://h.example/@team', 'https://h.example/@team', 'https://h.example/@team/v1'],
    ['https://corp.example/absmartly/v2', 'https://corp.example/absmartly/v2', 'https://corp.example/absmartly/v2/v1'],
    ['https://corp.example/absmartly/v2/v1', 'https://corp.example/absmartly/v2', 'https://corp.example/absmartly/v2/v1'],
  ]) {
    const parsed = parseAbsmartlyEndpoint(input);
    assertEquals([parsed.baseUrl, parsed.apiUrl], [baseUrl, apiUrl], `parses ${JSON.stringify(input)}`);
    assertEquals(canonicalizeEndpoint(input), baseUrl, `canonicalizeEndpoint ${JSON.stringify(input)}`);
  }

  for (const bad of ['', '   ', 'https://', 'ftp://acme.absmartly.com', 'https://u:p@acme.absmartly.com', 'https://acme.absmartly.com/?a=1', 'https://acme.absmartly.com/#x',
    'https://acme.absmartly.com/a%2f..%2fadmin', 'https://acme.absmartly.com/%2e%2e', 'https://acme.absmartly.com/x/%2E', 'https://acme.absmartly.com/a%5Cb', 'https://acme.absmartly.com/tenant/../admin', 'acme.absmartly.com/./x', 'https://acme.absmartly.com/base\\..\\..\\y', 'acme.absmartly.com\\admin',
    'https://acme.absmartly.com/a/.\t./b', 'https://acme.absmartly.com/a/.\n./v1', 'https://acme.absmartly.com/a/%2e\t%2e/b', 'https://acme.absmartly.com/caf\u00e9',
    'https://acme.absmartly.com/proxy/..?', 'https://acme.absmartly.com/proxy/..#', 'https://acme.absmartly.com/proxy?', 'https://acme.absmartly.com/%252e%252e', 'https://acme.absmartly.com/caf%C3%A9', 'https://acme.absmartly.com/a%09b']) {
    let error: unknown;
    try { parseAbsmartlyEndpoint(bad); } catch (e) { error = e; }
    assertEquals(error instanceof InvalidEndpointError && (error as Error).message.startsWith('Invalid ABsmartly endpoint'), true, `rejects ${JSON.stringify(bad)}`);
    assertEquals(isValidAbsmartlyEndpoint(bad), false, `isValidAbsmartlyEndpoint(${JSON.stringify(bad)}) is false`);
    assertEquals(canonicalizeEndpoint(bad), '', `canonicalizeEndpoint(${JSON.stringify(bad)}) is ""`);
    assertEquals(tryParseAbsmartlyEndpoint(bad), null, `tryParseAbsmartlyEndpoint(${JSON.stringify(bad)}) is null`);
  }

  // normalizeEndpoint keeps its 2.0 behaviour for existing callers (deprecated).
  for (const [input, expected] of [
    ['acme.absmartly.com/', 'https://acme.absmartly.com'],
    ['https://acme.absmartly.com/v1/', 'https://acme.absmartly.com/v1'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['', ''],
  ]) {
    assertEquals(normalizeEndpoint(input), expected, `normalizeEndpoint (2.0 behaviour) ${JSON.stringify(input)}`);
  }

  // firstValidEndpoint: an invalid higher-priority source never hides a valid one.
  assertEquals(firstValidEndpoint(['bad host', null, 'acme.absmartly.com']), { endpoint: 'acme.absmartly.com', rejected: 'bad host' }, 'firstValidEndpoint skips an invalid source');
  assertEquals(firstValidEndpoint([undefined, 'https://a.absmartly.com', 'ftp://x']), { endpoint: 'https://a.absmartly.com', rejected: null }, 'firstValidEndpoint takes the first valid one');
  assertEquals(firstValidEndpoint(['ftp://x', '']), { endpoint: null, rejected: 'ftp://x' }, 'firstValidEndpoint reports a rejection with no valid source');

  return { success: failed === 0, message: `${passed} passed, ${failed} failed`, testCount: passed + failed, details };
}
