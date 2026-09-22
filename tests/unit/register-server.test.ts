import assert from 'node:assert';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerServer } from '../../src/register-server.js';
import type { ServerContext } from '../../src/server-context.js';

function makeContext(overrides: Partial<ServerContext> = {}): ServerContext {
    return {
        apiClient: {} as any,
        endpoint: 'https://demo.absmartly.com',
        authType: 'API Key',
        currentUserId: 1,
        entityWarnings: [],
        customFields: [],
        users: [],
        teams: [],
        applications: [{ id: 1, name: 'Web', description: 'Environment: prod' }],
        unitTypes: [],
        experimentTags: [],
        metrics: [],
        goals: [],
        ...overrides,
    };
}

export default async function run() {
    let passed = 0;
    let failed = 0;
    const details: Array<{ name: string; status: string; error?: string }> = [];

    function test(name: string, fn: () => void) {
        try { fn(); passed++; details.push({ name, status: 'PASS' }); }
        catch (e: any) { failed++; details.push({ name, status: 'FAIL', error: e.message }); }
    }

    async function asyncTest(name: string, fn: () => Promise<void>) {
        try { await fn(); passed++; details.push({ name, status: 'PASS' }); }
        catch (e: any) { failed++; details.push({ name, status: 'FAIL', error: e.message }); }
    }

    test('registers without throwing given a minimal context', () => {
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {}, resources: {}, prompts: {} } });
        registerServer(server, makeContext());
    });

    // This repo's existing unit tests (tests/unit/tool-integration.test.ts,
    // tests/unit/resources-entity.test.ts) assert against lightweight hand-rolled
    // mock servers that just record registration calls — they don't drive a real
    // McpServer end-to-end. To actually verify registerServer wires up a *working*
    // McpServer (not just that it calls .resource() the right number of times),
    // this test uses the MCP SDK's own idiomatic pattern instead: a real McpServer
    // connected to a real Client via InMemoryTransport.createLinkedPair(), then
    // asserts on the Client's resources/list and resources/read responses. This
    // was verified to work against the installed SDK version before adoption.
    await asyncTest('registers entity resources including applications, readable via a live client', async () => {
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {}, resources: {}, prompts: {} } });
        registerServer(server, makeContext());

        const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: 'test-client', version: '0.0.0' });

        await Promise.all([
            server.connect(serverTransport),
            client.connect(clientTransport),
        ]);

        try {
            const resources = await client.listResources();
            const uris = resources.resources.map(r => r.uri);
            assert.ok(uris.includes('absmartly://entities/applications'), `expected absmartly://entities/applications in ${JSON.stringify(uris)}`);

            const read = await client.readResource({ uri: 'absmartly://entities/applications' });
            const text = (read.contents[0] as any).text;
            const parsed = JSON.parse(text);
            assert.deepStrictEqual(parsed, [{ id: 1, name: 'Web', description: 'Environment: prod' }]);
        } finally {
            await client.close();
            await server.close();
        }
    });

    await asyncTest('registers the 5 prompts', async () => {
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {}, resources: {}, prompts: {} } });
        registerServer(server, makeContext());

        const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: 'test-client', version: '0.0.0' });

        await Promise.all([
            server.connect(serverTransport),
            client.connect(clientTransport),
        ]);

        try {
            const prompts = await client.listPrompts();
            const names = prompts.prompts.map(p => p.name);
            for (const expected of ['experiment-status', 'create-experiment', 'create-feature-flag', 'analyze-experiment', 'experiment-review']) {
                assert.ok(names.includes(expected), `expected prompt ${expected} in ${JSON.stringify(names)}`);
            }
        } finally {
            await client.close();
            await server.close();
        }
    });

    return { success: failed === 0, message: `${passed} passed, ${failed} failed`, testCount: passed + failed, details };
}
