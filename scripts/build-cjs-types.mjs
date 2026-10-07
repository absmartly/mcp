#!/usr/bin/env node
// Copies the type declarations `tsc` emitted into dist/ to dist/cjs/types/, so
// the "require" export conditions get declarations of their own. dist/cjs/ has
// a package.json with "type": "commonjs", so TypeScript (node16/nodenext)
// reads these copies as CommonJS declarations; the originals in dist/ sit in
// the package's "type": "module" scope and would describe the CommonJS build
// as ESM ("masquerading as ESM"). Declaration maps are not copied: their
// relative source paths only resolve from dist/.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const DECLARATION_SUFFIX = '.d.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const cjsDir = join(distDir, 'cjs');
const typesDir = join(cjsDir, 'types');

function copyDeclarations(fromDir, toDir) {
  for (const entry of readdirSync(fromDir, { withFileTypes: true })) {
    const from = join(fromDir, entry.name);
    if (entry.isDirectory()) {
      if (from !== cjsDir) copyDeclarations(from, join(toDir, entry.name));
    } else if (entry.name.endsWith(DECLARATION_SUFFIX)) {
      mkdirSync(toDir, { recursive: true });
      copyFileSync(from, join(toDir, entry.name));
    }
  }
}

if (!existsSync(join(distDir, `core${DECLARATION_SUFFIX}`))) {
  throw new Error(`No declarations in ${distDir}; run tsc first.`);
}

rmSync(typesDir, { recursive: true, force: true });
copyDeclarations(distDir, typesDir);

console.log(`Copied CommonJS type declarations into ${typesDir}`);
