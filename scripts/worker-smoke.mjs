import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const wranglerBin = realpathSync(new URL('../node_modules/.bin/wrangler', import.meta.url));
const port = Number(process.env.WORKER_SMOKE_PORT || 8790);
const timeout = Number(process.env.WORKER_SMOKE_TIMEOUT || 90) * 1000;
if (!Number.isInteger(port) || port <= 0 || !Number.isFinite(timeout) || timeout <= 0) {
    throw new Error('Invalid WORKER_SMOKE_PORT or WORKER_SMOKE_TIMEOUT');
}
// Refuse an existing listener rather than reporting another Worker's health.
await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
});
const child = spawn(process.execPath, [wranglerBin, 'dev', '--port', String(port)], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });
let stopped = false;
child.on('exit', () => { stopped = true; });
function killGroup(signal) {
    try { process.kill(-child.pid, signal); } catch (error) {
        if (error.code !== 'ESRCH') throw error;
    }
}
async function cleanup() {
    killGroup('SIGTERM');
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
        try { process.kill(-child.pid, 0); } catch (error) {
            if (error.code === 'ESRCH') return;
            throw error;
        }
        await delay(100);
    }
    killGroup('SIGKILL');
    while (!stopped) await delay(50);
}
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { void cleanup().finally(() => process.exit(1)); });
}
try {
    const deadline = Date.now() + timeout;
    let healthy = false;
    while (Date.now() < deadline && !stopped) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/health`, {
                signal: AbortSignal.timeout(Math.max(1, Math.min(1500, deadline - Date.now()))),
            });
            const body = await response.json();
            if (response.ok && body.status === 'healthy' && body.service === 'absmartly-mcp') {
                console.log(`Worker started: ${JSON.stringify(body)}`);
                healthy = true;
                break;
            }
        } catch {}
        await delay(Math.max(0, Math.min(500, deadline - Date.now())));
    }
    if (!healthy) {
        console.error(`Worker did not serve /health within ${timeout / 1000}s.\n${output}`);
        process.exitCode = 1;
    }
} finally {
    await cleanup();
}
