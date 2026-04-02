#!/usr/bin/env node
/**
 * Integration Tests: MCP Client Create
 *
 * Tests creating experiments and feature flags via the MCP protocol
 * by connecting to a local wrangler dev server at http://localhost:8787.
 *
 * Prerequisites:
 *   - ABSMARTLY_API_KEY and ABSMARTLY_API_ENDPOINT in .env.local
 *   - wrangler dev running: npm run dev
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { APIClient } from '@absmartly/cli/api-client';
import { FetchHttpClient } from '../../src/fetch-adapter.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: join(__dirname, '../../.env.local') });

const LOCAL_MCP_URL = 'http://localhost:8787/sse';
const SKIP_NO_CREDENTIALS = 'Skipped: ABSMARTLY_API_KEY and ABSMARTLY_API_ENDPOINT required';
const SKIP_NO_SERVER = 'Skipped: local wrangler dev server not running at localhost:8787';
const TEST_EXPERIMENT_PREFIX = 'mcp_integration_test_mcp_';

function stripV1(endpoint) {
  return endpoint.endsWith('/v1') ? endpoint.slice(0, -3) : endpoint;
}

async function isServerRunning() {
  try {
    const res = await fetch('http://localhost:8787/health', {
      signal: AbortSignal.timeout(3000),
    });
    return res.status < 500;
  } catch (_) {
    return false;
  }
}

async function connectMcpClient() {
  const client = new Client(
    { name: 'mcp-create-test', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  const transport = new SSEClientTransport(new URL(LOCAL_MCP_URL));
  await client.connect(transport);
  return client;
}

function parseMcpContent(result) {
  const text = result.content?.[0]?.text;
  if (!text) return result;
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
  } catch (_) {
    return text;
  }
}

function buildApiClient() {
  const endpoint = stripV1(process.env.ABSMARTLY_API_ENDPOINT || '');
  const apiKey = process.env.ABSMARTLY_API_KEY || '';
  const httpClient = new FetchHttpClient(endpoint, { authToken: apiKey, authType: 'api-key' });
  return new APIClient(httpClient);
}

export default async function runMcpClientCreateTests() {
  if (!process.env.ABSMARTLY_API_KEY || !process.env.ABSMARTLY_API_ENDPOINT) {
    return { success: true, testCount: 0, message: SKIP_NO_CREDENTIALS, details: [] };
  }

  const serverRunning = await isServerRunning();
  if (!serverRunning) {
    return { success: true, testCount: 0, message: SKIP_NO_SERVER, details: [] };
  }

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

  const apiClient = buildApiClient();
  let mcpClient = null;

  try {
    mcpClient = await connectMcpClient();
  } catch (error) {
    return {
      success: false,
      testCount: 1,
      message: `MCP connection failed: ${error.message}`,
      details: [{ name: 'connect to MCP server', status: 'FAIL', error: error.message }],
    };
  }

  // Get prerequisite data via MCP
  let appId = null;
  let unitId = null;

  await test('list applications via MCP', async () => {
    const result = await mcpClient.callTool({
      name: 'execute_api_method',
      arguments: { method_name: 'listApplications', params: { items: 1, page: 1 } },
    });
    const data = parseMcpContent(result);
    const apps = data.data || data;
    assertTrue(Array.isArray(apps) && apps.length > 0, 'Expected at least one application');
    appId = apps[0].id || apps[0].application_id;
  });

  await test('list unit types via MCP', async () => {
    const result = await mcpClient.callTool({
      name: 'execute_api_method',
      arguments: { method_name: 'listUnitTypes', params: { items: 1, page: 1 } },
    });
    const data = parseMcpContent(result);
    const units = data.data || data;
    assertTrue(Array.isArray(units) && units.length > 0, 'Expected at least one unit type');
    unitId = units[0].id || units[0].unit_type_id;
  });

  const expName = `${TEST_EXPERIMENT_PREFIX}${Date.now()}`;
  let experimentId = null;

  await test('create experiment via MCP', async () => {
    const expData = {
      name: expName,
      applications: [{ application_id: appId }],
      unit_type: { unit_type_id: unitId },
      type: 'test',
      state: 'created',
      percentage_of_traffic: 100,
      variants: [
        { variant: 0, name: 'Control' },
        { variant: 1, name: 'Treatment' },
      ],
    };
    const result = await mcpClient.callTool({
      name: 'execute_api_method',
      arguments: { method_name: 'createExperiment', params: { data: expData } },
    });
    const experiment = parseMcpContent(result);
    experimentId = experiment.id || experiment.experiment_id;
    assertTrue(experimentId != null, 'Created experiment must have id');
    assertEquals(experiment.name, expName, 'Experiment name must match');
    assertEquals(experiment.state, 'created', 'New experiment must be in created state');
  });

  const flagName = `${TEST_EXPERIMENT_PREFIX}flag_${Date.now()}`;
  let flagId = null;

  await test('create feature flag via MCP', async () => {
    const flagData = {
      name: flagName,
      applications: [{ application_id: appId }],
      unit_type: { unit_type_id: unitId },
      type: 'test',
      percentage_of_traffic: 100,
      variants: [
        { variant: 0, name: 'Off' },
        { variant: 1, name: 'On' },
      ],
    };
    const result = await mcpClient.callTool({
      name: 'execute_api_method',
      arguments: { method_name: 'createExperiment', params: { data: flagData } },
    });
    const flag = parseMcpContent(result);
    flagId = flag.id || flag.experiment_id;
    assertTrue(flagId != null, 'Created flag must have id');
    assertEquals(flag.name, flagName, 'Flag name must match');
  });

  await mcpClient.close().catch(() => {});

  // Cleanup via API client
  for (const id of [experimentId, flagId]) {
    if (id) {
      try {
        await apiClient.archiveExperiment(id, false, 'Archived by integration test');
      } catch (_) {
        // Non-fatal
      }
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
