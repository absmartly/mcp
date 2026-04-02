#!/usr/bin/env node
/**
 * Integration Tests: API Client Advanced Lifecycle Transitions
 *
 * Tests advanced experiment lifecycle transitions via the API client:
 *   - Dev testing mode
 *   - Restart (creates new iteration)
 *   - Full-on with variant
 *   - Archive
 *
 * Requires ABSMARTLY_API_KEY and ABSMARTLY_API_ENDPOINT in .env.local.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { APIClient } from '@absmartly/cli/api-client';
import { FetchHttpClient } from '../../src/fetch-adapter.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: join(__dirname, '../../.env.local') });

const SKIP_MESSAGE = 'Skipped: ABSMARTLY_API_KEY and ABSMARTLY_API_ENDPOINT required';
const TEST_EXPERIMENT_PREFIX = 'mcp_integration_test_advanced_';

function stripV1(endpoint) {
  return endpoint.endsWith('/v1') ? endpoint.slice(0, -3) : endpoint;
}

function buildClient() {
  const endpoint = stripV1(process.env.ABSMARTLY_API_ENDPOINT || '');
  const apiKey = process.env.ABSMARTLY_API_KEY || '';
  const httpClient = new FetchHttpClient(endpoint, { authToken: apiKey, authType: 'api-key' });
  return new APIClient(httpClient);
}

export default async function runApiClientAdvancedLifecycleTests() {
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

  if (!process.env.ABSMARTLY_API_KEY || !process.env.ABSMARTLY_API_ENDPOINT) {
    return {
      success: true,
      testCount: 0,
      message: SKIP_MESSAGE,
      details: [],
    };
  }

  const client = buildClient();

  let applicationId = null;
  let unitTypeId = null;
  let userId = null;

  await test('fetch prerequisites', async () => {
    const appsRes = await client.listApplications({ limit: 1, offset: 0 });
    const apps = appsRes.data || appsRes;
    assertTrue(apps && apps.length > 0, 'At least one application required');
    applicationId = apps[0].id || apps[0].application_id;

    const unitsRes = await client.listUnitTypes({ limit: 1, offset: 0 });
    const units = unitsRes.data || unitsRes;
    assertTrue(units && units.length > 0, 'At least one unit type required');
    unitTypeId = units[0].id || units[0].unit_type_id;

    try {
      const currentUser = await client.getCurrentUser();
      userId = currentUser.id || currentUser.user_id;
    } catch (_) {
      // getCurrentUser may not be supported; continue without owner
    }
  });

  if (!applicationId || !unitTypeId) {
    const details = [...passed, ...failed];
    return {
      success: false,
      testCount: details.length,
      message: 'Prerequisites not met',
      details,
    };
  }

  const experimentName = `${TEST_EXPERIMENT_PREFIX}${Date.now()}`;
  let experimentId = null;
  let restartedId = null;

  await test('create experiment', async () => {
    const data = {
      name: experimentName,
      type: 'test',
      state: 'created',
      percentage_of_traffic: 100,
      percentages: '50/50',
      applications: [{ application_id: applicationId, application_version: '0' }],
      unit_type: { unit_type_id: unitTypeId },
      variants: [
        { variant: 0, name: 'Control', config: '{}' },
        { variant: 1, name: 'Treatment', config: '{}' },
      ],
      ...(userId ? { owners: [{ user_id: userId }] } : {}),
    };
    const experiment = await client.createExperiment(data);
    experimentId = experiment.id || experiment.experiment_id;
    assertTrue(experimentId != null, 'Created experiment must have id');
    assertEquals(experiment.state, 'created', 'New experiment must be in created state');
  });

  if (!experimentId) {
    const details = [...passed, ...failed];
    return {
      success: false,
      testCount: details.length,
      message: 'Could not create experiment',
      details,
    };
  }

  await test('transition to ready state', async () => {
    const updated = await client.updateExperiment(experimentId, { state: 'ready' });
    assertEquals(updated.state, 'ready', 'State must be ready');
  });

  await test('put in dev testing mode', async () => {
    const updated = await client.developmentExperiment(experimentId, 'dev testing');
    assertTrue(updated.state != null, 'Dev experiment must have state');
  });

  await test('start experiment (running)', async () => {
    const updated = await client.startExperiment(experimentId);
    assertEquals(updated.state, 'running', 'State must be running after start');
  });

  await test('stop experiment', async () => {
    const updated = await client.stopExperiment(experimentId);
    assertEquals(updated.state, 'stopped', 'State must be stopped after stop');
  });

  await test('restart experiment (creates new iteration)', async () => {
    const restarted = await client.restartExperiment(experimentId);
    restartedId = restarted.id || restarted.experiment_id;
    assertTrue(restartedId != null, 'Restarted experiment must have id');
    assertTrue(
      restartedId !== experimentId,
      'Restarted experiment should have a new id'
    );
  });

  if (restartedId) {
    await test('set full-on with variant 1', async () => {
      const fullOn = await client.fullOnExperiment(restartedId, 1, 'going full on');
      assertTrue(fullOn.state != null, 'Full-on experiment must have state');
    });

    await test('stop restarted experiment', async () => {
      const stopped = await client.stopExperiment(restartedId);
      assertEquals(stopped.state, 'stopped', 'Restarted experiment must be stopped');
    });

    await test('archive restarted experiment', async () => {
      await client.archiveExperiment(restartedId, false, 'Archived by integration test');
      // Archive returns void, so just verify no error was thrown
    });
  }

  // Cleanup original if restart didn't happen
  if (experimentId && !restartedId) {
    try {
      await client.archiveExperiment(experimentId, false, 'Archived by integration test');
    } catch (_) {
      // Non-fatal
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
