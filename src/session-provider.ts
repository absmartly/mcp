import { ABsmartlyMCP } from "./index";
import type { Env } from "./types";
import { debug } from "./config";

const DEFAULT_ABSMARTLY_API_ENDPOINT = "https://sandbox.absmartly.com";

type ABsmartlyProps = {
    email: string;
    name: string;
    absmartly_endpoint: string;
    absmartly_api_key: string;
    user_id: string;
};

function detectApiKey(request: Request): { apiKey: string | null, endpoint: string | null } {
    const url = new URL(request.url);
    const authHeader = request.headers.get("Authorization");

    const apiKeyFromQuery = url.searchParams.get("api_key");
    if (apiKeyFromQuery) {
        const endpoint = url.searchParams.get("absmartly-endpoint") || 
                        request.headers.get("x-absmartly-endpoint") || 
                        DEFAULT_ABSMARTLY_API_ENDPOINT;
        return { apiKey: apiKeyFromQuery, endpoint };
    }

    if (authHeader) {
        const parts = authHeader.trim().split(/\s+/);
        let apiKey = "";
        let absmartlyEndpoint = url.searchParams.get("absmartly-endpoint") || 
                                request.headers.get("x-absmartly-endpoint") || 
                                "";

        let startIndex = 0;
        if (parts[0] === "Bearer") startIndex = 1;
        if (parts[startIndex] === "Api-Key") startIndex++;

        if (parts[startIndex] && parts[startIndex + 1]) {
            const potentialEndpoint = parts[startIndex];
            if (!potentialEndpoint.includes('.') && !potentialEndpoint.includes('://')) {
                if (!absmartlyEndpoint) absmartlyEndpoint = `https://${potentialEndpoint}.absmartly.com`;
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
            if (!absmartlyEndpoint) absmartlyEndpoint = DEFAULT_ABSMARTLY_API_ENDPOINT;
            return { apiKey, endpoint: absmartlyEndpoint };
        }
    }

    return { apiKey: null, endpoint: null };
}

export class SessionProvider {
    private apiHandler: any;

    constructor(apiHandler: any) {
        this.apiHandler = apiHandler;
    }

    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
                    "Access-Control-Max-Age": "86400",
                },
            });
        }

        const { apiKey, endpoint } = detectApiKey(request);

        if (!apiKey || !endpoint) {
            return new Response("Missing or invalid API key", { 
                status: 401,
                headers: {
                    "WWW-Authenticate": 'Api-Key realm="ABsmartly"'
                }
            });
        }

        const props: ABsmartlyProps = {
            email: 'api-key-user@example.com',
            name: 'API Key User',
            absmartly_endpoint: endpoint,
            absmartly_api_key: apiKey,
            user_id: 'api-key-user'
        };

        const enrichedCtx = { ...ctx, props };

        debug("API key authenticated, routing to MCP with session management");

        return this.apiHandler.fetch(request, env, enrichedCtx);
    }
}