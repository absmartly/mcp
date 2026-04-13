#!/usr/bin/env node
/**
 * Integration Tests: API Client Listings
 *
 * Tests listing experiments, goals, and experiment tags via the API client.
 * Requires credentials via .env.local or --profile <name>.
 */

import { APIClient } from '@absmartly/cli/api-client';
import { FetchHttpClient } from '../../src/fetch-adapter.ts';
import { resolveTestCredentials, SKIP_MESSAGE } from './test-credentials.js';

function stripV1(endpoint) {
  return endpoint.endsWith('/v1') ? endpoint.slice(0, -3) : endpoint;
}

function buildClient(credentials) {
  const endpoint = stripV1(credentials.endpoint);
  const httpClient = new FetchHttpClient(endpoint, { authToken: credentials.apiKey, authType: 'api-key' });
  return new APIClient(httpClient);
}

export default async function runApiClientListingsTests() {
  const passed = [];
  const failed = [];

  async function test(name, fn) {
    try {
      await fn();
      passed.push({ name, status: 'PASS' });
    } catch (error) {
      failed.push({ name, status: 'FAIL', error: error.message });
    }
  }

  function assertTrue(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
  }

  const credentials = await resolveTestCredentials();
  if (!credentials) {
    return { success: true, testCount: 0, message: SKIP_MESSAGE, details: [] };
  }

  const client = buildClient(credentials);

  await test('list experiments returns array', async () => {
    const response = await client.listExperiments({ limit: 5, offset: 0 });
    const experiments = response.data || response;
    assertTrue(Array.isArray(experiments), 'Expected array of experiments');
  });

  await test('list experiments returns items with required fields', async () => {
    const response = await client.listExperiments({ limit: 5, offset: 0 });
    const experiments = response.data || response;
    if (experiments.length > 0) {
      const exp = experiments[0];
      const id = exp.id || exp.experiment_id;
      assertTrue(id != null, 'Experiment must have id');
      assertTrue(exp.name != null, 'Experiment must have name');
      assertTrue(exp.state != null, 'Experiment must have state');
    }
  });

  await test('list goals returns array', async () => {
    const response = await client.listGoals({ limit: 100, offset: 0 });
    const goals = response.data || response;
    assertTrue(Array.isArray(goals), 'Expected array of goals');
  });

  await test('list goals returns items with required fields', async () => {
    const response = await client.listGoals({ limit: 100, offset: 0 });
    const goals = response.data || response;
    if (goals.length > 0) {
      const goal = goals[0];
      const id = goal.id || goal.goal_id;
      assertTrue(id != null, 'Goal must have id');
      assertTrue(goal.name != null, 'Goal must have name');
    }
  });

  await test('list experiment tags returns array', async () => {
    const response = await client.listExperimentTags();
    const tags = response.data || response;
    assertTrue(Array.isArray(tags), 'Expected array of tags');
  });

  await test('list experiment tags returns items with required fields', async () => {
    const response = await client.listExperimentTags();
    const tags = response.data || response;
    if (tags.length > 0) {
      const tag = tags[0];
      assertTrue(tag.id != null, 'Tag must have id');
      assertTrue(tag.tag != null, 'Tag must have tag value');
    }
  });

  await test('list applications returns array', async () => {
    const response = await client.listApplications({ limit: 5, offset: 0 });
    const apps = response.data || response;
    assertTrue(Array.isArray(apps), 'Expected array of applications');
    assertTrue(apps.length > 0, 'Expected at least one application');
  });

  await test('list unit types returns array', async () => {
    const response = await client.listUnitTypes({ limit: 5, offset: 0 });
    const units = response.data || response;
    assertTrue(Array.isArray(units), 'Expected array of unit types');
    assertTrue(units.length > 0, 'Expected at least one unit type');
  });

  const details = [...passed, ...failed];
  const testCount = details.length;
  const success = failed.length === 0;

  return {
    success,
    testCount,
    message: success
      ? `${testCount} passed`
      : `${failed.length} failed, ${passed.length} passed`,
    details,
  };
}
