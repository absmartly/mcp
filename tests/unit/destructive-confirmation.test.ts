import assert from 'node:assert';
import { setupTools, type ToolContext } from '../../src/tools';
import { registerLocalServer } from '../../src/local-registration';

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

function getLocalExecuteHandler(client: any, elicitResponse: any): { handler: Function; elicitCalls: Array<{ message: string }> } {
  const captured = new CapturedHandlers();
  const elicitCalls: Array<{ message: string }> = [];
  const fakeServer = {
    tool: (name: string, description: string, schema: any, _annotations: any, handler: Function) => {
      captured.tools.set(name, { handler, schema, description });
    },
    resource: () => {},
    prompt: () => {},
    server: {
      elicitInput: async (request: { message: string }) => { elicitCalls.push({ message: request.message }); return elicitResponse; },
    },
  } as any;
  const serverContext: any = {
    apiClient: client,
    endpoint: 'https://demo.absmartly.com',
    authType: 'API Key',
    currentUserId: null,
    entityWarnings: [],
    customFields: [],
    users: [], teams: [], applications: [], unitTypes: [], experimentTags: [], metrics: [], goals: [],
  };
  registerLocalServer(fakeServer, serverContext);
  const entry = captured.tools.get('execute_command');
  if (!entry) throw new Error('execute_command not registered');
  return { handler: entry.handler, elicitCalls };
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

  await asyncTest('no elicitConfirmation hook wired fails closed without executing the command', async () => {
    const client = makeApiClient();
    const { handler } = getExecuteHandler(client, undefined);
    const res = await handler(STOP_PARAMS);
    const text = res.content[0].text as string;
    assert.ok(/ask the user|confirm with the user|get (the )?user('s)? confirmation/i.test(text),
      `message must instruct the AI to get user confirmation first, got: ${text}`);
    assert.ok(text.includes('confirmed: true'), `message must still mention the confirmed:true retry mechanics, got: ${text}`);
    assert.strictEqual(client._stopCalls, 0, 'stopExperiment must NOT have been called when no elicitConfirmation hook is wired up');
  });

  await asyncTest('stdio registration routes destructive confirmation through the server elicitInput (accept -> executes)', async () => {
    const { handler, elicitCalls } = getLocalExecuteHandler(makeApiClient(), { action: 'accept', content: { confirm: 'yes' } });
    const targetExperimentId = 4242;
    const res = await handler({ ...STOP_PARAMS, params: { experimentId: targetExperimentId, reason: 'testing' } });
    assert.strictEqual(elicitCalls.length, 1, 'elicitInput must be called once for a destructive command');
    const message = elicitCalls[0].message;
    assert.ok(message.includes('experiments.stopExperiment'), `elicitation message must name the command, got: ${message}`);
    assert.ok(message.includes(`experimentId: ${targetExperimentId}`), `elicitation message must show which experiment is targeted, got: ${message}`);
    assert.ok(message.includes('reason: "testing"'), `elicitation message must show the param values, got: ${message}`);
    void res;
  });

  await asyncTest('stdio registration executes the command only when elicitInput is accepted with "yes"', async () => {
    const client = makeApiClient();
    const { handler } = getLocalExecuteHandler(client, { action: 'accept', content: { confirm: 'yes' } });
    await handler(STOP_PARAMS);
    assert.strictEqual(client._stopCalls, 1, 'stopExperiment should run after the user confirms via elicitInput');
  });

  await asyncTest('stdio registration does not execute when elicitInput is declined or answered otherwise', async () => {
    for (const response of [{ action: 'decline' }, { action: 'cancel' }, { action: 'accept', content: { confirm: 'no' } }]) {
      const client = makeApiClient();
      const { handler, elicitCalls } = getLocalExecuteHandler(client, response);
      await handler(STOP_PARAMS);
      assert.strictEqual(elicitCalls.length, 1, `elicitInput must be called for ${JSON.stringify(response)}`);
      assert.strictEqual(client._stopCalls, 0, `stopExperiment must NOT run for ${JSON.stringify(response)}`);
    }
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
