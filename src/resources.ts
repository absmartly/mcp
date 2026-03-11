import type { ABsmartlyMCP } from './index';
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
                if (this.mcpServer.props?.absmartly_endpoint) {
                    content = content.replace(
                        'https://sandbox.absmartly.com/v1',
                        this.mcpServer.props.absmartly_endpoint
                    );
                }
                if (this.mcpServer.customFields?.length) {
                    const customFieldsInfo = `\n\n### Available Custom Fields\n${this.mcpServer.customFields.map(f => `- **${f.name}** (${f.type}): ${f.description || 'No description'}`).join('\n')}`;
                    content = content.replace(
                        'Custom fields can be configured per organization to extend experiment metadata and provide additional context for analysis.',
                        `Custom fields can be configured per organization to extend experiment metadata and provide additional context for analysis.${customFieldsInfo}`
                    );
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
}