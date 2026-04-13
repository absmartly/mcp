#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { homedir } from "os";
import { APIClient } from "@absmartly/cli/api-client";
import type { CustomSectionField } from "@absmartly/cli/api-client";
import { FetchHttpClient } from "./fetch-adapter.js";
import { setupTools } from "./tools.js";
import type { ToolContext } from "./tools.js";
import { MCP_VERSION } from "./version.js";

const CONFIG_FILE_PATH = '.config/absmartly/config.yaml';
const DEFAULT_PROFILE_NAME = 'default';
const KEYCHAIN_SERVICE = 'absmartly-cli';
const KEYCHAIN_ACCOUNT_PREFIX = 'api-key';
const CREDENTIALS_FILE_PATH = '.config/absmartly/credentials.json';

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

    const mcpServer = new McpServer(
        {
            name: "ABsmartly MCP Server (Local)",
            version: MCP_VERSION,
        },
        {
            capabilities: {
                tools: {},
                resources: { subscribe: true, listChanged: true },
                prompts: {},
            },
        }
    );

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

    // ── Register tools (shared with Cloudflare Worker) ──────────────────────
    const toolCtx: ToolContext = {
        apiClient,
        endpoint: config.endpoint,
        authType: 'API Key',
        profileName,
        entityWarnings,
        customFields,
        currentUserId,
    };
    setupTools(mcpServer, toolCtx);

    // ── Entity resources ────────────────────────────────────────────────────
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

    // ── Prompts ─────────────────────────────────────────────────────────────
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
            type: completable(
                z.string().default('test').describe("Experiment type: 'test' or 'feature' (default: 'test')"),
                (value) => ['test', 'feature'].filter(t => t.startsWith(value || ''))
            ),
        },
        (args) => {
            const entityContext = buildEntityContext({ applications, unitTypes, metrics, teams, customFields });
            const expType = args.type || 'test';
            return {
                messages: [{
                    role: "user" as const,
                    content: {
                        type: "text" as const,
                        text: `Create a new ${expType === 'feature' ? 'feature flag' : 'A/B test'} experiment named "${args.name}".

Use the execute_command tool with group "experiments" and command "createExperimentFromTemplate". Read the absmartly://docs/templates resource for the markdown template format. Fill in the template with the context below, then pass the filled template as the "templateContent" parameter.

${entityContext}`
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
                        text: `Create a new feature flag named "${args.name}".

Use the execute_command tool with group "experiments" and command "createExperimentFromTemplate". Read the absmartly://docs/templates resource for the feature flag template. Fill it in with type "feature", two variants (off/on), and the context below, then pass as "templateContent".

${entityContext}`
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
                    text: `Analyze experiment with ID ${args.id}.\n\n1. Use execute_command with group "experiments", command "getExperiment", params { "experimentId": ${args.id}, "show": ["experiment_report", "audience"] }\n2. Check experiment state and alerts\n3. Provide a summary with actionable recommendations`
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
                    text: `Review all running experiments and identify any that need attention.\n\n1. Use execute_command with group "experiments", command "listExperiments", params { "state": "running", "show": ["experiment_report"] }\n2. Check for SRM alerts, audience mismatch, sample size reached\n3. Summarize findings and suggest next actions`
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
