import assert from 'node:assert';
import http from 'node:http';
import { createStreamableHttpHandler } from '../../src/node-http-server.js';
import type { ServerContext } from '../../src/server-context.js';

function makeMockApiClient(counter: { calls: number } = { calls: 0 }) {
    const call = <T>(value: T) => async () => { counter.calls++; return value; };
    return {
        getCurrentUser: call({ id: 1 }),
        listCustomSectionFields: call([]),
        listUsers: call([]),
        listTeams: call([]),
        listApplications: call([{ id: 3, name: 'Web', environment: 'prod' }]),
        listUnitTypes: call([]),
        listExperimentTags: call([]),
        listMetrics: call([]),
        listGoals: call([]),
    } as any;
}

const ENTITY_FETCH_CALLS = 9;

async function postJson(baseUrl: string, payload: unknown): Promise<string> {
    const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
        body: JSON.stringify(payload),
    });
    assert.strictEqual(res.status, 200);
    return res.text();
}

async function withTestServer(fn: (baseUrl: string) => Promise<void>, counter?: { calls: number }) {
    const mcpHandler = createStreamableHttpHandler(async () => ({
        apiClient: makeMockApiClient(counter),
        endpoint: 'https://demo.absmartly.com',
        authType: 'API Key',
    }));

    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            const parsed = body ? JSON.parse(body) : undefined;
            if (req.method === 'POST') {
                mcpHandler.post(req, res, parsed).catch(err => {
                    res.writeHead(500).end(JSON.stringify({ error: String(err) }));
                });
            } else {
                res.writeHead(405).end();
            }
        });
    });

    await new Promise<void>(resolve => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    try {
        await fn(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
}

export default async function run() {
    let passed = 0;
    let failed = 0;
    const details: Array<{ name: string; status: string; error?: string }> = [];

    async function test(name: string, fn: () => Promise<void>) {
        try { await fn(); passed++; details.push({ name, status: 'PASS' }); }
        catch (e: any) { failed++; details.push({ name, status: 'FAIL', error: e.message }); }
    }

    await test('POST initialize returns a valid MCP initialize response', async () => {
        await withTestServer(async (baseUrl) => {
            const res = await fetch(`${baseUrl}/mcp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: {
                        protocolVersion: '2025-06-18',
                        capabilities: {},
                        clientInfo: { name: 'test-client', version: '0.0.0' },
                    },
                }),
            });
            assert.strictEqual(res.status, 200);
            const text = await res.text();
            assert.ok(text.includes('"protocolVersion"') || text.includes('serverInfo'), `expected an initialize result, got: ${text}`);
        });
    });

    // Verified against the real SDK behavior (not assumption): in stateless
    // mode (sessionIdGenerator: undefined), StreamableHTTPServerTransport's
    // validateSession() short-circuits and skips the "not initialized" check
    // entirely — every request, including tools/list, is accepted without a
    // prior initialize handshake. Each POST here also creates a brand-new
    // McpServer+transport (see node-http-server.ts), so there is no session
    // state to persist between calls anyway; that's consistent with this
    // being a legitimate standalone request rather than a coincidence of
    // shared state.
    await test('POST tools/list (no prior initialize) includes execute_command', async () => {
        await withTestServer(async (baseUrl) => {
            const res = await fetch(`${baseUrl}/mcp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
            });
            assert.strictEqual(res.status, 200);
            const text = await res.text();
            assert.ok(text.includes('execute_command'), `expected execute_command tool, got: ${text}`);
        });
    });

    await test('routine messages (initialize, tools/list, resources/list) make no entity fetches', async () => {
        const counter = { calls: 0 };
        await withTestServer(async (baseUrl) => {
            await postJson(baseUrl, {
                jsonrpc: '2.0', id: 1, method: 'initialize',
                params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-client', version: '0.0.0' } },
            });
            await postJson(baseUrl, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
            await postJson(baseUrl, { jsonrpc: '2.0', id: 3, method: 'resources/list', params: {} });
        }, counter);
        assert.strictEqual(counter.calls, 0);
    });

    await test('reading an entity resource fetches entities once for that request', async () => {
        const counter = { calls: 0 };
        await withTestServer(async (baseUrl) => {
            const text = await postJson(baseUrl, {
                jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'absmartly://entities/applications' },
            });
            assert.ok(text.includes('Web'), `expected applications payload, got: ${text}`);
        }, counter);
        assert.strictEqual(counter.calls, ENTITY_FETCH_CALLS);
    });

    await test('absmartly://docs/templates is readable without a host-supplied docsDir', async () => {
        await withTestServer(async (baseUrl) => {
            const text = await postJson(baseUrl, {
                jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: 'absmartly://docs/templates' },
            });
            assert.ok(!text.includes('"error"'), `expected templates content, got: ${text}`);
            assert.ok(!text.includes('Could not load'), `templates.md not found at default docs dir: ${text}`);
        });
    });

    await test('POST with a buildContext that throws returns a 500 with a JSON-RPC error envelope', async () => {
        const mcpHandler = createStreamableHttpHandler(async () => {
            throw new Error('auth failed');
        });

        const server = http.createServer((req, res) => {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                const parsed = body ? JSON.parse(body) : undefined;
                mcpHandler.post(req, res, parsed).catch(err => {
                    res.writeHead(500).end(JSON.stringify({ error: String(err) }));
                });
            });
        });

        await new Promise<void>(resolve => server.listen(0, resolve));
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        try {
            const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }),
            });
            assert.strictEqual(res.status, 500);
            const json = await res.json();
            assert.strictEqual(json.jsonrpc, '2.0');
            assert.strictEqual(json.error.code, -32603);
            assert.strictEqual(json.id, null);
        } finally {
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });

    await test('get_command_docs for an entity-independent command makes no entity fetches', async () => {
        const counter = { calls: 0 };
        await withTestServer(async (baseUrl) => {
            const text = await postJson(baseUrl, {
                jsonrpc: '2.0', id: 6, method: 'tools/call',
                params: { name: 'get_command_docs', arguments: { group: 'experiments', command: 'listExperiments' } },
            });
            assert.ok(text.includes('experiments.listExperiments'), `expected docs for listExperiments, got: ${text}`);
        }, counter);
        assert.strictEqual(counter.calls, 0);
    });

    await test('execute_command with invalid params for a non-entity-dependent command makes no entity fetches', async () => {
        const counter = { calls: 0 };
        await withTestServer(async (baseUrl) => {
            const text = await postJson(baseUrl, {
                jsonrpc: '2.0', id: 7, method: 'tools/call',
                // getExperiment requires experimentId; omitting it triggers the
                // param-validation-failure path, which also builds command docs.
                params: { name: 'execute_command', arguments: { group: 'experiments', command: 'getExperiment', params: {} } },
            });
            assert.ok(text.includes('Param validation failed'), `expected a validation error, got: ${text}`);
        }, counter);
        assert.strictEqual(counter.calls, 0);
    });

    await test('get_command_docs for createExperiment still fetches entities and includes custom fields', async () => {
        const counter = { calls: 0 };
        const mcpHandler = createStreamableHttpHandler(async () => ({
            apiClient: {
                getCurrentUser: async () => { counter.calls++; return { id: 1 }; },
                listCustomSectionFields: async () => { counter.calls++; return [{ name: 'priority', type: 'string', default_value: 'low', custom_section: { type: 'experiment' } }]; },
                listUsers: async () => { counter.calls++; return []; },
                listTeams: async () => { counter.calls++; return []; },
                listApplications: async () => { counter.calls++; return []; },
                listUnitTypes: async () => { counter.calls++; return []; },
                listExperimentTags: async () => { counter.calls++; return []; },
                listMetrics: async () => { counter.calls++; return []; },
                listGoals: async () => { counter.calls++; return []; },
            } as any,
            endpoint: 'https://demo.absmartly.com',
            authType: 'API Key',
        }));

        const server = http.createServer((req, res) => {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                const parsed = body ? JSON.parse(body) : undefined;
                mcpHandler.post(req, res, parsed).catch(err => {
                    res.writeHead(500).end(JSON.stringify({ error: String(err) }));
                });
            });
        });

        await new Promise<void>(resolve => server.listen(0, resolve));
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        try {
            const text = await postJson(`http://127.0.0.1:${port}`, {
                jsonrpc: '2.0', id: 8, method: 'tools/call',
                params: { name: 'get_command_docs', arguments: { group: 'experiments', command: 'createExperiment' } },
            });
            assert.ok(text.includes('Available Custom Fields'), `expected custom fields section, got: ${text}`);
            assert.ok(text.includes('priority'), `expected the priority custom field, got: ${text}`);
        } finally {
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
        assert.strictEqual(counter.calls, ENTITY_FETCH_CALLS);
    });

    return { success: failed === 0, message: `${passed} passed, ${failed} failed`, testCount: passed + failed, details };
}
