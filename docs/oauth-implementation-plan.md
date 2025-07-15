# OAuth Implementation Plan for ABsmartly MCP

## Current Situation Analysis

### Problems Identified
1. OAuth flow starts but doesn't complete - gets stuck at the authorization stage
2. The `/oauth/callback` endpoint is being called repeatedly (every second) indicating improper handling
3. Current implementation removed the custom OAuth handler that redirected to ABsmartly OAuth
4. The Cloudflare OAuth provider expects to handle the entire OAuth flow internally, but we need it to authenticate against ABsmartly

### Requirements
1. Support both API keys in the `Authorization` header: `Authorization: [Bearer] Api-Key <key>` and OAuth
2. If we let Cloudflare's OAuth provider handle the whole flow, it starts the OAuth flow even when using API keys
3. To avoid starting OAuth flow when using API keys, we need to bypass the OAuth handler when an API is detected
4. We don't want to implement the entire OAuth flow but may need to implement initial token decryption

## Key Learnings from Cloudflare OAuth Provider Analysis

### OAuth Provider Architecture
The `@cloudflare/workers-oauth-provider` module provides:

1. **Token Format**: `userId:grantId:randomSecret`
   - userId is embedded directly in the token
   - Enables user identification without additional lookups

2. **Props Storage**: 
   - User properties are encrypted and stored with the token in KV
   - Props are decrypted and passed via `ctx.props` to API handlers
   - Supports both access token props and grant props

3. **Handler Configuration**:
   ```typescript
   {
     apiHandlers: { "/sse": mcpHandler },  // Protected endpoints
     defaultHandler: customOAuthHandler,    // Handles OAuth flow
     tokenEndpoint: "/token",
     authorizeEndpoint: "/authorize",
     clientRegistrationEndpoint: "/register"
   }
   ```

4. **Authentication Flow**:
   - `handleApiRequest` (line 806) validates Bearer tokens
   - Extracts userId from token format
   - Decrypts props and injects into context
   - Routes to appropriate API handler

5. **Client Types**:
   - Public clients: `tokenEndpointAuthMethod: 'none'`
   - Confidential clients: Use client_secret
   - PKCE is enforced for public clients

### Cloudflare Demo Patterns
From analyzing the Cloudflare AI demos:
- All use custom OAuth handlers (e.g., GitHubHandler) as `defaultHandler`
- OAuth handlers manage the authorization flow and user authentication
- After successful auth, `completeAuthorization` is called with user props
- Props are encrypted and stored with the grant

## Implementation Plan

### 1. Create Custom OAuth Handler
Create `src/absmartly-oauth-handler.ts` that implements:

```typescript
class ABsmartlyOAuthHandler extends Hono {
  constructor() {
    // Handle OAuth authorization page
    this.get('/authorize', async (c) => {
      // 1. Parse OAuth request
      // 2. Check if client is approved (cookie-based)
      // 3. If approved, redirect to ABsmartly OAuth
      // 4. If not, show consent page
    });

    // Handle ABsmartly OAuth callback
    this.get('/oauth/callback', async (c) => {
      // 1. Exchange code with ABsmartly for JWT
      // 2. Decode JWT to get user info
      // 3. Call completeAuthorization with user props
      // 4. Redirect back to client
    });
  }
}
```

### 2. Update OAuth Provider Configuration
```typescript
const oauthProvider = new OAuthProvider({
  apiHandlers: {
    "/sse": baseMcpHandler  // OAuth provider validates tokens
  },
  defaultHandler: new ABsmartlyOAuthHandler(),  // Our custom handler
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  // ...
});
```

### 3. Implement Unified Session Handling

#### Session Structure
```typescript
interface UnifiedSession {
  userId: string;
  email: string;
  name: string;
  absmartly_endpoint: string;
  absmartly_api_key?: string;
  oauth_jwt?: string;
  createdAt: number;
  expiresAt: number;
}

// Session key: `session:${userId}`
```

#### For API Keys:
```typescript
// In main handler when API key detected:
const apiClient = new ABsmartlyAPIClient(apiKey, endpoint, 'api-key');
const userResponse = await apiClient.getCurrentUser();
const user = userResponse.data;

// Create session
const session: UnifiedSession = {
  userId: user.id.toString(),
  email: user.email,
  name: `${user.first_name} ${user.last_name}`,
  absmartly_endpoint: endpoint,
  absmartly_api_key: apiKey,
  createdAt: Date.now(),
  expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
};

await env.OAUTH_KV.put(`session:${user.id}`, JSON.stringify(session), {
  expirationTtl: 86400 // 24 hours
});
```

#### For OAuth:
```typescript
// In OAuth handler's completeAuthorization:
const props = {
  email: userInfo.email,
  name: userInfo.name,
  absmartly_endpoint: endpoint,
  oauth_jwt: jwt,
  user_id: userInfo.id
};

// OAuth provider handles session/token storage
await completeAuthorization({
  request: authRequest,
  userId: userInfo.id.toString(),
  metadata: {},
  scope: authRequest.scope,
  props: props
});
```

### 4. Fix Main Handler Flow
```typescript
export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const url = new URL(request.url);
    const { apiKey, endpoint } = detectApiKey(request);
    
    // Handle API key authentication
    if (url.pathname.startsWith("/sse") && apiKey) {
      // Fetch user info
      const apiClient = new ABsmartlyAPIClient(apiKey, endpoint, 'api-key');
      const userResponse = await apiClient.getCurrentUser();
      
      if (!userResponse.ok) {
        return new Response("Unauthorized", { status: 401 });
      }
      
      // Create props from user data
      const user = userResponse.data;
      const props = {
        email: user.email,
        name: `${user.first_name} ${user.last_name}`,
        absmartly_endpoint: endpoint,
        absmartly_api_key: apiKey,
        user_id: user.id.toString()
      };
      
      // Pass to MCP handler with props
      ctx.props = props;
      return await baseMcpHandler(request, env, ctx);
    }
    
    // All other requests go through OAuth provider
    return await oauthProvider.fetch(request, env, ctx);
  }
};
```

### 5. Benefits of This Approach

1. **Clean Separation**: 
   - OAuth provider handles token validation and protected endpoints
   - Custom handler manages ABsmartly OAuth integration
   - Main handler manages API key bypass

2. **Unified Sessions**: 
   - Both auth methods use consistent session structure
   - userId as primary key enables cross-auth session lookup

3. **Proper OAuth Flow**:
   - Custom handler integrates with ABsmartly OAuth
   - OAuth provider manages token lifecycle
   - No interference with API key authentication

4. **Security**:
   - Props are encrypted by OAuth provider
   - Sessions expire after 24 hours
   - Client approval tracking via signed cookies

## Implementation Steps

1. **Create ABsmartly OAuth Handler**
   - Implement authorization and callback endpoints
   - Handle client approval with signed cookies
   - Exchange codes with ABsmartly OAuth

2. **Update OAuth Provider Configuration**
   - Use custom handler as defaultHandler
   - Keep /sse in apiHandlers

3. **Implement API Key User Lookup**
   - Add getCurrentUser call for API keys
   - Create unified session structure

4. **Update Main Handler**
   - Remove FORCE_OAUTH_FLOW flag
   - Implement API key bypass with user lookup
   - Pass props correctly to MCP handler

5. **Test Both Flows**
   - API key authentication with user lookup
   - OAuth flow with ABsmartly integration
   - Session persistence and retrieval

## Error Handling

1. **API Key Errors**:
   - Invalid API key → 401 Unauthorized
   - getCurrentUser fails → 401 Unauthorized
   - Network errors → 503 Service Unavailable

2. **OAuth Errors**:
   - Invalid client → OAuth provider handles
   - Token expired → OAuth provider returns 401
   - ABsmartly OAuth fails → Show error page

## Security Considerations

1. **API Key Protection**:
   - Never log full API keys
   - Use secure comparison for validation
   - Rate limit getCurrentUser calls

2. **OAuth Security**:
   - Validate state parameter
   - Use PKCE for public clients
   - Encrypt sensitive data in cookies

3. **Session Security**:
   - Use userId as session key (no PII in key)
   - Set appropriate TTLs
   - Clean up expired sessions