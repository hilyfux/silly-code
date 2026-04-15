#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { AUTH_FILES, CLAUDE_MACOS_KEYCHAIN, authState } from './silly-auth.js';

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
  // Pin the resolved dataDir for every child process (login.mjs, cli-patched.js)
  // so a bare HOME env or cwd change can never re-route tokens.
  process.env.SILLY_CODE_DATA = dataDir;
  const patched = path.join(rootDir, 'pipeline', 'build', 'cli-patched.js');

  const providers = {
    sillyx: { env: 'CLAUDE_CODE_USE_OPENAI', label: 'OpenAI Codex', authKey: 'codex' },
    sillye: { env: null, label: 'Claude', authKey: 'claude' },
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

function providerLoggedIn(authKey, dataDir) {
  const { hasCodex, hasClaude } = authState(dataDir);
  return authKey === 'codex' ? hasCodex : authKey === 'claude' ? hasClaude : false;
}

function launchProvider(name, info, dataDir, patched, userArgs) {
  if (info.env) process.env[info.env] = '1';
  if (!providerLoggedIn(info.authKey, dataDir)) {
    if (name === 'sillyx') {
      console.log(`\n  ${name} — ${info.label}\n`);
      console.log('[silly] Not logged in. Starting login now...\n');
      const r = spawnSync(process.execPath, [path.join(rootDir, 'pipeline', 'login.mjs'), 'codex'], { stdio: 'inherit' });
      if (r.status !== 0 || !providerLoggedIn(info.authKey, dataDir)) {
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
      return cmdUninstall();
    case 'update':
      return cmdUpdate();
    default:
      console.error(`Unknown subcommand: ${sub}`);
      console.error("Run 'silly help' for usage.");
      process.exit(1);
  }
}

function renderAuthLines(dataDir) {
  const { hasCodex, hasClaude } = authState(dataDir);
  console.log(`  ${hasCodex ? '✓' : '✗'} Codex   (sillyx): ${hasCodex ? 'logged in' : 'not logged in'}`);
  console.log(`  ${hasClaude ? '✓' : '✗'} Claude  (sillye): ${hasClaude ? 'logged in' : 'not logged in'}`);
}

function cmdStatus(dataDir, showHints) {
  console.log('');
  console.log('  silly-code — Codex + Claude');
  console.log('');
  renderAuthLines(dataDir);
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
  const patchedOk = fs.existsSync(patched);
  console.log('');
  console.log('  silly-code doctor');
  console.log('');
  console.log(`  ✓ Node: ${process.version}`);
  console.log(`  ✓ Platform: ${process.platform} ${process.arch}`);
  console.log(`  ${patchedOk ? '✓' : '✗'} Patched binary: ${patchedOk ? 'found' : 'missing (run: silly login claude OR sillyx)'}`);
  console.log('');
  renderAuthLines(dataDir);
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
  const files = AUTH_FILES[provider];
  if (!files) {
    console.error('Usage: silly logout <codex|claude>');
    process.exit(1);
  }
  for (const f of files) rm(path.join(dataDir, f));
  if (provider === 'claude') {
    console.log('[silly] Claude tokens removed (macOS keychain entries and .claude/.credentials.json may need manual cleanup)');
  } else {
    console.log('[silly] Codex tokens removed');
  }
}

function cmdUpdate() {
  const r = spawnSync('git', ['-C', rootDir, 'pull', '--ff-only', 'origin', 'main'], { stdio: ['inherit', 'pipe', 'inherit'] });
  if (r.status !== 0) {
    console.error('[silly] git pull failed. Re-run the installer to recover:');
    console.error('  irm https://raw.githubusercontent.com/hilyfux/silly-code/main/install.ps1 | iex');
    process.exit(r.status ?? 1);
  }
  const out = (r.stdout?.toString() || '').trim();
  if (out) process.stdout.write(out + '\n');
  if (out.includes('Already up to date') || out.includes('Already up-to-date')) {
    console.log('[silly] Already up to date — skipping patch rebuild.');
    return;
  }
  const patchR = spawnSync(process.execPath, [path.join(rootDir, 'pipeline', 'patch.cjs')], { stdio: 'inherit', cwd: rootDir });
  if (patchR.status !== 0) {
    console.error('[silly] Patch rebuild failed. Re-run the installer or file an issue.');
    process.exit(patchR.status ?? 1);
  }
  console.log('[silly] Update complete.');
}

function cmdUninstall() {
  const ps1 = path.join(rootDir, 'uninstall.ps1');
  if (!fs.existsSync(ps1)) {
    console.error('uninstall.ps1 missing. Reinstall first or remove files manually:');
    console.error(`  ${path.join(os.homedir(), '.local', 'share', 'silly-code')}`);
    console.error(`  ${path.join(os.homedir(), '.local', 'bin', 'silly*.{cmd,ps1}')}`);
    process.exit(1);
  }
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], { stdio: 'inherit' });
  child.on('exit', code => process.exit(code ?? 0));
  child.on('error', err => { console.error(err.message); process.exit(1); });
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
  console.log('    silly update          Pull latest and rebuild patched binary');
  console.log('    silly uninstall       Remove silly-code completely');
  console.log('    silly help            Show this help');
  console.log('');
  console.log('  Launch:');
  console.log('    sillyx                Start with Codex');
  console.log('    sillye                Start with Claude');
  console.log('');
}
