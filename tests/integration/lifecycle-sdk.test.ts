#!/usr/bin/env node
/**
 * Lifecycle tests via direct MCP SDK calls — no Claude in the loop.
 *
 * Replaces the Claude-driven lifecycle tests that previously lived in
 * claude-mcp-tools.test.js and claude-tool-discovery.test.js. Those tests
 * were flaky because:
 *   1. Claude haiku occasionally lost track of MCP tools after several
 *      rapid calls and reported back its built-in tool list instead.
 *   2. Multi-step orchestrations multiplied per-step failure rates.
 *   3. The model-driven prompt structure made it hard to inject real
 *      setTimeout-based waits between state transitions, so backend
 *      propagation latency would surface as assertion mismatches.
 *
 * This version uses the official MCP SDK exactly like mcp-schema.test.ts:
 * a single SSEClientTransport, deterministic tool calls, and a polling
 * helper that uses setTimeout for real waits.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { pathToFileURL } from "url";
import { resolveTestCredentials, SKIP_MESSAGE } from "./test-credentials.js";
import { skipSuite, workerUrl } from "./gate.js";

const LOCAL_MCP_URL = `${workerUrl()}/sse`;
const POLL_INTERVAL_MS = 1_000;
const POLL_DEFAULT_MAX_RETRIES = 10;

type ToolCallResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };

async function isLocalMcpReachable(): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1500);
        await fetch(LOCAL_MCP_URL, { signal: controller.signal });
        clearTimeout(timer);
        return true;
    } catch {
        return false;
    }
}

function extractText(result: ToolCallResult): string {
    const first = result?.content?.[0];
    if (first && first.type === 'text' && typeof first.text === 'string') return first.text;
    return JSON.stringify(result);
}

function parseExecuteCommandResponse(text: string): { data?: any; raw: string } {
    // execute_command serializes results as JSON inside the text content.
    try {
        const parsed = JSON.parse(text);
        return { data: parsed, raw: text };
    } catch {
        return { raw: text };
    }
}

async function callExecute(
    client: Client,
    group: string,
    command: string,
    params: Record<string, unknown> = {},
    extras: Record<string, unknown> = {}
): Promise<{ data?: any; text: string }> {
    const result = await client.callTool({
        name: 'execute_command',
        arguments: { group, command, params, ...extras },
    }) as ToolCallResult;
    const text = extractText(result);
    if (result.isError || /^Error executing /.test(text)) throw new Error(text);
    const parsed = parseExecuteCommandResponse(text);
    return { data: parsed.data, text };
}

async function pollState(
    client: Client,
    experimentId: number,
    expectedState: string,
    maxRetries = POLL_DEFAULT_MAX_RETRIES,
    field: 'state' | 'feature_state' = 'state'
): Promise<{ matched: boolean; observed: string; attempts: number; history: string[] }> {
    const history: string[] = [];
    let attempts = 0;
    while (attempts < maxRetries) {
        attempts++;
        const { data, text } = await callExecute(client, 'experiments', 'getExperiment', { experimentId, show: ['feature_state'] });
        const observed = data?.[field] ?? data?.experiment?.[field] ?? data?.data?.experiment?.[field] ?? '<unknown>';
        history.push(observed);
        if (observed === expectedState) {
            return { matched: true, observed, attempts, history };
        }
        if (attempts < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        }
        // detect error responses early
        if (typeof text === 'string' && text.toLowerCase().includes('error')) {
            // Surface the actual error to the test
            history[history.length - 1] = `<error: ${text.slice(0, 200)}>`;
        }
    }
    return { matched: false, observed: history[history.length - 1], attempts, history };
}

interface TestResult {
    name: string;
    status: 'PASS' | 'FAIL';
    error?: string;
}

async function run() {
    if (!(await isLocalMcpReachable())) {
        return skipSuite(`local MCP not reachable at ${LOCAL_MCP_URL}; start wrangler dev`);
    }

    const credentials = await resolveTestCredentials();
    if (!credentials) return skipSuite(SKIP_MESSAGE);
    const { endpoint, apiKey } = credentials;
    const transport = new SSEClientTransport(
        new URL(LOCAL_MCP_URL),
        { requestInit: { headers: { 'Authorization': apiKey, 'x-absmartly-endpoint': endpoint } } }
    );
    const client = new Client({ name: "lifecycle-sdk-test", version: "1.0" });
    await client.connect(transport);

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

    // Discover real entity names from the live backend so the test isn't
    // brittle to sandbox renames. listApps returns an array of apps; the
    // catalog resources are simpler — `absmartly://entities/<group>` always
    // returns `[{id, name, description}, ...]` regardless of how the raw API
    // shape evolves.
    async function firstEntityName(uri: string): Promise<string | undefined> {
        const r = await client.readResource({ uri }) as { contents: Array<{ text?: string }> };
        const text = r.contents?.[0]?.text;
        if (!text) return undefined;
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed) && parsed[0]?.name) return parsed[0].name as string;
        } catch {}
        return undefined;
    }

    const appName = await firstEntityName('absmartly://entities/applications');
    const unitName = await firstEntityName('absmartly://entities/unit-types');
    const metricName = await firstEntityName('absmartly://entities/metrics');
    const authResult = await client.callTool({ name: 'get_auth_status', arguments: {} }) as ToolCallResult;
    const authText = extractText(authResult);
    const emailMatch = authText.match(/Email:\s*(\S+@\S+)/);
    const ownerEmail = emailMatch?.[1];

    if (!appName || !unitName || !metricName || !ownerEmail) {
        await client.close();
        throw new Error(`Missing fixtures — app=${appName} unit=${unitName} metric=${metricName} owner=${ownerEmail}`);
    }

    function buildTemplate(name: string, type: 'test' | 'feature'): string {
        const variants = type === 'feature'
            ? `### variant_0\n\nname: off\nconfig: {}\n\n---\n\n### variant_1\n\nname: on\nconfig: {}`
            : `### variant_0\n\nname: control\nconfig: {}\n\n---\n\n### variant_1\n\nname: treatment\nconfig: {}`;
        return [
            '---',
            `name: ${name}`,
            `display_name: "${name}"`,
            `type: ${type}`,
            'state: created',
            'percentage_of_traffic: 100',
            'percentages: 50/50',
            `unit_type: ${unitName}`,
            `application: ${appName}`,
            `primary_metric: ${metricName}`,
            'owners:',
            `  - ${ownerEmail}`,
            '---',
            '',
            '## Variants',
            '',
            variants,
            '',
            '---',
            '',
            '## Description',
            '',
            `sdk lifecycle integration test (${type})`,
            '',
        ].join('\n');
    }

    // Every entity the suite creates, so cleanup can stop and archive it even
    // when a scenario fails part-way. A failed gated run must not leave
    // running feature flags or experiments on the shared test-1 instance.
    const createdEntities = new Map<number, 'test' | 'feature'>();
    // Names of confirmed creates whose response gave no id (lost, malformed or
    // an MCP error). The backend may still have committed them, so cleanup
    // looks each one up by name.
    const unresolvedCreates = new Map<string, 'test' | 'feature'>();

    async function createAndConfirm(type: 'test' | 'feature', prefix: string): Promise<number> {
        // The test-1 backend occasionally returns "Internal Server Error" from
        // createExperimentFromTemplate (especially for type=feature). Retry
        // a couple of times with fresh names before giving up.
        let lastError: string | undefined;
        for (let attempt = 1; attempt <= 3; attempt++) {
            const name = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
            const templateContent = buildTemplate(name, type);
            try {
                // First call returns preview (no confirmed). Second call with confirmed:true creates.
                await callExecute(client, 'experiments', 'createExperimentFromTemplate', { templateContent });
                unresolvedCreates.set(name, type);
                const created = await callExecute(client, 'experiments', 'createExperimentFromTemplate', { templateContent }, { confirmed: true });
                const id = created.data?.id ?? created.data?.experiment?.id ?? created.data?.data?.id;
                if (id) {
                    createdEntities.set(id as number, type);
                    unresolvedCreates.delete(name);
                    return id as number;
                }
                lastError = `attempt ${attempt}/3: ${created.text.slice(0, 400)}`;
            } catch (err: any) {
                lastError = `attempt ${attempt}/3: ${(err?.message || String(err)).slice(0, 400)}`;
            }
            if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 2_000));
        }
        throw new Error(`createExperimentFromTemplate returned no id after 3 attempts. last: ${lastError}`);
    }

    async function transition(
        commandName: string,
        experimentId: number,
        extraParams: Record<string, unknown> = {}
    ): Promise<{ data?: any; text: string }> {
        return callExecute(client, 'experiments', commandName, { experimentId, ...extraParams }, { confirmed: true });
    }

    async function readFields(experimentId: number): Promise<Record<string, any>> {
        const { data } = await callExecute(client, 'experiments', 'getExperiment', {
            experimentId, show: ['feature_state', 'archived'],
        });
        return data?.experiment ?? data ?? {};
    }

    async function archiveAndConfirm(experimentId: number): Promise<void> {
        await transition('archiveExperiment', experimentId);
        const after = await readFields(experimentId);
        if (after.archived !== true) {
            throw new Error(`experiment ${experimentId} not archived after archiveExperiment (archived=${after.archived})`);
        }
    }

    // Stops anything still live, then archives. Collects every failure
    // instead of stopping at the first, and returns them so the suite fails.
    async function cleanup(): Promise<string[]> {
        const errors: string[] = [];
        // Recover creates that may have committed without returning an id.
        // A name that can't be checked is reported so an operator can clean
        // it up by hand.
        for (const [name, type] of unresolvedCreates) {
            try {
                const { data } = await callExecute(client, 'experiments', 'listExperiments', { search: name, items: 10 });
                const rows: any[] = Array.isArray(data) ? data : (data?.experiments ?? data?.items ?? []);
                const match = rows.find(r => r?.name === name);
                if (match?.id) {
                    console.log(`\n  cleanup: recovered ${type} ${match.id} (${name}) created without an id in the response`);
                    createdEntities.set(Number(match.id), type);
                }
            } catch (err: any) {
                errors.push(`${type} "${name}" may exist on the backend but could not be looked up for cleanup: ${err?.message || err}`);
            }
        }
        for (const [id, type] of createdEntities) {
            try {
                const before = await readFields(id);
                if (before.archived === true) continue;
                // A stopped feature flag keeps state "running" with
                // feature_state "off", so for flags only feature_state "on"
                // (or development) means it still needs stopping.
                const live = type === 'feature'
                    ? before.feature_state === 'on' || before.state === 'development'
                    : before.state === 'running' || before.state === 'development';
                if (live) {
                    const reason = type === 'feature' ? 'implementation_issue' : 'hypothesis_iteration';
                    // A failed stop is reported but doesn't skip the archive.
                    try {
                        await transition('stopExperiment', id, { reason, note: 'lifecycle test cleanup' });
                    } catch (err: any) {
                        errors.push(`${type} ${id}: stop failed: ${err?.message || err}`);
                    }
                }
                await archiveAndConfirm(id);
            } catch (err: any) {
                errors.push(`${type} ${id}: ${err?.message || err}`);
            }
        }
        return errors;
    }

    try {
    await test('experiment lifecycle: create → ready → dev → start → stop → restart → full_on → stop → archive', async () => {
        const expId = await createAndConfirm('test', 'sdk_exp');

        // created → ready
        await callExecute(client, 'experiments', 'updateExperiment', { experimentId: expId, changes: { state: 'ready' } });
        const ready = await pollState(client, expId, 'ready');
        if (!ready.matched) throw new Error(`stuck in "${ready.observed}" after updateExperiment→ready (history: ${JSON.stringify(ready.history)})`);

        // ready → development
        await transition('developmentExperiment', expId, { note: 'sdk dev' });
        const dev = await pollState(client, expId, 'development');
        if (!dev.matched) throw new Error(`stuck in "${dev.observed}" after developmentExperiment (history: ${JSON.stringify(dev.history)})`);

        // development → running
        await transition('startExperiment', expId);
        const running = await pollState(client, expId, 'running');
        if (!running.matched) throw new Error(`stuck in "${running.observed}" after startExperiment (history: ${JSON.stringify(running.history)})`);

        // running → stopped
        await transition('stopExperiment', expId, { reason: 'hypothesis_iteration' });
        const stopped = await pollState(client, expId, 'stopped');
        if (!stopped.matched) throw new Error(`stuck in "${stopped.observed}" after stopExperiment (history: ${JSON.stringify(stopped.history)})`);

        // stopped → (restart spawns new experiment id) → running
        const restartResult = await transition('restartExperiment', expId, { reason: 'hypothesis_iteration' });
        const newId = restartResult.data?.newId
            ?? restartResult.data?.experiment?.id
            ?? restartResult.data?.id;
        if (!newId || newId === expId) {
            throw new Error(`restartExperiment did not return a new id. response: ${restartResult.text.slice(0, 400)}`);
        }
        createdEntities.set(newId, 'test');
        const runningAgain = await pollState(client, newId, 'running');
        if (!runningAgain.matched) throw new Error(`new experiment ${newId} stuck in "${runningAgain.observed}" after restart (history: ${JSON.stringify(runningAgain.history)})`);

        // running → full_on. NOTE: the backend doesn't actually transition the
        // `state` field to "full_on" — it stays "running" with full_on_at /
        // full_on_variant set on the underlying record. The catalog lists
        // "full_on" as a filter value for listExperiments but getExperiment
        // never returns it. So we verify the call succeeded (no error
        // response) and that's the contract.
        const fullOnResp = await transition('fullOnExperiment', newId, { variant: 1, note: 'sdk full on' });
        if (fullOnResp.text.toLowerCase().includes('error')) {
            throw new Error(`fullOnExperiment failed: ${fullOnResp.text.slice(0, 300)}`);
        }

        // full_on → stopped
        await transition('stopExperiment', newId, { reason: 'hypothesis_iteration' });
        const stoppedAgain = await pollState(client, newId, 'stopped');
        if (!stoppedAgain.matched) throw new Error(`new experiment ${newId} stuck in "${stoppedAgain.observed}" after stop (history: ${JSON.stringify(stoppedAgain.history)})`);

        // stopped → archived. Same caveat as full_on: archiveExperiment sets
        // `archived: true` on the record but the `state` field stays "stopped"
        // — there is no terminal "archived" state. Cleanup archives the first
        // iteration too and checks `archived` on both.
        await archiveAndConfirm(newId);

        console.log(`\n    experiment_id=${expId} restarted_id=${newId} progression OK`);
        process.stdout.write('    ');
    });

    await test('feature flag lifecycle: create → ready → dev → start → stop → archive', async () => {
        const flagId = await createAndConfirm('feature', 'sdk_flag');

        await callExecute(client, 'experiments', 'updateExperiment', { experimentId: flagId, changes: { state: 'ready' } });
        const ready = await pollState(client, flagId, 'ready');
        if (!ready.matched) throw new Error(`stuck in "${ready.observed}" after updateExperiment→ready (history: ${JSON.stringify(ready.history)})`);

        await transition('developmentExperiment', flagId, { note: 'sdk dev' });
        const dev = await pollState(client, flagId, 'development');
        if (!dev.matched) throw new Error(`stuck in "${dev.observed}" after developmentExperiment (history: ${JSON.stringify(dev.history)})`);

        await transition('startExperiment', flagId);
        const running = await pollState(client, flagId, 'running');
        if (!running.matched) throw new Error(`stuck in "${running.observed}" after startExperiment (history: ${JSON.stringify(running.history)})`);

        await transition('stopExperiment', flagId, { reason: 'implementation_issue' });
        // UI feature status uses feature_state: stopping turns it off while
        // the experiment state can remain running.
        const stopped = await pollState(client, flagId, 'off', POLL_DEFAULT_MAX_RETRIES, 'feature_state');
        if (!stopped.matched) throw new Error(`feature_state stuck in "${stopped.observed}" after stopExperiment (history: ${JSON.stringify(stopped.history)})`);

        await archiveAndConfirm(flagId);

        console.log(`\n    flag_id=${flagId} progression OK`);
        process.stdout.write('    ');
    });
    } finally {
        const cleanupErrors = await cleanup();
        if (cleanupErrors.length > 0) {
            results.push({ name: 'cleanup: stop and archive created entities', status: 'FAIL', error: cleanupErrors.join('; ') });
            console.log(`\n  cleanup FAILED:\n    ${cleanupErrors.join('\n    ')}`);
        } else {
            console.log(`\n  cleanup: archived ${[...createdEntities.keys()].join(', ') || 'nothing'}`);
        }
        await client.close();
    }

    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        console.log('\nFailed:');
        for (const r of results.filter(r => r.status === 'FAIL')) {
            console.log(`  - ${r.name}: ${r.error}`);
        }
    }

    return {
        success: failed === 0,
        message: `${passed} passed, ${failed} failed`,
        testCount: passed + failed,
        details: results,
    };
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
