/**
 * Release-gate helpers shared by the integration suites.
 *
 * In a gated run (`npm run test:e2e`, which passes --gated, or any run with
 * REQUIRE_E2E=1 / CI=true) a missing prerequisite is a failure, never a skip.
 * 2.0.0 and 2.0.1 shipped to npm with a Worker that could not start because
 * every Worker-backed suite quietly reported "skipped" and the run stayed
 * green. Outside a gated run the skips still work, so a developer without
 * test-1 credentials can run the suite locally, but each one is logged.
 *
 * Not a test file: it has no default export.
 */

export const DEFAULT_WORKER_URL = 'http://127.0.0.1:8787';

export function isGated() {
  return process.env.REQUIRE_E2E === '1' || process.env.CI === 'true';
}

// The test runner sets MCP_WORKER_URL to the Worker it started; standalone
// runs fall back to a manually started `wrangler dev` on the default port.
export function workerUrl() {
  return (process.env.MCP_WORKER_URL || DEFAULT_WORKER_URL).replace(/\/+$/, '');
}

/**
 * Return value for a suite that cannot run. Throws in a gated run, so the
 * runner records a failure instead of a zero-test success.
 */
export function skipSuite(reason) {
  reason = reason.replace(/^Skipped:\s*/, '');
  if (isGated()) {
    throw new Error(`gated e2e run cannot skip: ${reason}`);
  }
  console.log(`\n  SKIPPED (local run only; a gated run fails here): ${reason}`);
  return { success: true, skipped: true, testCount: 0, message: `Skipped: ${reason}`, details: [] };
}

/**
 * For a single scenario inside a suite that wants to bail out early. Throws
 * in a gated run; otherwise logs and returns, so the caller should `return`
 * straight after it.
 */
export function skipScenario(reason) {
  if (isGated()) {
    throw new Error(`gated e2e run cannot skip: ${reason}`);
  }
  console.log(`\n    SKIPPED (local run only; a gated run fails here): ${reason}`);
}
