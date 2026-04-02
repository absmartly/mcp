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
  let serverVerified = false;
  let passed = 0;
  let failed = 0;
  const results = [];

  async function ensureServer() {
    if (LIVE_MODE) return;
    if (serverVerified) return;
    try {
      const resp = await fetch(`http://127.0.0.1:${LOCAL_MCP_PORT}/health`, {
        signal: AbortSignal.timeout(2000)
      });
      if (resp.ok) { serverVerified = true; return; }
    } catch {}

    console.log('    (starting wrangler dev...)');
    const w = await startWranglerDev();
    wranglerProcesses.push(w);
    serverVerified = true;
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

    await test('listExperiments returns results', () => {
      const result = runClaude(
        'Call the execute_api_method tool with method_name "listExperiments" and params {"items": 2}. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"id"') && r.includes('"name"'), 'tool result missing experiment fields');
    });

    await test('listUsers returns users', () => {
      const result = runClaude(
        'Call the execute_api_method tool with method_name "listUsers" and params {"items": 2}. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"id"') && r.includes('"email"'), 'tool result missing user fields');
    });

    await test('listApplications returns applications', () => {
      const result = runClaude(
        'Call the execute_api_method tool with method_name "listApplications" and params {"items": 2}. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"id"') && r.includes('"name"'), 'tool result missing application fields');
    });

    await test('listUnitTypes returns unit types', () => {
      const result = runClaude(
        'Call the execute_api_method tool with method_name "listUnitTypes" and params {"items": 2}. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"id"') && r.includes('"name"'), 'tool result missing unit type fields');
    });

    await test('listMetrics returns metrics', () => {
      const result = runClaude(
        'Call the execute_api_method tool with method_name "listMetrics" and params {"items": 2}. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"id"'), 'tool result missing metric fields');
    });

    await test('listGoals returns goals', () => {
      const result = runClaude(
        'Call the execute_api_method tool with method_name "listGoals" and params {"items": 2}. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"id"') && r.includes('"name"'), 'tool result missing goal fields');
    });

    await test('listExperimentTags returns tags', () => {
      const result = runClaude(
        'Call the execute_api_method tool with method_name "listExperimentTags". Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"id"'), 'tool result missing tag fields');
    });

    await test('listTeams returns teams', () => {
      const result = runClaude(
        'Call the execute_api_method tool with method_name "listTeams" and params {"items": 2}. Return ONLY the raw JSON output from the tool, nothing else.'
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
        'First call execute_api_method with method_name "listExperiments" and params {"items": 1} to get one experiment ID. Then call execute_api_method with method_name "getExperiment" and params {"id": <that id>}. Return ONLY the raw JSON from the second call, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"id"'), 'tool result missing experiment "id"');
    });

    await test('listExperiments with search filter works', () => {
      const result = runClaude(
        'Call the execute_api_method tool with method_name "listExperiments" and params {"search": "test", "items": 2}. Return ONLY the raw JSON output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('"id"'), 'tool result missing experiment fields');
    });

    await test('discover_api_methods lists categories', () => {
      const result = runClaude(
        'Call the discover_api_methods tool with no arguments. Return ONLY the raw output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('experiments') && r.includes('goals'), 'tool result missing API categories');
    });

    await test('execute_api_method tool accepts method_name and params', () => {
      const result = runClaude(
        'List all available tools. Find the execute_api_method tool and show me its parameter names. Output ONLY a JSON array of parameter name strings, nothing else.'
      );
      if (!result.ok) throw new Error(`claude failed: ${result.error}`);
      const coreParams = ['method_name'];
      for (const p of coreParams) {
        if (!result.output.includes(p)) {
          throw new Error(`execute_api_method schema missing expected param "${p}": ${result.output.substring(0, 500)}`);
        }
      }
      return result;
    });

    await test('discover_api_methods returns createExperiment info', () => {
      const result = runClaude(
        'Call the discover_api_methods tool with category "experiments". Return ONLY the raw output from the tool, nothing else.'
      );
      return assertToolResult(result, r => r.includes('createExperiment'), 'tool result missing createExperiment method');
    });

    // ── Experiment lifecycle tests ──

    const expTimestamp = Date.now();

    await test('experiment lifecycle: create → ready → dev → start → stop → restart → full_on → stop → archive', () => {
      const expName = `mcp_test_exp_${expTimestamp}`;
      const result = runClaude(
`Do the following steps IN ORDER using the execute_api_method tool. Wait for each result before proceeding.

1. Call execute_api_method with method_name "listApplications" and params {"items": 1}. Note the first application's id.
2. Call execute_api_method with method_name "listUnitTypes" and params {"items": 1}. Note the first unit type's id.
3. Call execute_api_method with method_name "createExperiment" and params {"data": {"name": "${expName}", "applications": [{"application_id": <from step 1>}], "unit_type": {"unit_type_id": <from step 2>}, "type": "test", "state": "created", "variants": [{"variant": 0, "name": "Control", "config": "{}"}, {"variant": 1, "name": "Treatment", "config": "{}"}]}}. Note the returned experiment id.
4. Call execute_api_method with method_name "getExperiment" and params {"id": <experiment id>}. Confirm state is "created".
5. Call execute_api_method with method_name "updateExperiment" and params {"id": <experiment id>, "data": {"state": "ready"}}.
6. Call execute_api_method with method_name "getExperiment" and params {"id": <experiment id>}. Confirm state is "ready".
7. Call execute_api_method with method_name "developmentExperiment" and params {"id": <experiment id>, "note": "dev testing"}.
8. Call execute_api_method with method_name "getExperiment" and params {"id": <experiment id>}. Note state.
9. Call execute_api_method with method_name "startExperiment" and params {"id": <experiment id>}.
10. Call execute_api_method with method_name "getExperiment" and params {"id": <experiment id>}. Confirm state is "running".
11. Call execute_api_method with method_name "stopExperiment" and params {"id": <experiment id>}.
12. Call execute_api_method with method_name "getExperiment" and params {"id": <experiment id>}. Confirm state is "stopped".
13. Call execute_api_method with method_name "restartExperiment" and params {"id": <experiment id>}. Note the new experiment id returned.
14. Call execute_api_method with method_name "getExperiment" and params {"id": <new experiment id>}. Note the state.
15. Call execute_api_method with method_name "fullOnExperiment" and params {"id": <new experiment id>, "variant": 1, "note": "going full on"}.
16. Call execute_api_method with method_name "getExperiment" and params {"id": <new experiment id>}. Note state.
17. Call execute_api_method with method_name "stopExperiment" and params {"id": <new experiment id>}.
18. Call execute_api_method with method_name "archiveExperiment" and params {"id": <new experiment id>}.

After ALL steps, return ONLY a JSON object with this exact format:
{"experiment_id": <number>, "states": ["created", "ready", ...all observed states...]}`,
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
`Do the following steps IN ORDER using the execute_api_method tool. Wait for each result before proceeding.

1. Call execute_api_method with method_name "listApplications" and params {"items": 1}. Note the first application's id.
2. Call execute_api_method with method_name "listUnitTypes" and params {"items": 1}. Note the first unit type's id.
3. Call execute_api_method with method_name "createExperiment" and params {"data": {"name": "${flagName}", "applications": [{"application_id": <from step 1>}], "unit_type": {"unit_type_id": <from step 2>}, "type": "feature", "state": "created", "variants": [{"variant": 0, "name": "Off", "config": "{}"}, {"variant": 1, "name": "On", "config": "{}"}]}}. Note the returned experiment id.
4. Call execute_api_method with method_name "getExperiment" and params {"id": <experiment id>}. Confirm state is "created".
5. Call execute_api_method with method_name "updateExperiment" and params {"id": <experiment id>, "data": {"state": "ready"}}.
6. Call execute_api_method with method_name "getExperiment" and params {"id": <experiment id>}. Confirm state is "ready".
7. Call execute_api_method with method_name "developmentExperiment" and params {"id": <experiment id>, "note": "dev testing"}.
8. Call execute_api_method with method_name "getExperiment" and params {"id": <experiment id>}. Note state.
9. Call execute_api_method with method_name "startExperiment" and params {"id": <experiment id>}.
10. Call execute_api_method with method_name "getExperiment" and params {"id": <experiment id>}. Confirm state is "running".
11. Call execute_api_method with method_name "stopExperiment" and params {"id": <experiment id>}.
12. Call execute_api_method with method_name "getExperiment" and params {"id": <experiment id>}. Confirm state is "stopped".
13. Call execute_api_method with method_name "archiveExperiment" and params {"id": <experiment id>}.

After ALL steps, return ONLY a JSON object with this exact format:
{"experiment_id": <number>, "type": "feature", "states": ["created", "ready", ...all observed states...]}`,
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
