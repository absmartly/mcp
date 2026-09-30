#!/usr/bin/env node
// Builds the CommonJS copies of the Node entries ("." / "./node-http" and
// "./oauth") into dist/cjs/, so CommonJS hosts (and Jest's CommonJS transform)
// can require() the package without an ESM loader or a manual mock. The ESM
// build and all type declarations come from `tsc` (dist/*.js, dist/*.d.ts).
//
// Each entry is bundled into a single file with every npm package left
// external: the package's own modules are inlined, and dependencies resolve
// through their own "require" export conditions.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Tests pass a different directory (still one level below a sibling of
// public/, so the docs path below resolves the same way).
const outdir = process.argv[2] ? join(root, process.argv[2]) : join(root, 'dist', 'cjs');

const entries = {
  core: join(root, 'src', 'core.ts'),
  oauth: join(root, 'src', 'oauth', 'index.ts'),
};

mkdirSync(outdir, { recursive: true });
// The package is "type": "module"; this marks dist/cjs/*.js as CommonJS.
writeFileSync(join(outdir, 'package.json'), `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);

await build({
  entryPoints: entries,
  outdir,
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: true,
  logLevel: 'warning',
  // import.meta does not exist in CommonJS. src/node-http-server.ts resolves
  // the bundled docs as new URL("../public/docs/api", import.meta.url) from
  // dist/, so point import.meta.url at a file in dist/ (one level above
  // dist/cjs/) to keep that relative path correct.
  define: { 'import.meta.url': '__mcpImportMetaUrl' },
  banner: {
    js: 'const __mcpImportMetaUrl = require("url").pathToFileURL(require("path").join(__dirname, "..", "index.js")).href;',
  },
});

console.log(`Built CommonJS entries into ${outdir}: ${Object.keys(entries).join(', ')}`);
