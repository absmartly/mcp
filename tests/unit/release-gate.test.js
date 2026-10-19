import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import TestRunner from '../test-runner.js';
import { isGated, skipScenario, skipSuite } from '../integration/gate.js';

export default async function runTests() {
  const previousRequire = process.env.REQUIRE_E2E;
  const previousCI = process.env.CI;
  const dir = await mkdtemp(join(tmpdir(), 'mcp-release-gate-'));
  let passed = 0;
  const details = [];

  async function test(name, fn) {
    try {
      await fn();
      passed++;
      details.push({ name, status: 'PASS' });
    } catch (error) {
      details.push({ name, status: 'FAIL', error: error.message });
    }
  }

  function runner() {
    const instance = new TestRunner();
    instance.log = () => {};
    return instance;
  }

  try {
    delete process.env.REQUIRE_E2E;
    delete process.env.CI;
    await test('local mode is not gated', () => assert.equal(isGated(), false));
    await test('local prerequisite skip has explicit zero-test result', () => {
      const result = skipSuite('test fixture absent');
      assert.equal(result.skipped, true);
      assert.equal(result.testCount, 0);
    });
    process.env.REQUIRE_E2E = '1';
    await test('REQUIRE_E2E enables gated mode', () => assert.equal(isGated(), true));
    await test('gated missing prerequisite throws rather than skipping', () => {
      assert.throws(() => skipSuite('missing credentials'), /cannot skip.*missing credentials/);
    });
    await test('gated partial scenario skip throws', () => {
      assert.throws(() => skipScenario('feature create returned HTTP 500'), /cannot skip.*HTTP 500/);
    });
    delete process.env.REQUIRE_E2E;
    process.env.CI = 'true';
    await test('CI enables gated mode', () => assert.equal(isGated(), true));
    await test('CI prerequisite skip throws', () => {
      assert.throws(() => skipSuite('Worker unreachable'), /cannot skip.*Worker unreachable/);
    });
    await test('zero-test success does not count as an executed test', async () => {
      const path = join(dir, 'empty.mjs');
      await writeFile(path, 'export default () => ({success: true, testCount: 0});');
      const instance = runner();
      await instance.runTest('empty.mjs', path, { integration: true });
      assert.equal(instance.passedTests, 0);
      assert.equal(instance.integrationTests, 0);
      assert.equal(instance.skippedSuites.length, 1);
      instance.integrationTests = 100;
      instance.enforceGate();
      assert.equal(instance.failedTests, 1);
    });
    await test('too few executed integration tests fails the gate', () => {
      const instance = runner();
      instance.integrationTests = 99;
      instance.enforceGate();
      assert.equal(instance.failedTests, 1);
    });
    await test('100 executed tests and no skips passes the gate', () => {
      const instance = runner();
      instance.integrationTests = 100;
      instance.enforceGate();
      assert.equal(instance.failedTests, 0);
    });
  } finally {
    if (previousRequire === undefined) delete process.env.REQUIRE_E2E;
    else process.env.REQUIRE_E2E = previousRequire;
    if (previousCI === undefined) delete process.env.CI;
    else process.env.CI = previousCI;
    await rm(dir, { recursive: true, force: true });
  }

  const failed = details.length - passed;
  return {
    success: failed === 0,
    testCount: details.length,
    message: `${passed} passed, ${failed} failed`,
    details,
  };
}
