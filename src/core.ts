// Node/core entry ("@absmartly/mcp", also "@absmartly/mcp/node-http").
//
// Everything a Node host needs to mount the MCP server: the Streamable HTTP
// handler, the fetch-based HttpClient for @absmartly/cli's APIClient, the tool
// and resource registration, and the command catalog behind execute_command.
//
// Must not import the Cloudflare Worker code (./index.ts and its
// absmartly-oauth-handler, oauth-worker-guards, session-provider,
// resources): that pulls in hono, @cloudflare/workers-oauth-provider and
// agents. tests/unit/package-entries.test.ts enforces this on the full
// transitive import graph. The Worker lives at "@absmartly/mcp/worker".
export { createStreamableHttpHandler } from "./node-http-server.js";
export type { NodeMcpHandler, NodeMcpRequestContext } from "./node-http-server.js";

export { FetchHttpClient } from "./fetch-adapter.js";
export type { FetchHttpClientOptions } from "./fetch-adapter.js";

export type { ApiClientLike } from "./api-client-like.js";

export { registerServer } from "./register-server.js";
export type { RegisterServerOptions } from "./register-server.js";
export { setupTools } from "./tools.js";
export type { ToolContext } from "./tools.js";
export { buildServerContext, createServerContextLoader } from "./server-context.js";
export type { ServerContext, ServerContextLoader, SummarizedEntity } from "./server-context.js";

export {
  CLI_GROUPS,
  executeCommand,
  getCommandEntry,
  getGroupCommands,
  getGroupSummary,
  getTotalCommandCount,
  searchCommands,
  validateCommandParams,
} from "./cli-catalog.js";
export type { CommandEntry, CommandParam, GroupSummary } from "./cli-catalog.js";

export type { Endpoint, EndpointHttpMethod, EndpointManifest } from "./endpoint-manifest.js";

export { MCP_VERSION } from "./version.js";
