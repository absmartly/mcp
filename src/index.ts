import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ABsmartlyAPIClient } from "./api-client";
import { ABsmartlyResources } from "./resources";
import { ABsmartlyOAuthHandler } from "./absmartly-oauth-handler";
import { Env } from "./types";
import { debug } from "./config";

type ABsmartlyProps = {
    email: string;
    name: string;
    absmartly_endpoint: string;
    absmartly_api_key?: string;
    oauth_jwt?: string;
    user_id: string;
};

const DEFAULT_ABSMARTLY_ENDPOINT = "https://dev-1.absmartly.com/v1";
const DEFAULT_OAUTH_CLIENT_ID = "mcp-absmartly-universal";
const ENTITIES_CACHE_TTL = 5 * 60 * 1000;

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

    get customFields() {
        return this._customFields;
    }

    // this.env is available from the McpAgent base class

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
            await this.initializeAPIClient();
            await this.fetchAllEntities();
            this.setupTools();
            await this.setupResources();
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

        this.apiClient = new ABsmartlyAPIClient(
            authToken,
            this.props.absmartly_endpoint,
            authType
        );

        debug("✅ API client initialized successfully");
    }

    private async fetchAllEntities(): Promise<void> {
        if (!this.apiClient) {
            debug("📦 No API client - setting empty arrays");
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
                        debug(`📦 Using cached entities (age: ${Math.round(cacheAge / 1000)}s)`);
                        this.loadEntitiesFromCache(parsed.entities);
                        return;
                    } else {
                        debug(`📦 Cache expired (age: ${Math.round(cacheAge / 1000)}s), fetching fresh data`);
                    }
                }
            } catch (error) {
                debug(`📦 Cache lookup failed: ${error}, fetching fresh data`);
            }
        } else {
            debug("📦 No OAUTH_KV available, skipping cache");
        }

        try {
            debug("📦 Fetching all entities from API");

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

                    debug("📦 Cached entities successfully");
                } catch (error) {
                    debug(`📦 Failed to cache entities: ${error}`);
                }
            }

            debug("✅ All entities fetched successfully");
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
                // Basic query parameters
                search: z.string().optional().describe("Search experiments by name or description"),
                sort: z.string().optional().describe("Sort field (e.g., created_at, updated_at)"),
                page: z.number().optional().describe("Page number (default: 1)"),
                items: z.number().optional().describe("Items per page (default: 10)"),
                
                // Filter by experiment attributes (comma-separated lists)
                state: z.string().optional().describe("Filter by state (comma-separated: created,ready,running,development,full_on,running_not_full_on,stopped,archived,scheduled)"),
                significance: z.string().optional().describe("Filter by significance results (comma-separated: positive,negative,neutral,inconclusive)"),
                owners: z.string().optional().describe("Filter by owner user IDs (comma-separated numbers, e.g.: 3,5,7). Use the list_users tool to find user IDs by name"),
                teams: z.string().optional().describe("Filter by team IDs (comma-separated numbers, e.g.: 1,2,3). Use the list_teams tool to find team IDs by name"),
                tags: z.string().optional().describe("Filter by tag IDs (comma-separated numbers, e.g.: 2,4,6). Use the list_tags tool to find tag IDs by name"),
                templates: z.string().optional().describe("Filter by template IDs (comma-separated numbers, e.g.: 238,240). Note: This expects numeric template IDs"),
                applications: z.string().optional().describe("Filter by application IDs (comma-separated numbers, e.g.: 39,3). Use the list_applications tool to find application IDs by name"),
                unit_types: z.string().optional().describe("Filter by unit type IDs (comma-separated numbers, e.g.: 42,75). Use the list_unit_types tool to find unit type IDs by name"),
                
                // Range filters (comma-separated min,max)
                impact: z.string().optional().describe("Filter by impact range (min,max: 1,5)"),
                created_at: z.string().optional().describe("Filter by creation date range (start,end) in milliseconds since epoch"),
                updated_at: z.string().optional().describe("Filter by update date range (start,end) in milliseconds since epoch"),
                full_on_at: z.string().optional().describe("Filter by full_on date range (start,end) in milliseconds since epoch"),
                
                // Boolean filters (0 or 1)
                sample_ratio_mismatch: z.union([z.literal(0), z.literal(1)]).optional().describe("Filter experiments with sample ratio mismatch"),
                cleanup_needed: z.union([z.literal(0), z.literal(1)]).optional().describe("Filter experiments that need cleanup"),
                audience_mismatch: z.union([z.literal(0), z.literal(1)]).optional().describe("Filter experiments with audience mismatch"),
                sample_size_reached: z.union([z.literal(0), z.literal(1)]).optional().describe("Filter experiments that reached sample size"),
                experiments_interact: z.union([z.literal(0), z.literal(1)]).optional().describe("Filter experiments that interact with other experiments"),
                group_sequential_updated: z.union([z.literal(0), z.literal(1)]).optional().describe("Filter experiments with updated group sequential analysis"),
                assignment_conflict: z.union([z.literal(0), z.literal(1)]).optional().describe("Filter experiments with assignment conflicts"),
                metric_threshold_reached: z.union([z.literal(0), z.literal(1)]).optional().describe("Filter experiments that reached metric threshold"),
                previews: z.union([z.literal(0), z.literal(1)]).optional().describe("Include experiment preview data"),
                
                // String filters
                analysis_type: z.string().optional().describe("Filter by analysis type (e.g., group_sequential,fixed_horizon)"),
                type: z.string().optional().describe("Filter by experiment type (e.g., test, feature)"),
                
                // Number filters
                iterations: z.number().optional().describe("Filter by number of iterations")
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
                        // Basic query parameters
                        search: params.search,
                        sort: params.sort,
                        page: params.page,
                        items: params.items || 10,
                        
                        // Filter parameters
                        state: params.state,
                        significance: params.significance,
                        owners: params.owners,
                        teams: params.teams,
                        tags: params.tags,
                        templates: params.templates,
                        applications: params.applications,
                        unit_types: params.unit_types,
                        
                        // Range filters
                        impact: params.impact,
                        created_at: params.created_at,
                        updated_at: params.updated_at,
                        full_on_at: params.full_on_at,
                        
                        // Boolean filters
                        sample_ratio_mismatch: params.sample_ratio_mismatch,
                        cleanup_needed: params.cleanup_needed,
                        audience_mismatch: params.audience_mismatch,
                        sample_size_reached: params.sample_size_reached,
                        experiments_interact: params.experiments_interact,
                        group_sequential_updated: params.group_sequential_updated,
                        assignment_conflict: params.assignment_conflict,
                        metric_threshold_reached: params.metric_threshold_reached,
                        previews: params.previews,
                        
                        // String filters
                        analysis_type: params.analysis_type,
                        type: params.type,
                        
                        // Number filters
                        iterations: params.iterations
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
                    
                    // Get the base URL without /v1 suffix for generating links
                    const baseUrl = this.props.absmartly_endpoint.replace(/\/v1\/?$/, '');
                    
                    // Add link field to each experiment
                    const experimentsWithLinks = experiments.map((exp: any) => ({
                        ...exp,
                        link: `${baseUrl}/experiments/${exp.id}`
                    }));
                    
                    // Format the response with full experiment data including links
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                total: response.data?.total || experiments.length,
                                page: response.data?.page || 1,
                                items: response.data?.items || experiments.length,
                                experiments: experimentsWithLinks
                            }, null, 2)
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

        // List users tool
        this.server.tool(
            "list_users",
            "List all users (cached from initialization)",
            {
                search: z.string().optional().describe("Optional search term to filter users by name or email")
            },
            async (params) => {
                let users = this.users || [];
                
                if (params.search) {
                    const searchTerm = params.search.toLowerCase();
                    users = users.filter(user => 
                        user.name.toLowerCase().includes(searchTerm) ||
                        user.email.toLowerCase().includes(searchTerm)
                    );
                }
                
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            total: users.length,
                            users: users
                        }, null, 2)
                    }]
                };
            }
        );

        // List teams tool
        this.server.tool(
            "list_teams",
            "List all teams (cached from initialization)",
            {
                search: z.string().optional().describe("Optional search term to filter teams by name")
            },
            async (params) => {
                let teams = this.teams || [];
                
                if (params.search) {
                    const searchTerm = params.search.toLowerCase();
                    teams = teams.filter(team => 
                        team.name.toLowerCase().includes(searchTerm)
                    );
                }
                
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            total: teams.length,
                            teams: teams
                        }, null, 2)
                    }]
                };
            }
        );

        // List applications tool
        this.server.tool(
            "list_applications",
            "List all applications (cached from initialization)",
            {
                search: z.string().optional().describe("Optional search term to filter applications by name")
            },
            async (params) => {
                let applications = this.applications || [];
                
                if (params.search) {
                    const searchTerm = params.search.toLowerCase();
                    applications = applications.filter(app => 
                        app.name.toLowerCase().includes(searchTerm)
                    );
                }
                
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            total: applications.length,
                            applications: applications
                        }, null, 2)
                    }]
                };
            }
        );

        // List unit types tool
        this.server.tool(
            "list_unit_types",
            "List all unit types (cached from initialization)",
            {
                search: z.string().optional().describe("Optional search term to filter unit types by name")
            },
            async (params) => {
                let unitTypes = this.unitTypes || [];
                
                if (params.search) {
                    const searchTerm = params.search.toLowerCase();
                    unitTypes = unitTypes.filter(unitType => 
                        unitType.name.toLowerCase().includes(searchTerm)
                    );
                }
                
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            total: unitTypes.length,
                            unit_types: unitTypes
                        }, null, 2)
                    }]
                };
            }
        );

        // List tags tool
        this.server.tool(
            "list_tags",
            "List all experiment tags (cached from initialization)",
            {
                search: z.string().optional().describe("Optional search term to filter tags by name")
            },
            async (params) => {
                let tags = this.experimentTags || [];
                
                if (params.search) {
                    const searchTerm = params.search.toLowerCase();
                    tags = tags.filter(tag => 
                        tag.name.toLowerCase().includes(searchTerm)
                    );
                }
                
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            total: tags.length,
                            tags: tags
                        }, null, 2)
                    }]
                };
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
        debug(`🔍 debugOAuthHandler: ${request.method} ${new URL(request.url).pathname}`);
        const response = await oauthHandler.fetch(request, env, ctx);
        debug(`📍 debugOAuthHandler response status: ${response.status}`);
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
            debug("Auto-registering public client:", clientId);
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
        
        // Handle API key detection and session tracking
        const authHeader = request.headers.get("Authorization");
        debug(`🔍 Raw Authorization header: ${authHeader ? authHeader.substring(0, 100) + '...' : 'null'}`);
        
        const { apiKey, endpoint } = detectApiKey(request);
        debug(`🔍 detectApiKey result: apiKey=${apiKey ? apiKey.substring(0, 30) + '...' : 'null'}, endpoint=${endpoint}`);
        
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
                debug("🔑 API key detected, bypassing OAuth flow");
                
                try {
                    const apiClient = new ABsmartlyAPIClient(
                        apiKey,
                        endpoint || DEFAULT_ABSMARTLY_ENDPOINT,
                        'api-key'
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
                debug("⚠️ No valid Authorization header, returning 401 to trigger OAuth flow");
                
                // Store the requested endpoint in KV for the OAuth flow
                const requestedEndpoint = url.searchParams.get('absmartly-endpoint') || endpoint;
                if (requestedEndpoint && env.OAUTH_KV) {
                    debug(`📍 Storing requested endpoint for OAuth flow: ${requestedEndpoint}`);
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
        debug(`🔍 Routing non-SSE request to OAuth provider: ${request.method} ${url.pathname}`);
        const oauthResponse = await oauthProvider.fetch(request, env, ctx);
        debug(`📍 OAuth provider response status: ${oauthResponse.status}`);
        return oauthResponse;
    }
};