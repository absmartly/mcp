export const DEFAULT_ABSMARTLY_ENDPOINT = "https://sandbox.absmartly.com";
export const DEFAULT_OAUTH_CLIENT_ID = "mcp-absmartly-universal";
export const DEFAULT_API_KEY_USER_EMAIL = "api-key-user";
export const DEFAULT_API_KEY_USER_NAME = "API Key User";
export const DEFAULT_ABSMARTLY_DOMAIN = "absmartly.com";
export const CLAUDE_AUTH_CALLBACK_URI = "https://claude.ai/api/mcp/auth_callback";

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

export function extractEndpointFromPath(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix + '/')) return null;
  const hostPart = pathname.slice(prefix.length + 1).replace(/\/+$/, '');
  if (!hostPart) return null;
  const host = hostPart.includes('.') ? hostPart : `${hostPart}.${DEFAULT_ABSMARTLY_DOMAIN}`;
  return `https://${host}`;
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

export const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char]);
}

export function detectApiKey(
  request: Request,
  defaultEndpoint: string = DEFAULT_ABSMARTLY_ENDPOINT
): { apiKey: string | null; endpoint: string | null } {
  const url = new URL(request.url);
  const authHeader = request.headers.get("Authorization");

  const endpointFromPath = extractEndpointFromPath(url.pathname, '/sse');

  const apiKeyFromQuery = url.searchParams.get("api_key") || url.searchParams.get("apikey");
  if (apiKeyFromQuery) {
    const endpoint = url.searchParams.get("absmartly-endpoint") ||
                    request.headers.get("x-absmartly-endpoint") ||
                    endpointFromPath;
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
