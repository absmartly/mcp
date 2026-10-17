// The absmartly://<entity>/{id} resource templates reach APIClient path
// methods, so their {id} must be a positive integer like any command ID.
import { ABsmartlyResources, resourceId } from '../../src/resources';

export default async function runTests() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];
  function assertEquals(actual: unknown, expected: unknown, name: string) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a === b) { passed++; details.push({ name, status: 'PASS' }); }
    else { failed++; details.push({ name, status: 'FAIL', error: `Expected ${b}, got ${a}` }); }
  }

  for (const [raw, expected] of [['7', 7], ['-1', undefined], ['0', undefined], ['1.5', undefined], ['1e400', undefined], ['%20', undefined], [' ', undefined], ['Infinity', undefined], [['9'], 9]] as const) {
    assertEquals(resourceId(raw), expected, `resourceId(${JSON.stringify(raw)})`);
  }

  // Drive the real templates with a fake server and client.
  const handlers = new Map<string, (uri: URL, variables: Record<string, unknown>) => Promise<any>>();
  const calls: Array<[string, unknown]> = [];
  const apiClient = new Proxy({}, {
    get: (_t, prop) => (typeof prop === 'string' ? async (id: unknown) => { calls.push([prop, id]); return { id }; } : undefined),
  });
  const mcpServer = {
    apiClient,
    server: {
      resource: (name: string, template: { uriTemplate?: { toString(): string } }, _meta: unknown, handler: any) => {
        if (typeof handler === 'function') handlers.set(String(template?.uriTemplate ?? name), handler);
      },
    },
  };
  const resources = new ABsmartlyResources(mcpServer as any);
  (resources as any).setupResourceTemplates();

  const experiment = [...handlers.entries()].find(([key]) => key.includes('experiments'))?.[1];
  assertEquals(typeof experiment, 'function', 'the experiment template is registered');
  if (experiment) {
    for (const raw of ['-1', '0', '1.5', '1e400', '%20']) {
      const result = await experiment(new URL(`absmartly://experiments/${raw}`), { id: raw });
      assertEquals(result.contents?.[0]?.text?.includes('Invalid experiment ID') ?? false, true, `absmartly://experiments/${raw} is refused`);
    }
    await experiment(new URL('absmartly://experiments/12'), { id: '12' });
  }
  assertEquals(calls, [['getExperiment', 12]], 'only the valid ID reaches the client');

  return { success: failed === 0, message: `${passed} passed, ${failed} failed`, testCount: passed + failed, details };
}
