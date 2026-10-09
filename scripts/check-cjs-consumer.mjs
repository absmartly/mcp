#!/usr/bin/env node
// Type-checks a CommonJS TypeScript consumer of the built package under
// module/moduleResolution Node16 with skipLibCheck off, and fails on any
// diagnostic in this package's own declarations (dist/). Diagnostics inside
// dependencies' declarations are reported but not counted: they are not
// this package's to fix. Run after `npm run build`.
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const PACKAGE_NAME = '@absmartly/mcp';
const CJS_ENTRIES = [PACKAGE_NAME, `${PACKAGE_NAME}/node-http`, `${PACKAGE_NAME}/oauth`];
const CONSUMER_FILE = 'index.cts';
// tsc follows the package symlink and reports this package's own files by
// their real path (dist/...), so anything under node_modules/ is a dependency.
const DEPENDENCY_DIAGNOSTIC_PATTERN = /^node_modules\//;
const DIAGNOSTIC_PATTERN = /^(\S+)\(\d+,\d+\): error TS\d+/;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const consumerDir = mkdtempSync(join(tmpdir(), 'mcp-cjs-consumer-'));

try {
  // node_modules: this package under its own name, plus everything it installed.
  const modulesDir = join(consumerDir, 'node_modules');
  const scopeDir = join(modulesDir, PACKAGE_NAME.split('/')[0]);
  mkdirSync(scopeDir, { recursive: true });
  symlinkSync(root, join(modulesDir, PACKAGE_NAME));
  for (const entry of readdirSync(join(root, 'node_modules'))) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@')) {
      for (const scoped of readdirSync(join(root, 'node_modules', entry))) {
        const target = join(modulesDir, entry, scoped);
        if (target === join(modulesDir, PACKAGE_NAME)) continue;
        mkdirSync(join(modulesDir, entry), { recursive: true });
        symlinkSync(join(root, 'node_modules', entry, scoped), target);
      }
    } else {
      symlinkSync(join(root, 'node_modules', entry), join(modulesDir, entry));
    }
  }

  writeFileSync(join(consumerDir, CONSUMER_FILE),
    CJS_ENTRIES.map((entry, i) => `import entry${i} = require(${JSON.stringify(entry)});\nexport const value${i} = entry${i};\n`).join(''));
  writeFileSync(join(consumerDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { module: 'Node16', moduleResolution: 'Node16', skipLibCheck: false, strict: true, noEmit: true, types: ['node'] },
    files: [CONSUMER_FILE],
  }));

  let output = '';
  let failed = false;
  try {
    execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', consumerDir], { cwd: root, encoding: 'utf-8', stdio: 'pipe' });
  } catch (error) {
    failed = true;
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }

  const diagnostics = output.split('\n').filter(line => DIAGNOSTIC_PATTERN.test(line));
  const own = diagnostics.filter(line => !DEPENDENCY_DIAGNOSTIC_PATTERN.test(line));
  for (const line of diagnostics.filter(line => !own.includes(line))) console.log(`(dependency, ignored) ${line}`);
  if (own.length > 0) {
    console.error(own.join('\n'));
    console.error(`${own.length} diagnostic(s) in ${PACKAGE_NAME}'s CommonJS declarations`);
    process.exitCode = 1;
  } else if (failed && diagnostics.length === 0) {
    console.error(`tsc failed without diagnostics:\n${output}`);
    process.exitCode = 1;
  } else {
    console.log(`A Node16 CommonJS consumer type-checks ${CJS_ENTRIES.join(', ')} with no diagnostics in ${PACKAGE_NAME}'s declarations`);
  }
} finally {
  rmSync(consumerDir, { recursive: true, force: true });
}
