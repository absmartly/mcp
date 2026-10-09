// endpoint-manifest.json is the contract a host checks against its OpenAPI
// spec. These tests pin that it is current, complete (every registered tool,
// every entity resource, every execute_command command), and that the static
// walk in scripts/endpoint-manifest.ts does not miss calls a command makes at
// runtime.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEndpointManifest, serializeManifest, MANIFEST_PATH } from '../../scripts/endpoint-manifest.js';
import type { EndpointManifest } from '../../src/endpoint-manifest.js';
import { setupTools } from '../../src/tools.js';
import { registerServer } from '../../src/register-server.js';
import { executeCommand, getGroupSummary, getCommandEntry } from '../../src/cli-catalog.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PATH_PATTERN = /^\/(v1\/|auth\/)[\w\-/{}]*$/;

/** Records the names of tools/resources registered on it. */
function recordingServer() {
  const tools: string[] = [];
  const resources: string[] = [];
  const server = {
    tool: (name: string) => { tools.push(name); },
    resource: (_name: string, uri: unknown) => { if (typeof uri === 'string') resources.push(uri); },
    prompt: () => {},
    server: { setRequestHandler: () => {} },
  };
  return { server: server as any, tools, resources };
}

/**
 * A client whose every method records its name and resolves to a permissive
 * value, so a core function runs as far as the fake data lets it.
 */
function recordingClient(calls: Set<string>) {
  const value: any = new Proxy(function () {}, {
    get: (_t, prop) => {
      if (prop === 'then') return undefined;
      if (prop === Symbol.iterator) return function* () {};
      if (prop === Symbol.toPrimitive) return () => 1;
      if (prop === 'length') return 0;
      return value;
    },
    apply: () => value,
  });
  return new Proxy({}, {
    get: (_t, prop) => {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      return async () => { calls.add(prop); return value; };
    },
  });
}

function sampleParams(group: string, command: string): Record<string, unknown> {
  const entry = getCommandEntry(group, command)!;
  const params: Record<string, unknown> = { ...(entry.example ?? {}) };
  for (const p of entry.params) {
    if (p.name in params) continue;
    params[p.name] = p.type === 'number' ? 1 : p.type === 'boolean' ? true : p.type === 'array' ? [] : p.type === 'object' ? {} : '1';
  }
  return params;
}

export default async function runTests() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];
  function ok(condition: boolean, name: string, error = 'Assertion failed') {
    if (condition) { passed++; details.push({ name, status: 'PASS' }); }
    else { failed++; details.push({ name, status: 'FAIL', error }); }
  }

  const built = buildEndpointManifest();
  const committed = readFileSync(MANIFEST_PATH, 'utf-8');
  ok(committed === serializeManifest(built), 'endpoint-manifest.json is current', 'stale: run `npm run manifest` and commit the result');
  const manifest = JSON.parse(committed) as EndpointManifest;

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
  ok(pkg.files.includes('endpoint-manifest.json'), 'endpoint-manifest.json is in the published files');

  // Every registered tool has a manifest entry, and nothing else does.
  const recorded = recordingServer();
  setupTools(recorded.server, { apiClient: null, endpoint: '', authType: '', entityWarnings: [], customFields: [], currentUserId: null });
  ok(JSON.stringify([...recorded.tools].sort()) === JSON.stringify(Object.keys(manifest.tools).sort()),
    'manifest.tools covers exactly the registered tools', `registered ${recorded.tools.join(', ')}; manifest ${Object.keys(manifest.tools).join(', ')}`);

  // Every API-backed resource has a manifest entry.
  const resServer = recordingServer();
  registerServer(resServer.server, { apiClient: {} as any, endpoint: '', authType: '', load: async () => { throw new Error('unused'); } });
  const entityUris = resServer.resources.filter(u => u.startsWith('absmartly://entities/')).sort();
  ok(entityUris.length > 0 && JSON.stringify(entityUris) === JSON.stringify(Object.keys(manifest.resources).sort()),
    'manifest.resources covers every entity resource', `registered ${entityUris.join(', ')}`);

  // Every execute_command command has a manifest entry with at least one endpoint.
  const catalogCommands = getGroupSummary().flatMap(g => g.commands.map(c => `${g.group}.${c}`)).sort();
  ok(JSON.stringify(catalogCommands) === JSON.stringify(Object.keys(manifest.commands).sort()), 'manifest.commands covers every catalog command');
  const withoutEndpoints = Object.entries(manifest.commands).filter(([, c]) => c.endpoints.length === 0).map(([k]) => k);
  ok(withoutEndpoints.length === 0, 'every command maps to at least one endpoint', withoutEndpoints.join(', '));
  ok(manifest.dynamicApiMethods.length === 0, 'no command reaches a runtime-built path', manifest.dynamicApiMethods.join(', '));

  // The union list is well formed and contains every per-tool entry.
  const union = new Set(manifest.endpoints.map(e => `${e.method} ${e.path}`));
  const malformed = manifest.endpoints.filter(e => !['GET', 'POST', 'PUT', 'DELETE'].includes(e.method) || !PATH_PATTERN.test(e.path));
  ok(malformed.length === 0, 'every endpoint has a valid method and path template', JSON.stringify(malformed.slice(0, 5)));
  const perTool = [...Object.values(manifest.tools), ...Object.values(manifest.resources), ...Object.values(manifest.commands)].flatMap(t => t.endpoints);
  const missingFromUnion = perTool.filter(e => !union.has(`${e.method} ${e.path}`));
  ok(missingFromUnion.length === 0, 'manifest.endpoints is the union of every entry', JSON.stringify(missingFromUnion.slice(0, 5)));
  ok(union.has('GET /v1/experiments') && union.has('GET /v1/experiments/{id}') && union.has('GET /auth/current-user'), 'manifest contains known endpoints');

  // Runtime cross-check: run each command against a recording client and
  // assert every APIClient method it actually called is in the manifest.
  const misses: string[] = [];
  let exercised = 0;
  for (const key of catalogCommands) {
    const [group, command] = key.split('.');
    const calls = new Set<string>();
    try {
      await executeCommand(recordingClient(calls) as any, group, command, sampleParams(group, command));
    } catch { /* fake data often fails validation; the calls made so far still count */ }
    if (calls.size > 0) exercised++;
    const expected = new Set(manifest.commands[key].apiMethods);
    for (const call of calls) if (!expected.has(call)) misses.push(`${key} → ${call}`);
  }
  ok(misses.length === 0, 'static walk includes every APIClient call made at runtime', misses.slice(0, 10).join('; '));
  ok(exercised > catalogCommands.length / 2, `runtime cross-check exercised most commands (${exercised}/${catalogCommands.length})`);

  return { success: failed === 0, message: `${passed} passed, ${failed} failed`, testCount: passed + failed, details };
}
