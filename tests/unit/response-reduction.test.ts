import {
  reduceToBudget,
  clampText,
  enforceHardCap,
  SUMMARY_LADDER,
  RAW_LADDER,
  OMITTED_FIELD_KEY,
} from '../../src/response-reduction';

const TEST_BUDGET = 25_000;
const SMALL_BUDGET = 2_000;

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

  function parses(text: string): boolean {
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  }

  // Identity under budget: byte-identical to JSON.stringify(value, null, 2).
  {
    const value = [{ id: 1, name: 'www' }, { id: 2, name: 'app' }];
    const { text, report } = reduceToBudget(value, { budgetChars: TEST_BUDGET, ladder: SUMMARY_LADDER });
    assert(text === JSON.stringify(value, null, 2), 'value under budget is returned byte-identical');
    assert(report.reduced === false, 'report.reduced is false under budget');
  }

  // Huge top-level array: valid JSON, within budget, head preserved, omission marker present.
  {
    const value = Array.from({ length: 5000 }, (_, i) => ({ id: i, note: 'x'.repeat(50) }));
    const { text, report } = reduceToBudget(value, { budgetChars: TEST_BUDGET, ladder: SUMMARY_LADDER });
    assert(text.length <= TEST_BUDGET, 'huge array reduced within budget', `got ${text.length}`);
    assert(parses(text), 'reduced huge array is valid JSON');
    const parsed = JSON.parse(text);
    assert(parsed[0].id === 0, 'first element preserved intact');
    assert(/more items omitted/.test(text) && text.includes('5000 total'), 'array omission marker states total', text.slice(-200));
    assert(report.reduced && report.itemsOmitted > 0, 'report counts omitted items');
  }

  // Huge NESTED array (the case top-level pagination can't reach): outer ids survive.
  {
    const value = { id: 7, name: 'exp', data: { series: Array.from({ length: 10000 }, (_, i) => ({ t: i, v: i * 2 })) } };
    const { text } = reduceToBudget(value, { budgetChars: TEST_BUDGET, ladder: RAW_LADDER });
    const parsed = JSON.parse(text);
    assert(text.length <= TEST_BUDGET, 'nested huge array reduced within budget', `got ${text.length}`);
    assert(parsed.id === 7 && parsed.name === 'exp', 'top-level id/name preserved when a nested array is capped');
  }

  // Long plain string: clipped with a marker. JSON-in-JSON string: replaced wholesale, never half-cut.
  {
    const value = {
      id: 1,
      description: 'd'.repeat(60_000),
      variants: [{ name: 'control', variant: 0, config: JSON.stringify({ payload: 'x'.repeat(60_000) }) }],
    };
    const { text } = reduceToBudget(value, { budgetChars: TEST_BUDGET, ladder: RAW_LADDER });
    const parsed = JSON.parse(text);
    assert(/clipped from 60000 chars/.test(parsed.description), 'long plain string clipped with length marker', String(parsed.description).slice(-80));
    assert(/^\[JSON string omitted: \d+ chars\]$/.test(parsed.variants[0].config), 'JSON-in-JSON string replaced wholesale', parsed.variants[0].config);
    assert(parsed.variants[0].name === 'control', 'essential sibling key survives');
  }

  // Deep nesting beyond maxDepth collapses to a stub that keeps essential scalar keys.
  {
    let deep: any = { id: 'leaf', name: 'bottom', payload: 'y'.repeat(5000) };
    for (let i = 0; i < 20; i++) deep = { id: `level${i}`, experiment_id: i, child: deep, filler: 'z'.repeat(2000) };
    const { text } = reduceToBudget(deep, { budgetChars: SMALL_BUDGET, ladder: RAW_LADDER });
    assert(parses(text) && text.length <= SMALL_BUDGET, 'deep structure reduced to valid JSON within a small budget', `got ${text.length}`);
    assert(text.includes('"id": "level19"'), 'root id preserved');
    assert(text.includes(OMITTED_FIELD_KEY), 'collapsed subtrees carry the omitted-field marker');
  }

  // Very wide object (id-keyed map): keys capped, essential keys kept, _omitted counts the rest.
  {
    const value: Record<string, unknown> = { id: 99 };
    for (let i = 0; i < 10000; i++) value[`k${i}`] = 'v'.repeat(20);
    const { text } = reduceToBudget(value, { budgetChars: TEST_BUDGET, ladder: SUMMARY_LADDER });
    const parsed = JSON.parse(text);
    assert(parsed.id === 99, 'essential key kept in a wide object');
    assert(typeof parsed[OMITTED_FIELD_KEY] === 'string' && /more field/.test(parsed[OMITTED_FIELD_KEY]), 'wide object records omitted key count');
  }

  // getPowerMatrix shape: { matrix: number[][] }, first row intact.
  {
    const value = { matrix: Array.from({ length: 400 }, (_, r) => Array.from({ length: 400 }, (_, c) => r * 1000 + c)) };
    const { text } = reduceToBudget(value, { budgetChars: TEST_BUDGET, ladder: SUMMARY_LADDER });
    const parsed = JSON.parse(text);
    assert(text.length <= TEST_BUDGET, 'power matrix reduced within budget', `got ${text.length}`);
    assert(parsed.matrix[0][0] === 0 && parsed.matrix[0][1] === 1, 'first matrix row preserved');
  }

  // Pathological: forces the skeleton fallback — still valid JSON within budget.
  {
    const value = Array.from({ length: 2000 }, (_, i) => {
      const o: Record<string, string> = {};
      for (let k = 0; k < 500; k++) o[`field_${k}_${'n'.repeat(80)}`] = 's'.repeat(200);
      return o;
    });
    const { text } = reduceToBudget(value, { budgetChars: SMALL_BUDGET, ladder: RAW_LADDER });
    assert(parses(text) && text.length <= SMALL_BUDGET, 'pathological input still yields valid JSON within budget', `got ${text.length}`);
  }

  // Property loop: every shape x every budget x both ladders => parses and fits.
  {
    const shapes: unknown[] = [
      'x'.repeat(100_000),
      Array.from({ length: 3000 }, (_, i) => i),
      Array.from({ length: 3000 }, (_, i) => ({ id: i, tags: Array.from({ length: 50 }, (_, j) => `t${j}`) })),
      { a: { b: { c: { d: { e: { f: Array.from({ length: 5000 }, () => 'q'.repeat(30)) } } } } } },
    ];
    let allOk = true;
    let failure = '';
    for (const [si, shape] of shapes.entries()) {
      for (const budget of [SMALL_BUDGET, TEST_BUDGET]) {
        for (const ladder of [SUMMARY_LADDER, RAW_LADDER]) {
          const { text } = reduceToBudget(shape, { budgetChars: budget, ladder });
          if (!parses(text) || text.length > budget) {
            allOk = false;
            failure = `shape ${si}, budget ${budget}: length ${text.length}, parses ${parses(text)}`;
          }
        }
      }
    }
    assert(allOk, 'all shapes x budgets x ladders produce valid JSON within budget', failure);
  }

  // Compact indent option (used by the error path) is identity-compatible with JSON.stringify(e).
  {
    const value = { field: 'name', message: 'required' };
    const { text } = reduceToBudget(value, { budgetChars: TEST_BUDGET, ladder: RAW_LADDER, indent: 0 });
    assert(text === JSON.stringify(value), 'indent 0 matches compact JSON.stringify under budget');
  }

  // clampText: identity under limit, never exceeds limit over it.
  {
    assert(clampText('short', 100) === 'short', 'clampText is identity under limit');
    const clamped = clampText('w'.repeat(1000), 300);
    assert(clamped.length <= 300 && /clipped from 1000 chars/.test(clamped), 'clampText bounds and marks over-limit text', `got ${clamped.length}`);
  }

  // enforceHardCap: identity under limit; over limit cuts at a line boundary and never exceeds.
  {
    assert(enforceHardCap('a\nb', 100) === 'a\nb', 'enforceHardCap is identity under limit');
    const long = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n');
    const capped = enforceHardCap(long, 500);
    assert(capped.length <= 500, 'enforceHardCap never exceeds the limit', `got ${capped.length}`);
    assert(/line \d+\n\n\[output cut/.test(capped), 'enforceHardCap cuts at a line boundary', capped.slice(-80));
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
