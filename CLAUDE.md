# Claude Code Guidelines

## Code Quality Standards

### Constants and Magic Strings

**NEVER use magic strings or hardcoded values inline in code**

- **All default values must be declared as constants at the top of the file**
- **Use descriptive constant names with ALL_CAPS naming convention**
- **Group related constants together**

### Whitespace and Formatting

**NEVER create lines containing only whitespace characters**

- **Lines should either be completely empty or contain meaningful content**
- **No lines with only spaces, tabs, or other invisible characters**
- **The `npm run clean-whitespace` command automatically removes such lines**
- **This rule is enforced by post-edit hooks to maintain code cleanliness**

```javascript
// ❌ Bad - magic strings inline
if (!endpoint) {
  endpoint = "https://dev-1.absmartly.com";
}
const clientId = env.CLIENT_ID || "mcp-absmartly-universal";

// ✅ Good - constants at top
const DEFAULT_BACKEND_ENDPOINT = "https://dev-1.absmartly.com";
const DEFAULT_OAUTH_CLIENT_ID = "mcp-absmartly-universal";

if (!endpoint) {
  endpoint = DEFAULT_BACKEND_ENDPOINT;
}
const clientId = env.CLIENT_ID || DEFAULT_OAUTH_CLIENT_ID;
```

## Path Handling
- **Never hardcode full paths** in scripts, configuration files, or hooks
- Always use relative paths so the code works when the repository is cloned to different locations
- This applies to:
  - Shell scripts
  - Configuration files
  - Hooks (like `.claude/settings.json`)
  - Build commands
  - Deployment scripts

## OAuth Flow and Architecture

### Overview
The ABsmartly MCP uses a dual OAuth system:
1. **ABsmartly Backend OAuth** (`backend/src/routes/auth/oauth_provider.js`) - Handles actual user authentication via SAML/credentials
2. **Cloudflare Worker OAuth** (`src/absmartly-oauth-handler.ts` + `@cloudflare/workers-oauth-provider`) - Handles MCP client authorization

### Public vs Confidential Clients
- **Public Clients** (browser-based apps like Cloudflare AI Playground):
  - Cannot store secrets securely
  - Use `token_endpoint_auth_method: "none"`
  - Send `client_secret: "none"` in token requests
  - Must use PKCE (Proof Key for Code Exchange) for security
- **Confidential Clients** (server-side apps):
  - Can store secrets securely
  - Use normal client_secret authentication

### OAuth Flow Diagram
See `/docs/oauth-flow-diagram.md` for complete flow visualization.

### Key Implementation Details

1. **Dynamic Client Registration**:
   - We return the universal client (`mcp-absmartly-universal`) instead of creating new clients
   - This prevents client proliferation and simplifies management

2. **Token Endpoint Handling**:
   - Public clients send `client_secret=none` 
   - We strip this parameter before passing to OAuth provider
   - OAuth provider validates using PKCE instead

3. **Endpoint Storage**:
   - ABsmartly endpoint is stored in KV from `resource` parameter or headers
   - Used throughout the OAuth flow for backend calls

4. **Token Types**:
   - Backend JWT: Contains user authentication from ABsmartly
   - Worker Access Token: Used for MCP connection

### OAuth 2.0 Public Client Implementation

#### Cloudflare Workers OAuth Provider Configuration

The `@cloudflare/workers-oauth-provider` package has excellent support for OAuth 2.0 public clients with PKCE. Based on research of the package source code and documentation:

#### ✅ Proper Public Client Configuration

```typescript
const oauthProvider = new OAuthProvider({
  // ... other config
  disallowPublicClientRegistration: false,  // Allow public clients
  
  async clientLookup(clientId: string, env: any) {
    // For public clients, return:
    return {
      clientId: "client-id",
      clientSecret: undefined,  // NOT null - undefined is correct
      tokenEndpointAuthMethod: 'none',  // Explicitly mark as public client
      redirectUris: [...],
      clientName: "Client Name"
    };
  }
});
```

#### ✅ Dynamic Client Registration for Public Clients

```typescript
// Registration request detection
const isPublicClient = body.token_endpoint_auth_method === "none";

// Registration response (RFC 7591 compliant)
const response = {
  client_id: clientId,
  client_id_issued_at: Math.floor(Date.now() / 1000),
  client_name: body.client_name,
  redirect_uris: body.redirect_uris,
  token_endpoint_auth_method: isPublicClient ? "none" : "client_secret_basic"
};

// Only include client_secret for confidential clients
if (!isPublicClient) {
  response.client_secret = clientSecret;
}
```

#### ✅ OAuth Discovery for Public Clients

```typescript
// Advertise support for public clients
const discovery = {
  token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
  code_challenge_methods_supported: ["S256", "plain"],
  // ...
};
```

#### Key Findings from Package Research

1. **clientSecret: undefined** (not null) is the correct way to indicate public clients
2. **tokenEndpointAuthMethod: 'none'** explicitly marks clients as public
3. **PKCE is automatically enforced** by the library for OAuth 2.1 compliance
4. **disallowPublicClientRegistration: false** must be set to allow public clients
5. **The library handles PKCE validation internally** - no manual intervention needed

#### Public vs Confidential Client Handling

- **Public Clients**: `clientSecret: undefined`, `tokenEndpointAuthMethod: 'none'`, use PKCE
- **Confidential Clients**: `clientSecret: "actual-secret"`, `tokenEndpointAuthMethod: 'client_secret_basic'`

#### OAuth Flow for Public Clients

1. **Registration**: Client requests `token_endpoint_auth_method: "none"`
2. **Response**: Server omits `client_secret`, includes `token_endpoint_auth_method: "none"`
3. **Authorization**: Normal OAuth flow with PKCE code_challenge
4. **Token Exchange**: OAuth provider validates PKCE instead of client_secret
5. **Result**: Valid access token for MCP connection

This implementation is fully compliant with:
- **RFC 6749** (OAuth 2.0 Authorization Framework)
- **RFC 7636** (PKCE by OAuth Public Clients)  
- **RFC 7591** (OAuth 2.0 Dynamic Client Registration)
- **OAuth 2.1** security best practices

### Important Files
- `src/index.ts` - Main worker entry, handles OAuth discovery and token endpoint
- `src/absmartly-oauth-handler.ts` - OAuth authorization flow handler
- `backend/src/routes/auth/oauth_provider.js` - Backend OAuth provider

### Common Issues and Solutions

1. **"Client not found" errors**:
   - Usually means the OAuth provider doesn't recognize the client
   - Check that universal client is being returned in registration

2. **"invalid_redirect_uri" errors**:
   - Backend OAuth provider has strict redirect URI validation
   - Ensure redirect URIs match exactly

3. **Token exchange failures**:
   - Check that `client_secret=none` is being stripped for public clients
   - Verify PKCE parameters are being passed correctly

### CRITICAL: API Key Authentication Protection

**NEVER remove the OAuth discovery blocking for API key users!**

The system has multiple layers to prevent API key users from being forced into OAuth flow:

#### 1. Session Tracking
- When `Authorization` header is detected, we store an API key session in KV
- Session fingerprint: `${IP}-${UserAgent}` 
- Session expires after 5 minutes (`expirationTtl: 300`)

#### 2. OAuth Discovery Blocking
**These endpoints MUST block OAuth discovery for API key users:**
- `/.well-known/oauth-authorization-server` 
- `/.well-known/oauth-protected-resource`

**Implementation:**
```javascript
// Check for active API key session FIRST
if (env.OAUTH_KV && isOAuthDiscoveryEndpoint) {
  const apiKeySession = await env.OAUTH_KV.get(`api_key_session:${clientFingerprint}`);
  if (apiKeySession) {
    // Return 404 error to prevent OAuth discovery
    return new Response(JSON.stringify({
      error: "oauth_not_available", 
      error_description: "OAuth not available when using API key authentication"
    }), { status: 404 });
  }
}
```

#### 3. Why This Is Critical
- MCP clients automatically discover OAuth endpoints via `.well-known` URLs
- If they find OAuth endpoints, they'll try OAuth instead of using provided API keys
- This breaks the direct API key authentication flow
- Users expect API key auth to work without OAuth redirects

#### 4. Protected Flow
```
1. Client sends Authorization header
2. We store API key session in KV  
3. Client requests .well-known/oauth-* endpoints
4. We detect API key session and return 404
5. Client falls back to direct API key authentication
6. MCP connection works with API key
```

**If you modify OAuth handling, always preserve this API key protection logic!**

## OAuth Implementation - Complete Details

### Manual 401 Response Implementation

Since the OAuth provider's `requireAuth: true` wasn't triggering proper 401 responses for Claude Desktop, we implemented manual authentication checking:

```typescript
// In src/index.ts - Manual 401 response for SSE endpoints
if (url.pathname.startsWith("/sse")) {
    const authHeader = request.headers.get("Authorization");
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        console.log("⚠️ No valid Authorization header, returning 401 to trigger OAuth flow");
        return new Response("Unauthorized", {
            status: 401,
            headers: {
                "WWW-Authenticate": 'Bearer realm="OAuth"',
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS", 
                "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
                "X-Auth-Debug": "basic-401-response",
            },
        });
    }
}
```

**Key Points:**
- Only applies to `/sse` endpoints (MCP connection points)
- Returns proper WWW-Authenticate header to trigger OAuth in Claude Desktop
- Includes CORS headers for browser compatibility
- Includes debug header for troubleshooting

### Public Client Registration for Claude Desktop

Claude Desktop acts as a public OAuth client using PKCE. Our implementation auto-detects Claude clients:

```typescript
// In src/index.ts - Public client detection
const isPublicClient = clientId.startsWith("claude-mcp-");

// Store client data without client_secret for public clients  
const clientData = {
    clientId: clientId,
    redirectUris: body.redirect_uris || [],
    clientName: body.client_name || "Claude MCP Client", 
    registrationDate: Date.now(),
    tokenEndpointAuthMethod: isPublicClient ? 'none' : 'client_secret_basic'
};

// Only add clientSecret for confidential clients
if (!isPublicClient && clientSecret) {
    clientData.clientSecret = clientSecret;
}
```

**Key Points:**
- Client IDs starting with `claude-mcp-` are treated as public clients
- No `client_secret` generated or stored for public clients
- `tokenEndpointAuthMethod` set to `'none'` for public clients
- PKCE authentication required instead of client_secret

### Auto-Registration of Deleted Clients

Claude Desktop caches client IDs aggressively. When approved clients are deleted, we auto-register them:

```typescript
// In src/absmartly-oauth-handler.ts - Auto-registration logic
if (isApproved) {
    // Double-check that the client actually exists
    const clientExists = await c.env.OAUTH_PROVIDER.lookupClient(clientId);
    
    if (clientExists) {
        debug('Client is already approved and exists, redirecting to OAuth');
        return redirectToAbsmartlyOAuth(c, c.req.raw, oauthReqInfo, {}, debugLogs);
    } else {
        debug('Client is approved but does not exist, auto-registering new public client');
        
        // Auto-register new public client with same ID
        const newClientData = {
            clientId: clientId,
            redirectUris: [oauthReqInfo.redirectUri],
            clientName: "Claude MCP Client",
            registrationDate: Date.now(),
            tokenEndpointAuthMethod: 'none' // Public client
            // No clientSecret for public clients
        };
        
        await c.env.OAUTH_KV.put(`client:${clientId}`, JSON.stringify(newClientData));
        debug('Auto-registered new public client', newClientData);
        
        return redirectToAbsmartlyOAuth(c, c.req.raw, oauthReqInfo, {}, debugLogs);
    }
}
```

**Key Points:**
- Handles Claude Desktop's aggressive client ID caching
- Automatically re-registers deleted clients as public clients
- Preserves user approvals across client deletions
- Uses original redirect URI from OAuth request

### PKCE Token Exchange for Public Clients

Public clients use PKCE instead of client_secret for token exchange:

```typescript
// In OAuth provider clientLookup - Public client configuration
async clientLookup(clientId: string, env: any) {
    if (env.OAUTH_KV && clientId.startsWith("claude-mcp-")) {
        const clientData = await env.OAUTH_KV.get(`client:${clientId}`);
        if (clientData) {
            const client = JSON.parse(clientData);
            return {
                clientId: client.clientId,
                clientSecret: undefined, // Public client - no secret required
                redirectUris: client.redirectUris,
                clientName: client.clientName,
                tokenEndpointAuthMethod: 'none' // Public client authentication method
            };
        }
    }
    return null;
}
```

**Key Points:**
- `clientSecret: undefined` (not null) for public clients
- `tokenEndpointAuthMethod: 'none'` enables PKCE validation
- OAuth provider handles PKCE verification automatically
- No manual client_secret validation needed

### Complete OAuth Flow Summary

1. **Initial Request**: Claude Desktop → `/sse` without auth → 401 response
2. **Client Registration**: Claude registers as public client (auto-detected by client ID)
3. **Authorization**: User approves MCP access, redirected to ABsmartly SAML
4. **Callback**: ABsmartly auth returns, token created with user props
5. **Token Exchange**: Claude exchanges auth code using PKCE (no client_secret)
6. **MCP Connection**: Access token used for authenticated MCP communication

### Testing OAuth Flow

#### Comprehensive Test Suite

We have extensive tests covering all OAuth implementation aspects:

```bash
# Run all OAuth tests
cd tests/oauth
node oauth-test-runner.js

# Run specific test suites
node oauth-test-runner.js 401           # Manual 401 response tests
node oauth-test-runner.js registration  # Public client registration tests  
node oauth-test-runner.js auto          # Auto-registration tests
node oauth-test-runner.js pkce          # PKCE token exchange tests
node oauth-test-runner.js integration   # End-to-end OAuth flow tests
```

#### Manual Testing

1. **With Claude Desktop**:
   - Configure MCP server URL: `https://mcp.absmartly.com/sse?absmartly-endpoint=https://your-backend.com`
   - Should trigger OAuth flow automatically
   - Complete SAML authentication in browser
   - MCP connection established after OAuth

2. **With Direct API Key**:
   - Add `x-absmartly-api-key` and `x-absmartly-endpoint` headers
   - Bypasses OAuth entirely
   - Direct MCP connection with API key authentication

#### Test Files Created

- `tests/oauth/manual-401-response.test.js` - Tests 401 response triggering
- `tests/oauth/public-client-registration.test.js` - Tests public client registration  
- `tests/oauth/auto-registration.test.js` - Tests auto-registration logic
- `tests/oauth/pkce-token-exchange.test.js` - Tests PKCE token exchange
- `tests/oauth/oauth-test-runner.js` - Unified test runner for all OAuth tests
- `tests/integration/oauth-flow.test.js` - End-to-end integration tests

## Deployment
- After making changes to TypeScript files in `/src/`, deploy with: `npm run deploy`
- This runs tests, builds DXT file, and deploys to Cloudflare Workers
- Deployment hooks are configured in `.claude/settings.json` but may need manual triggering

## Project Structure
- `src/` - TypeScript source files
- `backend/` - ABsmartly backend (separate project)
- `docs/` - Documentation including OAuth flow diagram
- `wrangler.jsonc` - Cloudflare Workers configuration
- `.claude/` - Claude Code configuration and hooks

## Environment Variables
- `ABSMARTLY_OAUTH_CLIENT_ID` - OAuth client ID (default: "mcp-absmartly-universal")
- `ABSMARTLY_OAUTH_CLIENT_SECRET` - OAuth client secret (not used for public clients)
- `OAUTH_KV` - KV namespace for storing OAuth session data