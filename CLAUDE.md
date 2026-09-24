# Claude Code Guidelines

## Code Quality Standards

### Constants and Magic Strings

**NEVER use magic strings or hardcoded values inline in code**

- **All default values must be declared as constants at the top of the file**
- **Use descriptive constant names with ALL_CAPS naming convention**
- **Group related constants together**

### Understanding Dependencies Before Changes

**NEVER make code changes without understanding the underlying implementation**

- **Always read source code in node_modules to understand how dependencies work**
- **Understand the differences between similar methods before switching between them**
- **Research function behavior, parameters, and return values before using them**
- **Never guess or assume how third-party code works**

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
Two OAuth layers are involved:
1. **ABsmartly backend** (`office/backend/src/routes/auth/oauth_provider.ts` in the `abs` repo) authenticates the user (SAML, password) and issues the backend credential.
2. **This worker** (`src/absmartly-oauth-handler.ts` + `@cloudflare/workers-oauth-provider`) is the authorization server MCP clients talk to. It issues its own worker tokens and keeps the backend JWT in the grant's encrypted props (`props.oauth_jwt`), which `ABsmartlyMCP` uses for API calls.

### Shared policy: `src/oauth/` (published as `@absmartly/mcp/oauth`)
Authorization-server policy is platform-neutral so the backend's `/mcp` endpoint can use the same code. It uses only Web APIs (`URL`, `fetch`, `crypto.subtle`); never import `hono`, `@cloudflare/*`, `agents` or `KVNamespace` there, and use `.js` import specifiers.
- `redirect-policy.ts`: `isAllowedRedirectUri`. Codes may only go to the hosted callbacks in `ALLOWED_REDIRECT_HTTPS_CALLBACKS`, loopback http (any port), or the app schemes in `ALLOWED_REDIRECT_CUSTOM_SCHEMES`. To support a new hosted MCP client, add its exact callback to the constant.
- `registration.ts`: `validateClientRegistration` for `/register` (allowlist, auth method) and a byte-counting body reader.
- `cimd.ts`: Client ID Metadata Documents. Only URLs in `TRUSTED_CIMD_CLIENT_IDS` are ever fetched.
- `consent.ts`: `beginAuthorization` / `submitConsent`. The consent step is a server-side transaction bound to a per-transaction `__Host-` cookie; the POST reads every parameter from the stored transaction, never the form. Also enforces a registered + allowlisted `redirect_uri` and S256 PKCE on every request, including for clients registered before the allowlist existed.
- `pages.ts`: consent and endpoint pages (show the redirect host; extra warning for loopback redirects). Sent with `X-Frame-Options: DENY`.

### Worker flow
1. `/sse` or `/mcp` without a token returns 401 (`handleMcpTransportRequest` in `src/index.ts`).
2. The client registers at `/register`; `src/index.ts` rejects disallowed redirect URIs before the provider sees them.
3. `GET /authorize` → `beginAuthorization` → endpoint form (if the ABsmartly URL is unknown) → consent page. Approvals are remembered server-side per browser (`oauth:approvals:*`).
4. `POST /authorize` → `submitConsent` → redirect to `{endpoint}/auth/oauth/authorize` with the worker's own PKCE, and a `__Host-` callback cookie named after the state token.
5. `/oauth/callback` requires that cookie, exchanges the backend code, reads `/auth/oauth/userinfo`, and calls `completeAuthorization`.

Note: `@cloudflare/workers-oauth-provider` 0.10.3 reads ordinary clients straight from KV (`client:<id>`); a URL-shaped `client_id` is instead resolved as a Client ID Metadata Document (fetched live, not from KV) when `clientIdMetadataDocumentEnabled` is set — see `cimd.ts` above and `rejectUntrustedCimdClient` in `oauth-worker-guards.ts`, which rejects any such `client_id` not in `TRUSTED_CIMD_CLIENT_IDS` before the provider can fetch it. The library has no `clientLookup` option.

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