import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ABsmartlyResources } from "./resources";
import { ABsmartlyOAuthHandler } from "./absmartly-oauth-handler";
import { Env } from "./types";
import { debug } from "./config";
import { MCP_VERSION } from "./version";
import {
    parseExperimentMarkdown,
    generateTemplate,
    buildExperimentPayload,
    APIClient,
    ExperimentId,
} from "@absmartly/cli/api-client";
import type { ResolverContext } from "@absmartly/cli/api-client";
import { FetchHttpClient } from "./fetch-adapter";
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
    buildAuthHeader,
    extractEndpointFromPath,
    pickDefined,
    buildQueryString,
    detectApiKey,
    safeKvPut,
    safeKvGet,
} from "./shared";

const DEFAULT_BASELINE_METRIC_MEAN = '79';
const DEFAULT_BASELINE_METRIC_STDEV = '30';
const DEFAULT_BASELINE_PARTICIPANTS_PER_DAY = '1428';
const DEFAULT_REQUIRED_ALPHA = '0.1';
const DEFAULT_REQUIRED_POWER = '0.8';

const DEFAULT_ANALYSIS_TYPE = 'group_sequential';
const DEFAULT_FUTILITY_TYPE = 'binding';
const DEFAULT_MIN_ANALYSIS_INTERVAL = '1d';
const DEFAULT_FIRST_ANALYSIS_INTERVAL = '7d';
const DEFAULT_MAX_DURATION_INTERVAL = '4w';

export class ABsmartlyMCP extends McpAgent<Env, Record<string, never>, ABsmartlyProps> {
    server = new McpServer({
        name: "ABsmartly MCP Server",
        version: MCP_VERSION,
        capabilities: {
            tools: {},
            resources: {},
            prompts: {}
        }
    });

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

    async init() {
        debug("ABsmartly MCP initialization START");

        try {
            await this.initializeAPIClient();
            await Promise.all([
                this.fetchAllEntities(),
                this.fetchCurrentUser()
            ]);
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
        if (!this.props?.absmartly_endpoint) return;
        try {
            const authToken = this.props.absmartly_api_key || this.props.oauth_jwt;
            if (!authToken) return;
            const baseUrl = normalizeBaseUrl(this.props.absmartly_endpoint);
            const headers = buildAuthHeader(authToken, !!this.props.absmartly_api_key);
            const response = await fetch(`${baseUrl}/auth/current-user`, { headers });
            if (response.ok) {
                const data = await response.json() as any;
                const userData = data.user || data;
                this.currentUserId = userData?.id || null;
                debug("Current user ID:", this.currentUserId);
            } else {
                const msg = `Failed to fetch current user: HTTP ${response.status}`;
                console.warn(msg);
                this.entityWarnings.push(msg);
            }
        } catch (e) {
            const msg = `Failed to fetch current user: ${e}`;
            console.warn(msg);
            this.entityWarnings.push(msg);
        }
    }

    private customFieldKeyToTitle: Map<string, string> = new Map();

    private toSnakeCase(title: string): string {
        return title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    private buildCustomFieldZodSchema(): Record<string, z.ZodTypeAny> {
        const schema: Record<string, z.ZodTypeAny> = {};
        this.customFieldKeyToTitle.clear();

        const activeFields = this._customFields.filter((f: any) => !f.archived);
        for (const field of activeFields) {
            const key = this.toSnakeCase(field.title);
            this.customFieldKeyToTitle.set(key, field.title);

            const desc = field.description
                ? `${field.title} - ${field.description}`
                : field.title;

            switch (field.type) {
                case 'boolean':
                    schema[key] = z.boolean().optional().describe(desc);
                    break;
                case 'number':
                    schema[key] = z.number().optional().describe(desc);
                    break;
                case 'json':
                    schema[key] = z.string().optional().describe(`${desc} (JSON string)`);
                    break;
                default:
                    schema[key] = z.string().optional().describe(desc);
                    break;
            }
        }
        return schema;
    }

    private buildCustomFieldValuesFromParams(params: Record<string, any>): any[] {
        const values: any[] = [];
        for (const [key, title] of this.customFieldKeyToTitle) {
            const value = params[key];
            if (value === undefined || value === null) continue;

            const field = this._customFields.find((f: any) => f.title === title);
            if (!field) continue;

            values.push({
                experiment_custom_section_field_id: field.id,
                type: field.type,
                value: typeof value === 'object' ? JSON.stringify(value) : String(value)
            });
        }
        return values;
    }

    private async fetchAllEntities(): Promise<void> {
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
                safeCall('metrics', () => this.apiClient!.listMetrics(100, 0)),
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

            debug("✅ All entities fetched successfully");
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

    private formatExperimentAsMarkdown(exp: any, baseUrl: string): string {
        const link = `${baseUrl}/experiments/${exp.id}`;
        const state = exp.state.toUpperCase();
        const stateEmoji: Record<string, string> = {
            'CREATED': '🆕',
            'READY': '🟡',
            'RUNNING': '🟢',
            'STOPPED': '🔴',
            'ARCHIVED': '🗄️',
            'DEVELOPMENT': '🔧',
            'FULL_ON': '💯',
            'SCHEDULED': '📅'
        };
        const emoji = stateEmoji[state] || '❓';

        const hypothesis = exp.custom_section_field_values?.find((f: any) => 
            f.custom_section_field?.title === 'Hypothesis')?.value || '';
        const purpose = exp.custom_section_field_values?.find((f: any) => 
            f.custom_section_field?.title === 'Purpose')?.value || '';

        let md = `## ${emoji} [${exp.display_name || exp.name}](${link})\n\n`;
        md += `**ID:** ${exp.id} | **State:** ${state} | **Type:** ${exp.type || 'test'}\n`;
        md += `**Created:** ${new Date(exp.created_at).toLocaleDateString()} by ${exp.created_by?.first_name || 'Unknown'} ${exp.created_by?.last_name || ''}\n`;

        if (exp.owners?.length > 0) {
            const owners = exp.owners.map((o: any) => 
                `${o.user?.first_name || ''} ${o.user?.last_name || ''}`.trim()
            ).filter(Boolean).join(', ');
            if (owners) md += `**Owners:** ${owners}\n`;
        }

        if (exp.primary_metric) {
            md += `**Primary Metric:** ${exp.primary_metric.name}`;
            if (exp.minimum_detectable_effect) {
                md += ` (MDE: ${exp.minimum_detectable_effect}%)`;
            }
            md += '\n';
        }

        if (exp.percentages) {
            md += `**Traffic Split:** ${exp.percentages} (${exp.percentage_of_traffic}% of traffic)\n`;
        }

        if (hypothesis) {
            md += `\n**Hypothesis:** ${hypothesis}\n`;
        }

        if (purpose) {
            md += `\n**Purpose:** ${purpose}\n`;
        }

        if (exp.variants && exp.variants.length > 0) {
            md += '\n### Variants\n';
            for (const variant of exp.variants) {
                const variantName = variant.name || `Variant ${variant.variant}`;
                md += `- **${variantName}** (${variant.variant === 0 ? 'Control' : 'Treatment'})\n`;

                const screenshot = exp.variant_screenshots?.find((s: any) =>
                    s.variant === variant.variant
                );
                if (screenshot?.screenshot_url) {
                    md += `  ![${variantName} Screenshot](${screenshot.screenshot_url})\n`;
                }

                if (variant.config) {
                    md += `  Config: \`${variant.config}\`\n`;
                }
            }
        }

        if (exp.experiment_tags?.length > 0) {
            const tags = exp.experiment_tags.map((t: any) => t.tag?.name || t.name).filter(Boolean);
            if (tags.length > 0) {
                md += `\n**Tags:** ${tags.map((t: string) => `\`${t}\``).join(', ')}\n`;
            }
        }

        md += '\n---\n';
        return md;
    }

    private registerListEntityTool(config: {
        toolName: string;
        description: string;
        searchDescription: string;
        apiPath: string;
        entityKey: string;
        cachedEntities: () => any[];
        formatEntity?: (entity: any) => any;
    }) {
        this.server.tool(
            config.toolName,
            config.description,
            {
                search: z.string().optional().describe(config.searchDescription),
                sort: z.string().optional().describe("Sort field (e.g., created_at)"),
                items: z.number().optional().describe("Number of items per page (default: 1500)"),
                page: z.number().optional().describe("Page number (default: 1)"),
            },
            async (params) => {
                if (!this.apiClient) {
                    return { content: [{ type: "text", text: "❌ API client not initialized. Please check authentication status." }] };
                }

                if (params.items !== undefined || params.page !== undefined || params.sort !== undefined) {
                    try {
                        const apiParams = pickDefined(params as Record<string, unknown>, ['items', 'page', 'sort', 'search']);
                        const data = await this.apiClient.rawRequest(config.apiPath + buildQueryString(apiParams)) as any;
                        const entities = data[config.entityKey] || data.items || [];
                        const metadata = data.metadata || data;
                        const formatted = config.formatEntity ? entities.map(config.formatEntity) : entities;
                        return {
                            content: [{
                                type: "text",
                                text: JSON.stringify({
                                    total: metadata.total || formatted.length,
                                    page: metadata.page,
                                    items: metadata.items,
                                    [config.entityKey]: formatted,
                                }, null, 2),
                            }],
                        };
                    } catch (error) {
                        return { content: [{ type: "text", text: `❌ Failed to fetch ${config.entityKey}: ${error}` }] };
                    }
                }

                let entities = config.cachedEntities();
                if (params.search) {
                    const searchTerm = params.search.toLowerCase();
                    const searchWords = searchTerm.split(/\s+/);
                    entities = entities.filter((e: any) => {
                        const name = (e.name || '').toLowerCase();
                        const desc = (e.description || e.email || '').toLowerCase();
                        if (name.includes(searchTerm) || desc.includes(searchTerm)) return true;
                        if (searchWords.length > 1) return searchWords.every(w => name.includes(w));
                        return name.split(/\s+/).some((part: string) => part.startsWith(searchTerm));
                    });
                }

                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({ total: entities.length, [config.entityKey]: entities }, null, 2),
                    }],
                };
            }
        );
    }

    private setupTools() {
        this.server.tool(
            "get_auth_status",
            "Get current authentication status and user information",
            {},
            async () => {
                const hasApiAccess = !!this.apiClient;
                const authType = this.props?.absmartly_api_key ? 'API Key' : (this.props?.oauth_jwt ? 'OAuth JWT' : 'None');
                const status = hasApiAccess ? "✅ Authenticated with API access" : "⚠️ No API access available";

                let statusText = `${status}\n\nEmail: ${this.props?.email || 'Unknown'}\nName: ${this.props?.name || 'Unknown'}\nEndpoint: ${this.props?.absmartly_endpoint || 'Not configured'}\nAuthentication Type: ${authType}\nAPI Access: ${hasApiAccess ? 'Available' : 'Not available'}`;

                if (this.entityWarnings.length > 0) {
                    statusText += `\n\n⚠️ Entity fetch warnings:\n${this.entityWarnings.map(w => `- ${w}`).join('\n')}`;
                }

                return {
                    content: [{
                        type: "text",
                        text: statusText
                    }]
                };
            }
        );

        this.server.tool(
            "list_experiments",
            "List experiments with optional filtering. To filter by owner name: 1) First use list_users to find the user ID, 2) Then use the owners parameter with that ID",
            {
                search: z.string().optional().describe("Search experiments by name or description"),
                sort: z.string().optional().describe("Sort field (e.g., created_at, updated_at)"),
                page: z.number().optional().describe("Page number (default: 1)"),
                items: z.number().optional().describe("Items per page (default: 10)"),
                state: z.string().optional().describe("Filter by state (comma-separated: created,ready,running,development,full_on,running_not_full_on,stopped,archived,scheduled)"),
                significance: z.string().optional().describe("Filter by significance results (comma-separated: positive,negative,neutral,inconclusive)"),
                owners: z.string().optional().describe("Filter by owner user IDs (comma-separated numbers, e.g.: 3,5,7). To find a user's ID, use list_users with their full name (e.g., list_users({search: 'Cal Courtney'}))"),
                teams: z.string().optional().describe("Filter by team IDs (comma-separated numbers, e.g.: 1,2,3). Use the list_teams tool to find team IDs by name"),
                tags: z.string().optional().describe("Filter by tag IDs (comma-separated numbers, e.g.: 2,4,6). Use the list_tags tool to find tag IDs by name"),
                templates: z.string().optional().describe("Filter by template IDs (comma-separated numbers, e.g.: 238,240). Note: This expects numeric template IDs"),
                applications: z.string().optional().describe("Filter by application IDs (comma-separated numbers, e.g.: 39,3). Use the list_applications tool to find application IDs by name"),
                unit_types: z.string().optional().describe("Filter by unit type IDs (comma-separated numbers, e.g.: 42,75). Use the list_unit_types tool to find unit type IDs by name"),
                impact: z.string().optional().describe("Filter by impact range (min,max: 1,5)"),
                created_at: z.string().optional().describe("Filter by creation date range (start,end) in milliseconds since epoch"),
                updated_at: z.string().optional().describe("Filter by update date range (start,end) in milliseconds since epoch"),
                full_on_at: z.string().optional().describe("Filter by full_on date range (start,end) in milliseconds since epoch"),
                sample_ratio_mismatch: z.union([z.literal(0), z.literal(1)]).optional().describe("Filter experiments with sample ratio mismatch"),
                cleanup_needed: z.union([z.literal(0), z.literal(1)]).optional().describe("Filter experiments that need cleanup"),
                audience_mismatch: z.union([z.literal(0), z.literal(1)]).optional().describe("Filter experiments with audience mismatch"),
                sample_size_reached: z.union([z.literal(0), z.literal(1)]).optional().describe("Filter experiments that reached sample size"),
                experiments_interact: z.union([z.literal(0), z.literal(1)]).optional().describe("Filter experiments that interact with other experiments"),
                group_sequential_updated: z.union([z.literal(0), z.literal(1)]).optional().describe("Filter experiments with updated group sequential analysis"),
                assignment_conflict: z.union([z.literal(0), z.literal(1)]).optional().describe("Filter experiments with assignment conflicts"),
                metric_threshold_reached: z.union([z.literal(0), z.literal(1)]).optional().describe("Filter experiments that reached metric threshold"),
                previews: z.union([z.literal(0), z.literal(1)]).optional().describe("Include experiment preview data"),
                analysis_type: z.string().optional().describe("Filter by analysis type (e.g., group_sequential,fixed_horizon)"),
                type: z.string().optional().describe("Filter by experiment type (e.g., test, feature)"),
                iterations: z.number().optional().describe("Filter by number of iterations"),
                format: z.enum(['json', 'md']).optional().describe("Output format: 'json' for full data or 'md' for formatted markdown (default: md)")
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
                    const apiParams: Record<string, unknown> = { items: params.items || 10 };
                    if (params.search) apiParams.search = params.search;
                    if (params.sort) apiParams.sort = params.sort;
                    if (params.page) apiParams.page = params.page;
                    if (params.state) apiParams.state = params.state;
                    if (params.significance) apiParams.significance = params.significance;
                    if (params.owners) apiParams.owners = params.owners;
                    if (params.teams) apiParams.teams = params.teams;
                    if (params.tags) apiParams.tags = params.tags;
                    if (params.templates) apiParams.templates = params.templates;
                    if (params.applications) apiParams.applications = params.applications;
                    if (params.unit_types) apiParams.unit_types = params.unit_types;
                    if (params.impact) apiParams.impact = params.impact;
                    if (params.created_at) apiParams.created_at = params.created_at;
                    if (params.updated_at) apiParams.updated_at = params.updated_at;
                    if (params.full_on_at) apiParams.full_on_at = params.full_on_at;
                    if (params.sample_ratio_mismatch !== undefined) apiParams.sample_ratio_mismatch = params.sample_ratio_mismatch;
                    if (params.cleanup_needed !== undefined) apiParams.cleanup_needed = params.cleanup_needed;
                    if (params.audience_mismatch !== undefined) apiParams.audience_mismatch = params.audience_mismatch;
                    if (params.sample_size_reached !== undefined) apiParams.sample_size_reached = params.sample_size_reached;
                    if (params.experiments_interact !== undefined) apiParams.experiments_interact = params.experiments_interact;
                    if (params.group_sequential_updated !== undefined) apiParams.group_sequential_updated = params.group_sequential_updated;
                    if (params.assignment_conflict !== undefined) apiParams.assignment_conflict = params.assignment_conflict;
                    if (params.metric_threshold_reached !== undefined) apiParams.metric_threshold_reached = params.metric_threshold_reached;
                    if (params.previews !== undefined) apiParams.previews = params.previews;
                    if (params.analysis_type) apiParams.analysis_type = params.analysis_type;
                    if (params.type) apiParams.type = params.type;
                    if (params.iterations !== undefined) apiParams.iterations = params.iterations;

                    const queryString = buildQueryString(apiParams);
                    const data = await this.apiClient.rawRequest(`/experiments${queryString}`) as any;

                    const experiments = data.experiments || [];
                    const format = params.format || 'md';

                    const baseUrl = this.props.absmartly_endpoint.replace(/\/v1\/?$/, '');

                    if (format === 'json') {
                        const experimentsWithLinks = experiments.map((exp: any) => ({
                            ...exp,
                            link: `${baseUrl}/experiments/${exp.id}`
                        }));

                        return {
                            content: [{
                                type: "text",
                                text: JSON.stringify({
                                    total: data.total || experiments.length,
                                    page: data.page || 1,
                                    items: data.items || experiments.length,
                                    experiments: experimentsWithLinks
                                }, null, 2)
                            }]
                        };
                    } else {
                        let markdown = `# Experiments (${experiments.length} of ${data.total || experiments.length})\n\n`;

                        if (experiments.length === 0) {
                            markdown += '*No experiments found matching your criteria.*\n';
                        } else {
                            markdown += experiments.map((exp: any) =>
                                this.formatExperimentAsMarkdown(exp, baseUrl)
                            ).join('\n');
                        }

                        const currentPage = data.page || 1;
                        const totalPages = Math.ceil((data.total || experiments.length) / (params.items || 10));

                        if (totalPages > 1) {
                            markdown += `\n\n📄 Page ${currentPage} of ${totalPages}`;
                            if (currentPage < totalPages) {
                                markdown += ` (use \`page: ${currentPage + 1}\` to see more)`;
                            }
                        }

                        return {
                            content: [{
                                type: "text",
                                text: markdown
                            }]
                        };
                    }
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

        this.registerListEntityTool({
            toolName: "list_users",
            description: "List users. Returns id, name, and email for each user.",
            searchDescription: "Search term to filter users. Searches in full name and email. Use the complete name for best results (e.g., 'Cal Courtney' not just 'Cal')",
            apiPath: "/users",
            entityKey: "users",
            cachedEntities: () => this.users || [],
            formatEntity: (u: any) => ({ id: u.id, name: u.name, email: u.description || u.email }),
        });

        this.registerListEntityTool({
            toolName: "list_teams",
            description: "List teams",
            searchDescription: "Optional search term to filter teams by name",
            apiPath: "/teams",
            entityKey: "teams",
            cachedEntities: () => this.teams || [],
        });

        this.registerListEntityTool({
            toolName: "list_applications",
            description: "List applications",
            searchDescription: "Optional search term to filter applications by name",
            apiPath: "/applications",
            entityKey: "applications",
            cachedEntities: () => this.applications || [],
        });

        this.registerListEntityTool({
            toolName: "list_unit_types",
            description: "List unit types",
            searchDescription: "Optional search term to filter unit types by name",
            apiPath: "/unit_types",
            entityKey: "unit_types",
            cachedEntities: () => this.unitTypes || [],
        });

        this.registerListEntityTool({
            toolName: "list_tags",
            description: "List experiment tags",
            searchDescription: "Optional search term to filter tags by name",
            apiPath: "/experiment_tags",
            entityKey: "tags",
            cachedEntities: () => this.experimentTags || [],
        });

        this.registerListEntityTool({
            toolName: "list_metrics",
            description: "List metrics. Use to find metric IDs for primary_metric_id when creating experiments.",
            searchDescription: "Optional search term to filter metrics by name",
            apiPath: "/metrics",
            entityKey: "metrics",
            cachedEntities: () => this.metrics || [],
        });

        this.registerListEntityTool({
            toolName: "list_goals",
            description: "List goals",
            searchDescription: "Optional search term to filter goals by name",
            apiPath: "/goals",
            entityKey: "goals",
            cachedEntities: () => this.goals || [],
        });

        const customFieldSchema = this.buildCustomFieldZodSchema();

        this.server.tool(
            "create_experiment",
            "Create a new A/B test experiment with variants and configurations. Supports DOM changes for visual experiments like button styling, layout modifications, etc.",
            {
                name: z.string().describe("Experiment name"),
                display_name: z.string().optional().describe("Display name (defaults to name)"),
                description: z.string().optional().describe("Experiment description"),
                type: z.enum(['test', 'feature']).optional().describe("Experiment type (default: test)"),
                state: z.enum(['created', 'ready', 'running']).optional().describe("Initial state (default: ready)"),
                unit_type_id: z.number().describe("Unit type ID (use list_unit_types to find IDs)"),
                application_id: z.number().describe("Application ID (use list_applications to find IDs)"),
                percentage_of_traffic: z.number().optional().describe("Percentage of traffic to include (0-100, default: 100)"),
                variants: z.array(z.object({
                    variant: z.number().describe("Variant index (0 for control, 1+ for treatments)"),
                    name: z.string().describe("Variant name"),
                    config: z.string().describe("JSON string with variant configuration. For DOM changes use: {\"dom_changes\":[{\"selector\":\"button\",\"css\":{\"border-radius\":\"8px\",\"background-color\":\"#007bff\"}}]}"),
                    percentage: z.number().optional().describe("Traffic percentage for this variant")
                })).describe("Array of experiment variants with DOM change configurations"),
                primary_metric_id: z.number().optional().describe("Primary metric ID (use list_metrics to find IDs)"),
                tag_ids: z.array(z.number()).optional().describe("Tag IDs to assign (use list_tags to find IDs)"),
                owner_user_id: z.number().optional().describe("Owner user ID (defaults to logged-in user, use list_users to find IDs)"),
                team_id: z.number().optional().describe("Team ID (use list_teams to find IDs)"),
                ...customFieldSchema
            },
            async (params) => {
                if (!this.apiClient) {
                    return {
                        content: [{
                            type: "text",
                            text: "Error: No API access available. Please ensure you're authenticated."
                        }]
                    };
                }

                try {
                    let percentages = params.variants.map(v => v.percentage || 50).join('/');
                    if (!params.variants.some(v => v.percentage)) {
                        const perVariant = Math.floor(100 / params.variants.length);
                        const remainder = 100 - (perVariant * params.variants.length);
                        percentages = params.variants.map((_v, i) =>
                            i === 0 ? perVariant + remainder : perVariant
                        ).join('/');
                    }

                    const experimentData = this.buildBaseExperimentPayload({
                        name: params.name,
                        display_name: params.display_name,
                        type: params.type,
                        state: params.state,
                        unit_type_id: params.unit_type_id,
                        application_id: params.application_id,
                        percentage_of_traffic: params.percentage_of_traffic,
                        percentages,
                        nr_variants: params.variants.length,
                        variants: params.variants,
                        primary_metric_id: params.primary_metric_id,
                        owner_user_id: params.owner_user_id,
                    });

                    debug('Creating experiment with data:', JSON.stringify(experimentData, null, 2));

                    const result = await this.apiClient!.createExperiment(experimentData as any);

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify(result, null, 2)
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{
                            type: "text",
                            text: `Error creating experiment: ${errorMessage}`
                        }]
                    };
                }
            }
        );

        this.server.tool(
            "create_feature_flag",
            "Create a feature flag (experiment with type='feature' and simple on/off variants)",
            {
                name: z.string().describe("Feature flag name"),
                unit_type_id: z.number().describe("Unit type ID (use list_unit_types to find IDs)"),
                application_id: z.number().describe("Application ID (use list_applications to find IDs)"),
                feature_enabled_percentage: z.number().optional().describe("Percentage to enable feature (0-100, default: 50)"),
                description: z.string().optional().describe("Feature flag description"),
                primary_metric_id: z.number().optional().describe("Primary metric ID (use list_metrics to find IDs)"),
                tag_ids: z.array(z.number()).optional().describe("Tag IDs to assign (use list_tags to find IDs)"),
                owner_user_id: z.number().optional().describe("Owner user ID (defaults to logged-in user, use list_users to find IDs)"),
                team_id: z.number().optional().describe("Team ID (use list_teams to find IDs)"),
                ...customFieldSchema
            },
            async (params) => {
                if (!this.apiClient) {
                    return {
                        content: [{
                            type: "text",
                            text: "Error: No API access available. Please ensure you're authenticated."
                        }]
                    };
                }

                try {
                    const enabledPct = params.feature_enabled_percentage ?? 50;
                    const featureVariants = [
                        { variant: 0, name: 'Control (Feature Off)', config: '{"feature_enabled": false}' },
                        { variant: 1, name: 'Treatment (Feature On)', config: '{"feature_enabled": true}' }
                    ];

                    const experimentData = this.buildBaseExperimentPayload({
                        name: params.name,
                        type: 'feature',
                        state: 'ready',
                        unit_type_id: params.unit_type_id,
                        application_id: params.application_id,
                        percentages: `${100 - enabledPct}/${enabledPct}`,
                        nr_variants: 2,
                        variants: featureVariants,
                        primary_metric_id: params.primary_metric_id,
                        owner_user_id: params.owner_user_id,
                    });

                    debug('Creating feature flag with data:', JSON.stringify(experimentData, null, 2));

                    const result = await this.apiClient!.createExperiment(experimentData as any);

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify(result, null, 2)
                        }]
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{
                            type: "text",
                            text: `Error creating feature flag: ${errorMessage}`
                        }]
                    };
                }
            }
        );

        this.server.tool(
            "update_experiment",
            "Update experiment state or configuration (start, stop, archive, etc)",
            {
                id: z.number().describe("Experiment ID"),
                action: z.enum(['start', 'stop', 'archive', 'ready', 'full_on', 'development', 'restart']).optional().describe("State change action"),
                full_on_variant: z.number().optional().describe("Variant number for full_on action (>= 1, required when action is full_on)"),
                name: z.string().optional().describe("Update experiment name"),
                display_name: z.string().optional().describe("Update display name"),
                description: z.string().optional().describe("Update description"),
                percentage_of_traffic: z.number().optional().describe("Update traffic percentage (0-100)"),
                tag_ids: z.array(z.number()).optional().describe("Update tag IDs"),
                owner_user_id: z.number().optional().describe("Update owner user ID"),
                team_id: z.number().optional().describe("Update team ID")
            },
            async (params) => {
                if (!this.apiClient) {
                    return {
                        content: [{
                            type: "text",
                            text: "Error: No API access available. Please ensure you're authenticated."
                        }]
                    };
                }

                try {
                    const expId = ExperimentId(params.id);

                    if (params.action) {
                        let result: any;
                        switch (params.action) {
                            case 'start':
                                result = await this.apiClient!.startExperiment(expId);
                                break;
                            case 'stop':
                                result = await this.apiClient!.stopExperiment(expId);
                                break;
                            case 'archive':
                                await this.apiClient!.archiveExperiment(expId);
                                result = { id: params.id, state: 'archived' };
                                break;
                            case 'ready':
                                result = await this.apiClient!.rawRequest('/experiments/' + params.id, 'PUT', { data: { state: 'ready' } });
                                break;
                            case 'full_on':
                                result = await this.apiClient!.fullOnExperiment(expId, params.full_on_variant || 1, '');
                                break;
                            case 'development':
                                result = await this.apiClient!.developmentExperiment(expId, '');
                                break;
                            case 'restart':
                                result = await this.apiClient!.restartExperiment(expId);
                                break;
                            default:
                                throw new Error(`Unknown action: ${params.action}`);
                        }

                        return {
                            content: [{
                                type: "text",
                                text: JSON.stringify({
                                    message: `Successfully ${params.action === 'full_on' ? 'set to full on' : params.action + 'ed'} experiment ${params.id}`,
                                    experiment: result
                                }, null, 2)
                            }]
                        };
                    }

                    const updateData: any = {};
                    if (params.name !== undefined) updateData.name = params.name;
                    if (params.display_name !== undefined) updateData.display_name = params.display_name;
                    if (params.description !== undefined) updateData.description = params.description;
                    if (params.percentage_of_traffic !== undefined) updateData.percentage_of_traffic = params.percentage_of_traffic;
                    if (params.tag_ids !== undefined) updateData.tag_ids = params.tag_ids;
                    if (params.owner_user_id !== undefined) updateData.owner_user_id = params.owner_user_id;
                    if (params.team_id !== undefined) updateData.team_id = params.team_id;

                    const result = await this.apiClient!.updateExperiment(expId, updateData as any);

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify(result, null, 2)
                        }]
                    };
                } catch (error) {
                    return {
                        content: [{
                            type: "text",
                            text: `Error updating experiment: ${error instanceof Error ? error.message : String(error)}`
                        }]
                    };
                }
            }
        );

        this.server.tool(
            "create_variant",
            "Add a new variant to an existing experiment",
            {
                experiment_id: z.number().describe("Experiment ID"),
                name: z.string().describe("Variant name"),
                config: z.string().describe("JSON string with variant configuration"),
                percentage: z.number().optional().describe("Traffic percentage for this variant")
            },
            async (params) => {
                if (!this.apiClient) {
                    return {
                        content: [{
                            type: "text",
                            text: "Error: No API access available. Please ensure you're authenticated."
                        }]
                    };
                }

                try {
                    const experiment = await this.apiClient!.getExperiment(ExperimentId(params.experiment_id)) as any;
                    const currentVariants = experiment.variants || [];
                    const nextVariantIndex = currentVariants.length;

                    const newVariant = {
                        variant: nextVariantIndex,
                        name: params.name,
                        config: params.config
                    };

                    const updatedVariants = [...currentVariants, newVariant];

                    let percentages = experiment.percentages;
                    if (params.percentage !== undefined) {
                        const variantPercentages = currentVariants.map((v: any) => {
                            const pctStr = experiment.percentages.split('/');
                            return parseInt(pctStr[v.variant] || '0');
                        });
                        variantPercentages.push(params.percentage);

                        const total = variantPercentages.reduce((a: number, b: number) => a + b, 0);
                        if (total !== 100) {
                            const normalized = variantPercentages.map((p: number) => Math.round((p / total) * 100));
                            const diff = 100 - normalized.reduce((a: number, b: number) => a + b, 0);
                            normalized[0] += diff;
                            percentages = normalized.join('/');
                        } else {
                            percentages = variantPercentages.join('/');
                        }
                    } else {
                        const perVariant = Math.floor(100 / updatedVariants.length);
                        const remainder = 100 - (perVariant * updatedVariants.length);
                        percentages = updatedVariants.map((v, i) => 
                            i === 0 ? perVariant + remainder : perVariant
                        ).join('/');
                    }

                    const updateData = {
                        variants: updatedVariants,
                        nr_variants: updatedVariants.length,
                        percentages: percentages
                    };

                    const result = await this.apiClient!.updateExperiment(ExperimentId(params.experiment_id), updateData as any);

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                message: `Successfully added variant ${nextVariantIndex} to experiment ${params.experiment_id}`,
                                variant: newVariant,
                                experiment: result
                            }, null, 2)
                        }]
                    };
                } catch (error) {
                    return {
                        content: [{
                            type: "text",
                            text: `Error adding variant: ${error instanceof Error ? error.message : String(error)}`
                        }]
                    };
                }
            }
        );

        this.server.tool(
            "get_experiment",
            "Get detailed information about a specific experiment",
            {
                id: z.number().describe("Experiment ID")
            },
            async (params) => {
                if (!this.apiClient) {
                    return {
                        content: [{
                            type: "text",
                            text: "Error: No API access available. Please ensure you're authenticated."
                        }]
                    };
                }

                try {
                    const result = await this.apiClient!.getExperiment(ExperimentId(params.id));

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify(result, null, 2)
                        }]
                    };
                } catch (error) {
                    return {
                        content: [{
                            type: "text",
                            text: `Error fetching experiment: ${error instanceof Error ? error.message : String(error)}`
                        }]
                    };
                }
            }
        );

        this.server.tool(
            "create_experiment_from_markdown",
            "Create an experiment from a markdown template with YAML frontmatter. Supports name-based resolution for applications, unit types, and metrics (e.g., use 'website' instead of application ID 39).",
            {
                markdown: z.string().describe("Markdown template with YAML frontmatter defining the experiment. Use generate_experiment_template to get a sample template."),
            },
            async (params) => {
                if (!this.apiClient) {
                    return {
                        content: [{ type: "text", text: "Error: No API access available. Please ensure you're authenticated." }]
                    };
                }

                try {
                    const template = parseExperimentMarkdown(params.markdown);

                    if (!template.name) {
                        return {
                            content: [{ type: "text", text: "Error: Template must include a 'name' field." }],
                            isError: true,
                        };
                    }

                    const resolverContext = this.buildResolverContext();
                    const payload = buildExperimentPayload(template, resolverContext);

                    if (this.currentUserId && !payload.owners) {
                        payload.owners = [{ user_id: this.currentUserId }];
                    }

                    debug('Creating experiment from markdown with payload:', JSON.stringify(payload, null, 2));

                    const result = await this.apiClient!.createExperiment(payload as any);

                    return {
                        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
                        isError: true,
                    };
                }
            }
        );

        this.server.tool(
            "generate_experiment_template",
            "Generate a sample experiment markdown template populated with available applications, unit types, and metrics from your ABsmartly instance.",
            {
                name: z.string().optional().describe("Experiment name for the template (default: 'my_experiment')"),
                type: z.enum(['test', 'feature']).optional().describe("Experiment type (default: 'test')"),
            },
            async (params) => {
                try {
                    const generatorContext = {
                        applications: this.applications.map(a => ({ name: a.name })),
                        unitTypes: this.unitTypes.map(u => ({ name: u.name })),
                        metrics: this.metrics.map(m => ({ name: m.name })),
                    };

                    const content = generateTemplate(generatorContext, {
                        name: params.name,
                        type: params.type,
                    });

                    return {
                        content: [{ type: "text", text: content }]
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text", text: `Error generating template: ${error instanceof Error ? error.message : String(error)}` }],
                        isError: true,
                    };
                }
            }
        );

        this.server.tool(
            "create_feature_flag_from_markdown",
            "Create a feature flag from a simplified markdown template. Automatically sets type to 'feature' with on/off variants.",
            {
                markdown: z.string().describe("Markdown template with YAML frontmatter. Must include name, application, and unit_type. Optional: percentage_of_traffic (default 100), primary_metric."),
            },
            async (params) => {
                if (!this.apiClient) {
                    return {
                        content: [{ type: "text", text: "Error: No API access available. Please ensure you're authenticated." }]
                    };
                }

                try {
                    const template = parseExperimentMarkdown(params.markdown);
                    template.type = 'feature';

                    if (!template.variants || template.variants.length === 0) {
                        template.variants = [
                            { variant: 0, name: 'Control (Feature Off)', config: '{"feature_enabled": false}' },
                            { variant: 1, name: 'Treatment (Feature On)', config: '{"feature_enabled": true}' },
                        ];
                        template.percentages = '50/50';
                    }

                    if (!template.name) {
                        return {
                            content: [{ type: "text", text: "Error: Template must include a 'name' field." }],
                            isError: true,
                        };
                    }

                    const resolverContext = this.buildResolverContext();
                    const payload = buildExperimentPayload(template, resolverContext);

                    if (this.currentUserId && !payload.owners) {
                        payload.owners = [{ user_id: this.currentUserId }];
                    }

                    debug('Creating feature flag from markdown with payload:', JSON.stringify(payload, null, 2));

                    const result = await this.apiClient!.createExperiment(payload as any);

                    return {
                        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
                        isError: true,
                    };
                }
            }
        );

    }

    private buildBaseExperimentPayload(params: {
        name: string;
        display_name?: string;
        type?: string;
        state?: string;
        unit_type_id: number;
        application_id: number;
        percentage_of_traffic?: number;
        percentages: string;
        nr_variants: number;
        variants: any[];
        primary_metric_id?: number;
        owner_user_id?: number;
    }): Record<string, any> {
        const customFieldValues = this.buildCustomFieldValuesFromParams(params as any);
        const ownerId = params.owner_user_id || this.currentUserId;

        const experimentData: Record<string, any> = {
            name: params.name,
            display_name: params.display_name || params.name,
            iteration: 1,
            type: params.type || 'test',
            state: params.state || 'ready',
            feature_state: null,
            development_at: null,
            start_at: null,
            stop_at: null,
            full_on_at: null,
            full_on_variant: null,
            feature_on_at: null,
            feature_off_at: null,
            last_seen_in_code_at: null,
            nr_variants: params.nr_variants,
            percentages: params.percentages,
            percentage_of_traffic: params.percentage_of_traffic ?? 100,
            seed: null,
            traffic_seed: null,
            unit_type: {
                unit_type_id: params.unit_type_id
            },
            audience: '{"filter":[{"and":[]}]}',
            audience_strict: true,
            minimum_detectable_effect: null,
            analysis_type: DEFAULT_ANALYSIS_TYPE,
            baseline_primary_metric_mean: DEFAULT_BASELINE_METRIC_MEAN,
            baseline_primary_metric_stdev: DEFAULT_BASELINE_METRIC_STDEV,
            baseline_participants_per_day: DEFAULT_BASELINE_PARTICIPANTS_PER_DAY,
            required_alpha: DEFAULT_REQUIRED_ALPHA,
            required_power: DEFAULT_REQUIRED_POWER,
            group_sequential_futility_type: DEFAULT_FUTILITY_TYPE,
            group_sequential_analysis_count: null,
            group_sequential_min_analysis_interval: DEFAULT_MIN_ANALYSIS_INTERVAL,
            group_sequential_first_analysis_interval: DEFAULT_FIRST_ANALYSIS_INTERVAL,
            group_sequential_max_duration_interval: DEFAULT_MAX_DURATION_INTERVAL,
            applications: [{
                application_id: params.application_id,
                application_version: '0'
            }],
            variants: params.variants,
            variant_screenshots: [],
            owners: ownerId ? [{ user_id: ownerId }] : [],
            secondary_metrics: [],
            teams: [],
            experiment_tags: [],
            custom_section_field_values: customFieldValues
        };

        if (params.primary_metric_id) {
            experimentData.primary_metric = { metric_id: params.primary_metric_id };
        }

        return experimentData;
    }

    private buildResolverContext(): ResolverContext {
        return {
            applications: this.applications.map(a => ({ id: a.id, name: a.name })),
            unitTypes: this.unitTypes.map(u => ({ id: u.id, name: u.name })),
            metrics: this.metrics.map(m => ({ id: m.id, name: m.name })),
            goals: this.goals.map(g => ({ id: g.id, name: g.name })),
            customSectionFields: this._customFields.map((f: any) => ({
                id: f.id,
                name: f.title || f.name,
                type: f.type,
                default_value: f.default_value,
                archived: f.archived,
                custom_section: f.custom_section,
            })),
        };
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

async function verifyApiKey(apiKey: string, endpoint: string): Promise<{ ok: boolean; user?: any; error?: string }> {
    const baseUrl = normalizeBaseUrl(endpoint);
    const headers = buildAuthHeader(apiKey, true);
    try {
        const response = await fetch(`${baseUrl}/auth/current-user`, { headers });
        if (!response.ok) {
            return { ok: false, error: response.status >= 500 ? 'server_error' : 'unauthorized' };
        }
        const data = await response.json() as any;
        return { ok: true, user: data.user || data };
    } catch (error) {
        return { ok: false, error: 'network_error' };
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
                try { await env.OAUTH_KV.delete(`client:${clientId}`); } catch {}
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
        debug(`Raw Authorization header: ${authHeader ? authHeader.substring(0, 100) + '...' : 'null'}`);

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
                        const status = verifyResult.error === 'server_error' ? 502 : 401;
                        console.error(`Failed to verify API key: ${verifyResult.error}`);
                        return new Response("Unauthorized", {
                            status,
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