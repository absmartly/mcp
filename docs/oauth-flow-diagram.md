# ABsmartly MCP OAuth Flow Diagram

## Overview

This document describes the complete OAuth flow for the ABsmartly MCP server, including how it handles public clients (like the Cloudflare AI Playground) that use PKCE instead of client secrets.

## Key Concepts

### Public vs Confidential Clients
- **Public Client**: Cannot securely store secrets (e.g., browser-based apps, SPAs)
- **Confidential Client**: Can securely store secrets (e.g., server-side apps)
- Public clients use `token_endpoint_auth_method: "none"` with PKCE

### PKCE (Proof Key for Code Exchange)
- Security mechanism for public clients
- Replaces client secret with dynamically generated code_verifier/code_challenge
- Required by OAuth 2.1 and MCP specification

## Complete OAuth Flow

```mermaid
sequenceDiagram
    participant P as Cloudflare AI Playground<br/>(Public Client)
    participant W as ABsmartly MCP Worker<br/>(Cloudflare)
    participant B as ABsmartly Backend<br/>(OAuth Provider)
    participant U as User

    Note over P,B: Step 1: Discovery & Registration
    P->>W: GET /.well-known/oauth-authorization-server
    W-->>P: {<br/>  "token_endpoint_auth_methods_supported": ["none"],<br/>  "code_challenge_methods_supported": ["S256"]<br/>}
    
    P->>W: POST /register<br/>{redirect_uris: [...]}
    Note over W: Returns universal client<br/>instead of creating new
    W-->>P: {<br/>  client_id: "mcp-absmartly-universal",<br/>  client_secret: "none",<br/>  token_endpoint_auth_method: "none"<br/>}

    Note over P,B: Step 2: Authorization Flow with PKCE
    P->>P: Generate:<br/>code_verifier = random<br/>code_challenge = SHA256(code_verifier)
    
    P->>W: GET /authorize?<br/>client_id=mcp-absmartly-universal<br/>&code_challenge=XXX<br/>&code_challenge_method=S256<br/>&resource=https://mcp.absmartly.com/sse<br/>&redirect_uri=...
    
    W->>W: Store endpoint from resource param<br/>in KV storage
    
    W->>B: Redirect to backend<br/>/auth/oauth/authorize?<br/>client_id=mcp-absmartly-universal<br/>&redirect_uri=/oauth/callback
    
    B->>U: Show login page (SAML/Username)
    U->>B: Enter credentials
    B->>B: Authenticate user<br/>Generate authorization code
    B-->>W: Redirect to /oauth/callback?code=BACKEND_CODE

    Note over P,B: Step 3: Backend Token Exchange
    W->>B: POST /auth/oauth/token<br/>{<br/>  grant_type: "authorization_code",<br/>  code: BACKEND_CODE,<br/>  client_id: "mcp-absmartly-universal"<br/>}
    
    B->>B: Validate code<br/>Generate JWT token
    B-->>W: {<br/>  access_token: JWT,<br/>  token_type: "Bearer"<br/>}
    
    Note over P,B: Step 4: Complete Worker Authorization
    W->>W: Extract user info from JWT<br/>Store in props via completeAuthorization()
    W->>W: Generate new authorization code<br/>Format: email:token:signature
    W-->>P: Redirect to playground callback<br/>with WORKER_CODE

    Note over P,B: Step 5: Playground Token Exchange
    P->>W: POST /token<br/>{<br/>  grant_type: "authorization_code",<br/>  code: WORKER_CODE,<br/>  client_id: "mcp-absmartly-universal",<br/>  client_secret: "none",<br/>  code_verifier: XXX<br/>}
    
    W->>W: 1. Strip client_secret=none<br/>2. Pass to OAuth provider<br/>3. Validate PKCE
    W-->>P: {<br/>  access_token: MCP_TOKEN,<br/>  token_type: "Bearer"<br/>}

    Note over P,B: Step 6: MCP Connection
    P->>W: SSE /sse<br/>Authorization: Bearer MCP_TOKEN
    W->>W: Extract props from token<br/>(JWT, endpoint, user info)
    W->>W: Initialize MCP with ABsmartly API
    W-->>P: MCP tools available via SSE
```

## Token Types in the Flow

1. **BACKEND_CODE**: Authorization code from ABsmartly backend
2. **JWT**: Access token from ABsmartly backend (contains user auth)
3. **WORKER_CODE**: Authorization code from Cloudflare Worker (format: `email:token:signature`)
4. **MCP_TOKEN**: Final access token for MCP connection

## Why `client_secret: "none"`?

1. Playground is a **public client** (runs in browser)
2. Cannot securely store secrets
3. Uses PKCE for security instead
4. When we return `token_endpoint_auth_method: "none"` in registration, playground sends `client_secret=none` to indicate this auth method

## Security Considerations

1. **PKCE Required**: Public clients must use PKCE
2. **Resource Parameter**: Used to bind tokens to specific MCP server
3. **Token Validation**: Tokens must be validated for correct audience
4. **No Secrets in Public Clients**: Never send real secrets to browser apps

## Current Implementation Notes

- Worker intercepts `/token` requests with `client_secret=none`
- Strips the parameter before passing to OAuth provider
- OAuth provider validates using PKCE instead of client secret
- This allows public clients to authenticate securely