#!/usr/bin/env node
// Runs the compiled stdio server with the installed dependencies. dist/ is
// built before every publish (see .github/workflows/npm-publish.yml), so no
// TypeScript runner is needed or fetched at startup.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LOCAL_SERVER_ENTRY = ['..', 'dist', 'local-server.js'];

const entrypoint = resolve(dirname(fileURLToPath(import.meta.url)), ...LOCAL_SERVER_ENTRY);

if (!existsSync(entrypoint)) {
    console.error(`absmartly-mcp: ${entrypoint} is missing; run \`npm run build\` first.`);
    process.exit(1);
}

await import(pathToFileURL(entrypoint).href);
