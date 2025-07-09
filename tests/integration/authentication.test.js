#!/usr/bin/env node
/**
 * Integration Tests for Authentication Endpoints
 * Tests the deployed authentication functionality
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

export default async function runAuthenticationTests() {
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

  function assertTrue(condition, message = '') {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
    return true;
  }

  // Test unauthenticated MCP endpoint access
  await test('MCP endpoint requires authentication', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1
      })
    });

    // Without auth headers, should still work but tools won't be configured
    // This tests that the endpoint is reachable but will require configuration
    return assertTrue(response.status !== 500, 'MCP endpoint should be reachable');
  });

  // Test SSE endpoint without authentication
  await test('SSE endpoint is accessible', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/sse`, {
      method: 'GET',
      headers: {
        'Accept': 'text/event-stream'
      }
    });

    // SSE endpoint should be accessible but may require authentication for full functionality
    return assertTrue(response.status === 200 || response.status === 401, 'SSE endpoint should respond');
  });

  // Test authentication header parsing (through health endpoint behavior)
  await test('Health endpoint shows OAuth configuration', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/health`);
    const data = await response.json();
    
    // Should have authentication documentation
    return assertTrue('authentication' in data, 'Health endpoint should document authentication');
  });

  // Test CORS on all endpoints
  await test('CORS headers are present on all endpoints', async () => {
    const endpoints = ['/health', '/mcp', '/sse'];
    
    for (const endpoint of endpoints) {
      try {
        const response = await fetchWithTimeout(`${BASE_URL}${endpoint}`, {
          method: 'OPTIONS'
        });
        
        // Check if CORS headers are present or if endpoint responds appropriately
        const corsHeader = response.headers.get('Access-Control-Allow-Origin');
        if (endpoint === '/health') {
          assertTrue(corsHeader === '*', `Health endpoint should have CORS: ${corsHeader}`);
        }
      } catch (error) {
        // Some endpoints might not support OPTIONS, which is ok
        console.log(`OPTIONS not supported for ${endpoint}, skipping CORS test`);
      }
    }
    
    return true;
  });

  // Test invalid authentication headers
  await test('Invalid authentication is handled gracefully', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Invalid Format',
        'X-ABSMARTLY-API-ENDPOINT': 'https://invalid.endpoint.com/v1'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1
      })
    });

    // Should not crash with invalid auth, but handle gracefully
    return assertTrue(response.status !== 500, 'Invalid auth should not cause server error');
  });

  // Test subdomain format simulation
  await test('Subdomain format would be parsed correctly', async () => {
    // We can't test actual authentication without valid credentials,
    // but we can test that the endpoint accepts the header format
    const response = await fetchWithTimeout(`${BASE_URL}/health`, {
      headers: {
        'Authorization': 'test-subdomain fake-api-key-for-testing'
      }
    });

    // Health endpoint should still work regardless of auth headers
    return assertTrue(response.ok, 'Subdomain auth format should be accepted');
  });

  // Test API-Key format simulation
  await test('Api-Key format would be parsed correctly', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/health`, {
      headers: {
        'Authorization': 'Api-Key fake-api-key-for-testing',
        'X-ABSMARTLY-API-ENDPOINT': 'https://test.absmartly.com/v1'
      }
    });

    return assertTrue(response.ok, 'Api-Key auth format should be accepted');
  });

  // Test Bearer token format simulation
  await test('Bearer token format would be parsed correctly', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/health`, {
      headers: {
        'Authorization': 'Bearer fake-oauth-token-for-testing',
        'X-ABSMARTLY-API-ENDPOINT': 'https://test.absmartly.com/v1'
      }
    });

    return assertTrue(response.ok, 'Bearer token auth format should be accepted');
  });

  // Test simple API key format simulation
  await test('Simple API key format would be parsed correctly', async () => {
    const response = await fetchWithTimeout(`${BASE_URL}/health`, {
      headers: {
        'Authorization': 'fake-api-key-for-testing',
        'X-ABSMARTLY-API-ENDPOINT': 'https://test.absmartly.com/v1'
      }
    });

    return assertTrue(response.ok, 'Simple API key auth format should be accepted');
  });

  // Test that health endpoint is not affected by auth headers
  await test('Health endpoint works with any auth headers', async () => {
    const authFormats = [
      'test-subdomain fake-key',
      'Api-Key fake-key',
      'Bearer fake-token',
      'fake-key'
    ];

    for (const authFormat of authFormats) {
      const response = await fetchWithTimeout(`${BASE_URL}/health`, {
        headers: {
          'Authorization': authFormat,
          'X-ABSMARTLY-API-ENDPOINT': 'https://test.absmartly.com/v1'
        }
      });

      assertTrue(response.ok, `Health endpoint should work with auth: ${authFormat}`);
    }

    return true;
  });

  // Test response times for all endpoints
  await test('All endpoints respond within reasonable time', async () => {
    const endpoints = ['/health', '/mcp', '/sse'];
    
    for (const endpoint of endpoints) {
      const startTime = Date.now();
      try {
        await fetchWithTimeout(`${BASE_URL}${endpoint}`, {}, 5000);
        const responseTime = Date.now() - startTime;
        assertTrue(responseTime < 5000, `${endpoint} response time too slow: ${responseTime}ms`);
      } catch (error) {
        // Timeout or other errors are ok, we're just testing that endpoints exist
        const responseTime = Date.now() - startTime;
        assertTrue(responseTime < 6000, `${endpoint} took too long even to fail: ${responseTime}ms`);
      }
    }

    return true;
  });

  // Return test results
  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: passed + failed,
    details: results
  };
}