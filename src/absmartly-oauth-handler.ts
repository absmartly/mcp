/**
 * ABsmartly OAuth Handler
 * 
 * Handles OAuth authorization flow by integrating with ABsmartly's OAuth system
 */

import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';

// Default OAuth client ID
const DEFAULT_OAUTH_CLIENT_ID = "mcp-absmartly-universal";

// Cookie settings
const COOKIE_NAME = 'absmartly-oauth-approvals';
const COOKIE_SECRET = 'absmartly-oauth-secret-key'; // Should be from env in production

export class ABsmartlyOAuthHandler extends Hono {
  constructor() {
    super();
    
    // Add middleware to log all requests
    this.use('*', async (c, next) => {
      console.log(`🔍 ABsmartlyOAuthHandler: ${c.req.method} ${c.req.url}`);
      await next();
    });

    // Handle OAuth authorization page
    this.get('/authorize', async (c) => {
      console.log('📍 ABsmartlyOAuthHandler: Hit /authorize endpoint');
      const env = c.env;
      const url = new URL(c.req.url);
      
      // Check for resource parameter that might contain the endpoint
      const resourceParam = url.searchParams.get('resource');
      console.log('📍 Resource parameter:', resourceParam);
      
      if (resourceParam && env.OAUTH_KV) {
        try {
          const resourceUrl = new URL(resourceParam);
          console.log('📍 Parsed resource URL:', resourceUrl.href);
          const absmartlyEndpoint = resourceUrl.searchParams.get('absmartly-endpoint');
          console.log('📍 Extracted ABsmartly endpoint from resource:', absmartlyEndpoint);
          if (absmartlyEndpoint) {
            console.log('📍 Storing ABsmartly endpoint from resource param:', absmartlyEndpoint);
            await env.OAUTH_KV.put("absmartly_endpoint_config", absmartlyEndpoint);
          }
        } catch (e) {
          console.log('📍 Failed to parse resource parameter:', e);
        }
      }
      
      // Parse OAuth request using the helper
      const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
      
      // Get client info
      const clientInfo = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
      if (!clientInfo) {
        return c.text('Client not found', 400);
      }
      
      // Check if client is already approved via signed cookie
      const approvedClients = await this.getApprovedClients(c);
      const isApproved = approvedClients.includes(authRequest.clientId);
      
      if (isApproved) {
        // Client is pre-approved, redirect to ABsmartly OAuth
        console.log('Client is pre-approved, redirecting to ABsmartly OAuth');
        return this.redirectToAbsmartlyOAuth(c, authRequest);
      }
      
      // Show consent page
      return c.html(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Authorize ${clientInfo.clientName || authRequest.clientId}</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              max-width: 400px;
              margin: 100px auto;
              padding: 20px;
              background: #f5f5f5;
            }
            .container {
              background: white;
              padding: 30px;
              border-radius: 8px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            h1 { font-size: 24px; margin-bottom: 20px; }
            .client-info { 
              background: #f8f9fa; 
              padding: 15px; 
              border-radius: 4px; 
              margin: 20px 0;
            }
            .scopes {
              margin: 20px 0;
            }
            .scope-item {
              padding: 8px 0;
              border-bottom: 1px solid #eee;
            }
            button {
              background: #007bff;
              color: white;
              border: none;
              padding: 12px 24px;
              border-radius: 4px;
              font-size: 16px;
              cursor: pointer;
              width: 100%;
              margin-top: 20px;
            }
            button:hover { background: #0056b3; }
            .cancel {
              background: #6c757d;
              margin-top: 10px;
            }
            .cancel:hover { background: #5a6268; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Authorization Request</h1>
            <div class="client-info">
              <strong>${clientInfo.clientName || authRequest.clientId}</strong> is requesting access to your ABsmartly account.
            </div>
            
            <div class="scopes">
              <strong>This application will be able to:</strong>
              ${authRequest.scope.map(scope => `
                <div class="scope-item">• ${this.getScopeDescription(scope)}</div>
              `).join('')}
            </div>
            
            <form method="POST" action="/authorize">
              <input type="hidden" name="client_id" value="${authRequest.clientId}">
              <input type="hidden" name="redirect_uri" value="${authRequest.redirectUri}">
              <input type="hidden" name="state" value="${authRequest.state}">
              <input type="hidden" name="scope" value="${authRequest.scope.join(' ')}">
              <input type="hidden" name="response_type" value="${authRequest.responseType}">
              ${authRequest.codeChallenge ? `<input type="hidden" name="code_challenge" value="${authRequest.codeChallenge}">` : ''}
              ${authRequest.codeChallengeMethod ? `<input type="hidden" name="code_challenge_method" value="${authRequest.codeChallengeMethod}">` : ''}
              
              <button type="submit" name="action" value="approve">Authorize</button>
              <button type="submit" name="action" value="cancel" class="cancel">Cancel</button>
            </form>
          </div>
        </body>
        </html>
      `);
    });

    // Handle authorization form submission
    this.post('/authorize', async (c) => {
      const formData = await c.req.formData();
      const action = formData.get('action');
      
      if (action === 'cancel') {
        const redirectUri = formData.get('redirect_uri') as string;
        const state = formData.get('state') as string;
        return c.redirect(`${redirectUri}?error=access_denied&state=${state}`);
      }
      
      // Reconstruct auth request from form data
      const authRequest = {
        clientId: formData.get('client_id') as string,
        redirectUri: formData.get('redirect_uri') as string,
        state: formData.get('state') as string,
        scope: (formData.get('scope') as string || '').split(' '),
        responseType: formData.get('response_type') as string,
        codeChallenge: formData.get('code_challenge') as string,
        codeChallengeMethod: formData.get('code_challenge_method') as string,
      };
      
      // Add to approved clients
      await this.addApprovedClient(c, authRequest.clientId);
      
      // Redirect to ABsmartly OAuth
      return this.redirectToAbsmartlyOAuth(c, authRequest);
    });

    // Handle OAuth callback from ABsmartly
    this.get('/oauth/callback', async (c) => {
      const env = c.env;
      const url = new URL(c.req.url);
      
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      
      if (error) {
        console.error('OAuth callback error:', error);
        return c.text(`OAuth error: ${error}`, 400);
      }
      
      if (!code || !state) {
        return c.text('Missing code or state parameter', 400);
      }
      
      // Parse the state to get the original OAuth request info
      let oauthReqInfo;
      try {
        oauthReqInfo = JSON.parse(atob(state));
      } catch (e) {
        console.error('Failed to parse state:', e);
        return c.text('Invalid state parameter', 400);
      }
      
      // Get the ABsmartly endpoint from the original request
      let absmartlyEndpoint = oauthReqInfo.absmartlyEndpoint || 'https://dev-1.absmartly.com';
      
      // Clean up endpoint (remove trailing slashes)
      const cleanEndpoint = absmartlyEndpoint.replace(/\/+$/, '');
      
      // Exchange the code with ABsmartly for an access token - /auth endpoints don't use /v1 prefix
      const tokenUrl = `${cleanEndpoint}/auth/oauth/token`;
      const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: env.ABSMARTLY_OAUTH_CLIENT_ID || DEFAULT_OAUTH_CLIENT_ID,
        code: code,
        redirect_uri: `${url.origin}/oauth/callback`,
      });
      
      if (env.ABSMARTLY_OAUTH_CLIENT_SECRET) {
        tokenBody.set('client_secret', env.ABSMARTLY_OAUTH_CLIENT_SECRET);
      }
      
      console.log('Exchanging code with ABsmartly:', tokenUrl);
      
      const tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: tokenBody,
      });
      
      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('Token exchange failed:', errorText);
        return c.text(`Token exchange failed: ${errorText}`, 500);
      }
      
      const tokenData = await tokenResponse.json();
      console.log('Token exchange successful');
      
      // Decode the JWT to extract user information
      let userInfo: any = {};
      try {
        console.log('🔍 JWT analysis - token type:', typeof tokenData.access_token);
        console.log('🔍 JWT analysis - token preview:', tokenData.access_token?.substring(0, 50) + '...');
        
        const jwtParts = tokenData.access_token.split('.');
        console.log('🔍 JWT analysis - parts count:', jwtParts.length);
        
        if (jwtParts.length === 3) {
          const payload = atob(jwtParts[1]);
          console.log('🔍 JWT payload raw:', payload);
          userInfo = JSON.parse(payload);
          console.log('🔍 JWT decoded user info:', userInfo);
        } else {
          console.warn('🔍 JWT does not have 3 parts, cannot decode');
        }
      } catch (error) {
        console.warn('Failed to decode JWT:', error);
        console.log('🔍 Token data received:', tokenData);
      }
      
      // Check if this is a reference token (only contains token, iat, exp)
      const isReferenceToken = userInfo?.token && !userInfo?.email && !userInfo?.sub;
      
      if (isReferenceToken) {
        console.log('🔍 Detected reference token system - JWT contains token reference, not user info');
        console.log('🔍 Reference token:', userInfo.token?.substring(0, 20) + '...');
        
        // For reference tokens, we'll get user info from API calls later
        // Use the token reference as a unique identifier
        const tokenId = userInfo.token;
        const email = `token-user-${tokenId.substring(0, 8)}@oauth.local`;
        const name = 'OAuth User';
        const userId = tokenId;
        
        console.log('🔍 Using reference token approach:', { email, name, userId: userId.substring(0, 20) + '...' });
        
        // Store token for later API calls
        var finalEmail = email;
        var finalName = name;
        var finalUserId = userId;
      } else {
        console.log('🔍 Extracting user info from JWT payload:', {
          email: userInfo?.email,
          sub: userInfo?.sub,
          name: userInfo?.name,
          given_name: userInfo?.given_name,
          absmartly_user_id: userInfo?.absmartly_user_id,
          allKeys: Object.keys(userInfo || {})
        });
        
        finalEmail = userInfo?.email || userInfo?.sub;
        finalName = userInfo?.name || userInfo?.given_name || finalEmail;
        finalUserId = userInfo?.sub || userInfo?.absmartly_user_id?.toString() || finalEmail;
        
        if (!finalEmail) {
          console.error('❌ No email found in JWT payload! Using fallback.');
          console.log('🔍 Full userInfo object:', userInfo);
          finalEmail = 'jwt-user@oauth.local';
          finalName = 'JWT User';
          finalUserId = 'jwt-' + Date.now();
        }
        
        console.log('🔍 Extracted user details:', { email: finalEmail, name: finalName, userId: finalUserId });
      }
      
      // Use the clean endpoint without /v1 for auth endpoints
      
      // For API calls, ensure endpoint has /v1 suffix
      const apiEndpoint = cleanEndpoint.endsWith('/v1') ? cleanEndpoint : `${cleanEndpoint}/v1`;
      
      // Complete the authorization with user props
      const result = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReqInfo.authRequest,
        userId: finalUserId,
        metadata: {},
        scope: oauthReqInfo.authRequest.scope,
        props: {
          email: finalEmail,
          name: finalName,
          absmartly_endpoint: apiEndpoint,
          oauth_jwt: tokenData.access_token,
          user_id: finalUserId,
          absmartly_api_key: tokenData.api_key || tokenData.absmartly_api_key || undefined
        }
      });
      
      // Redirect back to the client with the authorization code
      return c.redirect(result.redirectTo);
    });
  }

  private async redirectToAbsmartlyOAuth(c: any, authRequest: any) {
    const url = new URL(c.req.url);
    const env = c.env;
    
    // Get ABsmartly endpoint from query parameter, header, or KV storage
    let absmartlyEndpoint = url.searchParams.get('absmartly-endpoint') || 
                           c.req.header('x-absmartly-endpoint');
    
    // If not found, try to retrieve from KV storage
    if (!absmartlyEndpoint && env.OAUTH_KV) {
      // First try the stored endpoint from resource parameter
      const storedFromResource = await env.OAUTH_KV.get("absmartly_endpoint_config");
      if (storedFromResource) {
        console.log(`📍 Retrieved stored endpoint from resource param: ${storedFromResource}`);
        absmartlyEndpoint = storedFromResource;
      } else {
        // Try client fingerprint method
        const clientFingerprint = `${c.req.header('CF-Connecting-IP') || 'unknown'}-${c.req.header('User-Agent') || 'unknown'}`;
        const storedEndpoint = await env.OAUTH_KV.get(`oauth_endpoint:${clientFingerprint}`);
        if (storedEndpoint) {
          console.log(`📍 Retrieved stored endpoint from fingerprint: ${storedEndpoint}`);
          absmartlyEndpoint = storedEndpoint;
        }
      }
    }
    
    // Fallback to default
    absmartlyEndpoint = absmartlyEndpoint || 'https://dev-1.absmartly.com';
    console.log(`📍 Final ABsmartly endpoint for OAuth redirect: ${absmartlyEndpoint}`);
    
    // Clean up endpoint (remove trailing slashes)
    const cleanEndpoint = absmartlyEndpoint.replace(/\/+$/, '');
    
    // Create state parameter with original OAuth request info
    const stateData = {
      authRequest,
      absmartlyEndpoint: cleanEndpoint  // Store clean endpoint without /v1 for consistency
    };
    const state = btoa(JSON.stringify(stateData));
    
    // Build ABsmartly OAuth URL - /auth endpoints don't use /v1 prefix
    const absmartlyOAuthUrl = new URL(`${cleanEndpoint}/auth/oauth/authorize`);
    absmartlyOAuthUrl.searchParams.set('client_id', env.ABSMARTLY_OAUTH_CLIENT_ID || DEFAULT_OAUTH_CLIENT_ID);
    absmartlyOAuthUrl.searchParams.set('redirect_uri', `${url.origin}/oauth/callback`);
    absmartlyOAuthUrl.searchParams.set('scope', 'api:read api:write');
    absmartlyOAuthUrl.searchParams.set('response_type', 'code');
    absmartlyOAuthUrl.searchParams.set('state', state);
    
    return c.redirect(absmartlyOAuthUrl.toString());
  }

  private getScopeDescription(scope: string): string {
    const descriptions: Record<string, string> = {
      'api:read': 'Read access to your ABsmartly experiments and data',
      'api:write': 'Create and modify experiments in your ABsmartly account'
    };
    return descriptions[scope] || scope;
  }

  private async getApprovedClients(c: any): Promise<string[]> {
    const cookie = getCookie(c, COOKIE_NAME);
    if (!cookie) return [];
    
    try {
      // In production, verify HMAC signature
      const decoded = JSON.parse(atob(cookie));
      return decoded.clients || [];
    } catch (e) {
      return [];
    }
  }

  private async addApprovedClient(c: any, clientId: string) {
    const approvedClients = await this.getApprovedClients(c);
    if (!approvedClients.includes(clientId)) {
      approvedClients.push(clientId);
    }
    
    // In production, add HMAC signature
    const cookie = btoa(JSON.stringify({ clients: approvedClients }));
    
    setCookie(c, COOKIE_NAME, cookie, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 30 * 24 * 60 * 60 // 30 days
    });
  }
}