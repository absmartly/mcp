#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { homedir } from "os";
import { APIClient } from "@absmartly/cli/api-client";
import { FetchHttpClient } from "./fetch-adapter.js";
import { MCP_VERSION } from "./version.js";
import { buildServerContext } from "./server-context.js";
import { registerServer } from "./register-server.js";

const CONFIG_FILE_PATH = '.config/absmartly/config.yaml';
const DEFAULT_PROFILE_NAME = 'default';
const KEYCHAIN_SERVICE = 'absmartly-cli';
const KEYCHAIN_ACCOUNT_PREFIX = 'api-key';
const CREDENTIALS_FILE_PATH = '.config/absmartly/credentials.json';

interface ProfileConfig {
    endpoint: string;
    apiKey: string;
}

function parseYamlConfig(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = text.split('\n');
    const keyStack: string[] = [];
    const indentStack: number[] = [-1];

    for (const line of lines) {
        if (!line.trim() || line.trim().startsWith('#')) continue;

        const indent = line.search(/\S/);
        const match = line.match(/^(\s*)([^:]+?):\s*(.*)$/);
        if (!match) continue;

        const key = match[2].trim();
        const value = match[3].trim();

        while (indentStack.length > 1 && indent <= indentStack[indentStack.length - 1]) {
            indentStack.pop();
            keyStack.pop();
        }

        if (value) {
            const fullKey = [...keyStack, key].join('.');
            result[fullKey] = value;
        } else {
            keyStack.push(key);
            indentStack.push(indent);
        }
    }

    return result;
}

function readProfileConfig(profileName: string): ProfileConfig {
    const configPath = join(homedir(), CONFIG_FILE_PATH);
    if (!existsSync(configPath)) {
        throw new Error(`ABsmartly CLI config not found at ${configPath}. Run 'absmartly login' first.`);
    }

    const configText = readFileSync(configPath, 'utf-8');
    const config = parseYamlConfig(configText);

    const resolvedProfile = profileName === DEFAULT_PROFILE_NAME && config['default-profile']
        ? config['default-profile']
        : profileName;

    const endpoint = config[`profiles.${resolvedProfile}.api.endpoint`]
        || config[`profiles.${resolvedProfile}.endpoint`]
        || config[`profiles.${resolvedProfile}.url`];
    if (!endpoint) {
        throw new Error(`No endpoint found for profile "${resolvedProfile}" in ${configPath}`);
    }

    const accountName = resolvedProfile === 'default'
        ? KEYCHAIN_ACCOUNT_PREFIX
        : `${KEYCHAIN_ACCOUNT_PREFIX}-${resolvedProfile}`;

    let apiKey: string | undefined;
    let keychainError: string | undefined;

    if (process.platform === 'darwin') {
        try {
            apiKey = execFileSync('security', [
                'find-generic-password',
                '-s', KEYCHAIN_SERVICE,
                '-a', accountName,
                '-w',
            ], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        } catch (e) {
            keychainError = e instanceof Error ? e.message : String(e);
            console.error(`Keychain lookup failed for ${accountName}: ${keychainError}`);
        }
    }

    if (!apiKey) {
        const credentialsPath = join(homedir(), CREDENTIALS_FILE_PATH);
        if (existsSync(credentialsPath)) {
            try {
                const creds = JSON.parse(readFileSync(credentialsPath, 'utf-8'));
                apiKey = creds[accountName] || undefined;
            } catch (e) {
                console.error(`Failed to read credentials file ${credentialsPath}:`, e);
            }
        }
    }

    if (!apiKey) {
        const details = keychainError ? ` (keychain error: ${keychainError})` : '';
        throw new Error(`No API key found for profile "${resolvedProfile}"${details}. Run 'abs auth login' first.`);
    }

    return { endpoint, apiKey };
}

async function main() {
    const profileArg = process.argv.find(a => a.startsWith('--profile='));
    const profileName = profileArg ? profileArg.split('=')[1] : DEFAULT_PROFILE_NAME;

    const config = readProfileConfig(profileName);

    const fetchHttpClient = new FetchHttpClient(config.endpoint, {
        authToken: config.apiKey,
        authType: 'api-key',
    });
    const apiClient = new APIClient(fetchHttpClient);

    const mcpServer = new McpServer(
        {
            name: "ABsmartly MCP Server (Local)",
            version: MCP_VERSION,
        },
        {
            capabilities: {
                tools: {},
                resources: { subscribe: true, listChanged: true },
                prompts: {},
            },
        }
    );

    const ctx = await buildServerContext(apiClient, { endpoint: config.endpoint, authType: 'API Key' });

    // ── Register tools, resources, and prompts (shared with Node HTTP transport) ──
    const docsDir = join(new URL('.', import.meta.url).pathname, '..', 'public', 'docs', 'api');
    registerServer(mcpServer, ctx, { docsDir, profileName });

    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
