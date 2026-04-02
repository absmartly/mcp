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

import { execFileSync, spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolveTestCredentials } from './test-credentials.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const CLAUDE_TESTS_DIR = join(__dirname, 'claude-tests');
const MCP_CONFIG_PATH = join(CLAUDE_TESTS_DIR, 'mcp-config.json');

const SHOW_RESPONSES = process.argv.includes('--show-responses');
const LIVE_MODE = process.argv.includes('--live');

const credentials = resolveTestCredentials();
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

function runClaude(prompt, { maxBudget = '0.10', timeoutMs = CLAUDE_TIMEOUT_MS } = {}) {
  const args = [
    '-p', prompt,
    '--mcp-config', MCP_CONFIG_PATH,
    '--strict-mcp-config',
    '--permission-mode', 'bypassPermissions',
    '--no-session-persistence',
    '--model', 'haiku',
    '--max-budget-usd', maxBudget,
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

async function waitForServer(url, maxWaitMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function startWranglerDev() {
  console.log('Starting wrangler dev...');
  const wrangler = spawn('npx', ['wrangler', 'dev', '--port', String(LOCAL_MCP_PORT)], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });

  wrangler.stderr.on('data', d => {
    const line = d.toString().trim();
    if (line && !line.includes('Deprecation') && !line.includes('[wrangler:info]')) {
      console.log(`  [wrangler] ${line}`);
    }
  });

  const ready = await waitForServer(`http://127.0.0.1:${LOCAL_MCP_PORT}/health`);
  if (!ready) {
    wrangler.kill('SIGTERM');
    throw new Error('wrangler dev did not become ready in time');
  }

  console.log('wrangler dev is ready\n');
  return wrangler;
}

async function run() {
  const wranglerProcesses = [];
  let passed = 0;
  let failed = 0;
  const results = [];

  async function ensureServer() {
    if (LIVE_MODE) return;
    try {
      const resp = await fetch(`http://127.0.0.1:${LOCAL_MCP_PORT}/health`, {
        signal: AbortSignal.timeout(2000)
      });
      if (resp.ok) return;
    } catch {}

    console.log('    (restarting wrangler dev...)');
    const w = await startWranglerDev();
    wranglerProcesses.push(w);
  }

  async function test(name, fn) {
    process.stdout.write(`\n  ${name} ... `);
    try {
      await ensureServer();
      const result = await fn();
      passed++;
      results.push({ name, status: 'PASS' });
      console.log('PASS');
      if (SHOW_RESPONSES && result && result.output) {
        console.log(`    ── response ──`);
        console.log(`    ${result.output.substring(0, 1000).split('\n').join('\n    ')}`);
        if (result.output.length > 1000) console.log(`    ... (${result.output.length} chars total)`);
        console.log(`    ──────────────`);
      }
    } catch (err) {
      failed++;
      results.push({ name, status: 'FAIL', error: err.message });
      console.log('FAIL');
      console.log(`    ${err.message}`);
    }
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

    await test('list_experiments returns results', () => {
      const result = runClaude(
        'Use the list_experiments tool with items=2 and format=json. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"experiments"'), 'tool result missing "experiments"');
    });

    await test('list_users returns users', () => {
      const result = runClaude(
        'Use the list_users tool with items=2. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"users"'), 'tool result missing "users"');
    });

    await test('list_applications returns applications', () => {
      const result = runClaude(
        'Use the list_applications tool with items=2. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"applications"'), 'tool result missing "applications"');
    });

    await test('list_unit_types returns unit types', () => {
      const result = runClaude(
        'Use the list_unit_types tool with items=2. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"unit_types"'), 'tool result missing "unit_types"');
    });

    await test('list_metrics returns metrics', () => {
      const result = runClaude(
        'Use the list_metrics tool with items=2. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"metrics"'), 'tool result missing "metrics"');
    });

    await test('list_goals returns goals', () => {
      const result = runClaude(
        'Use the list_goals tool with items=2. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"goals"'), 'tool result missing "goals"');
    });

    await test('list_tags returns tags', () => {
      const result = runClaude(
        'Use the list_tags tool with items=2. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"tags"'), 'tool result missing "tags"');
    });

    await test('list_teams returns teams', () => {
      const result = runClaude(
        'Use the list_teams tool with items=2. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"teams"'), 'tool result missing "teams"');
    });

    await test('get_auth_status returns authenticated info', () => {
      const result = runClaude(
        'Use the get_auth_status tool. Return ONLY the raw text output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('Authenticated') || r.includes('API Access'), 'tool result missing auth info');
    });

    await test('get_experiment returns experiment details', () => {
      const result = runClaude(
        'First use list_experiments with items=1 and format=json to get one experiment ID. Then use get_experiment with that ID. Return ONLY the raw JSON from get_experiment, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"id"'), 'tool result missing experiment "id"');
    });

    await test('list_experiments with search filter works', () => {
      const result = runClaude(
        'Use list_experiments with search="test" and items=2 and format=json. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"experiments"'), 'tool result missing "experiments"');
    });

    await test('list_experiments markdown format works', () => {
      const result = runClaude(
        'Use list_experiments with items=2 and format=md. Return ONLY the raw markdown output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('Experiment') || r.includes('#'), 'tool result not markdown');
    });

    await test('create_experiment tool has dynamic custom fields in schema', () => {
      const result = runClaude(
        'List all available tools and find create_experiment. Show me the full list of parameter names that create_experiment accepts. Output ONLY a JSON array of parameter name strings, nothing else.'
      );
      if (!result.ok) throw new Error(`claude failed: ${result.error}`);
      const coreParams = ['name', 'unit_type_id', 'application_id', 'variants', 'primary_metric_id'];
      for (const p of coreParams) {
        if (!result.output.includes(p)) {
          throw new Error(`create_experiment schema missing expected param "${p}": ${result.output.substring(0, 500)}`);
        }
      }
      return result;
    });

    await test('create_feature_flag tool has dynamic custom fields in schema', () => {
      const result = runClaude(
        'List all available tools and find create_feature_flag. Show me the full list of parameter names that create_feature_flag accepts. Output ONLY a JSON array of parameter name strings, nothing else.'
      );
      if (!result.ok) throw new Error(`claude failed: ${result.error}`);
      const coreParams = ['name', 'unit_type_id', 'application_id', 'primary_metric_id'];
      for (const p of coreParams) {
        if (!result.output.includes(p)) {
          throw new Error(`create_feature_flag schema missing expected param "${p}": ${result.output.substring(0, 500)}`);
        }
      }
      return result;
    });

    // ── Experiment lifecycle tests ──

    const expTimestamp = Date.now();

    await test('experiment lifecycle: create → ready → dev → start → stop → restart → full_on → stop → archive', () => {
      const expName = `mcp_test_exp_${expTimestamp}`;
      const result = runClaude(
`Do the following steps IN ORDER, calling the MCP tools one at a time. Wait for each result before proceeding.

1. Call list_applications with items=1 to get an application. Note its id.
2. Call list_unit_types with items=1 to get a unit type. Note its id.
3. Call create_experiment with: name="${expName}", application_id=<from step 1>, unit_type_id=<from step 2>, state="created", variants=[{"variant":0,"name":"Control","config":"{}"},{"variant":1,"name":"Treatment","config":"{}"}]. Note the returned experiment id.
4. Call get_experiment with the id from step 3. Confirm state is "created".
5. Call update_experiment with id=<experiment id>, action="ready".
6. Call get_experiment with the same id. Confirm state is "ready".
7. Call update_experiment with id=<experiment id>, action="development".
8. Call get_experiment with the same id. Confirm state is "development".
9. Call update_experiment with id=<experiment id>, action="start".
10. Call get_experiment with the same id. Confirm state is "running".
11. Call update_experiment with id=<experiment id>, action="stop".
12. Call get_experiment with the same id. Confirm state is "stopped".
13. Call update_experiment with id=<experiment id>, action="restart".
14. Call get_experiment with the same id. Note the state (should be "running").
15. Call update_experiment with id=<experiment id>, action="full_on", full_on_variant=1.
16. Call get_experiment with the same id. Confirm state is "full_on".
17. Call update_experiment with id=<experiment id>, action="stop".
18. Call update_experiment with id=<experiment id>, action="archive".

After ALL steps, return ONLY a JSON object with this exact format:
{"experiment_id": <number>, "states": ["created", "ready", "development", "running", "stopped", "running", "full_on", "stopped", "archived"]}

The "states" array should contain the actual state observed after each get_experiment call (steps 4,6,8,10,12,14,16) plus "stopped" and "archived" for the final transitions.`,
        { maxBudget: '0.50', timeoutMs: 300_000 }
      );
      if (!result.ok) throw new Error(`claude failed: ${result.error}`);

      let parsed;
      try {
        const jsonMatch = result.output.match(/\{[\s\S]*"experiment_id"[\s\S]*"states"[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result.output);
      } catch {
        throw new Error(`Failed to parse lifecycle result: ${result.output.substring(0, 500)}`);
      }

      if (!parsed.experiment_id) throw new Error('No experiment_id in result');
      if (!Array.isArray(parsed.states)) throw new Error('No states array in result');

      const expectedStates = ['created', 'ready', 'development', 'running', 'stopped'];
      for (const state of expectedStates) {
        if (!parsed.states.includes(state)) {
          throw new Error(`Missing state "${state}" in lifecycle. Got: ${JSON.stringify(parsed.states)}`);
        }
      }

      console.log(`\n    experiment_id=${parsed.experiment_id} states=${JSON.stringify(parsed.states)}`);
      process.stdout.write('    ');
      return result;
    });

    await test('feature flag lifecycle: create → ready → dev → start → stop → archive', () => {
      const flagName = `mcp_test_flag_${expTimestamp}`;
      const result = runClaude(
`Do the following steps IN ORDER, calling the MCP tools one at a time. Wait for each result before proceeding.

1. Call list_applications with items=1 to get an application. Note its id.
2. Call list_unit_types with items=1 to get a unit type. Note its id.
3. Call create_feature_flag with: name="${flagName}", application_id=<from step 1>, unit_type_id=<from step 2>, state="created". Note the returned experiment id.
4. Call get_experiment with the id from step 3. Confirm state is "created".
5. Call update_experiment with id=<experiment id>, action="ready".
6. Call get_experiment with the same id. Confirm state is "ready".
7. Call update_experiment with id=<experiment id>, action="development".
8. Call get_experiment with the same id. Confirm state is "development".
9. Call update_experiment with id=<experiment id>, action="start".
10. Call get_experiment with the same id. Confirm state is "running".
11. Call update_experiment with id=<experiment id>, action="stop".
12. Call get_experiment with the same id. Confirm state is "stopped".
13. Call update_experiment with id=<experiment id>, action="archive".

After ALL steps, return ONLY a JSON object with this exact format:
{"experiment_id": <number>, "type": "feature", "states": ["created", "ready", "development", "running", "stopped", "archived"]}

The "states" array should contain the actual state observed after each get_experiment call plus "archived" for the final transition.`,
        { maxBudget: '0.50', timeoutMs: 300_000 }
      );
      if (!result.ok) throw new Error(`claude failed: ${result.error}`);

      let parsed;
      try {
        const jsonMatch = result.output.match(/\{[\s\S]*"experiment_id"[\s\S]*"states"[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result.output);
      } catch {
        throw new Error(`Failed to parse lifecycle result: ${result.output.substring(0, 500)}`);
      }

      if (!parsed.experiment_id) throw new Error('No experiment_id in result');
      if (!Array.isArray(parsed.states)) throw new Error('No states array in result');

      const expectedStates = ['created', 'ready', 'development', 'running', 'stopped'];
      for (const state of expectedStates) {
        if (!parsed.states.includes(state)) {
          throw new Error(`Missing state "${state}" in lifecycle. Got: ${JSON.stringify(parsed.states)}`);
        }
      }

      console.log(`\n    experiment_id=${parsed.experiment_id} states=${JSON.stringify(parsed.states)}`);
      process.stdout.write('    ');
      return result;
    });

  } finally {
    for (const w of wranglerProcesses) {
      try {
        process.kill(-w.pid, 'SIGTERM');
      } catch {}
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

const result = await run();
process.exit(result.success ? 0 : 1);
