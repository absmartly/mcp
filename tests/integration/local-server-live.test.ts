#!/usr/bin/env node
/**
 * Live stdio (local-server) tests (#66): spawns the built `absmartly-mcp` bin,
 * as an npm consumer runs it, and drives it with the MCP SDK over stdio against
 * a real ABsmartly API.
 *
 * Covers, end to end:
 *   - the local server's client is wrapped by the path guard: path IDs that are
 *     not positive integers are refused before any request; valid calls still
 *     work (the {id} resource templates are Worker-only, see
 *     catalog-contract-live.test.ts);
 *   - an install whose @absmartly/cli is not the version the path table was
 *     generated from: one warning naming both versions, object arguments
 *     (bodies, options) still pass, and unsafe IDs are still refused.
 *
 * The server reads its profile from $HOME/.config/absmartly, so each run gets a
 * temporary HOME holding a profile for the resolved credentials (removed after).
 * Needs `npm run build` first. Credentials: ABSMARTLY_API_KEY +
 * ABSMARTLY_API_ENDPOINT, or `--profile <name>` (see test-credentials.js);
 * without them it skips locally and fails a gated run. The mismatch case packs this package and npm-installs it, in a
 * temporary directory, with another @absmartly/cli (MCP_E2E_MISMATCH_CLI picks
 * the version); if that install fails it skips locally and fails a gated run.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { resolveTestCredentials, SKIP_MESSAGE } from "./test-credentials.js";
import { skipScenario, skipSuite } from "./gate.js";
import { PATH_TABLE_CLI_VERSION } from "../../src/api-path-args.js";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN_PATH = join('bin', 'absmartly-mcp.mjs');
const PROFILE_NAME = 'mcp-e2e';
const KEYCHAIN_ACCOUNT = `api-key-${PROFILE_NAME}`;
const CLI_PACKAGE = '@absmartly/cli';
const CLI_PEER_RANGE = '>=1.7.0 <2';
const ID_REFUSAL = 'must be a positive integer';
const BACKEND_HTTP_ERROR = /HTTP \d{3}/;
const MISMATCH_WARNING = /@absmartly\/cli (\S+) is loaded, but the path guard table was generated from (\S+)\./g;

type ToolCallResult = { content: Array<{ type: string; text?: string }> };
type TestResult = { name: string; status: 'PASS' | 'FAIL'; error?: string };

/** A temporary HOME whose ABsmartly CLI config holds one profile (file mode 600). */
function makeHome(apiKey: string, endpoint: string): string {
    const home = mkdtempSync(join(tmpdir(), 'mcp-e2e-home-'));
    const configDir = join(home, '.config', 'absmartly');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.yaml'),
        `default-profile: ${PROFILE_NAME}\nprofiles:\n  ${PROFILE_NAME}:\n    api:\n      endpoint: ${endpoint}\n`);
    const credentials = join(configDir, 'credentials.json');
    writeFileSync(credentials, JSON.stringify({ [KEYCHAIN_ACCOUNT]: apiKey }));
    chmodSync(credentials, 0o600);
    return home;
}

async function startServer(packageRoot: string, home: string, stderrLines: string[]): Promise<Client> {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [join(packageRoot, BIN_PATH)],
        cwd: packageRoot,
        env: { PATH: process.env.PATH ?? '', HOME: home },
        stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk) => stderrLines.push(...chunk.toString().split('\n').filter(Boolean)));
    const client = new Client({ name: 'local-server-live', version: '1.0' });
    await client.connect(transport);
    return client;
}

function textOf(result: ToolCallResult): string {
    const first = result?.content?.[0];
    return first && first.type === 'text' && typeof first.text === 'string' ? first.text : JSON.stringify(result);
}

async function execute(client: Client, group: string, command: string, params: Record<string, unknown>, confirmed = false): Promise<string> {
    return textOf(await client.callTool({
        name: 'execute_command',
        arguments: { group, command, params, ...(confirmed ? { confirmed: true } : {}) },
    }) as ToolCallResult);
}

async function expectOk(client: Client, group: string, command: string, params: Record<string, unknown> = {}): Promise<string> {
    const text = await execute(client, group, command, params);
    if (/^(Error executing|Param validation failed|Unknown command)/.test(text)) {
        throw new Error(`${group}.${command} failed: ${text.slice(0, 300)}`);
    }
    return text;
}

async function expectIdRefusal(client: Client, group: string, command: string, params: Record<string, unknown>): Promise<void> {
    const text = await execute(client, group, command, params, true);
    if (BACKEND_HTTP_ERROR.test(text)) throw new Error(`reached the backend: ${text.slice(0, 300)}`);
    if (!text.includes(ID_REFUSAL)) throw new Error(`expected an ID refusal, got: ${text.slice(0, 300)}`);
}

/** Exercises the server: valid reads (including object options), then ID refusals. */
async function exerciseGuard(client: Client): Promise<void> {
    await expectOk(client, 'auth', 'whoami');
    await expectOk(client, 'experiments', 'listExperiments', { items: 1 });
    await expectOk(client, 'experiments', 'listCustomFields');
    await expectIdRefusal(client, 'goals', 'getGoal', { goalId: '1/../users' });
    await expectIdRefusal(client, 'goals', 'getGoal', { goalId: -3 });
    await expectIdRefusal(client, 'experiments', 'startExperiment', { experimentId: null });
}

function mismatchedCliVersion(): string | null {
    if (process.env.MCP_E2E_MISMATCH_CLI) return process.env.MCP_E2E_MISMATCH_CLI;
    try {
        const versions = JSON.parse(execFileSync('npm', ['view', `${CLI_PACKAGE}@${CLI_PEER_RANGE}`, 'version', '--json'], { encoding: 'utf-8' }));
        const list: string[] = Array.isArray(versions) ? versions : [versions];
        return list.reverse().find((v) => v !== PATH_TABLE_CLI_VERSION) ?? null;
    } catch {
        return null;
    }
}

/**
 * A clean npm install of this package (packed as it would be published) next
 * to the given @absmartly/cli version. Returns the installed package root.
 */
function makeInstallWithCli(version: string): { root: string; packageRoot: string } {
    const root = mkdtempSync(join(tmpdir(), 'mcp-e2e-install-'));
    const tarball = execFileSync('npm', ['pack', PROJECT_ROOT, '--silent', '--pack-destination', root], { encoding: 'utf-8' }).trim().split('\n').pop()!;
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'mcp-e2e-consumer', private: true, type: 'module' }));
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent', join(root, tarball), `${CLI_PACKAGE}@${version}`], { cwd: root, stdio: 'ignore' });
    return { root, packageRoot: join(root, 'node_modules', '@absmartly', 'mcp') };
}

async function run() {
    const creds = await resolveTestCredentials();
    if (!creds) return skipSuite(SKIP_MESSAGE);
    if (!existsSync(join(PROJECT_ROOT, 'dist', 'local-server.js'))) {
        throw new Error('dist/local-server.js is missing: run `npm run build` first');
    }

    const home = makeHome(creds.apiKey, creds.endpoint);
    const results: TestResult[] = [];
    async function test(name: string, fn: () => Promise<void>) {
        process.stdout.write(`\n  ${name} ... `);
        try {
            await fn();
            results.push({ name, status: 'PASS' });
            console.log('PASS');
        } catch (err: any) {
            results.push({ name, status: 'FAIL', error: err?.message || String(err) });
            console.log('FAIL');
            console.log(`    ${err?.message || err}`);
        }
    }

    try {
        await test(`stdio server (CLI ${PATH_TABLE_CLI_VERSION}): valid calls work, unsafe path IDs are refused, no mismatch warning`, async () => {
            const stderr: string[] = [];
            const client = await startServer(PROJECT_ROOT, home, stderr);
            try {
                await exerciseGuard(client);
            } finally {
                await client.close();
            }
            const warnings = stderr.join('\n').match(MISMATCH_WARNING);
            if (warnings) throw new Error(`unexpected mismatch warning: ${warnings[0]}`);
        });

        const otherVersion = mismatchedCliVersion();
        if (!otherVersion) {
            skipScenario('mismatched CLI case: no other @absmartly/cli version found');
        } else {
            let install: { root: string; packageRoot: string } | undefined;
            try {
                install = makeInstallWithCli(otherVersion);
            } catch (err: any) {
                skipScenario(`mismatched CLI case: could not install ${CLI_PACKAGE}@${otherVersion}: ${err?.message}`);
            }
            if (install) {
                await test(`stdio server on mismatched CLI ${otherVersion}: one warning, objects pass, unsafe IDs refused`, async () => {
                    const stderr: string[] = [];
                    const client = await startServer(install!.packageRoot, home, stderr);
                    try {
                        await exerciseGuard(client);
                    } finally {
                        await client.close();
                    }
                    const warnings = [...stderr.join('\n').matchAll(MISMATCH_WARNING)];
                    if (warnings.length !== 1) throw new Error(`expected exactly one mismatch warning, got ${warnings.length}`);
                    const [, installed, table] = warnings[0];
                    if (installed !== otherVersion || table !== PATH_TABLE_CLI_VERSION) {
                        throw new Error(`warning names ${installed}/${table}, expected ${otherVersion}/${PATH_TABLE_CLI_VERSION}`);
                    }
                });
                rmSync(install.root, { recursive: true, force: true });
            }
        }
    } finally {
        rmSync(home, { recursive: true, force: true });
    }

    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    return { success: failed === 0, message: `${passed} passed, ${failed} failed`, testCount: passed + failed, details: results };
}

export default run;

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    run()
        .then((result) => process.exit(result.success ? 0 : 1))
        .catch((err) => {
            console.error('Fatal:', err);
            process.exit(1);
        });
}
