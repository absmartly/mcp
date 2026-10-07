#!/usr/bin/env node
// Copies the type declarations `tsc` emitted into dist/ to dist/cjs/types/, so
// the "require" export conditions get declarations of their own. dist/cjs/ has
// a package.json with "type": "commonjs", so TypeScript (node16/nodenext)
// reads these copies as CommonJS declarations; the originals in dist/ sit in
// the package's "type": "module" scope and would describe the CommonJS build
// as ESM ("masquerading as ESM"). Declaration maps are not copied: their
// relative source paths only resolve from dist/.
//
// A CommonJS declaration may only type-import an ESM-only package (one with
// no "require" export condition, such as @absmartly/cli) with an explicit
// resolution mode, or TypeScript reports TS1541. Such imports get
// `with { "resolution-mode": "import" }` added here.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, relative, sep } from 'path';
import { fileURLToPath } from 'url';

const DECLARATION_SUFFIX = '.d.ts';
const RESOLUTION_MODE_ATTRIBUTE = 'with { "resolution-mode": "import" }';
const TYPE_IMPORT_PATTERN = /^(import type [^;]*? from (['"])([^.'"][^'"]*)\2)(;?)$/gm;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const cjsDir = join(distDir, 'cjs');
const typesDir = join(cjsDir, 'types');

function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

const esmOnlyCache = new Map();
function isEsmOnly(specifier) {
  const name = packageName(specifier);
  if (!esmOnlyCache.has(name)) {
    const manifestPath = join(root, 'node_modules', name, 'package.json');
    let esmOnly = false;
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      esmOnly = manifest.type === 'module' && !JSON.stringify(manifest.exports ?? {}).includes('"require"');
    }
    esmOnlyCache.set(name, esmOnly);
  }
  return esmOnlyCache.get(name);
}

function toCommonJsDeclaration(source) {
  return source.replace(TYPE_IMPORT_PATTERN, (line, statement, _quote, specifier, semicolon) =>
    isEsmOnly(specifier) ? `${statement} ${RESOLUTION_MODE_ATTRIBUTE}${semicolon}` : line);
}

if (!existsSync(join(distDir, `core${DECLARATION_SUFFIX}`))) {
  throw new Error(`No declarations in ${distDir}; run tsc first.`);
}

rmSync(typesDir, { recursive: true, force: true });
for (const entry of readdirSync(distDir, { recursive: true, withFileTypes: true })) {
  const from = join(entry.parentPath, entry.name);
  const path = relative(distDir, from);
  if (!entry.isFile() || !entry.name.endsWith(DECLARATION_SUFFIX) || path.startsWith(`cjs${sep}`)) continue;
  const to = join(typesDir, path);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, toCommonJsDeclaration(readFileSync(from, 'utf-8')));
}

console.log(`Copied CommonJS type declarations into ${typesDir}`);
