import type { OAuthError, TokenExchangeCallbackOptions } from "@cloudflare/workers-oauth-provider";
import { debug } from "./config";
import { CORS_HEADERS, type ABsmartlyProps } from "./shared";
import { isCimdClientId, isTrustedCimdClientId } from "./oauth/index.js";

const REFRESH_GRANT_TYPE = 'refresh_token';
const OAUTH_ERROR_INVALID_GRANT = 'invalid_grant';
const OAUTH_ERROR_TEMPORARILY_UNAVAILABLE = 'temporarily_unavailable';
const OAUTH_ERROR_INVALID_CLIENT = 'invalid_client';
const HTTP_STATUS_UNAUTHORIZED = 401;
const HTTP_STATUS_SERVICE_UNAVAILABLE = 503;
const USERINFO_PATH = '/auth/oauth/userinfo';
const API_PATH_SUFFIX = /\/v1\/?$/;
const TOKEN_PATH = '/token';
const AUTHORIZE_PATH = '/authorize';
const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';
const BASIC_AUTH_PREFIX = 'basic ';
const RESOURCE_PARAM = 'resource';
const ENDPOINT_QUERY_PARAM = 'absmartly-endpoint';

// The provider only turns thrown errors into OAuth responses when they are its own
// OAuthError (instanceof check), so the class is passed in rather than imported here:
// importing the provider pulls in cloudflare:workers, which Node tests cannot load.
type OAuthErrorClass = new (code: string, options: { description: string; statusCode?: number }) => OAuthError;

// The backend JWT in the grant props expires on its own (24h without use). On every
// refresh, check it is still valid so a client whose backend session ended is sent back
// through login instead of holding a worker token that can no longer call the API.
export async function checkBackendSessionOnRefresh(options: TokenExchangeCallbackOptions, OAuthErrorImpl: OAuthErrorClass): Promise<void> {
    if (options.grantType !== REFRESH_GRANT_TYPE) return;
    const props = options.props as ABsmartlyProps;
    if (!props?.oauth_jwt || !props.absmartly_endpoint) return;
    const baseUrl = props.absmartly_endpoint.replace(API_PATH_SUFFIX, '');
    let response: Response;
    try {
        response = await fetch(`${baseUrl}${USERINFO_PATH}`, {
            headers: { Authorization: `Bearer ${props.oauth_jwt}`, Accept: 'application/json' },
        });
    } catch {
        throw new OAuthErrorImpl(OAUTH_ERROR_TEMPORARILY_UNAVAILABLE, {
            description: 'Could not reach ABsmartly to refresh the session',
            statusCode: HTTP_STATUS_SERVICE_UNAVAILABLE,
        });
    }
    if (response.status === HTTP_STATUS_UNAUTHORIZED) {
        throw new OAuthErrorImpl(OAUTH_ERROR_INVALID_GRANT, { description: 'The ABsmartly session has ended, please sign in again' });
    }
    if (!response.ok) {
        throw new OAuthErrorImpl(OAUTH_ERROR_TEMPORARILY_UNAVAILABLE, {
            description: 'ABsmartly could not refresh the session',
            statusCode: HTTP_STATUS_SERVICE_UNAVAILABLE,
        });
    }
}

function clientIdFromBasicAuth(header: string | null): string | null {
    if (!header || !header.toLowerCase().startsWith(BASIC_AUTH_PREFIX)) return null;
    try {
        const decoded = atob(header.slice(BASIC_AUTH_PREFIX.length).trim());
        const separator = decoded.indexOf(':');
        return decodeURIComponent(separator >= 0 ? decoded.slice(0, separator) : decoded);
    } catch {
        return null;
    }
}

// The library fetches a CIMD document for any URL-shaped client_id, from parseAuthRequest,
// completeAuthorization and the token endpoint, and has no allowlist option. Reject
// untrusted ones before the library sees the request, so it never makes that request.
export async function rejectUntrustedCimdClient(request: Request, url: URL): Promise<Response | null> {
    let clientId: string | null = null;
    if (url.pathname === AUTHORIZE_PATH) {
        clientId = url.searchParams.get('client_id');
    } else if (url.pathname === TOKEN_PATH && request.method === 'POST') {
        clientId = clientIdFromBasicAuth(request.headers.get('Authorization'));
        const contentType = request.headers.get('Content-Type') || '';
        if (!clientId && contentType.toLowerCase().startsWith(FORM_CONTENT_TYPE)) {
            try {
                clientId = new URLSearchParams(await request.clone().text()).get('client_id');
            } catch {
                clientId = null;
            }
        }
    }
    if (!clientId || !isCimdClientId(clientId) || isTrustedCimdClientId(clientId)) return null;
    debug(`Rejected untrusted CIMD client_id: ${clientId}`);
    return new Response(JSON.stringify({
        error: OAUTH_ERROR_INVALID_CLIENT,
        error_description: 'This MCP client is not supported by this server',
    }), { status: HTTP_STATUS_UNAUTHORIZED, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

export function protectedResourceMetadataUrl(url: URL, pathPrefix: string): string {
    return `${url.origin}${PROTECTED_RESOURCE_METADATA_PATH}${pathPrefix}`;
}

function toOriginResource(resource: string, origin: string): { resource: string; endpoint: string | null } {
    try {
        const parsed = new URL(resource);
        if (parsed.origin !== origin) return { resource, endpoint: null };
        return { resource: origin, endpoint: parsed.searchParams.get(ENDPOINT_QUERY_PARAM) };
    } catch {
        return { resource, endpoint: null };
    }
}

// The library binds each token to the `resource` it was issued for and later requires the
// MCP request URL to match it exactly, query string included. Clients send resources like
// https://mcp.absmartly.com/mcp?absmartly-endpoint=..., so a token would then fail on
// /sse, on /mcp without the query, or after a reconnect. Rewrite same-origin resources to
// the origin, which binds tokens to this server as a whole. The ABsmartly endpoint moves
// to the query, where /authorize reads it; the grant props keep it for API calls.
export async function normalizeResourceParameter(request: Request, url: URL): Promise<Request> {
    if (url.pathname === AUTHORIZE_PATH && request.method === 'GET') {
        const resources = url.searchParams.getAll(RESOURCE_PARAM);
        if (resources.length === 0) return request;
        const rewritten = new URL(url);
        rewritten.searchParams.delete(RESOURCE_PARAM);
        for (const resource of resources) {
            const normalized = toOriginResource(resource, url.origin);
            if (!rewritten.searchParams.getAll(RESOURCE_PARAM).includes(normalized.resource)) {
                rewritten.searchParams.append(RESOURCE_PARAM, normalized.resource);
            }
            if (normalized.endpoint && !rewritten.searchParams.has(ENDPOINT_QUERY_PARAM)) {
                rewritten.searchParams.set(ENDPOINT_QUERY_PARAM, normalized.endpoint);
            }
        }
        return new Request(rewritten.toString(), request);
    }
    const contentType = request.headers.get('Content-Type') || '';
    if (url.pathname === TOKEN_PATH && request.method === 'POST' && contentType.toLowerCase().startsWith(FORM_CONTENT_TYPE)) {
        const form = new URLSearchParams(await request.clone().text());
        const resources = form.getAll(RESOURCE_PARAM);
        if (resources.length === 0) return request;
        form.delete(RESOURCE_PARAM);
        for (const resource of new Set(resources.map((r) => toOriginResource(r, url.origin).resource))) {
            form.append(RESOURCE_PARAM, resource);
        }
        const headers = new Headers(request.headers);
        headers.delete('Content-Length');
        return new Request(request.url, { method: request.method, headers, body: form.toString() });
    }
    return request;
}
