export const DEFAULT_ABSMARTLY_ENDPOINT = "https://sandbox.absmartly.com";
export const DEFAULT_OAUTH_CLIENT_ID = "mcp-absmartly-universal";
export const DEFAULT_API_KEY_USER_EMAIL = "api-key-user";
export const DEFAULT_API_KEY_USER_NAME = "API Key User";
export const DEFAULT_ABSMARTLY_DOMAIN = "absmartly.com";
export const CLAUDE_AUTH_CALLBACK_URI = "https://claude.ai/api/mcp/auth_callback";
export {
  REQUIRED_CODE_CHALLENGE_METHOD,
  OAUTH_ERROR_INVALID_REDIRECT_URI as INVALID_REDIRECT_URI_ERROR,
  MESSAGE_INVALID_REDIRECT_URI as INVALID_REDIRECT_URI_MESSAGE,
  isAllowedRedirectUri,
  generatePkcePair,
  escapeHtml,
  HTML_ESCAPE_MAP,
} from "./oauth/index.js";
import { OAUTH_ERROR_INVALID_REDIRECT_URI, REQUIRED_CODE_CHALLENGE_METHOD, readRegistrationBody, validateClientRegistration } from "./oauth/index.js";

const HTTP_STATUS_PAYLOAD_TOO_LARGE = 413;

export const API_KEY_SESSION_TTL_SECONDS = 300;
export const SESSION_TTL_SECONDS = 86400;
export const OAUTH_STATE_TTL_SECONDS = 120;
export const APPROVAL_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const ENTITIES_CACHE_TTL_MS = 5 * 60 * 1000;

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
} as const;

export const SSE_PATH = "/sse";
export const MCP_PATH = "/mcp";
export const TRANSPORT_PREFIXES = [SSE_PATH, MCP_PATH] as const;

export type ABsmartlyProps = {
  email: string;
  name: string;
  absmartly_endpoint: string;
  absmartly_api_key?: string;
  oauth_jwt?: string;
  user_id: string;
};

export function normalizeBaseUrl(endpoint: string): string {
  return endpoint.replace(/\/$/, '').replace(/\/v1$/, '');
}

export function buildAuthHeader(authToken: string, isApiKey: boolean): Record<string, string> {
  const authType = isApiKey ? 'Api-Key' : 'JWT';
  return {
    'Authorization': `${authType} ${authToken}`,
    'Content-Type': 'application/json',
  };
}

const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

export function extractEndpointFromPath(pathname: string, prefix: string | readonly string[]): string | null {
  const prefixes = Array.isArray(prefix) ? prefix : [prefix];
  for (const p of prefixes) {
    if (!pathname.startsWith(p + '/')) continue;
    const hostPart = pathname.slice(p.length + 1).replace(/\/+$/, '');
    if (!hostPart) continue;
    const host = hostPart.includes('.') ? hostPart : `${hostPart}.${DEFAULT_ABSMARTLY_DOMAIN}`;
    if (!HOSTNAME_PATTERN.test(host)) return null;
    return `https://${host}`;
  }
  return null;
}

function registrationErrorResponse(error: string, description: string, status: number): Response {
  return new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// Rejects oversized bodies and disallowed redirect URIs before the OAuth provider sees
// the registration. Other malformed metadata is left for the provider to report.
export async function rejectDisallowedRedirectUris(request: Request): Promise<Response | null> {
  const read = await readRegistrationBody(request.clone());
  if (!read.ok) {
    return read.error.status === HTTP_STATUS_PAYLOAD_TOO_LARGE
      ? registrationErrorResponse(read.error.error, read.error.description, read.error.status)
      : null;
  }
  const body = read.body as { redirect_uris?: unknown };
  if (!Array.isArray(body?.redirect_uris)) return null;
  const result = validateClientRegistration(body);
  if (result.ok || result.error.error !== OAUTH_ERROR_INVALID_REDIRECT_URI) return null;
  return registrationErrorResponse(result.error.error, result.error.description, result.error.status);
}

const OAUTH_AUTHORIZATION_SERVER_METADATA_PATH = "/.well-known/oauth-authorization-server";
const OAUTH_PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";
export const API_KEY_SESSION_KV_PREFIX = "api_key_session:";
const OAUTH_NOT_AVAILABLE_ERROR = "oauth_not_available";
const OAUTH_NOT_AVAILABLE_DESCRIPTION = "OAuth not available when using API key authentication";

function isOAuthDiscoveryPath(pathname: string): boolean {
  return [OAUTH_AUTHORIZATION_SERVER_METADATA_PATH, OAUTH_PROTECTED_RESOURCE_METADATA_PATH]
    .some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function handleOAuthDiscovery(
  request: Request,
  kv: KVNamespace | undefined,
  clientFingerprint: string,
  requestHasApiKey: boolean,
  fetchProviderResponse: () => Promise<Response>
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isOAuthDiscoveryPath(url.pathname)) return null;

  if (requestHasApiKey || await safeKvGet(kv, `${API_KEY_SESSION_KV_PREFIX}${clientFingerprint}`)) {
    return new Response(JSON.stringify({
      error: OAUTH_NOT_AVAILABLE_ERROR,
      error_description: OAUTH_NOT_AVAILABLE_DESCRIPTION,
    }), { status: 404 });
  }

  if (url.pathname !== OAUTH_AUTHORIZATION_SERVER_METADATA_PATH || request.method !== "GET") return null;
  const response = await fetchProviderResponse();
  if (!response.ok) return response;
  const metadata = await response.json() as Record<string, unknown>;
  metadata.code_challenge_methods_supported = [REQUIRED_CODE_CHALLENGE_METHOD];
  return new Response(JSON.stringify(metadata), {
    status: response.status,
    headers: response.headers,
  });
}

export function pickDefined(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}

export function buildQueryString(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  }
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

export function detectApiKey(
  request: Request,
  defaultEndpoint: string = DEFAULT_ABSMARTLY_ENDPOINT
): { apiKey: string | null; endpoint: string | null } {
  const url = new URL(request.url);
  const authHeader = request.headers.get("Authorization");

  const endpointFromPath = extractEndpointFromPath(url.pathname, TRANSPORT_PREFIXES);

  const apiKeyFromQuery = url.searchParams.get("api_key") || url.searchParams.get("apikey");
  if (apiKeyFromQuery) {
    const endpoint = url.searchParams.get("absmartly-endpoint") ||
                    request.headers.get("x-absmartly-endpoint") ||
                    endpointFromPath ||
                    defaultEndpoint;
    return { apiKey: apiKeyFromQuery, endpoint };
  }

  if (authHeader) {
    const parts = authHeader.trim().split(/\s+/);

    if (parts[0] === "Bearer" && parts.length === 2) {
      return { apiKey: null, endpoint: null };
    }

    let apiKey = "";
    let absmartlyEndpoint = url.searchParams.get("absmartly-endpoint") ||
                            request.headers.get("x-absmartly-endpoint") ||
                            endpointFromPath ||
                            "";

    let startIndex = 0;
    if (parts[0] === "Bearer") startIndex = 1;
    if (parts[startIndex] === "Api-Key") startIndex++;

    if (parts[startIndex] && parts[startIndex + 1]) {
      const potentialEndpoint = parts[startIndex];
      if (!potentialEndpoint.includes('.') && !potentialEndpoint.includes('://')) {
        if (!absmartlyEndpoint) absmartlyEndpoint = `https://${potentialEndpoint}.${DEFAULT_ABSMARTLY_DOMAIN}`;
        apiKey = parts[startIndex + 1];
      } else if (potentialEndpoint.includes('.') || potentialEndpoint.includes('://')) {
        if (!absmartlyEndpoint) absmartlyEndpoint = potentialEndpoint.startsWith('http') ? potentialEndpoint : `https://${potentialEndpoint}`;
        apiKey = parts[startIndex + 1];
      } else {
        apiKey = potentialEndpoint;
      }
    } else if (parts[startIndex]) {
      apiKey = parts[startIndex];
    }

    if (apiKey) {
      if (!absmartlyEndpoint) absmartlyEndpoint = defaultEndpoint;
      return { apiKey, endpoint: absmartlyEndpoint };
    }
  }

  return { apiKey: null, endpoint: null };
}

export async function safeKvPut(
  kv: KVNamespace | undefined,
  key: string,
  value: string,
  options?: KVNamespacePutOptions
): Promise<void> {
  if (!kv) return;
  try {
    await kv.put(key, value, options);
  } catch (error) {
    console.warn(`KV put failed for key "${key}":`, error);
  }
}

export async function safeKvGet(
  kv: KVNamespace | undefined,
  key: string
): Promise<string | null> {
  if (!kv) return null;
  try {
    return await kv.get(key);
  } catch (error) {
    console.warn(`KV get failed for key "${key}":`, error);
    return null;
  }
}
