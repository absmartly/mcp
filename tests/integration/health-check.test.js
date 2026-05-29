#!/usr/bin/env node
/**
 * Integration Tests for Health Check Endpoint
 * Tests the deployed health check endpoint functionality
 */

const BASE_URL = 'https://mcp.absmartly.com';
const FETCH_TIMEOUT_MS = 10000;
const MAX_HEALTHY_RESPONSE_MS = 5000;

async function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export default async function runHealthCheckTests() {
  let passed = 0;
  let failed = 0;
  const results = [];

  async function test(name, testFn) {
    try {
      const result = await testFn();
      if (result) {
        passed++;
        results.push({ name, status: 'PASS' });
      } else {
        failed++;
        results.push({ name, status: 'FAIL', error: 'Test returned false' });
      }
    } catch (error) {
      failed++;
      results.push({ name, status: 'FAIL', error: error.message });
    }
  }

  function assertEquals(actual, expected, message = '') {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
    }
    return true;
  }

  function assertTrue(condition, message = '') {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
    return true;
  }

  await test('Health endpoint is accessible', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/health`);
    return assertTrue(response.ok, `Health endpoint returned ${response.status}`);
  });

  await test('Health response has required fields', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/health`);
    const data = await response.json();

    const requiredFields = ['status', 'service', 'version', 'timestamp'];
    for (const field of requiredFields) {
      if (!(field in data)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    return assertTrue(data.status === 'healthy', 'Status should be healthy');
  });

  await test('Health check responds quickly', async () => {
    const startTime = Date.now();
    await fetchWithTimeout(`${BASE_URL}/health`);
    const responseTime = Date.now() - startTime;
    return assertTrue(responseTime < MAX_HEALTHY_RESPONSE_MS, `Response time too slow: ${responseTime}ms`);
  });

  await test('Health check allows cross-origin requests', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/health`);
    const corsHeader = response.headers.get('Access-Control-Allow-Origin');
    return assertEquals(corsHeader, '*', 'CORS header should allow all origins');
  });

  await test('Health check returns JSON content type', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/health`);
    const contentType = response.headers.get('Content-Type');
    return assertTrue(contentType?.includes('application/json'), `Wrong content type: ${contentType}`);
  });

  await test('Service metadata is correct', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/health`);
    const data = await response.json();

    assertEquals(data.service, 'absmartly-mcp', 'Service name mismatch');
    assertTrue(data.version, 'Version should be present');
    assertTrue(!Number.isNaN(new Date(data.timestamp).valueOf()), 'Timestamp should be valid date');
    return true;
  });

  await test('404 for non-existent endpoints', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/non-existent-endpoint`);
    return assertTrue(response.status === 404, `Expected 404, got ${response.status}`);
  });

  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: passed + failed,
    details: results
  };
}
