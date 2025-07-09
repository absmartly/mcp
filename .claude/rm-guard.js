#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const command = process.env.CLAUDE_BASH_COMMAND;
const logFile = resolve('.claude/rm-requests.log');

if (!command || !command.startsWith('rm ')) {
  process.exit(0);
}

// Log the rm request
const timestamp = new Date().toISOString();
const logEntry = `${timestamp}: BLOCKED rm command: ${command}\n`;

try {
  writeFileSync(logFile, logEntry, { flag: 'a' });
} catch (err) {
  // Ignore write errors
}

console.log('⚠️  rm command blocked for safety');
console.log('Command:', command);
console.log('If you need to delete files, please run the command manually or use a specific deletion script.');
process.exit(1);