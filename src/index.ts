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

// Default OAuth client ID
const DEFAULT_OAUTH_CLIENT_ID = "mcp-absmartly-universal";

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
            authType,
            this.env?.DEBUG === 'true'
        );

        if (this.env?.DEBUG === 'true') {
            console.log("✅ API client initialized successfully");
        }
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

    // Check Authorization header - but only for API key formats, not OAuth Bearer tokens
    if (authHeader) {
        const parts = authHeader.trim().split(/\s+/);
        
        // Skip OAuth Bearer tokens - these should go through the OAuth provider
        if (parts[0] === "Bearer" && parts.length === 2) {
            // This is likely an OAuth Bearer token, not an API key
            return { apiKey: null, endpoint: null };
        }
        
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

// Create custom OAuth handler instance
const oauthHandler = new ABsmartlyOAuthHandler();

// Wrap the OAuth handler to add debugging
const debugOAuthHandler = {
    fetch: async (request: Request, env: any, ctx: any) => {
        const debug = env.DEBUG === 'true';
        if (debug) {
            console.log(`🔍 debugOAuthHandler: ${request.method} ${new URL(request.url).pathname}`);
        }
        const response = await oauthHandler.fetch(request, env, ctx);
        if (debug) {
            console.log(`📍 debugOAuthHandler response status: ${response.status}`);
        }
        return response;
    }
};

// Create OAuth provider for OAuth flow endpoints only
const oauthProvider = new OAuthProvider({
    // API handlers for protected endpoints
    apiHandlers: {
        "/sse": baseMcpHandler
    },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    accessTokenTTL: 3600,
    scopesSupported: ["api:read", "api:write"],
    disallowPublicClientRegistration: false,

    // Client lookup function
    async clientLookup(clientId: string, env: any) {
        // Check if client exists in KV storage
        if (env.OAUTH_KV) {
            const clientData = await env.OAUTH_KV.get(`client:${clientId}`);
            if (clientData) {
                const client = JSON.parse(clientData);
                return {
                    clientId: client.clientId,
                    clientSecret: client.clientSecret,
                    redirectUris: client.redirectUris,
                    clientName: client.clientName,
                    tokenEndpointAuthMethod: client.tokenEndpointAuthMethod || 'client_secret_basic'
                };
            }
        }

        // Auto-register Claude Desktop clients as public clients
        if (clientId.startsWith("claude-mcp-") || clientId.startsWith("C0")) {
            if (env.DEBUG === 'true') {
                console.log("Auto-registering public client:", clientId);
            }
            const newClient = {
                clientId: clientId,
                redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
                clientName: "Claude Desktop",
                tokenEndpointAuthMethod: 'none' // Public client
            };

            // Store in KV for future lookups
            if (env.OAUTH_KV) {
                await env.OAUTH_KV.put(`client:${clientId}`, JSON.stringify({
                    ...newClient,
                    registrationDate: Date.now()
                }));
            }

            return newClient;
        }

        return null;
    },

    // Use our custom OAuth handler as the default handler
    defaultHandler: oauthHandler
});

// Main handler
export default {
    async fetch(request: Request, env: any, ctx: any): Promise<Response> {
        const url = new URL(request.url);
        const debug = env.DEBUG === 'true';
        
        // Handle API key detection and session tracking
        const authHeader = request.headers.get("Authorization");
        if (debug) {
            console.log(`🔍 Raw Authorization header: ${authHeader ? authHeader.substring(0, 100) + '...' : 'null'}`);
        }
        
        const { apiKey, endpoint } = detectApiKey(request);
        if (debug) {
            console.log(`🔍 detectApiKey result: apiKey=${apiKey ? apiKey.substring(0, 30) + '...' : 'null'}, endpoint=${endpoint}`);
        }
        
        // Create client fingerprint for session tracking
        const clientFingerprint = `${request.headers.get('CF-Connecting-IP') || 'unknown'}-${request.headers.get('User-Agent') || 'unknown'}`;
        
        // Store API key session in KV if using API key
        if (apiKey && env.OAUTH_KV) {
            await env.OAUTH_KV.put(`api_key_session:${clientFingerprint}`, 'active', {
                expirationTtl: 300 // 5 minutes
            });
        }
        
        // Check for OAuth discovery endpoints and block them for API key users
        const isOAuthDiscoveryEndpoint = url.pathname === '/.well-known/oauth-authorization-server' || 
                                        url.pathname === '/.well-known/oauth-protected-resource' ||
                                        url.pathname.startsWith('/.well-known/oauth-authorization-server/') ||
                                        url.pathname.startsWith('/.well-known/oauth-protected-resource/');
        
        if (env.OAUTH_KV && isOAuthDiscoveryEndpoint) {
            const apiKeySession = await env.OAUTH_KV.get(`api_key_session:${clientFingerprint}`);
            if (apiKeySession) {
                return new Response(JSON.stringify({
                    error: "oauth_not_available",
                    error_description: "OAuth not available when using API key authentication"
                }), { status: 404 });
            }
        }
        
        // Handle MCP SSE endpoint
        if (url.pathname.startsWith("/sse")) {
            // Check if API key is detected
            if (apiKey) {
                if (debug) {
                    console.log("🔑 API key detected, bypassing OAuth flow");
                }
                
                try {
                    // Create API client and fetch current user
                    const apiClient = new ABsmartlyAPIClient(
                        apiKey,
                        endpoint || DEFAULT_ABSMARTLY_ENDPOINT,
                        'api-key',
                        debug
                    );
                    
                    const userResponse = await apiClient.getCurrentUser();
                    
                    if (!userResponse.ok) {
                        console.error("Failed to fetch user info:", userResponse.status);
                        return new Response("Unauthorized", {
                            status: 401,
                            headers: {
                                "Access-Control-Allow-Origin": "*",
                                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                                "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
                            },
                        });
                    }
                    
                    // Extract user information - handle nested user object
                    const userData = userResponse.data.user || userResponse.data;
                    const userId = userData.id?.toString() || userData.email;
                    
                    // Create props from user data
                    if (!userData.email) {
                        console.error('❌ No email found in API response for API key authentication!');
                        console.log('🔍 Full user data:', userData);
                    }
                    
                    const props: ABsmartlyProps = {
                        email: userData.email || "api-key-user",
                        name: `${userData.first_name || ''} ${userData.last_name || ''}`.trim() || userData.email || "API Key User",
                        absmartly_endpoint: endpoint || DEFAULT_ABSMARTLY_ENDPOINT,
                        absmartly_api_key: apiKey,
                        user_id: userId
                    };
                    
                    console.log(`✅ API key authenticated for user: ${props.email}`);
                    
                    // Store session in KV if available
                    if (env.OAUTH_KV) {
                        const session = {
                            userId: userId,
                            email: props.email,
                            name: props.name,
                            absmartly_endpoint: props.absmartly_endpoint,
                            absmartly_api_key: apiKey,
                            createdAt: Date.now(),
                            expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
                        };
                        
                        await env.OAUTH_KV.put(`session:${userId}`, JSON.stringify(session), {
                            expirationTtl: 86400 // 24 hours
                        });
                    }
                    
                    // Pass props to MCP handler
                    ctx.props = props;
                    return await baseMcpHandler.fetch(request, env, ctx);
                    
                } catch (error) {
                    console.error("Error during API key authentication:", error);
                    return new Response("Internal Server Error", {
                        status: 500,
                        headers: {
                            "Access-Control-Allow-Origin": "*",
                            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                            "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
                        },
                    });
                }
            }
            
            // No API key detected - check for OAuth token
            const authHeader = request.headers.get("Authorization");
            
            // Manual 401 response for SSE endpoints without valid auth to trigger OAuth flow
            if (!authHeader || !authHeader.startsWith("Bearer ")) {
                if (debug) {
                    console.log("⚠️ No valid Authorization header, returning 401 to trigger OAuth flow");
                }
                
                // Store the requested endpoint in KV for the OAuth flow
                const requestedEndpoint = url.searchParams.get('absmartly-endpoint') || endpoint;
                if (requestedEndpoint && env.OAUTH_KV) {
                    if (debug) {
                        console.log(`📍 Storing requested endpoint for OAuth flow: ${requestedEndpoint}`);
                    }
                    await env.OAUTH_KV.put(
                        `oauth_endpoint:${clientFingerprint}`,
                        requestedEndpoint,
                        { expirationTtl: 600 } // 10 minutes
                    );
                }
                
                return new Response("Unauthorized", {
                    status: 401,
                    headers: {
                        "WWW-Authenticate": 'Bearer realm="OAuth"',
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Methods": "GET, POST, OPTIONS", 
                        "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
                        "X-Auth-Debug": "basic-401-response",
                    },
                });
            }
            
            // Route OAuth authenticated requests through OAuth provider for token validation
            return await oauthProvider.fetch(request, env, ctx);
        }
        
        // Route all other requests to OAuth provider (only for non-API key requests)
        if (debug) {
            console.log(`🔍 Routing non-SSE request to OAuth provider: ${request.method} ${url.pathname}`);
        }
        const oauthResponse = await oauthProvider.fetch(request, env, ctx);
        if (debug) {
            console.log(`📍 OAuth provider response status: ${oauthResponse.status}`);
        }
        return oauthResponse;
    }
};