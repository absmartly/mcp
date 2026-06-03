#!/usr/bin/env node
/**
 * Comprehensive integration tests for the 3 meta-tools (discover_commands,
 * get_command_docs, execute_command) using `claude -p`.
 *
 * All ABsmartly operations (list, create, update, lifecycle) are tested
 * through execute_command — the single generic executor.
 *
 * Credentials come from the ABsmartly CLI test-1 profile:
 *   - Endpoint: ~/.config/absmartly/config.yaml
 *   - API key:  macOS keychain (service: absmartly-cli, account: api-key-test-1)
 *
 * Usage:
 *   node tests/integration/claude-tool-discovery.test.js [--show-responses] [--live]
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLAUDE_TESTS_DIR = join(__dirname, 'claude-tests');
const MCP_CONFIG_PATH = join(CLAUDE_TESTS_DIR, 'mcp-config.json');

const SHOW_RESPONSES = process.argv.includes('--show-responses');
const LIVE_MODE = process.argv.includes('--live');

const LOCAL_MCP_PORT = 8787;
const LIVE_MCP_URL = 'https://mcp.absmartly.com/sse';
const LOCAL_MCP_URL = `http://127.0.0.1:${LOCAL_MCP_PORT}/sse`;
const MCP_URL = LIVE_MODE ? LIVE_MCP_URL : LOCAL_MCP_URL;
const CLAUDE_TIMEOUT_MS = 120_000;

function loadTestProfile() {
  const configPath = join(process.env.HOME, '.config', 'absmartly', 'config.yaml');
  if (!existsSync(configPath)) {
    console.error(`ABsmartly CLI config not found: ${configPath}`);
    process.exit(1);
  }

  const configText = readFileSync(configPath, 'utf-8');
  const test1Match = configText.match(/test-1:\s*\n\s+api:\s*\n\s+endpoint:\s*(\S+)/);
  if (!test1Match) {
    console.error('test-1 profile missing or has no api.endpoint in config.yaml');
    process.exit(1);
  }
  const profileEndpoint = test1Match[1];

  let apiKey;
  try {
    apiKey = execFileSync(
      'security',
      ['find-generic-password', '-s', 'absmartly-cli', '-a', 'api-key-test-1', '-w'],
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();
  } catch {
    console.error('Failed to read API key from macOS keychain for test-1 profile');
    console.error('Run: security find-generic-password -s absmartly-cli -a api-key-test-1 -w');
    process.exit(1);
  }

  if (!apiKey) {
    console.error('API key is empty for test-1 profile');
    process.exit(1);
  }

  return { endpoint: profileEndpoint, apiKey };
}

const { endpoint: API_ENDPOINT, apiKey: API_KEY } = loadTestProfile();

function writeMcpConfig() {
  if (!existsSync(CLAUDE_TESTS_DIR)) {
    mkdirSync(CLAUDE_TESTS_DIR, { recursive: true });
  }

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
        if (typeof msg.tool_use_result === 'string') {
          toolResults.push(msg.tool_use_result);
        } else if (Array.isArray(msg.tool_use_result)) {
          for (const part of msg.tool_use_result) {
            if (part.type === 'text') toolResults.push(part.text);
          }
        }
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const part of content) {
            const text = part.content || part.text;
            if (typeof text === 'string' && text.length > 10) {
              toolResults.push(text);
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

  if (result.toolResults.length > 0) {
    const lastToolResult = result.toolResults[result.toolResults.length - 1];
    if (check(lastToolResult)) return result;
  }

  if (result.output && check(result.output)) return result;

  const context = result.toolResults.length > 0
    ? result.toolResults[result.toolResults.length - 1].substring(0, 500)
    : result.output?.substring(0, 500) || '(empty)';
  throw new Error(`${label}: ${context}`);
}

async function isLocalMcpReachable() {
  if (LIVE_MODE) return true;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    await fetch(MCP_URL, { signal: controller.signal });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

function extractJsonObject(text) {
  // Prefer a fenced ```json``` block when present.
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch {}
  }
  // Otherwise, walk braces to find the first balanced { ... } that contains "experiment_id".
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          if (candidate.includes('"experiment_id"')) {
            try { return JSON.parse(candidate); } catch {}
          }
          break;
        }
      }
    }
  }
  return null;
}

// Build a human-readable dump of every tool call result captured during the
// run. Trims each to a reasonable size so a long lifecycle doesn't blow up
// the test failure log.
function formatToolResults(result, perItemMax = 600) {
  const items = result?.toolResults || [];
  if (items.length === 0) return '(no tool results captured)';
  return items.map((text, idx) => {
    const trimmed = text.length > perItemMax
      ? text.slice(0, perItemMax) + ` … (+${text.length - perItemMax} chars truncated)`
      : text;
    return `    [tool ${idx + 1}/${items.length}]\n      ${trimmed.split('\n').join('\n      ')}`;
  }).join('\n');
}

async function run() {
  if (!(await isLocalMcpReachable())) {
    console.log(`\n  Skipped: local MCP not reachable at ${MCP_URL}. Start wrangler dev or pass --live.`);
    return { success: true, message: 'Skipped: local MCP not reachable', testCount: 0, details: [] };
  }

  let passed = 0;
  let failed = 0;
  const results = [];

  async function test(name, fn) {
    process.stdout.write(`\n  ${name} ... `);
    let lastErr;
    let result;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
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

  writeMcpConfig();

  console.log(`Mode:         ${LIVE_MODE ? 'LIVE (mcp.absmartly.com)' : 'LOCAL (wrangler dev)'}`);
  console.log(`Work dir:     ${CLAUDE_TESTS_DIR}`);
  console.log(`MCP config:   ${MCP_CONFIG_PATH}`);
  console.log(`MCP URL:      ${MCP_URL}`);
  console.log(`API endpoint: ${API_ENDPOINT}`);

  // ════════════════════════════════════════════════
  // 1. discover_commands
  // ════════════════════════════════════════════════
  console.log(`\n── discover_commands ──`);

  await test('discover: no params → category summary', () => {
    const result = runClaude(
      'Use the discover_commands tool without any parameters. Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('groups') && r.includes('experiments') && r.includes('commands'),
      'missing category summary'
    );
  });

  await test('discover: browse experiments category', () => {
    const result = runClaude(
      'Use the discover_commands tool with group="experiments". Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('listExperiments') && r.includes('getExperiment'),
      'missing experiment methods'
    );
  });

  await test('discover: search "metric"', () => {
    const result = runClaude(
      'Use the discover_commands tool with search="metric". Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.toLowerCase().includes('metric'),
      'missing metric-related methods'
    );
  });

  await test('discover: unknown category → helpful error', () => {
    const result = runClaude(
      'Use the discover_commands tool with group="nonexistent_xyz". Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('No commands found') || r.includes('No methods found') || r.includes('not found'),
      'missing error for unknown category'
    );
  });

  // ════════════════════════════════════════════════
  // 2. get_command_docs
  // ════════════════════════════════════════════════
  console.log(`\n── get_command_docs ──`);

  await test('docs: listExperiments → params table', () => {
    const result = runClaude(
      'Use the get_command_docs tool with group="experiments", command="listExperiments". Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('listExperiments') && (r.includes('Parameter') || r.includes('Param')),
      'missing method documentation'
    );
  });

  await test('docs: archiveExperiment → danger warning', () => {
    const result = runClaude(
      'Use the get_command_docs tool with group="experiments", command="archiveExperiment". Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('archiveExperiment') && (r.includes('WARNING') || r.includes('estructive') || r.includes('dangerous')),
      'missing danger warning'
    );
  });

  await test('docs: unknown method → suggestions', () => {
    const result = runClaude(
      'Use the get_command_docs tool with group="experiments", command="xyzNotARealMethod123". Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('not found') || r.includes('Did you mean') || r.includes('discover_commands'),
      'missing suggestions for unknown method'
    );
  });

  await test('docs: createMetric → usage example with execute_command', () => {
    const result = runClaude(
      'Use the get_command_docs tool with group="metrics", command="createMetric". Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('execute_command') && r.includes('command'),
      'missing usage example'
    );
  });

  // ════════════════════════════════════════════════
  // 3. execute_command — list operations
  // ════════════════════════════════════════════════
  console.log(`\n── execute_command: list operations ──`);

  await test('exec: listTeams', () => {
    const result = runClaude(
      'Use the execute_command tool with group="teams", command="listTeams" and params={}. Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('"id"') && r.includes('"name"'),
      'missing team data'
    );
  });

  await test('exec: listApps', () => {
    const result = runClaude(
      'Use the execute_command tool with group="apps", command="listApps" and params={}. Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('"id"') && r.includes('"name"'),
      'missing application data'
    );
  });

  await test('exec: listUnits', () => {
    const result = runClaude(
      'Use the execute_command tool with group="units", command="listUnits" and params={}. Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('"id"') && r.includes('"name"'),
      'missing unit type data'
    );
  });

  await test('exec: listMetrics', () => {
    const result = runClaude(
      'Use the execute_command tool with group="metrics", command="listMetrics" and params={"items": 2}. Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('"id"') && (r.includes('"type"') || r.includes('"name"')),
      'missing metric data'
    );
  });

  await test('exec: listUsers', () => {
    const result = runClaude(
      'Use the execute_command tool with group="users", command="listUsers" and params={"items": 2}. Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('"id"') && r.includes('"email"'),
      'missing user data'
    );
  });

  await test('exec: listTags', () => {
    const result = runClaude(
      'Use the execute_command tool with group="tags", command="listTags" and params={}. Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('[') || r.includes('"id"'),
      'missing tag data'
    );
  });

  await test('exec: listSegments', () => {
    const result = runClaude(
      'Use the execute_command tool with group="segments", command="listSegments" and params={}. Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('[') || r.includes('"id"') || r.includes('Successfully'),
      'missing segment data'
    );
  });

  await test('exec: listGoals', () => {
    const result = runClaude(
      'Call the MCP tool execute_command with group="goals", command="listGoals" and params={"limit": 3}. Do NOT use Read, Bash, or any local tools. Return ONLY the raw text output from the MCP tool.'
    );
    return assertToolResult(result, r =>
      r.includes('"id"') || r.includes('['),
      'missing goal data'
    );
  });

  // ════════════════════════════════════════════════
  // 4. execute_command — read single entity
  // ════════════════════════════════════════════════
  console.log(`\n── execute_command: read single entity ──`);

  await test('exec: getExperiment by id', () => {
    const result = runClaude(
      'Call the MCP tool execute_command with group="experiments", command="listExperiments" and params={"options": {"items": 1}} to get one experiment. Note its id. Then call the MCP tool execute_command with group="experiments", command="getExperiment" and params={"id": <the numeric id>}. Do NOT use Read, Bash, or local tools. Return ONLY the raw text from the second MCP tool call.',
      {}
    );
    return assertToolResult(result, r =>
      r.includes('"id"') && (r.includes('"name"') || r.includes('"state"')),
      'missing experiment details'
    );
  });

  await test('get_auth_status: current user', () => {
    const result = runClaude(
      'Use the get_auth_status tool with no params. Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('Email') || r.includes('email') || r.includes('Authenticated'),
      'missing auth/user data'
    );
  });

  // ════════════════════════════════════════════════
  // 5. execute_command — error handling
  // ════════════════════════════════════════════════
  console.log(`\n── execute_command: error handling ──`);

  await test('exec: unknown method → error', () => {
    const result = runClaude(
      'Use the execute_command tool with group="experiments", command="totallyFakeMethod" and params={}. Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('Unknown method') || r.includes('not found') || r.includes('discover_commands'),
      'missing error for unknown method'
    );
  });

  await test('exec: missing required param → error', () => {
    const result = runClaude(
      'Use the execute_command tool with group="experiments", command="getExperiment" and params={}. Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('Missing required') || r.includes('Error') || r.includes('required'),
      'missing error for missing required param'
    );
  });

  // ════════════════════════════════════════════════
  // 6. Experiment lifecycle via execute_command
  //    create → ready → dev → start → stop → archive
  // ════════════════════════════════════════════════
  console.log(`\n── execute_command: experiment lifecycle ──`);

  await test('lifecycle: create experiment → ready → dev → start → stop → archive', () => {
    const expName = `mcp_meta_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const result = runClaude(
`Do the following steps IN ORDER using ONLY the MCP tool execute_command (and get_auth_status). Do NOT use Read, Bash, or local tools.

CONFIRMATION RULE: The state-transition commands (startExperiment, stopExperiment, restartExperiment, developmentExperiment, fullOnExperiment, archiveExperiment) and createExperimentFromTemplate are flagged as "dangerous" in the MCP catalog and will return a confirmation prompt (no state change) when called without confirmed=true. The confirmed argument MUST be at the TOP LEVEL of the execute_command call, ALONGSIDE group/command/params — NOT inside params. Correct shape: execute_command({"group": "experiments", "command": "archiveExperiment", "params": {"experimentId": 123}, "confirmed": true}). For ALL calls to the dangerous commands listed above, ALWAYS include "confirmed": true at the top level. If a call returns a message like "Action cancelled", "not confirmed by user", or "show the user this preview", immediately retry the SAME call adding "confirmed": true at the top level.

STATE-READ RULE: state-change tools (updateExperiment, startExperiment, stopExperiment, restartExperiment, fullOnExperiment, developmentExperiment) acknowledge the request before the read replica catches up. Whenever a step asks you to read state — whether the wording is "Confirm state is X", "Note state (should be X)", or just "Note the state" — you MUST poll: call getExperiment, and if the returned \`state\` field does not match the expected value, immediately call getExperiment again (the network round-trip itself is enough of a wait). Retry up to 5 times. Record the LAST observed state — the one from the call where it either matched the expected value or you hit the retry limit.

1. Call the get_auth_status tool with no params. Note the authenticated user's email — call it OWNER_EMAIL.
2. Call execute_command with group="apps", command="listApps" and params={"items": 1}. Note the first application's name — call it APP_NAME.
3. Call execute_command with group="units", command="listUnits" and params={"items": 1}. Note the first unit type's name — call it UNIT_NAME.
4. Call execute_command with group="metrics", command="listMetrics" and params={"items": 1}. Note the first metric's name — call it METRIC_NAME.
5. Call execute_command with group="experiments", command="createExperimentFromTemplate" and params={"templateContent": "---\\nname: ${expName}\\ndisplay_name: \\"${expName}\\"\\ntype: test\\nstate: created\\npercentage_of_traffic: 100\\npercentages: 50/50\\nunit_type: <UNIT_NAME>\\napplication: <APP_NAME>\\nprimary_metric: <METRIC_NAME>\\nowners:\\n  - <OWNER_EMAIL>\\n---\\n\\n## Variants\\n\\n### variant_0\\n\\nname: control\\nconfig: {}\\n\\n---\\n\\n### variant_1\\n\\nname: treatment\\nconfig: {}\\n\\n---\\n\\n## Description\\n\\nmeta lifecycle integration test\\n"}. Substitute <OWNER_EMAIL>, <UNIT_NAME>, <APP_NAME>, <METRIC_NAME> in the templateContent string before sending. Note the returned experiment id.
6. Call execute_command with group="experiments", command="getExperiment" and params={"experimentId": <experiment id>}. Confirm state is "created".
7. Call execute_command with group="experiments", command="updateExperiment" and params={"experimentId": <experiment id>, "data": {"state": "ready"}}.
8. Call execute_command with group="experiments", command="getExperiment" and params={"experimentId": <experiment id>}. Confirm state is "ready".
9. Call execute_command with group="experiments", command="developmentExperiment" and params={"experimentId": <experiment id>, "note": "testing"}.
10. Call execute_command with group="experiments", command="getExperiment" and params={"experimentId": <experiment id>}. Confirm state is "development".
11. Call execute_command with group="experiments", command="startExperiment" and params={"experimentId": <experiment id>}.
12. Call execute_command with group="experiments", command="getExperiment" and params={"experimentId": <experiment id>}. Confirm state is "running".
13. Call execute_command with group="experiments", command="stopExperiment" and params={"experimentId": <experiment id>}.
14. Call execute_command with group="experiments", command="getExperiment" and params={"experimentId": <experiment id>}. Confirm state is "stopped".
15. Call execute_command with group="experiments", command="archiveExperiment" and params={"experimentId": <experiment id>}, confirmed=true.

After ALL steps, return ONLY a JSON object:
{"experiment_id": <number>, "states": ["created","ready","development","running","stopped","archived"]}

The "states" array should contain the actual state observed after each getExperiment call, plus "archived" for the final transition.`,
      { timeoutMs: 900_000 }
    );
    if (!result.ok) throw new Error(`claude failed: ${result.error}`);

    let parsed;
    try {
        parsed = extractJsonObject(result.output);
        if (!parsed) throw new Error('no JSON object found');
      } catch {
      throw new Error(`Failed to parse lifecycle result: ${result.output.substring(0, 500)}\n  --- tool calls ---\n${formatToolResults(result)}`);
    }

    if (!parsed.experiment_id) throw new Error(`No experiment_id in result\n  --- tool calls ---\n${formatToolResults(result)}`);
    if (!Array.isArray(parsed.states)) throw new Error('No states array in result');

    const expectedStates = ['running', 'stopped'];
    for (const state of expectedStates) {
      if (!parsed.states.includes(state)) {
        throw new Error(`Missing state "${state}" in lifecycle. Got: ${JSON.stringify(parsed.states)}\n  --- tool calls ---\n${formatToolResults(result)}`);
      }
    }

    console.log(`\n    experiment_id=${parsed.experiment_id} states=${JSON.stringify(parsed.states)}`);
    process.stdout.write('    ');
    return result;
  });

  // ════════════════════════════════════════════════
  // 7. Feature flag lifecycle via execute_command
  // ════════════════════════════════════════════════

  await test('lifecycle: create feature flag → ready → dev → start → stop → archive', () => {
    const flagName = `mcp_meta_flag_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const result = runClaude(
`Do the following steps IN ORDER using ONLY the MCP tools (execute_command and get_auth_status). Do NOT use Read, Bash, or local tools.

CONFIRMATION RULE: The state-transition commands (startExperiment, stopExperiment, restartExperiment, developmentExperiment, fullOnExperiment, archiveExperiment) and createExperimentFromTemplate are flagged as "dangerous" in the MCP catalog and will return a confirmation prompt (no state change) when called without confirmed=true. The confirmed argument MUST be at the TOP LEVEL of the execute_command call, ALONGSIDE group/command/params — NOT inside params. Correct shape: execute_command({"group": "experiments", "command": "archiveExperiment", "params": {"experimentId": 123}, "confirmed": true}). For ALL calls to the dangerous commands listed above, ALWAYS include "confirmed": true at the top level. If a call returns a message like "Action cancelled", "not confirmed by user", or "show the user this preview", immediately retry the SAME call adding "confirmed": true at the top level.

STATE-READ RULE: state-change tools (updateExperiment, startExperiment, stopExperiment, restartExperiment, fullOnExperiment, developmentExperiment) acknowledge the request before the read replica catches up. Whenever a step asks you to read state — whether the wording is "Confirm state is X", "Note state (should be X)", or just "Note the state" — you MUST poll: call getExperiment, and if the returned \`state\` field does not match the expected value, immediately call getExperiment again (the network round-trip itself is enough of a wait). Retry up to 5 times. Record the LAST observed state — the one from the call where it either matched the expected value or you hit the retry limit.

1. Call the get_auth_status tool with no params. Note the authenticated user's email — call it OWNER_EMAIL.
2. Call execute_command with group="apps", command="listApps" and params={"items": 1}. Note the first application's name — call it APP_NAME.
3. Call execute_command with group="units", command="listUnits" and params={"items": 1}. Note the first unit type's name — call it UNIT_NAME.
4. Call execute_command with group="metrics", command="listMetrics" and params={"items": 1}. Note the first metric's name — call it METRIC_NAME.
5. Call execute_command with group="experiments", command="createExperimentFromTemplate" and params={"templateContent": "---\\nname: ${flagName}\\ndisplay_name: \\"${flagName}\\"\\ntype: feature\\nstate: created\\npercentage_of_traffic: 100\\npercentages: 50/50\\nunit_type: <UNIT_NAME>\\napplication: <APP_NAME>\\nprimary_metric: <METRIC_NAME>\\nowners:\\n  - <OWNER_EMAIL>\\n---\\n\\n## Variants\\n\\n### variant_0\\n\\nname: off\\nconfig: {}\\n\\n---\\n\\n### variant_1\\n\\nname: on\\nconfig: {}\\n\\n---\\n\\n## Description\\n\\nmeta feature-flag lifecycle integration test\\n"}. Substitute the actual values for <OWNER_EMAIL>, <UNIT_NAME>, <APP_NAME>, <METRIC_NAME> in the templateContent string before sending. Note the returned experiment id.
6. Call execute_command with group="experiments", command="updateExperiment" and params={"experimentId": <experiment id>, "data": {"state": "ready"}}.
7. Call execute_command with group="experiments", command="getExperiment" and params={"experimentId": <experiment id>}. Confirm state is "ready".
8. Call execute_command with group="experiments", command="developmentExperiment" and params={"experimentId": <experiment id>, "note": "testing"}.
9. Call execute_command with group="experiments", command="getExperiment" and params={"experimentId": <experiment id>}. Note state.
10. Call execute_command with group="experiments", command="startExperiment" and params={"experimentId": <experiment id>}.
11. Call execute_command with group="experiments", command="getExperiment" and params={"experimentId": <experiment id>}. Confirm state is "running".
12. Call execute_command with group="experiments", command="stopExperiment" and params={"experimentId": <experiment id>}.
13. Call execute_command with group="experiments", command="archiveExperiment" and params={"experimentId": <experiment id>}, confirmed=true.

After ALL steps, return ONLY a JSON object:
{"experiment_id": <number>, "type": "feature", "states": ["created","ready","development","running","stopped","archived"]}`,
      { timeoutMs: 900_000 }
    );
    if (!result.ok) throw new Error(`claude failed: ${result.error}`);

    let parsed;
    try {
        parsed = extractJsonObject(result.output);
        if (!parsed) throw new Error('no JSON object found');
      } catch {
      throw new Error(`Failed to parse lifecycle result: ${result.output.substring(0, 500)}\n  --- tool calls ---\n${formatToolResults(result)}`);
    }

    if (!parsed.experiment_id) throw new Error(`No experiment_id in result\n  --- tool calls ---\n${formatToolResults(result)}`);
    if (!Array.isArray(parsed.states)) throw new Error('No states array in result');

    const expectedStates = ['running', 'stopped'];
    for (const state of expectedStates) {
      if (!parsed.states.includes(state)) {
        throw new Error(`Missing state "${state}" in lifecycle. Got: ${JSON.stringify(parsed.states)}\n  --- tool calls ---\n${formatToolResults(result)}`);
      }
    }

    console.log(`\n    experiment_id=${parsed.experiment_id} states=${JSON.stringify(parsed.states)}`);
    process.stdout.write('    ');
    return result;
  });

  // ════════════════════════════════════════════════
  // 8. Full-on + restart lifecycle
  // ════════════════════════════════════════════════

  await test('lifecycle: restart + full_on transitions', () => {
    const expName = `mcp_meta_fullon_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const result = runClaude(
`Do the following steps IN ORDER using ONLY the MCP tools (execute_command and get_auth_status). Do NOT use Read, Bash, or local tools.

CONFIRMATION RULE: The state-transition commands (startExperiment, stopExperiment, restartExperiment, developmentExperiment, fullOnExperiment, archiveExperiment) and createExperimentFromTemplate are flagged as "dangerous" in the MCP catalog and will return a confirmation prompt (no state change) when called without confirmed=true. The confirmed argument MUST be at the TOP LEVEL of the execute_command call, ALONGSIDE group/command/params — NOT inside params. Correct shape: execute_command({"group": "experiments", "command": "archiveExperiment", "params": {"experimentId": 123}, "confirmed": true}). For ALL calls to the dangerous commands listed above, ALWAYS include "confirmed": true at the top level. If a call returns a message like "Action cancelled", "not confirmed by user", or "show the user this preview", immediately retry the SAME call adding "confirmed": true at the top level.

STATE-READ RULE: state-change tools (updateExperiment, startExperiment, stopExperiment, restartExperiment, fullOnExperiment, developmentExperiment) acknowledge the request before the read replica catches up. Whenever a step asks you to read state — whether the wording is "Confirm state is X", "Note state (should be X)", or just "Note the state" — you MUST poll: call getExperiment, and if the returned \`state\` field does not match the expected value, immediately call getExperiment again (the network round-trip itself is enough of a wait). Retry up to 5 times. Record (and report in the final JSON) the LAST observed state — the one from the call where it either matched the expected value or you hit the retry limit. This is REQUIRED for the named state fields (\`restarted_state\`, \`full_on_state\`, etc.) in the final JSON summary too — never report a state from a single un-polled read.

1. Call the get_auth_status tool with no params. Note the authenticated user's email — call it OWNER_EMAIL.
2. Call execute_command with group="apps", command="listApps" and params={"items": 1}. Note the first application's name — call it APP_NAME.
3. Call execute_command with group="units", command="listUnits" and params={"items": 1}. Note the first unit type's name — call it UNIT_NAME.
4. Call execute_command with group="metrics", command="listMetrics" and params={"items": 1}. Note the first metric's name — call it METRIC_NAME.
5. Call execute_command with group="experiments", command="createExperimentFromTemplate" and params={"templateContent": "---\\nname: ${expName}\\ndisplay_name: \\"${expName}\\"\\ntype: test\\nstate: created\\npercentage_of_traffic: 100\\npercentages: 50/50\\nunit_type: <UNIT_NAME>\\napplication: <APP_NAME>\\nprimary_metric: <METRIC_NAME>\\nowners:\\n  - <OWNER_EMAIL>\\n---\\n\\n## Variants\\n\\n### variant_0\\n\\nname: control\\nconfig: {}\\n\\n---\\n\\n### variant_1\\n\\nname: treatment\\nconfig: {}\\n\\n---\\n\\n## Description\\n\\nmeta restart + full_on integration test\\n"}. Substitute the actual values for <OWNER_EMAIL>, <UNIT_NAME>, <APP_NAME>, <METRIC_NAME> in the templateContent string before sending. Note the returned experiment id.
6. Call execute_command with group="experiments", command="updateExperiment" and params={"experimentId": <experiment id>, "data": {"state": "ready"}}.
7. Call execute_command with group="experiments", command="startExperiment" and params={"experimentId": <experiment id>}.
8. Call execute_command with group="experiments", command="stopExperiment" and params={"experimentId": <experiment id>}.
9. Call execute_command with group="experiments", command="restartExperiment" and params={"experimentId": <experiment id>}. IMPORTANT: The response contains a NEW experiment object with a new id. Use that new id for all subsequent steps.
10. Apply the STATE-READ RULE: poll getExperiment with params={"experimentId": <new_experiment_id>} until \`state\` is "running" (up to 5 retries). Save the final observed state as RESTARTED_STATE.
11. Call execute_command with group="experiments", command="fullOnExperiment" and params={"experimentId": <new_experiment_id>, "variant": 1, "note": "testing full on"}.
12. Apply the STATE-READ RULE: poll getExperiment with params={"experimentId": <new_experiment_id>} until \`state\` is "full_on" (up to 5 retries). Save the final observed state as FULL_ON_STATE.
13. Call execute_command with group="experiments", command="stopExperiment" and params={"experimentId": <new_experiment_id>}.
14. Call execute_command with group="experiments", command="archiveExperiment" and params={"experimentId": <new_experiment_id>}, confirmed=true.

After ALL steps, return ONLY a JSON object:
{"experiment_id": <number>, "restarted_state": "<RESTARTED_STATE from step 10>", "full_on_state": "<FULL_ON_STATE from step 12>"}`,
      { timeoutMs: 900_000 }
    );
    if (!result.ok) throw new Error(`claude failed: ${result.error}`);

    let parsed;
    try {
        parsed = extractJsonObject(result.output);
        if (!parsed) throw new Error('no JSON object found');
      } catch {
      throw new Error(`Failed to parse result: ${result.output.substring(0, 500)}\n  --- tool calls ---\n${formatToolResults(result)}`);
    }

    if (!parsed.experiment_id) throw new Error(`No experiment_id\n  --- tool calls ---\n${formatToolResults(result)}`);
    if (parsed.restarted_state !== 'running') throw new Error(`Expected restarted_state="running", got "${parsed.restarted_state}"\n  --- tool calls ---\n${formatToolResults(result)}`);
    if (parsed.full_on_state !== 'full_on') throw new Error(`Expected full_on_state="full_on", got "${parsed.full_on_state}"\n  --- tool calls ---\n${formatToolResults(result)}`);

    console.log(`\n    experiment_id=${parsed.experiment_id} restart→${parsed.restarted_state} full_on→${parsed.full_on_state}`);
    process.stdout.write('    ');
    return result;
  });

  // ════════════════════════════════════════════════
  // 9. End-to-end: discover → docs → execute
  // ════════════════════════════════════════════════
  console.log(`\n── end-to-end workflow ──`);

  await test('e2e: discover → docs → execute workflow', () => {
    const result = runClaude(
      `Do the following steps IN ORDER:
1. Use discover_commands with group="teams" to find team-related methods.
2. Use get_command_docs with group="teams", command="listTeams" to get its documentation.
3. Use execute_command with group="teams", command="listTeams" and params={} to list teams.

After ALL steps, return ONLY a JSON object: {"categories_found": true, "docs_found": true, "teams_count": <number of teams returned>}`,
      {}
    );
    if (!result.ok) throw new Error(`claude failed: ${result.error}`);

    let parsed;
    try {
        parsed = extractJsonObject(result.output);
        if (!parsed) throw new Error('no JSON object found');
      } catch {
      throw new Error(`Failed to parse e2e result: ${result.output.substring(0, 500)}`);
    }

    if (!parsed.categories_found) throw new Error('categories_found is false');
    if (!parsed.docs_found) throw new Error('docs_found is false');
    if (typeof parsed.teams_count !== 'number' || parsed.teams_count < 0) {
      throw new Error(`Invalid teams_count: ${parsed.teams_count}`);
    }

    return result;
  });

  // ════════════════════════════════════════════════
  // 10. Tool schema verification
  // ════════════════════════════════════════════════
  console.log(`\n── schema verification ──`);

  await test('only 3 meta-tools registered (no individual entity tools)', () => {
    const result = runClaude(
      'List all available MCP tools. Return ONLY a comma-separated list of tool names, nothing else.'
    );
    if (!result.ok) throw new Error(`claude failed: ${result.error}`);

    const expectedTools = ['discover_commands', 'get_command_docs', 'execute_command'];
    for (const tool of expectedTools) {
      const found = result.output.includes(tool) ||
        result.toolSchemas.some(t => typeof t === 'string' ? t.includes(tool) : (t.name || '').includes(tool));
      if (!found) {
        throw new Error(`Meta-tool "${tool}" not found in tool list`);
      }
    }
    return result;
  });

  // ════════════════════════════════════════════════
  // Summary
  // ════════════════════════════════════════════════
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
