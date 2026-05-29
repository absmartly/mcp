import { executeCommand } from '../../src/cli-catalog';

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

  function assertEquals(actual: unknown, expected: unknown, name: string) {
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expected);
    assert(actualStr === expectedStr, name, `Expected ${expectedStr}, got ${actualStr}`);
  }

  const calls: Array<{ method: string; args: unknown[] }> = [];
  const client = {
    createMetric: async (...args: unknown[]) => {
      calls.push({ method: 'createMetric', args });
      return { id: 10 };
    },
    getMetric: async (...args: unknown[]) => {
      calls.push({ method: 'getMetric', args });
      return { id: args[0], name: 'metric' };
    },
    updateMetric: async (...args: unknown[]) => {
      calls.push({ method: 'updateMetric', args });
      return { id: args[0] };
    },
    activateMetric: async (...args: unknown[]) => {
      calls.push({ method: 'activateMetric', args });
    },
    addMetricReviewComment: async (...args: unknown[]) => {
      calls.push({ method: 'addMetricReviewComment', args });
    },
  };

  await executeCommand(client as any, 'metrics', 'createMetric', {
    data: {
      name: 'orders',
      type: 'goal_count',
      description: 'Orders',
      goal_id: 42,
      owners: [{ user_id: 7 }],
    },
  });
  assertEquals(
    calls.at(-1),
    {
      method: 'createMetric',
      args: [
        {
          name: 'orders',
          type: 'goal_count',
          description: 'Orders',
          goal_id: 42,
          owners: [{ user_id: 7 }],
        },
      ],
    },
    'createMetric normalizes data.goal_id and owners'
  );

  await executeCommand(client as any, 'metrics', 'getMetric', { metricId: 123 });
  assertEquals(calls.at(-1), { method: 'getMetric', args: [123] }, 'getMetric maps metricId to id');

  await executeCommand(client as any, 'metrics', 'updateMetric', {
    metricId: 9,
    data: { name: 'new-name' },
  });
  assertEquals(
    calls.at(-1),
    { method: 'updateMetric', args: [9, { name: 'new-name' }] },
    'updateMetric maps metricId and flattens data'
  );

  await executeCommand(client as any, 'metrics', 'activateMetric', { metricId: 5, reason: 'ready' });
  assertEquals(
    calls.at(-1),
    { method: 'activateMetric', args: [5, 'ready'] },
    'activateMetric maps metricId to id'
  );

  await executeCommand(client as any, 'metrics', 'addMetricReviewComment', {
    metricId: 7,
    text: 'Looks good',
  });
  assertEquals(
    calls.at(-1),
    { method: 'addMetricReviewComment', args: [7, 'Looks good'] },
    'addMetricReviewComment maps text to message'
  );

  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: passed + failed,
    details,
  };
}
