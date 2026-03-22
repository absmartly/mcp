import type { ABsmartlyMCP } from './index';
import type { CustomSectionField } from '@absmartly/cli/api-client';
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { debug } from './config';
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
                const endpoint = this.mcpServer.props?.absmartly_endpoint || 'https://sandbox.absmartly.com/v1';
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
    private setupResourceTemplates() {
        const template = new ResourceTemplate("absmartly://experiments/{id}", { list: undefined });

        this.mcpServer.server.resource(
            "Experiment Detail",
            template,
            { description: "Fetch and summarize a specific experiment by ID" },
            async (uri, variables) => {
                const id = Number(variables.id);
                if (isNaN(id)) {
                    return {
                        contents: [{
                            uri: uri.href,
                            mimeType: "application/json",
                            text: JSON.stringify({ error: "Invalid experiment ID" })
                        }]
                    };
                }

                const apiClient = (this.mcpServer as any).apiClient;
                if (!apiClient) {
                    return {
                        contents: [{
                            uri: uri.href,
                            mimeType: "application/json",
                            text: JSON.stringify({ error: "API client not initialized" })
                        }]
                    };
                }

                try {
                    const { summarizeExperiment } = await import("@absmartly/cli/api-client");
                    const experiment = await apiClient.getExperiment(id);
                    const summarized = summarizeExperiment(experiment, [], []);
                    return {
                        contents: [{
                            uri: uri.href,
                            mimeType: "application/json",
                            text: JSON.stringify(summarized, null, 2)
                        }]
                    };
                } catch (error) {
                    return {
                        contents: [{
                            uri: uri.href,
                            mimeType: "application/json",
                            text: JSON.stringify({ error: `Failed to fetch experiment ${id}: ${error}` })
                        }]
                    };
                }
            }
        );
    }
}