import assert from 'node:assert';
import http from 'node:http';
import { createStreamableHttpHandler } from '../../src/node-http-server.js';
import type { ServerContext } from '../../src/server-context.js';

function makeMockApiClient() {
    return {
        getCurrentUser: async () => ({ id: 1 }),
        listCustomSectionFields: async () => [],
        listUsers: async () => [],
        listTeams: async () => [],
        listApplications: async () => [],
        listUnitTypes: async () => [],
        listExperimentTags: async () => [],
        listMetrics: async () => [],
        listGoals: async () => [],
    } as any;
}

async function withTestServer(fn: (baseUrl: string) => Promise<void>) {
    const mcpHandler = createStreamableHttpHandler(async () => ({
        apiClient: makeMockApiClient(),
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

    return { success: failed === 0, message: `${passed} passed, ${failed} failed`, testCount: passed + failed, details };
}
