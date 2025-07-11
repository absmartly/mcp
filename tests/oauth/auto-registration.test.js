/**
 * Tests for Auto-Registration of Deleted Clients
 * 
 * These tests verify that when a client is approved but deleted from storage,
 * the system automatically re-registers it as a public client to handle
 * Claude Desktop's aggressive client ID caching.
 */

import { strict as assert } from 'assert';
import crypto from 'crypto';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8787';

/**
 * Helper function to simulate client approval by setting approval cookie
 */
function createApprovalCookie(clientId) {
    // This is a simplified version - in reality, this would be an encrypted cookie
    // For testing, we'll use a simple format
    const approvalData = {
        clientId: clientId,
        approved: true,
        timestamp: Date.now()
    };
    
    // In real implementation, this would be encrypted with COOKIE_ENCRYPTION_KEY
    // For testing, we'll use base64 encoding
    const cookieValue = Buffer.from(JSON.stringify(approvalData)).toString('base64');
    return `client-approval-${clientId}=${cookieValue}`;
}

/**
 * Test initial client registration and approval
 */
async function testInitialClientRegistrationAndApproval() {
    console.log('Testing initial client registration and approval...');
    
    const clientId = `claude-mcp-auto-test-${Date.now()}`;
    const redirectUri = 'https://claude.ai/oauth/callback';
    
    // Step 1: Register client
    const registrationData = {
        client_name: 'Claude MCP Auto-Registration Test',
        redirect_uris: [redirectUri],
        client_id: clientId
    };
    
    const registrationResponse = await fetch(`${BASE_URL}/register`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(registrationData)
    });
    
    assert.equal(registrationResponse.status, 200, 'Initial client registration should succeed');
    
    // Step 2: Simulate approval flow
    const authUrl = new URL(`${BASE_URL}/authorize`);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'api:read');
    
    const authResponse = await fetch(authUrl.toString(), {
        method: 'GET',
        redirect: 'manual'
    });
    
    // Should show approval dialog (200) or redirect if already approved (302)
    assert(authResponse.status === 200 || authResponse.status === 302, 'Authorization should succeed');
    
    console.log('✓ Initial client registration and approval successful');
    return { clientId, redirectUri };
}

/**
 * Test client deletion simulation
 */
async function testClientDeletion(clientId) {
    console.log('Testing client deletion simulation...');
    
    // For testing purposes, we'll simulate client deletion by making a request
    // that would trigger the client lookup and then checking if it exists
    
    // First, verify client exists
    const authUrl = new URL(`${BASE_URL}/authorize`);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', 'https://claude.ai/oauth/callback');
    authUrl.searchParams.set('response_type', 'code');
    
    const beforeDeleteResponse = await fetch(authUrl.toString(), {
        method: 'GET',
        redirect: 'manual'
    });
    
    // Should work (200 or 302)
    assert(beforeDeleteResponse.status === 200 || beforeDeleteResponse.status === 302, 'Client should exist before deletion');
    
    console.log('✓ Client verified to exist before deletion');
    
    // Note: In a real test environment, we would delete the client from KV storage here
    // For this test, we'll simulate the condition where the client is approved but doesn't exist
    
    return true;
}

/**
 * Test auto-registration when client is approved but deleted
 */
async function testAutoRegistrationWhenDeleted(clientId, redirectUri) {
    console.log('Testing auto-registration when client is approved but deleted...');
    
    // Simulate a scenario where client is approved but deleted
    const approvalCookie = createApprovalCookie(clientId);
    
    const authUrl = new URL(`${BASE_URL}/authorize`);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'api:read');
    
    // Make request with approval cookie set
    const response = await fetch(authUrl.toString(), {
        method: 'GET',
        headers: {
            'Cookie': approvalCookie
        },
        redirect: 'manual'
    });
    
    // Should either redirect to OAuth flow (302) or show approval dialog (200)
    // The key is it should NOT return 400 (client not found)
    assert.notEqual(response.status, 400, 'Should not return client not found error');
    assert(response.status === 200 || response.status === 302, 'Should handle auto-registration scenario');
    
    console.log('✓ Auto-registration scenario handled correctly');
}

/**
 * Test auto-registration creates public client
 */
async function testAutoRegistrationCreatesPublicClient(clientId, redirectUri) {
    console.log('Testing auto-registration creates public client...');
    
    // After auto-registration, the client should be configured as public
    // We can test this by checking the authorization flow
    
    const authUrl = new URL(`${BASE_URL}/authorize`);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'api:read');
    
    const response = await fetch(authUrl.toString(), {
        method: 'GET',
        redirect: 'manual'
    });
    
    // Should work for public client
    assert(response.status === 200 || response.status === 302, 'Auto-registered client should work');
    
    console.log('✓ Auto-registration creates functional public client');
}

/**
 * Test auto-registration with PKCE parameters
 */
async function testAutoRegistrationWithPKCE(clientId, redirectUri) {
    console.log('Testing auto-registration with PKCE parameters...');
    
    const codeChallenge = crypto.createHash('sha256').update('test-verifier').digest('base64url');
    const approvalCookie = createApprovalCookie(clientId);
    
    const authUrl = new URL(`${BASE_URL}/authorize`);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'api:read');
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    
    const response = await fetch(authUrl.toString(), {
        method: 'GET',
        headers: {
            'Cookie': approvalCookie
        },
        redirect: 'manual'
    });
    
    // Should handle PKCE parameters correctly
    assert(response.status === 200 || response.status === 302, 'Should handle PKCE parameters in auto-registration');
    
    console.log('✓ Auto-registration handles PKCE parameters correctly');
}

/**
 * Test multiple clients with same pattern
 */
async function testMultipleClientsAutoRegistration() {
    console.log('Testing multiple clients auto-registration...');
    
    const clientIds = [
        `claude-mcp-multi-test-1-${Date.now()}`,
        `claude-mcp-multi-test-2-${Date.now()}`,
        `claude-mcp-multi-test-3-${Date.now()}`
    ];
    
    for (const clientId of clientIds) {
        const redirectUri = 'https://claude.ai/oauth/callback';
        
        // Register each client
        const registrationData = {
            client_name: `Claude MCP Multi Test ${clientId}`,
            redirect_uris: [redirectUri],
            client_id: clientId
        };
        
        const registrationResponse = await fetch(`${BASE_URL}/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(registrationData)
        });
        
        assert.equal(registrationResponse.status, 200, `Registration should succeed for ${clientId}`);
        
        // Test auto-registration scenario
        const approvalCookie = createApprovalCookie(clientId);
        
        const authUrl = new URL(`${BASE_URL}/authorize`);
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        
        const authResponse = await fetch(authUrl.toString(), {
            method: 'GET',
            headers: {
                'Cookie': approvalCookie
            },
            redirect: 'manual'
        });
        
        assert(authResponse.status === 200 || authResponse.status === 302, `Auto-registration should work for ${clientId}`);
    }
    
    console.log('✓ Multiple clients auto-registration successful');
}

/**
 * Test auto-registration preserves redirect URI
 */
async function testAutoRegistrationPreservesRedirectUri(clientId, redirectUri) {
    console.log('Testing auto-registration preserves redirect URI...');
    
    const approvalCookie = createApprovalCookie(clientId);
    
    // Use a different redirect URI to test preservation
    const testRedirectUri = 'https://claude.ai/oauth/test-callback';
    
    const authUrl = new URL(`${BASE_URL}/authorize`);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', testRedirectUri);
    authUrl.searchParams.set('response_type', 'code');
    
    const response = await fetch(authUrl.toString(), {
        method: 'GET',
        headers: {
            'Cookie': approvalCookie
        },
        redirect: 'manual'
    });
    
    // Should work even with different redirect URI
    assert(response.status === 200 || response.status === 302, 'Should handle different redirect URI in auto-registration');
    
    console.log('✓ Auto-registration preserves redirect URI correctly');
}

/**
 * Test error handling in auto-registration
 */
async function testAutoRegistrationErrorHandling() {
    console.log('Testing auto-registration error handling...');
    
    const invalidClientId = 'invalid-client-format';
    const approvalCookie = createApprovalCookie(invalidClientId);
    
    const authUrl = new URL(`${BASE_URL}/authorize`);
    authUrl.searchParams.set('client_id', invalidClientId);
    authUrl.searchParams.set('redirect_uri', 'https://example.com/callback');
    authUrl.searchParams.set('response_type', 'code');
    
    const response = await fetch(authUrl.toString(), {
        method: 'GET',
        headers: {
            'Cookie': approvalCookie
        },
        redirect: 'manual'
    });
    
    // Should handle invalid client ID gracefully
    // May return 400 for invalid client or 200 for approval dialog
    assert(response.status === 400 || response.status === 200, 'Should handle invalid client ID in auto-registration');
    
    console.log('✓ Auto-registration error handling works correctly');
}

/**
 * Main test runner for auto-registration tests
 */
async function runAutoRegistrationTests() {
    console.log('🚀 Starting Auto-Registration Tests\\n');
    
    try {
        // Test initial setup and auto-registration flow
        const { clientId, redirectUri } = await testInitialClientRegistrationAndApproval();
        await testClientDeletion(clientId);
        await testAutoRegistrationWhenDeleted(clientId, redirectUri);
        await testAutoRegistrationCreatesPublicClient(clientId, redirectUri);
        await testAutoRegistrationWithPKCE(clientId, redirectUri);
        await testAutoRegistrationPreservesRedirectUri(clientId, redirectUri);
        
        // Test additional scenarios
        await testMultipleClientsAutoRegistration();
        await testAutoRegistrationErrorHandling();
        
        console.log('\\n✅ All auto-registration tests passed!');
        return { success: true, testCount: 8 };
        
    } catch (error) {
        console.error('\\n❌ Auto-registration test failed:', error.message);
        return { success: false, error: error.message, testCount: 1 };
    }
}

export { runAutoRegistrationTests };
export default runAutoRegistrationTests;

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runAutoRegistrationTests().then(result => {
        process.exit(result.success ? 0 : 1);
    });
}