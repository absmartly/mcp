import { setupTools, type ToolContext } from '../../src/tools';

const TEST_ENDPOINT = 'https://demo.absmartly.com';
const EXECUTE_COMMAND_TOOL = 'execute_command';
const FULL_DOC_HEADING = '## Usage with execute_command';
const ZERO_PARAM_PHRASE = 'takes no parameters';
const MAX_COMPACT_ERROR_CHARS = 1000;
const ERROR_PREVIEW_CHARS = 300;
const LONG_ERROR_PREVIEW_CHARS = 500;

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
    endpoint: TEST_ENDPOINT,
    authType: 'api-key',
    entityWarnings: [],
    customFields: [],
    currentUserId: null,
  };
  setupTools(makeMockServer(captured), ctx);
  return captured.tools.get(EXECUTE_COMMAND_TOOL)!.handler;
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

  // Unknown param on a command with several declared params: compact, no full doc markdown.
  {
    const client = {} as any;
    const handler = getExecuteHandler(client);
    const res = await handler({ group: 'goals', command: 'listGoals', params: { itemz: 5 } });
    const text = res.content[0].text as string;
    assert(text.includes('itemz'), 'error mentions the offending param name', text.slice(0, ERROR_PREVIEW_CHARS));
    assert(!text.includes(FULL_DOC_HEADING), 'error no longer embeds the full command doc markdown', text.slice(0, LONG_ERROR_PREVIEW_CHARS));
    assert(text.length < MAX_COMPACT_ERROR_CHARS, 'validation error response is compact', `got length ${text.length}`);
  }

  // Missing required param on getGoal: still names the required param and its type.
  {
    const client = {} as any;
    const handler = getExecuteHandler(client);
    const res = await handler({ group: 'goals', command: 'getGoal', params: {} });
    const text = res.content[0].text as string;
    assert(text.includes('"goalId"'), 'error mentions the specific missing required param name (goalId)', text.slice(0, ERROR_PREVIEW_CHARS));
    assert(!text.includes(FULL_DOC_HEADING), 'missing-required-param error also skips the full doc');
  }

  // A command with zero declared params still produces a sensible message (not blank/confusing) when given an unknown param.
  {
    const client = {} as any;
    const handler = getExecuteHandler(client);
    const res = await handler({ group: 'permissions', command: 'listPermissions', params: { bogus: true } });
    const text = res.content[0].text as string;
    assert(text.includes('bogus'), 'error for a zero-param command still names the bad param', text.slice(0, ERROR_PREVIEW_CHARS));
    assert(text.includes(ZERO_PARAM_PHRASE), 'error for a zero-param command uses formatParamSummary\'s exact phrase', text.slice(0, LONG_ERROR_PREVIEW_CHARS));
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
