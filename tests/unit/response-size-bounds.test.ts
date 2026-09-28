import {
  setupTools,
  MAX_RESPONSE_CHARS,
  REDUCTION_NOTICE_PREFIX,
  REDUCTION_NOTICE_RESERVE_CHARS,
  MAX_WARNINGS_SHOWN,
  MAX_WARNING_CHARS,
  formatResultMeta,
  formatReductionNotice,
  type ToolContext,
} from '../../src/tools';
import { getGroupSummary } from '../../src/cli-catalog';

const HUGE_COUNT = 1_000_000;

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
function jsonBody(text: string): string {
  const idx = text.indexOf(REDUCTION_NOTICE_PREFIX);
  return idx === -1 ? text : text.slice(0, idx);
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

  // Invariant: worst-case meta + notice reserve leaves a real body budget.
  {
    const worstWarnings = Array.from({ length: 10_000 }, () => 'w'.repeat(10_000));
    const meta = formatResultMeta({ warnings: worstWarnings, pagination: { page: HUGE_COUNT, items: HUGE_COUNT, hasMore: true } });
    const bodyBudget = MAX_RESPONSE_CHARS - meta.length - REDUCTION_NOTICE_RESERVE_CHARS;
    assert(bodyBudget >= MAX_RESPONSE_CHARS / 2, 'worst-case meta leaves at least half the cap for the body', `body budget ${bodyBudget}, meta ${meta.length}`);
    assert(meta.includes(`${10_000 - MAX_WARNINGS_SHOWN} more warnings omitted`), 'meta reports omitted warnings count');
    assert(meta.split('\n').every((l) => l.length <= MAX_WARNING_CHARS + 2), 'every warning line is individually bounded');
  }

  // Invariant: the notice for every catalog command fits its reserve even with extreme counts.
  {
    const extreme = {
      reduced: true, skeleton: true, originalChars: HUGE_COUNT * 1000, finalChars: 0,
      arraysCapped: HUGE_COUNT, itemsOmitted: HUGE_COUNT, stringsClipped: HUGE_COUNT, subtreesStubbed: HUGE_COUNT, keysOmitted: HUGE_COUNT,
    };
    let longest = 0;
    for (const g of getGroupSummary()) {
      for (const c of g.commands) {
        longest = Math.max(longest, formatReductionNotice(extreme, g.group, c).length);
      }
    }
    assert(longest <= REDUCTION_NOTICE_RESERVE_CHARS, 'reduction notice fits its reserve for every catalog command', `longest ${longest}`);
  }

  // Byte-identical: small summarized response renders exactly as before.
  {
    const apps = [{ id: 1, name: 'www' }, { id: 2, name: 'app' }];
    const handler = getExecuteHandler({ listApplications: async () => apps });
    const res = await handler({ group: 'apps', command: 'listApps', params: {} });
    assert(res.content[0].text === JSON.stringify(apps, null, 2), 'small response is byte-identical to the pre-change output');
  }

  // Huge unsummarized list: within cap, body is VALID JSON, first id kept, notice present.
  {
    const hugeArray = Array.from({ length: 5000 }, (_, i) => ({ id: i, note: 'x'.repeat(50) }));
    const handler = getExecuteHandler({ listApplications: async () => hugeArray });
    const res = await handler({ group: 'apps', command: 'listApps', params: {} });
    const text = res.content[0].text as string;
    assert(text.length <= MAX_RESPONSE_CHARS, 'huge listApps within cap', `got ${text.length}`);
    assert(text.includes(REDUCTION_NOTICE_PREFIX), 'huge listApps carries the reduction notice');
    let parsed: any;
    try { parsed = JSON.parse(jsonBody(text)); } catch { parsed = undefined; }
    assert(Array.isArray(parsed) && parsed[0].id === 0, 'reduced body parses as JSON and keeps the first record', jsonBody(text).slice(-200));
    assert(/apps\.listApps/.test(text), 'notice names group.command');
    assert(/array\(s\) capped/.test(text), 'notice for real ladder reduction still describes actual array capping', text.slice(-400));
    assert(!text.includes('reduced: .'), 'notice for real ladder reduction has no empty-description artifact');
  }

  // raw: true on a huge result: body parses as a CommandResult with `data`.
  {
    const hugeArray = Array.from({ length: 5000 }, (_, i) => ({ id: i, note: 'x'.repeat(50) }));
    const handler = getExecuteHandler({ listApplications: async () => hugeArray });
    const res = await handler({ group: 'apps', command: 'listApps', params: {}, raw: true });
    const text = res.content[0].text as string;
    let parsed: any;
    try { parsed = JSON.parse(jsonBody(text)); } catch { parsed = undefined; }
    assert(text.length <= MAX_RESPONSE_CHARS, 'raw huge listApps within cap', `got ${text.length}`);
    assert(parsed && Array.isArray(parsed.data) && parsed.data[0].id === 0, 'raw reduced body is a parseable CommandResult with data');
  }

  // raw: true drops derived rows (duplicate of data) first, and pagination survives at the end.
  {
    const experiments = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      name: `exp_${i}`,
      state: 'running',
      description: 'd'.repeat(3000),
      variants: [{ name: 'control', variant: 0, config: JSON.stringify({ blob: 'c'.repeat(3000) }) }],
    }));
    const handler = getExecuteHandler({ listExperiments: async () => experiments });
    const res = await handler({ group: 'experiments', command: 'listExperiments', params: {}, raw: true });
    const text = res.content[0].text as string;
    let parsed: any;
    try { parsed = JSON.parse(jsonBody(text)); } catch { parsed = undefined; }
    assert(text.length <= MAX_RESPONSE_CHARS, 'raw listExperiments within cap', `got ${text.length}`);
    assert(parsed && typeof parsed.rows === 'string' && /derived from `data`/.test(parsed.rows), 'raw reduction replaces derived rows with a placeholder', String(parsed?.rows).slice(0, 200));
    assert(parsed && parsed.data[19].id === 19, 'all 20 experiment ids kept once duplication is removed');
    assert(/More results available/.test(text), 'pagination guidance survives reduction');
    assert(parsed && parsed.pagination && parsed.pagination.hasMore === true, 'pagination object preserved inside the raw body');
  }

  // raw: true overflow driven purely by rows/data duplication: dropping the derived view alone
  // brings it under budget, so no ladder reduction of the remaining data is needed. The notice
  // must not report reducible's own (already small) size, nor emit an empty "reduced: ." description.
  {
    const experiments = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      name: `exp_${i}`,
      state: 'running',
      description: 'd'.repeat(1000),
    }));
    const handler = getExecuteHandler({ listExperiments: async () => experiments });
    const res = await handler({ group: 'experiments', command: 'listExperiments', params: {}, raw: true });
    const text = res.content[0].text as string;
    let parsed: any;
    try { parsed = JSON.parse(jsonBody(text)); } catch { parsed = undefined; }
    assert(text.length <= MAX_RESPONSE_CHARS, 'rows-duplication-only overflow within cap', `got ${text.length}`);
    assert(text.includes(REDUCTION_NOTICE_PREFIX), 'rows-duplication-only overflow still carries a reduction notice');
    assert(!text.includes('reduced: .'), 'notice has no empty-reduction-description artifact', text.slice(-400));
    assert(parsed && typeof parsed.rows === 'string' && /derived from `data`/.test(parsed.rows), 'derived rows view was dropped', String(parsed?.rows).slice(0, 200));
    assert(text.includes('the summarized `rows`/`detail` view was omitted since it duplicates `data`'), 'notice explains the derived-view drop', text.slice(-500));
    const noticeMatch = text.match(/reduced — (\d+) characters/);
    const reportedChars = noticeMatch ? Number(noticeMatch[1]) : 0;
    assert(reportedChars > text.length, 'notice reports the actual pre-drop total, which exceeds the final (reduced) output length', `reported ${reportedChars}, final ${text.length}`);
    assert(reportedChars > MAX_RESPONSE_CHARS, 'notice reports a total that genuinely exceeded the cap, not reducible\'s own small post-drop size', `reported ${reportedChars}`);
    assert(parsed && parsed.data.length === 20 && parsed.data[19].id === 19, 'all 20 records kept once the duplicate view is dropped');
  }

  // Warnings-driven overflow with a small actual JSON body: capping/truncating warnings alone
  // brings the response under budget, so the payload itself never needed reduction.
  {
    const client = {
      listApplications: async () => [{ id: 1, name: 'www', archived: false }],
      listUnitTypes: async () => [{ id: 1, name: 'user_id', archived: false }],
      listCustomSectionFields: async () => [],
      listMetrics: async () => [],
      listUsers: async () => [],
      listTeams: async () => [],
      listExperimentTags: async () => [],
      createExperiment: async () => ({ id: 1, name: 'warn_test', type: 'test' }),
    } as any;
    const fieldCount = 400;
    const fields = Array.from({ length: fieldCount }, (_, i) => `custom_unknown_field_${i}: value_${i}`).join('\n');
    const template = `---
name: warn_test
type: test
application: www
unit_type: user_id
${fields}
---
`;
    const handler = getExecuteHandler(client);
    const res = await handler({ group: 'experiments', command: 'createExperimentFromTemplate', params: { templateContent: template }, confirmed: true });
    const text = res.content[0].text as string;
    assert(text.length <= MAX_RESPONSE_CHARS, 'warnings-driven overflow within cap', `got ${text.length}`);
    assert(text.includes(REDUCTION_NOTICE_PREFIX), 'warnings-driven overflow carries a reduction notice');
    assert(!text.includes('reduced: .'), 'notice has no empty-reduction-description artifact', text.slice(-400));
    assert(/warnings were capped/.test(text), 'notice mentions warnings were affected', text.slice(-500));
    assert(/more warnings omitted/.test(text), 'capped warnings metadata is present in the body');
  }

  // Unit test: formatResultMeta with uncapped flag preserves all 25 warnings.
  {
    const warnings = Array.from({ length: 25 }, (_, i) => `warning_${i}`);
    const meta = formatResultMeta({ warnings }, false);
    assert(!meta.includes('omitted'), 'uncapped meta for 25 warnings has no omitted marker');
    for (let i = 0; i < 25; i++) {
      assert(meta.includes(`warning_${i}`), `uncapped meta includes warning_${i}`);
    }
  }

  // Unit test: formatResultMeta uncapped preserves long warning (>300 chars).
  {
    const longWarning = 'w'.repeat(500);
    const meta = formatResultMeta({ warnings: [longWarning] }, false);
    assert(meta.includes(longWarning), 'uncapped meta preserves full 500-char warning without clipping');
  }

  // Unit test: formatResultMeta with capped flag limits warnings to MAX_WARNINGS_SHOWN.
  {
    const warnings = Array.from({ length: 25 }, (_, i) => `warning_${i}`);
    const meta = formatResultMeta({ warnings }, true);
    assert(meta.includes('omitted'), 'capped meta for 25 warnings includes omitted marker');
    assert(meta.includes('5 more warnings omitted'), 'capped meta reports correct count of omitted warnings');
    assert(!meta.includes('warning_20'), 'capped meta does not include warning_20 (beyond cap)');
  }

  // Unit test: formatResultMeta with capped flag clips long warning to MAX_WARNING_CHARS.
  {
    const longWarning = 'w'.repeat(500);
    const meta = formatResultMeta({ warnings: [longWarning] }, true);
    assert(!meta.includes(longWarning), 'capped meta does not include full 500-char warning');
    assert(meta.includes('clipped from'), 'capped meta includes clipping indicator');
  }

  // Preview with a huge variant config: within cap, JSON valid, later variant still visible, no confirm instruction.
  {
    const hugeConfig = JSON.stringify({ payload: 'x'.repeat(MAX_RESPONSE_CHARS + 5000) });
    const template = `---
name: huge_preview_exp
type: test
application: www
unit_type: user_id
percentages: "50/50"
---

## Variants

### variant_0
name: control
config: ${hugeConfig}

---

### variant_1
name: treatment_tail_marker
config: {}
`;
    const client = {
      listApplications: async () => [{ id: 1, name: 'www', archived: false }],
      listUnitTypes: async () => [{ id: 1, name: 'user_id', archived: false }],
      listCustomSectionFields: async () => [],
      listMetrics: async () => [],
      listUsers: async () => [],
      listTeams: async () => [],
      listExperimentTags: async () => [],
    } as any;
    const handler = getExecuteHandler(client);
    const res = await handler({ group: 'experiments', command: 'createExperimentFromTemplate', params: { templateContent: template } });
    const text = res.content[0].text as string;
    const fence = text.match(/```json\n([\s\S]*?)\n```/);
    let payload: any;
    try { payload = fence ? JSON.parse(fence[1]) : undefined; } catch { payload = undefined; }
    assert(text.length <= MAX_RESPONSE_CHARS, 'huge preview within cap', `got ${text.length}`);
    assert(payload !== undefined, 'preview payload block is valid JSON');
    assert(text.includes('treatment_tail_marker'), 'variant AFTER the huge one is still shown (tail-slicing would lose it)');
    assert(!text.includes('to actually create the experiment'), 'reduced preview withholds the confirm instruction');
    assert(/do not/i.test(text) && /omitted|clipped/i.test(text), 'reduced preview says it is incomplete and what was reduced', text.slice(-500));
  }

  // Preview that fits: unchanged, confirm instruction present.
  {
    const template = `---
name: small_preview_exp
type: test
application: www
unit_type: user_id
---
`;
    const client = {
      listApplications: async () => [{ id: 1, name: 'www', archived: false }],
      listUnitTypes: async () => [{ id: 1, name: 'user_id', archived: false }],
      listCustomSectionFields: async () => [],
      listMetrics: async () => [],
      listUsers: async () => [],
      listTeams: async () => [],
      listExperimentTags: async () => [],
    } as any;
    const handler = getExecuteHandler(client);
    const res = await handler({ group: 'experiments', command: 'createExperimentFromTemplate', params: { templateContent: template } });
    const text = res.content[0].text as string;
    assert(text.includes('to actually create the experiment'), 'small preview keeps the confirm instruction');
    assert(!text.includes('omitted'), 'small preview is not reduced');
  }

  // Verify the huge-payload test still withholds confirm instruction (reduction path still works).
  {
    const hugeConfig = JSON.stringify({ payload: 'x'.repeat(MAX_RESPONSE_CHARS + 5000) });
    const template = `---
name: huge_preview_reduction_check
type: test
application: www
unit_type: user_id
percentages: "50/50"
---

## Variants

### variant_0
name: control
config: ${hugeConfig}

---

### variant_1
name: treatment_tail_check
config: {}
`;
    const client = {
      listApplications: async () => [{ id: 1, name: 'www', archived: false }],
      listUnitTypes: async () => [{ id: 1, name: 'user_id', archived: false }],
      listCustomSectionFields: async () => [],
      listMetrics: async () => [],
      listUsers: async () => [],
      listTeams: async () => [],
      listExperimentTags: async () => [],
    } as any;
    const handler = getExecuteHandler(client);
    const res = await handler({ group: 'experiments', command: 'createExperimentFromTemplate', params: { templateContent: template } });
    const text = res.content[0].text as string;
    assert(!text.includes('to actually create the experiment'), 'huge-payload preview still withholds confirm (phase-2 reduction works)');
    assert(/do not/i.test(text) && /omitted|clipped/i.test(text), 'huge-payload preview still shows incomplete notice');
  }

  // Error with a huge JSON error body: within cap, HTTP status and error head still shown.
  {
    const client = {
      listApplications: async () => {
        const err: any = new Error('API request failed');
        err.statusCode = 500;
        err.response = JSON.stringify({ error: 'x'.repeat(MAX_RESPONSE_CHARS + 5000) });
        throw err;
      },
    } as any;
    const handler = getExecuteHandler(client);
    const res = await handler({ group: 'apps', command: 'listApps', params: {} });
    const text = res.content[0].text as string;
    assert(text.length <= MAX_RESPONSE_CHARS, 'huge error body within cap', `got ${text.length}`);
    assert(text.includes('HTTP Status: 500'), 'status line preserved');
    assert(/clipped from \d+ chars/.test(text), 'oversized error string is marked as clipped');
  }

  // Error with thousands of validation errors: first N shown, rest counted.
  {
    const client = {
      listApplications: async () => {
        const err: any = new Error('Validation failed');
        err.statusCode = 422;
        err.response = { errors: Array.from({ length: 5000 }, (_, i) => ({ field: `f${i}`, message: 'm'.repeat(100) })) };
        throw err;
      },
    } as any;
    const handler = getExecuteHandler(client);
    const res = await handler({ group: 'apps', command: 'listApps', params: {} });
    const text = res.content[0].text as string;
    assert(text.length <= MAX_RESPONSE_CHARS, 'many validation errors within cap', `got ${text.length}`);
    assert(text.includes('"field":"f0"'), 'first validation error shown in compact JSON as before');
    assert(/more validation errors omitted/.test(text), 'omitted validation error count reported');
  }

  // Small error with 30 validation errors: all 30 shown (fast path not triggered capping).
  {
    const client = {
      listApplications: async () => {
        const err: any = new Error('Bad');
        err.statusCode = 400;
        err.response = { errors: Array.from({ length: 30 }, (_, i) => `field_${i} is required`) };
        throw err;
      },
    } as any;
    const handler = getExecuteHandler(client);
    const res = await handler({ group: 'apps', command: 'listApps', params: {} });
    const text = res.content[0].text as string;
    assert(text.length <= MAX_RESPONSE_CHARS, 'small error with 30 items within cap', `got ${text.length}`);
    for (let i = 0; i < 30; i++) {
      assert(text.includes(`field_${i} is required`), `all 30 errors shown (fast path): error_${i} present`);
    }
    assert(!text.includes('more validation errors omitted'), 'fast path: no omit marker when all fit');
  }

  // Small error: byte-identical format.
  {
    const client = {
      listApplications: async () => {
        const err: any = new Error('Bad');
        err.statusCode = 400;
        err.response = { errors: ['name is required'] };
        throw err;
      },
    } as any;
    const handler = getExecuteHandler(client);
    const res = await handler({ group: 'apps', command: 'listApps', params: {} });
    assert(res.content[0].text === 'Error executing apps.listApps: Bad\nHTTP Status: 400\nValidation errors:\n  - name is required', 'small error output unchanged', res.content[0].text);
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
