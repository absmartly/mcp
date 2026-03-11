#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const versionFile = join(root, 'src', 'version.ts');

const content = `export const MCP_VERSION = ${JSON.stringify(pkg.version)};\n`;

const current = readFileSync(versionFile, 'utf-8');
if (current !== content) {
  writeFileSync(versionFile, content);
  console.log(`Updated src/version.ts to ${pkg.version}`);
} else {
  console.log(`src/version.ts already at ${pkg.version}`);
}
