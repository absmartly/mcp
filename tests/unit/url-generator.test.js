#!/usr/bin/env node
/**
 * Unit Tests for URL Generation
 * Tests experiment URL generation from different API endpoints
 */

// Function to generate web URLs from API endpoints (extracted from the main code)
function generateWebUrl(apiEndpoint, experimentId) {
  const webBaseUrl = apiEndpoint.replace(/\/v\d+\/?$/, '');
  return `${webBaseUrl}/experiments/${experimentId}`;
}

export default function runUrlGeneratorTests() {
  let passed = 0;
  let failed = 0;
  const results = [];

  function test(name, testFn) {
    try {
      const result = testFn();
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
    if (actual !== expected) {
      throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
    }
    return true;
  }

  // Test cases for different API endpoint formats
  test('Sandbox endpoint', () => {
    const apiEndpoint = 'https://sandbox.absmartly.com/v1';
    const experimentId = 12345;
    const result = generateWebUrl(apiEndpoint, experimentId);
    const expected = 'https://sandbox.absmartly.com/experiments/12345';
    
    return assertEquals(result, expected, 'Sandbox URL generation failed');
  });

  test('Production app endpoint', () => {
    const apiEndpoint = 'https://app.absmartly.com/v1';
    const experimentId = 67890;
    const result = generateWebUrl(apiEndpoint, experimentId);
    const expected = 'https://app.absmartly.com/experiments/67890';
    
    return assertEquals(result, expected, 'Production app URL generation failed');
  });

  test('Customer subdomain endpoint', () => {
    const apiEndpoint = 'https://demo-1.absmartly.com/v1';
    const experimentId = 11111;
    const result = generateWebUrl(apiEndpoint, experimentId);
    const expected = 'https://demo-1.absmartly.com/experiments/11111';
    
    return assertEquals(result, expected, 'Customer subdomain URL generation failed');
  });

  test('Endpoint with trailing slash', () => {
    const apiEndpoint = 'https://demo.absmartly.com/v1/';
    const experimentId = 22222;
    const result = generateWebUrl(apiEndpoint, experimentId);
    const expected = 'https://demo.absmartly.com/experiments/22222';
    
    return assertEquals(result, expected, 'Endpoint with trailing slash failed');
  });

  test('Local development endpoint', () => {
    const apiEndpoint = 'http://localhost:8000/v1';
    const experimentId = 33333;
    const result = generateWebUrl(apiEndpoint, experimentId);
    const expected = 'http://localhost:8000/experiments/33333';
    
    return assertEquals(result, expected, 'Local development URL generation failed');
  });

  test('Custom port endpoint', () => {
    const apiEndpoint = 'https://dev-server.com:8443/v1';
    const experimentId = 44444;
    const result = generateWebUrl(apiEndpoint, experimentId);
    const expected = 'https://dev-server.com:8443/experiments/44444';
    
    return assertEquals(result, expected, 'Custom port URL generation failed');
  });

  test('API version 2 endpoint', () => {
    const apiEndpoint = 'https://api.example.com/v2';
    const experimentId = 55555;
    const result = generateWebUrl(apiEndpoint, experimentId);
    const expected = 'https://api.example.com/experiments/55555';
    
    return assertEquals(result, expected, 'API v2 endpoint URL generation failed');
  });

  test('Numeric experiment ID', () => {
    const apiEndpoint = 'https://test.absmartly.com/v1';
    const experimentId = 123;
    const result = generateWebUrl(apiEndpoint, experimentId);
    const expected = 'https://test.absmartly.com/experiments/123';
    
    return assertEquals(result, expected, 'Numeric experiment ID failed');
  });

  test('String experiment ID', () => {
    const apiEndpoint = 'https://test.absmartly.com/v1';
    const experimentId = 'test-experiment-abc';
    const result = generateWebUrl(apiEndpoint, experimentId);
    const expected = 'https://test.absmartly.com/experiments/test-experiment-abc';
    
    return assertEquals(result, expected, 'String experiment ID failed');
  });

  test('Edge case: No version in endpoint', () => {
    const apiEndpoint = 'https://legacy.absmartly.com';
    const experimentId = 66666;
    const result = generateWebUrl(apiEndpoint, experimentId);
    const expected = 'https://legacy.absmartly.com/experiments/66666';
    
    return assertEquals(result, expected, 'Endpoint with no version failed');
  });

  test('Edge case: Complex path endpoint', () => {
    const apiEndpoint = 'https://api.company.com/absmartly/v1';
    const experimentId = 77777;
    const result = generateWebUrl(apiEndpoint, experimentId);
    const expected = 'https://api.company.com/absmartly/experiments/77777';
    
    return assertEquals(result, expected, 'Complex path endpoint failed');
  });

  // Test batch URL generation (simulating list_experiments response)
  test('Batch URL generation for experiments list', () => {
    const apiEndpoint = 'https://sandbox.absmartly.com/v1';
    const experiments = [
      { id: 1, name: 'Test A' },
      { id: 2, name: 'Test B' },
      { id: 3, name: 'Test C' }
    ];
    
    const experimentsWithUrls = experiments.map(exp => ({
      ...exp,
      web_url: generateWebUrl(apiEndpoint, exp.id)
    }));
    
    const expectedUrls = [
      'https://sandbox.absmartly.com/experiments/1',
      'https://sandbox.absmartly.com/experiments/2',
      'https://sandbox.absmartly.com/experiments/3'
    ];
    
    const actualUrls = experimentsWithUrls.map(exp => exp.web_url);
    
    return assertEquals(JSON.stringify(actualUrls), JSON.stringify(expectedUrls), 'Batch URL generation failed');
  });

  // Return test results
  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: passed + failed,
    details: results
  };
}