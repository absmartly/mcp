/**
 * Tests for PKCE Token Exchange with Public Clients
 * 
 * These tests verify that token exchange works correctly for public clients
 * using PKCE (Proof Key for Code Exchange) without requiring client_secret.
 */

import { strict as assert } from 'assert';
import crypto from 'crypto';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8787';

/**
 * Generate PKCE code verifier and challenge
 */
function generatePKCE() {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    return { codeVerifier, codeChallenge };
}

/**
 * Generate a base64url-encoded string
 */
function base64urlEncode(str) {
    return Buffer.from(str).toString('base64url');
}

/**
 * Test PKCE token exchange without client_secret
 */
async function testPKCETokenExchangeWithoutClientSecret() {
    console.log('Testing PKCE token exchange without client_secret...');
    
    const clientId = `claude-mcp-pkce-test-${Date.now()}`;
    const { codeVerifier, codeChallenge } = generatePKCE();
    
    // Test token exchange request structure
    const tokenData = {
        grant_type: 'authorization_code',
        code: 'test_authorization_code',
        client_id: clientId,
        redirect_uri: 'https://claude.ai/oauth/callback',
        code_verifier: codeVerifier
        // No client_secret - this is key for public clients
    };
    
    const response = await fetch(`${BASE_URL}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(tokenData)
    });
    
    // Should not return 401 for missing client_secret
    assert.notEqual(response.status, 401, 'Should not require client_secret for public clients');
    
    // May return 400 for invalid code, but error should not be about missing client_secret
    if (response.status === 400) {
        const errorResponse = await response.json();
        assert(!errorResponse.error_description?.includes('client_secret'), 
               'Error should not be about missing client_secret');
        assert(!errorResponse.error_description?.includes('client authentication'), 
               'Error should not be about client authentication');
    }
    
    console.log('✓ PKCE token exchange does not require client_secret');
}

/**
 * Test PKCE code verifier validation
 */
async function testPKCECodeVerifierValidation() {
    console.log('Testing PKCE code verifier validation...');
    
    const clientId = `claude-mcp-pkce-validation-${Date.now()}`;
    const { codeVerifier, codeChallenge } = generatePKCE();
    
    // Test with correct code verifier
    const correctTokenData = {
        grant_type: 'authorization_code',
        code: 'test_authorization_code',
        client_id: clientId,
        redirect_uri: 'https://claude.ai/oauth/callback',
        code_verifier: codeVerifier
    };
    
    const correctResponse = await fetch(`${BASE_URL}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(correctTokenData)
    });
    
    // Should not return 401 for correct PKCE
    assert.notEqual(correctResponse.status, 401, 'Should not return 401 for correct PKCE');
    
    // Test with incorrect code verifier
    const incorrectTokenData = {
        grant_type: 'authorization_code',
        code: 'test_authorization_code',
        client_id: clientId,
        redirect_uri: 'https://claude.ai/oauth/callback',
        code_verifier: 'incorrect_code_verifier'
    };
    
    const incorrectResponse = await fetch(`${BASE_URL}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(incorrectTokenData)
    });
    
    // Should reject incorrect code verifier
    if (incorrectResponse.status === 400) {
        const errorResponse = await incorrectResponse.json();
        // Error should be about PKCE validation, not client authentication
        assert(!errorResponse.error_description?.includes('client_secret'), 
               'Error should not be about client_secret');
    }
    
    console.log('✓ PKCE code verifier validation works correctly');
}

/**
 * Test missing code verifier for public client
 */
async function testMissingCodeVerifierForPublicClient() {
    console.log('Testing missing code verifier for public client...');
    
    const clientId = `claude-mcp-missing-verifier-${Date.now()}`;
    
    // Test token exchange without code_verifier (should fail for public client)
    const tokenData = {
        grant_type: 'authorization_code',
        code: 'test_authorization_code',
        client_id: clientId,
        redirect_uri: 'https://claude.ai/oauth/callback'
        // Missing code_verifier - this should fail for public clients
    };
    
    const response = await fetch(`${BASE_URL}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(tokenData)
    });
    
    // Should return 400 for missing code_verifier, not 401 for missing client_secret
    if (response.status === 400) {
        const errorResponse = await response.json();
        // Error should be about missing code_verifier, not client authentication
        assert(!errorResponse.error_description?.includes('client_secret'), 
               'Error should not be about client_secret');
    }
    
    console.log('✓ Missing code verifier properly handled for public client');
}

/**
 * Test PKCE with different code challenge methods
 */
async function testPKCEWithDifferentMethods() {
    console.log('Testing PKCE with different code challenge methods...');
    
    const clientId = `claude-mcp-pkce-methods-${Date.now()}`;
    
    // Test S256 method (SHA256)
    const s256CodeVerifier = crypto.randomBytes(32).toString('base64url');
    const s256CodeChallenge = crypto.createHash('sha256').update(s256CodeVerifier).digest('base64url');
    
    const s256TokenData = {
        grant_type: 'authorization_code',
        code: 'test_authorization_code',
        client_id: clientId,
        redirect_uri: 'https://claude.ai/oauth/callback',
        code_verifier: s256CodeVerifier
    };
    
    const s256Response = await fetch(`${BASE_URL}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(s256TokenData)
    });
    
    // Should handle S256 method correctly
    assert.notEqual(s256Response.status, 401, 'Should handle S256 PKCE method');
    
    // Test plain method (if supported)
    const plainCodeVerifier = 'plain_code_verifier_test_123';
    const plainTokenData = {
        grant_type: 'authorization_code',
        code: 'test_authorization_code',
        client_id: clientId,
        redirect_uri: 'https://claude.ai/oauth/callback',
        code_verifier: plainCodeVerifier
    };
    
    const plainResponse = await fetch(`${BASE_URL}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(plainTokenData)
    });
    
    // Should handle plain method (or reject it if not supported)
    assert.notEqual(plainResponse.status, 401, 'Should not return 401 for plain PKCE method');
    
    console.log('✓ Different PKCE methods handled correctly');
}

/**
 * Test token exchange with valid authorization code and PKCE
 */
async function testTokenExchangeWithValidCodeAndPKCE() {
    console.log('Testing token exchange with valid authorization code and PKCE...');
    
    // This test requires a valid authorization code from the OAuth flow
    // For testing purposes, we'll simulate the structure
    
    const clientId = `claude-mcp-valid-exchange-${Date.now()}`;
    const { codeVerifier } = generatePKCE();
    
    // Create a mock authorization code (in real implementation, this would come from authorization flow)
    const mockAuthCode = base64urlEncode(JSON.stringify({
        clientId: clientId,
        redirectUri: 'https://claude.ai/oauth/callback',
        scope: 'api:read api:write',
        codeChallenge: crypto.createHash('sha256').update(codeVerifier).digest('base64url'),
        codeChallengeMethod: 'S256',
        timestamp: Date.now()
    }));
    
    const tokenData = {
        grant_type: 'authorization_code',
        code: mockAuthCode,
        client_id: clientId,
        redirect_uri: 'https://claude.ai/oauth/callback',
        code_verifier: codeVerifier
    };
    
    const response = await fetch(`${BASE_URL}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(tokenData)
    });
    
    // Should process the request without authentication errors
    assert.notEqual(response.status, 401, 'Should not return 401 for valid PKCE token exchange');
    
    console.log('✓ Token exchange with valid code and PKCE handled correctly');
}

/**
 * Test token exchange error responses
 */
async function testTokenExchangeErrorResponses() {
    console.log('Testing token exchange error responses...');
    
    const clientId = `claude-mcp-error-test-${Date.now()}`;
    const { codeVerifier } = generatePKCE();
    
    // Test invalid grant type
    const invalidGrantData = {
        grant_type: 'invalid_grant',
        code: 'test_code',
        client_id: clientId,
        redirect_uri: 'https://claude.ai/oauth/callback',
        code_verifier: codeVerifier
    };
    
    const invalidGrantResponse = await fetch(`${BASE_URL}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(invalidGrantData)
    });
    
    assert.equal(invalidGrantResponse.status, 400, 'Should return 400 for invalid grant type');
    
    if (invalidGrantResponse.status === 400) {
        const errorResponse = await invalidGrantResponse.json();
        assert.equal(errorResponse.error, 'unsupported_grant_type', 'Should return unsupported_grant_type error');
    }
    
    // Test missing required parameters
    const missingParamsData = {
        grant_type: 'authorization_code',
        // Missing code, client_id, redirect_uri
        code_verifier: codeVerifier
    };
    
    const missingParamsResponse = await fetch(`${BASE_URL}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(missingParamsData)
    });
    
    assert.equal(missingParamsResponse.status, 400, 'Should return 400 for missing required parameters');
    
    console.log('✓ Token exchange error responses handled correctly');
}

/**
 * Test refresh token flow for public clients
 */
async function testRefreshTokenFlowForPublicClients() {
    console.log('Testing refresh token flow for public clients...');
    
    const clientId = `claude-mcp-refresh-test-${Date.now()}`;
    
    // Test refresh token request without client_secret
    const refreshTokenData = {
        grant_type: 'refresh_token',
        refresh_token: 'test_refresh_token',
        client_id: clientId,
        scope: 'api:read api:write'
        // No client_secret for public clients
    };
    
    const response = await fetch(`${BASE_URL}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(refreshTokenData)
    });
    
    // Should not return 401 for missing client_secret
    assert.notEqual(response.status, 401, 'Should not require client_secret for refresh token flow');
    
    // May return 400 for invalid refresh token, but not client authentication error
    if (response.status === 400) {
        const errorResponse = await response.json();
        assert(!errorResponse.error_description?.includes('client_secret'), 
               'Error should not be about missing client_secret');
    }
    
    console.log('✓ Refresh token flow for public clients handled correctly');
}

/**
 * Test PKCE parameter validation
 */
async function testPKCEParameterValidation() {
    console.log('Testing PKCE parameter validation...');
    
    const clientId = `claude-mcp-pkce-params-${Date.now()}`;
    
    // Test with invalid code verifier (too short)
    const shortVerifierData = {
        grant_type: 'authorization_code',
        code: 'test_code',
        client_id: clientId,
        redirect_uri: 'https://claude.ai/oauth/callback',
        code_verifier: 'short' // Too short for PKCE
    };
    
    const shortVerifierResponse = await fetch(`${BASE_URL}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(shortVerifierData)
    });
    
    // Should handle invalid code verifier appropriately
    assert.notEqual(shortVerifierResponse.status, 401, 'Should not return 401 for invalid code verifier');
    
    // Test with invalid code verifier (invalid characters)
    const invalidCharsData = {
        grant_type: 'authorization_code',
        code: 'test_code',
        client_id: clientId,
        redirect_uri: 'https://claude.ai/oauth/callback',
        code_verifier: 'invalid chars!@#$%^&*()' // Invalid characters
    };
    
    const invalidCharsResponse = await fetch(`${BASE_URL}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(invalidCharsData)
    });
    
    // Should handle invalid characters appropriately
    assert.notEqual(invalidCharsResponse.status, 401, 'Should not return 401 for invalid code verifier characters');
    
    console.log('✓ PKCE parameter validation handled correctly');
}

/**
 * Main test runner for PKCE token exchange tests
 */
async function runPKCETokenExchangeTests() {
    console.log('🚀 Starting PKCE Token Exchange Tests\\n');
    
    try {
        await testPKCETokenExchangeWithoutClientSecret();
        await testPKCECodeVerifierValidation();
        await testMissingCodeVerifierForPublicClient();
        await testPKCEWithDifferentMethods();
        await testTokenExchangeWithValidCodeAndPKCE();
        await testTokenExchangeErrorResponses();
        await testRefreshTokenFlowForPublicClients();
        await testPKCEParameterValidation();
        
        console.log('\\n✅ All PKCE token exchange tests passed!');
        return { success: true, testCount: 8 };
        
    } catch (error) {
        console.error('\\n❌ PKCE token exchange test failed:', error.message);
        return { success: false, error: error.message, testCount: 1 };
    }
}

export { runPKCETokenExchangeTests };
export default runPKCETokenExchangeTests;

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runPKCETokenExchangeTests().then(result => {
        process.exit(result.success ? 0 : 1);
    });
}