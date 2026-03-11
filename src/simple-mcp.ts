import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ABsmartlyAPIClient } from './api-client';
import { MCP_VERSION } from './version';

const DEFAULT_ABSMARTLY_API_ENDPOINT = "https://sandbox.absmartly.com";

export class SimpleMCPServer {
  private server: Server;
  private apiClient: ABsmartlyAPIClient;
  private endpoint: string;

  constructor(apiKey: string, endpoint: string = DEFAULT_ABSMARTLY_API_ENDPOINT) {
    this.endpoint = endpoint;
    this.apiClient = new ABsmartlyAPIClient(apiKey, endpoint);
    this.server = new Server(
      {
        name: 'absmartly-mcp',
        version: MCP_VERSION,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
    this.setupHandlers();
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

    let md = `## ${stateEmoji[state] || '❓'} [${exp.display_name || exp.name}](${link})\n\n`;
    md += `**ID:** ${exp.id} | **State:** ${state} | **Type:** ${exp.type || 'test'}\n`;
    md += `**Created:** ${new Date(exp.created_at).toLocaleDateString()}\n`;

    if (exp.percentages) {
      md += `**Traffic Split:** ${exp.percentages}\n`;
    }

    md += '\n---\n';
    return md;
  }
  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'list_experiments',
          description: 'List all experiments with optional filtering',
          inputSchema: {
            type: 'object',
            properties: {
              search: { type: 'string', description: 'Search experiments by name or description' },
              sort: { type: 'string', description: 'Sort field (e.g., created_at, updated_at)' },
              page: { type: 'number', description: 'Page number (default: 1)' },
              items: { type: 'number', description: 'Items per page (default: 10)' },
              state: { type: 'string', description: 'Filter by state (comma-separated: created,ready,running,development,full_on,running_not_full_on,stopped,archived,scheduled)' },
              significance: { type: 'string', description: 'Filter by significance results (comma-separated: positive,negative,neutral,inconclusive)' },
              owners: { type: 'string', description: 'Filter by owner user IDs (comma-separated numbers, e.g.: 3,5,7). To find a user\'s ID, use list_users with their full name (e.g., list_users({search: \'Cal Courtney\'}))' },
              teams: { type: 'string', description: 'Filter by team IDs (comma-separated numbers, e.g.: 1,2,3). Use the list_teams tool to find team IDs by name' },
              tags: { type: 'string', description: 'Filter by tag IDs (comma-separated numbers, e.g.: 2,4,6). Use the list_tags tool to find tag IDs by name' },
              templates: { type: 'string', description: 'Filter by template IDs (comma-separated numbers, e.g.: 238,240). Note: This expects numeric template IDs' },
              applications: { type: 'string', description: 'Filter by application IDs (comma-separated numbers, e.g.: 39,3). Use the list_applications tool to find application IDs by name' },
              unit_types: { type: 'string', description: 'Filter by unit type IDs (comma-separated numbers, e.g.: 42,75). Use the list_unit_types tool to find unit type IDs by name' },
              impact: { type: 'string', description: 'Filter by impact range (min,max: 1,5)' },
              created_at: { type: 'string', description: 'Filter by creation date range (start,end) in milliseconds since epoch' },
              updated_at: { type: 'string', description: 'Filter by update date range (start,end) in milliseconds since epoch' },
              full_on_at: { type: 'string', description: 'Filter by full_on date range (start,end) in milliseconds since epoch' },
              sample_ratio_mismatch: { type: 'number', enum: [0, 1], description: 'Filter experiments with sample ratio mismatch' },
              cleanup_needed: { type: 'number', enum: [0, 1], description: 'Filter experiments that need cleanup' },
              audience_mismatch: { type: 'number', enum: [0, 1], description: 'Filter experiments with audience mismatch' },
              sample_size_reached: { type: 'number', enum: [0, 1], description: 'Filter experiments that reached sample size' },
              experiments_interact: { type: 'number', enum: [0, 1], description: 'Filter experiments that interact with other experiments' },
              group_sequential_updated: { type: 'number', enum: [0, 1], description: 'Filter experiments with updated group sequential analysis' },
              assignment_conflict: { type: 'number', enum: [0, 1], description: 'Filter experiments with assignment conflicts' },
              metric_threshold_reached: { type: 'number', enum: [0, 1], description: 'Filter experiments that reached metric threshold' },
              previews: { type: 'number', enum: [0, 1], description: 'Include experiment preview data' },
              analysis_type: { type: 'string', description: 'Filter by analysis type (e.g., group_sequential,fixed_horizon)' },
              type: { type: 'string', description: 'Filter by experiment type (e.g., test, feature)' },
              iterations: { type: 'number', description: 'Filter by number of iterations' },

              format: { type: 'string', enum: ['json', 'md'], description: 'Output format: \'json\' for full data or \'md\' for formatted markdown (default: md)' }
            },
          },
        },
        {
          name: 'get_experiment',
          description: 'Get a specific experiment by ID',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'number', description: 'Experiment ID' },
            },
            required: ['id'],
          },
        },
        {
          name: 'create_feature_flag',
          description: 'Create a simple feature flag',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Feature flag name' },
              unit_type_id: { type: 'number', description: 'Unit type ID' },
              application_id: { type: 'number', description: 'Application ID' },
              feature_enabled_percentage: { type: 'number', description: 'Percentage to enable feature (0-100)', default: 50 },
            },
            required: ['name', 'unit_type_id', 'application_id'],
          },
        },
        {
          name: 'start_experiment',
          description: 'Start an experiment',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'number', description: 'Experiment ID' },
            },
            required: ['id'],
          },
        },
        {
          name: 'stop_experiment',
          description: 'Stop an experiment',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'number', description: 'Experiment ID' },
            },
            required: ['id'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        switch (name) {
          case 'list_experiments':
            const response = await this.apiClient.listExperiments(args as any);

            if (!response.ok) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Error: ${response.errors?.join(', ') || 'Unknown error'}`,
                  },
                ],
              };
            }

            const experiments = response.data?.experiments || [];
            const format = (args as any).format || 'md';

            const baseUrl = this.endpoint.replace(/\/v1\/?$/, '');

            if (format === 'json') {
              const experimentsWithLinks = experiments.map((exp: any) => ({
                ...exp,
                link: `${baseUrl}/experiments/${exp.id}`
              }));

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      total: response.data?.total || experiments.length,
                      page: response.data?.page || 1,
                      items: response.data?.items || experiments.length,
                      experiments: experimentsWithLinks
                    }, null, 2),
                  },
                ],
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
              const totalPages = Math.ceil((response.data?.total || experiments.length) / ((args as any).items || 10));

              if (totalPages > 1) {
                markdown += `\n\n📄 Page ${currentPage} of ${totalPages}`;
                if (currentPage < totalPages) {
                  markdown += ` (use \`page: ${currentPage + 1}\` to see more)`;
                }
              }

              return {
                content: [
                  {
                    type: 'text',
                    text: markdown,
                  },
                ],
              };
            }
          case 'get_experiment': {
            const expResponse = await this.apiClient.getExperiment((args as any).id);
            if (!expResponse.ok) {
              return {
                content: [{ type: 'text', text: `Error: ${expResponse.errors?.join(', ') || 'Unknown error'}` }],
                isError: true,
              };
            }
            return {
              content: [{ type: 'text', text: JSON.stringify(expResponse.data, null, 2) }],
            };
          }
          case 'create_feature_flag': {
            const flagData = this.createFeatureFlagData(args as any);
            const createResponse = await this.apiClient.createExperiment(flagData);
            if (!createResponse.ok) {
              return {
                content: [{ type: 'text', text: `Error: ${createResponse.errors?.join(', ') || 'Unknown error'}` }],
                isError: true,
              };
            }
            return {
              content: [{ type: 'text', text: JSON.stringify(createResponse.data, null, 2) }],
            };
          }
          case 'start_experiment': {
            const startResponse = await this.apiClient.startExperiment((args as any).id);
            if (!startResponse.ok) {
              return {
                content: [{ type: 'text', text: `Error: ${startResponse.errors?.join(', ') || 'Unknown error'}` }],
                isError: true,
              };
            }
            return {
              content: [{ type: 'text', text: JSON.stringify(startResponse.data, null, 2) }],
            };
          }
          case 'stop_experiment': {
            const stopResponse = await this.apiClient.stopExperiment((args as any).id);
            if (!stopResponse.ok) {
              return {
                content: [{ type: 'text', text: `Error: ${stopResponse.errors?.join(', ') || 'Unknown error'}` }],
                isError: true,
              };
            }
            return {
              content: [{ type: 'text', text: JSON.stringify(stopResponse.data, null, 2) }],
            };
          }
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    });
  }
  private createFeatureFlagData(args: any) {
    return {
      name: args.name,
      display_name: args.name,
      state: 'ready',
      type: 'test',
      percentage_of_traffic: 100,
      nr_variants: 2,
      percentages: `${100 - (args.feature_enabled_percentage || 50)}/${args.feature_enabled_percentage || 50}`,
      unit_type: {
        unit_type_id: args.unit_type_id
      },
      applications: [{
        application_id: args.application_id,
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
    };
  }
  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}