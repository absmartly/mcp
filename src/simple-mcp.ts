import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ABsmartlyAPIClient } from './api-client';

export class SimpleMCPServer {
  private server: Server;
  private apiClient: ABsmartlyAPIClient;

  constructor(apiKey: string) {
    this.apiClient = new ABsmartlyAPIClient(apiKey);
    this.server = new Server(
      {
        name: 'absmartly-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'list_experiments',
          description: 'List all experiments with optional filtering',
          inputSchema: {
            type: 'object',
            properties: {
              search: { type: 'string', description: 'Search term for experiment names' },
              state: { type: 'string', description: 'Filter by state (comma-separated: created,ready,running)' },
              page: { type: 'number', description: 'Page number for pagination' },
              items: { type: 'number', description: 'Number of items per page' },
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

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'list_experiments':
            const response = await this.apiClient.listExperiments(args as any);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(response.data, null, 2),
                },
              ],
            };

          case 'get_experiment':
            const expResponse = await this.apiClient.getExperiment((args as any).id);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(expResponse.data, null, 2),
                },
              ],
            };

          case 'create_feature_flag':
            const flagData = this.createFeatureFlagData(args as any);
            const createResponse = await this.apiClient.createExperiment(flagData);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(createResponse.data, null, 2),
                },
              ],
            };

          case 'start_experiment':
            const startResponse = await this.apiClient.startExperiment((args as any).id);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(startResponse.data, null, 2),
                },
              ],
            };

          case 'stop_experiment':
            const stopResponse = await this.apiClient.stopExperiment((args as any).id);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(stopResponse.data, null, 2),
                },
              ],
            };

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