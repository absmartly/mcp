// parseAbsmartlyEndpoint is the one parser every endpoint entry point uses
// (OAuth consent, API-key requests, stored props, FetchHttpClient).
import { InvalidEndpointError, isValidAbsmartlyEndpoint, normalizeEndpoint, parseAbsmartlyEndpoint } from '../../src/oauth/index.js';

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
  ]) {
    const parsed = parseAbsmartlyEndpoint(input);
    assertEquals([parsed.baseUrl, parsed.apiUrl], [baseUrl, apiUrl], `parses ${JSON.stringify(input)}`);
    assertEquals(normalizeEndpoint(input), baseUrl, `normalizeEndpoint ${JSON.stringify(input)}`);
  }

  for (const bad of ['', '   ', 'https://', 'ftp://acme.absmartly.com', 'https://u:p@acme.absmartly.com', 'https://acme.absmartly.com/?a=1', 'https://acme.absmartly.com/#x', 'https://acme.absmartly.com/v2', 'https://acme.absmartly.com/tenant/V3/']) {
    let error: unknown;
    try { parseAbsmartlyEndpoint(bad); } catch (e) { error = e; }
    assertEquals(error instanceof InvalidEndpointError && (error as Error).message.startsWith('Invalid ABsmartly endpoint'), true, `rejects ${JSON.stringify(bad)}`);
    assertEquals(isValidAbsmartlyEndpoint(bad), false, `isValidAbsmartlyEndpoint(${JSON.stringify(bad)}) is false`);
    assertEquals(normalizeEndpoint(bad), '', `normalizeEndpoint(${JSON.stringify(bad)}) is ""`);
  }

  return { success: failed === 0, message: `${passed} passed, ${failed} failed`, testCount: passed + failed, details };
}
