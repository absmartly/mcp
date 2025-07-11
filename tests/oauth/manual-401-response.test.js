/**
 * Tests for Manual 401 Response Handling
 * 
 * These tests verify that unauthenticated requests to MCP endpoints
 * properly return 401 responses to trigger OAuth flow in Claude Desktop.
 */

import { strict as assert } from 'assert';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8787';

/**
 * Test that unauthenticated GET requests to /sse return 401
 */
async function testUnauthenticatedGetReturns401() {
    console.log('Testing unauthenticated GET /sse returns 401...');
    
    const response = await fetch(`${BASE_URL}/sse`, {
        method: 'GET',
        headers: {
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache'
        }
    });
    
    assert.equal(response.status, 401, 'GET /sse should return 401 for unauthenticated requests');
    
    const wwwAuthHeader = response.headers.get('WWW-Authenticate');
    assert(wwwAuthHeader, 'Should include WWW-Authenticate header');
    assert(wwwAuthHeader.includes('Bearer'), 'WWW-Authenticate should specify Bearer realm');
    
    console.log('✓ Unauthenticated GET /sse correctly returns 401');
}

/**
 * Test that unauthenticated POST requests to /sse return 401
 */
async function testUnauthenticatedPostReturns401() {
    console.log('Testing unauthenticated POST /sse returns 401...');
    
    const response = await fetch(`${BASE_URL}/sse`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {}
            },
            id: 1
        })
    });
    
    assert.equal(response.status, 401, 'POST /sse should return 401 for unauthenticated requests');
    
    const wwwAuthHeader = response.headers.get('WWW-Authenticate');
    assert(wwwAuthHeader, 'Should include WWW-Authenticate header');
    assert(wwwAuthHeader.includes('Bearer'), 'WWW-Authenticate should specify Bearer realm');
    
    console.log('✓ Unauthenticated POST /sse correctly returns 401');
}

/**
 * Test that requests with invalid Authorization header return 401
 */
async function testInvalidAuthHeaderReturns401() {
    console.log('Testing invalid Authorization header returns 401...');
    
    const invalidHeaders = [
        'Basic dXNlcjpwYXNz',  // Basic auth instead of Bearer
        'Bearer',              // Bearer without token
        'Bearer ',             // Bearer with empty token
        'NotBearer token123',  // Wrong auth type
        'bearer token123',     // Wrong case
    ];
    
    for (const authHeader of invalidHeaders) {
        const response = await fetch(`${BASE_URL}/sse`, {
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Accept': 'text/event-stream'
            }
        });
        
        assert.equal(response.status, 401, `Should return 401 for invalid auth header: ${authHeader}`);
        
        const wwwAuthHeader = response.headers.get('WWW-Authenticate');
        assert(wwwAuthHeader, 'Should include WWW-Authenticate header');
    }
    
    console.log('✓ Invalid Authorization headers correctly return 401');
}

/**
 * Test that non-SSE endpoints don't interfere with OAuth flow
 */
async function testNonSseEndpointsNotAffected() {
    console.log('Testing non-SSE endpoints are not affected...');
    
    // These endpoints should not return 401 for missing auth
    const endpointsToTest = [
        '/register',
        '/authorize',
        '/oauth/callback',
        '/health',
        '/.well-known/oauth-authorization-server'
    ];
    
    for (const endpoint of endpointsToTest) {
        const response = await fetch(`${BASE_URL}${endpoint}`, {
            method: 'GET',
            redirect: 'manual'
        });
        
        // Should not return 401 (may return 400, 404, 200, 302, etc.)
        assert.notEqual(response.status, 401, `Endpoint ${endpoint} should not return 401 for missing auth`);
    }
    
    console.log('✓ Non-SSE endpoints not affected by manual 401 logic');
}

/**
 * Test CORS headers are properly set on 401 responses
 */
async function testCorsHeadersOn401() {
    console.log('Testing CORS headers on 401 responses...');
    
    const response = await fetch(`${BASE_URL}/sse`, {
        method: 'GET',
        headers: {
            'Origin': 'https://claude.ai',
            'Accept': 'text/event-stream'
        }
    });
    
    assert.equal(response.status, 401, 'Should return 401');
    
    const corsHeaders = {
        'Access-Control-Allow-Origin': response.headers.get('Access-Control-Allow-Origin'),
        'Access-Control-Allow-Methods': response.headers.get('Access-Control-Allow-Methods'),
        'Access-Control-Allow-Headers': response.headers.get('Access-Control-Allow-Headers'),
    };
    
    assert.equal(corsHeaders['Access-Control-Allow-Origin'], '*', 'Should allow all origins');
    assert(corsHeaders['Access-Control-Allow-Methods'], 'Should include allowed methods');
    assert(corsHeaders['Access-Control-Allow-Headers'], 'Should include allowed headers');
    assert(corsHeaders['Access-Control-Allow-Headers'].includes('Authorization'), 'Should allow Authorization header');
    
    console.log('✓ CORS headers properly set on 401 responses');
}

/**
 * Test authenticated requests pass through successfully
 */
async function testAuthenticatedRequestsPassThrough() {
    console.log('Testing authenticated requests pass through...');
    
    // This test assumes we have a valid test token
    const testToken = process.env.TEST_OAUTH_TOKEN;
    
    if (!testToken) {
        console.log('⚠ No TEST_OAUTH_TOKEN provided, skipping authenticated request test');
        return;
    }
    
    const response = await fetch(`${BASE_URL}/sse`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${testToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {}
            },
            id: 1
        })
    });
    
    // Should not return 401 (may return 200, 400, 500, etc. depending on token validity)
    assert.notEqual(response.status, 401, 'Authenticated requests should not return 401');
    
    console.log('✓ Authenticated requests pass through manual 401 check');
}

/**
 * Test response body contains proper error message
 */
async function testResponseBodyContainsErrorMessage() {
    console.log('Testing 401 response body contains error message...');
    
    const response = await fetch(`${BASE_URL}/sse`, {
        method: 'GET'
    });
    
    assert.equal(response.status, 401, 'Should return 401');
    
    const responseBody = await response.text();
    assert.equal(responseBody, 'Unauthorized', 'Response body should contain "Unauthorized"');
    
    console.log('✓ 401 response body contains proper error message');
}

/**
 * Test debug header is included in 401 responses
 */
async function testDebugHeaderIncluded() {
    console.log('Testing debug header is included in 401 responses...');
    
    const response = await fetch(`${BASE_URL}/sse`, {
        method: 'GET'
    });
    
    assert.equal(response.status, 401, 'Should return 401');
    
    const debugHeader = response.headers.get('X-Auth-Debug');
    assert.equal(debugHeader, 'basic-401-response', 'Should include debug header');
    
    console.log('✓ Debug header properly included in 401 responses');
}

/**
 * Main test runner for manual 401 response tests
 */
async function runManual401Tests() {
    console.log('🚀 Starting Manual 401 Response Tests\\n');
    
    const tests = [
        testUnauthenticatedGetReturns401,
        testUnauthenticatedPostReturns401,
        testInvalidAuthHeaderReturns401,
        testNonSseEndpointsNotAffected,
        testCorsHeadersOn401,
        testAuthenticatedRequestsPassThrough,
        testResponseBodyContainsErrorMessage,
        testDebugHeaderIncluded
    ];
    
    let passedTests = 0;
    let failedTests = 0;
    
    for (const test of tests) {
        try {
            await test();
            passedTests++;
        } catch (error) {
            console.error(`\\n❌ Test ${test.name} failed:`, error.message);
            failedTests++;
        }
    }
    
    console.log(`\\n📊 Manual 401 Response Tests Summary:`);
    console.log(`✅ Passed: ${passedTests}`);
    console.log(`❌ Failed: ${failedTests}`);
    
    if (failedTests === 0) {
        console.log('\\n✅ All manual 401 response tests passed!');
        return { success: true, testCount: passedTests };
    } else {
        console.log('\\n❌ Some manual 401 response tests failed');
        return { success: false, testCount: passedTests + failedTests };
    }
}

export { runManual401Tests };
export default runManual401Tests;

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runManual401Tests().then(result => {
        process.exit(result.success ? 0 : 1);
    });
}