#!/usr/bin/env node
/**
 * Integration Tests: API Client Experiment Lifecycle
 *
 * Tests the full experiment lifecycle via the API client:
 *   create → ready → running → stopped
 *
 * Requires credentials via .env.local or --profile <name>.
 * Created experiments are archived after each test run.
 */

import { APIClient } from '@absmartly/cli/api-client';
import { FetchHttpClient } from '../../src/fetch-adapter.ts';
import { resolveTestCredentials, SKIP_MESSAGE } from './test-credentials.js';

const TEST_EXPERIMENT_PREFIX = 'mcp_integration_test_lifecycle_';

function stripV1(endpoint) {
  return endpoint.endsWith('/v1') ? endpoint.slice(0, -3) : endpoint;
}

function buildClient(credentials) {
  const endpoint = stripV1(credentials.endpoint);
  const httpClient = new FetchHttpClient(endpoint, { authToken: credentials.apiKey, authType: 'api-key' });
  return new APIClient(httpClient);
}

export default async function runApiClientExperimentLifecycleTests() {
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

  function assertEquals(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(message || `Expected ${expected}, got ${actual}`);
    }
  }

  const credentials = resolveTestCredentials();
  if (!credentials) {
    return { success: true, testCount: 0, message: SKIP_MESSAGE, details: [] };
  }

  const client = buildClient(credentials);

  // Lookup prerequisite data once
  let applicationId = null;
  let unitTypeId = null;

  await test('fetch first application', async () => {
    const response = await client.listApplications({ limit: 1, offset: 0 });
    const apps = response.data || response;
    assertTrue(apps && apps.length > 0, 'At least one application required');
    applicationId = apps[0].id || apps[0].application_id;
    assertTrue(applicationId != null, 'Application must have id');
  });

  await test('fetch first unit type', async () => {
    const response = await client.listUnitTypes({ limit: 1, offset: 0 });
    const units = response.data || response;
    assertTrue(units && units.length > 0, 'At least one unit type required');
    unitTypeId = units[0].id || units[0].unit_type_id;
    assertTrue(unitTypeId != null, 'Unit type must have id');
  });

  if (!applicationId || !unitTypeId) {
    const details = [...passed, ...failed];
    return {
      success: false,
      testCount: details.length,
      message: 'Prerequisites not met: missing application or unit type',
      details,
    };
  }

  const experimentName = `${TEST_EXPERIMENT_PREFIX}${Date.now()}`;
  let experimentId = null;

  await test('create experiment in created state', async () => {
    const data = {
      name: experimentName,
      applications: [{ application_id: applicationId }],
      unit_type: { unit_type_id: unitTypeId },
      type: 'test',
      percentage_of_traffic: 100,
      variants: [
        { variant: 0, name: 'Control' },
        { variant: 1, name: 'Treatment' },
      ],
    };
    const experiment = await client.createExperiment(data);
    experimentId = experiment.id || experiment.experiment_id;
    assertTrue(experimentId != null, 'Created experiment must have id');
    assertEquals(experiment.name, experimentName, 'Experiment name must match');
    assertEquals(experiment.state, 'created', 'New experiment must be in created state');
  });

  if (experimentId) {
    await test('get experiment by id', async () => {
      const experiment = await client.getExperiment(experimentId);
      assertEquals(experiment.id || experiment.experiment_id, experimentId, 'Id must match');
      assertEquals(experiment.state, 'created', 'State must be created');
    });

    await test('transition experiment to ready state', async () => {
      const updated = await client.updateExperiment(experimentId, { state: 'ready' });
      assertEquals(updated.state, 'ready', 'State must be ready after update');
    });

    await test('start experiment (ready to running)', async () => {
      const updated = await client.startExperiment(experimentId);
      assertEquals(updated.state, 'running', 'State must be running after start');
    });

    await test('stop experiment (running to stopped)', async () => {
      const updated = await client.stopExperiment(experimentId, 'Integration test complete');
      assertEquals(updated.state, 'stopped', 'State must be stopped after stop');
    });

    // Cleanup: archive so the test experiment doesn't pollute the environment
    try {
      await client.archiveExperiment(experimentId, false, 'Archived by integration test');
    } catch (_) {
      // Cleanup failure is non-fatal
    }
  }

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
