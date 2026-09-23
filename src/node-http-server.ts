// Node-native Streamable HTTP MCP transport. Stateless (no session storage):
// each POST creates a fresh McpServer + transport, matching the MCP SDK's
// own examples/server/simpleStatelessStreamableHttp.js pattern. The host
// (e.g. office/backend) supplies an already-authenticated APIClient per
// request via buildContext — this module does zero authentication itself.
import type { IncomingMessage, ServerResponse } from "http";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { APIClient } from "@absmartly/cli/api-client";
import { createServerContextLoader } from "./server-context.js";
import { registerServer } from "./register-server.js";
import { MCP_VERSION } from "./version.js";

// Bundled markdown docs (templates.md, examples.md), shipped in the package's
// "files" as public/docs/. Resolves identically from src/ (tsx) and dist/.
const DEFAULT_DOCS_DIR = fileURLToPath(new URL("../public/docs/api", import.meta.url));

export interface NodeMcpRequestContext {
  apiClient: APIClient;
  endpoint: string;
  authType: string;
  /** Override the bundled docs directory (defaults to DEFAULT_DOCS_DIR). */
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
      let transport: StreamableHTTPServerTransport | undefined;
      let server: McpServer | undefined;
      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        transport?.close();
        server?.close();
      };

      try {
        const requestCtx = await buildContext(req);
        // Lazy: entity lists are fetched only if this message's handler needs
        // them, not on every POST (initialize, tools/list, etc. skip it).
        const serverCtx = createServerContextLoader(requestCtx.apiClient, {
          endpoint: requestCtx.endpoint,
          authType: requestCtx.authType,
        });

        server = new McpServer(
          { name: "ABsmartly MCP Server", version: MCP_VERSION },
          { capabilities: { tools: {}, resources: { subscribe: true, listChanged: true }, prompts: {} } },
        );
        registerServer(server, serverCtx, { docsDir: requestCtx.docsDir ?? DEFAULT_DOCS_DIR });

        transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await server.connect(transport);
        // Register the close handler before awaiting handleRequest: if the
        // client disconnects (or handleRequest throws) mid-request, this
        // listener must already be attached so the per-request McpServer/
        // transport still get cleaned up instead of leaking.
        res.on('close', cleanup);

        await transport.handleRequest(req, res, body);
      } catch (error) {
        console.error('Error handling MCP request:', error);
        // Clean up immediately on error too — don't rely solely on the
        // 'close' event, since a synchronous failure before res closes
        // would otherwise leave this request's McpServer/transport open.
        cleanup();
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
