import assert from 'node:assert';

const DEFAULT_ABSMARTLY_DOMAIN = "absmartly.com";

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

function buildQueryString(params) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  }
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

function buildAuthHeader(authToken, isApiKey) {
  const authType = isApiKey ? 'Api-Key' : 'JWT';
  return {
    'Authorization': `${authType} ${authToken}`,
    'Content-Type': 'application/json',
  };
}

function extractEndpointFromPath(pathname, prefix) {
  if (!pathname.startsWith(prefix + '/')) return null;
  const hostPart = pathname.slice(prefix.length + 1).replace(/\/+$/, '');
  if (!hostPart) return null;
  const host = hostPart.includes('.') ? hostPart : `${hostPart}.${DEFAULT_ABSMARTLY_DOMAIN}`;
  return `https://${host}`;
}

const HTML_ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char]);
}

export default async function run() {
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

  test('buildQueryString returns empty string for no params', () => {
    assert.strictEqual(buildQueryString({}), '');
  });
  test('buildQueryString returns ?-prefixed string', () => {
    const qs = buildQueryString({ page: 1, items: 10 });
    assert.ok(qs.startsWith('?'));
    assert.ok(qs.includes('page=1'));
    assert.ok(qs.includes('items=10'));
  });
  test('buildQueryString excludes undefined and null', () => {
    const qs = buildQueryString({ a: 1, b: undefined, c: null, d: 'ok' });
    assert.ok(!qs.includes('b='));
    assert.ok(!qs.includes('c='));
    assert.ok(qs.includes('a=1'));
    assert.ok(qs.includes('d=ok'));
  });

  test('buildAuthHeader returns Api-Key header for API keys', () => {
    const h = buildAuthHeader('my-token', true);
    assert.strictEqual(h['Authorization'], 'Api-Key my-token');
    assert.strictEqual(h['Content-Type'], 'application/json');
  });
  test('buildAuthHeader returns JWT header for OAuth', () => {
    const h = buildAuthHeader('jwt-token', false);
    assert.strictEqual(h['Authorization'], 'JWT jwt-token');
  });

  test('extractEndpointFromPath returns null when path does not start with prefix', () => {
    assert.strictEqual(extractEndpointFromPath('/other/path', '/sse'), null);
  });
  test('extractEndpointFromPath returns null for prefix without trailing content', () => {
    assert.strictEqual(extractEndpointFromPath('/sse/', '/sse'), null);
  });
  test('extractEndpointFromPath appends .absmartly.com for shortname', () => {
    assert.strictEqual(extractEndpointFromPath('/sse/dev1', '/sse'), 'https://dev1.absmartly.com');
  });
  test('extractEndpointFromPath keeps dotted hostname as-is', () => {
    assert.strictEqual(extractEndpointFromPath('/sse/custom.example.com', '/sse'), 'https://custom.example.com');
  });

  test('escapeHtml escapes all special chars', () => {
    assert.strictEqual(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  });
  test('escapeHtml passes through safe string', () => {
    assert.strictEqual(escapeHtml('hello world'), 'hello world');
  });
  test('escapeHtml handles empty string', () => {
    assert.strictEqual(escapeHtml(''), '');
  });
  test('escapeHtml prevents script injection', () => {
    const result = escapeHtml('<script>alert("xss")</script>');
    assert.ok(!result.includes('<script>'));
    assert.ok(result.includes('&lt;script&gt;'));
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: passed + failed,
  };
}
