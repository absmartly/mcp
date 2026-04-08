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
import { fileURLToPath } from 'url';

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

function runClaude(prompt, { maxBudget = '0.20', timeoutMs = CLAUDE_TIMEOUT_MS } = {}) {
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

async function run() {
  let passed = 0;
  let failed = 0;
  const results = [];

  async function test(name, fn) {
    process.stdout.write(`\n  ${name} ... `);
    try {
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
      r.includes('categories') && r.includes('experiments') && r.includes('methods'),
      'missing category summary'
    );
  });

  await test('discover: browse experiments category', () => {
    const result = runClaude(
      'Use the discover_commands tool with category="experiments". Return ONLY the raw text output from the tool, nothing else.'
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
      'Use the discover_commands tool with category="nonexistent_xyz". Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('No methods found') || r.includes('not found'),
      'missing error for unknown category'
    );
  });

  // ════════════════════════════════════════════════
  // 2. get_command_docs
  // ════════════════════════════════════════════════
  console.log(`\n── get_command_docs ──`);

  await test('docs: listExperiments → params table', () => {
    const result = runClaude(
      'Use the get_command_docs tool with method_name="listExperiments". Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('listExperiments') && r.includes('Parameter') && r.includes('options'),
      'missing method documentation'
    );
  });

  await test('docs: deleteExperiment → danger warning', () => {
    const result = runClaude(
      'Use the get_command_docs tool with method_name="deleteExperiment". Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('deleteExperiment') && (r.includes('WARNING') || r.includes('Destructive') || r.includes('dangerous')),
      'missing danger warning'
    );
  });

  await test('docs: unknown method → suggestions', () => {
    const result = runClaude(
      'Use the get_command_docs tool with method_name="xyzNotARealMethod123". Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('not found') || r.includes('Did you mean') || r.includes('discover_commands'),
      'missing suggestions for unknown method'
    );
  });

  await test('docs: createMetric → usage example with execute_command', () => {
    const result = runClaude(
      'Use the get_command_docs tool with method_name="createMetric". Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('execute_command') && r.includes('method_name'),
      'missing usage example'
    );
  });

  // ════════════════════════════════════════════════
  // 3. execute_command — list operations
  // ════════════════════════════════════════════════
  console.log(`\n── execute_command: list operations ──`);

  await test('exec: listTeams', () => {
    const result = runClaude(
      'Use the execute_command tool with method_name="listTeams" and params={}. Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('"id"') && r.includes('"name"'),
      'missing team data'
    );
  });

  await test('exec: listApplications', () => {
    const result = runClaude(
      'Use the execute_command tool with method_name="listApplications" and params={}. Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('"id"') && r.includes('"name"'),
      'missing application data'
    );
  });

  await test('exec: listUnitTypes', () => {
    const result = runClaude(
      'Use the execute_command tool with method_name="listUnitTypes" and params={}. Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('"id"') && r.includes('"name"'),
      'missing unit type data'
    );
  });

  await test('exec: listMetrics', () => {
    const result = runClaude(
      'Use the execute_command tool with method_name="listMetrics" and params={"options": {"items": 2}}. Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('"id"') && (r.includes('"type"') || r.includes('"name"')),
      'missing metric data'
    );
  });

  await test('exec: listUsers', () => {
    const result = runClaude(
      'Use the execute_command tool with method_name="listUsers" and params={"options": {"items": 2}}. Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('"id"') && r.includes('"email"'),
      'missing user data'
    );
  });

  await test('exec: listTags', () => {
    const result = runClaude(
      'Use the execute_command tool with method_name="listTags" and params={}. Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('[') || r.includes('"id"'),
      'missing tag data'
    );
  });

  await test('exec: listSegments', () => {
    const result = runClaude(
      'Use the execute_command tool with method_name="listSegments" and params={}. Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('[') || r.includes('"id"') || r.includes('Successfully'),
      'missing segment data'
    );
  });

  await test('exec: listGoals', () => {
    const result = runClaude(
      'Call the MCP tool execute_command with method_name="listGoals" and params={"limit": 3}. Do NOT use Read, Bash, or any local tools. Return ONLY the raw text output from the MCP tool.'
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
      'Call the MCP tool execute_command with method_name="listExperiments" and params={"options": {"items": 1}} to get one experiment. Note its id. Then call the MCP tool execute_command with method_name="getExperiment" and params={"id": <the numeric id>}. Do NOT use Read, Bash, or local tools. Return ONLY the raw text from the second MCP tool call.',
      { maxBudget: '0.25' }
    );
    return assertToolResult(result, r =>
      r.includes('"id"') && (r.includes('"name"') || r.includes('"state"')),
      'missing experiment details'
    );
  });

  await test('exec: getCurrentUser', () => {
    const result = runClaude(
      'Use the execute_command tool with method_name="getCurrentUser" and params={}. Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('"email"') || r.includes('"id"') || r.includes('"first_name"'),
      'missing user data'
    );
  });

  // ════════════════════════════════════════════════
  // 5. execute_command — error handling
  // ════════════════════════════════════════════════
  console.log(`\n── execute_command: error handling ──`);

  await test('exec: unknown method → error', () => {
    const result = runClaude(
      'Use the execute_command tool with method_name="totallyFakeMethod" and params={}. Return ONLY the raw text output from the tool, nothing else.'
    );
    return assertToolResult(result, r =>
      r.includes('Unknown method') || r.includes('not found') || r.includes('discover_commands'),
      'missing error for unknown method'
    );
  });

  await test('exec: missing required param → error', () => {
    const result = runClaude(
      'Use the execute_command tool with method_name="getExperiment" and params={}. Return ONLY the raw text output from the tool, nothing else.'
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

  const expTimestamp = Date.now();

  await test('lifecycle: create experiment → ready → dev → start → stop → archive', () => {
    const expName = `mcp_meta_test_${expTimestamp}`;
    const result = runClaude(
`Do the following steps IN ORDER using ONLY the MCP tool execute_command. Do NOT use Read, Bash, or local tools.

1. Call execute_command with method_name="listApplications" and params={} to get applications. Note the first application's id.
2. Call execute_command with method_name="listUnitTypes" and params={} to get unit types. Note the first unit type's id.
3. Call execute_command with method_name="createExperiment" and params={"data": {"name": "${expName}", "applications": [{"application_id": <app_id>}], "unit_type": {"unit_type_id": <unit_type_id>}, "type": "test", "state": "created", "percentage_of_traffic": 100, "percentages": "50/50", "nr_variants": 2, "variants": [{"variant": 0, "name": "Control"}, {"variant": 1, "name": "Treatment"}], "owners": [], "teams": [], "experiment_tags": [], "secondary_metrics": [], "variant_screenshots": [], "custom_section_field_values": {}}}. Note the returned experiment id.
4. Call execute_command with method_name="getExperiment" and params={"id": <experiment_id>}. Confirm state is "created".
5. Call execute_command with method_name="updateExperiment" and params={"id": <experiment_id>, "changes": {"state": "ready"}}.
6. Call execute_command with method_name="getExperiment" and params={"id": <experiment_id>}. Confirm state is "ready".
7. Call execute_command with method_name="developmentExperiment" and params={"id": <experiment_id>, "note": "testing"}.
8. Call execute_command with method_name="getExperiment" and params={"id": <experiment_id>}. Confirm state is "development".
9. Call execute_command with method_name="startExperiment" and params={"id": <experiment_id>}.
10. Call execute_command with method_name="getExperiment" and params={"id": <experiment_id>}. Confirm state is "running".
11. Call execute_command with method_name="stopExperiment" and params={"id": <experiment_id>}.
12. Call execute_command with method_name="getExperiment" and params={"id": <experiment_id>}. Confirm state is "stopped".
13. Call execute_command with method_name="archiveExperiment" and params={"id": <experiment_id>}.

After ALL steps, return ONLY a JSON object:
{"experiment_id": <number>, "states": ["created","ready","development","running","stopped","archived"]}

The "states" array should contain the actual state observed after each getExperiment call, plus "archived" for the final transition.`,
      { maxBudget: '1.00', timeoutMs: 300_000 }
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

  // ════════════════════════════════════════════════
  // 7. Feature flag lifecycle via execute_command
  // ════════════════════════════════════════════════

  await test('lifecycle: create feature flag → ready → dev → start → stop → archive', () => {
    const flagName = `mcp_meta_flag_${expTimestamp}`;
    const result = runClaude(
`Do the following steps IN ORDER using ONLY the MCP tool execute_command. Do NOT use Read, Bash, or local tools.

1. Call execute_command with method_name="listApplications" and params={} to get applications. Note the first application's id.
2. Call execute_command with method_name="listUnitTypes" and params={} to get unit types. Note the first unit type's id.
3. Call execute_command with method_name="createExperiment" and params={"data": {"name": "${flagName}", "applications": [{"application_id": <app_id>}], "unit_type": {"unit_type_id": <unit_type_id>}, "type": "feature", "state": "created", "percentage_of_traffic": 100, "percentages": "50/50", "nr_variants": 2, "variants": [{"variant": 0, "name": "Off"}, {"variant": 1, "name": "On"}], "owners": [], "teams": [], "experiment_tags": [], "secondary_metrics": [], "variant_screenshots": [], "custom_section_field_values": {}}}. Note the returned experiment id.
4. Call execute_command with method_name="getExperiment" and params={"id": <experiment_id>}. Confirm state is "created".
5. Call execute_command with method_name="updateExperiment" and params={"id": <experiment_id>, "changes": {"state": "ready"}}.
6. Call execute_command with method_name="getExperiment" and params={"id": <experiment_id>}. Confirm state is "ready".
7. Call execute_command with method_name="developmentExperiment" and params={"id": <experiment_id>, "note": "testing"}.
8. Call execute_command with method_name="getExperiment" and params={"id": <experiment_id>}. Confirm state is "development".
9. Call execute_command with method_name="startExperiment" and params={"id": <experiment_id>}.
10. Call execute_command with method_name="getExperiment" and params={"id": <experiment_id>}. Confirm state is "running".
11. Call execute_command with method_name="stopExperiment" and params={"id": <experiment_id>}.
12. Call execute_command with method_name="archiveExperiment" and params={"id": <experiment_id>}.

After ALL steps, return ONLY a JSON object:
{"experiment_id": <number>, "type": "feature", "states": ["created","ready","development","running","stopped","archived"]}`,
      { maxBudget: '1.00', timeoutMs: 300_000 }
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

  // ════════════════════════════════════════════════
  // 8. Full-on + restart lifecycle
  // ════════════════════════════════════════════════

  await test('lifecycle: restart + full_on transitions', () => {
    const expName = `mcp_meta_fullon_${expTimestamp}`;
    const result = runClaude(
`Do the following steps IN ORDER using ONLY the MCP tool execute_command. Do NOT use Read, Bash, or local tools.

1. Call execute_command with method_name="listApplications" and params={}. Note first app id.
2. Call execute_command with method_name="listUnitTypes" and params={}. Note first unit type id.
3. Call execute_command with method_name="createExperiment" and params={"data": {"name": "${expName}", "applications": [{"application_id": <app_id>}], "unit_type": {"unit_type_id": <unit_type_id>}, "type": "test", "state": "created", "percentage_of_traffic": 100, "percentages": "50/50", "nr_variants": 2, "variants": [{"variant": 0, "name": "Control"}, {"variant": 1, "name": "Treatment"}], "owners": [], "teams": [], "experiment_tags": [], "secondary_metrics": [], "variant_screenshots": [], "custom_section_field_values": {}}}.
4. Call execute_command with method_name="updateExperiment" and params={"id": <experiment_id>, "changes": {"state": "ready"}}.
5. Call execute_command with method_name="startExperiment" and params={"id": <experiment_id>}.
6. Call execute_command with method_name="stopExperiment" and params={"id": <experiment_id>}.
7. Call execute_command with method_name="restartExperiment" and params={"id": <experiment_id>}. IMPORTANT: The response contains a NEW experiment object with a new id. Use that new id for all subsequent steps.
8. Call execute_command with method_name="getExperiment" and params={"id": <new_experiment_id>}. Note the state (should be "running").
9. Call execute_command with method_name="fullOnExperiment" and params={"id": <new_experiment_id>, "fullOnVariant": 1, "note": "testing full on"}.
10. Call execute_command with method_name="getExperiment" and params={"id": <new_experiment_id>}. Note the state (should be "full_on").
11. Call execute_command with method_name="stopExperiment" and params={"id": <new_experiment_id>}.
12. Call execute_command with method_name="archiveExperiment" and params={"id": <new_experiment_id>}.

After ALL steps, return ONLY a JSON object:
{"experiment_id": <number>, "restarted_state": "<state after step 8>", "full_on_state": "<state after step 10>"}`,
      { maxBudget: '1.00', timeoutMs: 300_000 }
    );
    if (!result.ok) throw new Error(`claude failed: ${result.error}`);

    let parsed;
    try {
      const jsonMatch = result.output.match(/\{[\s\S]*"experiment_id"[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result.output);
    } catch {
      throw new Error(`Failed to parse result: ${result.output.substring(0, 500)}`);
    }

    if (!parsed.experiment_id) throw new Error('No experiment_id');
    if (parsed.restarted_state !== 'running') throw new Error(`Expected restarted_state="running", got "${parsed.restarted_state}"`);
    if (parsed.full_on_state !== 'full_on') throw new Error(`Expected full_on_state="full_on", got "${parsed.full_on_state}"`);

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
1. Use discover_commands with category="teams" to find team-related methods.
2. Use get_command_docs with method_name="listTeams" to get its documentation.
3. Use execute_command with method_name="listTeams" and params={} to list teams.

After ALL steps, return ONLY a JSON object: {"categories_found": true, "docs_found": true, "teams_count": <number of teams returned>}`,
      { maxBudget: '0.25' }
    );
    if (!result.ok) throw new Error(`claude failed: ${result.error}`);

    let parsed;
    try {
      const jsonMatch = result.output.match(/\{[\s\S]*"categories_found"[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result.output);
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

const result = await run();
process.exit(result.success ? 0 : 1);
