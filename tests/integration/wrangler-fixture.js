/**
 * Shared fixture: ensure wrangler dev is running for integration tests.
 *
 * Behavior:
 *   - If the port is already reachable, returns null (assume user owns it).
 *   - Otherwise spawns `npx wrangler dev`, waits for /health to respond,
 *     and returns a handle that can be passed to stopWranglerDev().
 *
 * Tests that need a local MCP should call ensureWranglerDev() in setup
 * and stopWranglerDev(handle) in teardown. Tests using ESM-only imports
 * can use the existing per-test preflight to skip when both this fixture
 * and a manually-managed wrangler are absent.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

export const DEFAULT_WRANGLER_PORT = 8787;
const DEFAULT_HEALTH_PATH = '/health';
const PORT_PROBE_TIMEOUT_MS = 1500;
const READY_POLL_INTERVAL_MS = 500;
const READY_POLL_TIMEOUT_MS = 60_000;

async function probePort(port, timeoutMs = PORT_PROBE_TIMEOUT_MS, path = DEFAULT_HEALTH_PATH) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForReady(port, deadlineMs = READY_POLL_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (await probePort(port, READY_POLL_INTERVAL_MS)) return true;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
  }
  return false;
}

/**
 * Returns:
 *   { handle: <child process or null>, alreadyRunning: boolean, port: number }
 *
 * - handle === null means wrangler was already running (caller should NOT stop it)
 * - handle !== null means we started it (caller should call stopWranglerDev)
 */
export async function ensureWranglerDev({ port = DEFAULT_WRANGLER_PORT } = {}) {
  if (await probePort(port)) {
    return { handle: null, alreadyRunning: true, port };
  }

  const child = spawn('npx', ['wrangler', 'dev', '--port', String(port)], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });

  child.stderr.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line && !line.includes('Deprecation') && !line.includes('[wrangler:info]')) {
      console.log(`  [wrangler] ${line}`);
    }
  });

  const ready = await waitForReady(port);
  if (!ready) {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch {}
    throw new Error(`wrangler dev did not become ready on port ${port} within ${READY_POLL_TIMEOUT_MS}ms`);
  }

  return { handle: child, alreadyRunning: false, port };
}

export function stopWranglerDev(fixture) {
  if (!fixture || !fixture.handle || !fixture.handle.pid) return;
  try {
    process.kill(-fixture.handle.pid, 'SIGTERM');
  } catch {}
}
