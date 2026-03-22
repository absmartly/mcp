import {
  API_CATALOG,
  API_CATEGORIES,
  searchCatalog,
  getCatalogByCategory,
  getMethodEntry,
  getCategorySummary,
} from '../../src/api-catalog';

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

  assert(API_CATALOG.length > 150, 'catalog has 150+ entries', `Got ${API_CATALOG.length}`);

  for (const entry of API_CATALOG) {
    assert(!!entry.method, `entry has method: ${entry.method}`, 'Missing method');
    assert(!!entry.category, `${entry.method} has category`, 'Missing category');
    assert(!!entry.description, `${entry.method} has description`, 'Missing description');
    assert(Array.isArray(entry.params), `${entry.method} has params array`, 'params not array');
    assert(!!entry.returns, `${entry.method} has returns`, 'Missing returns');
  }

  const methodNames = API_CATALOG.map(e => e.method);
  const uniqueNames = new Set(methodNames);
  assert(methodNames.length === uniqueNames.size, 'no duplicate method names', `${methodNames.length} total vs ${uniqueNames.size} unique`);

  for (const cat of API_CATEGORIES) {
    const count = API_CATALOG.filter(e => e.category === cat).length;
    assert(count > 0, `category "${cat}" has entries`, `${cat} has 0 entries`);
  }

  const metricResults = searchCatalog('createMetric');
  assert(metricResults.some(r => r.method === 'createMetric'), 'search finds createMetric');

  const archiveResults = searchCatalog('archive');
  assert(archiveResults.length > 5, 'search "archive" finds multiple results', `Got ${archiveResults.length}`);

  const teamMethods = getCatalogByCategory('teams');
  assert(teamMethods.length >= 5, 'teams category has 5+ methods', `Got ${teamMethods.length}`);

  const entry = getMethodEntry('listExperiments');
  assert(entry !== undefined, 'getMethodEntry finds listExperiments');
  assert(entry?.category === 'experiments', 'listExperiments is in experiments category');
  assert(entry?.params.length === 1, 'listExperiments has 1 options param', `Got ${entry?.params.length}`);
  assert(entry?.params[0]?.name === 'options', 'listExperiments param is options', `Got ${entry?.params[0]?.name}`);
  assert(entry?.params[0]?.type === 'object', 'listExperiments options is object type');

  assert(getMethodEntry('nonExistentMethod') === undefined, 'getMethodEntry returns undefined for unknown');

  const summary = getCategorySummary();
  assert(summary.length === API_CATEGORIES.length, 'summary has all categories', `Got ${summary.length} vs ${API_CATEGORIES.length}`);
  assert(summary.every(s => s.count > 0), 'every category in summary has methods');

  const dangerousMethods = API_CATALOG.filter(e => e.dangerous);
  assert(dangerousMethods.length > 0, 'some methods are marked dangerous');
  assert(dangerousMethods.some(m => m.method === 'deleteExperiment'), 'deleteExperiment is dangerous');

  for (const entry of API_CATALOG) {
    for (const param of entry.params) {
      assert(!!param.name, `${entry.method}.${param.name} has name`, 'Missing param name');
      assert(!!param.type, `${entry.method}.${param.name} has type`, 'Missing param type');
      assert(typeof param.required === 'boolean', `${entry.method}.${param.name} has boolean required`, 'required not boolean');
      assert(!!param.description, `${entry.method}.${param.name} has description`, 'Missing param description');
    }
  }

  const resolveEntry = getMethodEntry('resolveMetrics');
  assert(resolveEntry !== undefined, 'resolveMetrics exists in catalog');
  assert(resolveEntry?.category === 'resolve-helpers', 'resolveMetrics in resolve-helpers category');

  const corsEntry = getMethodEntry('getCorsOrigin');
  assert(corsEntry !== undefined, 'getCorsOrigin exists in catalog');

  const goalTagEntry = getMethodEntry('getGoalTag');
  assert(goalTagEntry !== undefined, 'getGoalTag exists in catalog');

  const metricTagEntry = getMethodEntry('getMetricTag');
  assert(metricTagEntry !== undefined, 'getMetricTag exists in catalog');

  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: passed + failed,
    details
  };
}
