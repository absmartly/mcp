import assert from 'node:assert';
import { buildServerContext } from '../../src/server-context.js';

function makeMockApiClient(overrides: Record<string, () => Promise<any>> = {}) {
    return {
        getCurrentUser: overrides.getCurrentUser ?? (async () => ({ id: 42 })),
        listCustomSectionFields: overrides.listCustomSectionFields ?? (async () => []),
        listUsers: overrides.listUsers ?? (async () => [{ id: 1, first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' }]),
        listTeams: overrides.listTeams ?? (async () => [{ id: 2, name: 'Growth', member_count: 5 }]),
        listApplications: overrides.listApplications ?? (async () => [{ id: 3, name: 'Web', environment: 'prod' }]),
        listUnitTypes: overrides.listUnitTypes ?? (async () => [{ id: 4, name: 'user_id' }]),
        listExperimentTags: overrides.listExperimentTags ?? (async () => [{ id: 5, name: 'q1' }]),
        listMetrics: overrides.listMetrics ?? (async () => [{ id: 6, name: 'conversion' }]),
        listGoals: overrides.listGoals ?? (async () => [{ id: 7, name: 'signup' }]),
    } as any;
}

export default async function run() {
    let passed = 0;
    let failed = 0;
    const details: Array<{ name: string; status: string; error?: string }> = [];

    async function test(name: string, fn: () => Promise<void>) {
        try { await fn(); passed++; details.push({ name, status: 'PASS' }); }
        catch (e: any) { failed++; details.push({ name, status: 'FAIL', error: e.message }); }
    }

    await test('shapes users with trimmed full name and email description', async () => {
        const ctx = await buildServerContext(makeMockApiClient(), { endpoint: 'https://demo.absmartly.com', authType: 'API Key' });
        assert.strictEqual(ctx.users.length, 1);
        assert.strictEqual(ctx.users[0].name, 'Ada Lovelace');
        assert.strictEqual(ctx.users[0].description, 'ada@example.com');
    });

    await test('shapes teams with member_count fallback description', async () => {
        const ctx = await buildServerContext(makeMockApiClient(), { endpoint: 'https://demo.absmartly.com', authType: 'API Key' });
        assert.strictEqual(ctx.teams[0].description, '5 members');
    });

    await test('shapes applications with environment description', async () => {
        const ctx = await buildServerContext(makeMockApiClient(), { endpoint: 'https://demo.absmartly.com', authType: 'API Key' });
        assert.strictEqual(ctx.applications[0].description, 'Environment: prod');
    });

    await test('sets currentUserId from getCurrentUser', async () => {
        const ctx = await buildServerContext(makeMockApiClient(), { endpoint: 'https://demo.absmartly.com', authType: 'API Key' });
        assert.strictEqual(ctx.currentUserId, 42);
    });

    await test('collects a warning and continues when one entity fetch fails', async () => {
        const ctx = await buildServerContext(
            makeMockApiClient({ listMetrics: async () => { throw new Error('boom'); } }),
            { endpoint: 'https://demo.absmartly.com', authType: 'API Key' },
        );
        assert.strictEqual(ctx.metrics.length, 0);
        assert.ok(ctx.entityWarnings.some(w => w.includes('metrics')));
        assert.strictEqual(ctx.goals.length, 1, 'other entities still populate despite one failure');
    });

    await test('sets currentUserId to null and records a warning when getCurrentUser fails', async () => {
        const ctx = await buildServerContext(
            makeMockApiClient({ getCurrentUser: async () => { throw new Error('unauthorized'); } }),
            { endpoint: 'https://demo.absmartly.com', authType: 'API Key' },
        );
        assert.strictEqual(ctx.currentUserId, null);
        assert.ok(ctx.entityWarnings.some(w => w.includes('current user')));
    });

    await test('passes through endpoint and authType unchanged', async () => {
        const ctx = await buildServerContext(makeMockApiClient(), { endpoint: 'https://demo.absmartly.com', authType: 'OAuth JWT' });
        assert.strictEqual(ctx.endpoint, 'https://demo.absmartly.com');
        assert.strictEqual(ctx.authType, 'OAuth JWT');
    });

    return { success: failed === 0, message: `${passed} passed, ${failed} failed`, testCount: passed + failed, details };
}
