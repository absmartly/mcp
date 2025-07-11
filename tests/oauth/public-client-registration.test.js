/**
 * Tests for Public Client Registration
 * 
 * These tests verify that Claude Desktop can register as a public OAuth client
 * without requiring a client_secret, using PKCE for secure authentication.
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
 * Test dynamic client registration for public clients
 */
async function testPublicClientRegistration() {
    console.log('Testing public client registration...');
    
    const clientId = `claude-mcp-test-${Date.now()}`;
    const redirectUri = 'https://claude.ai/oauth/callback';
    
    const registrationData = {
        client_name: 'Claude MCP Test Client',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none', // Public client
        client_id: clientId
    };
    
    const response = await fetch(`${BASE_URL}/register`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(registrationData)
    });
    
    assert.equal(response.status, 200, 'Client registration should succeed');
    
    const registrationResponse = await response.json();
    
    assert.equal(registrationResponse.client_id, clientId, 'Should return correct client ID');
    assert.equal(registrationResponse.token_endpoint_auth_method, 'none', 'Should use "none" auth method');
    assert(!registrationResponse.client_secret, 'Public client should not have client_secret');
    assert(Array.isArray(registrationResponse.redirect_uris), 'Should include redirect URIs');
    assert(registrationResponse.redirect_uris.includes(redirectUri), 'Should include provided redirect URI');
    
    console.log('✓ Public client registration successful');
    return { clientId, redirectUri };
}

/**
 * Test client lookup returns public client configuration
 */
async function testPublicClientLookup(clientId) {
    console.log('Testing public client lookup...');
    
    // Make a request that would trigger client lookup
    const authUrl = new URL(`${BASE_URL}/authorize`);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', 'https://claude.ai/oauth/callback');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'api:read');
    
    const response = await fetch(authUrl.toString(), {
        method: 'GET',
        redirect: 'manual'
    });
    
    // Should not return client lookup error (400)
    // May return 200 (approval dialog) or 302 (redirect)
    assert.notEqual(response.status, 400, 'Client lookup should succeed for registered public client');
    
    console.log('✓ Public client lookup successful');
}

/**
 * Test authorization flow with public client
 */
async function testPublicClientAuthorization(clientId, redirectUri) {
    console.log('Testing public client authorization flow...');
    
    const { codeChallenge } = generatePKCE();
    const state = crypto.randomBytes(16).toString('hex');
    
    const authUrl = new URL(`${BASE_URL}/authorize`);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'api:read api:write');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    
    const response = await fetch(authUrl.toString(), {
        method: 'GET',
        redirect: 'manual'
    });
    
    // Should show approval dialog or redirect (not error)
    assert(response.status === 200 || response.status === 302, 'Authorization should succeed for public client');
    
    if (response.status === 200) {
        const responseText = await response.text();
        assert(responseText.includes('Claude MCP Test Client'), 'Should show client name in approval dialog');
    }
    
    console.log('✓ Public client authorization flow successful');
}

/**
 * Test token exchange with PKCE (no client_secret)
 */
async function testPublicClientTokenExchange(clientId, redirectUri) {
    console.log('Testing public client token exchange...');
    
    const { codeVerifier } = generatePKCE();
    
    // This would normally be an actual authorization code from the flow
    // For testing purposes, we'll test the endpoint structure
    const tokenData = {
        grant_type: 'authorization_code',
        code: 'test_auth_code',
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier
        // No client_secret for public clients
    };
    
    const response = await fetch(`${BASE_URL}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(tokenData)
    });
    
    // May return 400 for invalid code, but should not return 401 for missing client_secret
    assert.notEqual(response.status, 401, 'Should not require client_secret for public client');
    
    if (response.status === 400) {
        const errorResponse = await response.json();
        // Should not complain about missing client_secret
        assert(!errorResponse.error_description?.includes('client_secret'), 'Should not require client_secret');
    }
    
    console.log('✓ Public client token exchange does not require client_secret');
}

/**
 * Test confidential client registration (for comparison)
 */
async function testConfidentialClientRegistration() {
    console.log('Testing confidential client registration...');
    
    const clientId = `confidential-client-test-${Date.now()}`;
    const redirectUri = 'https://example.com/oauth/callback';
    
    const registrationData = {
        client_name: 'Confidential Test Client',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_basic',
        client_id: clientId
    };
    
    const response = await fetch(`${BASE_URL}/register`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(registrationData)
    });
    
    assert.equal(response.status, 200, 'Confidential client registration should succeed');
    
    const registrationResponse = await response.json();
    
    assert.equal(registrationResponse.client_id, clientId, 'Should return correct client ID');
    assert.equal(registrationResponse.token_endpoint_auth_method, 'client_secret_basic', 'Should use client_secret_basic auth method');
    assert(registrationResponse.client_secret, 'Confidential client should have client_secret');
    
    console.log('✓ Confidential client registration successful (with client_secret)');
}

/**
 * Test client ID format detection
 */
async function testClientIdFormatDetection() {
    console.log('Testing client ID format detection...');
    
    // Test public client format (claude-mcp-*)
    const publicClientId = `claude-mcp-test-${Date.now()}`;
    const publicRegistrationData = {
        client_name: 'Claude MCP Public Client',
        redirect_uris: ['https://claude.ai/callback'],
        client_id: publicClientId
    };
    
    const publicResponse = await fetch(`${BASE_URL}/register`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(publicRegistrationData)
    });
    
    assert.equal(publicResponse.status, 200, 'Public client format should be registered');
    
    const publicResult = await publicResponse.json();
    assert.equal(publicResult.token_endpoint_auth_method, 'none', 'claude-mcp-* should be treated as public client');
    assert(!publicResult.client_secret, 'claude-mcp-* should not have client_secret');
    
    // Test non-public client format
    const otherClientId = `other-client-test-${Date.now()}`;
    const otherRegistrationData = {
        client_name: 'Other Client',
        redirect_uris: ['https://example.com/callback'],
        client_id: otherClientId
    };
    
    const otherResponse = await fetch(`${BASE_URL}/register`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(otherRegistrationData)
    });
    
    assert.equal(otherResponse.status, 200, 'Other client format should be registered');
    
    const otherResult = await otherResponse.json();
    assert.equal(otherResult.token_endpoint_auth_method, 'client_secret_basic', 'Non-claude-mcp-* should be treated as confidential client');
    assert(otherResult.client_secret, 'Non-claude-mcp-* should have client_secret');
    
    console.log('✓ Client ID format detection working correctly');
}

/**
 * Test invalid registration requests
 */
async function testInvalidRegistrationRequests() {
    console.log('Testing invalid registration requests...');
    
    // Test missing required fields
    const invalidRequests = [
        { client_name: 'Test' }, // Missing redirect_uris
        { redirect_uris: ['https://example.com'] }, // Missing client_name
        { client_name: '', redirect_uris: ['https://example.com'] }, // Empty client_name
        { client_name: 'Test', redirect_uris: [] }, // Empty redirect_uris
        { client_name: 'Test', redirect_uris: ['invalid-uri'] }, // Invalid URI
    ];
    
    for (const invalidData of invalidRequests) {
        const response = await fetch(`${BASE_URL}/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(invalidData)
        });
        
        assert.equal(response.status, 400, `Should reject invalid registration: ${JSON.stringify(invalidData)}`);
    }
    
    console.log('✓ Invalid registration requests properly rejected');
}

/**
 * Test registration with explicit token endpoint auth method
 */
async function testExplicitTokenEndpointAuthMethod() {
    console.log('Testing explicit token endpoint auth method...');
    
    const clientId = `claude-mcp-explicit-${Date.now()}`;
    
    // Explicitly set token_endpoint_auth_method to 'none'
    const registrationData = {
        client_name: 'Claude MCP Explicit None',
        redirect_uris: ['https://claude.ai/callback'],
        client_id: clientId,
        token_endpoint_auth_method: 'none'
    };
    
    const response = await fetch(`${BASE_URL}/register`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(registrationData)
    });
    
    assert.equal(response.status, 200, 'Explicit none auth method should be accepted');
    
    const result = await response.json();
    assert.equal(result.token_endpoint_auth_method, 'none', 'Should respect explicit none auth method');
    assert(!result.client_secret, 'Should not generate client_secret for explicit none auth');
    
    console.log('✓ Explicit token endpoint auth method handled correctly');
}

/**
 * Main test runner for public client registration tests
 */
async function runPublicClientRegistrationTests() {
    console.log('🚀 Starting Public Client Registration Tests\\n');
    
    try {
        // Test public client registration flow
        const { clientId, redirectUri } = await testPublicClientRegistration();
        await testPublicClientLookup(clientId);
        await testPublicClientAuthorization(clientId, redirectUri);
        await testPublicClientTokenExchange(clientId, redirectUri);
        
        // Test other scenarios
        await testConfidentialClientRegistration();
        await testClientIdFormatDetection();
        await testInvalidRegistrationRequests();
        await testExplicitTokenEndpointAuthMethod();
        
        console.log('\\n✅ All public client registration tests passed!');
        return { success: true, testCount: 8 };
        
    } catch (error) {
        console.error('\\n❌ Public client registration test failed:', error.message);
        return { success: false, error: error.message, testCount: 1 };
    }
}

export { runPublicClientRegistrationTests };
export default runPublicClientRegistrationTests;

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runPublicClientRegistrationTests().then(result => {
        process.exit(result.success ? 0 : 1);
    });
}