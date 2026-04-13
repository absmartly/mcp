import {
  ExperimentId,
  GoalId,
  MetricId,
  TeamId,
  UserId,
  ApplicationId,
  TrafficPercentage,
  JSONConfig,
  Timestamp,
  ProfileName,
} from '@absmartly/cli/api-client';

import { resolveByName } from '@absmartly/cli/api-client';

export default async function runTests(): Promise<{
  success: boolean;
  message: string;
  testCount: number;
  details: Array<{ name: string; status: string; error?: string }>;
}> {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];

  function assert(condition: boolean, name: string, error: string = 'Assertion failed'): void {
    if (condition) {
      passed++;
      details.push({ name, status: 'PASS' });
    } else {
      failed++;
      details.push({ name, status: 'FAIL', error });
    }
  }

  function assertEquals(actual: unknown, expected: unknown, name: string): void {
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expected);
    assert(actualStr === expectedStr, name, `Expected ${expectedStr}, got ${actualStr}`);
  }

  function assertThrows(fn: () => unknown, name: string, expectedMessagePart?: string): void {
    let threw = false;
    let errorMsg = '';
    try {
      fn();
    } catch (e) {
      threw = true;
      errorMsg = (e as Error).message;
    }
    assert(threw, `${name}: throws`, `Expected to throw but did not`);
    if (expectedMessagePart) {
      assert(errorMsg.includes(expectedMessagePart), `${name}: error contains "${expectedMessagePart}"`, `Got: ${errorMsg}`);
    }
  }

  // --- ExperimentId branded type ---

  {
    const id = ExperimentId(42);
    assertEquals(id, 42, 'ExperimentId: valid positive integer returns value');
  }

  {
    assertThrows(() => ExperimentId(0), 'ExperimentId(0)', 'positive integer');
    assertThrows(() => ExperimentId(-1), 'ExperimentId(-1)', 'positive integer');
    assertThrows(() => ExperimentId(1.5), 'ExperimentId(1.5)', 'integer');
    assertThrows(() => ExperimentId(NaN), 'ExperimentId(NaN)', 'integer');
  }

  // --- Other ID types follow same pattern ---

  {
    assertEquals(GoalId(1), 1, 'GoalId: valid');
    assertThrows(() => GoalId(0), 'GoalId(0)', 'positive');
    assertEquals(MetricId(5), 5, 'MetricId: valid');
    assertThrows(() => MetricId(-3), 'MetricId(-3)', 'positive');
    assertEquals(TeamId(10), 10, 'TeamId: valid');
    assertEquals(UserId(99), 99, 'UserId: valid');
    assertEquals(ApplicationId(7), 7, 'ApplicationId: valid');
  }

  // --- TrafficPercentage ---

  {
    assertEquals(TrafficPercentage(50), 50, 'TrafficPercentage: valid 50');
    assertEquals(TrafficPercentage(0), 0, 'TrafficPercentage: valid 0');
    assertEquals(TrafficPercentage(100), 100, 'TrafficPercentage: valid 100');
    assertThrows(() => TrafficPercentage(-1), 'TrafficPercentage(-1)', 'between 0 and 100');
    assertThrows(() => TrafficPercentage(101), 'TrafficPercentage(101)', 'between 0 and 100');
    assertThrows(() => TrafficPercentage(NaN), 'TrafficPercentage(NaN)', 'must be a number');
  }

  // --- JSONConfig ---

  {
    const valid = JSONConfig('{"key": "value"}');
    assertEquals(valid, '{"key": "value"}', 'JSONConfig: valid JSON object');
    assertThrows(() => JSONConfig('not json'), 'JSONConfig(invalid)', 'Invalid JSONConfig');
    assertThrows(() => JSONConfig('"string"'), 'JSONConfig(string)', 'must be a JSON object');
    assertThrows(() => JSONConfig('[1,2,3]'), 'JSONConfig(array)', 'must be a JSON object');
    assertThrows(() => JSONConfig('null'), 'JSONConfig(null)', 'must be a JSON object');
  }

  // --- Timestamp ---

  {
    assertEquals(Timestamp(0), 0, 'Timestamp: valid 0');
    assertEquals(Timestamp(1700000000000), 1700000000000, 'Timestamp: valid ms timestamp');
    assertThrows(() => Timestamp(-1), 'Timestamp(-1)', 'non-negative');
    assertThrows(() => Timestamp(1.5), 'Timestamp(1.5)', 'non-negative integer');
  }

  // --- ProfileName ---

  {
    assertEquals(ProfileName('default'), 'default', 'ProfileName: valid simple name');
    assertEquals(ProfileName('my-profile'), 'my-profile', 'ProfileName: valid with hyphens');
    assertEquals(ProfileName('test_123'), 'test_123', 'ProfileName: valid with underscores and numbers');
    assertThrows(() => ProfileName(''), 'ProfileName(empty)', 'cannot be empty');
    assertThrows(() => ProfileName('has spaces'), 'ProfileName(spaces)', 'Must contain only');
    assertThrows(() => ProfileName('__proto__'), 'ProfileName(__proto__)', 'Reserved');
    assertThrows(() => ProfileName('constructor'), 'ProfileName(constructor)', 'Reserved');
  }

  // --- resolveByName ---

  {
    const items = [
      { id: 1, name: 'web' },
      { id: 2, name: 'mobile' },
      { id: 3, name: 'api' },
    ];

    const byName = resolveByName(items, 'mobile', 'Application');
    assertEquals(byName.id, 2, 'resolveByName: finds by exact name');

    const byNameCaseInsensitive = resolveByName(items, 'WEB', 'Application');
    assertEquals(byNameCaseInsensitive.id, 1, 'resolveByName: case-insensitive match');

    const byId = resolveByName(items, '3', 'Application');
    assertEquals(byId.name, 'api', 'resolveByName: finds by numeric ID string');
  }

  {
    const items = [{ id: 1, name: 'web' }];
    assertThrows(
      () => resolveByName(items, 'nonexistent', 'Application'),
      'resolveByName(not found)',
      'not found'
    );
  }

  {
    const items = [
      { id: 1, name: 'test' },
      { id: 2, name: 'Test' },
    ];
    assertThrows(
      () => resolveByName(items, 'test', 'Application'),
      'resolveByName(ambiguous)',
      'Multiple'
    );
  }

  {
    const items = [{ id: 1, name: 'web' }];
    assertThrows(
      () => resolveByName(items, '999', 'Application'),
      'resolveByName(ID not found)',
      'not found'
    );
  }

  // --- buildQueryString helper pattern ---

  {
    function buildQueryString(params: Record<string, unknown>): string {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      }
      return searchParams.toString();
    }

    assertEquals(
      buildQueryString({ limit: 10, offset: 20 }),
      'limit=10&offset=20',
      'buildQueryString: basic params'
    );
    assertEquals(
      buildQueryString({ a: 1, b: undefined, c: null, d: 'hello' }),
      'a=1&d=hello',
      'buildQueryString: skips undefined and null'
    );
    assertEquals(
      buildQueryString({}),
      '',
      'buildQueryString: empty params returns empty string'
    );
    assertEquals(
      buildQueryString({ state: 'running,stopped' }),
      'state=running%2Cstopped',
      'buildQueryString: encodes special characters'
    );
  }

  // --- Feature flag payload pattern ---

  {
    function buildFeatureFlagPayload(name: string, variants?: Array<{ name: string; variant: number; config: string }>) {
      const defaultVariants = [
        { name: 'off', variant: 0, config: JSON.stringify({}) },
        { name: 'on', variant: 1, config: JSON.stringify({}) },
      ];
      return {
        name,
        type: 'feature',
        percentages: '50/50',
        variants: variants || defaultVariants,
        nr_variants: (variants || defaultVariants).length,
      };
    }

    const payload = buildFeatureFlagPayload('dark_mode');
    assertEquals(payload.type, 'feature', 'Feature flag payload: type is feature');
    assertEquals(payload.variants.length, 2, 'Feature flag payload: has on/off variants');
    assertEquals(payload.variants[0].name, 'off', 'Feature flag payload: variant 0 is off');
    assertEquals(payload.variants[1].name, 'on', 'Feature flag payload: variant 1 is on');
    assertEquals(payload.nr_variants, 2, 'Feature flag payload: nr_variants is 2');
  }

  // --- Percentages calculation pattern ---

  {
    function parsePercentages(percentageStr: string): number[] {
      return percentageStr.split('/').map(Number);
    }

    assertEquals(parsePercentages('50/50'), [50, 50], 'parsePercentages: 50/50');
    assertEquals(parsePercentages('33/33/34'), [33, 33, 34], 'parsePercentages: three-way split');
    assertEquals(parsePercentages('100'), [100], 'parsePercentages: single value');
    assertEquals(parsePercentages('25/25/25/25'), [25, 25, 25, 25], 'parsePercentages: four-way split');
  }

  // --- verifyApiKey pattern ---

  {
    async function verifyApiKey(baseUrl: string, apiKey: string): Promise<{ baseUrl: string; authHeader: string }> {
      const authHeader = apiKey.includes('.') && apiKey.split('.').length === 3
        ? `JWT ${apiKey}`
        : `Api-Key ${apiKey}`;

      return { baseUrl, authHeader };
    }

    const jwtResult = await verifyApiKey('https://example.com', 'header.payload.signature');
    assertEquals(jwtResult.authHeader, 'JWT header.payload.signature', 'verifyApiKey: detects JWT format');

    const apiKeyResult = await verifyApiKey('https://example.com', 'simple-api-key');
    assertEquals(apiKeyResult.authHeader, 'Api-Key simple-api-key', 'verifyApiKey: detects API key format');

    const dotButNotJwt = await verifyApiKey('https://example.com', 'key.with.dots.too.many');
    assertEquals(dotButNotJwt.authHeader, 'Api-Key key.with.dots.too.many', 'verifyApiKey: 4+ dots is not JWT');
  }

  const total = passed + failed;
  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: total,
    details
  };
}
