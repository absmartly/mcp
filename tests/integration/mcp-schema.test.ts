#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { homedir } from "os";

const LOCAL_MCP_URL = 'http://127.0.0.1:8787/sse';

function loadTestProfile() {
    const configPath = join(homedir(), '.config', 'absmartly', 'config.yaml');
    const configText = readFileSync(configPath, 'utf-8');
    const match = configText.match(/test-1:\s*\n\s+api:\s*\n\s+endpoint:\s*(\S+)/);
    if (!match) throw new Error('test-1 profile not found');

    const apiKey = execFileSync('security', [
        'find-generic-password', '-s', 'absmartly-cli', '-a', 'api-key-test-1', '-w'
    ], { encoding: 'utf-8' }).trim();

    return { endpoint: match[1], apiKey };
}

async function run() {
    const { endpoint, apiKey } = loadTestProfile();
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    function assert(condition: boolean, name: string, detail = '') {
        if (condition) {
            passed++;
            console.log(`  PASS  ${name}`);
        } else {
            failed++;
            failures.push(name);
            console.log(`  FAIL  ${name}${detail ? ': ' + detail : ''}`);
        }
    }

    const transport = new SSEClientTransport(
        new URL(LOCAL_MCP_URL),
        { requestInit: { headers: { 'Authorization': apiKey, 'x-absmartly-endpoint': endpoint } } }
    );
    const client = new Client({ name: "schema-test", version: "1.0" });
    await client.connect(transport);

    const tools = await client.listTools();
    const caps = client.getServerCapabilities();

    console.log(`\nMCP Schema & Capabilities Integration Tests`);
    console.log(`${'='.repeat(45)}`);
    console.log(`Tools: ${tools.tools.map(t => t.name).join(', ')}\n`);

    console.log('-- Capabilities --\n');
    assert(!!caps?.tools, 'tools capability declared');
    assert(!!caps?.resources, 'resources capability declared');
    assert(!!caps?.prompts, 'prompts capability declared');
    assert(caps?.resources?.listChanged === true, 'resources.listChanged is true');
    assert(caps?.resources?.subscribe === true, 'resources.subscribe is true');

    console.log('\n-- Tool Registration --\n');
    const expectedTools = ['get_auth_status', 'discover_commands', 'get_command_docs', 'execute_command'];
    for (const name of expectedTools) {
        assert(tools.tools.some(t => t.name === name), `${name} is registered`);
    }
    assert(tools.tools.length === expectedTools.length, `exactly ${expectedTools.length} tools registered`, `got ${tools.tools.length}`);

    console.log('\n-- get_auth_status schema --\n');
    const authTool = tools.tools.find(t => t.name === 'get_auth_status')!;
    const authProps = Object.keys(authTool.inputSchema?.properties || {});
    assert(authProps.length === 0, 'get_auth_status has no params');

    console.log('\n-- discover_commands schema --\n');
    const discoverTool = tools.tools.find(t => t.name === 'discover_commands')!;
    const discoverProps = Object.keys(discoverTool.inputSchema?.properties || {});
    assert(discoverProps.includes('category'), 'has category param');
    assert(discoverProps.includes('search'), 'has search param');
    assert(discoverProps.length === 2, `exactly 2 params`, `got: ${discoverProps.join(', ')}`);

    console.log('\n-- get_command_docs schema --\n');
    const docsTool = tools.tools.find(t => t.name === 'get_command_docs')!;
    const docsProps = Object.keys(docsTool.inputSchema?.properties || {});
    assert(docsProps.includes('method_name'), 'has method_name param');
    assert(docsProps.length === 1, `exactly 1 param`, `got: ${docsProps.join(', ')}`);
    const docsRequired = (docsTool.inputSchema as any)?.required || [];
    assert(docsRequired.includes('method_name'), 'method_name is required');

    console.log('\n-- execute_command schema --\n');
    const execTool = tools.tools.find(t => t.name === 'execute_command')!;
    const execProps = Object.keys(execTool.inputSchema?.properties || {});
    assert(execProps.includes('method_name'), 'has method_name param');
    assert(execProps.includes('params'), 'has params param');
    assert(execProps.includes('show'), 'has show param');
    assert(execProps.includes('exclude'), 'has exclude param');
    assert(execProps.includes('raw'), 'has raw param');
    assert(execProps.includes('limit'), 'has limit param');
    assert(execProps.length === 6, `exactly 6 params`, `got: ${execProps.join(', ')}`);
    const execRequired = (execTool.inputSchema as any)?.required || [];
    assert(execRequired.includes('method_name'), 'method_name is required');
    assert(!execRequired.includes('params'), 'params is optional');

    console.log('\n-- Tool invocation --\n');

    const authResult = await client.callTool({ name: 'get_auth_status', arguments: {} });
    const authText = (authResult.content as any[])[0]?.text || '';
    assert(authText.includes('Authenticated') || authText.includes('Email'), 'get_auth_status returns auth info');

    const discoverResult = await client.callTool({ name: 'discover_commands', arguments: {} });
    const discoverText = (discoverResult.content as any[])[0]?.text || '';
    assert(discoverText.includes('experiments') && discoverText.includes('methods'), 'discover_commands returns catalog');

    const docsResult = await client.callTool({ name: 'get_command_docs', arguments: { group: 'teams', command: 'listTeams' } });
    const docsText = (docsResult.content as any[])[0]?.text || '';
    assert(docsText.includes('listTeams') && docsText.includes('Parameter'), 'get_command_docs returns method docs');

    const execResult = await client.callTool({ name: 'execute_command', arguments: { group: 'teams', command: 'listTeams', params: {} } });
    const execText = (execResult.content as any[])[0]?.text || '';
    assert(execText.includes('"id"') && execText.includes('"name"'), 'execute_command returns data');

    console.log('\n-- Resources --\n');

    const resources = await client.listResources();
    const resourceUris = resources.resources.map(r => r.uri);
    const expectedEntityResources = [
        'absmartly://entities/applications',
        'absmartly://entities/unit-types',
        'absmartly://entities/teams',
        'absmartly://entities/users',
        'absmartly://entities/metrics',
        'absmartly://entities/goals',
        'absmartly://entities/tags',
        'absmartly://entities/custom-fields',
    ];
    for (const uri of expectedEntityResources) {
        assert(resourceUris.includes(uri), `resource ${uri} exists`);
    }

    const templates = await client.listResourceTemplates();
    const templateUris = templates.resourceTemplates.map(t => t.uriTemplate);

    const expectedTemplates = [
        'absmartly://experiments/{id}',
        'absmartly://metrics/{id}',
        'absmartly://goals/{id}',
        'absmartly://teams/{id}',
        'absmartly://users/{id}',
        'absmartly://segments/{id}',
        'absmartly://applications/{name}',
        'absmartly://teams/by-name/{name}',
        'absmartly://metrics/by-name/{name}',
        'absmartly://goals/by-name/{name}',
    ];
    for (const uri of expectedTemplates) {
        assert(templateUris.includes(uri), `resource template ${uri} exists`);
    }
    assert(templateUris.length === expectedTemplates.length, `exactly ${expectedTemplates.length} templates`, `got ${templateUris.length}`);

    console.log('\n-- Prompts --\n');

    const prompts = await client.listPrompts();
    const promptNames = prompts.prompts.map(p => p.name);
    for (const name of ['experiment-status', 'create-experiment', 'create-feature-flag', 'analyze-experiment', 'experiment-review']) {
        assert(promptNames.includes(name), `prompt ${name} exists`);
    }

    console.log('\n-- Resource Template Completions --\n');

    const appNameEmpty = await client.complete({
        ref: { type: "ref/resource" as const, uri: "absmartly://applications/{name}" },
        argument: { name: "name", value: "" },
    });
    assert(appNameEmpty.completion.values.length > 0, 'app name "" returns results');
    assert(appNameEmpty.completion.values.length <= 20, 'app name "" respects limit');

    const appNameWeb = await client.complete({
        ref: { type: "ref/resource" as const, uri: "absmartly://applications/{name}" },
        argument: { name: "name", value: "web" },
    });
    assert(appNameWeb.completion.values.length > 0, 'app name "web" returns results');
    assert(appNameWeb.completion.values.every(v => v.toLowerCase().includes('web')), 'app name "web" all contain "web"');

    const teamNameEmpty = await client.complete({
        ref: { type: "ref/resource" as const, uri: "absmartly://teams/by-name/{name}" },
        argument: { name: "name", value: "" },
    });
    assert(teamNameEmpty.completion.values.length > 0, 'team name "" returns results');

    const teamNameQA = await client.complete({
        ref: { type: "ref/resource" as const, uri: "absmartly://teams/by-name/{name}" },
        argument: { name: "name", value: "QA" },
    });
    assert(teamNameQA.completion.values.length > 0, 'team name "QA" returns results');
    assert(teamNameQA.completion.values.every(v => v.toLowerCase().includes('qa')), 'team name "QA" all contain "qa"');

    const teamIdEmpty = await client.complete({
        ref: { type: "ref/resource" as const, uri: "absmartly://teams/{id}" },
        argument: { name: "id", value: "" },
    });
    assert(teamIdEmpty.completion.values.length > 0, 'team id "" returns results');
    assert(teamIdEmpty.completion.values.every(v => /^\d+$/.test(v)), 'team id "" all are numeric');

    const metricNameEmpty = await client.complete({
        ref: { type: "ref/resource" as const, uri: "absmartly://metrics/by-name/{name}" },
        argument: { name: "name", value: "" },
    });
    assert(metricNameEmpty.completion.values.length > 0, 'metric name "" returns results');

    const metricIdEmpty = await client.complete({
        ref: { type: "ref/resource" as const, uri: "absmartly://metrics/{id}" },
        argument: { name: "id", value: "" },
    });
    assert(metricIdEmpty.completion.values.length > 0, 'metric id "" returns results');

    const goalNameEmpty = await client.complete({
        ref: { type: "ref/resource" as const, uri: "absmartly://goals/by-name/{name}" },
        argument: { name: "name", value: "" },
    });
    assert(goalNameEmpty.completion.values.length > 0, 'goal name "" returns results');

    const appNameNone = await client.complete({
        ref: { type: "ref/resource" as const, uri: "absmartly://applications/{name}" },
        argument: { name: "name", value: "xyznonexistent" },
    });
    assert(appNameNone.completion.values.length === 0, 'app name "xyznonexistent" returns empty');

    console.log('\n-- Resource Template Reading --\n');

    const appByName = await client.readResource({ uri: "absmartly://applications/website" });
    const appData = JSON.parse((appByName.contents[0] as any).text);
    assert(appData.name === 'website', 'read application by name returns correct app');
    assert(typeof appData.id === 'number', 'application has numeric id');

    const teamById = await client.readResource({ uri: "absmartly://teams/1" });
    const teamData = JSON.parse((teamById.contents[0] as any).text);
    assert(typeof teamData.id === 'number' || typeof teamData.name === 'string', 'read team by id returns data');

    const appNotFound = await client.readResource({ uri: "absmartly://applications/nonexistent_app_xyz" });
    const notFoundData = JSON.parse((appNotFound.contents[0] as any).text);
    assert(!!notFoundData.error, 'non-existent app returns error');

    console.log('\n-- Prompt Completions --\n');

    assert(!!caps?.completions, 'completions capability declared');

    const typeT = await client.complete({
        ref: { type: "ref/prompt" as const, name: "create-experiment" },
        argument: { name: "type", value: "t" },
    });
    assert(typeT.completion.values.length === 1, 'type "t" returns 1 result');
    assert(typeT.completion.values[0] === 'test', 'type "t" completes to "test"');

    const typeEmpty = await client.complete({
        ref: { type: "ref/prompt" as const, name: "create-experiment" },
        argument: { name: "type", value: "" },
    });
    assert(typeEmpty.completion.values.length === 2, 'type "" returns 2 results');
    assert(typeEmpty.completion.values.includes('test'), 'type "" includes "test"');
    assert(typeEmpty.completion.values.includes('feature'), 'type "" includes "feature"');

    const typeF = await client.complete({
        ref: { type: "ref/prompt" as const, name: "create-experiment" },
        argument: { name: "type", value: "f" },
    });
    assert(typeF.completion.values.length === 1, 'type "f" returns 1 result');
    assert(typeF.completion.values[0] === 'feature', 'type "f" completes to "feature"');

    const typeNone = await client.complete({
        ref: { type: "ref/prompt" as const, name: "create-experiment" },
        argument: { name: "type", value: "xyz" },
    });
    assert(typeNone.completion.values.length === 0, 'type "xyz" returns empty');

    const nameNoComplete = await client.complete({
        ref: { type: "ref/prompt" as const, name: "create-experiment" },
        argument: { name: "name", value: "test" },
    });
    assert(nameNoComplete.completion.values.length === 0, 'name param has no completions');

    console.log(`\n${'='.repeat(45)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
        console.log('\nFailed:');
        for (const f of failures) console.log(`  - ${f}`);
    }
    console.log();

    await client.close();
    return failed === 0;
}

run()
    .then(ok => process.exit(ok ? 0 : 1))
    .catch(err => {
        console.error('Fatal:', err);
        process.exit(1);
    });
