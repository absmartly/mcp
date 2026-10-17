// withPathIdGuard: path arguments are derived from each APIClient method's own
// source, and methods it cannot read fail closed.
import { APIClient } from '@absmartly/cli/api-client';
import { derivePathArgs, PathIdError, withPathIdGuard } from '../../src/path-id-guard';

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

  // Derivation, on the installed CLI.
  const proto = APIClient.prototype as any;
  assertEquals(derivePathArgs(proto.getGoal), [0], 'getGoal: argument 0 is a path ID');
  assertEquals(derivePathArgs(proto.revokeGoalAccessUser), [0, 1, 2], 'revokeGoalAccessUser: three path IDs');
  assertEquals(derivePathArgs(proto.getCurrentUser), [], 'getCurrentUser: no path arguments');
  assertEquals(derivePathArgs(proto.rawRequest), 'unknown', 'rawRequest (dynamic path): unknown');
  const unknown = Object.getOwnPropertyNames(proto)
    .filter((n) => n !== 'constructor' && typeof proto[n] === 'function' && derivePathArgs(proto[n]) === 'unknown');
  assertEquals(unknown, ['rawRequest'], 'only rawRequest is unknown in the installed CLI');

  // Derivation of shapes a newer CLI could use: not readable -> unknown.
  assertEquals(derivePathArgs(async function getX(this: any, id: number) { return this.request('GET', `/x/${encodeURIComponent(id)}`); }), 'unknown', 'a non-bare interpolation is unknown');
  assertEquals(derivePathArgs(async function getY(this: any, o: { id: number }) { return this.request('GET', `/y/${o.id}`); }), 'unknown', 'a member interpolation is unknown');
  assertEquals(derivePathArgs(async function getZ(this: any, id: number) { const p = `/z/${id}`; return this.request('GET', p); }), 'unknown', 'a path built outside the call is unknown');
  assertEquals(derivePathArgs(async function getW(this: any, { id }: { id: number }) { return this.request('GET', `/w/${id}`); }), 'unknown', 'a destructured parameter is unknown');

  // Guard behaviour.
  const calls: unknown[][] = [];
  const fake: any = {
    async getGoal(this: any, id: number) { calls.push(['getGoal', id]); return this.request('GET', `/goals/${id}`); },
    async request(_m: string, path: string) { calls.push(['request', path]); return {}; },
    async futureMethod(this: any, ref: string) { calls.push(['futureMethod', ref]); return this.request('GET', `/f/${encodeURIComponent(ref)}`); },
    async updateThing(this: any, id: number) { calls.push(['updateThing', id]); return this.getGoal(id); },
  };
  const guarded = withPathIdGuard(fake);
  for (const bad of ['abc', -3, 0, 1.5, '1/../x', undefined, null]) {
    assertEquals(await errorOf(() => guarded.getGoal(bad)), 'PathIdError', `getGoal(${JSON.stringify(bad)}) is refused`);
  }
  assertEquals(await errorOf(() => guarded.getGoal(7)), undefined, 'getGoal(7) runs');
  assertEquals(await errorOf(() => guarded.futureMethod('6/asset_role_users')), 'PathIdError', 'an unknown method fails closed on a path-like string');
  assertEquals(await errorOf(() => guarded.futureMethod('plain-name')), undefined, 'an unknown method still runs with a plain string');
  // A method calling another through `this` is guarded too (updateThing -> getGoal).
  assertEquals(await errorOf(() => guarded.updateThing('x/y')), 'PathIdError', 'a nested call through this is guarded');
  assertEquals(guarded.getGoal === guarded.getGoal, true, 'wrapped methods are cached per proxy');
  assertEquals(new PathIdError('m', 0, 'v').message.includes('positive integer'), true, 'PathIdError explains the rule');

  return { success: failed === 0, message: `${passed} passed, ${failed} failed`, testCount: passed + failed, details };
}
