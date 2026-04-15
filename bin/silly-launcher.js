#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const command = process.env.SILLY_TARGET_COMMAND;
const isWindows = process.platform === 'win32';

if (!command) {
  console.error('Missing SILLY_TARGET_COMMAND');
  process.exit(1);
}

if (!isWindows) {
  const target = path.join(__dirname, command);
  const child = spawn(target, process.argv.slice(2), { stdio: 'inherit', shell: false });
  child.on('exit', code => process.exit(code ?? 0));
  child.on('error', err => { console.error(err.message); process.exit(1); });
} else {
  await runOnWindows();
}

async function runOnWindows() {
  const dataDir = process.env.SILLY_CODE_DATA || path.join(os.homedir(), '.silly-code');
  fs.mkdirSync(dataDir, { recursive: true });
  const patched = path.join(rootDir, 'pipeline', 'build', 'cli-patched.js');

  const providers = {
    sillyx: { env: 'CLAUDE_CODE_USE_OPENAI', label: 'OpenAI Codex', authFiles: ['codex-auth.json', 'codex-oauth.json'] },
    sillye: { env: null, label: 'Claude', authFiles: ['claude-oauth.json'], extraAuth: [path.join(os.homedir(), '.claude', '.credentials.json')] },
  };

  if (providers[command]) {
    return launchProvider(command, providers[command], dataDir, patched, process.argv.slice(2));
  }

  if (command === 'silly') {
    return handleSilly(process.argv.slice(2), dataDir, patched);
  }

  console.error(`Unknown launcher target: ${command}`);
  process.exit(1);
}

function ensurePatched(patched) {
  if (fs.existsSync(patched)) return;
  console.log('[silly] Building patched binary (first run)...');
  const r = spawnSync(process.execPath, [path.join(rootDir, 'pipeline', 'patch.cjs')], { stdio: 'inherit', cwd: rootDir });
  if (r.status !== 0) {
    console.error('[silly] Patch build failed');
    process.exit(r.status ?? 1);
  }
}

function isLoggedIn(info, dataDir) {
  for (const f of info.authFiles || []) {
    if (fs.existsSync(path.join(dataDir, f))) return true;
  }
  for (const f of info.extraAuth || []) {
    if (fs.existsSync(f)) return true;
  }
  return false;
}

function launchProvider(name, info, dataDir, patched, userArgs) {
  if (info.env) process.env[info.env] = '1';
  if (!isLoggedIn(info, dataDir) && info.authFiles && info.authFiles.length) {
    if (name === 'sillyx') {
      console.log(`\n  ${name} — ${info.label}\n`);
      console.log('[silly] Not logged in. Starting login now...\n');
      const r = spawnSync(process.execPath, [path.join(rootDir, 'pipeline', 'login.mjs'), 'codex'], { stdio: 'inherit' });
      if (r.status !== 0 || !isLoggedIn(info, dataDir)) {
        console.log('\n[silly] Login was cancelled. Run the command again when ready.');
        process.exit(1);
      }
    } else if (name === 'sillye') {
      console.log(`\n  ${name} — ${info.label}\n`);
      console.log('[silly] Not logged in. The TUI will open — type /login to sign in.\n');
    }
  }
  ensurePatched(patched);
  const child = spawn(process.execPath, [patched, ...userArgs], { stdio: 'inherit' });
  child.on('exit', code => process.exit(code ?? 0));
  child.on('error', err => { console.error(err.message); process.exit(1); });
}

async function handleSilly(args, dataDir, patched) {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
    case '':
      return cmdStatus(dataDir, true);
    case 'status':
      return cmdStatus(dataDir, false);
    case 'models':
      return cmdModels();
    case 'doctor':
      return cmdDoctor(dataDir, patched);
    case 'login':
      return cmdLogin(rest[0], patched);
    case 'logout':
      return cmdLogout(rest[0], dataDir);
    case 'help':
    case '--help':
    case '-h':
      return cmdHelp();
    case 'uninstall':
      console.log('On Windows, remove %USERPROFILE%\\.local\\share\\silly-code and %USERPROFILE%\\.local\\bin\\silly*.cmd / .ps1.');
      return;
    default:
      console.error(`Unknown subcommand: ${sub}`);
      console.error("Run 'silly help' for usage.");
      process.exit(1);
  }
}

function cmdStatus(dataDir, showHints) {
  const hasCodex = fs.existsSync(path.join(dataDir, 'codex-auth.json')) || fs.existsSync(path.join(dataDir, 'codex-oauth.json'));
  const hasClaude = fs.existsSync(path.join(dataDir, 'claude-oauth.json')) || fs.existsSync(path.join(os.homedir(), '.claude', '.credentials.json'));
  console.log('');
  console.log('  silly-code — Codex + Claude');
  console.log('');
  console.log(`  ${hasCodex ? '✓' : '✗'} Codex   (sillyx): ${hasCodex ? 'logged in' : 'not logged in'}`);
  console.log(`  ${hasClaude ? '✓' : '✗'} Claude  (sillye): ${hasClaude ? 'logged in' : 'not logged in'}`);
  console.log('');
  if (showHints) {
    console.log('  Get started:');
    console.log('    silly login codex     Login to ChatGPT Pro / Codex');
    console.log('    silly login claude    Login to Claude Pro/Max');
    console.log('');
    console.log('  Then launch: sillyx / sillye');
    console.log('');
  }
}

function cmdModels() {
  console.log('');
  console.log('  Available Models');
  console.log('');
  console.log('  Codex (sillyx):');
  console.log('    gpt-5.4              1M context (272k practical)');
  console.log('    gpt-5.4-mini         Fast mini model');
  console.log('    gpt-5.3-codex        Industry-leading coding');
  console.log('');
  console.log('  Claude (sillye):');
  console.log('    claude-opus-4-6      1M context');
  console.log('    claude-sonnet-4-6    1M context');
  console.log('    claude-haiku-4-5     200k context');
  console.log('');
}

function cmdDoctor(dataDir, patched) {
  console.log('');
  console.log('  silly-code doctor');
  console.log('');
  console.log(`  ✓ Node: ${process.version}`);
  console.log(`  ✓ Platform: ${process.platform} ${process.arch}`);
  console.log(`  ${fs.existsSync(patched) ? '✓' : '✗'} Patched binary: ${fs.existsSync(patched) ? 'found' : 'missing (run: silly login claude OR sillyx)'}`);
  const hasCodex = fs.existsSync(path.join(dataDir, 'codex-auth.json')) || fs.existsSync(path.join(dataDir, 'codex-oauth.json'));
  const hasClaude = fs.existsSync(path.join(dataDir, 'claude-oauth.json')) || fs.existsSync(path.join(os.homedir(), '.claude', '.credentials.json'));
  console.log('');
  console.log(`  ${hasCodex ? '✓' : '✗'} Codex   (sillyx): ${hasCodex ? 'logged in' : 'not logged in'}`);
  console.log(`  ${hasClaude ? '✓' : '✗'} Claude  (sillye): ${hasClaude ? 'logged in' : 'not logged in'}`);
  console.log('');
  console.log('  Mode: patched binary (upstream + silly-code patches)');
  console.log('');
}

function cmdLogin(provider, patched) {
  if (provider === 'codex') {
    const r = spawnSync(process.execPath, [path.join(rootDir, 'pipeline', 'login.mjs'), 'codex'], { stdio: 'inherit' });
    process.exit(r.status ?? 0);
  }
  if (provider === 'claude') {
    ensurePatched(patched);
    console.log('[silly] Launching Silly Code — use /login inside the TUI to sign in to claude.ai');
    const child = spawn(process.execPath, [patched], { stdio: 'inherit' });
    child.on('exit', code => process.exit(code ?? 0));
    child.on('error', err => { console.error(err.message); process.exit(1); });
    return;
  }
  console.error('Usage: silly login <codex|claude>');
  process.exit(1);
}

function cmdLogout(provider, dataDir) {
  const rm = (p) => { if (fs.existsSync(p)) fs.unlinkSync(p); };
  if (provider === 'codex') {
    rm(path.join(dataDir, 'codex-auth.json'));
    rm(path.join(dataDir, 'codex-oauth.json'));
    console.log('[silly] Codex tokens removed');
    return;
  }
  if (provider === 'claude') {
    rm(path.join(dataDir, 'claude-oauth.json'));
    console.log('[silly] Claude tokens removed (macOS keychain entries and .claude/.credentials.json may need manual cleanup)');
    return;
  }
  console.error('Usage: silly logout <codex|claude>');
  process.exit(1);
}

function cmdHelp() {
  console.log('');
  console.log('  silly-code — Codex + Claude');
  console.log('');
  console.log('  Management:');
  console.log('    silly status          Show provider auth status');
  console.log('    silly login <prov>    Login to a provider');
  console.log('    silly logout <prov>   Remove stored tokens');
  console.log('    silly models          List available models');
  console.log('    silly doctor          Check prerequisites');
  console.log('    silly help            Show this help');
  console.log('');
  console.log('  Launch:');
  console.log('    sillyx                Start with Codex');
  console.log('    sillye                Start with Claude');
  console.log('');
}
