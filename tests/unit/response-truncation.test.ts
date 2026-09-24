import { truncateResponseText, MAX_RESPONSE_CHARS } from '../../src/tools';

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

  // Short text passes through unchanged.
  {
    const short = 'hello world';
    const result = truncateResponseText(short, 'apps', 'listApps');
    assert(result === short, 'short text is returned unchanged');
  }

  // Text exactly at the limit is NOT truncated.
  {
    const exact = 'x'.repeat(MAX_RESPONSE_CHARS);
    const result = truncateResponseText(exact, 'apps', 'listApps');
    assert(result === exact, 'text exactly at MAX_RESPONSE_CHARS is not truncated', `length was ${result.length}`);
  }

  // Text one char over the limit IS truncated and carries a notice.
  {
    const over = 'x'.repeat(MAX_RESPONSE_CHARS + 1);
    const result = truncateResponseText(over, 'apps', 'listApps');
    assert(result.length < over.length, 'text over the limit is shortened');
    assert(result.includes('truncated'), 'truncated output includes a "truncated" notice', result.slice(-300));
    assert(result.includes('apps.listApps'), 'truncation notice names the group.command', result.slice(-300));
  }

  // Truncated output never itself exceeds a sane bound (notice + budget, not budget + notice).
  {
    const huge = 'x'.repeat(MAX_RESPONSE_CHARS * 10);
    const result = truncateResponseText(huge, 'statistics', 'getPowerMatrix');
    assert(result.length <= MAX_RESPONSE_CHARS, 'truncated output never exceeds the cap even for huge input', `got length ${result.length}`);
  }

  // The truncation notice suggests concrete next steps.
  {
    const over = 'x'.repeat(MAX_RESPONSE_CHARS + 1);
    const result = truncateResponseText(over, 'metrics', 'listMetrics');
    assert(/raw:\s*false|narrow|show|exclude|limit/i.test(result), 'notice suggests a concrete way to shrink the response', result.slice(-400));
  }

  // Integration test: execute_command truncates a huge response
  {
    const { setupTools } = await import('../../src/tools');

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

    // Create a mock client that simulates a huge response
    const hugeArray = Array.from({ length: 5000 }, (_, i) => ({ id: i, note: 'x'.repeat(50) }));
    const client = {
      listApplications: async () => hugeArray,
      listUnitTypes: async () => [{ id: 1, name: 'user_id', archived: false }],
      listMetrics: async () => [],
      listUsers: async () => [],
      listTeams: async () => [],
      listExperimentTags: async () => [],
      listCustomSectionFields: async () => [],
    } as any;

    const captured = new CapturedHandlers();
    const ctx = {
      apiClient: client,
      endpoint: 'https://demo.absmartly.com',
      authType: 'api-key',
      entityWarnings: [],
      customFields: [],
      currentUserId: null,
    };
    setupTools(makeMockServer(captured), ctx);
    const handler = captured.tools.get('execute_command')!.handler;

    const res = await handler({ group: 'apps', command: 'listApps', params: {} });
    const text = res.content[0].text as string;
    assert(text.length <= MAX_RESPONSE_CHARS, 'execute_command truncates a huge listApps response', `got length ${text.length}`);
    assert(text.includes('truncated'), 'execute_command response includes the truncation notice for a huge result');
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
