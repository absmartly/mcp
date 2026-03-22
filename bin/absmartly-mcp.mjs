#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const entrypoint = resolve(__dirname, '..', 'src', 'local-server.ts');

try {
    execFileSync('npx', ['tsx', entrypoint, ...process.argv.slice(2)], {
        stdio: 'inherit',
        env: process.env,
    });
} catch (e) {
    process.exit(e.status || 1);
}
