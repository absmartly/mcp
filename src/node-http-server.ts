// Node-native Streamable HTTP MCP transport. Stateless (no session storage):
// each POST creates a fresh McpServer + transport, matching the MCP SDK's
// own examples/server/simpleStatelessStreamableHttp.js pattern. The host
// (e.g. office/backend) supplies an already-authenticated APIClient per
// request via buildContext — this module does zero authentication itself.
import type { IncomingMessage, ServerResponse } from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { APIClient } from "@absmartly/cli/api-client";
import { buildServerContext } from "./server-context.js";
import { registerServer } from "./register-server.js";
import { MCP_VERSION } from "./version.js";

export interface NodeMcpRequestContext {
  apiClient: APIClient;
  endpoint: string;
  authType: string;
  docsDir?: string;
}

export interface NodeMcpHandler {
  post: (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void>;
}

export function createStreamableHttpHandler(
  buildContext: (req: IncomingMessage) => Promise<NodeMcpRequestContext>,
): NodeMcpHandler {
  return {
    async post(req, res, body) {
      try {
        const requestCtx = await buildContext(req);
        const serverCtx = await buildServerContext(requestCtx.apiClient, {
          endpoint: requestCtx.endpoint,
          authType: requestCtx.authType,
        });

        const server = new McpServer(
          { name: "ABsmartly MCP Server", version: MCP_VERSION },
          { capabilities: { tools: {}, resources: { subscribe: true, listChanged: true }, prompts: {} } },
        );
        registerServer(server, serverCtx, { docsDir: requestCtx.docsDir });

        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);

        res.on('close', () => {
          transport.close();
          server.close();
        });
      } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          }));
        }
      }
    },
  };
}
