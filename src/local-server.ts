#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { homedir } from "os";
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
import { FetchHttpClient } from "./fetch-adapter.js";
import {
    API_CATEGORIES,
    API_CATALOG,
    searchCatalog,
    getCatalogByCategory,
    getMethodEntry,
    getCategorySummary,
} from "./api-catalog.js";
import type { ApiMethodEntry } from "./api-catalog.js";
import { MCP_VERSION } from "./version.js";

const CONFIG_FILE_PATH = '.config/absmartly/config.yaml';
const DEFAULT_PROFILE_NAME = 'default';
const KEYCHAIN_SERVICE = 'absmartly-cli';
const KEYCHAIN_ACCOUNT_PREFIX = 'api-key';
const CREDENTIALS_FILE_PATH = '.config/absmartly/credentials.json';

const DEFAULT_LIST_ITEMS = 20;
const MAX_COMPLETIONS = 20;

const EXPERIMENT_LIST_METHODS = new Set([
    'listExperiments', 'searchExperiments',
]);
const EXPERIMENT_SINGLE_METHODS = new Set([
    'getExperiment', 'createExperiment', 'updateExperiment',
    'startExperiment', 'stopExperiment', 'developmentExperiment',
    'restartExperiment', 'fullOnExperiment',
]);
const METRIC_LIST_METHODS = new Set(['listMetrics']);
const METRIC_SINGLE_METHODS = new Set(['getMetric', 'createMetric', 'updateMetric']);
const GOAL_LIST_METHODS = new Set(['listGoals']);
const GOAL_SINGLE_METHODS = new Set(['getGoal', 'createGoal', 'updateGoal']);
const TEAM_LIST_METHODS = new Set(['listTeams']);
const TEAM_SINGLE_METHODS = new Set(['getTeam', 'createTeam', 'updateTeam']);
const USER_LIST_METHODS = new Set(['listUsers']);
const USER_SINGLE_METHODS = new Set(['getUser', 'createUser', 'updateUser']);
const SEGMENT_LIST_METHODS = new Set(['listSegments']);
const SEGMENT_SINGLE_METHODS = new Set(['getSegment', 'createSegment', 'updateSegment']);
const CREATE_EXPERIMENT_METHOD = 'createExperiment';
const USER_FIELD_TYPE = 'user';

interface ProfileConfig {
    endpoint: string;
    apiKey: string;
}

function parseYamlConfig(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = text.split('\n');
    const keyStack: string[] = [];
    const indentStack: number[] = [-1];

    for (const line of lines) {
        if (!line.trim() || line.trim().startsWith('#')) continue;

        const indent = line.search(/\S/);
        const match = line.match(/^(\s*)([^:]+?):\s*(.*)$/);
        if (!match) continue;

        const key = match[2].trim();
        const value = match[3].trim();

        while (indentStack.length > 1 && indent <= indentStack[indentStack.length - 1]) {
            indentStack.pop();
            keyStack.pop();
        }

        if (value) {
            const fullKey = [...keyStack, key].join('.');
            result[fullKey] = value;
        } else {
            keyStack.push(key);
            indentStack.push(indent);
        }
    }

    return result;
}

function readProfileConfig(profileName: string): ProfileConfig {
    const configPath = join(homedir(), CONFIG_FILE_PATH);
    if (!existsSync(configPath)) {
        throw new Error(`ABsmartly CLI config not found at ${configPath}. Run 'absmartly login' first.`);
    }

    const configText = readFileSync(configPath, 'utf-8');
    const config = parseYamlConfig(configText);

    const resolvedProfile = profileName === DEFAULT_PROFILE_NAME && config['default-profile']
        ? config['default-profile']
        : profileName;

    const endpoint = config[`profiles.${resolvedProfile}.api.endpoint`]
        || config[`profiles.${resolvedProfile}.endpoint`]
        || config[`profiles.${resolvedProfile}.url`];
    if (!endpoint) {
        throw new Error(`No endpoint found for profile "${resolvedProfile}" in ${configPath}`);
    }

    const accountName = resolvedProfile === 'default'
        ? KEYCHAIN_ACCOUNT_PREFIX
        : `${KEYCHAIN_ACCOUNT_PREFIX}-${resolvedProfile}`;

    let apiKey: string | undefined;

    try {
        apiKey = execFileSync('security', [
            'find-generic-password',
            '-s', KEYCHAIN_SERVICE,
            '-a', accountName,
            '-w',
        ], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {}

    if (!apiKey) {
        const credentialsPath = join(homedir(), CREDENTIALS_FILE_PATH);
        if (existsSync(credentialsPath)) {
            try {
                const creds = JSON.parse(readFileSync(credentialsPath, 'utf-8'));
                apiKey = creds[accountName] || undefined;
            } catch {}
        }
    }

    if (!apiKey) {
        throw new Error(`No API key found for profile "${resolvedProfile}". Run 'abs auth login' first.`);
    }

    return { endpoint, apiKey };
}

function isSingleEntity(result: unknown): result is Record<string, unknown> {
    return result !== null && typeof result === 'object' && !Array.isArray(result) && 'id' in result;
}

function summarizeResult(methodName: string, result: unknown, show: string[], exclude: string[], baseUrl: string): unknown {
    if (EXPERIMENT_LIST_METHODS.has(methodName) && Array.isArray(result)) {
        return result.map((exp: any) => {
            const summary = summarizeExperimentRow(exp, show, exclude);
            if (baseUrl) summary.link = `${baseUrl}/experiments/${exp.id}`;
            return summary;
        });
    }
    if (EXPERIMENT_SINGLE_METHODS.has(methodName) && isSingleEntity(result)) {
        const summary = summarizeExperiment(result as Record<string, unknown>, show, exclude);
        if (baseUrl) (summary as any).link = `${baseUrl}/experiments/${(result as any).id}`;
        return summary;
    }
    if (METRIC_LIST_METHODS.has(methodName) && Array.isArray(result)) {
        return result.map((m: any) => summarizeMetricRow(m));
    }
    if (METRIC_SINGLE_METHODS.has(methodName) && isSingleEntity(result)) {
        return summarizeMetric(result as Record<string, unknown>);
    }
    if (GOAL_LIST_METHODS.has(methodName) && Array.isArray(result)) {
        return result.map((g: any) => summarizeGoalRow(g));
    }
    if (GOAL_SINGLE_METHODS.has(methodName) && isSingleEntity(result)) {
        return summarizeGoal(result as Record<string, unknown>);
    }
    if (TEAM_LIST_METHODS.has(methodName) && Array.isArray(result)) {
        return result.map((t: any) => summarizeTeamRow(t));
    }
    if (TEAM_SINGLE_METHODS.has(methodName) && isSingleEntity(result)) {
        return summarizeTeam(result as Record<string, unknown>);
    }
    if (USER_LIST_METHODS.has(methodName) && Array.isArray(result)) {
        return result.map((u: any) => summarizeUserRow(u));
    }
    if (USER_SINGLE_METHODS.has(methodName) && isSingleEntity(result)) {
        return summarizeUserDetail(result as Record<string, unknown>);
    }
    if (SEGMENT_LIST_METHODS.has(methodName) && Array.isArray(result)) {
        return result.map((s: any) => summarizeSegmentRow(s));
    }
    if (SEGMENT_SINGLE_METHODS.has(methodName) && isSingleEntity(result)) {
        return summarizeSegment(result as Record<string, unknown>);
    }
    return result;
}

function buildMethodArgs(entry: ApiMethodEntry, params: Record<string, unknown>): unknown[] {
    return entry.params.map(p => {
        const value = params[p.name];
        if (value === undefined && p.required) {
            throw new Error(`Missing required parameter: ${p.name}`);
        }
        return value;
    }).filter(v => v !== undefined);
}

function buildEntityContext(entities: {
    applications: any[];
    unitTypes: any[];
    metrics: any[];
    teams: any[];
    customFields: CustomSectionField[];
}): string {
    const sections: string[] = [];

    if (entities.applications.length > 0) {
        const lines = entities.applications.map((a: any) => `  - id=${a.id}, name="${a.name}"`);
        sections.push(`Applications:\n${lines.join('\n')}`);
    }
    if (entities.unitTypes.length > 0) {
        const lines = entities.unitTypes.map((u: any) => `  - id=${u.id}, name="${u.name}"`);
        sections.push(`Unit Types:\n${lines.join('\n')}`);
    }
    if (entities.metrics.length > 0) {
        const lines = entities.metrics.map((m: any) => `  - id=${m.id}, name="${m.name}"`);
        sections.push(`Metrics:\n${lines.join('\n')}`);
    }
    if (entities.teams.length > 0) {
        const lines = entities.teams.map((t: any) => `  - id=${t.id}, name="${t.name}"`);
        sections.push(`Teams:\n${lines.join('\n')}`);
    }
    if (entities.customFields.length > 0) {
        const cfLines = entities.customFields
            .filter(f => !f.archived)
            .map(f => `  - title="${f.name}", type="${f.type}", default="${f.default_value || ''}", section_type="${f.custom_section?.type || 'unknown'}"`);
        sections.push(`Custom Fields:\n${cfLines.join('\n')}`);
    }

    return sections.join('\n\n');
}

async function main() {
    const profileArg = process.argv.find(a => a.startsWith('--profile='));
    const profileName = profileArg ? profileArg.split('=')[1] : DEFAULT_PROFILE_NAME;

    const config = readProfileConfig(profileName);

    const fetchHttpClient = new FetchHttpClient(config.endpoint, {
        authToken: config.apiKey,
        authType: 'api-key',
    });
    const apiClient = new APIClient(fetchHttpClient);

    const mcpServer = new McpServer({
        name: "ABsmartly MCP Server (Local)",
        version: MCP_VERSION,
        capabilities: {
            tools: {},
            resources: { subscribe: true, listChanged: true },
            prompts: {},
        },
    });

    let currentUserId: number | null = null;
    const entityWarnings: string[] = [];
    let customFields: CustomSectionField[] = [];
    let users: any[] = [];
    let teams: any[] = [];
    let applications: any[] = [];
    let unitTypes: any[] = [];
    let experimentTags: any[] = [];
    let metrics: any[] = [];
    let goals: any[] = [];

    const safeCall = async <T>(label: string, fn: () => Promise<T[]>): Promise<T[]> => {
        try {
            return await fn();
        } catch (e) {
            const msg = `Failed to fetch ${label}: ${e}`;
            entityWarnings.push(msg);
            console.error(msg);
            return [];
        }
    };

    try {
        const user = await apiClient.getCurrentUser();
        currentUserId = user?.id || null;
    } catch (e) {
        entityWarnings.push(`Failed to fetch current user: ${e}`);
    }

    const [
        rawCustomFields,
        rawUsers,
        rawTeams,
        rawApplications,
        rawUnitTypes,
        rawExperimentTags,
        rawMetrics,
        rawGoals,
    ] = await Promise.all([
        safeCall('customFields', () => apiClient.listCustomSectionFields()),
        safeCall('users', () => apiClient.listUsers()),
        safeCall('teams', () => apiClient.listTeams()),
        safeCall('applications', () => apiClient.listApplications()),
        safeCall('unitTypes', () => apiClient.listUnitTypes()),
        safeCall('experimentTags', () => apiClient.listExperimentTags(100, 0)),
        safeCall('metrics', () => apiClient.listMetrics({ items: 100 })),
        safeCall('goals', () => apiClient.listGoals(100, 0)),
    ]);

    customFields = rawCustomFields as CustomSectionField[];
    users = (rawUsers as any[]).map((u: any) => ({
        id: u.id,
        name: `${u.first_name || ''} ${u.last_name || ''}`.trim(),
        description: u.email || '',
    }));
    teams = (rawTeams as any[]).map((t: any) => ({
        id: t.id,
        name: t.name,
        description: t.description || `${t.member_count || 0} members`,
    }));
    applications = (rawApplications as any[]).map((a: any) => ({
        id: a.id,
        name: a.name,
        description: `Environment: ${a.environment || 'default'}`,
    }));
    unitTypes = (rawUnitTypes as any[]).map((e: any) => ({
        id: e.id, name: e.name || e.tag, description: e.description || `unit_type: ${e.name || e.tag}`,
    }));
    experimentTags = (rawExperimentTags as any[]).map((e: any) => ({
        id: e.id, name: e.name || e.tag, description: e.description || `experiment_tag: ${e.name || e.tag}`,
    }));
    metrics = (rawMetrics as any[]).map((e: any) => ({
        id: e.id, name: e.name || e.tag, description: e.description || `metric: ${e.name || e.tag}`,
    }));
    goals = (rawGoals as any[]).map((e: any) => ({
        id: e.id, name: e.name || e.tag, description: e.description || `goal: ${e.name || e.tag}`,
    }));

    function autoPopulateCustomFields(data: Record<string, unknown>): void {
        const existingValues = data.custom_section_field_values as Record<string, unknown> | undefined;
        if (existingValues && Object.keys(existingValues).length > 0) {
            return;
        }

        const experimentType = data.type as string | undefined;
        const fieldValues: Record<string, { type: string; value: string }> = {};

        for (const field of customFields) {
            if (field.archived) continue;
            if (!field.custom_section) continue;
            if (field.custom_section.type !== experimentType) continue;
            if (field.custom_section.archived) continue;

            let value = field.default_value || '';
            if (field.type === USER_FIELD_TYPE && currentUserId) {
                value = JSON.stringify({ selected: [{ userId: currentUserId }] });
            }

            fieldValues[String(field.id)] = { type: field.type, value };
        }

        const customFieldsByName = (data as any).custom_fields as Record<string, string> | undefined;
        if (customFieldsByName) {
            for (const [name, val] of Object.entries(customFieldsByName)) {
                const matching = customFields.find(f => f.name === name && !f.archived);
                if (matching) {
                    fieldValues[String(matching.id)] = { type: matching.type, value: val };
                }
            }
            delete (data as any).custom_fields;
        }

        data.custom_section_field_values = fieldValues;
    }

    mcpServer.tool(
        "get_auth_status",
        "Get current authentication status and user information",
        {},
        { readOnlyHint: true },
        async () => {
            let statusText = `Authenticated with API key\n\nEndpoint: ${config.endpoint}\nProfile: ${profileName}\nAPI Access: Available`;

            if (entityWarnings.length > 0) {
                statusText += `\n\nEntity fetch warnings:\n${entityWarnings.map(w => `- ${w}`).join('\n')}`;
            }

            return { content: [{ type: "text", text: statusText }] };
        }
    );

    mcpServer.tool(
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
                        text: `# ABsmartly API - ${API_CATALOG.length} methods in ${summary.length} categories\n\nUse \`category\` to see details for a category, or \`search\` to find methods by keyword.\n\n${lines.join('\n\n')}`
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

    mcpServer.tool(
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

            if (params.method_name === CREATE_EXPERIMENT_METHOD && customFields.length > 0) {
                doc += '\n\n## Available Custom Fields\n\n';
                doc += 'Pass `custom_fields` (by name) in `params.data` to override defaults:\n\n';
                doc += '| Title | Type | Default Value | Section Type |\n|-------|------|---------------|-------------|\n';
                for (const f of customFields) {
                    if (f.archived) continue;
                    const sectionType = f.custom_section?.type || 'unknown';
                    doc += `| ${f.name} | ${f.type} | ${f.default_value || ''} | ${sectionType} |\n`;
                }
            }

            return { content: [{ type: "text" as const, text: doc }] };
        }
    );

    mcpServer.tool(
        "execute_api_method",
        "Execute any ABsmartly API method by name. Results for experiments, metrics, goals, teams, users, and segments are auto-summarized. Use 'show'/'exclude' for experiment field control. Pass 'raw: true' for unsummarized response.",
        {
            method_name: completable(
                z.string().describe("Method name from the API catalog"),
                (value) => {
                    const lower = (value || '').toLowerCase();
                    return API_CATALOG
                        .filter(m => m.method.toLowerCase().includes(lower))
                        .map(m => m.method)
                        .slice(0, MAX_COMPLETIONS);
                }
            ),
            params: z.record(z.unknown()).optional().describe("Method parameters as a JSON object"),
            show: z.array(z.string()).optional().describe("Extra fields to include in experiment summaries"),
            exclude: z.array(z.string()).optional().describe("Fields to exclude from experiment summaries"),
            raw: z.boolean().optional().describe("Return full unsummarized response (default: false)"),
            limit: z.number().optional().describe("Max items for list operations (default: 20). Convenience shortcut for passing items/limit in params."),
        },
        { destructiveHint: true },
        async (params) => {
            const entry = getMethodEntry(params.method_name);
            if (!entry) {
                return { content: [{ type: "text" as const, text: `Unknown method "${params.method_name}". Use discover_api_methods to find available methods.` }] };
            }

            const methodFn = (apiClient as any)[params.method_name];
            if (typeof methodFn !== 'function') {
                return { content: [{ type: "text" as const, text: `Method "${params.method_name}" exists in catalog but is not available on the API client.` }] };
            }

            if (entry.dangerous) {
                try {
                    const elicitResult = await mcpServer.server.elicitInput({
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
                        return { content: [{ type: "text" as const, text: `Action cancelled: ${params.method_name} was not confirmed by user.` }] };
                    }
                } catch (_) {
                    // elicitation not supported
                }
            }

            try {
                const methodParams = params.params || {};
                if (params.method_name === CREATE_EXPERIMENT_METHOD && methodParams.data) {
                    autoPopulateCustomFields(methodParams.data as Record<string, unknown>);
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

                const args = buildMethodArgs(entry, methodParams);
                const result = await methodFn.apply(apiClient, args);

                if (result === undefined || result === null) {
                    return { content: [{ type: "text" as const, text: `Successfully executed ${params.method_name}.` }] };
                }

                const showFields = params.show || [];
                const excludeFields = params.exclude || [];
                const output = params.raw
                    ? result
                    : summarizeResult(params.method_name, result, showFields, excludeFields, config.endpoint.replace(/\/v\d+\/?$/, ''));

                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify(output, null, 2)
                    }]
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text" as const,
                        text: `Error executing ${params.method_name}: ${error instanceof Error ? error.message : String(error)}`
                    }]
                };
            }
        }
    );

    const entityConfigs = [
        { name: "Applications", uri: "absmartly://entities/applications", description: "Cached list of available applications", getData: () => applications },
        { name: "Unit Types", uri: "absmartly://entities/unit-types", description: "Cached list of available unit types", getData: () => unitTypes },
        { name: "Teams", uri: "absmartly://entities/teams", description: "Cached list of available teams", getData: () => teams },
        { name: "Users", uri: "absmartly://entities/users", description: "Cached list of users (summarized)", getData: () => users },
        { name: "Metrics", uri: "absmartly://entities/metrics", description: "Cached list of available metrics", getData: () => metrics },
        { name: "Goals", uri: "absmartly://entities/goals", description: "Cached list of available goals", getData: () => goals },
        { name: "Tags", uri: "absmartly://entities/tags", description: "Cached list of experiment tags", getData: () => experimentTags },
        {
            name: "Custom Fields",
            uri: "absmartly://entities/custom-fields",
            description: "Cached list of custom fields",
            getData: () => customFields
                .filter((f: CustomSectionField) => !f.archived)
                .map((f: CustomSectionField) => ({
                    id: f.id,
                    title: f.name,
                    type: f.type,
                    default_value: f.default_value || '',
                    section_type: f.custom_section?.type || 'unknown',
                })),
        },
    ];

    for (const cfg of entityConfigs) {
        mcpServer.resource(
            cfg.name,
            cfg.uri,
            { description: cfg.description },
            async () => ({
                contents: [{
                    uri: cfg.uri,
                    mimeType: "application/json",
                    text: JSON.stringify(cfg.getData(), null, 2),
                }]
            })
        );
    }

    mcpServer.prompt(
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

    mcpServer.prompt(
        "create-experiment",
        "Create a new A/B test experiment with all required fields pre-populated from available entities",
        {
            name: z.string().describe("Experiment name (snake_case recommended)"),
            type: z.string().optional().describe("Experiment type: 'test' or 'feature' (default: 'test')"),
        },
        (args) => {
            const entityContext = buildEntityContext({ applications, unitTypes, metrics, teams, customFields });
            const expType = args.type || 'test';
            return {
                messages: [{
                    role: "user" as const,
                    content: {
                        type: "text" as const,
                        text: `Create a new ${expType === 'feature' ? 'feature flag' : 'A/B test'} experiment named "${args.name}".\n\nUse the execute_api_method tool with method_name "createExperiment" to create it.\n\n${entityContext}`
                    }
                }]
            };
        }
    );

    mcpServer.prompt(
        "create-feature-flag",
        "Create a new feature flag (simplified experiment with type=feature)",
        {
            name: z.string().describe("Feature flag name (snake_case recommended)"),
        },
        (args) => {
            const entityContext = buildEntityContext({ applications, unitTypes, metrics, teams, customFields });
            return {
                messages: [{
                    role: "user" as const,
                    content: {
                        type: "text" as const,
                        text: `Create a new feature flag named "${args.name}".\n\nUse the execute_api_method tool with method_name "createExperiment" to create it with type "feature".\n\n${entityContext}`
                    }
                }]
            };
        }
    );

    mcpServer.prompt(
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
                    text: `Analyze experiment with ID ${args.id}.\n\n1. Use execute_api_method with method_name "getExperiment" and params { "id": ${args.id} } (show: ["experiment_report", "audience"])\n2. Check experiment state and alerts\n3. Provide a summary with actionable recommendations`
                }
            }]
        })
    );

    mcpServer.prompt(
        "experiment-review",
        "Review all running experiments and identify ones needing attention",
        async () => ({
            messages: [{
                role: "user" as const,
                content: {
                    type: "text" as const,
                    text: `Review all running experiments and identify any that need attention.\n\n1. Use execute_api_method with method_name "listExperiments" and params { "options": { "state": "running" } } with show: ["experiment_report"]\n2. Check for SRM alerts, audience mismatch, sample size reached\n3. Summarize findings and suggest next actions`
                }
            }]
        })
    );

    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
