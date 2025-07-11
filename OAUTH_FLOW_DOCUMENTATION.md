# OAuth Flow Implementation Documentation

## Overview

This document details the complete OAuth 2.0 implementation for the ABsmartly MCP (Model Context Protocol) server. The implementation provides secure authentication between Claude Desktop and the ABsmartly platform via OAuth 2.0 with PKCE (Proof Key for Code Exchange).

## Architecture

The OAuth flow bridges Claude Desktop (MCP client) with ABsmartly's SAML-based authentication system using a dual OAuth implementation:

1. **MCP OAuth Provider**: Handles OAuth between Claude Desktop and our MCP server
2. **ABsmartly OAuth Bridge**: Exchanges MCP tokens for ABsmartly authentication

## Complete Flow Diagram

```
[Claude Desktop] → [MCP Server] → [ABsmartly SAML] → [ABsmartly API]
     ↓               ↓               ↓               ↓
   MCP Client    OAuth Provider   OAuth Bridge    API Access
   (Public)      (Our Worker)    (Backend)       (Experiments)
```

## Detailed Flow Steps

### 1. Initial MCP Connection Request
- Claude Desktop attempts to connect to MCP server at `/sse` endpoint
- No Authorization header provided initially
- MCP server returns 401 Unauthorized with WWW-Authenticate header
- This triggers OAuth flow in Claude Desktop

### 2. Client Registration (Dynamic)
- Claude Desktop registers as OAuth client with unique client ID
- Uses Dynamic Client Registration (RFC 7591)
- Registered as **public client** (no client_secret required)
- Supports PKCE authentication method

### 3. OAuth Authorization Flow
- Claude Desktop redirects user to `/authorize` endpoint
- User sees approval dialog for MCP server access
- Upon approval, user redirected to ABsmartly SAML authentication
- SAML authentication completed, returns to OAuth callback

### 4. Token Exchange
- Authorization code exchanged for access token
- Uses PKCE verification (no client_secret needed)
- Access token contains user info and ABsmartly credentials
- Token includes both OAuth JWT and ABsmartly API key

### 5. MCP Connection Establishment
- Claude Desktop uses access token for MCP authentication
- Token validated and user props extracted
- MCP server initialized with ABsmartly credentials
- Full MCP protocol communication established

## Key Implementation Details

### OAuth JWT vs API Key Authentication

The system now properly handles both authentication methods:

1. **API Key Authentication** (`x-absmartly-api-key` header):
   - Uses `Authorization: Api-Key <key>` for ABsmartly API calls
   - Bypasses OAuth flow entirely
   - Direct MCP connection

2. **OAuth JWT Authentication** (OAuth flow):
   - Uses `Authorization: JWT <token>` for ABsmartly API calls  
   - OAuth JWT obtained from ABsmartly's OAuth provider
   - Token contains user authentication and permissions

**Authentication Selection Logic:**
```typescript
if (this.props.absmartly_api_key) {
    // We have an API key - use it
    authToken = this.props.absmartly_api_key;
    authType = 'api-key';
} else if (this.props.oauth_jwt) {
    // We have an OAuth JWT - use it  
    authToken = this.props.oauth_jwt;
    authType = 'jwt';
}

// API client uses appropriate header format
const authHeader = authType === 'jwt' ? `JWT ${authToken}` : `Api-Key ${authToken}`;
```

### Manual 401 Response Handling

The OAuth provider's `requireAuth: true` wasn't properly returning 401 responses. We implemented manual authentication checking:

```typescript
// In src/index.ts
if (url.pathname.startsWith("/sse")) {
    const authHeader = request.headers.get("Authorization");
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
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

### Public Client Registration

Claude Desktop acts as a public client (no client_secret). Our implementation:

```typescript
// In src/index.ts - Client registration
const isPublicClient = clientId.startsWith("claude-mcp-");

// For public clients, don't generate/store a client_secret
const clientSecret = isPublicClient ? undefined : `secret-${Math.random().toString(36).substring(2)}`;

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

### Client Lookup for Public Clients

```typescript
// In src/index.ts - OAuth provider configuration
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

### Auto-Registration of Deleted Clients

Claude Desktop caches client IDs aggressively. When clients are deleted but still approved, we auto-register them:

```typescript
// In src/absmartly-oauth-handler.ts
if (isApproved) {
    // Double-check that the client actually exists
    const clientExists = await c.env.OAUTH_PROVIDER.lookupClient(clientId);
    
    if (clientExists) {
        debug('Client is already approved and exists, redirecting to OAuth');
        return redirectToAbsmartlyOAuth(c, c.req.raw, oauthReqInfo, {}, debugLogs);
    } else {
        debug('Client is approved but does not exist, auto-registering new public client');
        // Client was approved but deleted, automatically register a new public client
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

## Security Considerations

### PKCE Implementation
- Public clients use PKCE instead of client_secret
- Code verifier generated by client, challenge sent to server
- Prevents authorization code interception attacks
- Compliant with OAuth 2.0 Security Best Practices

### Token Security
- Access tokens are JWTs with expiration
- Tokens contain minimal user information
- ABsmartly API keys stored securely in token payload
- No sensitive data in client-side storage

### CORS Configuration
- Proper CORS headers for cross-origin requests
- Authorization headers explicitly allowed
- Limited to necessary HTTP methods

## Environment Variables

```bash
# Required
ABSMARTLY_OAUTH_CLIENT_ID=mcp-absmartly-universal
OAUTH_KV=oauth_storage  # Cloudflare KV namespace

# Optional
ABSMARTLY_OAUTH_CLIENT_SECRET=secret  # Only for confidential clients
COOKIE_ENCRYPTION_KEY=encryption-key  # For approval cookies
```

## API Endpoints

### OAuth Provider Endpoints
- `GET /register` - Dynamic client registration
- `GET /authorize` - Authorization endpoint
- `POST /authorize` - Authorization form submission
- `POST /token` - Token exchange endpoint

### MCP Server Endpoints
- `GET /sse` - MCP Server-Sent Events endpoint
- `POST /sse` - MCP JSON-RPC endpoint

### ABsmartly Bridge Endpoints
- `GET /oauth/callback` - OAuth callback from ABsmartly
- Authentication flow handled internally

## Error Handling

### Common Error Scenarios

1. **Client Not Found**: Auto-registration for approved clients
2. **Invalid Client Secret**: Public clients don't require secrets
3. **PKCE Verification Failed**: Proper error messages returned
4. **Token Expired**: Standard OAuth error responses
5. **Invalid Scope**: Scope validation and error handling

### Debug Logging

Comprehensive debug logging throughout the flow:
- Request/response details
- Client registration events
- Token exchange steps
- Authentication failures
- PKCE verification steps

## Testing

### Unit Tests
- Client registration logic
- Token validation
- PKCE verification
- Error handling

### Integration Tests
- Complete OAuth flow end-to-end
- MCP protocol integration
- ABsmartly API authentication
- Error scenario testing

### Manual Testing
- Claude Desktop integration
- Browser-based OAuth flow
- Token refresh scenarios
- Client re-registration

## Troubleshooting

### Common Issues

1. **401 Not Triggering OAuth**: Check manual 401 response implementation
2. **Client Registration Failing**: Verify KV storage and client ID format
3. **Token Exchange Failing**: Check PKCE parameters and public client config
4. **MCP Connection Issues**: Verify token format and props extraction

### Debug Commands

```bash
# View client registrations
wrangler kv:key list --namespace-id=<OAUTH_KV_ID>

# Check specific client
wrangler kv:key get "client:claude-mcp-<ID>" --namespace-id=<OAUTH_KV_ID>

# View logs
wrangler tail
```

## Future Enhancements

1. **Refresh Token Support**: Implement token refresh for long-lived sessions
2. **Multi-Tenant Support**: Support multiple ABsmartly instances
3. **Advanced Scopes**: Fine-grained permission control
4. **Audit Logging**: Enhanced security logging
5. **Rate Limiting**: Prevent abuse of OAuth endpoints

## References

- [OAuth 2.0 RFC 6749](https://tools.ietf.org/html/rfc6749)
- [OAuth 2.0 for Native Apps RFC 8252](https://tools.ietf.org/html/rfc8252)
- [OAuth 2.0 Security Best Practices](https://tools.ietf.org/html/draft-ietf-oauth-security-topics)
- [Dynamic Client Registration RFC 7591](https://tools.ietf.org/html/rfc7591)
- [PKCE RFC 7636](https://tools.ietf.org/html/rfc7636)
- [MCP Authorization Spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization)