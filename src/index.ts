import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { z } from "zod";
import { ABsmartlyResources } from "./resources";
import { ABsmartlyOAuthHandler } from "./absmartly-oauth-handler";
import { Env } from "./types";
import { debug } from "./config";
import { MCP_VERSION } from "./version";
import { APIClient } from "@absmartly/cli/api-client";
import type { CustomSectionField } from "@absmartly/cli/api-client";
import { FetchHttpClient } from "./fetch-adapter";
import { setupTools } from "./tools";
import type { ToolContext } from "./tools";
import {
    ABsmartlyProps,
    DEFAULT_ABSMARTLY_ENDPOINT,
    DEFAULT_API_KEY_USER_EMAIL,
    DEFAULT_API_KEY_USER_NAME,
    ENTITIES_CACHE_TTL_MS,
    CORS_HEADERS,
    CLAUDE_AUTH_CALLBACK_URI,
    API_KEY_SESSION_TTL_SECONDS,
    SESSION_TTL_SECONDS,
    OAUTH_STATE_TTL_SECONDS,
    normalizeBaseUrl,
    extractEndpointFromPath,
    detectApiKey,
    safeKvPut,
    safeKvGet,
} from "./shared";

export class ABsmartlyMCP extends McpAgent<Env, Record<string, never>, ABsmartlyProps> {
    server = new McpServer(
        {
            name: "ABsmartly MCP Server",
            version: MCP_VERSION,
        },
        {
            capabilities: {
                tools: {},
                resources: { subscribe: true, listChanged: true },
                prompts: {}
            }
        }
    );

    private apiClient: APIClient | null = null;
    private resourcesSetup: boolean = false;
    private currentUserId: number | null = null;
    private entityWarnings: string[] = [];
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

    private log(level: 'debug' | 'info' | 'warning' | 'error', message: string): void {
        debug(message);
        try {
            this.server.server.sendLoggingMessage({ level, data: message });
        } catch (e) {
            console.warn(`MCP logging failed (level=${level}):`, e);
        }
    }

    async init() {
        debug("ABsmartly MCP initialization START");

        try {
            await this.initializeAPIClient();
            await Promise.all([
                this.fetchAllEntities(),
                this.fetchCurrentUser()
            ]);
            this.log('info', `Authenticated as ${this.props?.email}`);
            this.setupTools();
            await this.setupResources();
            this.setupPrompts();
            debug("ABsmartly MCP initialization completed successfully");
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
            authToken = this.props.absmartly_api_key;
            authType = 'api-key';
            debug("Using ABsmartly API key for authentication");
        } else if (this.props.oauth_jwt) {
            authToken = this.props.oauth_jwt;
            authType = 'jwt';
            debug("Using OAuth JWT for authentication");
        } else {
            throw new Error("No valid authentication token available");
        }

        const fetchHttpClient = new FetchHttpClient(
            this.props.absmartly_endpoint,
            { authToken, authType }
        );
        this.apiClient = new APIClient(fetchHttpClient);

        debug("API client initialized successfully");
    }

    private async fetchCurrentUser(): Promise<void> {
        if (!this.apiClient) return;
        try {
            const user = await this.apiClient.getCurrentUser();
            this.currentUserId = user?.id || null;
            debug("Current user ID:", this.currentUserId);
        } catch (e) {
            const msg = `Failed to fetch current user: ${e}`;
            console.warn(msg);
            this.entityWarnings.push(msg);
        }
    }

    private async fetchAllEntities(): Promise<void> {
        this.entityWarnings = [];

        if (!this.apiClient) {
            debug("📦 No API client - setting empty arrays");
            this.setEmptyEntities();
            return;
        }

        const authToken = this.props?.absmartly_api_key || this.props?.oauth_jwt || 'unknown';
        const cacheKey = `entities:${this.props?.absmartly_endpoint}:${authToken.substring(0, 8)}`;

        if (this.env?.OAUTH_KV) {
            try {
                const cachedData = await this.env.OAUTH_KV.get(cacheKey);
                if (cachedData) {
                    const parsed = JSON.parse(cachedData);
                    const cacheAge = Date.now() - parsed.timestamp;

                    if (cacheAge < ENTITIES_CACHE_TTL_MS) {
                        debug(`📦 Using cached entities (age: ${Math.round(cacheAge / 1000)}s)`);
                        this.loadEntitiesFromCache(parsed.entities);
                        this.log('debug', 'Using cached entities');
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

            const warnings: string[] = [];
            const safeCall = async <T>(label: string, fn: () => Promise<T[]>): Promise<T[]> => {
                try {
                    return await fn();
                } catch (e) {
                    const msg = `Failed to fetch ${label}: ${e}`;
                    warnings.push(msg);
                    debug(msg);
                    return [];
                }
            };

            const [
                rawCustomFields,
                rawUsers,
                rawTeams,
                rawApplications,
                rawUnitTypes,
                rawExperimentTags,
                rawMetrics,
                rawGoals
            ] = await Promise.all([
                safeCall('customFields', () => this.apiClient!.listCustomSectionFields()),
                safeCall('users', () => this.apiClient!.listUsers()),
                safeCall('teams', () => this.apiClient!.listTeams()),
                safeCall('applications', () => this.apiClient!.listApplications()),
                safeCall('unitTypes', () => this.apiClient!.listUnitTypes()),
                safeCall('experimentTags', () => this.apiClient!.listExperimentTags(100, 0)),
                safeCall('metrics', () => this.apiClient!.listMetrics({ items: 100 })),
                safeCall('goals', () => this.apiClient!.listGoals(100, 0))
            ]);

            if (warnings.length > 0) {
                console.error(`⚠️ ${warnings.length} entity fetch(es) failed:\n${warnings.join('\n')}`);
                this.entityWarnings = warnings;
            }

            this._customFields = rawCustomFields;
            this.users = (rawUsers as any[]).map((user: any) => ({
                id: user.id,
                name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
                description: user.email || ''
            }));
            this.teams = (rawTeams as any[]).map((team: any) => ({
                id: team.id,
                name: team.name,
                description: team.description || `${team.member_count || 0} members`
            }));
            this.applications = (rawApplications as any[]).map((app: any) => ({
                id: app.id,
                name: app.name,
                description: `Environment: ${app.environment || 'default'}`
            }));
            this.unitTypes = (rawUnitTypes as any[]).map((e: any) => ({
                id: e.id, name: e.name || e.tag, description: e.description || `unit_type: ${e.name || e.tag}`
            }));
            this.experimentTags = (rawExperimentTags as any[]).map((e: any) => ({
                id: e.id, name: e.name || e.tag, description: e.description || `experiment_tag: ${e.name || e.tag}`
            }));
            this.metrics = (rawMetrics as any[]).map((e: any) => ({
                id: e.id, name: e.name || e.tag, description: e.description || `metric: ${e.name || e.tag}`
            }));
            this.goals = (rawGoals as any[]).map((e: any) => ({
                id: e.id, name: e.name || e.tag, description: e.description || `goal: ${e.name || e.tag}`
            }));

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
                        expirationTtl: Math.floor(ENTITIES_CACHE_TTL_MS / 1000) + 60
                    });

                    debug("📦 Cached entities successfully");
                } catch (error) {
                    debug(`📦 Failed to cache entities: ${error}`);
                }
            }

            const entityCount = this.applications.length + this.unitTypes.length +
                this.metrics.length + this.goals.length + this.teams.length +
                this.users.length + this.experimentTags.length + this._customFields.length;
            this.log('info', `Entities refreshed: ${entityCount} total`);

            try {
                this.server.sendResourceListChanged();
            } catch (_) {
                debug("Could not send resource list changed notification (server may not be connected)");
            }
        } catch (error) {
            const msg = `Error fetching entities: ${error}`;
            console.error("❌", msg);
            this.entityWarnings.push(msg);
            this.setEmptyEntities();
        }
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
        const self = this;
        const toolCtx: ToolContext = {
            get apiClient() { return self.apiClient; },
            get endpoint() { return self.props?.absmartly_endpoint || ''; },
            authType: this.props?.absmartly_api_key ? 'API Key' : 'OAuth JWT',
            get email() { return self.props?.email; },
            get name() { return self.props?.name; },
            get entityWarnings() { return self.entityWarnings; },
            get customFields() { return self._customFields as CustomSectionField[]; },
            get currentUserId() { return self.currentUserId; },
            log: (level: string, message: string) => this.log(level as any, message),
            elicitConfirmation: async (message: string) => {
                const result = await this.server.server.elicitInput({
                    message,
                    requestedSchema: {
                        type: "object" as const,
                        properties: {
                            confirm: {
                                type: "string",
                                title: "Confirm",
                                description: "Type 'yes' to confirm this destructive action",
                            }
                        },
                        required: ["confirm"]
                    }
                });
                return result.action === 'accept' && result.content?.confirm === 'yes';
            },
        };
        setupTools(this.server, toolCtx);
    }


    private async setupResources() {
        if (this.resourcesSetup) {
            return;
        }

        const resourcesManager = new ABsmartlyResources(this);
        await resourcesManager.setupResources();
        this.resourcesSetup = true;
    }

    private buildEntityContext(): string {
        const sections: string[] = [];

        if (this.applications.length > 0) {
            const appLines = this.applications.map((a: any) => `  - id=${a.id}, name="${a.name}"`);
            sections.push(`Applications:\n${appLines.join('\n')}`);
        }

        if (this.unitTypes.length > 0) {
            const utLines = this.unitTypes.map((u: any) => `  - id=${u.id}, name="${u.name}"`);
            sections.push(`Unit Types:\n${utLines.join('\n')}`);
        }

        if (this.metrics.length > 0) {
            const mLines = this.metrics.map((m: any) => `  - id=${m.id}, name="${m.name}"`);
            sections.push(`Metrics:\n${mLines.join('\n')}`);
        }

        if (this.teams.length > 0) {
            const tLines = this.teams.map((t: any) => `  - id=${t.id}, name="${t.name}"`);
            sections.push(`Teams:\n${tLines.join('\n')}`);
        }

        if (this._customFields.length > 0) {
            const cfLines = (this._customFields as CustomSectionField[])
                .filter(f => !f.archived)
                .map(f => `  - title="${f.name}", type="${f.type}", default="${f.default_value || ''}", section_type="${f.custom_section?.type || 'unknown'}"`);
            sections.push(`Custom Fields:\n${cfLines.join('\n')}`);
        }

        return sections.join('\n\n');
    }

    private setupPrompts() {
        this.server.prompt(
            "experiment-status",
            "Quick overview of all running experiments",
            async () => ({
                messages: [{
                    role: "user" as const,
                    content: {
                        type: "text" as const,
                        text: "Show me all currently running experiments with their key metrics and performance"
                    }
                }]
            })
        );

        this.server.prompt(
            "create-experiment",
            "Create a new A/B test experiment with all required fields pre-populated from available entities",
            {
                name: z.string().describe("Experiment name (snake_case recommended)"),
                type: completable(
                    z.string().default('test').describe("Experiment type: 'test' or 'feature' (default: 'test')"),
                    (value) => ['test', 'feature'].filter(t => t.startsWith(value || ''))
                ),
            },
            (args) => {
                const entityContext = this.buildEntityContext();
                const expType = args.type || 'test';
                return {
                    messages: [{
                        role: "user" as const,
                        content: {
                            type: "text" as const,
                            text: `Create a new ${expType === 'feature' ? 'feature flag' : 'A/B test'} experiment named "${args.name}".

Use the execute_command tool with group "experiments" and command "createExperimentFromTemplate". Read the absmartly://docs/templates resource for the markdown template format. Fill in the template with the context below, then pass the filled template as the "templateContent" parameter.

${entityContext}

Requirements:
- Set type to "${expType}"
- Use valid application and unit type IDs from the lists above
- Include appropriate secondary metrics
- Fill in custom fields with sensible defaults
- Set up control and treatment variants
- Use snake_case for the experiment name`
                        }
                    }]
                };
            }
        );

        this.server.prompt(
            "create-feature-flag",
            "Create a new feature flag (simplified experiment with type=feature)",
            {
                name: z.string().describe("Feature flag name (snake_case recommended)"),
            },
            (args) => {
                const entityContext = this.buildEntityContext();
                return {
                    messages: [{
                        role: "user" as const,
                        content: {
                            type: "text" as const,
                            text: `Create a new feature flag named "${args.name}".

Use the execute_command tool with group "experiments" and command "createExperimentFromTemplate". Read the absmartly://docs/templates resource for the feature flag template. Fill it in with type "feature", two variants (off/on), and the context below, then pass as "templateContent".

${entityContext}

Requirements:
- Set type to "feature"
- Two variants: off (control, variant 0) and on (treatment, variant 1)
- Use valid application and unit type IDs from the lists above
- Custom fields will be auto-populated for the "feature" type`
                        }
                    }]
                };
            }
        );

        this.server.prompt(
            "analyze-experiment",
            "Fetch and analyze a specific experiment's details, state, and performance",
            {
                id: z.string().describe("Experiment ID to analyze"),
            },
            (args) => ({
                messages: [{
                    role: "user" as const,
                    content: {
                        type: "text" as const,
                        text: `Analyze experiment with ID ${args.id}.

Steps:
1. Use execute_command with group "experiments", command "getExperiment", params { "experimentId": ${args.id}, "show": ["experiment_report", "audience"] }
2. Check the experiment state (created, running, stopped, etc.)
3. If running, check for alerts (SRM, audience mismatch, sample size reached)
4. Review the traffic split and variant configuration
5. If available, analyze the experiment report metrics and statistical significance
6. Provide a summary with actionable recommendations`
                    }
                }]
            })
        );

        this.server.prompt(
            "experiment-review",
            "Review all running experiments and identify ones needing attention",
            async () => ({
                messages: [{
                    role: "user" as const,
                    content: {
                        type: "text" as const,
                        text: `Review all running experiments and identify any that need attention.

Steps:
1. Use execute_command with group "experiments", command "listExperiments", params { "state": "running", "show": ["experiment_report"] }
2. For each running experiment, check for:
   - SRM alerts (alert_srm)
   - Audience mismatch alerts
   - Sample size reached
   - Assignment conflicts
   - Experiments that have been running unusually long
3. Summarize findings and prioritize which experiments need immediate attention
4. Suggest next actions for each flagged experiment (stop, extend, investigate, etc.)`
                    }
                }]
            })
        );
    }
}

async function verifyApiKey(apiKey: string, endpoint: string): Promise<{ ok: boolean; user?: any; error?: string }> {
    try {
        const httpClient = new FetchHttpClient(normalizeBaseUrl(endpoint), { authToken: apiKey, authType: 'api-key' });
        const client = new APIClient(httpClient);
        const user = await client.getCurrentUser();
        return { ok: true, user };
    } catch (error: any) {
        const msg = error.message || String(error);
        console.error('API key verification error:', msg);
        if (msg.includes('HTTP 5')) return { ok: false, error: 'server_error' };
        if (msg.includes('Network error') || msg.includes('timed out')) return { ok: false, error: 'network_error' };
        return { ok: false, error: 'unauthorized' };
    }
}

const baseMcpHandler = ABsmartlyMCP.mount("/sse");

const oauthHandler = new ABsmartlyOAuthHandler();

const oauthProvider = new OAuthProvider({
    apiHandlers: {
        "/sse": baseMcpHandler
    },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    accessTokenTTL: 3600,
    scopesSupported: ["api:read", "api:write"],
    disallowPublicClientRegistration: false,
    defaultHandler: oauthHandler,
    clientLookup: async (clientId: string, env: any) => {
        const clientData = await safeKvGet(env.OAUTH_KV, `client:${clientId}`);
        if (clientData) {
            try {
                const client = JSON.parse(clientData);
                return {
                    clientId: client.clientId,
                    clientSecret: client.clientSecret,
                    redirectUris: client.redirectUris,
                    clientName: client.clientName,
                    tokenEndpointAuthMethod: client.tokenEndpointAuthMethod || 'client_secret_basic'
                };
            } catch (e) {
                console.warn(`Corrupt client data for ${clientId}, removing:`, e);
                try { await env.OAUTH_KV.delete(`client:${clientId}`); } catch (deleteErr) {
                    console.error(`Failed to remove corrupt client data for "${clientId}":`, deleteErr);
                }
            }
        }

        if (clientId.startsWith("claude-mcp-") || clientId.startsWith("C0")) {
            debug("Auto-registering public client:", clientId);
            const newClient = {
                clientId: clientId,
                redirectUris: [CLAUDE_AUTH_CALLBACK_URI],
                clientName: "Claude Desktop",
                tokenEndpointAuthMethod: 'none'
            };

            await safeKvPut(env.OAUTH_KV, `client:${clientId}`, JSON.stringify({
                ...newClient,
                registrationDate: Date.now()
            }));

            return newClient;
        }

        return null;
    },
} as any);

export default {
    async fetch(request: Request, env: any, ctx: any): Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === '/health') {
            return new Response(JSON.stringify({
                status: 'healthy',
                service: 'absmartly-mcp',
                version: MCP_VERSION,
                timestamp: new Date().toISOString()
            }), {
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }

        const authHeader = request.headers.get("Authorization");
        debug(`Authorization header present: ${authHeader ? 'yes' : 'no'}, type: ${authHeader?.split(' ')[0] || 'none'}`);

        const { apiKey, endpoint } = detectApiKey(request);
        debug(`detectApiKey result: apiKey=${apiKey ? apiKey.substring(0, 30) + '...' : 'null'}, endpoint=${endpoint}`);

        const clientFingerprint = `${request.headers.get('CF-Connecting-IP') || 'unknown'}-${request.headers.get('User-Agent') || 'unknown'}`;

        if (apiKey) {
            await safeKvPut(env.OAUTH_KV, `api_key_session:${clientFingerprint}`, 'active', {
                expirationTtl: API_KEY_SESSION_TTL_SECONDS,
            });
        }

        const isOAuthDiscoveryEndpoint = url.pathname === '/.well-known/oauth-authorization-server' ||
                                        url.pathname === '/.well-known/oauth-protected-resource' ||
                                        url.pathname.startsWith('/.well-known/oauth-authorization-server/') ||
                                        url.pathname.startsWith('/.well-known/oauth-protected-resource/');

        if (isOAuthDiscoveryEndpoint) {
            const apiKeySession = await safeKvGet(env.OAUTH_KV, `api_key_session:${clientFingerprint}`);
            if (apiKeySession) {
                return new Response(JSON.stringify({
                    error: "oauth_not_available",
                    error_description: "OAuth not available when using API key authentication"
                }), { status: 404 });
            }
        }

        if (url.pathname.startsWith("/sse")) {
            if (apiKey) {
                debug("API key detected, bypassing OAuth flow");

                try {
                    const verifyResult = await verifyApiKey(apiKey, endpoint || DEFAULT_ABSMARTLY_ENDPOINT);

                    if (!verifyResult.ok) {
                        const isTransient = verifyResult.error === 'server_error' || verifyResult.error === 'network_error';
                        console.error(`Failed to verify API key: ${verifyResult.error}`);
                        return new Response(isTransient ? "ABsmartly service temporarily unavailable" : "Unauthorized", {
                            status: isTransient ? 503 : 401,
                            headers: CORS_HEADERS,
                        });
                    }

                    const userData = verifyResult.user;
                    const userId = userData.id?.toString() || userData.email;

                    if (!userData.email) {
                        debug('No email found in API response for API key authentication, user data:', userData);
                    }

                    const props: ABsmartlyProps = {
                        email: userData.email || DEFAULT_API_KEY_USER_EMAIL,
                        name: `${userData.first_name || ''} ${userData.last_name || ''}`.trim() || userData.email || DEFAULT_API_KEY_USER_NAME,
                        absmartly_endpoint: endpoint || DEFAULT_ABSMARTLY_ENDPOINT,
                        absmartly_api_key: apiKey,
                        user_id: userId
                    };

                    debug(`API key authenticated for user: ${props.email}`);

                    const session = {
                        userId: userId,
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
                    return await baseMcpHandler.fetch(request, env, ctx);

                } catch (error) {
                    console.error("Error during API key authentication:", error);
                    return new Response("Internal Server Error", {
                        status: 500,
                        headers: CORS_HEADERS,
                    });
                }
            }

            const authHeader = request.headers.get("Authorization");

            if (!authHeader || !authHeader.startsWith("Bearer ")) {
                debug("No valid Authorization header, returning 401 to trigger OAuth flow");

                const requestedEndpoint = url.searchParams.get('absmartly-endpoint') ||
                    request.headers.get('x-absmartly-endpoint') ||
                    extractEndpointFromPath(url.pathname, '/sse') ||
                    endpoint;
                if (requestedEndpoint) {
                    await safeKvPut(env.OAUTH_KV, `oauth_endpoint_pending:${clientFingerprint}`, requestedEndpoint, {
                        expirationTtl: OAUTH_STATE_TTL_SECONDS,
                    });
                }

                return new Response("Unauthorized", {
                    status: 401,
                    headers: {
                        ...CORS_HEADERS,
                        "WWW-Authenticate": 'Bearer realm="OAuth"',
                    },
                });
            }

            return await oauthProvider.fetch(request, env, ctx);
        }

        if (url.pathname === '/register' && request.method === 'POST') {
            const pendingEndpoint = await safeKvGet(env.OAUTH_KV, `oauth_endpoint_pending:${clientFingerprint}`);
            const response = await oauthProvider.fetch(request, env, ctx);

            if (response.ok && pendingEndpoint) {
                const cloned = response.clone();
                try {
                    const body = await cloned.json() as { client_id?: string };
                    if (body.client_id) {
                        await safeKvPut(env.OAUTH_KV, `oauth_endpoint:client:${body.client_id}`, pendingEndpoint, {
                            expirationTtl: OAUTH_STATE_TTL_SECONDS,
                        });
                        debug(`Linked endpoint ${pendingEndpoint} to client ${body.client_id}`);
                    }
                    return new Response(JSON.stringify(body), {
                        status: response.status,
                        headers: response.headers,
                    });
                } catch (e) {
                    debug('Failed to link endpoint to client:', e);
                    return response;
                }
            }
            return response;
        }

        debug(`Routing non-SSE request to OAuth provider: ${request.method} ${url.pathname}`);
        return await oauthProvider.fetch(request, env, ctx);
    }
};