/**
 * Shared fixture: ensure wrangler dev is running for integration tests.
 *
 * Behavior:
 *   - Without `fresh`, if the port already answers /health, reuse it (the
 *     developer owns that wrangler) and return handle === null.
 *   - With `fresh` (gated runs), never reuse a
 *     server: pick a free port and start `wrangler dev` from this checkout,
 *     so the code under test is the code being published.
 *   - Wait for /health to answer 200 with status "healthy", and return a
 *     handle that can be passed to stopWranglerDev().
 *
 * If wrangler exits or never becomes healthy, the error carries the tail of
 * its output, so a Worker that crashes at module load (e.g. Cloudflare error
 * 10021) shows the real exception.
 */

import { spawn } from 'child_process';
import { createServer } from 'net';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { DEFAULT_WORKER_URL } from './gate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

export const DEFAULT_WRANGLER_PORT = Number(new URL(DEFAULT_WORKER_URL).port);
const DEFAULT_HEALTH_PATH = '/health';
const PORT_PROBE_TIMEOUT_MS = 1500;
const READY_POLL_INTERVAL_MS = 500;
const READY_POLL_TIMEOUT_MS = 90_000;
const OUTPUT_TAIL_CHARS = 4000;

async function probeHealth(port, timeoutMs = PORT_PROBE_TIMEOUT_MS, path = DEFAULT_HEALTH_PATH) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return false;
    const body = await response.json().catch(() => null);
    return body?.status === 'healthy';
  } catch {
    return false;
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Returns:
 *   { handle: <child process or null>, alreadyRunning: boolean, port: number, url: string }
 *
 * - handle === null means wrangler was already running (caller should NOT stop it)
 * - handle !== null means we started it (caller should call stopWranglerDev)
 */
export async function ensureWranglerDev({ port, fresh = false } = {}) {
  if (!fresh) {
    const reusePort = port ?? DEFAULT_WRANGLER_PORT;
    if (await probeHealth(reusePort)) {
      return { handle: null, alreadyRunning: true, port: reusePort, url: `http://127.0.0.1:${reusePort}` };
    }
  }

  const listenPort = port ?? (fresh ? await findFreePort() : DEFAULT_WRANGLER_PORT);
  // wrangler.jsonc routes the Worker to the mcp.absmartly.com custom domain,
  // so by default request.url carries that origin and OAuth discovery
  // advertises production. --local-upstream keeps the origin on this local
  // Worker. It must be `localhost`, not 127.0.0.1: test-1 accepts loopback
  // OAuth callbacks only as http://localhost/... (any port).
  const child = spawn('npx', [
    'wrangler', 'dev', '--port', String(listenPort), '--ip', '127.0.0.1',
    '--local-upstream', `localhost:${listenPort}`, '--upstream-protocol', 'http',
  ], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  });

  // Drain both pipes: an unread stdout pipe fills up and stalls wrangler.
  let output = '';
  const keep = (chunk) => {
    output = (output + chunk.toString()).slice(-OUTPUT_TAIL_CHARS);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);

  let exited = null;
  child.on('exit', (code, signal) => {
    exited = { code, signal };
  });

  const start = Date.now();
  while (Date.now() - start < READY_POLL_TIMEOUT_MS) {
    if (exited) break;
    if (await probeHealth(listenPort, READY_POLL_INTERVAL_MS)) {
      return { handle: child, alreadyRunning: false, port: listenPort, url: `http://127.0.0.1:${listenPort}` };
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
  }

  stopWranglerDev({ handle: child });
  const why = exited
    ? `wrangler dev exited (code ${exited.code}, signal ${exited.signal}) before /health answered`
    : `wrangler dev did not report healthy on port ${listenPort} within ${READY_POLL_TIMEOUT_MS}ms`;
  throw new Error(`${why}.\n--- wrangler output (tail) ---\n${output.trim()}`);
}

export function stopWranglerDev(fixture) {
  if (!fixture || !fixture.handle || !fixture.handle.pid) return;
  try {
    process.kill(-fixture.handle.pid, 'SIGTERM');
  } catch {}
}
