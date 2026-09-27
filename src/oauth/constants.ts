export const SCOPE_MCP_ACCESS = "mcp:access";
export const SCOPE_USER_INFO = "user:info";
export const SUPPORTED_SCOPES = [SCOPE_MCP_ACCESS, SCOPE_USER_INFO] as const;
export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  [SCOPE_MCP_ACCESS]: "Access ABsmartly via the MCP server (read and modify experiments)",
  [SCOPE_USER_INFO]: "Read your basic ABsmartly profile (name and email)",
};

export const REQUIRED_CODE_CHALLENGE_METHOD = "S256";
export const SUPPORTED_CODE_CHALLENGE_METHODS = [REQUIRED_CODE_CHALLENGE_METHOD];

export const CONSENT_TTL_SECONDS = 10 * 60;
export const APPROVAL_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const CONSENT_COOKIE_NAME = "absmartly-oauth-consent";
export const APPROVALS_COOKIE_NAME = "absmartly-oauth-approvals";
export const HOST_COOKIE_PREFIX = "__Host-";

export const CONSENT_STATE_KEY_PREFIX = "oauth:consent:";

// Hosted MCP client callbacks allowed to receive authorization codes over https,
// matched on origin + path. An entry ending in "/" matches any non-empty suffix
// (ChatGPT generates a per-connector callback id).
export const ALLOWED_REDIRECT_HTTPS_CALLBACKS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://chatgpt.com/connector_platform_oauth_redirect",
  "https://chatgpt.com/connector/oauth/",
  "https://playground.ai.cloudflare.com/oauth/callback",
  "https://vscode.dev/redirect",
  "https://insiders.vscode.dev/redirect",
  "https://www.cursor.com/agents/mcp/oauth/callback",
  "https://integrations.productboard.com/oauth2/callback",
];
export const ALLOWED_REDIRECT_LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
export const ALLOWED_REDIRECT_CUSTOM_SCHEMES = ["cursor:", "claude:"];

// Client ID Metadata Documents (CIMD) we fetch and trust. Only these URLs are ever
// fetched, which also rules out server-side request forgery through client_id.
export const TRUSTED_CIMD_CLIENT_IDS = [
  "https://claude.ai/oauth/claude-code-client-metadata",
  "https://vscode.dev/oauth/client-metadata.json",
];
export const CIMD_MAX_DOCUMENT_BYTES = 5 * 1024;
export const CIMD_FETCH_TIMEOUT_MS = 5000;
export const CIMD_CACHE_TTL_MS = 60 * 60 * 1000;

export const MAX_REGISTRATION_BODY_BYTES = 1024 * 1024;
export const MAX_LOGGED_REDIRECT_URI_LENGTH = 200;
export const CLIENT_ID_LENGTH = 16;
export const CLIENT_SECRET_LENGTH = 32;
export const TOKEN_ENDPOINT_AUTH_NONE = "none";
export const TOKEN_ENDPOINT_AUTH_CLIENT_SECRET_BASIC = "client_secret_basic";
export const TOKEN_ENDPOINT_AUTH_CLIENT_SECRET_POST = "client_secret_post";
export const SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS = [
  TOKEN_ENDPOINT_AUTH_CLIENT_SECRET_BASIC,
  TOKEN_ENDPOINT_AUTH_CLIENT_SECRET_POST,
  TOKEN_ENDPOINT_AUTH_NONE,
];

export const OAUTH_ERROR_INVALID_REQUEST = "invalid_request";
export const OAUTH_ERROR_INVALID_REDIRECT_URI = "invalid_redirect_uri";
export const OAUTH_ERROR_INVALID_CLIENT_METADATA = "invalid_client_metadata";
export const OAUTH_ERROR_ACCESS_DENIED = "access_denied";

export const MESSAGE_INVALID_REDIRECT_URI = "Invalid redirect URI";
export const MESSAGE_PKCE_REQUIRED = `PKCE with code_challenge_method=${REQUIRED_CODE_CHALLENGE_METHOD} is required`;
export const MESSAGE_CLIENT_NOT_FOUND = "Client not found";
export const MESSAGE_UNTRUSTED_CLIENT = "This MCP client is not supported by this server";
export const MESSAGE_TRANSACTION_INVALID = "Authorization request expired or invalid, please restart the connection from your MCP client";
export const MESSAGE_ENDPOINT_REQUIRED = "ABsmartly endpoint is required";
export const MESSAGE_INVALID_ACTION = "Invalid action";
export const MESSAGE_SERVICE_UNAVAILABLE = "Service temporarily unavailable, please try again";
export const MESSAGE_REDIRECT_URI_NOT_ALLOWED = "One or more redirect_uris are not allowed";
export const MESSAGE_REGISTRATION_TOO_LARGE = "Request payload too large, must be under 1 MiB";
