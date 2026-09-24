import { setupTools, type ToolContext } from '../../src/tools';

class CapturedHandlers {
  tools = new Map<string, { handler: Function }>();
}
function makeMockServer(captured: CapturedHandlers) {
  return {
    tool: (name: string, _description: string, _schema: any, _annotations: any, handler: Function) => {
      captured.tools.set(name, { handler });
    },
  } as any;
}

function getExecuteHandler(client: any): Function {
  const captured = new CapturedHandlers();
  const ctx: ToolContext = {
    apiClient: client,
    endpoint: 'https://demo.absmartly.com',
    authType: 'api-key',
    entityWarnings: [],
    customFields: [],
    currentUserId: null,
  };
  setupTools(makeMockServer(captured), ctx);
  return captured.tools.get('execute_command')!.handler;
}

export default async function runTests() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];

  function assert(condition: boolean, name: string, error: string = 'Assertion failed') {
    if (condition) {
      passed++;
      details.push({ name, status: 'PASS' });
    } else {
      failed++;
      details.push({ name, status: 'FAIL', error });
    }
  }

  // A command that DOES declare items/page (listGoals) still gets the default injected — no regression.
  {
    let capturedCall: any;
    const client = { listGoals: async (opts: any) => { capturedCall = opts; return []; } } as any;
    const handler = getExecuteHandler(client);
    await handler({ group: 'goals', command: 'listGoals', params: {} });
    assert(capturedCall.items === 20, 'listGoals still gets default items=20 injected', JSON.stringify(capturedCall));
    assert(capturedCall.page === 1, 'listGoals still gets default page=1 injected', JSON.stringify(capturedCall));
  }

  // A command with params: [] (no declared items/page, e.g. listPermissions) does NOT get items/page injected.
  {
    let capturedCall: any;
    const client = { listPermissions: async (opts: any) => { capturedCall = opts; return []; } } as any;
    const handler = getExecuteHandler(client);
    await handler({ group: 'permissions', command: 'listPermissions', params: {} });
    assert(capturedCall === undefined || capturedCall.items === undefined,
      'listPermissions does not get an unsupported items key injected', JSON.stringify(capturedCall));
  }

  // A command with a single catch-all `params` object (listEvents) does NOT get top-level items/page injected.
  {
    let capturedCall: any;
    const client = { listEvents: async (opts: any) => { capturedCall = opts; return []; } } as any;
    const handler = getExecuteHandler(client);
    await handler({ group: 'events', command: 'listEvents', params: {} });
    assert(capturedCall === undefined || capturedCall.items === undefined,
      'listEvents does not get a top-level items key injected onto its catch-all params', JSON.stringify(capturedCall));
  }

  // An explicit params.limit still overrides the default for a command that supports items/page.
  {
    let capturedCall: any;
    const client = { listMetrics: async (opts: any) => { capturedCall = opts; return []; } } as any;
    const handler = getExecuteHandler(client);
    await handler({ group: 'metrics', command: 'listMetrics', params: {}, limit: 5 });
    assert(capturedCall.items === 5, 'explicit limit overrides the default for a supported command', JSON.stringify(capturedCall));
  }

  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: passed + failed,
    details,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  });
}
