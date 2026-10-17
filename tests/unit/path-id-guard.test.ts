// withPathIdGuard: path arguments come from src/api-path-args.ts, generated
// from the pinned @absmartly/cli build and looked up by parameter name;
// request/rawRequest validate their path; anything else fails closed.
import { readFileSync } from 'node:fs';
import { APIClient } from '@absmartly/cli/api-client';
import type { HttpClient, HttpRequestConfig, HttpResponse } from '@absmartly/cli/api-client';
import { ACTIVE_PATH_TABLE, PathIdError, pathTableFor, withPathIdGuard } from '../../src/path-id-guard';
import type { PathTable } from '../../src/path-id-guard';
import { API_PATH_METHODS, PATH_TABLE_CLI_VERSION } from '../../src/api-path-args';
import { buildApiPathArgs, deriveApiPathArgs } from '../../scripts/endpoint-manifest';

class Recorder implements HttpClient {
  urls: string[] = [];
  getBaseUrl() { return 'https://api.test/v1'; }
  async request<T>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    this.urls.push(config.url);
    return { data: { ok: true, goal: { id: 1 }, file: { id: 1 } } as T, status: 200, statusText: 'OK', headers: {} };
  }
}

export default async function runTests() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];
  function assertEquals(actual: unknown, expected: unknown, name: string) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a === b) { passed++; details.push({ name, status: 'PASS' }); }
    else { failed++; details.push({ name, status: 'FAIL', error: `Expected ${b}, got ${a}` }); }
  }
  async function errorOf(fn: () => unknown): Promise<string | undefined> {
    try { await fn(); return undefined; } catch (e: any) { return e?.name; }
  }

  // ── The table: generated from the pinned CLI, and the pin is exact. ──
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
  assertEquals(pkg.devDependencies['@absmartly/cli'], PATH_TABLE_CLI_VERSION, 'devDependency pins the exact CLI version the table was generated from');
  assertEquals(pkg.peerDependencies['@absmartly/cli'], PATH_TABLE_CLI_VERSION, 'peerDependency pins the same exact version');
  assertEquals(ACTIVE_PATH_TABLE === API_PATH_METHODS, true, 'the installed CLI matches the table, so it is used');
  assertEquals(buildApiPathArgs(), API_PATH_METHODS, 'the committed table is what the generator reads from the installed CLI');
  assertEquals(API_PATH_METHODS.revokeGoalAccessUser?.path, ['id', 'userId', 'assetRoleId'], 'revokeGoalAccessUser: three path IDs, by name');
  assertEquals(API_PATH_METHODS.getCurrentUser?.path, [], 'getCurrentUser: no path arguments');
  const proto = APIClient.prototype as any;
  const unmapped = Object.getOwnPropertyNames(proto)
    .filter((n) => n !== 'constructor' && typeof proto[n] === 'function' && !(n in API_PATH_METHODS));
  assertEquals(unmapped.sort(), ['rawRequest', 'request'], 'every installed method is mapped except request/rawRequest');

  // A version mismatch trusts no mapping.
  assertEquals(pathTableFor(PATH_TABLE_CLI_VERSION) === API_PATH_METHODS, true, 'pathTableFor(pinned) is the generated table');
  assertEquals(pathTableFor('1.17.0'), {}, 'pathTableFor(another version) is empty: every method is unknown');

  // ── Generator: what it maps, and what it leaves unknown. ──
  const derived = deriveApiPathArgs(`export class APIClient {
    async fixedDouble(a) {
        return this.request('GET', "/things");
    }
    async fixedSingle(a) {
        return this.request('GET', '/things');
    }
    async getThing(id, opts) {
        return this.request('GET', \`/things/\${id}\`, { params: opts });
    }
    async encoded(id) {
        return this.request('GET', \`/x/\${encodeURIComponent(id)}\`);
    }
    async built(id) {
        const p = \`/z/\${id}\`;
        return this.request('GET', p);
    }
    async destructured({ id }) {
        return this.request('GET', \`/w/\${id}\`);
    }
    async direct(id) {
        return this.httpClient.request({ method: 'GET', url: \`/d/\${id}\` });
    }
    async viaHelper(ref) {
        return resolveIt(this, ref);
    }
    getBaseUrl() {
        return this.httpClient.getBaseUrl?.() ?? '';
    }
`);
  assertEquals(derived.fixedDouble, { params: ['a'], path: [] }, 'generator: a double-quoted fixed path is a fixed path');
  assertEquals(derived.fixedSingle, { params: ['a'], path: [] }, 'generator: a single-quoted fixed path is a fixed path');
  assertEquals(derived.getThing, { params: ['id', 'opts'], path: ['id'] }, 'generator: a bare interpolated parameter is a path argument');
  for (const name of ['encoded', 'built', 'destructured', 'direct', 'viaHelper']) {
    assertEquals(name in derived, false, `generator: ${name} is left out (unknown)`);
  }
  assertEquals(derived.getBaseUrl, { params: [], path: [] }, 'generator: a method with no arguments cannot carry a path');

  // ── Guard, on a fake client and a test table. ──
  const sent: string[] = [];
  const fake: any = {
    getRootUrl: () => 'https://api.test',
    async request(_m: string, path: string) { sent.push(path); return {}; },
    async rawRequest(this: any, path: string) { return this.request('GET', path); },
    async getGoal(this: any, id: number) { return this.request('GET', `/goals/${id}`); },
    async uploadFile(this: any, usage: string, file: unknown) { return this.request('POST', `/file_uploads/${usage}`, { data: { file } }); },
    async uploadFileSwapped(this: any, file: unknown, usage: string) { return this.request('POST', `/file_uploads/${usage}`, { data: { file } }); },
    // No this.request: reaches its transport directly. Not in any table.
    async directCall(id: unknown) { sent.push(`/direct/${id}`); return {}; },
    async futureMethod(this: any, ref: unknown) { return this.request('GET', `/f/${ref}`); },
    async updateThing(this: any, id: unknown) { return this.getGoal(id); },
  };
  const table: PathTable = {
    getGoal: { params: ['id'], path: ['id'] },
    uploadFile: { params: ['usage', 'file'], path: ['usage'] },
    uploadFileSwapped: { params: ['file', 'usage'], path: ['usage'] },
    updateThing: { params: ['id'], path: [] },
  };
  const guarded = withPathIdGuard(fake, table);

  // Mapped ID argument.
  for (const bad of ['abc', -3, 0, 1.5, '1/../x', undefined, null, { id: 1 }]) {
    assertEquals(await errorOf(() => guarded.getGoal(bad)), 'PathIdError', `getGoal(${JSON.stringify(bad)}) is refused`);
  }
  assertEquals(await errorOf(() => guarded.getGoal(7)), undefined, 'getGoal(7) runs');
  assertEquals(await errorOf(() => guarded.updateThing('x/y')), 'PathIdError', 'a nested call through this is guarded');

  // request/rawRequest: their own path is validated (2.1.0-rc request() passed unchecked).
  for (const bad of ['/goals/../users', '/goals/..', '/./x', '/goals/%2e%2e/users', '/goals/%2E%2E', '/goals/.%2e', '/a\\b', 'goals', '//evil.test/x', '/a#b', '/a/%2fb', '/a%25', 5, undefined]) {
    assertEquals(await errorOf(() => guarded.request('GET', bad)), 'PathIdError', `request(GET, ${JSON.stringify(bad)}) is refused`);
    assertEquals(await errorOf(() => guarded.rawRequest(bad)), 'PathIdError', `rawRequest(${JSON.stringify(bad)}) is refused`);
  }
  for (const ok of ['/goals/5', '/goals?search=a.b', '/experiments/5/metrics']) {
    assertEquals(await errorOf(() => guarded.request('GET', ok)), undefined, `request(GET, ${ok}) runs`);
  }
  assertEquals(await errorOf(() => guarded.request('GET', 'https://api.test/auth/current-user')), undefined, 'request: the root auth API runs');
  assertEquals(await errorOf(() => guarded.request('GET', 'https://api.test/auth/current-user/api_keys/3')), undefined, 'request: a root auth sub-path runs');
  assertEquals(await errorOf(() => guarded.request('GET', 'https://api.test/auth/current-userx')), 'PathIdError', 'request: a look-alike root auth path is refused');
  assertEquals(await errorOf(() => guarded.request('GET', 'https://evil.test/auth/current-user')), 'PathIdError', 'request: another origin is refused');
  assertEquals(await errorOf(() => guarded.request('GET', 'https://api.test/auth/current-user/../../v1/users')), 'PathIdError', 'request: dot segments after the root auth path are refused');

  // A method with no this.request is not in the table: it fails closed.
  assertEquals(await errorOf(() => guarded.directCall('6/asset_role_users')), 'PathIdError', 'a method without this.request fails closed on a path string');
  assertEquals(await errorOf(() => guarded.directCall('plain-name')), undefined, 'a method without this.request still runs with a plain string');

  // Unknown methods: non-primitive arguments and bad numbers are refused.
  for (const bad of [{ id: '../x' }, ['a/b'], [1], {}, null, 1.5, -1, 0, NaN, Infinity, '%2e', 'a?b', 'a#b', 'a.b', 'a\\b']) {
    assertEquals(await errorOf(() => guarded.futureMethod(bad)), 'PathIdError', `an unknown method refuses ${JSON.stringify(bad) ?? String(bad)}`);
  }
  for (const ok of ['plain-name', 42, true, undefined]) {
    assertEquals(await errorOf(() => guarded.futureMethod(ok)), undefined, `an unknown method runs with ${JSON.stringify(ok) ?? 'undefined'}`);
  }

  // Non-ID path argument, by name not position.
  assertEquals(await errorOf(() => guarded.uploadFile('../users', {})), 'PathIdError', 'uploadFile: usage with path characters is refused');
  assertEquals(await errorOf(() => guarded.uploadFile('experiment_screenshot', { any: 'object' })), undefined, 'uploadFile: a word usage runs; file is not a path argument');
  assertEquals(await errorOf(() => guarded.uploadFileSwapped({ any: 'object' }, 'a/b')), 'PathIdError', 'usage is found by name wherever it sits');

  // A mismatched CLI version: the empty table makes every method unknown.
  const mismatched = withPathIdGuard(fake, pathTableFor('9.9.9'));
  assertEquals(await errorOf(() => mismatched.getGoal({})), 'PathIdError', 'version mismatch: an object argument is refused');
  assertEquals(await errorOf(() => mismatched.getGoal(-3)), 'PathIdError', 'version mismatch: a non-positive number is refused');
  assertEquals(await errorOf(() => mismatched.getGoal('1/../x')), 'PathIdError', 'version mismatch: a path string is refused');
  assertEquals(await errorOf(() => mismatched.request('GET', '/a/%2E%2E/b')), 'PathIdError', 'version mismatch: request still validates its path');

  // ── Wrapping, on the real APIClient. ──
  const http = new Recorder();
  const client = new APIClient(http);
  const real = withPathIdGuard(client);
  assertEquals(withPathIdGuard(client) === real, true, 'wrapping a client twice returns the same proxy');
  assertEquals(withPathIdGuard(real) === real, true, 'wrapping a proxy returns it');
  assertEquals(real.getGoal === real.getGoal, true, 'wrapped methods are cached per proxy');
  assertEquals(await errorOf(() => real.getGoal('1/../users' as any)), 'PathIdError', 'real APIClient: getGoal refuses a path string');
  assertEquals(await errorOf(() => (real as any).uploadFile('../users', 'x')), 'PathIdError', 'real APIClient: uploadFile refuses a path usage');
  assertEquals(await errorOf(() => real.rawRequest('/goals/%2E%2E/users')), 'PathIdError', 'real APIClient: rawRequest refuses an encoded dot segment');
  assertEquals(await errorOf(() => (real as any).request('GET', '/goals/..')), 'PathIdError', 'real APIClient: request refuses a dot segment');
  assertEquals(await errorOf(() => real.getGoal(5)), undefined, 'real APIClient: getGoal(5) runs');
  assertEquals(http.urls, ['/goals/5'], 'only the valid call reached the HTTP client');

  const err = new PathIdError('m', 0, 'v');
  assertEquals(err.message.includes('positive integer'), true, 'PathIdError explains the ID rule');
  assertEquals(new PathIdError('m', 0, 'v', 'x must be y').message, 'Invalid path argument "v" for m: x must be y.', 'PathIdError names other rules');

  return { success: failed === 0, message: `${passed} passed, ${failed} failed`, testCount: passed + failed, details };
}
