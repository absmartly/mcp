// Cloudflare Worker entry ("@absmartly/mcp/worker"). Needs the optional peer
// dependencies hono, @cloudflare/workers-oauth-provider and agents, and a
// Workers runtime (or wrangler) to run. wrangler.jsonc deploys src/index.ts
// directly; this module only re-exports it for package consumers.
export { default, ABsmartlyMCP } from "./index.js";
