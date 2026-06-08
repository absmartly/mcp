#!/usr/bin/env node
/**
 * Integration tests that run `claude -p` against a local MCP server.
 *
 * Prerequisites:
 *   - .env.local with ABSMARTLY_API_KEY and ABSMARTLY_API_ENDPOINT
 *   - `claude` CLI installed and authenticated
 *   - wrangler dev running (started automatically if not)
 *
 * Usage:
 *   node tests/integration/claude-mcp-tools.test.js [--show-responses] [--live]
 */

import { execFileSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { resolveTestCredentials } from './test-credentials.js';
import { ensureWranglerDev, stopWranglerDev } from './wrangler-fixture.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLAUDE_TESTS_DIR = join(__dirname, 'claude-tests');
mkdirSync(CLAUDE_TESTS_DIR, { recursive: true });
const MCP_CONFIG_PATH = join(CLAUDE_TESTS_DIR, 'mcp-config.json');

const SHOW_RESPONSES = process.argv.includes('--show-responses');
const LIVE_MODE = process.argv.includes('--live');

const credentials = await resolveTestCredentials();
if (!credentials) {
  console.error('No credentials found. Set ABSMARTLY_API_KEY/ABSMARTLY_API_ENDPOINT in .env.local or use --profile <name>');
  process.exit(1);
}

const API_KEY = credentials.apiKey;
const API_ENDPOINT = credentials.endpoint;
const LOCAL_MCP_PORT = 8787;
const LIVE_MCP_URL = 'https://mcp.absmartly.com/sse';
const LOCAL_MCP_URL = `http://127.0.0.1:${LOCAL_MCP_PORT}/sse`;
const MCP_URL = LIVE_MODE ? LIVE_MCP_URL : LOCAL_MCP_URL;
const CLAUDE_TIMEOUT_MS = 120_000;

if (!API_KEY || !API_ENDPOINT) {
  console.error('Missing ABSMARTLY_API_KEY or ABSMARTLY_API_ENDPOINT in .env.local');
  process.exit(1);
}

function writeMcpConfig() {
  const config = {
    mcpServers: {
      [LIVE_MODE ? 'absmartly' : 'absmartly-local']: {
        type: 'sse',
        url: MCP_URL,
        headers: {
          'Authorization': API_KEY,
          'x-absmartly-endpoint': API_ENDPOINT
        }
      }
    }
  };
  writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2));
}

function runClaude(prompt, { timeoutMs = CLAUDE_TIMEOUT_MS, model = 'haiku' } = {}) {
  const args = [
    '-p', prompt,
    '--mcp-config', MCP_CONFIG_PATH,
    '--strict-mcp-config',
    '--permission-mode', 'bypassPermissions',
    '--no-session-persistence',
    '--model', model,
    '--output-format', 'stream-json',
    '--verbose'
  ];

  const env = { ...process.env };
  delete env.CLAUDECODE;

  try {
    const raw = execFileSync('claude', args, {
      cwd: CLAUDE_TESTS_DIR,
      timeout: timeoutMs,
      encoding: 'utf-8',
      env,
      maxBuffer: 10 * 1024 * 1024
    });

    return parseStreamJson(raw);
  } catch (error) {
    const stderr = error.stderr ? error.stderr.toString().trim() : '';
    const stdout = error.stdout ? error.stdout.toString().trim() : '';
    const parsed = stdout ? parseStreamJson(stdout) : { output: '', toolResults: [], toolSchemas: [] };
    return { ok: false, ...parsed, error: stderr || error.message };
  }
}

function parseStreamJson(raw) {
  const lines = raw.split('\n').filter(Boolean);
  const toolResults = [];
  let output = '';
  let toolSchemas = [];

  for (const line of lines) {
    try {
      const msg = JSON.parse(line);

      if (msg.type === 'result') {
        output = msg.result || '';
      }

      if (msg.type === 'user' && msg.tool_use_result) {
        const content = Array.isArray(msg.tool_use_result)
          ? msg.tool_use_result
          : msg.message?.content?.[0]?.content;
        if (content) {
          for (const part of content) {
            if (part.type === 'text') {
              toolResults.push(part.text);
            }
          }
        }
      }

      if (msg.type === 'system' && msg.subtype === 'init' && msg.tools) {
        toolSchemas = msg.tools;
      }
    } catch {}
  }

  return { ok: true, output: output.trim(), toolResults, toolSchemas };
}

function assertToolResult(result, check, label) {
  if (!result.ok) throw new Error(`claude failed: ${result.error}`);
  if (result.toolResults.length === 0) throw new Error('no tool results captured');

  const lastToolResult = result.toolResults[result.toolResults.length - 1];

  if (!check(lastToolResult)) {
    throw new Error(`${label}: ${lastToolResult.substring(0, 300)}`);
  }
  return result;
}

async function run() {
  const ownedFixtures = [];
  let serverVerified = false;
  let passed = 0;
  let failed = 0;
  const results = [];

  async function ensureServer() {
    if (LIVE_MODE) return;
    if (serverVerified) return;
    const fixture = await ensureWranglerDev({ port: LOCAL_MCP_PORT });
    if (!fixture.alreadyRunning) {
      console.log('    (started wrangler dev)');
      ownedFixtures.push(fixture);
    }
    serverVerified = true;
  }

  async function test(name, fn) {
    process.stdout.write(`\n  ${name} ... `);
    let lastErr;
    let result;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await ensureServer();
        result = await fn();
        if (attempt > 1) console.log(`(retry ${attempt - 1} succeeded) `);
        passed++;
        results.push({ name, status: 'PASS' });
        console.log('PASS');
        if (SHOW_RESPONSES && result && result.output) {
          console.log(`    ── response ──`);
          console.log(`    ${result.output.substring(0, 1000).split('\n').join('\n    ')}`);
          if (result.output.length > 1000) console.log(`    ... (${result.output.length} chars total)`);
          console.log(`    ──────────────`);
        }
        return;
      } catch (err) {
        lastErr = err;
        if (attempt === 1) process.stdout.write(`(attempt 1 failed: ${err.message.substring(0, 80)}; retrying) `);
      }
    }
    failed++;
    results.push({ name, status: 'FAIL', error: lastErr.message });
    console.log('FAIL');
    console.log(`    ${lastErr.message}`);
  }

  try {
    await ensureServer();

    writeMcpConfig();

    console.log(`Mode:         ${LIVE_MODE ? 'LIVE (mcp.absmartly.com)' : 'LOCAL (wrangler dev)'}`);
    console.log(`Work dir:     ${CLAUDE_TESTS_DIR}`);
    console.log(`MCP config:   ${MCP_CONFIG_PATH}`);
    console.log(`MCP URL:      ${MCP_URL}`);
    console.log(`API endpoint: ${API_ENDPOINT}`);

    // ── Tests ──

    await test('listExperiments returns results', () => {
      const result = runClaude(
        'Call the execute_command tool with group "experiments" and command "listExperiments" and params {"items": 2}. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"id"') && r.includes('"name"'), 'tool result missing experiment fields');
    });

    await test('listUsers returns users', () => {
      const result = runClaude(
        'Call the execute_command tool with group "users" and command "listUsers" and params {"items": 2}. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"id"') && r.includes('"email"'), 'tool result missing user fields');
    });

    await test('listApps returns applications', () => {
      const result = runClaude(
        'Call the execute_command tool with group "apps" and command "listApps" and params {}. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"id"') && r.includes('"name"'), 'tool result missing application fields');
    });

    await test('listUnits returns unit types', () => {
      const result = runClaude(
        'Call the execute_command tool with group "units" and command "listUnits" and params {}. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"id"') && r.includes('"name"'), 'tool result missing unit type fields');
    });

    await test('listMetrics returns metrics', () => {
      const result = runClaude(
        'Call the execute_command tool with group "metrics" and command "listMetrics" and params {"items": 2}. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"id"'), 'tool result missing metric fields');
    });

    await test('listGoals returns goals', () => {
      const result = runClaude(
        'Call the execute_command tool with group "goals" and command "listGoals" and params {"items": 2}. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"id"') && r.includes('"name"'), 'tool result missing goal fields');
    });

    await test('listExperimentTags returns tags', () => {
      const result = runClaude(
        'Call the execute_command tool with group "tags" and command "listTags". Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"id"'), 'tool result missing tag fields');
    });

    await test('listTeams returns teams', () => {
      const result = runClaude(
        'Call the execute_command tool with group "teams" and command "listTeams" and params {"items": 2}. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"id"') && r.includes('"name"'), 'tool result missing team fields');
    });

    await test('get_auth_status returns authenticated info', () => {
      const result = runClaude(
        'Call the get_auth_status tool. Return ONLY the raw text output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('Authenticated') || r.includes('API Access') || r.includes('authenticated'), 'tool result missing auth info');
    });

    await test('getExperiment returns experiment details', () => {
      const result = runClaude(
        'First call execute_command with group="experiments", command="listExperiments", params={"items": 1} to get one experiment ID. Then call execute_command with group="experiments", command="getExperiment", params={"experimentId": <that id>}. Return ONLY the raw JSON from the second call, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"id"'), 'tool result missing experiment "id"');
    });

    await test('listExperiments with search filter works', () => {
      const result = runClaude(
        'Call execute_command with group="experiments", command="listExperiments", params={"search": "test", "items": 2}. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"id"'), 'tool result missing experiment fields');
    });

    await test('discover_commands lists categories', () => {
      const result = runClaude(
        'Call the discover_commands tool with no arguments. Return ONLY the raw output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('experiments') && r.includes('goals'), 'tool result missing API categories');
    });

    await test('execute_command tool accepts group and command params', () => {
      const result = runClaude(
        'List all available tools. Find the execute_command tool and show me its parameter names. Output ONLY a JSON array of parameter name strings, nothing else.'
      );
      if (!result.ok) throw new Error(`claude failed: ${result.error}`);
      const coreParams = ['group', 'command'];
      for (const p of coreParams) {
        if (!result.output.includes(p)) {
          throw new Error(`execute_command schema missing expected param "${p}": ${result.output.substring(0, 500)}`);
        }
      }
      return result;
    });

    await test('discover_commands returns createExperiment info', () => {
      const result = runClaude(
        'Call the discover_commands tool with category "experiments". Return ONLY the raw output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('createExperiment'), 'tool result missing createExperiment method');
    });

    // ── Experiment lifecycle tests ──
    // Moved to tests/integration/lifecycle-sdk.test.ts — that file drives the
    // full state machine via direct MCP SDK calls with real setTimeout-based
    // polling, which is deterministic. The Claude-driven version that used to
    // live here was flaky (haiku occasionally lost track of MCP tools after
    // ~7 rapid calls; long prompts compounded per-step failure rates).

  } finally {
    for (const fixture of ownedFixtures) {
      stopWranglerDev(fixture);
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailed:');
    for (const r of results.filter(r => r.status === 'FAIL')) {
      console.log(`  - ${r.name}: ${r.error}`);
    }
  }
  console.log();

  return { success: failed === 0, passed, failed, results };
}

export default run;

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await run();
  process.exit(result.success ? 0 : 1);
}
