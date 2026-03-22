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
import {
    APIClient,
    summarizeExperiment,
    summarizeExperimentRow,
    summarizeMetric,
    summarizeMetricRow,
    summarizeGoal,
    summarizeGoalRow,
    summarizeTeam,
    summarizeTeamRow,
    summarizeUserDetail,
    summarizeUserRow,
    summarizeSegment,
    summarizeSegmentRow,
} from "@absmartly/cli/api-client";
import type { CustomSectionField } from "@absmartly/cli/api-client";
import { FetchHttpClient } from "./fetch-adapter";
import {
    API_CATEGORIES,
    API_CATALOG,
    searchCatalog,
    getCatalogByCategory,
    getMethodEntry,
    getCategorySummary,
} from "./api-catalog";
import type { ApiMethodEntry } from "./api-catalog";
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

const DEFAULT_LIST_ITEMS = 20;
const MAX_COMPLETIONS = 20;

export class ABsmartlyMCP extends McpAgent<Env, Record<string, never>, ABsmartlyProps> {
    server = new McpServer({
        name: "ABsmartly MCP Server",
        version: MCP_VERSION,
        capabilities: {
            tools: {},
            resources: { subscribe: true, listChanged: true },
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

    private log(level: 'debug' | 'info' | 'warning' | 'error', message: string): void {
        debug(message);
        try {
            this.server.server.sendLoggingMessage({ level, data: message });
        } catch {}
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

    private buildMethodArgs(entry: ApiMethodEntry, params: Record<string, unknown>): unknown[] {
        return entry.params.map(p => {
            const value = params[p.name];
            if (value === undefined && p.required) {
                throw new Error(`Missing required parameter: ${p.name}`);
            }
            return value;
        }).filter(v => v !== undefined);
    }

    private static readonly EXPERIMENT_LIST_METHODS = new Set([
        'listExperiments', 'searchExperiments',
    ]);
    private static readonly EXPERIMENT_SINGLE_METHODS = new Set([
        'getExperiment', 'createExperiment', 'updateExperiment',
        'startExperiment', 'stopExperiment', 'developmentExperiment',
        'restartExperiment', 'fullOnExperiment',
    ]);
    private static readonly METRIC_LIST_METHODS = new Set(['listMetrics']);
    private static readonly METRIC_SINGLE_METHODS = new Set(['getMetric', 'createMetric', 'updateMetric']);
    private static readonly GOAL_LIST_METHODS = new Set(['listGoals']);
    private static readonly GOAL_SINGLE_METHODS = new Set(['getGoal', 'createGoal', 'updateGoal']);
    private static readonly TEAM_LIST_METHODS = new Set(['listTeams']);
    private static readonly TEAM_SINGLE_METHODS = new Set(['getTeam', 'createTeam', 'updateTeam']);
    private static readonly USER_LIST_METHODS = new Set(['listUsers']);
    private static readonly USER_SINGLE_METHODS = new Set(['getUser', 'createUser', 'updateUser']);
    private static readonly SEGMENT_LIST_METHODS = new Set(['listSegments']);
    private static readonly SEGMENT_SINGLE_METHODS = new Set(['getSegment', 'createSegment', 'updateSegment']);

    private static isSingleEntity(result: unknown): result is Record<string, unknown> {
        return result !== null && typeof result === 'object' && !Array.isArray(result) && 'id' in result;
    }

    private getBaseUrl(): string {
        return this.props?.absmartly_endpoint?.replace(/\/v\d+\/?$/, '') || '';
    }

    private summarizeResult(methodName: string, result: unknown, show: string[], exclude: string[]): unknown {
        const baseUrl = this.getBaseUrl();
        if (ABsmartlyMCP.EXPERIMENT_LIST_METHODS.has(methodName) && Array.isArray(result)) {
            return result.map((exp: any) => {
                const summary = summarizeExperimentRow(exp, show, exclude);
                if (baseUrl) summary.link = `${baseUrl}/experiments/${exp.id}`;
                return summary;
            });
        }
        if (ABsmartlyMCP.EXPERIMENT_SINGLE_METHODS.has(methodName) && ABsmartlyMCP.isSingleEntity(result)) {
            const summary = summarizeExperiment(result as Record<string, unknown>, show, exclude);
            if (baseUrl) (summary as any).link = `${baseUrl}/experiments/${(result as any).id}`;
            return summary;
        }

        if (ABsmartlyMCP.METRIC_LIST_METHODS.has(methodName) && Array.isArray(result)) {
            return result.map((m: any) => summarizeMetricRow(m));
        }
        if (ABsmartlyMCP.METRIC_SINGLE_METHODS.has(methodName) && ABsmartlyMCP.isSingleEntity(result)) {
            return summarizeMetric(result as Record<string, unknown>);
        }

        if (ABsmartlyMCP.GOAL_LIST_METHODS.has(methodName) && Array.isArray(result)) {
            return result.map((g: any) => summarizeGoalRow(g));
        }
        if (ABsmartlyMCP.GOAL_SINGLE_METHODS.has(methodName) && ABsmartlyMCP.isSingleEntity(result)) {
            return summarizeGoal(result as Record<string, unknown>);
        }

        if (ABsmartlyMCP.TEAM_LIST_METHODS.has(methodName) && Array.isArray(result)) {
            return result.map((t: any) => summarizeTeamRow(t));
        }
        if (ABsmartlyMCP.TEAM_SINGLE_METHODS.has(methodName) && ABsmartlyMCP.isSingleEntity(result)) {
            return summarizeTeam(result as Record<string, unknown>);
        }

        if (ABsmartlyMCP.USER_LIST_METHODS.has(methodName) && Array.isArray(result)) {
            return result.map((u: any) => summarizeUserRow(u));
        }
        if (ABsmartlyMCP.USER_SINGLE_METHODS.has(methodName) && ABsmartlyMCP.isSingleEntity(result)) {
            return summarizeUserDetail(result as Record<string, unknown>);
        }

        if (ABsmartlyMCP.SEGMENT_LIST_METHODS.has(methodName) && Array.isArray(result)) {
            return result.map((s: any) => summarizeSegmentRow(s));
        }
        if (ABsmartlyMCP.SEGMENT_SINGLE_METHODS.has(methodName) && ABsmartlyMCP.isSingleEntity(result)) {
            return summarizeSegment(result as Record<string, unknown>);
        }

        return result;
    }

    private static readonly USER_FIELD_TYPE = 'user';
    private static readonly CREATE_EXPERIMENT_METHOD = 'createExperiment';

    private autoPopulateCustomFields(data: Record<string, unknown>): void {
        const existingValues = data.custom_section_field_values as Record<string, unknown> | undefined;
        if (existingValues && Object.keys(existingValues).length > 0) {
            return;
        }

        const experimentType = data.type as string | undefined;
        const fieldValues: Record<string, { type: string; value: string }> = {};

        for (const field of this._customFields as CustomSectionField[]) {
            if (field.archived) continue;
            if (!field.custom_section) continue;
            if (field.custom_section.type !== experimentType) continue;
            if (field.custom_section.archived) continue;

            let value = field.default_value || '';
            if (field.type === ABsmartlyMCP.USER_FIELD_TYPE && this.currentUserId) {
                value = JSON.stringify({ selected: [{ userId: this.currentUserId }] });
            }

            fieldValues[String(field.id)] = { type: field.type, value };
        }

        const customFieldsByName = (data as any).custom_fields as Record<string, string> | undefined;
        if (customFieldsByName) {
            for (const [name, val] of Object.entries(customFieldsByName)) {
                const matching = (this._customFields as CustomSectionField[]).find(
                    f => f.name === name && !f.archived
                );
                if (matching) {
                    fieldValues[String(matching.id)] = { type: matching.type, value: val };
                }
            }
            delete (data as any).custom_fields;
        }

        data.custom_section_field_values = fieldValues;
    }

    private setupTools() {
        this.server.tool(
            "get_auth_status",
            "Get current authentication status and user information",
            {},
            { readOnlyHint: true },
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
            "discover_api_methods",
            "Discover available ABsmartly API methods. Use this to find what operations are available before calling execute_api_method. You can browse by category or search by keyword.",
            {
                category: completable(
                    z.string().optional().describe(`Browse by category. Available: ${API_CATEGORIES.join(', ')}`),
                    (value) => {
                        const lower = (value || '').toLowerCase();
                        return API_CATEGORIES
                            .filter(c => c.toLowerCase().startsWith(lower))
                            .slice(0, MAX_COMPLETIONS);
                    }
                ),
                search: z.string().optional().describe("Search methods by keyword (matches method name, description, or category)"),
            },
            { readOnlyHint: true },
            async (params) => {
                if (!params.category && !params.search) {
                    const summary = getCategorySummary();
                    const lines = summary.map(s =>
                        `**${s.category}** (${s.count}): ${s.methods.join(', ')}`
                    );
                    return {
                        content: [{
                            type: "text" as const,
                            text: `# ABsmartly API — ${API_CATALOG.length} methods in ${summary.length} categories\n\nUse \`category\` to see details for a category, or \`search\` to find methods by keyword.\n\n${lines.join('\n\n')}`
                        }]
                    };
                }

                let results: ApiMethodEntry[];
                if (params.category) {
                    results = getCatalogByCategory(params.category);
                    if (results.length === 0) {
                        return { content: [{ type: "text" as const, text: `No methods found in category "${params.category}". Use discover_api_methods without params to see all categories.` }] };
                    }
                } else {
                    results = searchCatalog(params.search!);
                    if (results.length === 0) {
                        return { content: [{ type: "text" as const, text: `No methods found matching "${params.search}". Try a broader search or browse by category.` }] };
                    }
                }

                const formatted = results.map(m => {
                    const paramList = m.params.length > 0
                        ? m.params.map(p => `  - \`${p.name}\` (${p.type}${p.required ? ', required' : ''}): ${p.description}`).join('\n')
                        : '  (no parameters)';
                    return `### ${m.method}\n${m.description}\n${m.dangerous ? '**WARNING: Destructive operation**\n' : ''}**Params:**\n${paramList}\n**Returns:** ${m.returns}`;
                });

                return {
                    content: [{
                        type: "text" as const,
                        text: formatted.join('\n\n---\n\n')
                    }]
                };
            }
        );

        this.server.tool(
            "get_api_method_docs",
            "Get detailed documentation for a specific ABsmartly API method. Use discover_api_methods first to find the method name.",
            {
                method_name: completable(
                    z.string().describe("Exact method name (e.g. 'createMetric', 'listTeamMembers')"),
                    (value) => {
                        const lower = (value || '').toLowerCase();
                        return API_CATALOG
                            .filter(m => m.method.toLowerCase().includes(lower))
                            .map(m => m.method)
                            .slice(0, MAX_COMPLETIONS);
                    }
                ),
            },
            { readOnlyHint: true },
            async (params) => {
                const entry = getMethodEntry(params.method_name);
                if (!entry) {
                    const suggestions = searchCatalog(params.method_name).slice(0, 5);
                    const sugText = suggestions.length > 0
                        ? `\n\nDid you mean:\n${suggestions.map(s => `- ${s.method}: ${s.description}`).join('\n')}`
                        : '\n\nUse discover_api_methods to browse available methods.';
                    return { content: [{ type: "text" as const, text: `Method "${params.method_name}" not found.${sugText}` }] };
                }

                let doc = `# ${entry.method}\n\n**Category:** ${entry.category}\n**Description:** ${entry.description}\n`;
                if (entry.dangerous) {
                    doc += '**WARNING: This is a destructive/dangerous operation.**\n';
                }
                doc += `**Returns:** ${entry.returns}\n\n`;

                if (entry.params.length > 0) {
                    doc += '## Parameters\n\n';
                    doc += '| Name | Type | Required | Description |\n|------|------|----------|-------------|\n';
                    for (const p of entry.params) {
                        doc += `| ${p.name} | ${p.type} | ${p.required ? 'Yes' : 'No'} | ${p.description} |\n`;
                    }
                } else {
                    doc += '## Parameters\n\nNone.\n';
                }

                if (entry.example) {
                    doc += `\n## Example\n\n\`\`\`json\n${JSON.stringify(entry.example, null, 2)}\n\`\`\`\n`;
                }

                doc += `\n## Usage with execute_api_method\n\n\`\`\`json\n{\n  "method_name": "${entry.method}",\n  "params": ${JSON.stringify(
                    Object.fromEntries(entry.params.filter(p => p.required).map(p => [p.name, p.type === 'number' ? 1 : p.type === 'boolean' ? true : p.type === 'object' ? {} : p.type === 'array' ? [] : 'value'])),
                    null, 2
                )}\n}\n\`\`\``;

                if (params.method_name === ABsmartlyMCP.CREATE_EXPERIMENT_METHOD && this._customFields.length > 0) {
                    doc += '\n\n## Available Custom Fields\n\n';
                    doc += 'Pass `custom_fields` (by name) in `params.data` to override defaults:\n\n';
                    doc += '| Title | Type | Default Value | Section Type |\n|-------|------|---------------|-------------|\n';
                    for (const f of this._customFields as CustomSectionField[]) {
                        if (f.archived) continue;
                        const sectionType = f.custom_section?.type || 'unknown';
                        doc += `| ${f.name} | ${f.type} | ${f.default_value || ''} | ${sectionType} |\n`;
                    }
                }

                return { content: [{ type: "text" as const, text: doc }] };
            }
        );

        this.server.tool(
            "execute_api_method",
            "Execute any ABsmartly API method by name. Results for experiments, metrics, goals, teams, users, and segments are auto-summarized. Use 'show'/'exclude' for experiment field control. Pass 'raw: true' for unsummarized response. Some methods (delete, stop) are destructive.",
            {
                method_name: completable(
                    z.string().describe("Method name from the API catalog (e.g. 'getMetric', 'createTeam')"),
                    (value) => {
                        const lower = (value || '').toLowerCase();
                        return API_CATALOG
                            .filter(m => m.method.toLowerCase().includes(lower))
                            .map(m => m.method)
                            .slice(0, MAX_COMPLETIONS);
                    }
                ),
                params: z.record(z.unknown()).optional().describe("Method parameters as a JSON object. Keys match the parameter names from the method docs. For createExperiment, pass 'custom_fields' by name to override defaults."),
                show: z.array(z.string()).optional().describe("Extra fields to include in experiment summaries (e.g. ['audience', 'archived', 'experiment_report'])"),
                exclude: z.array(z.string()).optional().describe("Fields to exclude from experiment summaries (e.g. ['owners', 'tags', 'teams'])"),
                raw: z.boolean().optional().describe("Return full unsummarized response (default: false)"),
                limit: z.number().optional().describe("Max items for list operations (default: 20). Convenience shortcut for passing items/limit in params."),
            },
            { destructiveHint: true },
            async (params) => {
                if (!this.apiClient) {
                    return { content: [{ type: "text" as const, text: "API client not initialized. Check authentication status." }] };
                }

                const entry = getMethodEntry(params.method_name);
                if (!entry) {
                    return { content: [{ type: "text" as const, text: `Unknown method "${params.method_name}". Use discover_api_methods to find available methods.` }] };
                }

                const methodFn = (this.apiClient as any)[params.method_name];
                if (typeof methodFn !== 'function') {
                    return { content: [{ type: "text" as const, text: `Method "${params.method_name}" exists in catalog but is not available on the API client.` }] };
                }

                if (entry.dangerous) {
                    try {
                        const elicitResult = await this.server.server.elicitInput({
                            message: `Are you sure you want to ${entry.description.toLowerCase()}?`,
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

                        if (elicitResult.action !== 'accept' || elicitResult.content?.confirm !== 'yes') {
                            this.log('info', `Destructive action cancelled: ${params.method_name}`);
                            return { content: [{ type: "text" as const, text: `Action cancelled: ${params.method_name} was not confirmed by user.` }] };
                        }
                    } catch (_) {
                        debug("Elicitation not supported by client, proceeding without confirmation");
                    }
                }

                try {
                    const methodParams = params.params || {};
                    if (params.method_name === ABsmartlyMCP.CREATE_EXPERIMENT_METHOD && methodParams.data) {
                        this.autoPopulateCustomFields(methodParams.data as Record<string, unknown>);
                    }

                    const itemsLimit = params.limit ?? DEFAULT_LIST_ITEMS;
                    if (params.method_name.startsWith('list') || params.method_name.startsWith('search')) {
                        if (entry.params.some(ep => ep.name === 'options')) {
                            if (!methodParams.options) methodParams.options = {};
                            if (typeof methodParams.options === 'object' && !(methodParams.options as any).items) {
                                (methodParams.options as any).items = itemsLimit;
                            }
                        }
                        if (entry.params.some(ep => ep.name === 'limit') && methodParams.limit === undefined) {
                            methodParams.limit = itemsLimit;
                        }
                        if (entry.params.some(ep => ep.name === 'items') && methodParams.items === undefined) {
                            methodParams.items = itemsLimit;
                        }
                    }

                    const args = this.buildMethodArgs(entry, methodParams);
                    const result = await methodFn.apply(this.apiClient, args);

                    if (result === undefined || result === null) {
                        return { content: [{ type: "text" as const, text: `Successfully executed ${params.method_name}.` }] };
                    }

                    const showFields = params.show || [];
                    const excludeFields = params.exclude || [];
                    const output = params.raw
                        ? result
                        : this.summarizeResult(params.method_name, result, showFields, excludeFields);

                    return {
                        content: [{
                            type: "text" as const,
                            text: JSON.stringify(output, null, 2)
                        }]
                    };
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    this.log('error', `${params.method_name} failed: ${errorMsg}`);
                    return {
                        content: [{
                            type: "text" as const,
                            text: `Error executing ${params.method_name}: ${errorMsg}`
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
                type: z.string().optional().describe("Experiment type: 'test' or 'feature' (default: 'test')"),
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

Use the execute_api_method tool with method_name "createExperiment" to create it. Use the context below to fill in valid IDs for applications, unit types, metrics, teams, and custom fields.

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

Use the execute_api_method tool with method_name "createExperiment" to create it with type "feature". Feature flags typically have two variants: "off" (control) and "on" (treatment).

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
1. Use execute_api_method with method_name "getExperiment" and params { "id": ${args.id} } to fetch the experiment details (use show: ["experiment_report", "audience"] for full data)
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
1. Use execute_api_method with method_name "listExperiments" and params { "options": { "state": "running" } } with show: ["experiment_report"]
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