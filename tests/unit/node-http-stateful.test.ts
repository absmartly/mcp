import assert from 'node:assert';
import http from 'node:http';
import { createStreamableHttpHandler, type NodeMcpHandler, type NodeMcpHandlerOptions } from '../../src/node-http-server.js';

const ACCEPT = 'application/json, text/event-stream';
const INIT = {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
};

function parseMessage(text: string): any {
    const line = text.split('\n').find(l => l.startsWith('data:'));
    return JSON.parse(line ? line.slice(5) : text);
}

async function withServer(
    options: NodeMcpHandlerOptions | undefined,
    fn: (ctx: { url: string; handler: NodeMcpHandler; init: (principal: string) => Promise<{ sessionId: string; message: any }>; post: (principal: string, sessionId: string | undefined, body: unknown) => Promise<Response> }) => Promise<void>,
    apiClient: () => any = () => ({}),
) {
    const handler = createStreamableHttpHandler(async (req) => ({
        apiClient: apiClient(),
        endpoint: 'https://demo.absmartly.com',
        authType: 'API Key',
        principal: req.headers['x-principal'] as string | undefined,
    }), options);
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
            const parsed = body ? JSON.parse(body) : undefined;
            const run = req.method === 'POST' ? handler.post(req, res, parsed)
                : req.method === 'GET' ? handler.get(req, res)
                : req.method === 'DELETE' ? handler.delete(req, res)
                : Promise.resolve(void res.writeHead(405).end());
            run.catch(err => res.writeHead(500).end(String(err)));
        });
    });
    await new Promise<void>(r => server.listen(0, r));
    const url = `http://127.0.0.1:${(server.address() as any).port}/mcp`;
    const post = (principal: string, sessionId: string | undefined, body: unknown) => fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: ACCEPT, 'x-principal': principal,
            ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-06-18' } : {}),
        },
        body: JSON.stringify(body),
    });
    const init = async (principal: string) => {
        const res = await post(principal, undefined, INIT);
        assert.strictEqual(res.status, 200, await res.clone().text());
        const sessionId = res.headers.get('mcp-session-id')!;
        const message = parseMessage(await res.text());
        await post(principal, sessionId, { jsonrpc: '2.0', method: 'notifications/initialized' }).then(r => r.text());
        return { sessionId, message };
    };
    try {
        await fn({ url, handler, init, post });
    } finally {
        await handler.close();
        server.closeAllConnections();
        await new Promise<void>(r => server.close(() => r()));
    }
}

/** Opens the GET stream and collects parsed SSE messages until closed. */
async function openStream(url: string, principal: string, sessionId: string) {
    const ac = new AbortController();
    const res = await fetch(url, {
        headers: { Accept: 'text/event-stream', 'x-principal': principal, 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-06-18' },
        signal: ac.signal,
    });
    const messages: any[] = [];
    const reader = res.body?.getReader();
    let buf = '';
    const pump = (async () => {
        if (!reader) return;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += new TextDecoder().decode(value);
                let i;
                while ((i = buf.indexOf('\n\n')) >= 0) {
                    const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
                    const line = chunk.split('\n').find(l => l.startsWith('data:'));
                    if (line) messages.push(JSON.parse(line.slice(5)));
                }
            }
        } catch { /* aborted */ }
    })();
    const waitFor = async (pred: (m: any) => boolean) => {
        for (let i = 0; i < 100; i++) {
            const m = messages.find(pred);
            if (m) return m;
            await new Promise(r => setTimeout(r, 20));
        }
        throw new Error(`timed out waiting for message; got ${JSON.stringify(messages)}`);
    };
    return { status: res.status, messages, waitFor, close: () => { ac.abort(); return pump; } };
}

export default async function run() {
    let passed = 0;
    let failed = 0;
    const details: Array<{ name: string; status: string; error?: string }> = [];
    async function test(name: string, fn: () => Promise<void>) {
        try { await fn(); passed++; details.push({ name, status: 'PASS' }); }
        catch (e: any) { failed++; details.push({ name, status: 'FAIL', error: e.message }); }
    }

    await test('stateless default: no session id, GET/DELETE 405, capabilities not advertised', async () => {
        await withServer(undefined, async ({ url, post }) => {
            const res = await post('alice', undefined, INIT);
            assert.strictEqual(res.headers.get('mcp-session-id'), null);
            const caps = parseMessage(await res.text()).result.capabilities;
            assert.ok(!caps.resources.subscribe && !caps.resources.listChanged && !caps.tools.listChanged && !caps.prompts.listChanged, JSON.stringify(caps));
            assert.deepStrictEqual(caps.completions, {}, 'completions (create-experiment.type) must stay advertised');
            for (const method of ['GET', 'DELETE']) {
                const r = await fetch(url, { method, headers: { Accept: 'text/event-stream', 'x-principal': 'alice' } });
                assert.strictEqual(r.status, 405);
                await r.text();
            }
        });
    });

    await test('stateless default: notify* is a no-op returning 0', async () => {
        await withServer(undefined, async ({ handler }) => {
            assert.strictEqual(await handler.notifyResourceUpdated('absmartly://entities/goals'), 0);
            assert.strictEqual(await handler.notifyListChanged('tools'), 0);
        });
    });

    await test('stateful: initialize issues session id and advertises subscribe/listChanged', async () => {
        await withServer({ stateful: true }, async ({ init }) => {
            const { sessionId, message } = await init('alice');
            assert.ok(sessionId);
            const caps = message.result.capabilities;
            assert.strictEqual(caps.resources.subscribe, true);
            assert.strictEqual(caps.resources.listChanged, true);
            assert.strictEqual(caps.tools.listChanged, true);
            assert.strictEqual(caps.prompts.listChanged, true);
            assert.deepStrictEqual(caps.completions, {});
        });
    });

    await test('stateful: session lifecycle (POST routes by id, DELETE ends it, later POST 404)', async () => {
        await withServer({ stateful: true }, async ({ url, init, post }) => {
            const { sessionId } = await init('alice');
            const list = await post('alice', sessionId, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
            assert.ok(parseMessage(await list.text()).result.tools.length > 0);

            const del = await fetch(url, { method: 'DELETE', headers: { 'x-principal': 'alice', 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-06-18' } });
            assert.strictEqual(del.status, 200);
            await del.text();

            const after = await post('alice', sessionId, { jsonrpc: '2.0', id: 3, method: 'tools/list' });
            assert.strictEqual(after.status, 404);
            await after.text();
        });
    });

    await test('stateful: non-initialize POST without a session is rejected', async () => {
        await withServer({ stateful: true }, async ({ post }) => {
            const res = await post('alice', undefined, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
            assert.strictEqual(res.status, 400);
            await res.text();
        });
    });

    await test('stateful: missing principal is rejected with 401', async () => {
        await withServer({ stateful: true }, async ({ url }) => {
            const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: ACCEPT }, body: JSON.stringify(INIT) });
            assert.strictEqual(res.status, 401);
            await res.text();
        });
    });

    await test('stateful: subscribed session receives resources/updated over the GET stream; unsubscribe stops it', async () => {
        await withServer({ stateful: true }, async ({ url, handler, init, post }) => {
            const { sessionId } = await init('alice');
            const stream = await openStream(url, 'alice', sessionId);
            assert.strictEqual(stream.status, 200);
            const uri = 'absmartly://entities/goals';

            assert.strictEqual(await handler.notifyResourceUpdated(uri), 0, 'not subscribed yet');
            const sub = await post('alice', sessionId, { jsonrpc: '2.0', id: 5, method: 'resources/subscribe', params: { uri } });
            assert.ok('result' in parseMessage(await sub.text()));

            assert.strictEqual(await handler.notifyResourceUpdated(uri), 1);
            const msg = await stream.waitFor(m => m.method === 'notifications/resources/updated');
            assert.strictEqual(msg.params.uri, uri);

            const unsub = await post('alice', sessionId, { jsonrpc: '2.0', id: 6, method: 'resources/unsubscribe', params: { uri } });
            assert.ok('result' in parseMessage(await unsub.text()));
            assert.strictEqual(await handler.notifyResourceUpdated(uri), 0);
            await stream.close();
        });
    });

    await test('stateful: list_changed notifications are delivered, optionally scoped to a principal', async () => {
        await withServer({ stateful: true }, async ({ url, handler, init }) => {
            const alice = await init('alice');
            const bob = await init('bob');
            const aStream = await openStream(url, 'alice', alice.sessionId);
            const bStream = await openStream(url, 'bob', bob.sessionId);

            assert.strictEqual(await handler.notifyListChanged('tools', { principal: 'alice' }), 1);
            await aStream.waitFor(m => m.method === 'notifications/tools/list_changed');
            assert.strictEqual(await handler.notifyListChanged('resources'), 2);
            await aStream.waitFor(m => m.method === 'notifications/resources/list_changed');
            await bStream.waitFor(m => m.method === 'notifications/resources/list_changed');
            assert.ok(!bStream.messages.some(m => m.method === 'notifications/tools/list_changed'));
            await aStream.close(); await bStream.close();
        });
    });

    await test('stateful: a session is bound to its principal (POST/GET/DELETE by another principal get 404)', async () => {
        await withServer({ stateful: true }, async ({ url, handler, init, post }) => {
            const { sessionId } = await init('alice');
            const foreign = await post('mallory', sessionId, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
            assert.strictEqual(foreign.status, 404);
            await foreign.text();
            for (const [method, accept] of [['GET', 'text/event-stream'], ['DELETE', ACCEPT]] as const) {
                const r = await fetch(url, { method, headers: { Accept: accept, 'x-principal': 'mallory', 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-06-18' } });
                assert.strictEqual(r.status, 404, method);
                await r.text();
            }
            const ok = await post('alice', sessionId, { jsonrpc: '2.0', id: 3, method: 'tools/list' });
            assert.strictEqual(ok.status, 200);
            await ok.text();
            assert.ok(handler);
        });
    });

    await test('stateful: maxSessions and maxSessionsPerPrincipal reject new sessions', async () => {
        await withServer({ stateful: { maxSessions: 2, maxSessionsPerPrincipal: 1 } }, async ({ init, post }) => {
            await init('alice');
            const second = await post('alice', undefined, INIT);
            assert.strictEqual(second.status, 429);
            await second.text();
            await init('bob');
            const third = await post('carol', undefined, INIT);
            assert.strictEqual(third.status, 503);
            await third.text();
        });
    });

    await test('stateful: idle sessions are evicted after the TTL, and sessions with an open stream are kept', async () => {
        let clock = 1_000_000;
        await withServer({ stateful: { idleTtlMs: 1000, now: () => clock } }, async ({ url, handler, init, post }) => {
            const idle = await init('alice');
            const streaming = await init('bob');
            const stream = await openStream(url, 'bob', streaming.sessionId);

            clock += 1500;
            assert.strictEqual(await handler.sweepExpired(), 1);
            const gone = await post('alice', idle.sessionId, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
            assert.strictEqual(gone.status, 404);
            await gone.text();
            const kept = await post('bob', streaming.sessionId, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
            assert.strictEqual(kept.status, 200);
            await kept.text();
            await stream.close();
        });
    });

    await test('stateful: a request after the idle TTL but before the sweep does not revive the session', async () => {
        let clock = 1_000_000;
        await withServer({ stateful: { idleTtlMs: 1000, now: () => clock } }, async ({ init, post }) => {
            const { sessionId } = await init('alice');
            clock += 1500;
            const late = await post('alice', sessionId, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
            assert.strictEqual(late.status, 404);
            await late.text();
        });
    });

    await test('stateful: sessions past maxSessionAgeMs are evicted even with an open stream', async () => {
        let clock = 1_000_000;
        await withServer({ stateful: { maxSessionAgeMs: 5000, now: () => clock } }, async ({ url, handler, init }) => {
            const s = await init('alice');
            const stream = await openStream(url, 'alice', s.sessionId);
            clock += 6000;
            assert.strictEqual(await handler.sweepExpired(), 1);
            await stream.close();
        });
    });

    await test('stateful: per-session subscription cap is enforced', async () => {
        await withServer({ stateful: { maxSubscriptionsPerSession: 1 } }, async ({ init, post }) => {
            const { sessionId } = await init('alice');
            const a = await post('alice', sessionId, { jsonrpc: '2.0', id: 2, method: 'resources/subscribe', params: { uri: 'absmartly://a' } });
            assert.ok('result' in parseMessage(await a.text()));
            const b = await post('alice', sessionId, { jsonrpc: '2.0', id: 3, method: 'resources/subscribe', params: { uri: 'absmartly://b' } });
            assert.strictEqual(parseMessage(await b.text()).error.code, -32600);
        });
    });

    await test('stateful: entity resources are refetched on a later request, so a reread after notifyResourceUpdated is fresh', async () => {
        let goalName = 'before';
        let goalFetches = 0;
        const apiClient = () => ({
            getCurrentUser: async () => ({ id: 1 }),
            listGoals: async () => { goalFetches++; return [{ id: 1, name: goalName }]; },
        });
        await withServer({ stateful: true }, async ({ handler, init, post }) => {
            const { sessionId } = await init('alice');
            const uri = 'absmartly://entities/goals';
            const read = async (id: number) => {
                const r = await post('alice', sessionId, { jsonrpc: '2.0', id, method: 'resources/read', params: { uri } });
                return JSON.parse(parseMessage(await r.text()).result.contents[0].text)[0].name;
            };
            assert.strictEqual(await read(2), 'before');
            goalName = 'after';
            await handler.notifyResourceUpdated(uri);
            assert.strictEqual(await read(3), 'after');
            assert.strictEqual(goalFetches, 2);
        }, apiClient);
    });

    await test('stateful: GET/DELETE without a principal get 401, not 404/400', async () => {
        await withServer({ stateful: true }, async ({ url, init }) => {
            const { sessionId } = await init('alice');
            for (const [method, accept] of [['GET', 'text/event-stream'], ['DELETE', ACCEPT]] as const) {
                for (const headers of [{ 'mcp-session-id': sessionId }, {}]) {
                    const r = await fetch(url, { method, headers: { Accept: accept, 'mcp-protocol-version': '2025-06-18', ...headers } });
                    assert.strictEqual(r.status, 401, `${method} ${JSON.stringify(headers)}`);
                    await r.text();
                }
            }
        });
    });

    await test('stateful: a DELETE the SDK rejects (bad protocol version) keeps the session', async () => {
        await withServer({ stateful: true }, async ({ url, init, post }) => {
            const { sessionId } = await init('alice');
            const del = await fetch(url, { method: 'DELETE', headers: { 'x-principal': 'alice', 'mcp-session-id': sessionId, 'mcp-protocol-version': '1999-01-01' } });
            assert.strictEqual(del.status, 400);
            await del.text();
            const ok = await post('alice', sessionId, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
            assert.strictEqual(ok.status, 200);
            await ok.text();
        });
    });

    return { success: failed === 0, message: `${passed} passed, ${failed} failed`, testCount: passed + failed, details };
}
