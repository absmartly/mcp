import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ABsmartlyAPIClient } from "./api-client";
import { ABsmartlyResources } from "./resources";
import { ABsmartlyOAuthHandler } from "./absmartly-oauth-handler";
import { Env } from "./types";
import { debug } from "./config";
import { MCP_VERSION } from "./version";

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
const DEFAULT_ABSMARTLY_DOMAIN = "absmartly.com";

const DEFAULT_BASELINE_METRIC_MEAN = '79';
const DEFAULT_BASELINE_METRIC_STDEV = '30';
const DEFAULT_BASELINE_PARTICIPANTS_PER_DAY = '1428';
const DEFAULT_REQUIRED_ALPHA = '0.1';
const DEFAULT_REQUIRED_POWER = '0.8';

function extractEndpointFromPath(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix + '/')) return null;
  const hostPart = pathname.slice(prefix.length + 1).replace(/\/+$/, '');
  if (!hostPart) return null;
  const host = hostPart.includes('.') ? hostPart : `${hostPart}.${DEFAULT_ABSMARTLY_DOMAIN}`;
  return `https://${host}`;
}

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

    private apiClient: ABsmartlyAPIClient | null = null;
    private resourcesSetup: boolean = false;
    private currentUserId: number | null = null;
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

        this.apiClient = new ABsmartlyAPIClient(
            authToken,
            this.props.absmartly_endpoint,
            authType
        );

        debug("API client initialized successfully");
    }

    private async fetchCurrentUser(): Promise<void> {
        if (!this.apiClient) return;
        try {
            const response = await this.apiClient.getCurrentUser();
            if (response.ok) {
                const userData = response.data?.user || response.data;
                this.currentUserId = userData?.id || null;
                debug("Current user ID:", this.currentUserId);
            }
        } catch (e) {
            debug("Failed to fetch current user:", e);
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
        if (responses.customFieldsResponse.status === 'fulfilled' && responses.customFieldsResponse.value.ok) {
            this._customFields = responses.customFieldsResponse.value.data?.experiment_custom_section_fields || [];
        } else {
            this.logEntityFetchError('customFields', responses.customFieldsResponse);
            this._customFields = [];
        }

        if (responses.usersResponse.status === 'fulfilled' && responses.usersResponse.value.ok) {
            const rawUsers = responses.usersResponse.value.data?.users || responses.usersResponse.value.data || [];
            this.users = rawUsers.map((user: any) => ({
                id: user.id,
                name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
                description: user.email || ''
            }));
        } else {
            this.logEntityFetchError('users', responses.usersResponse);
            this.users = [];
        }

        if (responses.teamsResponse.status === 'fulfilled' && responses.teamsResponse.value.ok) {
            const rawTeams = responses.teamsResponse.value.data?.teams || responses.teamsResponse.value.data || [];
            this.teams = rawTeams.map((team: any) => ({
                id: team.id,
                name: team.name,
                description: team.description || `${team.member_count || 0} members`
            }));
        } else {
            this.logEntityFetchError('teams', responses.teamsResponse);
            this.teams = [];
        }

        if (responses.applicationsResponse.status === 'fulfilled' && responses.applicationsResponse.value.ok) {
            const rawApplications = responses.applicationsResponse.value.data?.applications || responses.applicationsResponse.value.data || [];
            this.applications = rawApplications.map((app: any) => ({
                id: app.id,
                name: app.name,
                description: `Environment: ${app.environment || 'default'}`
            }));
        } else {
            this.logEntityFetchError('applications', responses.applicationsResponse);
            this.applications = [];
        }

        this.unitTypes = this.processSimpleEntity(responses.unitTypesResponse, 'unit_types');
        this.experimentTags = this.processSimpleEntity(responses.experimentTagsResponse, 'experiment_tags');
        this.metrics = this.processSimpleEntity(responses.metricsResponse, 'metrics');
        this.goals = this.processSimpleEntity(responses.goalsResponse, 'goals');
    }

    private logEntityFetchError(entityName: string, response: any) {
        if (response.status === 'rejected') {
            debug(`Failed to fetch ${entityName}: ${response.reason}`);
        } else if (response.status === 'fulfilled' && !response.value.ok) {
            debug(`Failed to fetch ${entityName}: ${response.value.errors?.join(', ') || 'Unknown error'}`);
        }
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
        this.logEntityFetchError(entityKey, response);
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

    private setupTools() {
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
                    const response = await this.apiClient.listExperiments({
                        search: params.search,
                        sort: params.sort,
                        page: params.page,
                        items: params.items || 10,
                        state: params.state,
                        significance: params.significance,
                        owners: params.owners,
                        teams: params.teams,
                        tags: params.tags,
                        templates: params.templates,
                        applications: params.applications,
                        unit_types: params.unit_types,
                        impact: params.impact,
                        created_at: params.created_at,
                        updated_at: params.updated_at,
                        full_on_at: params.full_on_at,
                        sample_ratio_mismatch: params.sample_ratio_mismatch,
                        cleanup_needed: params.cleanup_needed,
                        audience_mismatch: params.audience_mismatch,
                        sample_size_reached: params.sample_size_reached,
                        experiments_interact: params.experiments_interact,
                        group_sequential_updated: params.group_sequential_updated,
                        assignment_conflict: params.assignment_conflict,
                        metric_threshold_reached: params.metric_threshold_reached,
                        previews: params.previews,
                        analysis_type: params.analysis_type,
                        type: params.type,
                        iterations: params.iterations
                    });

                    if (!response.ok) {
                        return {
                            content: [{
                                type: "text",
                                text: `❌ API request failed: ${response.errors?.join(', ') || 'Unknown error'}`
                            }]
                        };
                    }

                    const experiments = response.data?.experiments || [];
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
                                    total: response.data?.total || experiments.length,
                                    page: response.data?.page || 1,
                                    items: response.data?.items || experiments.length,
                                    experiments: experimentsWithLinks
                                }, null, 2)
                            }]
                        };
                    } else {
                        let markdown = `# Experiments (${experiments.length} of ${response.data?.total || experiments.length})\n\n`;

                        if (experiments.length === 0) {
                            markdown += '*No experiments found matching your criteria.*\n';
                        } else {
                            markdown += experiments.map((exp: any) => 
                                this.formatExperimentAsMarkdown(exp, baseUrl)
                            ).join('\n');
                        }

                        const currentPage = response.data?.page || 1;
                        const totalPages = Math.ceil((response.data?.total || experiments.length) / (params.items || 10));

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

        this.server.tool(
            "list_users",
            "List users. Returns id, name, and email for each user.",
            {
                search: z.string().optional().describe("Search term to filter users. Searches in full name and email. Use the complete name for best results (e.g., 'Cal Courtney' not just 'Cal')"),
                sort: z.string().optional().describe("Sort field (e.g., created_at)"),
                items: z.number().optional().describe("Number of items per page (default: 1500)"),
                page: z.number().optional().describe("Page number (default: 1)")
            },
            async (params) => {
                if (params.items !== undefined || params.page !== undefined || params.sort !== undefined) {
                    const apiParams: Record<string, unknown> = {};
                    if (params.items !== undefined) apiParams.items = params.items;
                    if (params.page !== undefined) apiParams.page = params.page;
                    if (params.sort) apiParams.sort = params.sort;
                    if (params.search) apiParams.search = params.search;
                    const response = await this.apiClient!.listUsers(apiParams);
                    if (!response.ok) {
                        return { content: [{ type: "text", text: `Error: ${JSON.stringify(response.errors)}` }] };
                    }
                    const data = response.data as any;
                    const users = (data.users || []).map((u: any) => ({ id: u.id, name: u.name, email: u.description || u.email }));
                    return { content: [{ type: "text", text: JSON.stringify({ total: data.total || users.length, page: data.page, items: data.items, users }, null, 2) }] };
                }

                let users = this.users || [];

                if (params.search) {
                    const searchTerm = params.search.toLowerCase().trim();
                    const searchWords = searchTerm.split(/\s+/);

                    users = users.filter(user => {
                        const userName = user.name.toLowerCase();
                        const userEmail = (user.description || '').toLowerCase();

                        if (userName.includes(searchTerm) || userEmail.includes(searchTerm)) {
                            return true;
                        }

                        if (searchWords.length > 1) {
                            return searchWords.every(word => userName.includes(word));
                        }

                        const nameParts = userName.split(/\s+/);
                        return nameParts.some((part: string) => part.startsWith(searchTerm));
                    });
                }

                const formattedUsers = users.map(user => ({
                    id: user.id,
                    name: user.name,
                    email: user.description
                }));

                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            total: formattedUsers.length,
                            users: formattedUsers
                        }, null, 2)
                    }]
                };
            }
        );

        this.server.tool(
            "list_teams",
            "List teams",
            {
                search: z.string().optional().describe("Optional search term to filter teams by name"),
                sort: z.string().optional().describe("Sort field (e.g., created_at)"),
                items: z.number().optional().describe("Number of items per page (default: 1500)"),
                page: z.number().optional().describe("Page number (default: 1)")
            },
            async (params) => {
                if (params.items !== undefined || params.page !== undefined || params.sort !== undefined) {
                    const apiParams: Record<string, unknown> = {};
                    if (params.items !== undefined) apiParams.items = params.items;
                    if (params.page !== undefined) apiParams.page = params.page;
                    if (params.sort) apiParams.sort = params.sort;
                    if (params.search) apiParams.search = params.search;
                    const response = await this.apiClient!.listTeams(apiParams);
                    if (!response.ok) {
                        return { content: [{ type: "text", text: `Error: ${JSON.stringify(response.errors)}` }] };
                    }
                    const data = response.data as any;
                    const teams = data.teams || [];
                    return { content: [{ type: "text", text: JSON.stringify({ total: data.total || teams.length, page: data.page, items: data.items, teams }, null, 2) }] };
                }

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

        this.server.tool(
            "list_applications",
            "List applications",
            {
                search: z.string().optional().describe("Optional search term to filter applications by name"),
                sort: z.string().optional().describe("Sort field (e.g., created_at)"),
                items: z.number().optional().describe("Number of items per page (default: 1500)"),
                page: z.number().optional().describe("Page number (default: 1)")
            },
            async (params) => {
                if (params.items !== undefined || params.page !== undefined || params.sort !== undefined) {
                    const apiParams: Record<string, unknown> = {};
                    if (params.items !== undefined) apiParams.items = params.items;
                    if (params.page !== undefined) apiParams.page = params.page;
                    if (params.sort) apiParams.sort = params.sort;
                    if (params.search) apiParams.search = params.search;
                    const response = await this.apiClient!.listApplications(apiParams);
                    if (!response.ok) {
                        return { content: [{ type: "text", text: `Error: ${JSON.stringify(response.errors)}` }] };
                    }
                    const data = response.data as any;
                    const applications = data.applications || [];
                    return { content: [{ type: "text", text: JSON.stringify({ total: data.total || applications.length, page: data.page, items: data.items, applications }, null, 2) }] };
                }

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

        this.server.tool(
            "list_unit_types",
            "List unit types",
            {
                search: z.string().optional().describe("Optional search term to filter unit types by name"),
                sort: z.string().optional().describe("Sort field (e.g., created_at)"),
                items: z.number().optional().describe("Number of items per page (default: 1500)"),
                page: z.number().optional().describe("Page number (default: 1)")
            },
            async (params) => {
                if (params.items !== undefined || params.page !== undefined || params.sort !== undefined) {
                    const apiParams: Record<string, unknown> = {};
                    if (params.items !== undefined) apiParams.items = params.items;
                    if (params.page !== undefined) apiParams.page = params.page;
                    if (params.sort) apiParams.sort = params.sort;
                    if (params.search) apiParams.search = params.search;
                    const response = await this.apiClient!.listUnitTypes(apiParams);
                    if (!response.ok) {
                        return { content: [{ type: "text", text: `Error: ${JSON.stringify(response.errors)}` }] };
                    }
                    const data = response.data as any;
                    const unit_types = data.unit_types || [];
                    return { content: [{ type: "text", text: JSON.stringify({ total: data.total || unit_types.length, page: data.page, items: data.items, unit_types }, null, 2) }] };
                }

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

        this.server.tool(
            "list_tags",
            "List experiment tags",
            {
                search: z.string().optional().describe("Optional search term to filter tags by name"),
                sort: z.string().optional().describe("Sort field (e.g., tag)"),
                items: z.number().optional().describe("Number of items per page (default: 1500)"),
                page: z.number().optional().describe("Page number (default: 1)")
            },
            async (params) => {
                if (params.items !== undefined || params.page !== undefined || params.sort !== undefined) {
                    const apiParams: Record<string, unknown> = {};
                    if (params.items !== undefined) apiParams.items = params.items;
                    if (params.page !== undefined) apiParams.page = params.page;
                    if (params.sort) apiParams.sort = params.sort;
                    if (params.search) apiParams.search = params.search;
                    const response = await this.apiClient!.listExperimentTags(apiParams);
                    if (!response.ok) {
                        return { content: [{ type: "text", text: `Error: ${JSON.stringify(response.errors)}` }] };
                    }
                    const data = response.data as any;
                    const tags = data.experiment_tags || data.items || [];
                    const metadata = data.metadata || {};
                    return { content: [{ type: "text", text: JSON.stringify({ total: metadata.total || tags.length, page: metadata.page, items: metadata.items, tags }, null, 2) }] };
                }

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

        this.server.tool(
            "list_metrics",
            "List metrics. Use to find metric IDs for primary_metric_id when creating experiments.",
            {
                search: z.string().optional().describe("Optional search term to filter metrics by name"),
                sort: z.string().optional().describe("Sort field (e.g., created_at)"),
                items: z.number().optional().describe("Number of items per page (default: 1500)"),
                page: z.number().optional().describe("Page number (default: 1)")
            },
            async (params) => {
                if (params.items !== undefined || params.page !== undefined || params.sort !== undefined) {
                    const apiParams: Record<string, unknown> = {};
                    if (params.items !== undefined) apiParams.items = params.items;
                    if (params.page !== undefined) apiParams.page = params.page;
                    if (params.sort) apiParams.sort = params.sort;
                    if (params.search) apiParams.search = params.search;
                    const response = await this.apiClient!.listMetrics(apiParams);
                    if (!response.ok) {
                        return { content: [{ type: "text", text: `Error: ${JSON.stringify(response.errors)}` }] };
                    }
                    const data = response.data as any;
                    const metrics = data.metrics || [];
                    return { content: [{ type: "text", text: JSON.stringify({ total: data.total || metrics.length, page: data.page, items: data.items, metrics }, null, 2) }] };
                }

                let metrics = this.metrics || [];

                if (params.search) {
                    const searchTerm = params.search.toLowerCase();
                    metrics = metrics.filter(m =>
                        m.name.toLowerCase().includes(searchTerm)
                    );
                }

                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            total: metrics.length,
                            metrics: metrics
                        }, null, 2)
                    }]
                };
            }
        );

        this.server.tool(
            "list_goals",
            "List goals",
            {
                search: z.string().optional().describe("Optional search term to filter goals by name"),
                sort: z.string().optional().describe("Sort field (e.g., created_at)"),
                items: z.number().optional().describe("Number of items per page (default: 1500)"),
                page: z.number().optional().describe("Page number (default: 1)")
            },
            async (params) => {
                if (params.items !== undefined || params.page !== undefined || params.sort !== undefined) {
                    const apiParams: Record<string, unknown> = {};
                    if (params.items !== undefined) apiParams.items = params.items;
                    if (params.page !== undefined) apiParams.page = params.page;
                    if (params.sort) apiParams.sort = params.sort;
                    if (params.search) apiParams.search = params.search;
                    const response = await this.apiClient!.listGoals(apiParams);
                    if (!response.ok) {
                        return { content: [{ type: "text", text: `Error: ${JSON.stringify(response.errors)}` }] };
                    }
                    const data = response.data as any;
                    const goals = data.goals || [];
                    return { content: [{ type: "text", text: JSON.stringify({ total: data.total || goals.length, page: data.page, items: data.items, goals }, null, 2) }] };
                }

                let goals = this.goals || [];

                if (params.search) {
                    const searchTerm = params.search.toLowerCase();
                    goals = goals.filter(g =>
                        g.name.toLowerCase().includes(searchTerm)
                    );
                }

                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            total: goals.length,
                            goals: goals
                        }, null, 2)
                    }]
                };
            }
        );

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

                    const customFieldValues = this.buildCustomFieldValuesFromParams(params);
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
                        nr_variants: params.variants.length,
                        percentages: percentages,
                        percentage_of_traffic: params.percentage_of_traffic || 100,
                        seed: null,
                        traffic_seed: null,
                        unit_type: {
                            unit_type_id: params.unit_type_id
                        },
                        audience: '{"filter":[{"and":[]}]}',
                        audience_strict: true,
                        minimum_detectable_effect: null,
                        analysis_type: 'group_sequential',
                        baseline_primary_metric_mean: DEFAULT_BASELINE_METRIC_MEAN,
                        baseline_primary_metric_stdev: DEFAULT_BASELINE_METRIC_STDEV,
                        baseline_participants_per_day: DEFAULT_BASELINE_PARTICIPANTS_PER_DAY,
                        required_alpha: DEFAULT_REQUIRED_ALPHA,
                        required_power: DEFAULT_REQUIRED_POWER,
                        group_sequential_futility_type: 'binding',
                        group_sequential_analysis_count: null,
                        group_sequential_min_analysis_interval: '1d',
                        group_sequential_first_analysis_interval: '7d',
                        group_sequential_max_duration_interval: '4w',
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

                    debug('Creating experiment with data:', JSON.stringify(experimentData, null, 2));

                    const response = await this.apiClient.createExperiment(experimentData);
                    debug('API response:', JSON.stringify(response, null, 2));

                    if (!response.ok) {
                        const errorDetails = {
                            errors: response.errors,
                            details: response.details,
                            payload: experimentData
                        };
                        debug('Create experiment failed:', JSON.stringify(errorDetails, null, 2));
                        throw new Error(response.errors?.join(', ') || 'Failed to create experiment');
                    }

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify(response.data, null, 2)
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
                    const customFieldValues = this.buildCustomFieldValuesFromParams(params);
                    const ownerId = params.owner_user_id || this.currentUserId;

                    const experimentData: Record<string, any> = {
                        name: params.name,
                        display_name: params.name,
                        iteration: 1,
                        type: 'feature',
                        state: 'ready',
                        feature_state: null,
                        development_at: null,
                        start_at: null,
                        stop_at: null,
                        full_on_at: null,
                        full_on_variant: null,
                        feature_on_at: null,
                        feature_off_at: null,
                        last_seen_in_code_at: null,
                        nr_variants: 2,
                        percentages: `${100 - enabledPct}/${enabledPct}`,
                        percentage_of_traffic: 100,
                        seed: null,
                        traffic_seed: null,
                        unit_type: {
                            unit_type_id: params.unit_type_id
                        },
                        audience: '{"filter":[{"and":[]}]}',
                        audience_strict: true,
                        minimum_detectable_effect: null,
                        analysis_type: 'group_sequential',
                        baseline_primary_metric_mean: DEFAULT_BASELINE_METRIC_MEAN,
                        baseline_primary_metric_stdev: DEFAULT_BASELINE_METRIC_STDEV,
                        baseline_participants_per_day: DEFAULT_BASELINE_PARTICIPANTS_PER_DAY,
                        required_alpha: DEFAULT_REQUIRED_ALPHA,
                        required_power: DEFAULT_REQUIRED_POWER,
                        group_sequential_futility_type: 'binding',
                        group_sequential_analysis_count: null,
                        group_sequential_min_analysis_interval: '1d',
                        group_sequential_first_analysis_interval: '7d',
                        group_sequential_max_duration_interval: '4w',
                        applications: [{
                            application_id: params.application_id,
                            application_version: '0'
                        }],
                        variants: [
                            {
                                variant: 0,
                                name: 'Control (Feature Off)',
                                config: '{"feature_enabled": false}'
                            },
                            {
                                variant: 1,
                                name: 'Treatment (Feature On)',
                                config: '{"feature_enabled": true}'
                            }
                        ],
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

                    debug('Creating feature flag with data:', JSON.stringify(experimentData, null, 2));

                    const response = await this.apiClient.createExperiment(experimentData);
                    debug('API response:', JSON.stringify(response, null, 2));

                    if (!response.ok) {
                        const errorDetails = {
                            errors: response.errors,
                            details: response.details,
                            payload: experimentData
                        };
                        debug('Create feature flag failed:', JSON.stringify(errorDetails, null, 2));
                        throw new Error(`Failed to create feature flag: ${response.errors?.join(', ') || 'Unknown error'}`);
                    }

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify(response.data, null, 2)
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
                    if (params.action) {
                        let response;
                        switch (params.action) {
                            case 'start':
                                response = await this.apiClient.startExperiment(params.id);
                                break;
                            case 'stop':
                                response = await this.apiClient.stopExperiment(params.id);
                                break;
                            case 'archive':
                                response = await this.apiClient.archiveExperiment(params.id);
                                break;
                            case 'ready':
                                response = await this.apiClient.updateExperiment(params.id, { state: 'ready' });
                                break;
                            case 'full_on':
                                response = await this.apiClient.setExperimentFullOn(params.id, {
                                    full_on_variant: params.full_on_variant || 1
                                });
                                break;
                            case 'development':
                                response = await this.apiClient.setExperimentToDevelopment(params.id);
                                break;
                            case 'restart':
                                response = await this.apiClient.restartExperiment(params.id);
                                break;
                            default:
                                throw new Error(`Unknown action: ${params.action}`);
                        }

                        if (!response.ok) {
                            throw new Error(response.errors?.join(', ') || `Failed to ${params.action} experiment`);
                        }

                        return {
                            content: [{
                                type: "text",
                                text: JSON.stringify({
                                    message: `Successfully ${params.action === 'full_on' ? 'set to full on' : params.action + 'ed'} experiment ${params.id}`,
                                    experiment: response.data
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

                    const response = await this.apiClient.updateExperiment(params.id, updateData);

                    if (!response.ok) {
                        throw new Error(response.errors?.join(', ') || 'Failed to update experiment');
                    }

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify(response.data, null, 2)
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
                    const expResponse = await this.apiClient.getExperiment(params.experiment_id);
                    if (!expResponse.ok) {
                        throw new Error('Failed to fetch experiment');
                    }

                    const experiment = expResponse.data;
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

                    const response = await this.apiClient.updateExperiment(params.experiment_id, updateData);

                    if (!response.ok) {
                        throw new Error(response.errors?.join(', ') || 'Failed to add variant');
                    }

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                message: `Successfully added variant ${nextVariantIndex} to experiment ${params.experiment_id}`,
                                variant: newVariant,
                                experiment: response.data
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
                    const response = await this.apiClient.getExperiment(params.id);

                    if (!response.ok) {
                        throw new Error(response.errors?.join(', ') || 'Failed to fetch experiment');
                    }

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify(response.data, null, 2)
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

function detectApiKey(request: Request): { apiKey: string | null, endpoint: string | null } {
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

const baseMcpHandler = ABsmartlyMCP.mount("/sse");

const oauthHandler = new ABsmartlyOAuthHandler();

const debugOAuthHandler = {
    fetch: async (request: Request, env: any, ctx: any) => {
        debug(`🔍 debugOAuthHandler: ${request.method} ${new URL(request.url).pathname}`);
        const response = await oauthHandler.fetch(request, env, ctx);
        debug(`📍 debugOAuthHandler response status: ${response.status}`);
        return response;
    }
};

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

        if (clientId.startsWith("claude-mcp-") || clientId.startsWith("C0")) {
            debug("Auto-registering public client:", clientId);
            const newClient = {
                clientId: clientId,
                redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
                clientName: "Claude Desktop",
                tokenEndpointAuthMethod: 'none'
            };

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

        if (apiKey && env.OAUTH_KV) {
            await env.OAUTH_KV.put(`api_key_session:${clientFingerprint}`, 'active', {
                expirationTtl: 300 // 5 minutes
            });
        }

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

        if (url.pathname.startsWith("/sse")) {
            if (apiKey) {
                debug("API key detected, bypassing OAuth flow");

                try {
                    const apiClient = new ABsmartlyAPIClient(
                        apiKey,
                        endpoint || DEFAULT_ABSMARTLY_ENDPOINT,
                        'api-key'
                    );

                    const userResponse = await apiClient.getCurrentUser();

                    if (!userResponse.ok) {
                        console.error("Failed to fetch user info:", userResponse.errors);
                        return new Response("Unauthorized", {
                            status: 401,
                            headers: {
                                "Access-Control-Allow-Origin": "*",
                                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                                "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
                            },
                        });
                    }

                    const userData = userResponse.data.user || userResponse.data;
                    const userId = userData.id?.toString() || userData.email;

                    if (!userData.email) {
                        debug('No email found in API response for API key authentication, user data:', userData);
                    }

                    const props: ABsmartlyProps = {
                        email: userData.email || "api-key-user",
                        name: `${userData.first_name || ''} ${userData.last_name || ''}`.trim() || userData.email || "API Key User",
                        absmartly_endpoint: endpoint || DEFAULT_ABSMARTLY_ENDPOINT,
                        absmartly_api_key: apiKey,
                        user_id: userId
                    };

                    debug(`API key authenticated for user: ${props.email}`);

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

            const authHeader = request.headers.get("Authorization");

            if (!authHeader || !authHeader.startsWith("Bearer ")) {
                debug("No valid Authorization header, returning 401 to trigger OAuth flow");

                const requestedEndpoint = url.searchParams.get('absmartly-endpoint') ||
                    request.headers.get('x-absmartly-endpoint') ||
                    extractEndpointFromPath(url.pathname, '/sse') ||
                    endpoint;
                if (requestedEndpoint && env.OAUTH_KV) {
                    await env.OAUTH_KV.put(
                        `oauth_endpoint_pending:${clientFingerprint}`,
                        requestedEndpoint,
                        { expirationTtl: 120 }
                    );
                }

                return new Response("Unauthorized", {
                    status: 401,
                    headers: {
                        "WWW-Authenticate": 'Bearer realm="OAuth"',
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                        "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
                    },
                });
            }

            return await oauthProvider.fetch(request, env, ctx);
        }

        if (url.pathname === '/register' && request.method === 'POST' && env.OAUTH_KV) {
            const pendingEndpoint = await env.OAUTH_KV.get(`oauth_endpoint_pending:${clientFingerprint}`);
            const response = await oauthProvider.fetch(request, env, ctx);

            if (response.ok && pendingEndpoint) {
                try {
                    const body = await response.json() as { client_id?: string };
                    if (body.client_id) {
                        await env.OAUTH_KV.put(
                            `oauth_endpoint:client:${body.client_id}`,
                            pendingEndpoint,
                            { expirationTtl: 120 }
                        );
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