#!/usr/bin/env node
/**
 * Live catalog-contract tests (#66): MCP tool calls through the local Worker
 * (wrangler dev, SSE transport) against a real ABsmartly API.
 *
 * Covers, end to end:
 *   - the corrected argument shapes of the changed catalog commands, read paths
 *     and safe write paths (a uniquely named goal is created, access is granted
 *     and revoked by role name and ID, then the goal is archived);
 *   - the deprecated 2.0 shapes that are still accepted (`params` on insights);
 *   - ID safety: path IDs that are not positive integers are refused before any
 *     request (no HTTP error from the backend), for commands and for the
 *     absmartly://<entity>/{id} resource templates;
 *   - endpoint handling: the endpoint header is parsed once and stored as its
 *     apiUrl, so a base URL, a trailing slash or /v1 all reach the same API.
 *
 * Credentials: ABSMARTLY_API_KEY + ABSMARTLY_API_ENDPOINT, or `--profile <name>`
 * (see test-credentials.js). Without credentials or a reachable Worker
 * (MCP_WORKER_URL, see gate.js) it skips locally and fails a gated run.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { pathToFileURL } from "url";
import { resolveTestCredentials, SKIP_MESSAGE } from "./test-credentials.js";
import { skipScenario, skipSuite, workerUrl } from "./gate.js";

const WORKER_URL = workerUrl();
const SSE_URL = `${WORKER_URL}/sse`;
const PROBE_TIMEOUT_MS = 1500;
const TEST_NAME_PREFIX = 'mcp_e2e_contract';
const DAY_MS = 86_400_000;
const ID_REFUSAL = 'must be a positive integer';
const BACKEND_HTTP_ERROR = /HTTP \d{3}/;

type ToolCallResult = { content: Array<{ type: string; text?: string }>; isError?: boolean };
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

/** The API origin + base path of an endpoint, without a trailing /v1 or slash. */
function baseUrlOf(endpoint: string): string {
    return endpoint.replace(/\/+$/, '').replace(/\/v1$/, '');
}

async function connect(apiKey: string, endpoint: string, name: string): Promise<Client> {
    const transport = new SSEClientTransport(new URL(SSE_URL), {
        requestInit: { headers: { 'Authorization': apiKey, 'x-absmartly-endpoint': endpoint } },
    });
    const client = new Client({ name, version: '1.0' });
    await client.connect(transport);
    return client;
}

function textOf(result: ToolCallResult): string {
    const first = result?.content?.[0];
    return first && first.type === 'text' && typeof first.text === 'string' ? first.text : JSON.stringify(result);
}

async function execute(
    client: Client,
    group: string,
    command: string,
    params: Record<string, unknown> = {},
    confirmed = false,
): Promise<{ text: string; data?: any }> {
    const result = await client.callTool({
        name: 'execute_command',
        arguments: { group, command, params, ...(confirmed ? { confirmed: true } : {}) },
    }) as ToolCallResult;
    const text = textOf(result);
    return { text, data: leadingJson(text) };
}

/** The JSON value a result starts with; list results may be followed by pagination or warning notes. */
function leadingJson(text: string): any {
    try {
        return JSON.parse(text);
    } catch {}
    const notes = text.search(/\n\n(\(Page |Warnings:)/);
    if (notes > 0) {
        try {
            return JSON.parse(text.slice(0, notes));
        } catch {}
    }
    return undefined;
}

/** A successful command returns JSON; failures are "Error executing ..." / "Param validation failed ..." text. */
async function expectOk(client: Client, group: string, command: string, params: Record<string, unknown> = {}, confirmed = false): Promise<any> {
    const { text, data } = await execute(client, group, command, params, confirmed);
    if (data === undefined || /^(Error executing|Param validation failed)/.test(text)) {
        throw new Error(`${group}.${command} ${JSON.stringify(params)} failed: ${text.slice(0, 300)}`);
    }
    return data;
}

/** Refused by MCP itself: an ID-safety message and no backend HTTP error (so no request was sent). */
async function expectIdRefusal(client: Client, group: string, command: string, params: Record<string, unknown>): Promise<void> {
    const { text } = await execute(client, group, command, params, true);
    if (BACKEND_HTTP_ERROR.test(text)) throw new Error(`reached the backend: ${text.slice(0, 300)}`);
    if (!text.includes(ID_REFUSAL)) throw new Error(`expected an ID refusal, got: ${text.slice(0, 300)}`);
}

async function expectError(client: Client, group: string, command: string, params: Record<string, unknown>, fragment: string): Promise<void> {
    const { text } = await execute(client, group, command, params);
    if (!text.includes(fragment)) throw new Error(`expected "${fragment}", got: ${text.slice(0, 300)}`);
}

async function readResourceText(client: Client, uri: string): Promise<string> {
    const r = await client.readResource({ uri }) as { contents: Array<{ text?: string }> };
    return r.contents?.[0]?.text ?? '';
}

async function archiveGoal(apiKey: string, endpoint: string, goalId: number): Promise<void> {
    // The catalog has no goal archive command; clean up through the API directly.
    const response = await fetch(`${baseUrlOf(endpoint)}/v1/goals/${goalId}/archive`, {
        method: 'PUT',
        headers: { 'Authorization': `Api-Key ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ archive: true }),
    });
    if (!response.ok) throw new Error(`archiving goal ${goalId} failed: HTTP ${response.status}`);
}

async function run() {
    const creds = await resolveTestCredentials();
    if (!creds) return skipSuite(SKIP_MESSAGE);
    if (!(await isWorkerReachable())) return skipSuite(`local Worker not reachable at ${WORKER_URL}`);

    const { apiKey, endpoint } = creds;
    console.log(`\n  API: ${baseUrlOf(endpoint)}  Worker: ${WORKER_URL}`);
    const client = await connect(apiKey, endpoint, 'catalog-contract-live');
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

    const me = await expectOk(client, 'auth', 'whoami');
    const teams = await expectOk(client, 'teams', 'listTeams', { items: 1 });
    const roles = await expectOk(client, 'assetroles', 'listAssetRoles');
    const role = Array.isArray(roles) ? roles[0] : undefined;
    const teamId = Array.isArray(teams) ? teams[0]?.id : undefined;
    if (!me?.id || !teamId || !role?.id || !role?.name) {
        await client.close();
        throw new Error(`missing fixtures: user=${me?.id} team=${teamId} role=${JSON.stringify(role)}`);
    }

    // --- Changed catalog contracts: read paths ---

    await test('experiments.listCustomFields with no params defaults type to "test" and returns fields', async () => {
        const fields = await expectOk(client, 'experiments', 'listCustomFields');
        if (!Array.isArray(fields) || fields.length === 0) throw new Error(`no custom fields: ${JSON.stringify(fields).slice(0, 200)}`);
        if (fields.some((f: any) => f.section_type && f.section_type !== 'test')) throw new Error('returned non-test fields');
    });

    await test('experiments.generateTemplate: blank template, defaults and explicit name/type', async () => {
        const blank = await expectOk(client, 'experiments', 'generateTemplate');
        if (!String(blank.content).includes('name: My Experiment')) throw new Error('default name missing');
        const named = await expectOk(client, 'experiments', 'generateTemplate', { name: `${TEST_NAME_PREFIX}_tpl`, type: 'feature' });
        if (!String(named.content).includes(`name: ${TEST_NAME_PREFIX}_tpl`) || !String(named.content).includes('type: feature')) {
            throw new Error('name/type not applied');
        }
    });

    await test('experiments.estimateParticipants takes unitType (required) and returns an estimate', async () => {
        const unitTypes = await expectOk(client, 'units', 'listUnits');
        const unitType = Array.isArray(unitTypes) ? unitTypes[0]?.name : undefined;
        if (!unitType) throw new Error('no unit type');
        const estimate = await expectOk(client, 'experiments', 'estimateParticipants', { unitType, from: '30d' });
        if (!estimate || (!estimate.rows && !estimate.raw)) throw new Error(`unexpected estimate: ${JSON.stringify(estimate).slice(0, 200)}`);
        await expectError(client, 'experiments', 'estimateParticipants', {}, 'Missing required param "unitType"');
    });

    await test('insights.*: documented top-level filters and the deprecated params object are both accepted', async () => {
        const window = { from: '2026-01-01', to: '2026-02-01', aggregation: 'week' };
        // getVelocityInsightsDetail is left out: the backend also requires a
        // `category` that the CLI core does not send (as in 2.0.1).
        for (const command of ['getVelocityInsights', 'getDecisionInsights', 'getDecisionInsightsHistory']) {
            await expectOk(client, 'insights', command, window);
        }
        await expectOk(client, 'insights', 'getVelocityInsights', { params: window });
        await expectError(client, 'insights', 'getVelocityInsights', { from: '2026-01-01', to: '2026-02-01' }, 'Missing required param "aggregation"');
    });

    await test('activity.listActivity: top-level filters (limit) apply', async () => {
        const entries = await expectOk(client, 'activity', 'listActivity', { limit: 2, experiments: 5 });
        if (!Array.isArray(entries) || entries.length > 2) throw new Error(`expected ≤2 entries, got ${JSON.stringify(entries).slice(0, 200)}`);
    });

    await test('events.listEvents / listEventsHistory: top-level from/to filters', async () => {
        const to = Date.now();
        const from = to - DAY_MS;
        const events = await expectOk(client, 'events', 'listEvents', { from, to });
        if (!events?.columnNames && !Array.isArray(events)) throw new Error(`unexpected events: ${JSON.stringify(events).slice(0, 200)}`);
        await expectOk(client, 'events', 'listEventsHistory', { from, to });
    });

    await test('platformconfig.getPlatformConfig resolves a config by name and by ID', async () => {
        const configs = await expectOk(client, 'platformconfig', 'listPlatformConfigs');
        const first = Array.isArray(configs) ? configs[0] : undefined;
        if (!first?.name) throw new Error('no platform config');
        const byName = await expectOk(client, 'platformconfig', 'getPlatformConfig', { configKey: first.name });
        const byId = await expectOk(client, 'platformconfig', 'getPlatformConfig', { configKey: String(first.id) });
        if (byName.id !== first.id || byId.id !== first.id) throw new Error(`resolved ${byName.id}/${byId.id}, expected ${first.id}`);
    });

    await test('datasources.testDatasource / introspectDatasource / validateDatasourceQuery test the saved datasource by ID', async () => {
        const datasources = await expectOk(client, 'datasources', 'listDatasources');
        const ds = Array.isArray(datasources) ? (datasources.find((d: any) => d.is_default) ?? datasources[0]) : undefined;
        if (!ds?.id) throw new Error('no datasource');
        await expectOk(client, 'datasources', 'testDatasource', { datasourceId: ds.id });
        await expectOk(client, 'datasources', 'introspectDatasource', { datasourceId: ds.id });
        await expectOk(client, 'datasources', 'validateDatasourceQuery', { datasourceId: ds.id, query: 'SELECT 1' });
        await expectError(client, 'datasources', 'validateDatasourceQuery', { datasourceId: ds.id }, 'requires "query"');
        await expectError(client, 'datasources', 'testDatasource', {}, 'needs "datasourceId" or a "config"');
    });

    await test('storageconfigs.testStorageConfig tests the saved config by ID (stored secret used server-side)', async () => {
        const configs = await expectOk(client, 'storageconfigs', 'listStorageConfigs');
        const s3 = Array.isArray(configs) ? configs.find((c: any) => c.type === 'S3' && !c.is_internal_export_config) : undefined;
        if (!s3?.id) {
            skipScenario('no S3 storage config on this instance');
            return;
        }
        const result = await expectOk(client, 'storageconfigs', 'testStorageConfig', { configId: s3.id });
        if (result?.success !== true) throw new Error(`unexpected result: ${JSON.stringify(result).slice(0, 200)}`);
    });

    await test('auth.resetMyPassword requires oldPassword/newPassword (validated before any request)', async () => {
        await expectError(client, 'auth', 'resetMyPassword', {}, 'Missing required param "oldPassword"');
    });

    await test('experiments.refreshFields is no longer in the catalog', async () => {
        await expectError(client, 'experiments', 'refreshFields', {}, 'Unknown command');
    });

    // --- Changed catalog contracts: safe write paths on a unique goal ---

    await test('goals: create → grant/revoke team and user access by role name and ID → archive', async () => {
        const name = `${TEST_NAME_PREFIX}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
        const goal = await expectOk(client, 'goals', 'createGoal', { data: { name, description: 'mcp #66 live contract test' } });
        const goalId = goal?.id;
        if (!goalId) throw new Error(`createGoal returned no id: ${JSON.stringify(goal).slice(0, 200)}`);
        try {
            await expectOk(client, 'goals', 'grantGoalAccessTeam', { goalId, teamId, role: role.name }, true);
            const teamAccess = await expectOk(client, 'goals', 'listGoalAccessTeams', { goalId });
            if (!teamAccess.some((a: any) => a.team_id === teamId && a.asset_role_id === role.id)) {
                throw new Error(`team grant not visible: ${JSON.stringify(teamAccess).slice(0, 200)}`);
            }
            await expectOk(client, 'goals', 'revokeGoalAccessTeam', { goalId, teamId, role: role.name }, true);
            const afterTeam = await expectOk(client, 'goals', 'listGoalAccessTeams', { goalId });
            if (afterTeam.some((a: any) => a.team_id === teamId)) throw new Error('team revoke left the grant in place');

            await expectOk(client, 'goals', 'grantGoalAccessUser', { goalId, userId: me.id, role: String(role.id) }, true);
            const userAccess = await expectOk(client, 'goals', 'listGoalAccessUsers', { goalId });
            if (!userAccess.some((a: any) => a.user_id === me.id && a.asset_role_id === role.id)) {
                throw new Error(`user grant not visible: ${JSON.stringify(userAccess).slice(0, 200)}`);
            }
            await expectOk(client, 'goals', 'revokeGoalAccessUser', { goalId, userId: me.id, role: role.name }, true);
            const afterUser = await expectOk(client, 'goals', 'listGoalAccessUsers', { goalId });
            if (afterUser.some((a: any) => a.user_id === me.id)) throw new Error('user revoke left the grant in place');

            await expectError(client, 'goals', 'grantGoalAccessTeam', { goalId, teamId }, 'Missing required param "role"');
        } finally {
            await archiveGoal(apiKey, endpoint, goalId);
        }
        const archived = await expectOk(client, 'goals', 'getGoal', { goalId });
        if (archived.archived !== true) throw new Error(`goal ${goalId} not archived after cleanup`);
    });

    // --- ID and path safety ---

    await test('commands refuse non-integer path IDs before sending a request', async () => {
        await expectIdRefusal(client, 'goals', 'getGoal', { goalId: '1/../users' });
        await expectIdRefusal(client, 'goals', 'getGoal', { goalId: '%2e%2e' });
        await expectIdRefusal(client, 'goals', 'getGoal', { goalId: -1 });
        await expectIdRefusal(client, 'goals', 'getGoal', { goalId: 1.5 });
        await expectIdRefusal(client, 'experiments', 'startExperiment', { experimentId: null });
        await expectIdRefusal(client, 'goals', 'listGoalAccessTeams', { goalId: '7?x=1' });
        await expectError(client, 'experiments', 'startExperiment', {}, 'Missing required param "experimentId"');
    });

    await test('absmartly://<entity>/{id} resource templates refuse non-integer IDs', async () => {
        for (const uri of ['absmartly://experiments/-1', 'absmartly://experiments/1.5', 'absmartly://goals/0', 'absmartly://metrics/1e3']) {
            const text = await readResourceText(client, uri);
            if (!/"error":\s*"Invalid \w+ ID"/.test(text)) throw new Error(`${uri} was not refused: ${text.slice(0, 200)}`);
        }
        const goals = await expectOk(client, 'goals', 'listGoals', { items: 1 });
        const goalId = Array.isArray(goals) ? goals[0]?.id : undefined;
        if (goalId) {
            const text = await readResourceText(client, `absmartly://goals/${goalId}`);
            if (text.includes('"error"')) throw new Error(`valid goal resource failed: ${text.slice(0, 200)}`);
        }
    });

    await client.close();

    // --- Endpoint handling ---

    await test('endpoint header as base URL, with trailing slash, or with /v1 reaches the same API', async () => {
        const base = baseUrlOf(endpoint);
        for (const variant of [base, `${base}/`, `${base}/v1`, `${base}/v1/`]) {
            const c = await connect(apiKey, variant, 'catalog-contract-live-endpoint');
            try {
                const status = textOf(await c.callTool({ name: 'get_auth_status', arguments: {} }) as ToolCallResult);
                if (!status.includes(`Endpoint: ${base}/v1`)) throw new Error(`${variant}: stored endpoint is not ${base}/v1: ${status.slice(0, 200)}`);
                const user = await expectOk(c, 'auth', 'whoami');
                if (user.id !== me.id) throw new Error(`${variant}: whoami returned ${user.id}`);
            } finally {
                await c.close();
            }
        }
    });

    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        for (const r of results.filter(r => r.status === 'FAIL')) console.log(`  - ${r.name}: ${r.error}`);
    }
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
