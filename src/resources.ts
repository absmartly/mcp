/**
 * MCP Resources for ABsmartly API Documentation
 * 
 * This file contains all the documentation resources that are exposed via MCP.
 * Each resource provides detailed documentation for specific API endpoint groups.
 */

import type { ABsmartlyMCP } from './index';
import { readFileSync } from 'fs';
import { join } from 'path';

export class ABsmartlyResources {
    constructor(private mcpServer: ABsmartlyMCP) {}

    /**
     * Read markdown file from public/docs/api directory
     */
    private readMarkdownFile(filename: string): string {
        try {
            const filePath = join(process.cwd(), 'public', 'docs', 'api', filename);
            return readFileSync(filePath, 'utf-8');
        } catch (error) {
            console.error(`Error reading markdown file ${filename}:`, error);
            return `# Error\n\nCould not load documentation for ${filename}`;
        }
    }

    /**
     * Register all documentation resources
     */
    setupResources() {
        console.log("📚 Setting up documentation resources");
        this.setupGeneralApiDocs();
        this.setupExperimentsApiDocs();
        this.setupGoalsApiDocs();
        this.setupMetricsApiDocs();
        this.setupApplicationsApiDocs();
        this.setupUsersTeamsApiDocs();
        this.setupAnalyticsApiDocs();
        this.setupSegmentsApiDocs();
        this.setupTemplatesAndExamples();
    }

    private setupGeneralApiDocs() {
        this.mcpServer.server.resource(
            "absmartly://docs/api",
            "text/markdown",
            {
                name: "ABsmartly API Documentation",
                description: "General API documentation and authentication guide"
            },
            async () => {
                let content = this.readMarkdownFile('general.md');
                
                // Replace placeholder URL with actual endpoint if available
                if (this.mcpServer.props?.absmartly_endpoint) {
                    content = content.replace(
                        'https://sandbox.absmartly.com/v1',
                        this.mcpServer.props.absmartly_endpoint
                    );
                }
                
                // Add custom fields information if available
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

    private setupExperimentsApiDocs() {
        this.mcpServer.server.resource(
            "absmartly://docs/experiments",
            "text/markdown", 
            {
                name: "Experiments API Documentation",
                description: "Complete documentation for experiment management endpoints"
            },
            async () => {
                let content = this.readMarkdownFile('experiments.md');
                
                // Add custom fields information if available
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

    private setupGoalsApiDocs() {
        this.mcpServer.server.resource(
            "absmartly://docs/goals",
            "text/markdown",
            {
                name: "Goals API Documentation", 
                description: "Documentation for goal definition and management"
            },
            async () => {
                return {
                    contents: [{
                        uri: "absmartly://docs/goals",
                        mimeType: "text/markdown",
                        text: this.readMarkdownFile('goals.md')
                    }]
                };
            }
        );
    }

    private setupMetricsApiDocs() {
        this.mcpServer.server.resource(
            "absmartly://docs/metrics",
            "text/markdown",
            {
                name: "Metrics API Documentation",
                description: "Documentation for custom metrics and measurement"
            },
            async () => {
                return {
                    contents: [{
                        uri: "absmartly://docs/metrics",
                        mimeType: "text/markdown",
                        text: this.readMarkdownFile('metrics.md')
                    }]
                };
            }
        );
    }

    private setupApplicationsApiDocs() {
        this.mcpServer.server.resource(
            "absmartly://docs/applications",
            "text/markdown",
            {
                name: "Applications API Documentation",
                description: "Documentation for application and environment management"
            },
            async () => {
                return {
                    contents: [{
                        uri: "absmartly://docs/applications",
                        mimeType: "text/markdown",
                        text: this.readMarkdownFile('applications.md')
                    }]
                };
            }
        );
    }

    private setupUsersTeamsApiDocs() {
        this.mcpServer.server.resource(
            "absmartly://docs/users-teams",
            "text/markdown",
            {
                name: "Users & Teams API Documentation",
                description: "Documentation for user management and team collaboration"
            },
            async () => {
                return {
                    contents: [{
                        uri: "absmartly://docs/users-teams",
                        mimeType: "text/markdown",
                        text: this.readMarkdownFile('users-teams.md')
                    }]
                };
            }
        );
    }

    private setupAnalyticsApiDocs() {
        this.mcpServer.server.resource(
            "absmartly://docs/analytics",
            "text/markdown",
            {
                name: "Analytics API Documentation", 
                description: "Documentation for experiment analytics and reporting"
            },
            async () => {
                return {
                    contents: [{
                        uri: "absmartly://docs/analytics",
                        mimeType: "text/markdown",
                        text: this.readMarkdownFile('analytics.md')
                    }]
                };
            }
        );
    }

    private setupSegmentsApiDocs() {
        this.mcpServer.server.resource(
            "absmartly://docs/segments",
            "text/markdown",
            {
                name: "Segments API Documentation",
                description: "Documentation for audience segmentation and targeting"
            },
            async () => {
                return {
                    contents: [{
                        uri: "absmartly://docs/segments",
                        mimeType: "text/markdown",
                        text: this.readMarkdownFile('segments.md')
                    }]
                };
            }
        );
    }

    private setupTemplatesAndExamples() {
        this.mcpServer.server.resource(
            "absmartly://templates/experiment",
            "application/json",
            {
                name: "Experiment Template",
                description: "Template for creating new experiments with custom fields"
            },
            async () => {
                const template = {
                    state: "ready",
                    name: "my_new_experiment",
                    display_name: "My New Experiment",
                    iteration: 1,
                    percentage_of_traffic: 100,
                    unit_type: {
                        unit_type_id: 1
                    },
                    nr_variants: 2,
                    percentages: "50/50",
                    audience: '{"filter":[{"and":[]}]}',
                    audience_strict: true,
                    owners: [
                        { user_id: 3 }
                    ],
                    teams: [],
                    experiment_tags: [],
                    applications: [
                        {
                            application_id: 1,
                            application_version: "0"
                        }
                    ],
                    primary_metric: {
                        metric_id: 4
                    },
                    secondary_metrics: [],
                    custom_fields: this.mcpServer.customFields?.reduce((acc, field) => {
                        acc[field.name] = field.type === 'boolean' ? false : '';
                        return acc;
                    }, {} as any) || {}
                };
                
                return {
                    contents: [{
                        uri: "absmartly://templates/experiment",
                        mimeType: "application/json",
                        text: JSON.stringify(template, null, 2)
                    }]
                };
            }
        );

        this.mcpServer.server.resource(
            "absmartly://templates/feature-flag",
            "application/json", 
            {
                name: "Feature Flag Template",
                description: "Template for creating feature flags"
            },
            async () => {
                const template = {
                    state: "ready",
                    name: "my_new_feature_flag",
                    display_name: "My New Feature Flag",
                    iteration: 1,
                    type: "feature",
                    percentage_of_traffic: 100,
                    unit_type: {
                        unit_type_id: 1
                    },
                    nr_variants: 2,
                    percentages: "90/10",
                    audience: '{"filter":[{"and":[]}]}',
                    audience_strict: true,
                    owners: [
                        { user_id: 3 }
                    ],
                    teams: [],
                    experiment_tags: [],
                    applications: [
                        {
                            application_id: 1,
                            application_version: "0"
                        }
                    ],
                    primary_metric: {
                        metric_id: 4
                    },
                    secondary_metrics: []
                };
                
                return {
                    contents: [{
                        uri: "absmartly://templates/feature-flag",
                        mimeType: "application/json",
                        text: JSON.stringify(template, null, 2)
                    }]
                };
            }
        );

        this.mcpServer.server.resource(
            "absmartly://examples/api-requests",
            "text/markdown",
            {
                name: "API Request Examples",
                description: "Common API request examples and patterns"
            },
            async () => {
                let content = this.readMarkdownFile('examples.md');
                
                // Replace placeholder URL with actual endpoint if available
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