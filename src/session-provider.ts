/**
 * Session Provider for API Key Authentication
 * 
 * Mimics the OAuth provider's session management but for API key users.
 * Provides the same session persistence and context passing patterns.
 */

import { ABsmartlyMCP } from "./index";
import type { Env } from "./types";

// Props for API key authentication (matches OAuth provider pattern)
type ABsmartlyProps = {
    email: string;
    name: string;
    absmartly_endpoint: string;
    absmartly_api_key: string;
    user_id: string;
};

// Helper function to detect API keys (imported from main file)
function detectApiKey(request: Request): { apiKey: string | null, endpoint: string | null } {
    const url = new URL(request.url);
    const authHeader = request.headers.get("Authorization");

    // Check query parameter first
    const apiKeyFromQuery = url.searchParams.get("api_key");
    if (apiKeyFromQuery) {
        const endpoint = url.searchParams.get("absmartly-endpoint") || 
                        request.headers.get("x-absmartly-endpoint") || 
                        "https://sandbox.absmartly.com";
        return { apiKey: apiKeyFromQuery, endpoint };
    }

    // Check Authorization header
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
            if (!absmartlyEndpoint) absmartlyEndpoint = "https://sandbox.absmartly.com";
            return { apiKey, endpoint: absmartlyEndpoint };
        }
    }

    return { apiKey: null, endpoint: null };
}

/**
 * Session Provider for API Key Authentication
 * 
 * Provides session management for API key users that mimics
 * the OAuth provider's session handling patterns.
 */
export class SessionProvider {
    private apiHandler: any;

    constructor(apiHandler: any) {
        this.apiHandler = apiHandler;
    }

    /**
     * Main fetch handler that mimics OAuth provider's session management
     */
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        // Handle CORS preflight
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

        // Check for API key authentication
        const { apiKey, endpoint } = detectApiKey(request);

        if (!apiKey || !endpoint) {
            return new Response("Missing or invalid API key", { 
                status: 401,
                headers: {
                    "WWW-Authenticate": 'Api-Key realm="ABsmartly"'
                }
            });
        }

        // Create props for API key authentication (matches OAuth pattern)
        const props: ABsmartlyProps = {
            email: 'api-key-user@example.com',
            name: 'API Key User',
            absmartly_endpoint: endpoint,
            absmartly_api_key: apiKey,
            user_id: 'api-key-user'
        };

        // Set props in context (same as OAuth provider does on line 837)
        const enrichedCtx = { ...ctx, props };

        console.log("🔑 API key authenticated, routing to MCP with session management");
        console.log("🔍 Debug - ctx.props:", JSON.stringify(enrichedCtx.props, null, 2));

        // Call API handler with enriched context (same pattern as OAuth provider)
        return this.apiHandler.fetch(request, env, enrichedCtx);
    }
}