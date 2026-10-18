#!/usr/bin/env node
/**
 * The Worker's OAuth authorization server, end to end, through its real
 * endpoints: discovery, dynamic client registration, the endpoint form and
 * consent page, the upstream redirect, /oauth/callback, the token endpoint
 * (code, PKCE, replay, refresh, revocation), and MCP sessions opened with the
 * issued bearer token over both transports.
 *
 * Replaces multi-tenant-oauth.test.js and oauth-flow.test.js, which POSTed
 * hand-signed JWTs to a path the Worker does not serve and so always skipped.
 *
 * The upstream ABsmartly login needs a browser session: test-1 sends API and
 * service keys to its login page instead of issuing a code. So the upstream
 * here is a loopback stub of the backend's OAuth endpoints. It checks the
 * Worker's side of that contract (client_id, redirect_uri, S256 PKCE, the
 * code exchange) and proxies every API call to test-1, swapping the Worker's
 * `JWT <backend token>` for the test-1 API key, so the OAuth session runs
 * real tools against real data. One check sends the Worker's upstream
 * request to test-1 itself and expects the login redirect, which shows
 * test-1 accepts it. The backend's own discovery, PKCE and userinfo rules
 * are covered against test-1 by backend-oauth-constraints.test.js.
 */

import { createHash, randomBytes, randomUUID } from 'crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { pathToFileURL } from 'url';
import { resolveTestCredentials, SKIP_MESSAGE } from './test-credentials.js';
import { skipSuite, workerUrl } from './gate.js';
import { assert, callTool, connectApiKeyClient, connectClient, createRecorder, execute, snippet, type Transport } from './mcp-sdk-client.js';

const WORKER_UPSTREAM_CLIENT_ID = 'mcp-absmartly-universal';
const CLIENT_REDIRECT_URI = 'http://127.0.0.1:53682/callback';
const DISALLOWED_REDIRECT_URI = 'https://evil.example.com/callback';
const UNTRUSTED_CIMD_CLIENT_ID = 'https://evil.example.com/client-metadata.json';
const SCOPE = 'mcp:access';
const S256 = 'S256';
const CALLBACK_PATH = '/oauth/callback';
const UPSTREAM_AUTHORIZE_PATH = '/auth/oauth/authorize';
const UPSTREAM_TOKEN_PATH = '/auth/oauth/token';
const UPSTREAM_USERINFO_PATH = '/auth/oauth/userinfo';
const PROXIED_PATH = /^\/(v1\/|auth\/current-user)/;
const API_PATH_SUFFIX = /\/v1\/?$/;
const LOOPBACK_IP = '127.0.0.1';
// test-1 accepts loopback callbacks on "localhost" only, so the Worker is
// addressed by that name and builds its upstream redirect_uri from it.
const LOOPBACK_NAME = 'localhost';
const LOGIN_REDIRECT = /\/\?oauth_continue=/;
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_FOUND = 302;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HOP_BY_HOP_HEADERS = ['host', 'connection', 'content-length', 'accept-encoding', 'authorization'];
const STRIPPED_RESPONSE_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'connection'];

type Cookies = Map<string, string>;
type Pkce = { verifier: string; challenge: string };

function pkcePair(): Pkce {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

// Node's fetch has Headers.getSetCookie(); the Workers types this repo
// compiles against do not declare it.
function setCookiesOf(response: Response): string[] {
    return (response.headers as unknown as { getSetCookie(): string[] }).getSetCookie();
}

function absorbCookies(jar: Cookies, response: Response) {
    for (const header of setCookiesOf(response)) {
        const [pair, ...attributes] = header.split(';');
        const eq = pair.indexOf('=');
        const name = pair.slice(0, eq).trim();
        const expired = attributes.some((a: string) => /^\s*max-age=0\s*$/i.test(a) || /^\s*expires=Thu, 01 Jan 1970/i.test(a));
        if (expired) jar.delete(name);
        else jar.set(name, pair.slice(eq + 1).trim());
    }
}

function cookieHeader(jar: Cookies): string {
    return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
}

/**
 * A loopback stand-in for one ABsmartly backend's OAuth endpoints. It plays
 * a user who is already logged in and approves, records what the Worker
 * sent, and forwards API calls to test-1.
 */
function startUpstreamStub(target: { apiKey: string; root: string }) {
    const codes = new Map<string, { challenge: string; redirectUri: string }>();
    const tokens = new Set<string>();
    const log = {
        authorize: [] as URLSearchParams[],
        token: [] as URLSearchParams[],
        tokenErrors: [] as string[],
        proxied: 0,
        proxiedWithoutBackendToken: 0,
    };
    const state = { sessionEnded: false };

    function json(res: ServerResponse, status: number, body: unknown) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
    }

    async function proxy(req: IncomingMessage, res: ServerResponse, url: URL) {
        log.proxied++;
        const token = /^JWT (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
        if (!token || !tokens.has(token)) {
            log.proxiedWithoutBackendToken++;
            return json(res, HTTP_UNAUTHORIZED, { error: 'unauthorized' });
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) {
            if (!HOP_BY_HOP_HEADERS.includes(name) && typeof value === 'string') headers.set(name, value);
        }
        headers.set('Authorization', `Api-Key ${target.apiKey}`);
        const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
        const upstream = await fetch(`${target.root}${url.pathname}${url.search}`, { method: req.method, headers, body });
        const responseHeaders: Record<string, string> = {};
        upstream.headers.forEach((value, name) => {
            if (!STRIPPED_RESPONSE_HEADERS.includes(name)) responseHeaders[name] = value;
        });
        res.writeHead(upstream.status, responseHeaders);
        res.end(Buffer.from(await upstream.arrayBuffer()));
    }

    async function handle(req: IncomingMessage, res: ServerResponse) {
        const url = new URL(req.url ?? '/', `http://${LOOPBACK_IP}`);
        if (req.method === 'GET' && url.pathname === UPSTREAM_AUTHORIZE_PATH) {
            const q = url.searchParams;
            log.authorize.push(q);
            const redirectUri = q.get('redirect_uri') ?? '';
            if (q.get('client_id') !== WORKER_UPSTREAM_CLIENT_ID || q.get('response_type') !== 'code'
                || q.get('code_challenge_method') !== S256 || !q.get('code_challenge') || !redirectUri.endsWith(CALLBACK_PATH)) {
                return json(res, HTTP_BAD_REQUEST, { error: 'invalid_request' });
            }
            const code = randomUUID();
            codes.set(code, { challenge: q.get('code_challenge')!, redirectUri });
            const callback = new URL(redirectUri);
            callback.searchParams.set('code', code);
            callback.searchParams.set('state', q.get('state') ?? '');
            res.writeHead(HTTP_FOUND, { Location: callback.toString() });
            return res.end();
        }
        if (req.method === 'POST' && url.pathname === UPSTREAM_TOKEN_PATH) {
            const form = new URLSearchParams((await readBody(req)).toString());
            log.token.push(form);
            const issued = codes.get(form.get('code') ?? '');
            codes.delete(form.get('code') ?? '');
            const verifier = form.get('code_verifier') ?? '';
            const problem = !issued ? 'unknown or reused code'
                : form.get('grant_type') !== 'authorization_code' ? `grant_type ${form.get('grant_type')}`
                : form.get('client_id') !== WORKER_UPSTREAM_CLIENT_ID ? `client_id ${form.get('client_id')}`
                : form.get('redirect_uri') !== issued.redirectUri ? `redirect_uri ${form.get('redirect_uri')}`
                : createHash('sha256').update(verifier).digest('base64url') !== issued.challenge ? 'code_verifier does not match the S256 challenge'
                : null;
            if (problem) {
                log.tokenErrors.push(problem);
                return json(res, HTTP_BAD_REQUEST, { error: 'invalid_grant', error_description: problem });
            }
            const accessToken = randomBytes(24).toString('base64url');
            tokens.add(accessToken);
            return json(res, HTTP_OK, { access_token: accessToken, token_type: 'Bearer', expires_in: 3600 });
        }
        if (req.method === 'GET' && url.pathname === UPSTREAM_USERINFO_PATH) {
            const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
            if (state.sessionEnded || !token || !tokens.has(token)) return json(res, HTTP_UNAUTHORIZED, { error: 'invalid_token' });
            const upstream = await fetch(`${target.root}${UPSTREAM_USERINFO_PATH}`, { headers: { Authorization: `Api-Key ${target.apiKey}` } });
            return json(res, upstream.status, await upstream.json());
        }
        if (PROXIED_PATH.test(url.pathname)) return proxy(req, res, url);
        return json(res, HTTP_NOT_FOUND, { error: 'not_found' });
    }

    const server: Server = createServer((req, res) => {
        handle(req, res).catch((err) => json(res, 500, { error: String(err?.message || err) }));
    });
    return new Promise<{ endpoint: string; log: typeof log; state: typeof state; close: () => Promise<void> }>((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, LOOPBACK_IP, () => {
            const { port } = server.address() as AddressInfo;
            resolve({
                endpoint: `http://${LOOPBACK_IP}:${port}`,
                log,
                state,
                close: () => new Promise((done) => {
                    server.closeAllConnections();
                    server.close(() => done());
                }),
            });
        });
    });
}

async function run() {
    const credentials = await resolveTestCredentials();
    if (!credentials) return skipSuite(SKIP_MESSAGE);
    const testRoot = credentials.endpoint.replace(API_PATH_SUFFIX, '');

    const workerBase = new URL(workerUrl());
    if (workerBase.hostname === LOOPBACK_IP) workerBase.hostname = LOOPBACK_NAME;
    const worker = workerBase.origin;
    // The Worker keys pending endpoints and API-key sessions on IP + User-Agent,
    // and answers OAuth discovery with 404 for an API-key client. A unique agent
    // keeps the other suites' API-key sessions out of this one.
    const userAgent = `oauth-worker-flow-${randomUUID()}`;
    const baseHeaders = { 'User-Agent': userAgent };
    const recorder = createRecorder('Worker OAuth flow through the real Worker endpoints');
    const { check, section } = recorder;

    const tenantA = await startUpstreamStub({ apiKey: credentials.apiKey, root: testRoot });
    const tenantB = await startUpstreamStub({ apiKey: credentials.apiKey, root: testRoot });

    async function workerFetch(path: string, init: RequestInit & { jar?: Cookies } = {}): Promise<Response> {
        const headers = new Headers(init.headers);
        for (const [name, value] of Object.entries(baseHeaders)) headers.set(name, value);
        if (init.jar && init.jar.size > 0) headers.set('Cookie', cookieHeader(init.jar));
        const response = await fetch(path.startsWith('http') ? path : `${worker}${path}`, { ...init, headers, redirect: 'manual' });
        if (init.jar) absorbCookies(init.jar, response);
        return response;
    }

    async function register(redirectUris = [CLIENT_REDIRECT_URI]): Promise<{ status: number; body: any }> {
        const response = await workerFetch('/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                redirect_uris: redirectUris,
                token_endpoint_auth_method: 'none',
                grant_types: ['authorization_code', 'refresh_token'],
                response_types: ['code'],
                client_name: 'oauth-worker-flow test',
            }),
        });
        return { status: response.status, body: await response.json().catch(() => null) };
    }

    function authorizeQuery(clientId: string, pkce: Pkce, state: string, endpoint?: string): string {
        const query = new URLSearchParams({
            response_type: 'code', client_id: clientId, redirect_uri: CLIENT_REDIRECT_URI, scope: SCOPE, state,
            code_challenge: pkce.challenge, code_challenge_method: S256,
        });
        if (endpoint) query.set('absmartly-endpoint', endpoint);
        return query.toString();
    }

    function transactionOf(html: string): string {
        const id = html.match(/name="transaction_id" value="([^"]+)"/)?.[1];
        assert(id, `no transaction_id in page: ${snippet(html)}`);
        return id;
    }

    async function submitConsent(jar: Cookies, fields: Record<string, string>): Promise<Response> {
        return workerFetch('/authorize', {
            method: 'POST',
            jar,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(fields),
        });
    }

    /** Authorize → consent → upstream → callback. Returns the client redirect's code. */
    async function authorizeToCode(clientId: string, pkce: Pkce, endpoint: string, jar: Cookies = new Map()) {
        const state = randomUUID();
        let response = await workerFetch(`/authorize?${authorizeQuery(clientId, pkce, state, endpoint)}`, { jar });
        if (response.status === HTTP_OK) {
            const html = await response.text();
            response = await submitConsent(jar, { action: 'approve', transaction_id: transactionOf(html) });
        }
        assert(response.status === HTTP_FOUND, `authorize/consent answered ${response.status}`);
        const upstream = response.headers.get('location')!;
        const toCallback = await fetch(upstream, { redirect: 'manual' });
        const callback = toCallback.headers.get('location');
        assert(toCallback.status === HTTP_FOUND && callback, `upstream stub answered ${toCallback.status}`);
        response = await workerFetch(callback, { jar });
        const location = response.headers.get('location') ?? '';
        assert(response.status === HTTP_FOUND && location.startsWith(CLIENT_REDIRECT_URI),
            `callback answered ${response.status}: ${snippet(location || await response.text())} (upstream token errors: ${[...tenantA.log.tokenErrors, ...tenantB.log.tokenErrors].join("; ") || "none"})`);
        const redirect = new URL(location);
        return { code: redirect.searchParams.get('code'), state, redirect, jar };
    }

    async function token(fields: Record<string, string>): Promise<{ status: number; body: any }> {
        const response = await workerFetch('/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(fields),
        });
        return { status: response.status, body: await response.json().catch(() => null) };
    }

    async function exchange(clientId: string, code: string, verifier: string) {
        return token({ grant_type: 'authorization_code', code, redirect_uri: CLIENT_REDIRECT_URI, client_id: clientId, code_verifier: verifier });
    }

    async function bearerStatus(accessToken: string): Promise<number> {
        const response = await workerFetch('/sse', { headers: { Authorization: `Bearer ${accessToken}` } });
        await response.body?.cancel();
        return response.status;
    }

    async function oauthIdentity(accessToken: string, transport: Transport) {
        const client = await connectClient(`oauth-worker-flow-${transport}`, {
            transport,
            url: new URL(`${worker}/${transport}`),
            headers: { ...baseHeaders, Authorization: `Bearer ${accessToken}` },
        });
        try {
            const { text } = await callTool(client, 'get_auth_status');
            const { data } = await execute(client, 'teams', 'listTeams', { items: 1 });
            return { text, teams: Array.isArray(data) ? data : [] };
        } finally {
            await client.close();
        }
    }

    try {
        const apiKeyClient = await connectApiKeyClient('oauth-worker-flow-identity', credentials);
        const { text: realUser } = await callTool(apiKeyClient, 'get_auth_status').finally(() => apiKeyClient.close());
        const realEmail = realUser.match(/Email:\s*(\S+@\S+)/)?.[1];
        assert(realEmail, 'could not read the test-1 user email');

        section('Discovery');
        let resourceMetadataUrl = '';
        for (const path of ['/sse', '/mcp']) {
            await check(`${path} without a token answers 401 with a resource_metadata challenge`, async () => {
                const response = await workerFetch(path);
                await response.body?.cancel();
                assert(response.status === HTTP_UNAUTHORIZED, `status ${response.status}`);
                const challenge = response.headers.get('www-authenticate') ?? '';
                const metadata = challenge.match(/resource_metadata="([^"]+)"/)?.[1];
                assert(challenge.startsWith('Bearer ') && challenge.includes(`scope="${SCOPE}"`), challenge);
                assert(metadata?.endsWith(`/.well-known/oauth-protected-resource${path}`), `resource_metadata ${metadata}`);
                if (path === '/sse') resourceMetadataUrl = metadata!;
            });
        }
        await check('protected-resource metadata names an authorization server and the mcp:access scope', async () => {
            const path = new URL(resourceMetadataUrl).pathname;
            const response = await workerFetch(path);
            const body = await response.json() as any;
            assert(response.status === HTTP_OK, `status ${response.status}`);
            assert(JSON.stringify(body.authorization_servers) === JSON.stringify([worker]),
                `authorization_servers ${JSON.stringify(body.authorization_servers)} is not the Worker under test (${worker})`);
            assert(body.scopes_supported?.includes(SCOPE) && body.bearer_methods_supported?.includes('header'), snippet(JSON.stringify(body)));
        });
        await check('authorization-server metadata advertises the endpoints, S256 only, and both scopes', async () => {
            const response = await workerFetch('/.well-known/oauth-authorization-server');
            const body = await response.json() as any;
            assert(response.status === HTTP_OK, `status ${response.status}`);
            assert(body.issuer === worker, `issuer ${body.issuer} is not the Worker under test (${worker})`);
            for (const [field, path] of [['authorization_endpoint', '/authorize'], ['token_endpoint', '/token'], ['registration_endpoint', '/register']]) {
                assert(body[field] === `${worker}${path}`, `${field} ${body[field]}`);
            }
            assert(JSON.stringify(body.code_challenge_methods_supported) === JSON.stringify([S256]), `methods ${body.code_challenge_methods_supported}`);
            assert(body.scopes_supported?.includes(SCOPE) && body.scopes_supported.includes('user:info'), `scopes ${body.scopes_supported}`);
            assert(body.grant_types_supported?.includes('authorization_code') && body.grant_types_supported.includes('refresh_token'), 'grant types');
        });
        await check('OAuth discovery answers 404 to a client that sent an API key', async () => {
            const response = await workerFetch('/.well-known/oauth-authorization-server', {
                headers: { Authorization: credentials.apiKey, 'x-absmartly-endpoint': credentials.endpoint, 'User-Agent': `${userAgent}-apikey` },
            });
            await response.body?.cancel();
            assert(response.status === HTTP_NOT_FOUND, `status ${response.status}`);
        });

        section('Client registration');
        const registered = await register();
        const clientId: string = registered.body?.client_id;
        await check('/register registers a public client with a loopback redirect', async () => {
            assert(registered.status === HTTP_CREATED, `status ${registered.status}: ${snippet(JSON.stringify(registered.body))}`);
            assert(typeof clientId === 'string' && clientId.length > 0, 'no client_id');
            assert(registered.body.token_endpoint_auth_method === 'none', `auth method ${registered.body.token_endpoint_auth_method}`);
            assert(JSON.stringify(registered.body.redirect_uris) === JSON.stringify([CLIENT_REDIRECT_URI]), 'redirect_uris changed');
        });
        await check('/register rejects a redirect URI outside the allowlist', async () => {
            const { status, body } = await register([DISALLOWED_REDIRECT_URI]);
            assert(status === HTTP_BAD_REQUEST && body?.error === 'invalid_redirect_uri', `status ${status}: ${JSON.stringify(body)}`);
        });
        await check('/authorize rejects an untrusted URL-shaped (CIMD) client_id', async () => {
            const response = await workerFetch(`/authorize?${authorizeQuery(UNTRUSTED_CIMD_CLIENT_ID, pkcePair(), 's', tenantA.endpoint)}`);
            const body = await response.json().catch(() => null) as any;
            assert(response.status === HTTP_UNAUTHORIZED && body?.error === 'invalid_client', `status ${response.status}`);
        });

        section('Authorization request');
        // The provider rejects a public client's request without PKCE before
        // the consent code runs, so no consent page or transaction is created.
        for (const [label, pkceParams] of [
            ['without PKCE', {}],
            ['with plain PKCE', { code_challenge: pkcePair().verifier, code_challenge_method: 'plain' }],
        ] as const) {
            await check(`/authorize ${label} is refused before consent`, async () => {
                const query = new URLSearchParams({
                    response_type: 'code', client_id: clientId, redirect_uri: CLIENT_REDIRECT_URI, scope: SCOPE, state: 's',
                    'absmartly-endpoint': tenantA.endpoint, ...pkceParams,
                });
                const response = await workerFetch(`/authorize?${query}`);
                const text = await response.text();
                assert(response.status === HTTP_BAD_REQUEST, `status ${response.status}: ${snippet(text)}`);
                assert(!text.includes('transaction_id') && setCookiesOf(response).length === 0, 'a consent transaction was started');
            });
        }
        await check('/authorize with a redirect URI the client did not register is refused', async () => {
            const query = new URLSearchParams(authorizeQuery(clientId, pkcePair(), 's', tenantA.endpoint));
            query.set('redirect_uri', 'http://127.0.0.1:1/other');
            const response = await workerFetch(`/authorize?${query}`);
            await response.body?.cancel();
            assert(response.status === HTTP_BAD_REQUEST, `status ${response.status}`);
        });
        await check('without an endpoint, /authorize asks for one, then shows the consent page', async () => {
            const jar: Cookies = new Map();
            let response = await workerFetch(`/authorize?${authorizeQuery(clientId, pkcePair(), 's')}`, { jar });
            let html = await response.text();
            assert(response.status === HTTP_OK && html.includes('name="action" value="set_endpoint"'), `no endpoint form: ${snippet(html)}`);
            response = await submitConsent(jar, { action: 'set_endpoint', transaction_id: transactionOf(html), absmartly_endpoint: tenantA.endpoint });
            html = await response.text();
            assert(response.status === HTTP_OK && html.includes('name="action" value="approve"'), `no consent page: ${snippet(html)}`);
            assert(response.headers.get('x-frame-options') === 'DENY', 'consent page can be framed');
        });
        await check('consent without the transaction cookie is refused', async () => {
            const jar: Cookies = new Map();
            const response = await workerFetch(`/authorize?${authorizeQuery(clientId, pkcePair(), 's', tenantA.endpoint)}`, { jar });
            const transactionId = transactionOf(await response.text());
            const replayed = await submitConsent(new Map(), { action: 'approve', transaction_id: transactionId });
            await replayed.body?.cancel();
            assert(replayed.status === HTTP_BAD_REQUEST, `status ${replayed.status}`);
        });
        await check('cancelling consent redirects to the client with access_denied and the state', async () => {
            const jar: Cookies = new Map();
            const state = randomUUID();
            const response = await workerFetch(`/authorize?${authorizeQuery(clientId, pkcePair(), state, tenantA.endpoint)}`, { jar });
            const cancelled = await submitConsent(jar, { action: 'cancel', transaction_id: transactionOf(await response.text()) });
            const location = new URL(cancelled.headers.get('location') ?? 'http://invalid/');
            assert(cancelled.status === HTTP_FOUND && location.origin + location.pathname === CLIENT_REDIRECT_URI, `status ${cancelled.status}`);
            assert(location.searchParams.get('error') === 'access_denied' && location.searchParams.get('state') === state, location.search);
        });
        await check('approving sends the browser upstream with the Worker client, its callback and S256 PKCE', async () => {
            const jar: Cookies = new Map();
            const response = await workerFetch(`/authorize?${authorizeQuery(clientId, pkcePair(), 's', tenantA.endpoint)}`, { jar });
            const approved = await submitConsent(jar, { action: 'approve', transaction_id: transactionOf(await response.text()) });
            const upstream = new URL(approved.headers.get('location') ?? 'http://invalid/');
            assert(approved.status === HTTP_FOUND && upstream.origin === tenantA.endpoint && upstream.pathname === UPSTREAM_AUTHORIZE_PATH, `went to ${upstream}`);
            const q = upstream.searchParams;
            assert(q.get('client_id') === WORKER_UPSTREAM_CLIENT_ID, `client_id ${q.get('client_id')}`);
            assert(q.get('redirect_uri') === `${worker}${CALLBACK_PATH}`, `redirect_uri ${q.get('redirect_uri')}`);
            assert(q.get('code_challenge_method') === S256 && (q.get('code_challenge') ?? '').length >= 43, 'PKCE missing');
            assert([...jar.keys()].some((name) => name.startsWith('__Host-absmartly-oauth-cb-')), 'no callback binding cookie');
        });
        await check('test-1 accepts the upstream authorize request the Worker builds (login redirect, not an error)', async () => {
            const jar: Cookies = new Map();
            const response = await workerFetch(`/authorize?${authorizeQuery(clientId, pkcePair(), 's', testRoot)}`, { jar });
            const approved = await submitConsent(jar, { action: 'approve', transaction_id: transactionOf(await response.text()) });
            const upstream = approved.headers.get('location') ?? '';
            assert(approved.status === HTTP_FOUND && upstream.startsWith(`${testRoot}${UPSTREAM_AUTHORIZE_PATH}?`), `went to ${upstream}`);
            const backend = await fetch(upstream, { redirect: 'manual' });
            const body = await backend.text();
            assert(backend.status === HTTP_FOUND && LOGIN_REDIRECT.test(backend.headers.get('location') ?? ''),
                `test-1 answered ${backend.status}: ${snippet(body)}`);
        });

        section('Callback');
        await check('/oauth/callback refuses an unknown state', async () => {
            const response = await workerFetch(`${CALLBACK_PATH}?code=x&state=${randomUUID()}`);
            await response.body?.cancel();
            assert(response.status === HTTP_BAD_REQUEST, `status ${response.status}`);
        });
        await check('/oauth/callback refuses a login finished in a different browser', async () => {
            const jar: Cookies = new Map();
            const response = await workerFetch(`/authorize?${authorizeQuery(clientId, pkcePair(), 's', tenantA.endpoint)}`, { jar });
            const approved = await submitConsent(jar, { action: 'approve', transaction_id: transactionOf(await response.text()) });
            const toCallback = await fetch(approved.headers.get('location')!, { redirect: 'manual' });
            const otherBrowser = await workerFetch(toCallback.headers.get('location')!);
            const text = await otherBrowser.text();
            assert(otherBrowser.status === HTTP_BAD_REQUEST && /different browser/.test(text), `status ${otherBrowser.status}: ${snippet(text)}`);
        });

        section('Token endpoint and MCP sessions');
        const pkce = pkcePair();
        let accessToken = '';
        let refreshToken = '';
        let issuedCode = '';
        await check('the full flow returns a code with the state and issuer to the client', async () => {
            const tokenRequestsBefore = tenantA.log.token.length;
            const { code, state, redirect } = await authorizeToCode(clientId, pkce, tenantA.endpoint);
            assert(code, `no code: ${redirect}`);
            assert(redirect.searchParams.get('state') === state, 'state not echoed');
            assert(redirect.searchParams.get('iss'), 'iss parameter missing');
            assert(tenantA.log.token.length === tokenRequestsBefore + 1, 'the Worker did not exchange the upstream code');
            assert(tenantA.log.tokenErrors.length === 0, `upstream exchange rejected: ${tenantA.log.tokenErrors.join('; ')}`);
            issuedCode = code;
        });
        await check('a wrong code_verifier is refused', async () => {
            const other = pkcePair();
            const { code } = await authorizeToCode(clientId, other, tenantA.endpoint);
            const { status, body } = await exchange(clientId, code!, pkcePair().verifier);
            assert(status === HTTP_BAD_REQUEST && body?.error === 'invalid_grant', `status ${status}: ${JSON.stringify(body)}`);
        });
        await check('the code exchanges for bearer access and refresh tokens', async () => {
            assert(issuedCode, 'no code from the flow');
            const { status, body } = await exchange(clientId, issuedCode, pkce.verifier);
            assert(status === HTTP_OK, `status ${status}: ${JSON.stringify(body)}`);
            assert(String(body.token_type).toLowerCase() === 'bearer' && body.access_token && body.refresh_token, snippet(JSON.stringify(Object.keys(body))));
            assert(String(body.scope).split(' ').includes(SCOPE), `scope ${body.scope}`);
            accessToken = body.access_token;
            refreshToken = body.refresh_token;
        });
        for (const transport of ['sse', 'mcp'] as const) {
            await check(`the bearer token opens an MCP session over ${transport} that calls test-1 with the backend token`, async () => {
                assert(accessToken, 'no access token');
                const proxiedBefore = tenantA.log.proxied;
                const { text, teams } = await oauthIdentity(accessToken, transport);
                assert(text.startsWith('Authenticated with OAuth JWT'), snippet(text));
                assert(text.includes(`Endpoint: ${tenantA.endpoint}/v1`), `endpoint: ${snippet(text)}`);
                assert(text.includes(`Email: ${realEmail}`), 'not the test-1 user');
                assert(teams.length === 1 && teams[0].id, 'listTeams returned no team from test-1');
                assert(tenantA.log.proxied > proxiedBefore, 'no API call reached the backend');
                assert(tenantA.log.proxiedWithoutBackendToken === 0, 'an API call did not carry the backend token');
            });
        }

        await check('replaying a used code is refused and revokes the tokens it issued', async () => {
            // RFC 6749 4.1.2: a reused code must fail, and the server should
            // revoke the tokens already issued from it.
            const replayPkce = pkcePair();
            const { code } = await authorizeToCode(clientId, replayPkce, tenantA.endpoint);
            const first = await exchange(clientId, code!, replayPkce.verifier);
            assert(first.status === HTTP_OK, `first exchange ${first.status}`);
            assert(await bearerStatus(first.body.access_token) === HTTP_OK, 'token did not work before the replay');
            const { status, body } = await exchange(clientId, code!, replayPkce.verifier);
            assert(status === HTTP_BAD_REQUEST && body?.error === 'invalid_grant', `status ${status}: ${JSON.stringify(body)}`);
            assert(await bearerStatus(first.body.access_token) === HTTP_UNAUTHORIZED, 'access token still accepted after the replay');
        });

        section('Tenants');
        await check('a second endpoint gets its own consent and a session bound to that endpoint', async () => {
            const jar: Cookies = new Map();
            const tenantPkce = pkcePair();
            const first = await workerFetch(`/authorize?${authorizeQuery(clientId, tenantPkce, 's', tenantB.endpoint)}`, { jar });
            await first.body?.cancel();
            assert(first.status === HTTP_OK, `tenant B skipped consent (status ${first.status})`);
            const { code } = await authorizeToCode(clientId, tenantPkce, tenantB.endpoint, jar);
            const { body } = await exchange(clientId, code!, tenantPkce.verifier);
            const { text } = await oauthIdentity(body.access_token, 'sse');
            assert(text.includes(`Endpoint: ${tenantB.endpoint}/v1`), `endpoint: ${snippet(text)}`);
            assert(tenantB.log.proxiedWithoutBackendToken === 0, 'tenant B call without its backend token');
            const again = await workerFetch(`/authorize?${authorizeQuery(clientId, pkcePair(), 's', tenantB.endpoint)}`, { jar });
            await again.body?.cancel();
            assert(again.status === HTTP_FOUND && (again.headers.get('location') ?? '').startsWith(tenantB.endpoint),
                `remembered approval not used (status ${again.status})`);
            const otherTenant = await workerFetch(`/authorize?${authorizeQuery(clientId, pkcePair(), 's', tenantA.endpoint)}`, { jar });
            await otherTenant.body?.cancel();
            assert(otherTenant.status === HTTP_OK, `approval for tenant B was reused for tenant A (status ${otherTenant.status})`);
        });

        section('Refresh and revocation');
        await check('a refresh token yields a new working access token', async () => {
            assert(refreshToken, 'no refresh token');
            const { status, body } = await token({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId });
            assert(status === HTTP_OK && body.access_token, `status ${status}: ${JSON.stringify(body)}`);
            const { text } = await oauthIdentity(body.access_token, 'sse');
            assert(text.startsWith('Authenticated with OAuth JWT'), snippet(text));
            accessToken = body.access_token;
            refreshToken = body.refresh_token ?? refreshToken;
        });
        await check('refresh is refused once the backend session has ended', async () => {
            assert(refreshToken, 'no refresh token');
            tenantA.state.sessionEnded = true;
            try {
                const { status, body } = await token({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId });
                assert(status === HTTP_BAD_REQUEST && body?.error === 'invalid_grant', `status ${status}: ${JSON.stringify(body)}`);
            } finally {
                tenantA.state.sessionEnded = false;
            }
        });
        await check('a revoked access token no longer opens a session', async () => {
            assert(accessToken, 'no access token');
            assert(await bearerStatus(accessToken) === HTTP_OK, 'token did not work before revocation');
            const revoked = await workerFetch('/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ token: accessToken, token_type_hint: 'access_token', client_id: clientId }),
            });
            await revoked.body?.cancel();
            assert(revoked.status === HTTP_OK, `revocation answered ${revoked.status}`);
            assert(await bearerStatus(accessToken) === HTTP_UNAUTHORIZED, 'revoked token still accepted');
        });
    } finally {
        await tenantA.close();
        await tenantB.close();
    }

    return recorder.result();
}

export default async function runWrapped() {
    try {
        return await run();
    } catch (err: any) {
        const message = err?.message || String(err);
        if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
            return skipSuite(`MCP server not reachable at ${workerUrl()}`);
        }
        return { success: false, message, testCount: 1, details: [{ name: 'oauth-worker-flow suite', status: 'FAIL', error: message }] };
    }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    runWrapped().then((result) => process.exit(result.success ? 0 : 1));
}
