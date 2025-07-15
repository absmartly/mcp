/**
 * ABsmartly MCP Server - Correct Architecture
 * 
 * Following Cloudflare AI demos pattern with API key bypass
 */

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ABsmartlyAPIClient } from "./api-client";
import { ABsmartlyResources } from "./resources";
import { ABsmartlyOAuthHandler } from "./absmartly-oauth-handler";
import { SessionProvider } from "./session-provider";
import { Env } from "./types";

// Props from OAuth authentication or API key detection
type ABsmartlyProps = {
    email: string;
    name: string;
    absmartly_endpoint: string;
    absmartly_api_key?: string;
    oauth_jwt?: string;
    user_id: string;
};

// Default ABsmartly API endpoint
const DEFAULT_ABSMARTLY_ENDPOINT = "https://dev-1.absmartly.com/v1";

// Cache TTL for entity data (5 minutes)
const ENTITIES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

export class ABsmartlyMCP extends McpAgent<Env, Record<string, never>, ABsmartlyProps> {
    server = new McpServer({
        name: "ABsmartly MCP Server",
        version: "1.0.0",
        capabilities: {
            tools: {},
            resources: {},
            prompts: {}
        }
    });

    private apiClient: ABsmartlyAPIClient | null = null;
    private resourcesSetup: boolean = false;
    private _customFields: any[] = [];
    private users: any[] = [];
    private teams: any[] = [];
    private applications: any[] = [];
    private unitTypes: any[] = [];
    private experimentTags: any[] = [];
    private metrics: any[] = [];
    private goals: any[] = [];

    // Getter for customFields to be accessible from resources
    get customFields() {
        return this._customFields;
    }

    // Access to environment for caching (inherited from McpAgent)
    // this.env is available from the McpAgent base class

    // Load entities from cache
    private loadEntitiesFromCache(entities: any) {
        this._customFields = entities.customFields || [];
        this.users = entities.users || [];
        this.teams = entities.teams || [];
        this.applications = entities.applications || [];
        this.unitTypes = entities.unitTypes || [];
        this.experimentTags = entities.experimentTags || [];
        this.metrics = entities.metrics || [];
        this.goals = entities.goals || [];
    }

    async init() {
        console.log("🚀 ABsmartly MCP initialization START");

        try {
            // Initialize API client with props from OAuth/API key
            await this.initializeAPIClient();

            // Fetch all entities in background
            await this.fetchAllEntities();

            // Setup tools
            this.setupTools();

            // Setup resources
            await this.setupResources();

            // Setup prompts
            this.setupPrompts();

            console.log("✅ ABsmartly MCP initialization completed successfully");
        } catch (error) {
            console.error("❌ ABsmartly MCP initialization failed:", error);
            throw error;
        }
    }

    private async initializeAPIClient() {
        if (!this.props || !this.props.absmartly_endpoint) {
            throw new Error("Missing required ABsmartly credentials");
        }

        // Determine auth token and type
        let authToken: string;
        let authType: 'api-key' | 'jwt';

        if (this.props.absmartly_api_key && 
            !this.props.absmartly_api_key.includes('@') && 
            !this.props.absmartly_api_key.includes(':')) {
            // Valid API key
            authToken = this.props.absmartly_api_key;
            authType = 'api-key';
            console.log("🔑 Using ABsmartly API key for authentication");
        } else if (this.props.oauth_jwt) {
            // OAuth JWT
            authToken = this.props.oauth_jwt;
            authType = 'jwt';
            console.log("🔑 Using OAuth JWT for authentication");
        } else {
            throw new Error("No valid authentication token available");
        }

        // Initialize API client
        this.apiClient = new ABsmartlyAPIClient(
            authToken,
            this.props.absmartly_endpoint,
            authType
        );

        console.log("✅ API client initialized successfully");
    }

    private async fetchAllEntities(): Promise<void> {
        if (!this.apiClient) {
            console.log("📦 No API client - setting empty arrays");
            this.setEmptyEntities();
            return;
        }

        // Create cache key based on endpoint and API key/auth type
        const authToken = this.props?.absmartly_api_key || this.props?.oauth_jwt || 'unknown';
        const cacheKey = `entities:${this.props?.absmartly_endpoint}:${authToken.substring(0, 8)}`;

        // Try to get cached entities first
        if (this.env?.OAUTH_KV) {
            try {
                const cachedData = await this.env.OAUTH_KV.get(cacheKey);
                if (cachedData) {
                    const parsed = JSON.parse(cachedData);
                    const cacheAge = Date.now() - parsed.timestamp;

                    if (cacheAge < ENTITIES_CACHE_TTL) {
                        console.log(`📦 Using cached entities (age: ${Math.round(cacheAge / 1000)}s)`);
                        this.loadEntitiesFromCache(parsed.entities);
                        return;
                    } else {
                        console.log(`📦 Cache expired (age: ${Math.round(cacheAge / 1000)}s), fetching fresh data`);
                    }
                }
            } catch (error) {
                console.log(`📦 Cache lookup failed: ${error}, fetching fresh data`);
            }
        } else {
            console.log("📦 No OAUTH_KV available, skipping cache");
        }

        try {
            console.log("📦 Fetching all entities from API");

            // Fetch all entities in parallel
            const [
                customFieldsResponse,
                usersResponse,
                teamsResponse,
                applicationsResponse,
                unitTypesResponse,
                experimentTagsResponse,
                metricsResponse,
                goalsResponse
            ] = await Promise.allSettled([
                this.apiClient.listExperimentCustomSectionFields({ items: 100 }),
                this.apiClient.listUsers(),
                this.apiClient.listTeams(),
                this.apiClient.listApplications({ items: 100 }),
                this.apiClient.listUnitTypes({ items: 100 }),
                this.apiClient.listExperimentTags({ items: 100 }),
                this.apiClient.listMetrics({ items: 100 }),
                this.apiClient.listGoals()
            ]);

            // Process responses
            this.processEntityResponses({
                customFieldsResponse,
                usersResponse,
                teamsResponse,
                applicationsResponse,
                unitTypesResponse,
                experimentTagsResponse,
                metricsResponse,
                goalsResponse
            });

            // Cache the processed entities
            if (this.env?.OAUTH_KV) {
                try {
                    const entitiesToCache = {
                        customFields: this._customFields,
                        users: this.users,
                        teams: this.teams,
                        applications: this.applications,
                        unitTypes: this.unitTypes,
                        experimentTags: this.experimentTags,
                        metrics: this.metrics,
                        goals: this.goals
                    };

                    const cacheData = {
                        timestamp: Date.now(),
                        entities: entitiesToCache
                    };

                    await this.env.OAUTH_KV.put(cacheKey, JSON.stringify(cacheData), {
                        expirationTtl: Math.floor(ENTITIES_CACHE_TTL / 1000) + 60 // Extra 60s buffer
                    });

                    console.log("📦 Cached entities successfully");
                } catch (error) {
                    console.log(`📦 Failed to cache entities: ${error}`);
                }
            }

            console.log("✅ All entities fetched successfully");
        } catch (error) {
            console.error("❌ Error fetching entities:", error);
            this.setEmptyEntities();
        }
    }

    private processEntityResponses(responses: any) {
        // Process custom fields
        if (responses.customFieldsResponse.status === 'fulfilled' && responses.customFieldsResponse.value.ok) {
            this._customFields = responses.customFieldsResponse.value.data?.experiment_custom_section_fields || [];
        } else {
            this._customFields = [];
        }

        // Process users
        if (responses.usersResponse.status === 'fulfilled' && responses.usersResponse.value.ok) {
            const rawUsers = responses.usersResponse.value.data?.users || responses.usersResponse.value.data || [];
            this.users = rawUsers.map((user: any) => ({
                id: user.id,
                name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
                description: user.email || ''
            }));
        } else {
            this.users = [];
        }

        // Process teams
        if (responses.teamsResponse.status === 'fulfilled' && responses.teamsResponse.value.ok) {
            const rawTeams = responses.teamsResponse.value.data?.teams || responses.teamsResponse.value.data || [];
            this.teams = rawTeams.map((team: any) => ({
                id: team.id,
                name: team.name,
                description: team.description || `${team.member_count || 0} members`
            }));
        } else {
            this.teams = [];
        }

        // Process applications
        if (responses.applicationsResponse.status === 'fulfilled' && responses.applicationsResponse.value.ok) {
            const rawApplications = responses.applicationsResponse.value.data?.applications || responses.applicationsResponse.value.data || [];
            this.applications = rawApplications.map((app: any) => ({
                id: app.id,
                name: app.name,
                description: `Environment: ${app.environment || 'default'}`
            }));
        } else {
            this.applications = [];
        }

        // Process other entities
        this.unitTypes = this.processSimpleEntity(responses.unitTypesResponse, 'unit_types');
        this.experimentTags = this.processSimpleEntity(responses.experimentTagsResponse, 'experiment_tags');
        this.metrics = this.processSimpleEntity(responses.metricsResponse, 'metrics');
        this.goals = this.processSimpleEntity(responses.goalsResponse, 'goals');
    }

    private processSimpleEntity(response: any, entityKey: string): any[] {
        if (response.status === 'fulfilled' && response.value.ok) {
            const rawEntities = response.value.data?.[entityKey] || response.value.data || [];
            return rawEntities.map((entity: any) => ({
                id: entity.id,
                name: entity.name || entity.tag,
                description: entity.description || `${entityKey.slice(0, -1)}: ${entity.name || entity.tag}`
            }));
        }
        return [];
    }

    private setEmptyEntities() {
        this._customFields = [];
        this.users = [];
        this.teams = [];
        this.applications = [];
        this.unitTypes = [];
        this.experimentTags = [];
        this.metrics = [];
        this.goals = [];
    }

    private setupTools() {
        // Authentication status tool
        this.server.tool(
            "get_auth_status",
            "Get current authentication status and user information",
            {},
            async () => {
                const hasApiAccess = !!this.apiClient;
                const authType = this.props?.absmartly_api_key ? 'API Key' : (this.props?.oauth_jwt ? 'OAuth JWT' : 'None');
                const status = hasApiAccess ? "✅ Authenticated with API access" : "⚠️ No API access available";

                return {
                    content: [{
                        type: "text",
                        text: `${status}\n\nEmail: ${this.props?.email || 'Unknown'}\nName: ${this.props?.name || 'Unknown'}\nEndpoint: ${this.props?.absmartly_endpoint || 'Not configured'}\nAuthentication Type: ${authType}\nAPI Access: ${hasApiAccess ? 'Available' : 'Not available'}`
                    }]
                };
            }
        );

        // List experiments tool
        this.server.tool(
            "list_experiments",
            "List experiments with optional search and pagination",
            {
                search: z.string().optional().describe("Search experiments by name or description"),
                sort: z.string().optional().describe("Sort field"),
                page: z.number().optional().describe("Page number"),
                items: z.number().optional().describe("Items per page")
            },
            async (params) => {
                if (!this.apiClient) {
                    return {
                        content: [{
                            type: "text",
                            text: "❌ API client not initialized. Please check authentication status."
                        }]
                    };
                }

                try {
                    const response = await this.apiClient.listExperiments({
                        search: params.search,
                        sort: params.sort,
                        page: params.page,
                        items: params.items || 10
                    });

                    if (!response.ok) {
                        return {
                            content: [{
                                type: "text",
                                text: `❌ API request failed: ${response.status} ${response.statusText}`
                            }]
                        };
                    }

                    const experiments = response.data?.experiments || [];
                    const experimentsList = experiments.map((exp: any) => 
                        `• **${exp.display_name || exp.name}** (${exp.state}) - ID: ${exp.id}`
                    ).join('\n');

                    return {
                        content: [{
                            type: "text",
                            text: `Found ${experiments.length} experiments\n\n${experimentsList || 'No experiments found'}`
                        }]
                    };
                } catch (error) {
                    return {
                        content: [{
                            type: "text",
                            text: `❌ Error fetching experiments: ${error}`
                        }]
                    };
                }
            }
        );

        // Add more tools here as needed...
    }

    private async setupResources() {
        if (this.resourcesSetup) {
            return;
        }

        const resourcesManager = new ABsmartlyResources(this);
        await resourcesManager.setupResources();
        this.resourcesSetup = true;
    }

    private setupPrompts() {
        this.server.prompt(
            "experiment-status",
            "Quick overview of all running experiments",
            async () => ({
                messages: [{
                    role: "user",
                    content: {
                        type: "text",
                        text: "Show me all currently running experiments with their key metrics and performance"
                    }
                }]
            })
        );
    }
}

// Helper function to detect API keys
function detectApiKey(request: Request): { apiKey: string | null, endpoint: string | null } {
    const url = new URL(request.url);
    const authHeader = request.headers.get("Authorization");

    // Check query parameter first (support both "api_key" and "apikey")
    const apiKeyFromQuery = url.searchParams.get("api_key") || url.searchParams.get("apikey");
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

// Create single MCP handler to ensure session consistency
const baseMcpHandler = ABsmartlyMCP.mount("/sse");

// Create a wrapper that generates user-based session IDs for both API keys and OAuth tokens
const userSessionMcpHandler = {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        // Debug log to understand what's passed in context
        console.log(`🔍 userSessionMcpHandler - ${request.method} ${url.pathname}`);
        console.log(`🔍 Context props available:`, {
            hasProps: !!ctx.props,
            propsKeys: ctx.props ? Object.keys(ctx.props) : [],
            propsData: ctx.props || {}
        });

        // Only apply user-based session logic to SSE endpoints
        if (url.pathname === "/sse" || url.pathname.startsWith("/sse/")) {
            // Check if we already have a sessionId - if so, use the base handler
            if (url.searchParams.has('sessionId')) {
                console.log(`📱 Using existing sessionId from URL`);
                return baseMcpHandler.fetch(request, env, ctx);
            }

            // Generate user-based session ID for OAuth users
            if (ctx.props && ctx.props.user_id && ctx.props.absmartly_endpoint) {
                const userIdentity = ctx.props.oauth_jwt 
                    ? `${ctx.props.oauth_jwt}:${ctx.props.absmartly_endpoint}`
                    : `${ctx.props.user_id}:${ctx.props.absmartly_endpoint}`;

                const encoder = new TextEncoder();
                const data = encoder.encode(userIdentity);
                const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                const sessionId = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

                console.log(`📱 OAuth user session ID: ${sessionId.substring(0, 8)}... (based on OAuth token + endpoint)`);

                // Add sessionId to URL
                const modifiedUrl = new URL(request.url);
                modifiedUrl.searchParams.set('sessionId', sessionId);

                // Create modified request with sessionId
                const modifiedRequest = new Request(modifiedUrl.toString(), request);

                return baseMcpHandler.fetch(modifiedRequest, env, ctx);
            } else {
                console.log(`⚠️ OAuth user session ID generation failed - missing required props:`, {
                    hasProps: !!ctx.props,
                    hasUserId: !!(ctx.props && ctx.props.user_id),
                    hasEndpoint: !!(ctx.props && ctx.props.absmartly_endpoint)
                });
            }
        }

        // Default to base handler for other requests
        return baseMcpHandler.fetch(request, env, ctx);
    }
};

// Create session provider that uses the same handler
const sessionProvider = new SessionProvider(baseMcpHandler);

// Create OAuth provider that uses the user-session wrapper
const oauthProvider = new OAuthProvider({
    apiHandler: userSessionMcpHandler as any,
    apiRoute: "/sse",
    defaultHandler: ABsmartlyOAuthHandler as any,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    accessTokenTTL: 3600,
    scopesSupported: ["api:read", "api:write"],
    disallowPublicClientRegistration: false
});

// Main fetch handler with API key bypass
export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        console.log(`🔍 Main handler - ${request.method} ${url.pathname}`);

        // Debug: Log Authorization header to understand token flow
        const authHeader = request.headers.get("Authorization");
        if (authHeader) {
            console.log(`🔍 Authorization header found: ${authHeader.substring(0, 30)}...`);
            if (authHeader.startsWith("Bearer ")) {
                const token = authHeader.substring(7);
                console.log(`🔍 Bearer token: ${token.substring(0, 20)}...`);

                // Check if this token exists in KV storage
                if (env.OAUTH_KV) {
                    const tokenData = await env.OAUTH_KV.get(`token:${token}`);
                    console.log(`🔍 Token in KV storage: ${!!tokenData}`);
                    if (tokenData) {
                        try {
                            const parsed = JSON.parse(tokenData);
                            console.log(`🔍 Token data preview:`, {
                                hasProps: !!parsed.props,
                                propsKeys: parsed.props ? Object.keys(parsed.props) : [],
                                userId: parsed.userId,
                                clientId: parsed.clientId
                            });
                        } catch (error) {
                            console.error(`❌ Failed to parse token data:`, error);
                        }
                    }
                }
            }
        } else {
            console.log(`🔍 No Authorization header found`);
        }

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

        // For SSE endpoints, check for API key first
        if (url.pathname === "/sse" || url.pathname.startsWith("/sse/")) {
            const { apiKey, endpoint } = detectApiKey(request);

            if (apiKey && endpoint) {
                console.log("🔑 API key detected, creating user-based session");

                // Create deterministic session ID based on user identity (API key + endpoint)
                // This ensures the same user always gets the same session, providing persistence
                const userIdentity = `${apiKey}:${endpoint}`;
                const encoder = new TextEncoder();
                const data = encoder.encode(userIdentity);
                const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                const sessionId = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

                console.log(`📱 User-based session ID: ${sessionId.substring(0, 8)}... (based on API key + endpoint)`);

                // Add sessionId to URL if not present (for deterministic session creation)
                const modifiedUrl = new URL(request.url);
                if (!modifiedUrl.searchParams.has('sessionId')) {
                    modifiedUrl.searchParams.set('sessionId', sessionId);
                }

                // Create modified request with sessionId
                const modifiedRequest = new Request(modifiedUrl.toString(), request);

                // Set props in context BEFORE routing to MCP handler (required for Durable Object initialization)
                const apiKeyProps = {
                    email: 'api-key-user@example.com',
                    name: 'API Key User',
                    absmartly_endpoint: endpoint,
                    absmartly_api_key: apiKey,
                    user_id: `api-key-${sessionId.substring(0, 8)}` // Use session ID prefix as user ID
                };

                const enrichedCtx = { ...ctx, props: apiKeyProps };

                // Route to MCP handler with modified request and enriched context
                return baseMcpHandler.fetch(modifiedRequest, env, enrichedCtx);
            }
        }

        // No API key found, use OAuth provider
        console.log("🔄 No API key found, routing to OAuth provider");
        return oauthProvider.fetch(request, env, ctx);
    }
};