#!/usr/bin/env node
/**
 * Integration Tests: API Client Feature Flags
 *
 * Tests creating feature flags via the API client.
 * Requires ABSMARTLY_API_KEY and ABSMARTLY_API_ENDPOINT in .env.local.
 * Created feature flags are archived after each test run.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { APIClient } from '@absmartly/cli/api-client';
import { FetchHttpClient } from '../../src/fetch-adapter.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: join(__dirname, '../../.env.local') });

const SKIP_MESSAGE = 'Skipped: ABSMARTLY_API_KEY and ABSMARTLY_API_ENDPOINT required';
const TEST_FLAG_PREFIX = 'mcp_integration_test_flag_';

function stripV1(endpoint) {
  return endpoint.endsWith('/v1') ? endpoint.slice(0, -3) : endpoint;
}

function buildClient() {
  const endpoint = stripV1(process.env.ABSMARTLY_API_ENDPOINT || '');
  const apiKey = process.env.ABSMARTLY_API_KEY || '';
  const httpClient = new FetchHttpClient(endpoint, { authToken: apiKey, authType: 'api-key' });
  return new APIClient(httpClient);
}

export default async function runApiClientFeatureFlagsTests() {
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

  await test('fetch first application', async () => {
    const response = await client.listApplications({ limit: 1, offset: 0 });
    const apps = response.data || response;
    assertTrue(apps && apps.length > 0, 'At least one application required');
    applicationId = apps[0].id || apps[0].application_id;
  });

  await test('fetch first unit type', async () => {
    const response = await client.listUnitTypes({ limit: 1, offset: 0 });
    const units = response.data || response;
    assertTrue(units && units.length > 0, 'At least one unit type required');
    unitTypeId = units[0].id || units[0].unit_type_id;
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

  const flagName = `${TEST_FLAG_PREFIX}${Date.now()}`;
  let flagId = null;

  await test('create feature flag in created state', async () => {
    const data = {
      name: flagName,
      applications: [{ application_id: applicationId }],
      unit_type: { unit_type_id: unitTypeId },
      type: 'test',
      percentage_of_traffic: 100,
      variants: [
        { variant: 0, name: 'Off' },
        { variant: 1, name: 'On' },
      ],
    };
    const flag = await client.createExperiment(data);
    flagId = flag.id || flag.experiment_id;
    assertTrue(flagId != null, 'Created flag must have id');
    assertEquals(flag.name, flagName, 'Flag name must match');
    assertEquals(flag.state, 'created', 'New flag must be in created state');
  });

  await test('created flag has correct variant count', async () => {
    assertTrue(flagId != null, 'Flag must have been created');
    const flag = await client.getExperiment(flagId);
    assertTrue(Array.isArray(flag.variants), 'Flag must have variants');
    assertEquals(flag.variants.length, 2, 'Flag must have 2 variants (Off/On)');
  });

  await test('created flag has correct traffic allocation', async () => {
    assertTrue(flagId != null, 'Flag must have been created');
    const flag = await client.getExperiment(flagId);
    assertEquals(flag.percentage_of_traffic, 100, 'Flag must have 100% traffic');
  });

  // Cleanup
  if (flagId) {
    try {
      await client.archiveExperiment(flagId, false, 'Archived by integration test');
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
