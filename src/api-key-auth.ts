import { APIClient, APIError } from "@absmartly/cli/api-client";
import { debug } from "./config.js";
import { FetchHttpClient, FetchNetworkError } from "./fetch-adapter.js";
import { oauthBearerChallenge } from "./oauth-worker-guards.js";
import { HTTP_STATUS_BAD_REQUEST, MESSAGE_INVALID_ENDPOINT, tryParseAbsmartlyEndpoint } from "./oauth/index.js";
import { withPathIdGuard } from "./path-id-guard.js";
import {
    ABsmartlyProps,
    CORS_HEADERS,
    DEFAULT_ABSMARTLY_ENDPOINT,
    DEFAULT_API_KEY_USER_EMAIL,
    DEFAULT_API_KEY_USER_NAME,
    SESSION_TTL_SECONDS,
    safeKvPut,
} from "./shared.js";

export type ApiKeyTransportRoute = {
    pathPrefix: string;
    handler: { fetch: (request: Request, env: any, ctx: any) => Promise<Response> };
};

const HTTP_STATUS_UNAUTHORIZED = 401;
const HTTP_STATUS_FORBIDDEN = 403;
const HTTP_STATUS_INTERNAL_SERVER_ERROR = 500;
const HTTP_STATUS_SERVICE_UNAVAILABLE = 503;
const UNAUTHORIZED_BODY = "Unauthorized";
const FORBIDDEN_FALLBACK_MESSAGE = "Forbidden";
const SERVICE_UNAVAILABLE_BODY = "ABsmartly service temporarily unavailable";
const INTERNAL_ERROR_BODY = "Internal Server Error";

export type ApiKeyVerification =
    | { ok: true; user: any }
    // The key is invalid (or the backend rejected it for a reason other than permissions).
    | { ok: false; error: 'unauthorized' }
    // The key is valid but its user may not read /auth/current-user (Self:Get / User:Get).
    | { ok: false; error: 'forbidden'; message: string }
    | { ok: false; error: 'server_error' | 'network_error' };

// The backend answers a failed permission check with { ok: false, errors: [message] };
// other shapes are tolerated so the client still sees whatever the backend said.
function backendErrorMessage(body: unknown): string {
    if (typeof body === 'string') return body.trim() || FORBIDDEN_FALLBACK_MESSAGE;
    if (body && typeof body === 'object') {
        const { errors, message, error } = body as { errors?: unknown; message?: unknown; error?: unknown };
        if (Array.isArray(errors)) {
            const texts = errors.filter((e): e is string => typeof e === 'string' && e.length > 0);
            if (texts.length > 0) return texts.join(', ');
        }
        if (typeof message === 'string' && message) return message;
        if (typeof error === 'string' && error) return error;
    }
    return FORBIDDEN_FALLBACK_MESSAGE;
}

/** `endpoint` is a parsed endpoint's apiUrl (see handleApiKeyTransportRequest). */
export async function verifyApiKey(apiKey: string, endpoint: string): Promise<ApiKeyVerification> {
    try {
        const httpClient = new FetchHttpClient(endpoint, { authToken: apiKey, authType: 'api-key' });
        const client = withPathIdGuard(new APIClient(httpClient));
        const user = await client.getCurrentUser();
        return { ok: true, user };
    } catch (error) {
        console.error('API key verification error:', error instanceof Error ? error.message : String(error));
        if (error instanceof FetchNetworkError) return { ok: false, error: 'network_error' };
        if (error instanceof APIError && error.statusCode !== undefined) {
            if (error.statusCode >= HTTP_STATUS_INTERNAL_SERVER_ERROR) return { ok: false, error: 'server_error' };
            if (error.statusCode === HTTP_STATUS_FORBIDDEN) {
                return { ok: false, error: 'forbidden', message: backendErrorMessage(error.response) };
            }
        }
        return { ok: false, error: 'unauthorized' };
    }
}

// Maps a failed verification to the transport response. Only a rejected key gets
// 401 + the OAuth challenge: MCP clients answer that by restarting OAuth, which
// cannot help a valid key that merely lacks permissions (403, no challenge).
function verificationFailureResponse(request: Request, route: ApiKeyTransportRoute, result: Exclude<ApiKeyVerification, { ok: true }>): Response {
    switch (result.error) {
        case 'forbidden':
            return new Response(result.message, { status: HTTP_STATUS_FORBIDDEN, headers: CORS_HEADERS });
        case 'server_error':
        case 'network_error':
            return new Response(SERVICE_UNAVAILABLE_BODY, { status: HTTP_STATUS_SERVICE_UNAVAILABLE, headers: CORS_HEADERS });
        case 'unauthorized':
            return new Response(UNAUTHORIZED_BODY, {
                status: HTTP_STATUS_UNAUTHORIZED,
                headers: {
                    ...CORS_HEADERS,
                    "WWW-Authenticate": oauthBearerChallenge(new URL(request.url), route.pathPrefix),
                },
            });
    }
}

export async function handleApiKeyTransportRequest(
    request: Request,
    env: any,
    ctx: any,
    route: ApiKeyTransportRoute,
    apiKey: string,
    endpoint: string | null
): Promise<Response> {
    debug(`API key detected on ${route.pathPrefix}, bypassing OAuth flow`);

    try {
        // Parse the endpoint where it enters, and store the canonical form.
        const parsed = tryParseAbsmartlyEndpoint(endpoint || DEFAULT_ABSMARTLY_ENDPOINT);
        if (!parsed) {
            console.error(`Rejected API key request: ${MESSAGE_INVALID_ENDPOINT}: ${endpoint}`);
            return new Response(MESSAGE_INVALID_ENDPOINT, { status: HTTP_STATUS_BAD_REQUEST, headers: CORS_HEADERS });
        }
        const apiUrl = parsed.apiUrl;

        const verifyResult = await verifyApiKey(apiKey, apiUrl);

        if (!verifyResult.ok) {
            console.error(`Failed to verify API key: ${verifyResult.error}`);
            return verificationFailureResponse(request, route, verifyResult);
        }

        const userData = verifyResult.user;
        const userId = userData.id?.toString() || userData.email;

        if (!userData.email) {
            debug('No email found in API response for API key authentication, user data:', userData);
        }

        const props: ABsmartlyProps = {
            email: userData.email || DEFAULT_API_KEY_USER_EMAIL,
            name: `${userData.first_name || ''} ${userData.last_name || ''}`.trim() || userData.email || DEFAULT_API_KEY_USER_NAME,
            absmartly_endpoint: apiUrl,
            absmartly_api_key: apiKey,
            user_id: userId
        };

        debug(`API key authenticated for user: ${props.email}`);

        const session = {
            userId,
            email: props.email,
            name: props.name,
            absmartly_endpoint: props.absmartly_endpoint,
            absmartly_api_key: apiKey,
            createdAt: Date.now(),
            expiresAt: Date.now() + (SESSION_TTL_SECONDS * 1000)
        };

        await safeKvPut(env.OAUTH_KV, `session:${userId}`, JSON.stringify(session), {
            expirationTtl: SESSION_TTL_SECONDS,
        });

        ctx.props = props;
        return await route.handler.fetch(request, env, ctx);
    } catch (error) {
        console.error("Error during API key authentication:", error);
        return new Response(INTERNAL_ERROR_BODY, {
            status: HTTP_STATUS_INTERNAL_SERVER_ERROR,
            headers: CORS_HEADERS,
        });
    }
}
