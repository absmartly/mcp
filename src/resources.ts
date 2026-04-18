import type { ABsmartlyMCP } from './index';
import type { CustomSectionField } from '@absmartly/cli/api-client';
import {
    summarizeExperiment,
    summarizeMetric,
    summarizeGoal,
    summarizeTeam,
    summarizeUserDetail,
    summarizeSegment,
} from '@absmartly/cli/api-client';
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { debug } from './config';
import { DEFAULT_ABSMARTLY_ENDPOINT } from './shared';
export class ABsmartlyResources {
    private resourcesRegistered: boolean = false;
    constructor(private mcpServer: ABsmartlyMCP) {}
    private async readMarkdownFile(filename: string): Promise<string> {
        try {
            const filePath = `/docs/api/${filename}`;
            const asset = await (this.mcpServer as any).env.ASSETS.fetch(new Request(`https://placeholder.local${filePath}`));
            if (!asset.ok) {
                throw new Error(`Asset not found: ${filePath}`);
            }
            return await asset.text();
        } catch (error) {
            console.error(`Error reading markdown file ${filename}:`, error);
            return `# Error\n\nCould not load documentation for ${filename}`;
        }
    }
    async setupResources() {
        if (this.resourcesRegistered) {
            debug("Resources already registered, skipping setup");
            return;
        }
        debug("Setting up documentation resources");
        await this.setupGeneralApiDocs();
        await this.setupExperimentsApiDocs();
        await this.setupGoalsApiDocs();
        await this.setupMetricsApiDocs();
        await this.setupApplicationsApiDocs();
        await this.setupUsersTeamsApiDocs();
        await this.setupAnalyticsApiDocs();
        await this.setupSegmentsApiDocs();
        await this.setupTemplatesAndExamples();
        this.setupEntityResources();
        this.setupResourceTemplates();
        this.resourcesRegistered = true;
    }
    private async setupGeneralApiDocs() {
        this.mcpServer.server.resource(
            "ABsmartly API Documentation",
            "absmartly://docs/api",
            {
                description: "General API documentation and authentication guide"
            },
            async () => {
                let content = await this.readMarkdownFile('general.md');
                const endpoint = this.mcpServer.props?.absmartly_endpoint || `${DEFAULT_ABSMARTLY_ENDPOINT}/v1`;
                content = content.replace('{{ABSMARTLY_ENDPOINT}}', endpoint);
                const fields = this.mcpServer.customFields || [];
                const activeFields = fields.filter((f: any) => !f.archived);
                if (activeFields.length > 0) {
                    const fieldList = activeFields.map((f: any) => {
                        const title = f.title || f.name || '';
                        const sectionType = f.custom_section?.type || '';
                        const defaultVal = f.default_value || '';
                        return `- **${title}** (${f.type}, ${sectionType})${defaultVal ? `: default "${defaultVal}"` : ''}`;
                    }).join('\n');
                    content = content.replace('{{CUSTOM_FIELDS}}', fieldList);
                } else {
                    content = content.replace('{{CUSTOM_FIELDS}}', 'No custom fields configured.');
                }
                return {
                    contents: [{
                        uri: "absmartly://docs/api",
                        mimeType: "text/markdown",
                        text: content
                    }]
                };
            }
        );
    }
    private async setupExperimentsApiDocs() {
        this.mcpServer.server.resource(
            "Experiments API Documentation",
            "absmartly://docs/experiments",
            {
                description: "Complete documentation for experiment management endpoints"
            },
            async () => {
                let content = await this.readMarkdownFile('experiments.md');
                if (this.mcpServer.customFields?.length) {
                    const customFieldsInfo = `\n\n### Available Custom Fields\n${this.mcpServer.customFields.map(f => `- **${f.name}** (${f.type}): ${f.description || 'No description'}`).join('\n')}`;
                    content = content.replace(
                        'Experiments support custom fields defined in your organization for additional metadata and context.',
                        `Experiments support custom fields defined in your organization for additional metadata and context.${customFieldsInfo}`
                    );
                }
                return {
                    contents: [{
                        uri: "absmartly://docs/experiments",
                        mimeType: "text/markdown", 
                        text: content
                    }]
                };
            }
        );
    }
    private async setupGoalsApiDocs() {
        this.mcpServer.server.resource(
            "Goals API Documentation",
            "absmartly://docs/goals",
            {
                description: "Documentation for goal definition and management"
            },
            async () => {
                return {
                    contents: [{
                        uri: "absmartly://docs/goals",
                        mimeType: "text/markdown",
                        text: await this.readMarkdownFile('goals.md')
                    }]
                };
            }
        );
    }
    private async setupMetricsApiDocs() {
        this.mcpServer.server.resource(
            "Metrics API Documentation",
            "absmartly://docs/metrics",
            {
                description: "Documentation for custom metrics and measurement"
            },
            async () => {
                return {
                    contents: [{
                        uri: "absmartly://docs/metrics",
                        mimeType: "text/markdown",
                        text: await this.readMarkdownFile('metrics.md')
                    }]
                };
            }
        );
    }
    private async setupApplicationsApiDocs() {
        this.mcpServer.server.resource(
            "Applications API Documentation",
            "absmartly://docs/applications",
            {
                description: "Documentation for application and environment management"
            },
            async () => {
                return {
                    contents: [{
                        uri: "absmartly://docs/applications",
                        mimeType: "text/markdown",
                        text: await this.readMarkdownFile('applications.md')
                    }]
                };
            }
        );
    }
    private async setupUsersTeamsApiDocs() {
        this.mcpServer.server.resource(
            "Users & Teams API Documentation",
            "absmartly://docs/users-teams",
            {
                description: "Documentation for user management and team collaboration"
            },
            async () => {
                return {
                    contents: [{
                        uri: "absmartly://docs/users-teams",
                        mimeType: "text/markdown",
                        text: await this.readMarkdownFile('users-teams.md')
                    }]
                };
            }
        );
    }
    private async setupAnalyticsApiDocs() {
        this.mcpServer.server.resource(
            "Analytics API Documentation",
            "absmartly://docs/analytics",
            {
                description: "Documentation for experiment analytics and reporting"
            },
            async () => {
                return {
                    contents: [{
                        uri: "absmartly://docs/analytics",
                        mimeType: "text/markdown",
                        text: await this.readMarkdownFile('analytics.md')
                    }]
                };
            }
        );
    }
    private async setupSegmentsApiDocs() {
        this.mcpServer.server.resource(
            "Segments API Documentation",
            "absmartly://docs/segments",
            {
                description: "Documentation for audience segmentation and targeting"
            },
            async () => {
                return {
                    contents: [{
                        uri: "absmartly://docs/segments",
                        mimeType: "text/markdown",
                        text: await this.readMarkdownFile('segments.md')
                    }]
                };
            }
        );
    }
    private async setupTemplatesAndExamples() {
        this.mcpServer.server.resource(
            "API Request Examples",
            "absmartly://examples/api-requests",
            {
                description: "Common API request examples and patterns"
            },
            async () => {
                let content = await this.readMarkdownFile('examples.md');
                if (this.mcpServer.props?.absmartly_endpoint) {
                    content = content.replace(
                        /https:\/\/sandbox\.absmartly\.com\/v1/g,
                        this.mcpServer.props.absmartly_endpoint
                    );
                }
                return {
                    contents: [{
                        uri: "absmartly://examples/api-requests",
                        mimeType: "text/markdown",
                        text: content
                    }]
                };
            }
        );

        this.mcpServer.server.resource(
            "Experiment Markdown Templates",
            "absmartly://docs/templates",
            {
                description: "Markdown templates for creating experiments: basic A/B test, feature flag, Group Sequential Test (GST), screenshots, custom fields, multi-variant"
            },
            async () => {
                const content = await this.readMarkdownFile('templates.md');
                return {
                    contents: [{
                        uri: "absmartly://docs/templates",
                        mimeType: "text/markdown",
                        text: content
                    }]
                };
            }
        );
    }
    private setupEntityResources() {
        const entityConfigs: Array<{
            name: string;
            uri: string;
            description: string;
            getData: () => unknown;
        }> = [
            {
                name: "Applications",
                uri: "absmartly://entities/applications",
                description: "Cached list of available applications",
                getData: () => (this.mcpServer as any).applications,
            },
            {
                name: "Unit Types",
                uri: "absmartly://entities/unit-types",
                description: "Cached list of available unit types",
                getData: () => (this.mcpServer as any).unitTypes,
            },
            {
                name: "Teams",
                uri: "absmartly://entities/teams",
                description: "Cached list of available teams",
                getData: () => (this.mcpServer as any).teams,
            },
            {
                name: "Users",
                uri: "absmartly://entities/users",
                description: "Cached list of users (summarized)",
                getData: () => (this.mcpServer as any).users,
            },
            {
                name: "Metrics",
                uri: "absmartly://entities/metrics",
                description: "Cached list of available metrics",
                getData: () => (this.mcpServer as any).metrics,
            },
            {
                name: "Goals",
                uri: "absmartly://entities/goals",
                description: "Cached list of available goals",
                getData: () => (this.mcpServer as any).goals,
            },
            {
                name: "Tags",
                uri: "absmartly://entities/tags",
                description: "Cached list of experiment tags",
                getData: () => (this.mcpServer as any).experimentTags,
            },
            {
                name: "Custom Fields",
                uri: "absmartly://entities/custom-fields",
                description: "Cached list of custom fields with title, type, default value, and section type",
                getData: () => {
                    const fields = this.mcpServer.customFields || [];
                    return fields
                        .filter((f: CustomSectionField) => !f.archived)
                        .map((f: CustomSectionField) => ({
                            id: f.id,
                            title: f.name,
                            type: f.type,
                            default_value: f.default_value || '',
                            section_type: f.custom_section?.type || 'unknown',
                        }));
                },
            },
        ];

        for (const config of entityConfigs) {
            this.mcpServer.server.resource(
                config.name,
                config.uri,
                { description: config.description },
                async () => ({
                    contents: [{
                        uri: config.uri,
                        mimeType: "application/json",
                        text: JSON.stringify(config.getData(), null, 2)
                    }]
                })
            );
        }
    }
    private getApiClient() {
        return (this.mcpServer as any).apiClient;
    }

    private getCachedEntities(key: string): any[] {
        return (this.mcpServer as any)[key] || [];
    }

    private completeByName(cacheKey: string) {
        return (value: string) => {
            const lower = (value || '').toLowerCase();
            return this.getCachedEntities(cacheKey)
                .filter((e: any) => (e.name || '').toLowerCase().includes(lower))
                .map((e: any) => e.name)
                .slice(0, 20);
        };
    }

    private completeById(cacheKey: string) {
        return (value: string) => {
            const prefix = value || '';
            return this.getCachedEntities(cacheKey)
                .map((e: any) => String(e.id))
                .filter(id => id.startsWith(prefix))
                .slice(0, 20);
        };
    }

    private errorResult(uri: URL, message: string) {
        return {
            contents: [{
                uri: uri.href,
                mimeType: "application/json" as const,
                text: JSON.stringify({ error: message })
            }]
        };
    }

    private jsonResult(uri: URL, data: unknown) {
        return {
            contents: [{
                uri: uri.href,
                mimeType: "application/json" as const,
                text: JSON.stringify(data, null, 2)
            }]
        };
    }

    private setupResourceTemplates() {
        this.mcpServer.server.resource(
            "Experiment by ID",
            new ResourceTemplate("absmartly://experiments/{id}", {
                list: undefined,
                complete: { id: this.completeById('experiments') },
            }),
            { description: "Fetch and summarize a specific experiment by ID" },
            async (uri, variables) => {
                const id = Number(variables.id);
                if (isNaN(id)) return this.errorResult(uri, "Invalid experiment ID");
                const client = this.getApiClient();
                if (!client) return this.errorResult(uri, "API client not initialized");
                try {
                    const exp = await client.getExperiment(id);
                    return this.jsonResult(uri, summarizeExperiment(exp, [], []));
                } catch (error) {
                    return this.errorResult(uri, `Failed to fetch experiment ${id}: ${error}`);
                }
            }
        );

        this.mcpServer.server.resource(
            "Metric by ID",
            new ResourceTemplate("absmartly://metrics/{id}", {
                list: undefined,
                complete: { id: this.completeById('metrics') },
            }),
            { description: "Fetch and summarize a specific metric by ID" },
            async (uri, variables) => {
                const id = Number(variables.id);
                if (isNaN(id)) return this.errorResult(uri, "Invalid metric ID");
                const client = this.getApiClient();
                if (!client) return this.errorResult(uri, "API client not initialized");
                try {
                    const metric = await client.getMetric(id);
                    return this.jsonResult(uri, summarizeMetric(metric));
                } catch (error) {
                    return this.errorResult(uri, `Failed to fetch metric ${id}: ${error}`);
                }
            }
        );

        this.mcpServer.server.resource(
            "Goal by ID",
            new ResourceTemplate("absmartly://goals/{id}", {
                list: undefined,
                complete: { id: this.completeById('goals') },
            }),
            { description: "Fetch and summarize a specific goal by ID" },
            async (uri, variables) => {
                const id = Number(variables.id);
                if (isNaN(id)) return this.errorResult(uri, "Invalid goal ID");
                const client = this.getApiClient();
                if (!client) return this.errorResult(uri, "API client not initialized");
                try {
                    const goal = await client.getGoal(id);
                    return this.jsonResult(uri, summarizeGoal(goal));
                } catch (error) {
                    return this.errorResult(uri, `Failed to fetch goal ${id}: ${error}`);
                }
            }
        );

        this.mcpServer.server.resource(
            "Team by ID",
            new ResourceTemplate("absmartly://teams/{id}", {
                list: undefined,
                complete: { id: this.completeById('teams') },
            }),
            { description: "Fetch and summarize a specific team by ID" },
            async (uri, variables) => {
                const id = Number(variables.id);
                if (isNaN(id)) return this.errorResult(uri, "Invalid team ID");
                const client = this.getApiClient();
                if (!client) return this.errorResult(uri, "API client not initialized");
                try {
                    const team = await client.getTeam(id);
                    return this.jsonResult(uri, summarizeTeam(team));
                } catch (error) {
                    return this.errorResult(uri, `Failed to fetch team ${id}: ${error}`);
                }
            }
        );

        this.mcpServer.server.resource(
            "User by ID",
            new ResourceTemplate("absmartly://users/{id}", {
                list: undefined,
                complete: { id: this.completeById('users') },
            }),
            { description: "Fetch and summarize a specific user by ID" },
            async (uri, variables) => {
                const id = Number(variables.id);
                if (isNaN(id)) return this.errorResult(uri, "Invalid user ID");
                const client = this.getApiClient();
                if (!client) return this.errorResult(uri, "API client not initialized");
                try {
                    const user = await client.getUser(id);
                    return this.jsonResult(uri, summarizeUserDetail(user));
                } catch (error) {
                    return this.errorResult(uri, `Failed to fetch user ${id}: ${error}`);
                }
            }
        );

        this.mcpServer.server.resource(
            "Segment by ID",
            new ResourceTemplate("absmartly://segments/{id}", {
                list: undefined,
                complete: { id: this.completeById('segments') },
            }),
            { description: "Fetch a specific segment by ID" },
            async (uri, variables) => {
                const id = Number(variables.id);
                if (isNaN(id)) return this.errorResult(uri, "Invalid segment ID");
                const client = this.getApiClient();
                if (!client) return this.errorResult(uri, "API client not initialized");
                try {
                    const segment = await client.getSegment(id);
                    return this.jsonResult(uri, summarizeSegment(segment));
                } catch (error) {
                    return this.errorResult(uri, `Failed to fetch segment ${id}: ${error}`);
                }
            }
        );

        this.mcpServer.server.resource(
            "Application by name",
            new ResourceTemplate("absmartly://applications/{name}", {
                list: undefined,
                complete: { name: this.completeByName('applications') },
            }),
            { description: "Look up an application by name" },
            async (uri, variables) => {
                const name = decodeURIComponent(String(variables.name));
                const apps = this.getCachedEntities('applications');
                const match = apps.find((a: any) => a.name.toLowerCase() === name.toLowerCase());
                if (!match) return this.errorResult(uri, `Application "${name}" not found`);
                return this.jsonResult(uri, match);
            }
        );

        this.mcpServer.server.resource(
            "Team by name",
            new ResourceTemplate("absmartly://teams/by-name/{name}", {
                list: undefined,
                complete: { name: this.completeByName('teams') },
            }),
            { description: "Look up a team by name" },
            async (uri, variables) => {
                const name = decodeURIComponent(String(variables.name));
                const teams = this.getCachedEntities('teams');
                const match = teams.find((t: any) => t.name.toLowerCase() === name.toLowerCase());
                if (!match) return this.errorResult(uri, `Team "${name}" not found`);
                return this.jsonResult(uri, match);
            }
        );

        this.mcpServer.server.resource(
            "Metric by name",
            new ResourceTemplate("absmartly://metrics/by-name/{name}", {
                list: undefined,
                complete: { name: this.completeByName('metrics') },
            }),
            { description: "Look up a metric by name" },
            async (uri, variables) => {
                const name = decodeURIComponent(String(variables.name));
                const metrics = this.getCachedEntities('metrics');
                const match = metrics.find((m: any) => m.name.toLowerCase() === name.toLowerCase());
                if (!match) return this.errorResult(uri, `Metric "${name}" not found`);
                return this.jsonResult(uri, match);
            }
        );

        this.mcpServer.server.resource(
            "Goal by name",
            new ResourceTemplate("absmartly://goals/by-name/{name}", {
                list: undefined,
                complete: { name: this.completeByName('goals') },
            }),
            { description: "Look up a goal by name" },
            async (uri, variables) => {
                const name = decodeURIComponent(String(variables.name));
                const goals = this.getCachedEntities('goals');
                const match = goals.find((g: any) => g.name.toLowerCase() === name.toLowerCase());
                if (!match) return this.errorResult(uri, `Goal "${name}" not found`);
                return this.jsonResult(uri, match);
            }
        );
    }
}