#!/usr/bin/env node
/**
 * Experiment lifecycle checks through the official MCP SDK client that
 * lifecycle-sdk.test.ts does not make: the create preview writes nothing,
 * the destructive-action gate holds on a live entity, a created experiment
 * is readable through getExperiment, search and its resource, a restart
 * creates the next iteration, and full_on really sets the full-on variant.
 *
 * Replaces the lifecycle scenarios of claude-mcp-tools,
 * claude-tool-discovery and claude-user-experience, which drove the same
 * steps through a model and only checked what the model reported.
 *
 * Writes to test-1: every experiment gets a unique name and is stopped and
 * archived in a finally block. A cleanup failure fails the suite.
 */

import { pathToFileURL } from 'url';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { resolveTestCredentials, SKIP_MESSAGE } from './test-credentials.js';
import { skipSuite, workerUrl } from './gate.js';
import {
    assert,
    callTool,
    connectApiKeyClient,
    createEntityTracker,
    createRecorder,
    execute,
    jsonOf,
    snippet,
    waitForField,
} from './mcp-sdk-client.js';

const NAME_PREFIX = 'sdk_extra_exp';
const CONTROL_VARIANT = 'Control';
const TREATMENT_VARIANT = 'Blue Button';
const FULL_ON_VARIANT = 1;
const STOP_REASON = 'hypothesis_iteration';
const PREVIEW_MARKER = '**Preview — experiment NOT YET created.**';
const GATE_MARKER = 'This is a destructive action';
const LOOKUP_ITEMS = 10;

function uniqueName(): string {
    return `${NAME_PREFIX}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

async function firstEntityName(client: Client, uri: string): Promise<string> {
    const result = await client.readResource({ uri });
    const rows = jsonOf((result.contents?.[0] as { text?: string } | undefined)?.text ?? '');
    const name = Array.isArray(rows) ? rows[0]?.name : undefined;
    assert(typeof name === 'string', `no entity in ${uri}`);
    return name;
}

function buildTemplate(name: string, fixtures: { app: string; unit: string; metric: string; owner: string }): string {
    return [
        '---',
        `name: ${name}`,
        `display_name: "${name}"`,
        'type: test',
        'state: created',
        'percentage_of_traffic: 100',
        'percentages: 50/50',
        `unit_type: ${fixtures.unit}`,
        `application: ${fixtures.app}`,
        `primary_metric: ${fixtures.metric}`,
        'owners:',
        `  - ${fixtures.owner}`,
        '---',
        '',
        '## Variants',
        '',
        `### variant_0\n\nname: ${CONTROL_VARIANT}\nconfig: {}\n\n---\n\n### variant_1\n\nname: ${TREATMENT_VARIANT}\nconfig: {}`,
        '',
        '---',
        '',
        '## Description',
        '',
        'sdk lifecycle-extra integration test',
        '',
    ].join('\n');
}

async function findByName(client: Client, name: string): Promise<any[]> {
    const { data } = await execute(client, 'experiments', 'listExperiments', { search: name, items: LOOKUP_ITEMS });
    return (Array.isArray(data) ? data : []).filter((row: any) => row?.name === name);
}

async function run() {
    const credentials = await resolveTestCredentials();
    if (!credentials) return skipSuite(SKIP_MESSAGE);

    const recorder = createRecorder('Deterministic MCP SDK: lifecycle checks beyond lifecycle-sdk');
    const { check, section } = recorder;
    const client = await connectApiKeyClient('sdk-lifecycle-extra-test', credentials);
    const tracker = createEntityTracker(client);

    try {
        const { text: authText } = await callTool(client, 'get_auth_status');
        const owner = authText.match(/Email:\s*(\S+@\S+)/)?.[1];
        assert(owner, `no email in get_auth_status: ${snippet(authText)}`);
        const fixtures = {
            app: await firstEntityName(client, 'absmartly://entities/applications'),
            unit: await firstEntityName(client, 'absmartly://entities/unit-types'),
            metric: await firstEntityName(client, 'absmartly://entities/metrics'),
            owner,
        };
        const name = uniqueName();
        const templateContent = buildTemplate(name, fixtures);
        let experimentId: number | undefined;
        let restartedId: number | undefined;
        const requireExperiment = () => {
            assert(experimentId, 'no experiment: an earlier step failed');
            return experimentId;
        };
        const requireRestarted = () => {
            assert(restartedId, 'no restarted experiment: an earlier step failed');
            return restartedId;
        };

        section('Create');
        await check('createExperimentFromTemplate without confirmed returns a preview and creates nothing', async () => {
            const { text } = await execute(client, 'experiments', 'createExperimentFromTemplate', { templateContent });
            assert(text.startsWith(PREVIEW_MARKER), snippet(text));
            assert(text.includes(`"name": "${name}"`), 'preview payload does not carry the name');
            assert((await findByName(client, name)).length === 0, `preview created ${name}`);
        });
        await check('createExperimentFromTemplate with confirmed:true creates the experiment', async () => {
            tracker.expectCreate(name, 'test');
            const { data, text } = await execute(client, 'experiments', 'createExperimentFromTemplate', { templateContent }, { confirmed: true });
            const id = data?.id ?? data?.experiment?.id;
            assert(typeof id === 'number', `no id in response: ${snippet(text)}`);
            tracker.resolveCreate(name, id);
            experimentId = id;
        });
        await check('getExperiment returns the template values', async () => {
            const { data } = await execute(client, 'experiments', 'getExperiment', { experimentId: requireExperiment() });
            assert(data?.name === name && data.type === 'test' && data.state === 'created', snippet(JSON.stringify(data)));
            assert(data.variants === `${CONTROL_VARIANT}, ${TREATMENT_VARIANT}`, `variants ${data.variants}`);
            assert(data.application === fixtures.app && data.unit_type === fixtures.unit, 'application/unit type mismatch');
            assert(data.primary_metric === fixtures.metric, `primary metric ${data.primary_metric}`);
        });
        await check('the new experiment is found by name and readable as a resource', async () => {
            const id = requireExperiment();
            assert((await findByName(client, name)).some((row) => row.id === id), 'listExperiments search missed it');
            const resource = await client.readResource({ uri: `absmartly://experiments/${id}` });
            const value = jsonOf((resource.contents?.[0] as { text?: string } | undefined)?.text ?? '');
            assert(value?.id === id && value.name === name, `resource returned ${snippet(JSON.stringify(value))}`);
        });

        section('Destructive-action gate');
        await check('updateExperiment moves created → ready', async () => {
            const id = requireExperiment();
            await execute(client, 'experiments', 'updateExperiment', { experimentId: id, changes: { state: 'ready' } });
            await waitForField(client, id, 'state', 'ready');
        });
        await check('startExperiment without confirmed:true is refused and the state is unchanged', async () => {
            const id = requireExperiment();
            const { text } = await callTool(client, 'execute_command', {
                group: 'experiments', command: 'startExperiment', params: { experimentId: id },
            });
            assert(text.includes(GATE_MARKER), snippet(text));
            const record = await tracker.readRecord(id);
            assert(record.state === 'ready', `state became ${record.state}`);
        });

        section('Run, restart, full on');
        await check('developmentExperiment then startExperiment reach running', async () => {
            const id = requireExperiment();
            await execute(client, 'experiments', 'developmentExperiment', { experimentId: id, note: 'sdk dev' }, { confirmed: true });
            await waitForField(client, id, 'state', 'development');
            await execute(client, 'experiments', 'startExperiment', { experimentId: id }, { confirmed: true });
            await waitForField(client, id, 'state', 'running');
        });
        await check('stopExperiment reaches stopped', async () => {
            const id = requireExperiment();
            await execute(client, 'experiments', 'stopExperiment', { experimentId: id, reason: STOP_REASON }, { confirmed: true });
            await waitForField(client, id, 'state', 'stopped');
        });
        await check('restartExperiment creates the next iteration, running', async () => {
            const id = requireExperiment();
            const before = await execute(client, 'experiments', 'getExperiment', { experimentId: id, show: ['iteration'] });
            const { data, text } = await execute(client, 'experiments', 'restartExperiment', { experimentId: id, reason: STOP_REASON }, { confirmed: true });
            const newId = data?.newId ?? data?.experiment?.id ?? data?.id;
            assert(typeof newId === 'number' && newId !== id, `no new id: ${snippet(text)}`);
            tracker.track(newId, 'test');
            restartedId = newId;
            const record = await waitForField(client, newId, 'state', 'running', { show: ['iteration'] });
            assert(record.name === name, `restarted name ${record.name}`);
            assert(record.iteration === before.data.iteration + 1, `iteration ${before.data.iteration} → ${record.iteration}`);
        });
        await check('fullOnExperiment sets the full-on variant while the experiment keeps running', async () => {
            const id = requireRestarted();
            await execute(client, 'experiments', 'fullOnExperiment', { experimentId: id, variant: FULL_ON_VARIANT, note: 'sdk full on' }, { confirmed: true });
            const record = await waitForField(client, id, 'full_on_variant', FULL_ON_VARIANT, { show: ['full_on_variant', 'full_on_at'] });
            assert(record.state === 'running', `state ${record.state}`);
            assert(record.full_on_at, 'full_on_at not set');
        });
        await check('the full-on experiment stops and archives', async () => {
            const id = requireRestarted();
            await execute(client, 'experiments', 'stopExperiment', { experimentId: id, reason: STOP_REASON }, { confirmed: true });
            await waitForField(client, id, 'state', 'stopped');
            await tracker.archiveAndConfirm(id);
        });
        await check('the first iteration archives', async () => {
            await tracker.archiveAndConfirm(requireExperiment());
        });
    } finally {
        const errors = await tracker.cleanup();
        if (errors.length > 0) {
            recorder.fail('cleanup: stop and archive created experiments', errors.join('; '));
        } else {
            console.log(`\n  cleanup: archived ${[...tracker.created.keys()].join(', ') || 'nothing'}`);
        }
        await client.close();
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
        return { success: false, message, testCount: 1, details: [{ name: 'sdk-lifecycle-extra suite', status: 'FAIL', error: message }] };
    }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    runWrapped().then((result) => process.exit(result.success ? 0 : 1));
}
