#!/usr/bin/env node

// Minimal entry point for the DXT/MCPB extension.
// The actual MCP server runs remotely; this just bridges stdio → mcp-remote.

const { spawn } = require('child_process');

const DEFAULT_ABSMARTLY_ENDPOINT = 'https://sandbox.absmartly.com';

// ABSMARTLY_ENDPOINT is wired in manifest.json via "${user_config.absmartly_endpoint}".
const absmartlyEndpoint = process.env.ABSMARTLY_ENDPOINT || DEFAULT_ABSMARTLY_ENDPOINT;

const url = `https://mcp.absmartly.com/sse?absmartly-endpoint=${encodeURIComponent(absmartlyEndpoint)}`;

const child = spawn('npx', ['mcp-remote', url], {
  stdio: 'inherit',
  shell: true
});

child.on('exit', (code) => {
  process.exit(code);
});

child.on('error', (error) => {
  console.error('Error starting ABsmartly MCP server:', error);
  process.exit(1);
});