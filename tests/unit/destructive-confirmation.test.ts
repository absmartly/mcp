import assert from 'node:assert';
import { setupTools, type ToolContext } from '../../src/tools';

class CapturedHandlers {
  tools = new Map<string, { handler: Function; schema: any; description: string }>();
}

function makeMockServer(captured: CapturedHandlers) {
  return {
    tool: (name: string, description: string, schema: any, _annotations: any, handler: Function) => {
      captured.tools.set(name, { handler, schema, description });
    },
  } as any;
}

function makeApiClient(): any {
  let stopCalls = 0;
  return {
    listApplications: async () => [],
    listUnitTypes: async () => [],
    listCustomSectionFields: async () => [],
    listMetrics: async () => [],
    listUsers: async () => [],
    listTeams: async () => [],
    listExperimentTags: async () => [],
    stopExperiment: async (_id: number, _reason: string, _note?: string) => { stopCalls++; return { id: _id, state: 'stopped' }; },
    get _stopCalls() { return stopCalls; },
  };
}

function getExecuteHandler(client: any, elicitConfirmation?: ToolContext['elicitConfirmation']): { handler: Function } {
  const captured = new CapturedHandlers();
  const ctx: ToolContext = {
    apiClient: client,
    endpoint: 'https://demo.absmartly.com',
    authType: 'api-key',
    email: 'test@example.com',
    entityWarnings: [],
    customFields: [],
    currentUserId: null,
    elicitConfirmation,
  };
  setupTools(makeMockServer(captured), ctx);
  const entry = captured.tools.get('execute_command');
  if (!entry) throw new Error('execute_command not registered');
  return { handler: entry.handler };
}

const STOP_PARAMS = {
  group: 'experiments',
  command: 'stopExperiment',
  params: { experimentId: 1, reason: 'testing' },
};

export default async function run() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];

  async function asyncTest(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; details.push({ name, status: 'PASS' }); }
    catch (e: any) { failed++; details.push({ name, status: 'FAIL', error: e.message }); }
  }

  await asyncTest('elicitation "not supported" fallback tells the AI to ask the user, not skip them', async () => {
    const client = makeApiClient();
    const elicitConfirmation = async () => { throw new Error('Method not supported by client'); };
    const { handler } = getExecuteHandler(client, elicitConfirmation);
    const res = await handler(STOP_PARAMS);
    const text = res.content[0].text as string;
    assert.ok(!/do not ask the user/i.test(text), `message must not instruct the AI to skip the user, got: ${text}`);
    assert.ok(/ask the user|confirm with the user|get (the )?user('s)? confirmation/i.test(text),
      `message must instruct the AI to get user confirmation first, got: ${text}`);
    assert.ok(text.includes('confirmed: true'), `message must still mention the confirmed:true retry mechanics, got: ${text}`);
    assert.strictEqual(client._stopCalls, 0, 'stopExperiment must NOT have been called without confirmation');
  });

  await asyncTest('elicitation accepted (user confirms) proceeds to execute the command', async () => {
    const client = makeApiClient();
    const elicitConfirmation = async () => true;
    const { handler } = getExecuteHandler(client, elicitConfirmation);
    const res = await handler(STOP_PARAMS);
    assert.strictEqual(client._stopCalls, 1, 'stopExperiment should have been called once');
    void res;
  });

  await asyncTest('elicitation declined (user says no) cancels without executing', async () => {
    const client = makeApiClient();
    const elicitConfirmation = async () => false;
    const { handler } = getExecuteHandler(client, elicitConfirmation);
    const res = await handler(STOP_PARAMS);
    const text = res.content[0].text as string;
    assert.ok(/not confirmed by user/i.test(text), `expected cancellation message, got: ${text}`);
    assert.strictEqual(client._stopCalls, 0, 'stopExperiment must NOT have been called when user declines');
  });

  await asyncTest('unexpected elicitation error fails closed with an explicit not-executed message', async () => {
    const client = makeApiClient();
    const elicitConfirmation = async () => { throw new Error('KV write failed'); };
    const { handler } = getExecuteHandler(client, elicitConfirmation);
    const res = await handler(STOP_PARAMS);
    const text = res.content[0].text as string;
    assert.ok(/was NOT executed/i.test(text), `expected fail-closed message, got: ${text}`);
    assert.strictEqual(client._stopCalls, 0, 'stopExperiment must NOT have been called on unexpected elicitation error');
  });

  await asyncTest('already-confirmed call executes without invoking elicitConfirmation', async () => {
    const client = makeApiClient();
    let elicitCalls = 0;
    const elicitConfirmation = async () => { elicitCalls++; return true; };
    const { handler } = getExecuteHandler(client, elicitConfirmation);
    const res = await handler({ ...STOP_PARAMS, confirmed: true });
    assert.strictEqual(elicitCalls, 0, 'elicitConfirmation must not be called when confirmed:true is already set');
    assert.strictEqual(client._stopCalls, 1, 'stopExperiment should have been called once');
    void res;
  });

  await asyncTest('non-dangerous command is unaffected even with no elicitConfirmation wired', async () => {
    const client = makeApiClient();
    (client as any).listApplications = async () => [{ id: 1, name: 'www', archived: false }];
    const { handler } = getExecuteHandler(client, undefined);
    const res = await handler({ group: 'apps', command: 'listApps', params: {} });
    const text = res.content[0].text as string;
    assert.ok(!/destructive action/i.test(text), `non-dangerous command must not mention destructive-action gating, got: ${text}`);
  });

  await asyncTest('local-server.ts wires elicitConfirmation into ToolContext using mcpServer.server.elicitInput', async () => {
    const fs = await import('node:fs/promises');
    const source = await fs.readFile(new URL('../../src/local-server.ts', import.meta.url), 'utf-8');
    assert.ok(/elicitConfirmation\s*:\s*async/.test(source),
      'local-server.ts must define elicitConfirmation on the ToolContext it builds');
    assert.ok(/mcpServer\.server\.elicitInput\(/.test(source),
      'local-server.ts must call mcpServer.server.elicitInput(...) the same way index.ts does');
  });

  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: passed + failed,
    details,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  });
}
