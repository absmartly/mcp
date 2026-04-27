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

function makeApiClient(opts: {
  applications?: any[];
  unitTypes?: any[];
  customSectionFields?: any[];
  onCreateExperiment?: (data: any) => any;
}): any {
  let createExperimentCalls = 0;
  const client = {
    listApplications: async () => opts.applications ?? [{ id: 1, name: 'www', archived: false }],
    listUnitTypes: async () => opts.unitTypes ?? [{ id: 1, name: 'user_id', archived: false }],
    listCustomSectionFields: async () => opts.customSectionFields ?? [],
    listMetrics: async () => [],
    listUsers: async () => [],
    listTeams: async () => [],
    listExperimentTags: async () => [],
    createExperiment: async (data: any) => {
      createExperimentCalls++;
      const result = opts.onCreateExperiment ? opts.onCreateExperiment(data) : { id: 99, name: data.name, type: data.type };
      return result;
    },
    get _createExperimentCalls() { return createExperimentCalls; },
  };
  return client;
}

const MIN_TEMPLATE = `---
name: test_exp
type: test
application: www
unit_type: user_id
percentages: "50/50"
---

## Variants

### variant_0
name: control
config: {}

---

### variant_1
name: treatment
config: {}
`;

async function callExecute(handler: Function, params: any) {
  return await handler(params);
}

export default async function run() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];

  async function asyncTest(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; details.push({ name, status: 'PASS' }); }
    catch (e: any) { failed++; details.push({ name, status: 'FAIL', error: e.message }); }
  }

  function getExecuteHandler(client: any): Function {
    const captured = new CapturedHandlers();
    const ctx: ToolContext = {
      apiClient: client,
      endpoint: 'https://demo.absmartly.com',
      authType: 'api-key',
      email: 'test@example.com',
      entityWarnings: [],
      customFields: [],
      currentUserId: null,
    };
    setupTools(makeMockServer(captured), ctx);
    const entry = captured.tools.get('execute_command');
    if (!entry) throw new Error('execute_command not registered');
    return entry.handler;
  }

  await asyncTest('createExperimentFromTemplate without confirmed returns a preview, does NOT create', async () => {
    const client = makeApiClient({});
    const handler = getExecuteHandler(client);
    const res = await callExecute(handler, {
      group: 'experiments',
      command: 'createExperimentFromTemplate',
      params: { templateContent: MIN_TEMPLATE },
    });
    const text = res.content[0].text as string;
    assert.ok(text.includes('Preview'), `expected preview marker, got: ${text.slice(0, 300)}`);
    assert.ok(text.includes('NOT YET created'), `expected explicit non-creation marker, got: ${text.slice(0, 300)}`);
    assert.ok(text.includes('confirmed: true'), 'preview must instruct the model to call again with confirmed:true');
    assert.strictEqual(client._createExperimentCalls, 0, 'createExperiment must NOT have been called for the preview');
  });

  await asyncTest('preview includes the resolved JSON payload (name→ID resolution applied)', async () => {
    const client = makeApiClient({
      applications: [{ id: 42, name: 'www', archived: false }],
      unitTypes: [{ id: 7, name: 'user_id', archived: false }],
    });
    const handler = getExecuteHandler(client);
    const res = await callExecute(handler, {
      group: 'experiments',
      command: 'createExperimentFromTemplate',
      params: { templateContent: MIN_TEMPLATE },
    });
    const text = res.content[0].text as string;
    assert.ok(text.includes('"application_id": 42'),
      `expected resolved application_id=42 in preview, got: ${text.slice(0, 600)}`);
    assert.ok(text.includes('"unit_type_id": 7'),
      `expected resolved unit_type_id=7 in preview, got: ${text.slice(0, 600)}`);
  });

  await asyncTest('createExperimentFromTemplate with confirmed:true actually creates', async () => {
    const client = makeApiClient({});
    const handler = getExecuteHandler(client);
    const res = await callExecute(handler, {
      group: 'experiments',
      command: 'createExperimentFromTemplate',
      params: { templateContent: MIN_TEMPLATE },
      confirmed: true,
    });
    assert.strictEqual(client._createExperimentCalls, 1, 'createExperiment should have been called once');
    const text = res.content[0].text as string;
    assert.ok(!text.includes('Preview'), 'response after confirmed:true should not be a preview');
    // The mocked createExperiment returns { id: 99, name: 'test_exp', type: 'test' };
    // the response should surface those so the model can echo the created entity to the user.
    assert.ok(text.includes('99'),
      `expected created experiment id (99) in response, got: ${text.slice(0, 300)}`);
    assert.ok(text.includes('test_exp'),
      `expected created experiment name (test_exp) in response, got: ${text.slice(0, 300)}`);
  });

  await asyncTest('empty templateContent without confirmed → explicit error, no creation', async () => {
    const client = makeApiClient({});
    const handler = getExecuteHandler(client);
    const res = await callExecute(handler, {
      group: 'experiments',
      command: 'createExperimentFromTemplate',
      params: { templateContent: '   \n  \n' },
    });
    const text = res.content[0].text as string;
    assert.ok(/empty/i.test(text), `expected empty-template error, got: ${text.slice(0, 300)}`);
    assert.strictEqual(client._createExperimentCalls, 0, 'empty template must not fall through to creation');
  });

  await asyncTest('preview surfaces parse errors instead of creating', async () => {
    const client = makeApiClient({});
    const handler = getExecuteHandler(client);
    const res = await callExecute(handler, {
      group: 'experiments',
      command: 'createExperimentFromTemplate',
      // Reference an application that doesn't exist — buildPayloadFromTemplate throws.
      params: { templateContent: MIN_TEMPLATE.replace('application: www', 'application: nonexistent_app_xyz') },
    });
    const text = res.content[0].text as string;
    assert.ok(/Failed to parse\/resolve template/i.test(text),
      `expected parse/resolve failure message, got: ${text.slice(0, 300)}`);
    assert.strictEqual(client._createExperimentCalls, 0, 'createExperiment must NOT have been called when resolution fails');
  });

  await asyncTest('preview-then-confirm does not affect non-template commands', async () => {
    // listApplications has no template — should pass through normally even without confirmed.
    const client = makeApiClient({});
    let listed = false;
    (client as any).listApplications = async () => { listed = true; return [{ id: 1, name: 'www', archived: false }]; };
    const handler = getExecuteHandler(client);
    const res = await callExecute(handler, {
      group: 'apps',
      command: 'listApps',
      params: {},
    });
    assert.ok(listed, 'unrelated command should run, not return preview');
    const text = res.content[0].text as string;
    assert.ok(!text.includes('Preview — experiment NOT YET created'),
      'preview gate must only fire for createExperimentFromTemplate');
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
