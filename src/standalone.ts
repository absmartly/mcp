#!/usr/bin/env node
import { SimpleMCPServer } from './simple-mcp.js';
async function main() {
  const apiKey = process.env.ABSMARTLY_API_KEY;
  if (!apiKey) {
    console.error('Error: ABSMARTLY_API_KEY environment variable is required');
    process.exit(1);
  }
  const server = new SimpleMCPServer(apiKey);
  console.error('ABsmartly MCP Server starting...');
  console.error('Server capabilities: experiments, feature flags, basic CRUD operations');
  await server.run();
}
main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});