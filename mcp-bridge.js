#!/usr/bin/env node

/**
 * MCP Bridge for Claude Desktop Integration
 * 
 * This bridge connects Claude Desktop (via stdio) to the remote ABsmartly MCP server.
 * It automatically configures API credentials from environment variables and proxies all tool calls.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

class ABsmartlyMCPBridge {
  constructor() {
    this.remoteClient = null;
    this.isConnected = false;
    this.isConfigured = false;
    
    // Validate environment variables
    this.apiKey = process.env.ABSMARTLY_API_KEY;
    this.apiEndpoint = process.env.ABSMARTLY_API_ENDPOINT;
    
    if (!this.apiKey) {
      console.error('❌ ABSMARTLY_API_KEY environment variable is required');
      process.exit(1);
    }
    
    if (!this.apiEndpoint) {
      console.error('❌ ABSMARTLY_API_ENDPOINT environment variable is required');
      process.exit(1);
    }
    
    // Create local MCP server for Claude Desktop
    this.server = new Server(
      {
        name: 'absmartly-mcp-bridge',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      }
    );
    
    this.setupHandlers();
  }

  async connectToRemote() {
    if (this.isConnected) return;
    
    try {
      console.error('🔗 Connecting to remote ABsmartly MCP server...');
      
      // Create remote client
      this.remoteClient = new Client({
        name: 'absmartly-bridge-client',
        version: '1.0.0'
      }, {
        capabilities: {}
      });

      // Use only the working custom domain endpoint
      const urls = [
        'https://mcp.absmartly.com/sse'
      ];

      let connected = false;
      for (const url of urls) {
        try {
          console.error(`📡 Trying to connect to: ${url}`);
          const transport = new SSEClientTransport(new URL(url));
          await this.remoteClient.connect(transport);
          console.error(`✅ Connected to remote server: ${url}`);
          connected = true;
          break;
        } catch (error) {
          console.error(`❌ Failed to connect to ${url}:`, error.message);
        }
      }

      if (!connected) {
        throw new Error('Could not connect to any remote ABsmartly MCP server');
      }

      this.isConnected = true;
      console.error('🎉 Remote connection established successfully');
      
      // Auto-configure API credentials on first connection
      await this.configureCredentials();
      
    } catch (error) {
      console.error('💥 Failed to connect to remote server:', error.message);
      throw error;
    }
  }

  async configureCredentials() {
    try {
      console.error('⚙️  Ensuring ABsmartly API is configured...');
      
      const result = await this.remoteClient.callTool({
        name: 'configure_absmartly',
        arguments: {
          api_key: this.apiKey,
          api_endpoint: this.apiEndpoint
        }
      });
      
      this.isConfigured = true;
      console.error('✅ ABsmartly API configuration confirmed');
      
      // Log the actual response from the remote server
      if (result.content?.[0]?.text) {
        console.error(`📄 Server response: ${result.content[0].text}`);
      }
      
    } catch (error) {
      console.error('❌ Failed to configure ABsmartly API:', error.message);
      throw error;
    }
  }

  setupHandlers() {
    // List tools - proxy from remote server
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      await this.connectToRemote();
      
      try {
        const tools = await this.remoteClient.listTools();
        console.error(`📋 Retrieved ${tools.tools?.length || 0} tools from remote server`);
        return tools;
      } catch (error) {
        console.error('❌ Error listing tools:', error.message);
        return { tools: [] };
      }
    });

    // Call tool - proxy to remote server
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      await this.connectToRemote();
      
      const { name, arguments: args } = request.params;
      console.error(`🔧 Calling tool: ${name}`);
      
      try {
        // For non-configure tools, ensure the remote server is configured first
        if (name !== 'configure_absmartly') {
          try {
            await this.configureCredentials();
          } catch (configError) {
            console.error('⚠️  Configuration check failed, but proceeding with tool call');
          }
        }
        
        const result = await this.remoteClient.callTool({
          name,
          arguments: args || {}
        });
        
        console.error(`✅ Tool ${name} completed successfully`);
        return result;
        
      } catch (error) {
        console.error(`❌ Tool ${name} failed:`, error.message);
        return {
          content: [
            {
              type: 'text',
              text: `Error calling ${name}: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });

    // List resources - proxy from remote server
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      await this.connectToRemote();
      
      try {
        const resources = await this.remoteClient.listResources();
        console.error(`📚 Retrieved ${resources.resources?.length || 0} resources from remote server`);
        return resources;
      } catch (error) {
        console.error('❌ Error listing resources:', error.message);
        return { resources: [] };
      }
    });

    // Read resource - proxy to remote server
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      await this.connectToRemote();
      
      const { uri } = request.params;
      console.error(`📖 Reading resource: ${uri}`);
      
      try {
        const result = await this.remoteClient.readResource({ uri });
        console.error(`✅ Resource ${uri} read successfully`);
        return result;
        
      } catch (error) {
        console.error(`❌ Error reading resource ${uri}:`, error.message);
        return {
          contents: [
            {
              uri,
              mimeType: 'text/plain',
              text: `Error reading resource: ${error.message}`,
            },
          ],
        };
      }
    });

    // List prompts - proxy from remote server
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      await this.connectToRemote();
      
      try {
        const prompts = await this.remoteClient.listPrompts();
        console.error(`📝 Retrieved ${prompts.prompts?.length || 0} prompts from remote server`);
        return prompts;
      } catch (error) {
        console.error('❌ Error listing prompts:', error.message);
        return { prompts: [] };
      }
    });

    // Get prompt - proxy to remote server
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      await this.connectToRemote();
      
      const { name, arguments: args } = request.params;
      console.error(`📝 Getting prompt: ${name}`);
      
      try {
        const result = await this.remoteClient.getPrompt({
          name,
          arguments: args || {}
        });
        console.error(`✅ Prompt ${name} retrieved successfully`);
        return result;
        
      } catch (error) {
        console.error(`❌ Error getting prompt ${name}:`, error.message);
        return {
          description: `Error getting prompt: ${error.message}`,
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Error: ${error.message}`
              }
            }
          ]
        };
      }
    });
  }

  async start() {
    console.error('🚀 Starting ABsmartly MCP Bridge...');
    console.error('🔑 API Key:', this.apiKey.slice(0, 8) + '...' + this.apiKey.slice(-8));
    console.error('🌐 API Endpoint:', this.apiEndpoint);
    console.error('📍 Bridge ready to accept connections from Claude Desktop');
    console.error('💡 Available tools: list_experiments, create_feature_flag, and 25+ more');
    console.error('');
    
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

// Start the bridge
const bridge = new ABsmartlyMCPBridge();
bridge.start().catch((error) => {
  console.error('💥 Bridge startup failed:', error.message);
  process.exit(1);
});

// Handle cleanup
process.on('SIGINT', () => {
  console.error('🛑 Bridge shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('🛑 Bridge terminated');
  process.exit(0);
});