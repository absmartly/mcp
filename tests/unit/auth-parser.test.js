#!/usr/bin/env node
/**
 * Unit Tests for Authentication Header Parser
 * Tests all four authentication formats
 */

// Copy the extractAuthConfig function from the main code for testing
function extractAuthConfig(request) {
  const auth = request.headers.get('Authorization');
  const endpoint = request.headers.get('X-ABSMARTLY-API-ENDPOINT');
  
  if (auth === null || auth === undefined) return null;
  
  if (auth.startsWith('Bearer ')) {
    // Format 3: OAuth Bearer token
    return { 
      type: 'oauth', 
      token: auth.slice(7), 
      endpoint: endpoint || 'https://sandbox.absmartly.com/v1'
    };
  } 
  else if (auth.startsWith('Api-Key ')) {
    // Format 2: Explicit Api-Key prefix
    return { 
      type: 'api_key', 
      apiKey: auth.slice(8), 
      endpoint: endpoint || 'https://sandbox.absmartly.com/v1' 
    };
  }
  else if (auth.includes(' ')) {
    // Format 1: Subdomain format "subdomain api_key"
    const [subdomain, apiKey] = auth.split(' ', 2);
    return { 
      type: 'api_key', 
      apiKey, 
      endpoint: `https://${subdomain}.absmartly.com/v1` 
    };
  }
  else {
    // Format 4: Simple API key only
    return { 
      type: 'api_key', 
      apiKey: auth, 
      endpoint: endpoint || 'https://sandbox.absmartly.com/v1' 
    };
  }
}

// Mock Request class for testing
class MockRequest {
  constructor(headers = {}) {
    this.headers = new Map(Object.entries(headers));
  }
  
  get(key) {
    return this.headers.get(key) || null;
  }
}

export default function runAuthParserTests() {
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
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expected);
    
    if (actualStr !== expectedStr) {
      throw new Error(`${message}\nExpected: ${expectedStr}\nActual: ${actualStr}`);
    }
    return true;
  }

  // Test cases
  test('Format 1: Subdomain format', () => {
    const mockRequest = {
      headers: {
        get: (key) => key === 'Authorization' ? 'demo-1 BxYKd1U2DlzOLJ74gdvaIkwy4qyOCkXi' : null
      }
    };
    
    const result = extractAuthConfig(mockRequest);
    const expected = {
      type: 'api_key',
      apiKey: 'BxYKd1U2DlzOLJ74gdvaIkwy4qyOCkXi',
      endpoint: 'https://demo-1.absmartly.com/v1'
    };
    
    return assertEquals(result, expected, 'Subdomain format parsing failed');
  });

  test('Format 2: Api-Key prefix with custom endpoint', () => {
    const mockRequest = {
      headers: {
        get: (key) => {
          if (key === 'Authorization') return 'Api-Key BxYKd1U2DlzOLJ74gdvaIkwy4qyOCkXi';
          if (key === 'X-ABSMARTLY-API-ENDPOINT') return 'https://custom.absmartly.com/v1';
          return null;
        }
      }
    };
    
    const result = extractAuthConfig(mockRequest);
    const expected = {
      type: 'api_key',
      apiKey: 'BxYKd1U2DlzOLJ74gdvaIkwy4qyOCkXi',
      endpoint: 'https://custom.absmartly.com/v1'
    };
    
    return assertEquals(result, expected, 'Api-Key format with custom endpoint failed');
  });

  test('Format 3: OAuth Bearer token', () => {
    const mockRequest = {
      headers: {
        get: (key) => {
          if (key === 'Authorization') return 'Bearer oauth-token-12345';
          if (key === 'X-ABSMARTLY-API-ENDPOINT') return 'https://dev-1.absmartly.com/v1';
          return null;
        }
      }
    };
    
    const result = extractAuthConfig(mockRequest);
    const expected = {
      type: 'oauth',
      token: 'oauth-token-12345',
      endpoint: 'https://dev-1.absmartly.com/v1'
    };
    
    return assertEquals(result, expected, 'OAuth Bearer token format failed');
  });

  test('Format 4: Simple API key with explicit endpoint', () => {
    const mockRequest = {
      headers: {
        get: (key) => {
          if (key === 'Authorization') return 'BxYKd1U2DlzOLJ74gdvaIkwy4qyOCkXi';
          if (key === 'X-ABSMARTLY-API-ENDPOINT') return 'https://dev-1.absmartly.com/v1';
          return null;
        }
      }
    };
    
    const result = extractAuthConfig(mockRequest);
    const expected = {
      type: 'api_key',
      apiKey: 'BxYKd1U2DlzOLJ74gdvaIkwy4qyOCkXi',
      endpoint: 'https://dev-1.absmartly.com/v1'
    };
    
    return assertEquals(result, expected, 'Simple API key format failed');
  });

  test('Format 4: Simple API key with default endpoint', () => {
    const mockRequest = {
      headers: {
        get: (key) => key === 'Authorization' ? 'BxYKd1U2DlzOLJ74gdvaIkwy4qyOCkXi' : null
      }
    };
    
    const result = extractAuthConfig(mockRequest);
    const expected = {
      type: 'api_key',
      apiKey: 'BxYKd1U2DlzOLJ74gdvaIkwy4qyOCkXi',
      endpoint: 'https://sandbox.absmartly.com/v1'
    };
    
    return assertEquals(result, expected, 'Simple API key with default endpoint failed');
  });

  test('No Authorization header', () => {
    const mockRequest = {
      headers: {
        get: () => null
      }
    };
    
    const result = extractAuthConfig(mockRequest);
    return assertEquals(result, null, 'Should return null for missing auth header');
  });

  test('Edge case: Empty Authorization header', () => {
    const mockRequest = {
      headers: {
        get: (key) => key === 'Authorization' ? '' : null
      }
    };
    
    const result = extractAuthConfig(mockRequest);
    // Empty string should be treated as simple API key with empty value
    const expected = {
      type: 'api_key',
      apiKey: '',
      endpoint: 'https://sandbox.absmartly.com/v1'
    };
    
    return assertEquals(result, expected, 'Empty auth header should be treated as simple API key');
  });

  test('Edge case: Api-Key with no key', () => {
    const mockRequest = {
      headers: {
        get: (key) => key === 'Authorization' ? 'Api-Key ' : null
      }
    };
    
    const result = extractAuthConfig(mockRequest);
    const expected = {
      type: 'api_key',
      apiKey: '',
      endpoint: 'https://sandbox.absmartly.com/v1'
    };
    
    return assertEquals(result, expected, 'Api-Key with no key should have empty apiKey');
  });

  test('Edge case: Bearer with no token', () => {
    const mockRequest = {
      headers: {
        get: (key) => key === 'Authorization' ? 'Bearer ' : null
      }
    };
    
    const result = extractAuthConfig(mockRequest);
    const expected = {
      type: 'oauth',
      token: '',
      endpoint: 'https://sandbox.absmartly.com/v1'
    };
    
    return assertEquals(result, expected, 'Bearer with no token should have empty token');
  });

  // Return test results
  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: passed + failed,
    details: results
  };
}