// Guards the package boundary a Node host (office/backend) depends on:
//  - the Node entries' full transitive import graph never reaches a
//    Worker-only dependency (hono, @cloudflare/workers-oauth-provider,
//    agents, workers-mcp, dotenv) or a Worker-only module of this package;
//  - package.json maps every Node entry to both an ESM and a CommonJS file,
//    and the Worker-only deps are optional peers, not dependencies;
//  - the CommonJS build loads with plain require(), with no Worker-only
//    module ending up in require.cache.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { createRequire, builtinModules } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEST_OUT_DIR = '.test-dist/cjs';
const WORKER_ONLY_PACKAGES = ['hono', '@cloudflare/workers-oauth-provider', 'agents', 'workers-mcp', 'dotenv'];
const WORKER_ONLY_SOURCES = ['index.ts', 'absmartly-oauth-handler.ts', 'oauth-worker-guards.ts', 'session-provider.ts', 'resources.ts', 'dxt-bundle.ts', 'worker.ts'];
const NODE_ENTRY_SOURCES = ['src/core.ts', 'src/oauth/index.ts'];
const BUILTINS = new Set(builtinModules);

function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

function isBuiltin(specifier: string): boolean {
  return specifier.startsWith('node:') || BUILTINS.has(specifier.split('/')[0]);
}

function staticImports(source: string): string[] {
  const specifiers: string[] = [];
  for (const m of source.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)) specifiers.push(m[1]);
  for (const m of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) specifiers.push(m[1]);
  for (const m of source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(m[1]);
  return specifiers;
}

function isTypeOnly(source: string, specifier: string): boolean {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = source.match(new RegExp(`^\\s*(?:import|export)\\s[^;]*?from\\s+['"]${escaped}['"]`, 'gm')) ?? [];
  return lines.length > 0 && lines.every(line => /^\s*(?:import|export)\s+type\s/.test(line));
}

/** Walks this package's own sources; returns the graph's files and the npm packages it imports at runtime. */
function walkSourceGraph(entry: string): { files: Set<string>; packages: Map<string, string> } {
  const files = new Set<string>();
  const packages = new Map<string, string>();
  const queue = [resolve(ROOT, entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    const source = readFileSync(file, 'utf-8');
    for (const specifier of staticImports(source)) {
      if (isTypeOnly(source, specifier)) continue;
      if (specifier.startsWith('.')) {
        queue.push(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')));
      } else if (!isBuiltin(specifier)) {
        packages.set(packageName(specifier), file);
      }
    }
  }
  return { files, packages };
}

/** Walks an npm package's runtime import graph (ESM files), returning every package it reaches. */
function walkPackageGraph(pkg: string, fromFile: string, reached: Set<string>): void {
  if (reached.has(pkg)) return;
  reached.add(pkg);
  const requireFrom = createRequire(fromFile);
  let pkgRoot: string;
  try {
    pkgRoot = dirname(requireFrom.resolve(`${pkg}/package.json`));
  } catch {
    // Packages without an exported package.json: walk up from their main entry.
    let dir = dirname(requireFrom.resolve(pkg));
    while (!existsSync(join(dir, 'package.json')) || JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).name !== pkg) dir = dirname(dir);
    pkgRoot = dir;
  }
  const manifest = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf-8'));
  for (const dep of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) {
    walkPackageGraph(dep, join(pkgRoot, 'package.json'), reached);
  }
}

export default async function runTests() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];
  function ok(condition: boolean, name: string, error = 'Assertion failed') {
    if (condition) { passed++; details.push({ name, status: 'PASS' }); }
    else { failed++; details.push({ name, status: 'FAIL', error }); }
  }

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));

  for (const entry of NODE_ENTRY_SOURCES) {
    const { files, packages } = walkSourceGraph(entry);
    const workerSources = [...files].map(f => f.slice(join(ROOT, 'src').length + 1)).filter(f => WORKER_ONLY_SOURCES.includes(f));
    ok(workerSources.length === 0, `${entry}: imports no Worker-only module`, `reaches ${workerSources.join(', ')}`);

    const reached = new Set<string>();
    for (const [dep, importer] of packages) walkPackageGraph(dep, importer, reached);
    // hono is a hard dependency of @modelcontextprotocol/sdk (and
    // @hono/node-server 2.x, used by newer SDKs, loads it at runtime), so it
    // is reachable from any MCP server. What this package controls is that it
    // never imports hono itself and adds no path to the other Worker deps.
    const direct = [...packages.keys()];
    const directWorkerDeps = direct.filter(d => WORKER_ONLY_PACKAGES.includes(d));
    ok(directWorkerDeps.length === 0, `${entry}: imports no Worker-only package`, `imports ${directWorkerDeps.join(', ')}`);
    for (const dep of direct) {
      ok(dep in (pkg.dependencies ?? {}) || dep in (pkg.peerDependencies ?? {}), `${entry}: runtime import ${dep} is a dependency or peer`, `${dep} is neither`);
      ok(!pkg.peerDependenciesMeta?.[dep]?.optional, `${entry}: runtime import ${dep} is not an optional peer`, `${dep} is optional`);
    }
    const transitiveWorkerOnly = ['@cloudflare/workers-oauth-provider', 'agents', 'workers-mcp', 'dotenv'].filter(d => reached.has(d));
    ok(transitiveWorkerOnly.length === 0, `${entry}: no transitive path to a Worker-only package`, `reaches ${transitiveWorkerOnly.join(', ')}`);
  }

  for (const dep of WORKER_ONLY_PACKAGES) {
    ok(!(dep in (pkg.dependencies ?? {})), `package.json: ${dep} is not a runtime dependency`);
  }
  for (const dep of ['hono', '@cloudflare/workers-oauth-provider', 'agents']) {
    ok(pkg.peerDependenciesMeta?.[dep]?.optional === true, `package.json: ${dep} is an optional peer (Worker entry)`);
  }
  ok(pkg.peerDependencies?.['@absmartly/cli'] !== undefined && !(('@absmartly/cli') in (pkg.dependencies ?? {})), 'package.json: @absmartly/cli is a peer dependency, not a bundled one');

  for (const subpath of ['.', './node-http', './oauth']) {
    const conditions = pkg.exports?.[subpath] ?? {};
    ok(typeof conditions.import === 'string' && typeof conditions.require === 'string' && typeof conditions.types === 'string',
      `exports["${subpath}"] has types, import and require`, JSON.stringify(conditions));
  }
  ok(pkg.exports?.['./worker']?.require === undefined, 'exports["./worker"] is ESM-only (Workers are ESM)');
  ok(typeof pkg.exports?.['./endpoint-manifest.json'] === 'string', 'exports the endpoint manifest');

  // Build the CommonJS entries into a scratch directory and require() them.
  const outDir = join(ROOT, TEST_OUT_DIR);
  rmSync(join(ROOT, '.test-dist'), { recursive: true, force: true });
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-cjs.mjs'), TEST_OUT_DIR], { cwd: ROOT, stdio: 'pipe' });
    const script = `
      const core = require(${JSON.stringify(join(outDir, 'core.js'))});
      const oauth = require(${JSON.stringify(join(outDir, 'oauth.js'))});
      const loaded = Object.keys(require.cache);
      console.log(JSON.stringify({
        core: Object.keys(core).sort(),
        oauth: Object.keys(oauth).length,
        // hono excluded: reachable through @modelcontextprotocol/sdk, see above.
        workerOnly: loaded.filter(f => /node_modules[\\\\/](@cloudflare[\\\\/]workers-oauth-provider|agents|workers-mcp|dotenv)[\\\\/]/.test(f)),
        handlerType: typeof core.createStreamableHttpHandler(async () => ({})).post,
        fetchClient: new core.FetchHttpClient('https://example.com', { authToken: 't', authType: 'api-key' }).getBaseUrl(),
      }));`;
    const result = JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: ROOT, encoding: 'utf-8' }).trim().split('\n').pop()!);
    for (const name of ['createStreamableHttpHandler', 'FetchHttpClient', 'registerServer', 'executeCommand', 'CLI_GROUPS']) {
      ok(result.core.includes(name), `require(core) exports ${name}`, `got ${result.core.join(', ')}`);
    }
    ok(result.oauth > 20, 'require(oauth) exports the OAuth primitives', `got ${result.oauth} exports`);
    ok(result.workerOnly.length === 0, 'require() loads no Worker-only package', result.workerOnly.join(', '));
    ok(result.handlerType === 'function', 'CommonJS createStreamableHttpHandler returns a handler');
    ok(result.fetchClient === 'https://example.com/v1', 'CommonJS FetchHttpClient works');
  } catch (e: any) {
    ok(false, 'CommonJS build loads with require()', e.stderr?.toString() || e.message);
  } finally {
    rmSync(join(ROOT, '.test-dist'), { recursive: true, force: true });
  }

  return { success: failed === 0, message: `${passed} passed, ${failed} failed`, testCount: passed + failed, details };
}
