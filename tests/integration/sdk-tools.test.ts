#!/usr/bin/env node
/**
 * Deterministic MCP coverage through the official SDK client: no model in
 * the loop. Replaces the read-only and error-path scenarios of the
 * claude-mcp-tools, claude-tool-discovery and claude-user-experience suites,
 * the tenant/endpoint scenarios of multi-tenant-oauth, and the resource and
 * prompt scenarios of resources-prompts-flow.
 *
 * Every call goes to the Worker the runner started (MCP_WORKER_URL) and on
 * to the test-1 backend. Nothing here writes: lifecycle writes live in
 * lifecycle-sdk.test.ts and sdk-lifecycle-extra.test.ts.
 *
 * What a deterministic suite cannot cover is whether a model picks the
 * right tool for a natural-language request. Those checks are listed as not
 * covered in the PR that removed the claude-* suites.
 */

import { pathToFileURL } from 'url';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { resolveTestCredentials, SKIP_MESSAGE } from './test-credentials.js';
import { skipSuite, workerUrl } from './gate.js';
import {
    ENDPOINT_HEADER,
    assert,
    callTool,
    connectApiKeyClient,
    connectClient,
    createRecorder,
    execute,
    jsonOf,
    snippet,
    transportUrl,
} from './mcp-sdk-client.js';

const EXPECTED_TOOLS = ['discover_commands', 'execute_command', 'get_auth_status', 'get_command_docs'];
const EXPECTED_DOC_RESOURCES = [
    'absmartly://docs/api',
    'absmartly://docs/experiments',
    'absmartly://docs/goals',
    'absmartly://docs/metrics',
    'absmartly://docs/applications',
    'absmartly://docs/users-teams',
    'absmartly://docs/analytics',
    'absmartly://docs/segments',
    'absmartly://examples/api-requests',
    'absmartly://docs/templates',
];
const EXPECTED_PROMPTS = ['experiment-status', 'create-experiment', 'create-feature-flag', 'analyze-experiment', 'experiment-review'];
const LIST_ITEMS = 2;
// Read-only listings: [group, command, params, fields every row must carry].
const LISTINGS: Array<[string, string, Record<string, unknown>, string[]]> = [
    ['experiments', 'listExperiments', { items: LIST_ITEMS }, ['id', 'name', 'state']],
    ['users', 'listUsers', { items: LIST_ITEMS }, ['id', 'email']],
    ['apps', 'listApps', {}, ['id', 'name']],
    ['units', 'listUnits', {}, ['id', 'name']],
    ['metrics', 'listMetrics', { items: LIST_ITEMS }, ['id', 'name', 'type']],
    ['goals', 'listGoals', { items: LIST_ITEMS }, ['id', 'name']],
    ['tags', 'listTags', {}, ['id', 'tag']],
    ['teams', 'listTeams', { items: LIST_ITEMS }, ['id', 'name']],
    ['segments', 'listSegments', {}, ['id', 'name']],
];
const MISSING_EXPERIMENT_ID = 999_999_999;
const UNKNOWN_GROUP = 'nonexistent_xyz';
const UNKNOWN_COMMAND = 'totallyFakeMethod';
const BOGUS_BEARER = 'Bearer invalid.token.here';
const BOGUS_API_KEY = 'not-a-real-api-key-0000';
const HTTP_UNAUTHORIZED = 401;
const API_PATH_SUFFIX = /\/v1\/?$/;
const TENANT_HOST_SUFFIX = '.absmartly.com';

function rowsOf(data: any): any[] {
    return Array.isArray(data) ? data : [];
}

async function readJsonResource(client: Client, uri: string): Promise<any> {
    const result = await client.readResource({ uri });
    const text = (result.contents?.[0] as { text?: string } | undefined)?.text ?? '';
    const value = jsonOf(text);
    assert(value !== undefined, `${uri} did not return JSON: ${snippet(text)}`);
    return value;
}

async function readTextResource(client: Client, uri: string): Promise<{ text: string; mimeType?: string }> {
    const result = await client.readResource({ uri });
    const content = result.contents?.[0] as { text?: string; mimeType?: string } | undefined;
    return { text: content?.text ?? '', mimeType: content?.mimeType };
}

async function authStatus(client: Client): Promise<string> {
    const { result, text } = await callTool(client, 'get_auth_status');
    assert(!result.isError, `get_auth_status returned an error: ${snippet(text)}`);
    return text;
}

async function unauthorizedStatus(headers: Record<string, string>): Promise<{ status: number; wwwAuthenticate: string | null }> {
    const response = await fetch(transportUrl('sse'), { headers });
    await response.body?.cancel();
    return { status: response.status, wwwAuthenticate: response.headers.get('www-authenticate') };
}

async function run() {
    const credentials = await resolveTestCredentials();
    if (!credentials) return skipSuite(SKIP_MESSAGE);
    const { apiKey, endpoint } = credentials;
    const rootEndpoint = endpoint.replace(API_PATH_SUFFIX, '');
    const endpointHost = new URL(endpoint).host;

    const recorder = createRecorder('Deterministic MCP SDK: tools, resources, prompts');
    const { check, section } = recorder;
    const client = await connectApiKeyClient('sdk-tools-test', credentials);

    try {
        section('Discovery');
        const tools = await client.listTools();
        await check('tools/list returns exactly the four meta-tools', async () => {
            const names = tools.tools.map((tool) => tool.name).sort();
            assert(names.join(',') === EXPECTED_TOOLS.join(','), `got ${names.join(', ')}`);
        });
        await check('execute_command schema exposes group, command and params', async () => {
            const exec = tools.tools.find((tool) => tool.name === 'execute_command');
            const props = Object.keys(exec?.inputSchema?.properties ?? {});
            assert(['group', 'command', 'params'].every((p) => props.includes(p)), `got ${props.join(', ')}`);
        });
        await check('discover_commands with no params summarises every group', async () => {
            const { text } = await callTool(client, 'discover_commands');
            assert(/\d+ commands in \d+ groups/.test(text), `no group summary: ${snippet(text)}`);
            for (const group of ['experiments', 'metrics', 'goals', 'teams']) {
                assert(text.includes(`**${group}**`), `group ${group} missing from summary`);
            }
        });
        await check('discover_commands browses the experiments group', async () => {
            const { text } = await callTool(client, 'discover_commands', { group: 'experiments' });
            for (const command of ['listExperiments', 'getExperiment', 'createExperimentFromTemplate', 'archiveExperiment']) {
                assert(text.includes(`experiments.${command}`), `experiments.${command} missing`);
            }
        });
        await check('discover_commands search "metric" returns only metric-related commands', async () => {
            const { text } = await callTool(client, 'discover_commands', { search: 'metric' });
            const headings = text.match(/^### \S+/gm) ?? [];
            assert(headings.length > 0, `no commands found: ${snippet(text)}`);
            assert(headings.some((h) => h === '### metrics.listMetrics'), 'metrics.listMetrics missing from search');
            const sections = text.split(/^### /m).slice(1);
            const unrelated = sections.filter((s) => !/metric/i.test(s)).map((s) => s.split('\n')[0]);
            assert(unrelated.length === 0, `unrelated results: ${unrelated.join(', ')}`);
        });
        await check('discover_commands reports an unknown group', async () => {
            const { text } = await callTool(client, 'discover_commands', { group: UNKNOWN_GROUP });
            assert(text.includes(`No commands found in group "${UNKNOWN_GROUP}"`), snippet(text));
        });

        section('Command docs');
        await check('get_command_docs listExperiments has a parameter table', async () => {
            const { text } = await callTool(client, 'get_command_docs', { group: 'experiments', command: 'listExperiments' });
            assert(text.startsWith('# experiments.listExperiments'), snippet(text));
            assert(/\| Name \| Type \| Required \| Description \|/.test(text), 'parameter table missing');
            assert(/\| items \| number \|/.test(text), 'items param missing');
        });
        await check('get_command_docs archiveExperiment carries the destructive warning', async () => {
            const { text } = await callTool(client, 'get_command_docs', { group: 'experiments', command: 'archiveExperiment' });
            assert(text.includes('**WARNING: This is a destructive/dangerous operation.**'), snippet(text));
            assert(/\| experimentId \| number \| Yes \|/.test(text), 'experimentId not documented as required');
        });
        await check('get_command_docs createMetric shows execute_command usage', async () => {
            const { text } = await callTool(client, 'get_command_docs', { group: 'metrics', command: 'createMetric' });
            assert(text.includes('## Usage with execute_command'), snippet(text));
            assert(text.includes('"command": "createMetric"'), 'usage example missing the command');
        });
        await check('get_command_docs reports an unknown command and points to discover_commands', async () => {
            const { text } = await callTool(client, 'get_command_docs', { group: 'experiments', command: 'xyzNotARealMethod123' });
            assert(text.includes('Command "experiments.xyzNotARealMethod123" not found'), snippet(text));
            assert(text.includes('discover_commands'), 'no pointer to discover_commands');
        });

        section('Identity');
        await check('get_auth_status reports the API-key user and the test-1 endpoint', async () => {
            const text = await authStatus(client);
            assert(text.startsWith('Authenticated with API Key'), snippet(text));
            assert(text.includes(`Endpoint: ${endpoint}`), 'endpoint missing');
            assert(/Email: \S+@\S+/.test(text), 'email missing');
        });

        section('Listings');
        for (const [group, command, params, fields] of LISTINGS) {
            await check(`${group}.${command} returns rows with ${fields.join(', ')}`, async () => {
                const { data, text } = await execute(client, group, command, params);
                const rows = rowsOf(data);
                assert(rows.length > 0, `no rows: ${snippet(text)}`);
                if (params.items) assert(rows.length <= (params.items as number), `asked for ${params.items}, got ${rows.length}`);
                const missing = fields.filter((field) => rows.some((row) => row?.[field] === undefined));
                assert(missing.length === 0, `rows missing ${missing.join(', ')}`);
            });
        }

        section('Entity reads and search');
        let experiment: { id: number; name: string } | undefined;
        await check('experiments.getExperiment returns the listed experiment', async () => {
            const { data: list } = await execute(client, 'experiments', 'listExperiments', { items: 1 });
            const first = rowsOf(list)[0];
            assert(first?.id, 'no experiment to read');
            const { data } = await execute(client, 'experiments', 'getExperiment', { experimentId: first.id });
            assert(data?.id === first.id && data?.name === first.name, `getExperiment returned ${snippet(JSON.stringify(data))}`);
            assert(typeof data.state === 'string' && typeof data.type === 'string', 'state/type missing');
            experiment = { id: first.id, name: first.name };
        });
        await check('experiments.listExperiments search narrows results to matching names', async () => {
            assert(experiment, 'no experiment from the previous check');
            const { data } = await execute(client, 'experiments', 'listExperiments', { search: experiment.name, items: 5 });
            const rows = rowsOf(data);
            assert(rows.some((row) => row.id === experiment!.id), `experiment ${experiment.id} not found by name`);
            assert(rows.every((row) => String(row.name).includes(experiment!.name)), 'search returned non-matching names');
        });
        await check('experiments.searchExperiments finds the experiment by name', async () => {
            assert(experiment, 'no experiment from the previous check');
            const { data } = await execute(client, 'experiments', 'searchExperiments', { search: experiment.name, items: 5 });
            assert(rowsOf(data).some((row) => row.id === experiment!.id), `experiment ${experiment.id} not found`);
        });
        await check('experiments.listExperiments filters by state', async () => {
            const { data } = await execute(client, 'experiments', 'listExperiments', { state: 'stopped', items: 5 });
            const rows = rowsOf(data);
            assert(rows.length > 0, 'no stopped experiments on test-1');
            assert(rows.every((row) => row.state === 'stopped'), `non-stopped rows: ${rows.map((r) => r.state).join(', ')}`);
        });

        section('Error paths');
        await check('execute_command rejects an unknown command', async () => {
            const { text } = await callTool(client, 'execute_command', { group: 'experiments', command: UNKNOWN_COMMAND, params: {} });
            assert(text.includes(`Unknown command "experiments.${UNKNOWN_COMMAND}"`), snippet(text));
        });
        await check('execute_command rejects an unknown group', async () => {
            const { text } = await callTool(client, 'execute_command', { group: UNKNOWN_GROUP, command: UNKNOWN_COMMAND, params: {} });
            assert(text.includes(`Unknown command "${UNKNOWN_GROUP}.${UNKNOWN_COMMAND}"`), snippet(text));
        });
        await check('execute_command reports a missing required param with the command docs', async () => {
            const { text } = await callTool(client, 'execute_command', { group: 'experiments', command: 'getExperiment', params: {} });
            assert(text.includes('Missing required param "experimentId"'), snippet(text));
            assert(text.includes('# experiments.getExperiment'), 'docs not appended');
        });
        await check('a destructive command without confirmed:true is not executed', async () => {
            // No experiment with this id exists, so even a wrongly executed
            // archive could not change anything on test-1.
            const { text } = await callTool(client, 'execute_command', {
                group: 'experiments', command: 'archiveExperiment', params: { experimentId: MISSING_EXPERIMENT_ID },
            });
            assert(text.includes('This is a destructive action'), snippet(text));
            assert(text.includes('confirmed: true'), 'confirmation instructions missing');
        });
        await check('getExperiment on a missing id surfaces the backend 404', async () => {
            const { result, text } = await callTool(client, 'execute_command', {
                group: 'experiments', command: 'getExperiment', params: { experimentId: MISSING_EXPERIMENT_ID },
            });
            assert(result.isError === true || /404|not found/i.test(text), snippet(text));
        });

        section('Resources');
        const resources = await client.listResources();
        const uris = resources.resources.map((resource) => resource.uri);
        await check('resources/list includes every documentation resource', async () => {
            const missing = EXPECTED_DOC_RESOURCES.filter((uri) => !uris.includes(uri));
            assert(missing.length === 0, `missing ${missing.join(', ')}`);
        });
        await check('absmartly://docs/api is the API documentation', async () => {
            const { text, mimeType } = await readTextResource(client, 'absmartly://docs/api');
            assert(mimeType === 'text/markdown', `mimeType ${mimeType}`);
            assert(text.startsWith('# ABsmartly API Documentation'), snippet(text));
        });
        await check('absmartly://docs/templates documents the template format', async () => {
            const { text } = await readTextResource(client, 'absmartly://docs/templates');
            assert(text.startsWith('# Experiment Markdown Templates') && text.includes('createExperimentFromTemplate'), snippet(text));
        });
        for (const [uri, label] of [
            ['absmartly://entities/applications', 'applications'],
            ['absmartly://entities/unit-types', 'unit types'],
            ['absmartly://entities/users', 'users'],
            ['absmartly://entities/goals', 'goals'],
        ]) {
            await check(`${uri} lists ${label} as {id, name}`, async () => {
                const rows = await readJsonResource(client, uri);
                assert(Array.isArray(rows) && rows.length > 0, 'empty list');
                assert(rows.every((row: any) => typeof row.id === 'number' && typeof row.name === 'string'), 'row without id/name');
            });
        }
        await check('resource templates read single entities by id', async () => {
            const metric = (await readJsonResource(client, 'absmartly://entities/metrics'))[0];
            const goal = (await readJsonResource(client, 'absmartly://entities/goals'))[0];
            const user = (await readJsonResource(client, 'absmartly://entities/users'))[0];
            const { data: segments } = await execute(client, 'segments', 'listSegments', {});
            const segment = rowsOf(segments)[0];
            for (const [uri, id] of [
                [`absmartly://metrics/${metric.id}`, metric.id],
                [`absmartly://goals/${goal.id}`, goal.id],
                [`absmartly://users/${user.id}`, user.id],
                [`absmartly://segments/${segment.id}`, segment.id],
            ]) {
                const value = await readJsonResource(client, uri as string);
                assert(value.id === id, `${uri} returned ${snippet(JSON.stringify(value))}`);
            }
            if (experiment) {
                const value = await readJsonResource(client, `absmartly://experiments/${experiment.id}`);
                assert(value.id === experiment.id && value.name === experiment.name, 'experiment resource mismatch');
            }
        });
        await check('resource templates resolve metrics, goals and teams by name', async () => {
            for (const group of ['metrics', 'goals', 'teams']) {
                const first = (await readJsonResource(client, `absmartly://entities/${group}`))[0];
                const value = await readJsonResource(client, `absmartly://${group}/by-name/${encodeURIComponent(first.name)}`);
                assert(value.id === first.id, `${group} by name ${first.name} returned ${snippet(JSON.stringify(value))}`);
            }
        });
        await check('a missing experiment resource returns an error object', async () => {
            const value = await readJsonResource(client, `absmartly://experiments/${MISSING_EXPERIMENT_ID}`);
            assert(typeof value.error === 'string' && value.error.includes('404'), snippet(JSON.stringify(value)));
        });

        section('Prompts');
        await check('prompts/list returns every prompt with its arguments', async () => {
            const { prompts } = await client.listPrompts();
            const names = prompts.map((prompt) => prompt.name);
            const missing = EXPECTED_PROMPTS.filter((name) => !names.includes(name));
            assert(missing.length === 0, `missing ${missing.join(', ')}`);
            const create = prompts.find((prompt) => prompt.name === 'create-experiment');
            assert(create?.arguments?.some((arg) => arg.name === 'name' && arg.required), 'create-experiment name argument missing');
        });
        await check('experiment-status prompt asks for running experiments', async () => {
            const prompt = await client.getPrompt({ name: 'experiment-status' });
            const message = prompt.messages[0];
            assert(message?.role === 'user' && message.content.type === 'text', 'unexpected message shape');
            assert(/running experiments/.test(message.content.text), snippet(message.content.text));
        });
        await check('create-experiment prompt embeds live applications and the template command', async () => {
            const apps = await readJsonResource(client, 'absmartly://entities/applications');
            const prompt = await client.getPrompt({ name: 'create-experiment', arguments: { name: 'prompt_probe', type: 'feature' } });
            const text = prompt.messages[0]?.content.type === 'text' ? prompt.messages[0].content.text : '';
            assert(text.includes('"prompt_probe"') && text.includes('feature flag'), snippet(text));
            assert(text.includes('createExperimentFromTemplate'), 'template command missing');
            assert(text.includes(`id=${apps[0].id}, name="${apps[0].name}"`), 'live applications missing');
        });
        await check('create-feature-flag prompt targets a feature with off/on variants', async () => {
            const prompt = await client.getPrompt({ name: 'create-feature-flag', arguments: { name: 'flag_probe' } });
            const text = prompt.messages[0]?.content.type === 'text' ? prompt.messages[0].content.text : '';
            assert(text.includes('"flag_probe"') && text.includes('type "feature"') && text.includes('off/on'), snippet(text));
        });
        await check('analyze-experiment prompt calls getExperiment for the given id', async () => {
            const id = experiment?.id ?? 1;
            const prompt = await client.getPrompt({ name: 'analyze-experiment', arguments: { id: String(id) } });
            const text = prompt.messages[0]?.content.type === 'text' ? prompt.messages[0].content.text : '';
            assert(text.includes(`"experimentId": ${id}`) && text.includes('getExperiment'), snippet(text));
        });
        await check('experiment-review prompt lists running experiments', async () => {
            const prompt = await client.getPrompt({ name: 'experiment-review' });
            const text = prompt.messages[0]?.content.type === 'text' ? prompt.messages[0].content.text : '';
            assert(text.includes('"state": "running"') && text.includes('listExperiments'), snippet(text));
        });
    } finally {
        await client.close();
    }

    section('Transports and tenant resolution');
    async function identityOver(name: string, connect: () => Promise<Client>, expectedEndpoint: string) {
        await check(name, async () => {
            const tenantClient = await connect();
            try {
                const text = await authStatus(tenantClient);
                assert(text.startsWith('Authenticated with API Key'), snippet(text));
                assert(text.includes(`Endpoint: ${expectedEndpoint}`), `wrong endpoint: ${snippet(text)}`);
                const { data } = await execute(tenantClient, 'teams', 'listTeams', { items: 1 });
                assert(rowsOf(data).length === 1, 'listTeams returned no team');
            } finally {
                await tenantClient.close();
            }
        });
    }
    await identityOver('streamable HTTP (/mcp) with API key + endpoint header', () => connectApiKeyClient('sdk-tools-mcp', credentials, 'mcp'), endpoint);
    await identityOver('Api-Key-prefixed Authorization header', () => connectClient('sdk-tools-apikey-prefix', {
        headers: { Authorization: `Api-Key ${apiKey}`, [ENDPOINT_HEADER]: endpoint },
    }), endpoint);
    await identityOver('api_key and absmartly-endpoint query parameters', () => connectClient('sdk-tools-query', {
        url: new URL(`${transportUrl('sse')}?${new URLSearchParams({ api_key: apiKey, 'absmartly-endpoint': endpoint })}`),
    }), endpoint);
    if (endpointHost.endsWith(TENANT_HOST_SUFFIX)) {
        const subdomain = endpointHost.slice(0, -TENANT_HOST_SUFFIX.length);
        for (const transport of ['sse', 'mcp'] as const) {
            await identityOver(`"<subdomain> <key>" Authorization resolves the tenant over ${transport}`, () => connectClient(`sdk-tools-subdomain-${transport}`, {
                transport, headers: { Authorization: `${subdomain} ${apiKey}` },
            }), rootEndpoint);
        }
    } else {
        recorder.fail('"<subdomain> <key>" Authorization resolves the tenant', `endpoint ${endpointHost} is not an absmartly.com tenant`);
    }
    await identityOver('"<endpoint URL> <key>" Authorization overrides the endpoint', () => connectClient('sdk-tools-endpoint-prefix', {
        headers: { Authorization: `${endpoint} ${apiKey}` },
    }), endpoint);

    section('Rejected credentials');
    await check('no credentials: 401 with an OAuth challenge', async () => {
        const { status, wwwAuthenticate } = await unauthorizedStatus({});
        assert(status === HTTP_UNAUTHORIZED, `status ${status}`);
        assert(wwwAuthenticate?.startsWith('Bearer ') && wwwAuthenticate.includes('resource_metadata='), `WWW-Authenticate ${wwwAuthenticate}`);
    });
    await check('an unknown bearer token: 401', async () => {
        const { status } = await unauthorizedStatus({ Authorization: BOGUS_BEARER });
        assert(status === HTTP_UNAUTHORIZED, `status ${status}`);
    });
    await check('an API key the backend rejects: 401', async () => {
        const { status } = await unauthorizedStatus({ Authorization: BOGUS_API_KEY, [ENDPOINT_HEADER]: endpoint });
        assert(status === HTTP_UNAUTHORIZED, `status ${status}`);
    });
    await check('an SDK client with a rejected API key fails to connect', async () => {
        let connected = false;
        try {
            const rejected = await connectClient('sdk-tools-rejected', { headers: { Authorization: BOGUS_API_KEY, [ENDPOINT_HEADER]: endpoint } });
            connected = true;
            await rejected.close();
        } catch {
            // expected
        }
        assert(!connected, 'connected with a rejected API key');
    });

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
        return { success: false, message, testCount: 1, details: [{ name: 'sdk-tools suite', status: 'FAIL', error: message }] };
    }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    runWrapped().then((result) => process.exit(result.success ? 0 : 1));
}
