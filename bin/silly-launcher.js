#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const command = process.env.SILLY_TARGET_COMMAND;
if (!command) {
  console.error('Missing SILLY_TARGET_COMMAND');
  process.exit(1);
}
const target = path.join(__dirname, process.platform === 'win32' ? `${command}.ps1` : command);
const child = spawn(target, process.argv.slice(2), { stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', code => process.exit(code ?? 0));
child.on('error', err => {
  console.error(err.message);
  process.exit(1);
});
