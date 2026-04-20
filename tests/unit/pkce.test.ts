import assert from 'node:assert';
import { generatePkcePair } from '../../src/shared';

const BASE64URL_RE = /^[A-Za-z0-9\-_]+$/;
const RFC7636_VERIFIER_CHARSET_RE = /^[A-Za-z0-9\-._~]+$/;

async function sha256Base64Url(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default async function run() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];

  async function asyncTest(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; details.push({ name, status: 'PASS' }); }
    catch (e: any) { failed++; details.push({ name, status: 'FAIL', error: e.message }); }
  }

  await asyncTest('generatePkcePair returns codeVerifier and codeChallenge', async () => {
    const { codeVerifier, codeChallenge } = await generatePkcePair();
    assert.strictEqual(typeof codeVerifier, 'string');
    assert.strictEqual(typeof codeChallenge, 'string');
    assert.ok(codeVerifier.length > 0);
    assert.ok(codeChallenge.length > 0);
  });

  await asyncTest('codeVerifier is base64url-safe (no +, /, =)', async () => {
    const { codeVerifier } = await generatePkcePair();
    assert.ok(BASE64URL_RE.test(codeVerifier),
      `codeVerifier contains illegal chars: ${codeVerifier}`);
    assert.ok(!codeVerifier.includes('+'));
    assert.ok(!codeVerifier.includes('/'));
    assert.ok(!codeVerifier.includes('='));
  });

  await asyncTest('codeVerifier conforms to RFC 7636 §4.1 charset', async () => {
    const { codeVerifier } = await generatePkcePair();
    assert.ok(RFC7636_VERIFIER_CHARSET_RE.test(codeVerifier));
  });

  await asyncTest('codeVerifier length is 43 chars (32 bytes base64url, no padding)', async () => {
    const { codeVerifier } = await generatePkcePair();
    assert.strictEqual(codeVerifier.length, 43);
    assert.ok(codeVerifier.length >= 43 && codeVerifier.length <= 128,
      'RFC 7636 §4.1 requires 43–128 chars');
  });

  await asyncTest('codeChallenge length is 43 chars (SHA-256 base64url, no padding)', async () => {
    const { codeChallenge } = await generatePkcePair();
    assert.strictEqual(codeChallenge.length, 43);
  });

  await asyncTest('codeChallenge is base64url-safe', async () => {
    const { codeChallenge } = await generatePkcePair();
    assert.ok(BASE64URL_RE.test(codeChallenge));
  });

  await asyncTest('codeChallenge equals base64url(SHA-256(codeVerifier))', async () => {
    const { codeVerifier, codeChallenge } = await generatePkcePair();
    const expected = await sha256Base64Url(codeVerifier);
    assert.strictEqual(codeChallenge, expected,
      'codeChallenge does not match SHA-256(codeVerifier) — backend will reject');
  });

  await asyncTest('successive calls produce different verifiers (high-entropy)', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 16; i++) {
      const { codeVerifier } = await generatePkcePair();
      assert.ok(!seen.has(codeVerifier), 'duplicate codeVerifier generated');
      seen.add(codeVerifier);
    }
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
