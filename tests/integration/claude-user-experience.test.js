#!/usr/bin/env node
/**
 * Natural language integration tests — simulates a real user talking to Claude
 * with the ABsmartly MCP server loaded.
 *
 * These tests use conversational prompts (not tool-specific instructions) to
 * validate the full chain: user prompt → Claude discovers methods → calls
 * execute_api_method → returns useful response.
 *
 * Credentials come from the ABsmartly CLI test-1 profile:
 *   - Endpoint: ~/.config/absmartly/config.yaml
 *   - API key:  macOS keychain (service: absmartly-cli, account: api-key-test-1)
 *
 * Usage:
 *   node tests/integration/claude-user-experience.test.js [--show-responses] [--live]
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
const LIFECYCLE_TIMEOUT_MS = 300_000;

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

function runClaude(prompt, { timeoutMs = CLAUDE_TIMEOUT_MS } = {}) {
  const args = [
    '-p', prompt,
    '--mcp-config', MCP_CONFIG_PATH,
    '--strict-mcp-config',
    '--permission-mode', 'bypassPermissions',
    '--no-session-persistence',
    '--model', 'sonnet',
    '--output-format', 'stream-json',
    '--verbose',
    '--tools', ''
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
    const parsed = stdout ? parseStreamJson(stdout) : { output: '', toolResults: [], toolCalls: [] };
    return { ok: false, ...parsed, error: stderr || error.message };
  }
}

function parseStreamJson(raw) {
  const lines = raw.split('\n').filter(Boolean);
  const toolResults = [];
  const toolCalls = [];
  let output = '';

  for (const line of lines) {
    try {
      const msg = JSON.parse(line);

      if (msg.type === 'result') {
        output = msg.result || '';
      }

      if (msg.type === 'assistant' && msg.message?.content) {
        for (const part of msg.message.content) {
          if (part.type === 'tool_use') {
            toolCalls.push({ tool: part.name, input: part.input });
          }
        }
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
    } catch {}
  }

  return { ok: true, output: output.trim(), toolResults, toolCalls };
}

function extractExperimentId(result) {
  const output = result.output || '';

  const outputPatterns = [
    /\b(?:experiment\s+)?ID[:\s]*(\d+)/i,
    /\bID[:\s]*\**(\d+)\**/i,
    /\bcreated\b.*?\b(\d{2,})\b/i,
    /\b(\d{2,})\b.*?\bcreated\b/i,
  ];
  for (const pat of outputPatterns) {
    const m = output.match(pat);
    if (m) return parseInt(m[1], 10);
  }

  const lastToolResult = result.toolResults[result.toolResults.length - 1] || '';
  const createMatch = lastToolResult.match(/"id"\s*:\s*(\d+)/);
  if (createMatch) return parseInt(createMatch[1], 10);

  const allToolText = result.toolResults.join('\n');
  const expNameMatch = allToolText.match(/"name"\s*:\s*"(?:ux_test|mcp_meta)[^"]*"[\s\S]{0,200}?"id"\s*:\s*(\d+)/) ||
                       allToolText.match(/"id"\s*:\s*(\d+)[\s\S]{0,200}?"name"\s*:\s*"(?:ux_test|mcp_meta)[^"]*"/);
  if (expNameMatch) return parseInt(expNameMatch[1], 10);

  return null;
}

function assertOutput(result, check, label) {
  if (!result.ok) throw new Error(`claude failed: ${result.error}`);

  const allText = [result.output, ...result.toolResults].join('\n');
  if (check(allText)) return result;

  throw new Error(`${label}\n    Output: ${result.output.substring(0, 500)}`);
}

function assertUsedMcpTool(result, label) {
  if (!result.ok) throw new Error(`claude failed: ${result.error}`);

  const mcpTools = result.toolCalls.filter(c =>
    c.tool.includes('discover_api_methods') ||
    c.tool.includes('get_api_method_docs') ||
    c.tool.includes('execute_api_method') ||
    c.tool.includes('get_auth_status')
  );

  if (mcpTools.length === 0) {
    throw new Error(`${label}: Claude did not use any MCP meta-tools. Tools used: ${result.toolCalls.map(c => c.tool).join(', ') || 'none'}`);
  }

  return mcpTools;
}

async function run() {
  let passed = 0;
  let failed = 0;
  const results = [];
  const state = {};

  async function test(name, fn) {
    process.stdout.write(`\n  ${name} ... `);
    try {
      const result = await fn();
      passed++;
      results.push({ name, status: 'PASS' });
      console.log('PASS');
      if (SHOW_RESPONSES && result && result.output) {
        console.log(`    -- response --`);
        const lines = result.output.substring(0, 1500).split('\n');
        for (const line of lines) {
          console.log(`    ${line}`);
        }
        if (result.output.length > 1500) console.log(`    ... (${result.output.length} chars total)`);
        console.log(`    -------------`);
      }
    } catch (err) {
      failed++;
      results.push({ name, status: 'FAIL', error: err.message });
      console.log('FAIL');
      console.log(`    ${err.message.split('\n').join('\n    ')}`);
    }
  }

  writeMcpConfig();

  console.log(`\nABsmartly MCP — Natural Language User Experience Tests`);
  console.log(`${'='.repeat(55)}`);
  console.log(`Mode:         ${LIVE_MODE ? 'LIVE (mcp.absmartly.com)' : 'LOCAL (wrangler dev)'}`);
  console.log(`MCP URL:      ${MCP_URL}`);
  console.log(`API endpoint: ${API_ENDPOINT}`);

  // ════════════════════════════════════════════════
  // 1. Discovery — "What can you do?"
  // ════════════════════════════════════════════════
  console.log(`\n-- Discovery --`);

  await test('user asks what operations are available', () => {
    const result = runClaude(
      'Using the ABsmartly API, what operations can you help me with? Give me a high-level summary of the categories.',
    );
    assertUsedMcpTool(result, 'should use discover_api_methods');
    return assertOutput(result, t =>
      t.toLowerCase().includes('experiment') && t.toLowerCase().includes('metric'),
      'response should mention experiments and metrics'
    );
  });

  await test('user asks how to create an experiment', () => {
    const result = runClaude(
      'How do I create a new experiment? What parameters do I need?'
    );
    assertUsedMcpTool(result, 'should use get_api_method_docs');
    return assertOutput(result, t =>
      t.toLowerCase().includes('createexperiment') || t.toLowerCase().includes('create') && t.toLowerCase().includes('name'),
      'response should explain createExperiment'
    );
  });

  await test('user searches for archiving capabilities', () => {
    const result = runClaude(
      'Can I archive things in ABsmartly? What can be archived?'
    );
    assertUsedMcpTool(result, 'should use discover_api_methods');
    return assertOutput(result, t =>
      t.toLowerCase().includes('archive'),
      'response should mention archive methods'
    );
  });

  // ════════════════════════════════════════════════
  // 2. Browsing — "Show me what exists"
  // ════════════════════════════════════════════════
  console.log(`\n-- Browsing --`);

  await test('user asks to see their teams', () => {
    const result = runClaude(
      'Show me all the teams we have in ABsmartly.'
    );
    assertUsedMcpTool(result, 'should use execute_api_method');
    return assertOutput(result, t =>
      t.includes('id') && t.toLowerCase().includes('name'),
      'response should list teams with ids and names'
    );
  });

  await test('user asks about available applications', () => {
    const result = runClaude(
      'What applications are configured in our ABsmartly instance?'
    );
    const tools = assertUsedMcpTool(result, 'should use execute_api_method');
    const execCalls = tools.filter(t => t.tool.includes('execute_api_method'));
    if (execCalls.length > 0) {
      const input = execCalls[0].input;
      if (input.method_name && !input.method_name.toLowerCase().includes('application')) {
        throw new Error(`Expected listApplications, got ${input.method_name}`);
      }
    }
    return assertOutput(result, t =>
      t.includes('id'),
      'response should list applications'
    );
  });

  await test('user asks to list metrics', () => {
    const result = runClaude(
      'What metrics do we have? Show me the first few.'
    );
    assertUsedMcpTool(result, 'should use execute_api_method');
    return assertOutput(result, t =>
      t.includes('id'),
      'response should list metrics'
    );
  });

  await test('user asks about unit types', () => {
    const result = runClaude(
      'What unit types are available for experiments?'
    );
    assertUsedMcpTool(result, 'should use execute_api_method');
    return assertOutput(result, t =>
      t.includes('id'),
      'response should list unit types'
    );
  });

  await test('user asks who they are logged in as', () => {
    const result = runClaude(
      'Who am I logged in as in ABsmartly? What is my user info?'
    );
    assertUsedMcpTool(result, 'should use MCP tools');
    return assertOutput(result, t =>
      t.toLowerCase().includes('email') || t.toLowerCase().includes('name') || t.toLowerCase().includes('authenticated'),
      'response should show user identity'
    );
  });

  await test('user asks to list experiments', () => {
    const result = runClaude(
      'Using the ABsmartly API, get experiment with ID 1. Tell me its name and state.',
    );
    assertUsedMcpTool(result, 'should use execute_api_method');
    return assertOutput(result, t =>
      t.toLowerCase().includes('name') || t.toLowerCase().includes('state') || t.includes('"id"'),
      'response should show experiment info'
    );
  });

  await test('user asks about running experiments', () => {
    const result = runClaude(
      'Are there any experiments currently running?'
    );
    assertUsedMcpTool(result, 'should use execute_api_method');
    return result;
  });

  // ════════════════════════════════════════════════
  // 3. Experiment lifecycle — natural language
  // ════════════════════════════════════════════════
  console.log(`\n-- Experiment Lifecycle --`);

  const ts = Date.now();

  await test('user creates an experiment with natural language', () => {
    state.expName = `ux_test_homepage_cta_${ts}`;
    const result = runClaude(
      `Create a new experiment called "${state.expName}" with type "test". Use the first application and first unit type available. It should have two variants: "Control" and "Blue Button". Set traffic to 100%. Leave it in "created" state.

After creating it, tell me the experiment ID and its current state.`,
      { timeoutMs: LIFECYCLE_TIMEOUT_MS }
    );
    assertUsedMcpTool(result, 'should use execute_api_method');

    state.expId = extractExperimentId(result);
    if (!state.expId) throw new Error(`Could not find experiment ID in response: ${result.output.substring(0, 300)}`);
    console.log(`\n    experiment_id=${state.expId}`);
    process.stdout.write('    ');

    return assertOutput(result, t =>
      t.toLowerCase().includes('created') || t.toLowerCase().includes('success') || t.includes('"id"'),
      'response should confirm experiment was created'
    );
  });

  await test('user asks to see the experiment they just created', () => {
    if (!state.expId) throw new Error('No experiment ID from previous test');
    const result = runClaude(
      `Show me the details of experiment ${state.expId}. What state is it in?`
    );
    assertUsedMcpTool(result, 'should use execute_api_method');
    return assertOutput(result, t =>
      t.includes(String(state.expId)) && (t.toLowerCase().includes('created') || t.toLowerCase().includes('state')),
      'response should show experiment details with state'
    );
  });

  await test('user moves experiment to ready', () => {
    if (!state.expId) throw new Error('No experiment ID from previous test');
    const result = runClaude(
      `Move experiment ${state.expId} to the "ready" state. Then confirm what state it's in now.`,
    );
    assertUsedMcpTool(result, 'should use execute_api_method');
    return assertOutput(result, t =>
      t.toLowerCase().includes('ready'),
      'response should confirm ready state'
    );
  });

  await test('user puts experiment in development mode', () => {
    if (!state.expId) throw new Error('No experiment ID from previous test');
    const result = runClaude(
      `Put experiment ${state.expId} into development mode. Add a note saying "testing in dev".`,
    );
    assertUsedMcpTool(result, 'should use execute_api_method');
    return assertOutput(result, t =>
      t.toLowerCase().includes('development') || t.toLowerCase().includes('dev'),
      'response should confirm development state'
    );
  });

  await test('user starts the experiment', () => {
    if (!state.expId) throw new Error('No experiment ID from previous test');
    const result = runClaude(
      `Start experiment ${state.expId}. Is it running now?`,
    );
    assertUsedMcpTool(result, 'should use execute_api_method');
    return assertOutput(result, t =>
      t.toLowerCase().includes('running') || t.toLowerCase().includes('started'),
      'response should confirm running state'
    );
  });

  await test('user stops the experiment', () => {
    if (!state.expId) throw new Error('No experiment ID from previous test');
    const result = runClaude(
      `Stop experiment ${state.expId}. What's the state now?`,
    );
    assertUsedMcpTool(result, 'should use execute_api_method');
    return assertOutput(result, t =>
      t.toLowerCase().includes('stopped') || t.toLowerCase().includes('stop'),
      'response should confirm stopped state'
    );
  });

  await test('user archives the experiment', () => {
    if (!state.expId) throw new Error('No experiment ID from previous test');
    const result = runClaude(
      `Archive experiment ${state.expId}. Confirm it's archived.`,
    );
    assertUsedMcpTool(result, 'should use execute_api_method');
    return assertOutput(result, t =>
      t.toLowerCase().includes('archived') || t.toLowerCase().includes('archive'),
      'response should confirm archived'
    );
  });

  // ════════════════════════════════════════════════
  // 4. Feature flag lifecycle — natural language
  // ════════════════════════════════════════════════
  console.log(`\n-- Feature Flag Lifecycle --`);

  await test('user creates a feature flag', () => {
    state.flagName = `ux_test_dark_mode_${ts}`;
    const result = runClaude(
      `Create a feature flag called "${state.flagName}". Use the first application and first unit type. It should have an "Off" variant and an "On" variant with 50/50 split. Leave it in "created" state.

Tell me the experiment ID.`,
      { timeoutMs: LIFECYCLE_TIMEOUT_MS }
    );
    assertUsedMcpTool(result, 'should use execute_api_method');

    state.flagId = extractExperimentId(result);
    if (!state.flagId) throw new Error(`Could not find feature flag ID in response: ${result.output.substring(0, 300)}`);
    console.log(`\n    flag_id=${state.flagId}`);
    process.stdout.write('    ');

    return assertOutput(result, t =>
      t.toLowerCase().includes('created') || t.toLowerCase().includes('success') || t.includes('"id"'),
      'response should confirm feature flag was created'
    );
  });

  await test('user moves feature flag through lifecycle to running', () => {
    if (!state.flagId) throw new Error('No flag ID from previous test');
    const result = runClaude(
      `Take feature flag ${state.flagId} through these states in order: ready, then development (note: "testing"), then start it. Tell me the final state.`,
      { timeoutMs: LIFECYCLE_TIMEOUT_MS }
    );
    assertUsedMcpTool(result, 'should use execute_api_method');
    return assertOutput(result, t =>
      t.toLowerCase().includes('running') || t.toLowerCase().includes('started'),
      'response should confirm running state'
    );
  });

  await test('user stops and archives the feature flag', () => {
    if (!state.flagId) throw new Error('No flag ID from previous test');
    const result = runClaude(
      `Stop feature flag ${state.flagId} and then archive it.`,
      { timeoutMs: LIFECYCLE_TIMEOUT_MS }
    );
    assertUsedMcpTool(result, 'should use execute_api_method');
    return assertOutput(result, t =>
      t.toLowerCase().includes('archived') || t.toLowerCase().includes('stopped'),
      'response should confirm stopped/archived'
    );
  });

  // ════════════════════════════════════════════════
  // 5. Advanced operations — restart & full-on
  // ════════════════════════════════════════════════
  console.log(`\n-- Advanced Operations --`);

  await test('user creates and runs an experiment for restart test', () => {
    state.advName = `ux_test_fullon_${ts}`;
    const result = runClaude(
      `Create an experiment called "${state.advName}" with type "test", first available application and unit type, Control and Treatment variants, 50/50 split, in "created" state. Then move it to ready, start it, and stop it. Tell me the experiment ID and final state.`,
      { timeoutMs: LIFECYCLE_TIMEOUT_MS }
    );
    assertUsedMcpTool(result, 'should use execute_api_method');

    state.advId = extractExperimentId(result);
    if (!state.advId) throw new Error(`Could not find experiment ID: ${result.output.substring(0, 300)}`);
    console.log(`\n    experiment_id=${state.advId}`);
    process.stdout.write('    ');

    const allText = [result.output, ...result.toolResults].join('\n').toLowerCase();
    if (!allText.includes('stopped') && !allText.includes('stop')) {
      throw new Error('Experiment should be stopped');
    }
    return result;
  });

  await test('user restarts the experiment and sets it to full-on', () => {
    if (!state.advId) throw new Error('No experiment ID from previous test');
    const result = runClaude(
      `Restart experiment ${state.advId}. Note: restarting creates a new experiment — use the new ID from the response. Then set the new experiment to full-on with variant 1 (note: "going full on"). Tell me the new experiment ID and confirm it's in full_on state.`,
      { timeoutMs: LIFECYCLE_TIMEOUT_MS }
    );
    assertUsedMcpTool(result, 'should use execute_api_method');

    const allText = [result.output, ...result.toolResults].join('\n').toLowerCase();
    const fullOnMatch = allText.includes('full_on') || allText.includes('full on');
    if (!fullOnMatch) throw new Error(`Expected full_on state in response: ${result.output.substring(0, 500)}`);

    const newId = extractExperimentId(result);
    if (newId) state.advId = newId;

    return result;
  });

  await test('user cleans up the full-on experiment', () => {
    if (!state.advId) {
      console.log('\n    (skipping — no experiment ID from previous test)');
      return { ok: true, output: 'skipped', toolResults: [], toolCalls: [] };
    }
    const result = runClaude(
      `Stop experiment ${state.advId} and archive it.`,
      { timeoutMs: LIFECYCLE_TIMEOUT_MS }
    );
    return result;
  });

  // ════════════════════════════════════════════════
  // 6. Complex queries — "real user" scenarios
  // ════════════════════════════════════════════════
  console.log(`\n-- Complex Queries --`);

  await test('user asks a cross-entity question', () => {
    const result = runClaude(
      'What tags are available for experiments? List them for me.',
    );
    assertUsedMcpTool(result, 'should use execute_api_method');
    return result;
  });

  await test('user asks about goals', () => {
    const result = runClaude(
      'Show me the goals configured in ABsmartly.',
    );
    assertUsedMcpTool(result, 'should use execute_api_method');
    return result;
  });

  await test('user asks about segments', () => {
    const result = runClaude(
      'What audience segments do we have?',
    );
    assertUsedMcpTool(result, 'should use execute_api_method');
    return result;
  });

  await test('user asks to find a specific experiment by name', () => {
    const result = runClaude(
      `Search for experiments with "ux_test" in the name.`,
    );
    assertUsedMcpTool(result, 'should use execute_api_method');
    return result;
  });

  // ════════════════════════════════════════════════
  // 7. Full lifecycle in a single prompt
  // ════════════════════════════════════════════════
  console.log(`\n-- Full Lifecycle (single prompt) --`);

  await test('complete experiment lifecycle in one go', () => {
    state.fullName = `ux_test_full_lifecycle_${ts}`;
    const result = runClaude(
      `I need to test the full experiment lifecycle. Do these steps for me:
1. Create an experiment called "${state.fullName}" with type "test", first available application and unit type, Control and Treatment variants, 50/50 split, in "created" state.
2. Move it to ready state.
3. Put it in development mode (note: "dev testing").
4. Start it.
5. Stop it.
6. Restart it (this creates a new experiment iteration — note the new ID).
7. Set the new experiment to full-on with variant 1 (note: "going full on").
8. Stop the new experiment.
9. Archive it.

After all steps, tell me: the original experiment ID, the new experiment ID after restart, and confirm it ended up archived.`,
      { timeoutMs: LIFECYCLE_TIMEOUT_MS }
    );
    assertUsedMcpTool(result, 'should use execute_api_method');

    const allText = [result.output, ...result.toolResults].join('\n').toLowerCase();
    if (!allText.includes('full_on') && !allText.includes('full on')) {
      throw new Error(`Expected full_on state in lifecycle: ${result.output.substring(0, 500)}`);
    }
    if (!allText.includes('archived') && !allText.includes('archive')) {
      throw new Error(`Expected archived state at end: ${result.output.substring(0, 500)}`);
    }

    return result;
  });

  // ════════════════════════════════════════════════
  // Summary
  // ════════════════════════════════════════════════
  console.log(`\n${'='.repeat(55)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailed:');
    for (const r of results.filter(r => r.status === 'FAIL')) {
      console.log(`  - ${r.name}`);
      console.log(`    ${r.error.split('\n').join('\n    ')}`);
    }
  }
  console.log();

  return { success: failed === 0, passed, failed, results };
}

const result = await run();
process.exit(result.success ? 0 : 1);
