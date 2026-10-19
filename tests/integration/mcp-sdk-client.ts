/**
 * Shared helpers for the deterministic MCP SDK suites (sdk-*.test.ts,
 * oauth-worker-flow.test.ts): an official-SDK client connected to the Worker
 * under test, tool-call helpers, and a small named-check recorder whose
 * result matches what tests/test-runner.js expects.
 *
 * Not a test file: it has no default export.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { workerUrl } from './gate.js';

export const SSE_PATH = '/sse';
export const MCP_PATH = '/mcp';
export const ENDPOINT_HEADER = 'x-absmartly-endpoint';
const CLIENT_VERSION = '1.0.0';
const STATE_POLL_INTERVAL_MS = 1_000;
const STATE_POLL_MAX_ATTEMPTS = 10;
const ERROR_SNIPPET_CHARS = 400;

export type Transport = 'sse' | 'mcp';
export type ToolResult = { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
export type CheckDetail = { name: string; status: 'PASS' | 'FAIL'; error?: string };
export type SuiteResult = { success: boolean; message: string; testCount: number; details: CheckDetail[] };

export function transportUrl(transport: Transport, base = workerUrl()): URL {
    return new URL(`${base}${transport === 'sse' ? SSE_PATH : MCP_PATH}`);
}

/** Connects an SDK client with arbitrary request headers over either transport. */
export async function connectClient(
    name: string,
    { transport = 'sse', headers = {}, url }: { transport?: Transport; headers?: Record<string, string>; url?: URL } = {}
): Promise<Client> {
    const target = url ?? transportUrl(transport);
    const requestInit = { headers };
    const sdkTransport = transport === 'sse'
        ? new SSEClientTransport(target, { requestInit })
        : new StreamableHTTPClientTransport(target, { requestInit });
    const client = new Client({ name, version: CLIENT_VERSION });
    await client.connect(sdkTransport);
    return client;
}

/** API-key client: the raw key in Authorization, the endpoint in x-absmartly-endpoint. */
export function connectApiKeyClient(
    name: string,
    credentials: { apiKey: string; endpoint: string },
    transport: Transport = 'sse'
): Promise<Client> {
    return connectClient(name, {
        transport,
        headers: { Authorization: credentials.apiKey, [ENDPOINT_HEADER]: credentials.endpoint },
    });
}

export function textOf(result: ToolResult): string {
    return result.content?.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n') ?? '';
}

export function jsonOf(text: string): any {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

// execute_command appends a pagination note after the JSON body of list results.
export function leadingJsonOf(text: string): any {
    const whole = jsonOf(text);
    if (whole !== undefined) return whole;
    const end = Math.max(text.lastIndexOf('\n]'), text.lastIndexOf('\n}'));
    return end === -1 ? undefined : jsonOf(text.slice(0, end + 2));
}

export async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ result: ToolResult; text: string }> {
    const result = await client.callTool({ name, arguments: args }) as ToolResult;
    return { result, text: textOf(result) };
}

/** execute_command that must succeed; returns the parsed JSON (if any) and the text. */
export async function execute(
    client: Client,
    group: string,
    command: string,
    params: Record<string, unknown> = {},
    extras: Record<string, unknown> = {}
): Promise<{ data: any; text: string }> {
    const { result, text } = await callTool(client, 'execute_command', { group, command, params, ...extras });
    if (result.isError || /^(Error executing |Param validation failed|Unknown command)/.test(text)) {
        throw new Error(`${group}.${command} failed: ${text.slice(0, ERROR_SNIPPET_CHARS)}`);
    }
    return { data: leadingJsonOf(text), text };
}

export function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

export function snippet(text: string): string {
    return text.slice(0, ERROR_SNIPPET_CHARS);
}

/** Polls getExperiment until `field` equals `expected`; returns the observed history on failure. */
export async function waitForField(
    client: Client,
    experimentId: number,
    field: string,
    expected: unknown,
    params: Record<string, unknown> = {}
): Promise<Record<string, any>> {
    const history: unknown[] = [];
    for (let attempt = 1; attempt <= STATE_POLL_MAX_ATTEMPTS; attempt++) {
        const { data } = await execute(client, 'experiments', 'getExperiment', { experimentId, ...params });
        const record = data?.experiment ?? data ?? {};
        history.push(record[field]);
        if (record[field] === expected) return record;
        if (attempt < STATE_POLL_MAX_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, STATE_POLL_INTERVAL_MS));
    }
    throw new Error(`experiment ${experimentId}: ${field} never became ${JSON.stringify(expected)} (history: ${JSON.stringify(history)})`);
}

/** Records named checks; each failure is kept and the suite carries on. */
export function createRecorder(title: string) {
    const details: CheckDetail[] = [];
    console.log(`\n${title}\n${'='.repeat(title.length)}`);
    return {
        details,
        section(name: string) {
            console.log(`\n-- ${name} --`);
        },
        async check(name: string, fn: () => Promise<void>): Promise<boolean> {
            try {
                await fn();
                details.push({ name, status: 'PASS' });
                console.log(`  PASS  ${name}`);
                return true;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                details.push({ name, status: 'FAIL', error: message });
                console.log(`  FAIL  ${name}: ${message}`);
                return false;
            }
        },
        fail(name: string, error: string) {
            details.push({ name, status: 'FAIL', error });
            console.log(`  FAIL  ${name}: ${error}`);
        },
        result(): SuiteResult {
            const failed = details.filter((detail) => detail.status === 'FAIL').length;
            const passed = details.length - failed;
            console.log(`\nResults: ${passed} passed, ${failed} failed`);
            return { success: failed === 0, message: `${passed} passed, ${failed} failed`, testCount: details.length, details };
        },
    };
}

export type ExperimentType = 'test' | 'feature';
const STOP_REASON: Record<ExperimentType, string> = { test: 'hypothesis_iteration', feature: 'implementation_issue' };
const LIVE_STATES = ['running', 'development'];
const FEATURE_ON = 'on';
const CLEANUP_LOOKUP_ITEMS = 10;

/**
 * Tracks every experiment a suite creates, so cleanup() can stop and archive
 * it even when a scenario fails part-way. Names of confirmed creates that
 * returned no id are looked up by name, since the backend may still have
 * committed them. cleanup() returns every failure instead of stopping at the
 * first, so the suite can fail on a leak.
 */
export function createEntityTracker(client: Client) {
    const created = new Map<number, ExperimentType>();
    const unresolved = new Map<string, ExperimentType>();

    async function readRecord(experimentId: number): Promise<Record<string, any>> {
        const { data } = await execute(client, 'experiments', 'getExperiment', {
            experimentId, show: ['feature_state', 'archived'],
        });
        return data?.experiment ?? data ?? {};
    }

    async function archiveAndConfirm(experimentId: number): Promise<void> {
        await execute(client, 'experiments', 'archiveExperiment', { experimentId }, { confirmed: true });
        const after = await readRecord(experimentId);
        if (after.archived !== true) throw new Error(`experiment ${experimentId} not archived (archived=${after.archived})`);
    }

    return {
        created,
        track(experimentId: number, type: ExperimentType) {
            created.set(experimentId, type);
        },
        expectCreate(name: string, type: ExperimentType) {
            unresolved.set(name, type);
        },
        resolveCreate(name: string, experimentId: number) {
            const type = unresolved.get(name) ?? 'test';
            unresolved.delete(name);
            created.set(experimentId, type);
        },
        readRecord,
        archiveAndConfirm,
        async cleanup(): Promise<string[]> {
            const errors: string[] = [];
            for (const [name, type] of unresolved) {
                try {
                    const { data } = await execute(client, 'experiments', 'listExperiments', { search: name, items: CLEANUP_LOOKUP_ITEMS });
                    const match = (Array.isArray(data) ? data : []).find((row: any) => row?.name === name);
                    if (match?.id) created.set(Number(match.id), type);
                } catch (err: any) {
                    errors.push(`${type} "${name}" may exist but could not be looked up: ${err?.message || err}`);
                }
            }
            for (const [id, type] of created) {
                try {
                    const before = await readRecord(id);
                    if (before.archived === true) continue;
                    const live = LIVE_STATES.includes(before.state) || (type === 'feature' && before.feature_state === FEATURE_ON);
                    if (live) {
                        await execute(client, 'experiments', 'stopExperiment',
                            { experimentId: id, reason: STOP_REASON[type], note: 'sdk test cleanup' }, { confirmed: true });
                    }
                    await archiveAndConfirm(id);
                } catch (err: any) {
                    errors.push(`${type} ${id}: ${err?.message || err}`);
                }
            }
            return errors;
        },
    };
}
