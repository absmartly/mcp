import { APIClient } from '@absmartly/cli/api-client';

class MockHttpClient {
  responses: Array<{ status: number; data: any; headers: Record<string, string>; shouldThrow?: boolean; errorMessage?: string }>;
  requests: Array<{ method: string; url: string; data?: any; params?: any; headers?: any }>;
  callIndex: number;

  constructor(responses: Array<any> = []) {
    this.responses = responses;
    this.requests = [];
    this.callIndex = 0;
  }

  async request(config: any) {
    this.requests.push(config);
    const response = this.responses[this.callIndex] || { status: 200, data: {}, headers: {} };
    this.callIndex++;
    if (response.shouldThrow) throw new Error(response.errorMessage);
    if (response.status >= 400) {
      const statusMessages: Record<number, string> = {
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Not found',
        429: 'Rate limit exceeded',
      };
      throw new Error(statusMessages[response.status] || `HTTP ${response.status}`);
    }
    return response;
  }
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

  function assertEquals(actual: unknown, expected: unknown, name: string) {
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expected);
    assert(actualStr === expectedStr, name, `Expected ${expectedStr}, got ${actualStr}`);
  }

  // --- listExperiments ---

  {
    const mock = new MockHttpClient([{
      status: 200,
      data: { experiments: [{ id: 1, name: 'test' }] },
      headers: {}
    }]);
    const client = new APIClient(mock);
    const result = await client.listExperiments();
    assertEquals(mock.requests[0].method, 'GET', 'listExperiments: sends GET');
    assertEquals(mock.requests[0].url, '/experiments', 'listExperiments: sends to /experiments');
    assertEquals(result, [{ id: 1, name: 'test' }], 'listExperiments: returns experiments array');
  }

  {
    const mock = new MockHttpClient([{
      status: 200,
      data: { experiments: [{ id: 1 }, { id: 2 }] },
      headers: {}
    }]);
    const client = new APIClient(mock);
    await client.listExperiments({ items: 10, page: 5, state: 'running' });
    const params = mock.requests[0].params;
    assertEquals(params.items, '10', 'listExperiments: passes items param as string');
    assertEquals(params.page, '5', 'listExperiments: passes page param as string');
    assertEquals(params.state, 'running', 'listExperiments: passes state param');
  }

  // --- getExperiment ---

  {
    const mock = new MockHttpClient([{
      status: 200,
      data: { experiment: { id: 42, name: 'my_exp' } },
      headers: {}
    }]);
    const client = new APIClient(mock);
    const result = await client.getExperiment(42);
    assertEquals(mock.requests[0].method, 'GET', 'getExperiment: sends GET');
    assertEquals(mock.requests[0].url, '/experiments/42', 'getExperiment: sends to /experiments/{id}');
    assertEquals(result, { id: 42, name: 'my_exp' }, 'getExperiment: returns experiment object');
  }

  // --- createExperiment ---

  {
    const experimentData = { name: 'new_exp', type: 'test' };
    const mock = new MockHttpClient([{
      status: 201,
      data: { experiment: { id: 1, name: 'new_exp' } },
      headers: {}
    }]);
    const client = new APIClient(mock);
    const result = await client.createExperiment(experimentData);
    assertEquals(mock.requests[0].method, 'POST', 'createExperiment: sends POST');
    assertEquals(mock.requests[0].url, '/experiments', 'createExperiment: sends to /experiments');
    assertEquals(mock.requests[0].data, experimentData, 'createExperiment: sends data in body');
    assertEquals(result, { id: 1, name: 'new_exp' }, 'createExperiment: returns created experiment');
  }

  // --- updateExperiment ---
  // updateExperiment first calls getExperiment, then PUTs the merged data

  {
    const updateData = { display_name: 'Updated Name' };
    const existingExperiment = { id: 5, name: 'original', display_name: 'Old Name' };
    const mock = new MockHttpClient([
      { status: 200, data: { experiment: existingExperiment }, headers: {} },
      { status: 200, data: { experiment: { id: 5, display_name: 'Updated Name' } }, headers: {} }
    ]);
    const client = new APIClient(mock);
    const result = await client.updateExperiment(5, updateData);
    assertEquals(mock.requests[0].method, 'GET', 'updateExperiment: first fetches existing experiment');
    assertEquals(mock.requests[0].url, '/experiments/5', 'updateExperiment: fetches from /experiments/{id}');
    assertEquals(mock.requests[1].method, 'PUT', 'updateExperiment: sends PUT');
    assertEquals(mock.requests[1].url, '/experiments/5', 'updateExperiment: PUTs to /experiments/{id}');
    assertEquals(result, { id: 5, display_name: 'Updated Name' }, 'updateExperiment: returns updated experiment');
  }

  // --- startExperiment ---

  {
    const mock = new MockHttpClient([{
      status: 200,
      data: { experiment: { id: 7, state: 'running' } },
      headers: {}
    }]);
    const client = new APIClient(mock);
    const result = await client.startExperiment(7);
    assertEquals(mock.requests[0].method, 'PUT', 'startExperiment: sends PUT');
    assertEquals(mock.requests[0].url, '/experiments/7/start', 'startExperiment: sends to /experiments/{id}/start');
    assertEquals(result, { id: 7, state: 'running' }, 'startExperiment: returns experiment');
  }

  // --- stopExperiment ---

  {
    const mock = new MockHttpClient([{
      status: 200,
      data: { experiment: { id: 7, state: 'stopped' } },
      headers: {}
    }]);
    const client = new APIClient(mock);
    await client.stopExperiment(7, 'done testing');
    assertEquals(mock.requests[0].method, 'PUT', 'stopExperiment: sends PUT');
    assertEquals(mock.requests[0].url, '/experiments/7/stop', 'stopExperiment: sends to /experiments/{id}/stop');
    assertEquals(mock.requests[0].data, { reason: 'done testing' }, 'stopExperiment: sends reason in body');
  }

  // --- Error handling: 401 ---

  {
    const mock = new MockHttpClient([{
      status: 401,
      data: { error: 'unauthorized' },
      headers: {}
    }]);
    const client = new APIClient(mock);
    let errorMsg = '';
    try {
      await client.getExperiment(1);
    } catch (e: any) {
      errorMsg = e.message;
    }
    assert(errorMsg.includes('Unauthorized'), 'Error 401: throws with Unauthorized message', `Got: ${errorMsg}`);
  }

  // --- Error handling: 404 ---

  {
    const mock = new MockHttpClient([{
      status: 404,
      data: {},
      headers: {}
    }]);
    const client = new APIClient(mock);
    let errorMsg = '';
    try {
      await client.getExperiment(999);
    } catch (e: any) {
      errorMsg = e.message;
    }
    assert(errorMsg.includes('Not found'), 'Error 404: throws with Not found message', `Got: ${errorMsg}`);
  }

  // --- Error handling: 403 ---

  {
    const mock = new MockHttpClient([{
      status: 403,
      data: {},
      headers: {}
    }]);
    const client = new APIClient(mock);
    let errorMsg = '';
    try {
      await client.listExperiments();
    } catch (e: any) {
      errorMsg = e.message;
    }
    assert(errorMsg.includes('Forbidden'), 'Error 403: throws with Forbidden message', `Got: ${errorMsg}`);
  }

  // --- Error handling: 429 ---

  {
    const mock = new MockHttpClient([{
      status: 429,
      data: {},
      headers: { 'retry-after': '30' }
    }]);
    const client = new APIClient(mock);
    let errorMsg = '';
    try {
      await client.listExperiments();
    } catch (e: any) {
      errorMsg = e.message;
    }
    assert(errorMsg.includes('Rate limit'), 'Error 429: throws with Rate limit message', `Got: ${errorMsg}`);
  }

  // --- Error handling: network error ---

  {
    const mock = new MockHttpClient([{
      shouldThrow: true,
      errorMessage: 'Connection refused'
    }]);
    const client = new APIClient(mock);
    let errorMsg = '';
    try {
      await client.listExperiments();
    } catch (e: any) {
      errorMsg = e.message;
    }
    assert(errorMsg.includes('Connection refused'), 'Network error: propagates error message', `Got: ${errorMsg}`);
  }

  // --- rawRequest ---

  {
    const mock = new MockHttpClient([{
      status: 200,
      data: { custom: 'response' },
      headers: {}
    }]);
    const client = new APIClient(mock);
    const result = await client.rawRequest('/custom/path', 'POST', { key: 'value' });
    assertEquals(mock.requests[0].method, 'POST', 'rawRequest: sends correct method');
    assertEquals(mock.requests[0].url, '/custom/path', 'rawRequest: sends correct path');
    assertEquals(mock.requests[0].data, { key: 'value' }, 'rawRequest: sends data');
    assertEquals(result, { custom: 'response' }, 'rawRequest: returns response data');
  }

  // --- rawRequest: path validation ---

  {
    const mock = new MockHttpClient([]);
    const client = new APIClient(mock);
    let threw = false;
    try {
      await client.rawRequest('https://evil.com/hack');
    } catch (e) {
      threw = true;
    }
    assert(threw, 'rawRequest: rejects absolute URLs');
  }

  {
    const mock = new MockHttpClient([]);
    const client = new APIClient(mock);
    let threw = false;
    try {
      await client.rawRequest('experiments');
    } catch (e) {
      threw = true;
    }
    assert(threw, 'rawRequest: rejects paths not starting with /');
  }

  {
    const mock = new MockHttpClient([]);
    const client = new APIClient(mock);
    let threw = false;
    try {
      await client.rawRequest('/experiments/../secret');
    } catch (e) {
      threw = true;
    }
    assert(threw, 'rawRequest: rejects path traversal');
  }

  // --- validateListResponse ---

  {
    const mock = new MockHttpClient([{
      status: 200,
      data: { experiments: 'not-an-array' },
      headers: {}
    }]);
    const client = new APIClient(mock);
    let threw = false;
    try {
      await client.listExperiments();
    } catch (e) {
      threw = true;
    }
    assert(threw, 'validateListResponse: throws when expected key is not an array');
  }

  // --- listGoals ---

  {
    const mock = new MockHttpClient([{
      status: 200,
      data: { goals: [{ id: 1, name: 'conversion' }] },
      headers: {}
    }]);
    const client = new APIClient(mock);
    const result = await client.listGoals();
    assertEquals(mock.requests[0].method, 'GET', 'listGoals: sends GET');
    assertEquals(mock.requests[0].url, '/goals', 'listGoals: sends to /goals');
    assertEquals(result, [{ id: 1, name: 'conversion' }], 'listGoals: returns goals array');
  }

  // --- listTeams ---

  {
    const mock = new MockHttpClient([{
      status: 200,
      data: { teams: [{ id: 1, name: 'platform' }] },
      headers: {}
    }]);
    const client = new APIClient(mock);
    const result = await client.listTeams();
    assertEquals(mock.requests[0].method, 'GET', 'listTeams: sends GET');
    assertEquals(mock.requests[0].url, '/teams', 'listTeams: sends to /teams');
    assertEquals(result, [{ id: 1, name: 'platform' }], 'listTeams: returns teams array');
  }

  // --- listApplications ---

  {
    const mock = new MockHttpClient([{
      status: 200,
      data: { applications: [{ id: 1, name: 'web' }] },
      headers: {}
    }]);
    const client = new APIClient(mock);
    const result = await client.listApplications();
    assertEquals(mock.requests[0].method, 'GET', 'listApplications: sends GET');
    assertEquals(mock.requests[0].url, '/applications', 'listApplications: sends to /applications');
    assertEquals(result, [{ id: 1, name: 'web' }], 'listApplications: returns applications array');
  }

  // --- listUnitTypes ---

  {
    const mock = new MockHttpClient([{
      status: 200,
      data: { unit_types: [{ id: 1, name: 'user_id' }] },
      headers: {}
    }]);
    const client = new APIClient(mock);
    const result = await client.listUnitTypes();
    assertEquals(mock.requests[0].method, 'GET', 'listUnitTypes: sends GET');
    assertEquals(mock.requests[0].url, '/unit_types', 'listUnitTypes: sends to /unit_types');
    assertEquals(result, [{ id: 1, name: 'user_id' }], 'listUnitTypes: returns unit_types array');
  }

  // --- listMetrics ---

  {
    const mock = new MockHttpClient([{
      status: 200,
      data: { metrics: [{ id: 1, name: 'revenue' }] },
      headers: {}
    }]);
    const client = new APIClient(mock);
    const result = await client.listMetrics();
    assertEquals(mock.requests[0].method, 'GET', 'listMetrics: sends GET');
    assertEquals(mock.requests[0].url, '/metrics', 'listMetrics: sends to /metrics');
    assertEquals(result, [{ id: 1, name: 'revenue' }], 'listMetrics: returns metrics array');
  }

  const total = passed + failed;
  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: total,
    details
  };
}
