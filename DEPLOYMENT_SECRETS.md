# Deployment Secrets Configuration

When deploying this MCP server, you need to configure the following secrets:

## Required Secrets

### 1. COOKIE_ENCRYPTION_KEY
This secret is used to sign cookies for OAuth approval persistence. It must be at least 32 characters long and kept confidential.

**Generate a secure key:**
```bash
# Using openssl
openssl rand -base64 32

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Set the secret in Cloudflare:**
```bash
npx wrangler secret put COOKIE_ENCRYPTION_KEY
# Then paste your generated key when prompted
```

## Optional Configuration

### ABSMARTLY_OAUTH_CLIENT_ID and ABSMARTLY_OAUTH_CLIENT_SECRET
These are pre-configured for the universal MCP client. You don't need to change them unless you're setting up a custom OAuth client in your ABsmartly instance.

- Default Client ID: `mcp-absmartly-universal`
- Default Client Secret: `mcp-secret`

The universal client is designed for public MCP implementations where the client secret cannot be kept confidential. Security is enforced through redirect URI validation on the ABsmartly side.

## Important Security Notes

1. **Never commit COOKIE_ENCRYPTION_KEY to version control**
2. Each deployment should use a unique COOKIE_ENCRYPTION_KEY
3. If you suspect the key has been compromised, regenerate it immediately (users will need to re-approve the OAuth client)