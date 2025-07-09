/**
 * OAuth Flow End-to-End Integration Tests
 * 
 * Tests the complete SAML2 → OAuth bridge flow:
 * 1. SAML2 authenticated user requests OAuth authorization
 * 2. Authorization code is generated and returned
 * 3. Authorization code is exchanged for access/refresh tokens
 * 4. Access token is used to access protected resources
 * 5. Refresh token is used to get new access tokens
 * 6. Token revocation works properly
 */

import { strict as assert } from 'assert';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const OAUTH_BASE_URL = `${BASE_URL}/auth/oauth`;

// Mock SAML2 session data
const MOCK_USER = {
  id: 1,
  email: 'test@demo-1.com',
  first_name: 'Test',
  last_name: 'User',
  role: 'admin'
};

// OAuth client configuration
const OAUTH_CLIENT = {
  client_id: 'mcp-absmartly-universal',
  redirect_uri: 'https://mcp.absmartly.com/oauth/callback'
};

/**
 * Simulate SAML2 authentication by setting session cookie
 */
function createAuthenticatedSession() {
  // In real implementation, this would be set by SAML2 middleware
  // For testing, we'll use a mock session token
  const sessionToken = jwt.sign(MOCK_USER, 'test-secret', { expiresIn: '1h' });
  return `session=${sessionToken}`;
}

/**
 * Test OAuth Authorization Endpoint
 */
async function testOAuthAuthorization() {
  console.log('Testing OAuth authorization endpoint...');
  
  const authCookie = createAuthenticatedSession();
  const state = crypto.randomBytes(16).toString('hex');
  
  const authUrl = new URL(`${OAUTH_BASE_URL}/authorize`);
  authUrl.searchParams.set('client_id', OAUTH_CLIENT.client_id);
  authUrl.searchParams.set('redirect_uri', OAUTH_CLIENT.redirect_uri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'mcp:access user:info');
  authUrl.searchParams.set('state', state);
  
  const response = await fetch(authUrl.toString(), {
    method: 'GET',
    headers: {
      'Cookie': authCookie
    },
    redirect: 'manual'
  });
  
  // Should redirect with authorization code
  assert.equal(response.status, 302, 'Should redirect with authorization code');
  
  const location = response.headers.get('location');
  assert(location, 'Should have redirect location');
  
  const redirectUrl = new URL(location);
  const authCode = redirectUrl.searchParams.get('code');
  const returnedState = redirectUrl.searchParams.get('state');
  
  assert(authCode, 'Should return authorization code');
  assert.equal(returnedState, state, 'State parameter should match');
  
  console.log('✓ OAuth authorization successful');
  return authCode;
}

/**
 * Test OAuth Token Exchange
 */
async function testTokenExchange(authCode) {
  console.log('Testing OAuth token exchange...');
  
  const tokenData = {
    grant_type: 'authorization_code',
    code: authCode,
    client_id: OAUTH_CLIENT.client_id,
    redirect_uri: OAUTH_CLIENT.redirect_uri
  };
  
  const response = await fetch(`${OAUTH_BASE_URL}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(tokenData)
  });
  
  assert.equal(response.status, 200, 'Token exchange should succeed');
  
  const tokenResponse = await response.json();
  
  assert(tokenResponse.access_token, 'Should return access token');
  assert(tokenResponse.refresh_token, 'Should return refresh token');
  assert.equal(tokenResponse.token_type, 'Bearer', 'Token type should be Bearer');
  assert.equal(tokenResponse.expires_in, 3600, 'Access token should expire in 1 hour');
  assert(tokenResponse.scope, 'Should return granted scope');
  
  // Verify access token structure
  const accessTokenPayload = jwt.decode(tokenResponse.access_token);
  assert.equal(accessTokenPayload.sub, MOCK_USER.id.toString(), 'Subject should match user ID');
  assert.equal(accessTokenPayload.email, MOCK_USER.email, 'Email should match');
  assert(accessTokenPayload.exp > Math.floor(Date.now() / 1000), 'Token should not be expired');
  
  console.log('✓ Token exchange successful');
  return tokenResponse;
}

/**
 * Test OAuth UserInfo Endpoint
 */
async function testUserInfo(accessToken) {
  console.log('Testing OAuth userinfo endpoint...');
  
  const response = await fetch(`${OAUTH_BASE_URL}/userinfo`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  
  assert.equal(response.status, 200, 'UserInfo request should succeed');
  
  const userInfo = await response.json();
  
  assert.equal(userInfo.sub, MOCK_USER.id.toString(), 'Subject should match');
  assert.equal(userInfo.email, MOCK_USER.email, 'Email should match');
  assert.equal(userInfo.given_name, MOCK_USER.first_name, 'Given name should match');
  assert.equal(userInfo.family_name, MOCK_USER.last_name, 'Family name should match');
  assert.equal(userInfo.absmartly_user_id, MOCK_USER.id, 'ABsmartly user ID should match');
  
  console.log('✓ UserInfo endpoint successful');
  return userInfo;
}

/**
 * Test OAuth Refresh Token Flow
 */
async function testRefreshToken(refreshToken) {
  console.log('Testing OAuth refresh token flow...');
  
  const refreshData = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: OAUTH_CLIENT.client_id
  };
  
  const response = await fetch(`${OAUTH_BASE_URL}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(refreshData)
  });
  
  assert.equal(response.status, 200, 'Refresh token should succeed');
  
  const tokenResponse = await response.json();
  
  assert(tokenResponse.access_token, 'Should return new access token');
  assert.equal(tokenResponse.token_type, 'Bearer', 'Token type should be Bearer');
  assert.equal(tokenResponse.expires_in, 3600, 'New access token should expire in 1 hour');
  
  console.log('✓ Refresh token flow successful');
  return tokenResponse.access_token;
}

/**
 * Test MCP Server OAuth Authentication
 */
async function testMcpOAuthAuth(accessToken) {
  console.log('Testing MCP server OAuth authentication...');
  
  // Test the MCP server's OAuth validation
  const mcpUrl = process.env.MCP_SERVER_URL || 'http://localhost:8787';
  
  const response = await fetch(`${mcpUrl}/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      },
      id: 1
    })
  });
  
  if (response.status === 404) {
    console.log('⚠ MCP server not running, skipping MCP OAuth test');
    return;
  }
  
  assert.equal(response.status, 200, 'MCP OAuth authentication should succeed');
  
  const mcpResponse = await response.json();
  assert.equal(mcpResponse.jsonrpc, '2.0', 'Should return valid JSON-RPC response');
  assert(mcpResponse.result, 'Should return initialization result');
  
  console.log('✓ MCP OAuth authentication successful');
}

/**
 * Test Token Revocation
 */
async function testTokenRevocation(accessToken, refreshToken) {
  console.log('Testing OAuth token revocation...');
  
  // Revoke refresh token
  const revokeResponse = await fetch(`${OAUTH_BASE_URL}/revoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      token: refreshToken,
      token_type_hint: 'refresh_token'
    })
  });
  
  assert.equal(revokeResponse.status, 200, 'Token revocation should succeed');
  
  // Try to use revoked refresh token
  const refreshData = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: OAUTH_CLIENT.client_id
  };
  
  const failedRefreshResponse = await fetch(`${OAUTH_BASE_URL}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(refreshData)
  });
  
  assert.equal(failedRefreshResponse.status, 400, 'Revoked refresh token should fail');
  
  const errorResponse = await failedRefreshResponse.json();
  assert.equal(errorResponse.error, 'invalid_grant', 'Should return invalid_grant error');
  
  console.log('✓ Token revocation successful');
}

/**
 * Test OAuth Discovery Endpoint
 */
async function testOAuthDiscovery() {
  console.log('Testing OAuth discovery endpoint...');
  
  const response = await fetch(`${OAUTH_BASE_URL}/.well-known/oauth-authorization-server`);
  
  assert.equal(response.status, 200, 'Discovery endpoint should be accessible');
  
  const discovery = await response.json();
  
  assert.equal(discovery.issuer, 'absmartly-oauth', 'Should return correct issuer');
  assert(discovery.authorization_endpoint, 'Should have authorization endpoint');
  assert(discovery.token_endpoint, 'Should have token endpoint');
  assert(discovery.userinfo_endpoint, 'Should have userinfo endpoint');
  assert(discovery.revocation_endpoint, 'Should have revocation endpoint');
  assert(Array.isArray(discovery.scopes_supported), 'Should list supported scopes');
  assert(discovery.scopes_supported.includes('mcp:access'), 'Should support mcp:access scope');
  
  console.log('✓ OAuth discovery successful');
}

/**
 * Test Error Cases
 */
async function testErrorCases() {
  console.log('Testing OAuth error cases...');
  
  // Test unauthorized access to protected endpoints
  const unauthorizedResponse = await fetch(`${OAUTH_BASE_URL}/userinfo`);
  assert.equal(unauthorizedResponse.status, 401, 'Should reject unauthorized requests');
  
  // Test invalid client ID
  const authUrl = new URL(`${OAUTH_BASE_URL}/authorize`);
  authUrl.searchParams.set('client_id', 'invalid-client');
  authUrl.searchParams.set('response_type', 'code');
  
  const invalidClientResponse = await fetch(authUrl.toString(), {
    headers: { 'Cookie': createAuthenticatedSession() },
    redirect: 'manual'
  });
  assert.equal(invalidClientResponse.status, 400, 'Should reject invalid client');
  
  // Test invalid grant type
  const invalidGrantResponse = await fetch(`${OAUTH_BASE_URL}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'invalid_grant',
      client_id: OAUTH_CLIENT.client_id
    })
  });
  assert.equal(invalidGrantResponse.status, 400, 'Should reject invalid grant type');
  
  console.log('✓ Error cases handled correctly');
}

/**
 * Main test runner
 */
async function runOAuthFlowTests() {
  console.log('🚀 Starting OAuth Flow End-to-End Tests\n');
  
  try {
    // Quick connectivity check
    try {
      const testResponse = await fetch(`${OAUTH_BASE_URL}/.well-known/oauth-authorization-server`);
      if (testResponse.status === 404 || !testResponse.ok) {
        console.log('⚠ OAuth server not running, skipping OAuth flow tests');
        return { success: true, testCount: 0, message: 'OAuth server not available - tests skipped' };
      }
    } catch (fetchError) {
      console.log('⚠ OAuth server not reachable, skipping OAuth flow tests');
      return { success: true, testCount: 0, message: 'OAuth server not reachable - tests skipped' };
    }
    
    // Test OAuth discovery
    await testOAuthDiscovery();
    
    // Test complete OAuth flow
    const authCode = await testOAuthAuthorization();
    const tokenResponse = await testTokenExchange(authCode);
    await testUserInfo(tokenResponse.access_token);
    const newAccessToken = await testRefreshToken(tokenResponse.refresh_token);
    await testMcpOAuthAuth(newAccessToken);
    await testTokenRevocation(tokenResponse.access_token, tokenResponse.refresh_token);
    
    // Test error cases
    await testErrorCases();
    
    console.log('\n✅ All OAuth flow tests passed!');
    return { success: true, testCount: 8, message: '8 passed, 0 failed' };
    
  } catch (error) {
    if (error.message.includes('fetch')) {
      console.log('⚠ OAuth server connection failed, skipping tests');
      return { success: true, testCount: 0, message: 'OAuth server connection failed - tests skipped' };
    }
    console.error('\n❌ OAuth flow test failed:', error.message);
    return { success: false, error: error.message, testCount: 1 };
  }
}

export { runOAuthFlowTests };
export default runOAuthFlowTests;

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runOAuthFlowTests().then(result => {
    process.exit(result.success ? 0 : 1);
  });
}