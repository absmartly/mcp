#!/usr/bin/env node

// This is a minimal entry point for the DXT extension
// The actual MCP server runs via mcp-remote

const { spawn } = require('child_process');

// Get the configuration from environment variables (set by Claude Desktop)
const config = process.env.DXT_CONFIG ? JSON.parse(process.env.DXT_CONFIG) : {};
const absmartlyEndpoint = config.absmartly_endpoint || 'https://sandbox.absmartly.com';

// Construct the mcp-remote command with query parameter
const url = `https://mcp.absmartly.com/sse?absmartly-endpoint=${encodeURIComponent(absmartlyEndpoint)}`;
const args = ['mcp-remote', url];

// Execute mcp-remote
const child = spawn('npx', args, {
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