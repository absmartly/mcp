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
function getDiscoverHandler(): Function {
  const captured = new CapturedHandlers();
  const ctx: ToolContext = {
    apiClient: null,
    endpoint: 'https://demo.absmartly.com',
    authType: 'none',
    entityWarnings: [],
    customFields: [],
    currentUserId: null,
  };
  setupTools(makeMockServer(captured), ctx);
  return captured.tools.get('discover_commands')!.handler;
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

  // The largest group (experiments, ~59 commands) does not render every command's full param table.
  {
    const handler = getDiscoverHandler();
    const res = await handler({ group: 'experiments' });
    const text = res.content[0].text as string;
    const renderedFullEntries = (text.match(/\*\*Params:\*\*/g) || []).length;
    assert(renderedFullEntries <= 30, 'experiments group listing renders at most a bounded number of full command entries', `rendered ${renderedFullEntries} full entries`);
    assert(/more|narrow/i.test(text), 'bounded listing tells the user how to see the rest', text.slice(-400));
  }

  // A small group (apps) is unaffected — still shows every command in full.
  {
    const handler = getDiscoverHandler();
    const res = await handler({ group: 'apps' });
    const text = res.content[0].text as string;
    assert(text.includes('**Params:**'), 'small group still renders full command details');
    assert(!/more|narrow/i.test(text), 'small group listing has no truncation notice');
  }

  // A broad search matching many commands is also bounded.
  {
    const handler = getDiscoverHandler();
    const res = await handler({ search: 'list' }); // matches dozens of list* commands across groups
    const text = res.content[0].text as string;
    const renderedFullEntries = (text.match(/\*\*Params:\*\*/g) || []).length;
    assert(renderedFullEntries <= 30, 'broad search result is bounded to a reasonable number of full entries', `rendered ${renderedFullEntries} full entries`);
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
