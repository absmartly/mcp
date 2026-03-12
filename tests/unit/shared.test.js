import assert from 'node:assert';

const DEFAULT_ABSMARTLY_ENDPOINT = "https://sandbox.absmartly.com";
const DEFAULT_OAUTH_CLIENT_ID = "mcp-absmartly-universal";
const DEFAULT_API_KEY_USER_EMAIL = "api-key-user";
const CLAUDE_AUTH_CALLBACK_URI = "https://claude.ai/api/mcp/auth_callback";
const API_KEY_SESSION_TTL_SECONDS = 300;
const SESSION_TTL_SECONDS = 86400;
const OAUTH_STATE_TTL_SECONDS = 120;
const APPROVAL_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
};

function normalizeBaseUrl(endpoint) {
  return endpoint.replace(/\/$/, '').replace(/\/v1$/, '');
}

function pickDefined(source, keys) {
  const result = {};
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

console.log('\n📋 shared.test.js');

test('normalizeBaseUrl strips trailing slash', () => {
  assert.strictEqual(normalizeBaseUrl('https://example.com/'), 'https://example.com');
});

test('normalizeBaseUrl strips /v1 suffix', () => {
  assert.strictEqual(normalizeBaseUrl('https://example.com/v1'), 'https://example.com');
});

test('normalizeBaseUrl strips trailing slash then /v1', () => {
  assert.strictEqual(normalizeBaseUrl('https://example.com/v1/'), 'https://example.com');
});

test('normalizeBaseUrl leaves clean URL alone', () => {
  assert.strictEqual(normalizeBaseUrl('https://example.com'), 'https://example.com');
});

test('pickDefined picks only defined keys', () => {
  const source = { a: 1, b: undefined, c: 'hello', d: null, e: 0 };
  const result = pickDefined(source, ['a', 'b', 'c', 'd', 'e']);
  assert.deepStrictEqual(result, { a: 1, c: 'hello', d: null, e: 0 });
});

test('pickDefined ignores keys not in source', () => {
  const result = pickDefined({ a: 1 }, ['a', 'b']);
  assert.deepStrictEqual(result, { a: 1 });
});

test('constants are defined correctly', () => {
  assert.strictEqual(DEFAULT_ABSMARTLY_ENDPOINT, 'https://sandbox.absmartly.com');
  assert.strictEqual(DEFAULT_OAUTH_CLIENT_ID, 'mcp-absmartly-universal');
  assert.strictEqual(API_KEY_SESSION_TTL_SECONDS, 300);
  assert.strictEqual(SESSION_TTL_SECONDS, 86400);
  assert.strictEqual(OAUTH_STATE_TTL_SECONDS, 120);
});

test('CORS_HEADERS has required fields', () => {
  assert.ok(CORS_HEADERS['Access-Control-Allow-Origin']);
  assert.ok(CORS_HEADERS['Access-Control-Allow-Methods']);
  assert.ok(CORS_HEADERS['Access-Control-Allow-Headers']);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
