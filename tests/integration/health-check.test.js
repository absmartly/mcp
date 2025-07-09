#!/usr/bin/env node
/**
 * Integration Tests for Health Check Endpoint
 * Tests the deployed health check endpoint functionality
 */

const BASE_URL = 'https://mcp.absmartly.com';

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
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

  // Test health check endpoint accessibility
  await test('Health endpoint is accessible', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/health`);
    return assertTrue(response.ok, `Health endpoint returned ${response.status}`);
  });

  // Test health check response structure
  await test('Health response has correct structure', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/health`);
    const data = await response.json();
    
    const requiredFields = ['status', 'service', 'version', 'timestamp', 'endpoints'];
    for (const field of requiredFields) {
      if (!(field in data)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    return assertTrue(data.status === 'healthy', 'Status should be healthy');
  });

  // Test authentication documentation in health response
  await test('Health response includes authentication documentation', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/health`);
    const data = await response.json();
    
    assertTrue('authentication' in data, 'Authentication section missing');
    assertTrue('supported_formats' in data.authentication, 'Supported formats missing');
    assertTrue('headers' in data.authentication, 'Headers documentation missing');
    assertTrue('examples' in data.authentication, 'Examples missing');
    
    const expectedFormats = [
      'Authorization: <subdomain> <api_key>',
      'Authorization: Api-Key <api_key>',
      'Authorization: Bearer <oauth_token>',
      'Authorization: <api_key>'
    ];
    
    return assertEquals(data.authentication.supported_formats, expectedFormats, 'Supported formats mismatch');
  });

  // Test that all endpoints are documented
  await test('All endpoints are documented', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/health`);
    const data = await response.json();
    
    const requiredEndpoints = ['health', 'mcp_local', 'mcp_sse'];
    for (const endpoint of requiredEndpoints) {
      if (!(endpoint in data.endpoints)) {
        throw new Error(`Missing endpoint documentation: ${endpoint}`);
      }
    }
    
    return true;
  });

  // Test health check response time
  await test('Health check responds quickly', async () => {
    const startTime = Date.now();
    const response = await fetchWithTimeout(`${BASE_URL}/health`);
    const endTime = Date.now();
    
    const responseTime = endTime - startTime;
    return assertTrue(responseTime < 5000, `Response time too slow: ${responseTime}ms`);
  });

  // Test CORS headers
  await test('Health check includes CORS headers', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/health`);
    const corsHeader = response.headers.get('Access-Control-Allow-Origin');
    
    return assertEquals(corsHeader, '*', 'CORS header should allow all origins');
  });

  // Test content type
  await test('Health check returns JSON content type', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/health`);
    const contentType = response.headers.get('Content-Type');
    
    return assertTrue(contentType.includes('application/json'), `Wrong content type: ${contentType}`);
  });

  // Test authentication examples format
  await test('Authentication examples are valid', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/health`);
    const data = await response.json();
    
    const examples = data.authentication.examples;
    const requiredExamples = [
      'subdomain_format',
      'explicit_endpoint', 
      'oauth_bearer',
      'simple_api_key'
    ];
    
    for (const example of requiredExamples) {
      if (!(example in examples)) {
        throw new Error(`Missing authentication example: ${example}`);
      }
      
      if (!examples[example].startsWith('Authorization:')) {
        throw new Error(`Invalid example format for ${example}: ${examples[example]}`);
      }
    }
    
    return true;
  });

  // Test service metadata
  await test('Service metadata is correct', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/health`);
    const data = await response.json();
    
    assertEquals(data.service, 'absmartly-mcp', 'Service name mismatch');
    assertTrue(data.version, 'Version should be present');
    assertTrue(new Date(data.timestamp), 'Timestamp should be valid date');
    
    return true;
  });

  // Test error handling for non-existent endpoint
  await test('404 for non-existent endpoints', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/non-existent-endpoint`);
    return assertTrue(response.status === 404, `Expected 404, got ${response.status}`);
  });

  // Return test results
  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: passed + failed,
    details: results
  };
}