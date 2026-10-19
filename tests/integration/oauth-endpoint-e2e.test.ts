#!/usr/bin/env node
/**
 * OAuth endpoint handling, end to end through the Worker (wrangler dev).
 *
 * Drives the real HTTP flow: POST /register → GET /authorize → POST /authorize
 * (consent) → 302 to the ABsmartly backend's /auth/oauth/authorize. It checks
 * the Location the Worker redirects to, so no ABsmartly backend is needed.
 *
 * Covers (#66):
 *   - an installation under a sub-path keeps its prefix through authorize →
 *     consent → redirect (`/tenant/v1` → `/tenant/auth/oauth/authorize`), and a
 *     base path that itself ends in /v1 (`/tenant/v1/v1`) keeps that segment;
 *   - the endpoint remembered by an unauthenticated /mcp request reaches
 *     /register and then /authorize with its prefix intact;
 *   - endpoints with no host (`http:///x`) are rejected (API-key transport → 400,
 *     /authorize → the endpoint form, never a redirect).
 *
 * Needs a local Worker (MCP_WORKER_URL, see gate.js): skips locally without
 * one and fails a gated run.
 */

import { createHash, randomBytes } from "crypto";
import { pathToFileURL } from "url";
import { skipSuite, workerUrl } from "./gate.js";

const WORKER_URL = workerUrl();
const REDIRECT_URI = 'http://127.0.0.1:53682/callback';
const BACKEND_AUTHORIZE_PATH = '/auth/oauth/authorize';
const FAKE_HOST = 'https://tenant-e2e.absmartly.invalid';
const PROBE_TIMEOUT_MS = 1500;

type TestResult = { name: string; status: 'PASS' | 'FAIL'; error?: string };

async function isWorkerReachable(): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
        const response = await fetch(`${WORKER_URL}/health`, { signal: controller.signal });
        clearTimeout(timer);
        return response.ok;
    } catch {
        return false;
    }
}

/** A distinct client fingerprint (CF-Connecting-IP + User-Agent) per scenario. */
function fingerprintHeaders(tag: string): Record<string, string> {
    return { 'CF-Connecting-IP': '203.0.113.7', 'User-Agent': `oauth-endpoint-e2e/${tag}/${randomBytes(4).toString('hex')}` };
}

async function registerClient(headers: Record<string, string>): Promise<string> {
    const response = await fetch(`${WORKER_URL}/register`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_name: 'oauth-endpoint-e2e',
            redirect_uris: [REDIRECT_URI],
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
        }),
    });
    const body = await response.json() as { client_id?: string };
    if (!response.ok || !body.client_id) throw new Error(`/register failed: ${response.status} ${JSON.stringify(body)}`);
    return body.client_id;
}

function authorizeUrl(clientId: string, endpoint?: string): string {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const url = new URL(`${WORKER_URL}/authorize`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', REDIRECT_URI);
    url.searchParams.set('scope', 'mcp:access');
    url.searchParams.set('state', randomBytes(8).toString('hex'));
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (endpoint !== undefined) url.searchParams.set('absmartly-endpoint', endpoint);
    return url.toString();
}

function cookiePairs(response: Response): string {
    // Headers.getSetCookie() (Node 19.7+) is missing from the Workers types this project compiles against.
    const setCookies: string[] = (response.headers as unknown as { getSetCookie(): string[] }).getSetCookie();
    return setCookies.map((c) => c.split(';')[0]).join('; ');
}

function hiddenField(html: string, name: string): string | undefined {
    return html.match(new RegExp(`name="${name}" value="([^"]+)"`))?.[1];
}

/** GET /authorize, then approve consent; returns the final response (not followed). */
async function authorizeAndApprove(clientId: string, headers: Record<string, string>, endpoint?: string): Promise<Response> {
    const page = await fetch(authorizeUrl(clientId, endpoint), { headers, redirect: 'manual' });
    if (page.status !== 200) return page;
    const html = await page.text();
    const transactionId = hiddenField(html, 'transaction_id');
    if (!transactionId || !html.includes('value="approve"')) {
        throw new Error(`no consent form (endpoint page instead?): ${html.slice(0, 300)}`);
    }
    return fetch(`${WORKER_URL}/authorize`, {
        method: 'POST',
        headers: { ...headers, Cookie: cookiePairs(page), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ action: 'approve', transaction_id: transactionId }).toString(),
        redirect: 'manual',
    });
}

function expectBackendRedirect(response: Response, expectedAuthorize: string): void {
    const location = response.headers.get('location');
    if (response.status !== 302 || !location) {
        throw new Error(`expected 302 to the backend, got ${response.status} location=${location}`);
    }
    const target = new URL(location);
    const actual = `${target.origin}${target.pathname}`;
    if (actual !== expectedAuthorize) throw new Error(`redirected to ${actual}, expected ${expectedAuthorize}`);
}

async function run() {
    if (!(await isWorkerReachable())) return skipSuite(`local Worker not reachable at ${WORKER_URL}`);

    const results: TestResult[] = [];
    async function test(name: string, fn: () => Promise<void>) {
        process.stdout.write(`\n  ${name} ... `);
        try {
            await fn();
            results.push({ name, status: 'PASS' });
            console.log('PASS');
        } catch (err: any) {
            results.push({ name, status: 'FAIL', error: err?.message || String(err) });
            console.log('FAIL');
            console.log(`    ${err?.message || err}`);
        }
    }

    await test('sub-path endpoint /tenant/v1 keeps /tenant through authorize → consent → redirect', async () => {
        const headers = fingerprintHeaders('subpath');
        const clientId = await registerClient(headers);
        const response = await authorizeAndApprove(clientId, headers, `${FAKE_HOST}/tenant/v1`);
        expectBackendRedirect(response, `${FAKE_HOST}/tenant${BACKEND_AUTHORIZE_PATH}`);
    });

    await test('base path ending in /v1 (/tenant/v1/v1) keeps that segment through the redirect', async () => {
        const headers = fingerprintHeaders('v1v1');
        const clientId = await registerClient(headers);
        const response = await authorizeAndApprove(clientId, headers, `${FAKE_HOST}/tenant/v1/v1`);
        expectBackendRedirect(response, `${FAKE_HOST}/tenant/v1${BACKEND_AUTHORIZE_PATH}`);
    });

    await test('endpoint remembered by unauthenticated /mcp survives /register into /authorize (with prefix)', async () => {
        const headers = fingerprintHeaders('register');
        const probe = await fetch(`${WORKER_URL}/mcp?absmartly-endpoint=${encodeURIComponent(`${FAKE_HOST}/tenant/v1/v1`)}`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
        });
        if (probe.status !== 401) throw new Error(`expected 401 from unauthenticated /mcp, got ${probe.status}`);
        const clientId = await registerClient(headers);
        // No endpoint on /authorize: the one linked to the client at /register is used.
        const response = await authorizeAndApprove(clientId, headers);
        expectBackendRedirect(response, `${FAKE_HOST}/tenant/v1${BACKEND_AUTHORIZE_PATH}`);
    });

    await test('/authorize with a host-less endpoint (http:///x) never redirects to it', async () => {
        const headers = fingerprintHeaders('nohost');
        const clientId = await registerClient(headers);
        const page = await fetch(authorizeUrl(clientId, 'http:///x'), { headers, redirect: 'manual' });
        if (page.status === 302) throw new Error(`redirected to ${page.headers.get('location')}`);
        const html = await page.text();
        if (html.includes('value="approve"')) throw new Error('offered consent for a host-less endpoint');
        if (!html.includes('name="absmartly_endpoint"')) throw new Error(`expected the endpoint form, got: ${html.slice(0, 300)}`);
    });

    await test('API-key transport with a host-less endpoint (http:///x) → 400', async () => {
        const response = await fetch(`${WORKER_URL}/mcp`, {
            method: 'POST',
            headers: {
                ...fingerprintHeaders('apikey-nohost'),
                'Authorization': 'Api-Key e2e-not-a-real-key',
                'x-absmartly-endpoint': 'http:///x',
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
        });
        if (response.status !== 400) throw new Error(`expected 400, got ${response.status}: ${(await response.text()).slice(0, 200)}`);
    });

    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    return { success: failed === 0, message: `${passed} passed, ${failed} failed`, testCount: passed + failed, details: results };
}

export default run;

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    run()
        .then((result) => process.exit(result.success ? 0 : 1))
        .catch((err) => {
            console.error('Fatal:', err);
            process.exit(1);
        });
}
