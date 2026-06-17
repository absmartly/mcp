#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));

// Resolve the actually-installed @absmartly/cli version (the dependency
// range in package.json may be a caret; what we ship is whatever npm
// resolved). Falls back to "unknown" if the package isn't installed,
// which only happens in fresh checkouts where prebuild hasn't seen
// node_modules yet.
let cliCoreVersion = 'unknown';
try {
  const cliPkg = JSON.parse(
    readFileSync(join(root, 'node_modules', '@absmartly', 'cli', 'package.json'), 'utf-8'),
  );
  cliCoreVersion = cliPkg.version;
} catch {}

const versionFile = join(root, 'src', 'version.ts');

const content = `export const MCP_VERSION = ${JSON.stringify(pkg.version)};\nexport const CLI_CORE_VERSION = ${JSON.stringify(cliCoreVersion)};\n`;

const current = readFileSync(versionFile, 'utf-8');
if (current !== content) {
  writeFileSync(versionFile, content);
  console.log(`Updated src/version.ts to MCP=${pkg.version}, CLI core=${cliCoreVersion}`);
} else {
  console.log(`src/version.ts already current (MCP=${pkg.version}, CLI core=${cliCoreVersion})`);
}
