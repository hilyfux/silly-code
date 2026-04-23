#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { AUTH_FILES, authState } from './silly-auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const command = process.env.SILLY_TARGET_COMMAND;
const isWindows = process.platform === 'win32';

// Single source of truth for all install paths. Two layouts exist:
//   dist (tarball): <root>/versions/<ver>, <root>/bin/.lib/{login.mjs,uninstall.ps1,silly-launcher.js}
//   dev  (repo):    <root>/pipeline/build/cli-patched.js, <root>/pipeline/login.mjs, <root>/installer/uninstall.ps1
// Root is taken from SILLY_INSTALL_DIR (set by install.ps1 .cmd wrappers) or
// discovered by walking up from __dirname until a marker directory appears.
const INSTALL = (() => {
  const root = (() => {
    if (process.env.SILLY_INSTALL_DIR) return process.env.SILLY_INSTALL_DIR;
    let cur = __dirname;
    for (let i = 0; i < 5; i++) {
      if (fs.existsSync(path.join(cur, 'versions')) || fs.existsSync(path.join(cur, 'pipeline'))) return cur;
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    return path.resolve(__dirname, '..');
  })();

  let versions = [];
  try {
    versions = fs.readdirSync(path.join(root, 'versions')).filter(f => !f.startsWith('.')).sort();
  } catch {}

  const mode = versions.length ? 'dist' : 'dev';
  const patched = mode === 'dist'
    ? path.join(root, 'versions', versions[versions.length - 1])
    : path.join(root, 'pipeline', 'build', 'cli-patched.js');

  const pick = (dist, dev) => fs.existsSync(dist) ? dist : dev;
  const login = pick(path.join(__dirname, 'login.mjs'), path.join(root, 'pipeline', 'login.mjs'));
  const uninstallPs1 = pick(path.join(__dirname, 'uninstall.ps1'), path.join(root, 'installer', 'uninstall.ps1'));
  const patchScript = path.join(root, 'pipeline', 'patch.cjs');

  return { root, mode, patched, login, uninstallPs1, patchScript };
})();
const rootDir = INSTALL.root;

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
  const patched = INSTALL.patched;

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
  if (INSTALL.mode === 'dist' || !fs.existsSync(INSTALL.patchScript)) {
    // dist install lost its binary, or dev install has no patch.cjs — either
    // way, pointing at the installer is the only recovery.
    console.error('[silly] Patched binary missing. Reinstall:');
    console.error('  irm https://raw.githubusercontent.com/hilyfux/silly-code/main/install.ps1 | iex');
    process.exit(1);
  }
  console.log('[silly] Building patched binary (first run)...');
  const r = spawnSync(process.execPath, [INSTALL.patchScript], { stdio: 'inherit', cwd: rootDir });
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
      const r = spawnSync(process.execPath, [INSTALL.login, 'codex'], { stdio: 'inherit' });
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
    case 'cron':
      return cmdCron(rest);
    case 'report':
      return cmdReport(dataDir, rest);
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
  const hasVersions = fs.existsSync(path.join(rootDir, 'versions'));
  const hasPipeline = fs.existsSync(path.join(rootDir, 'pipeline'));
  console.log('');
  console.log('  silly-code doctor');
  console.log('');
  console.log(`  ✓ Node: ${process.version}`);
  console.log(`  ✓ Platform: ${process.platform} ${process.arch}`);
  console.log(`  ${patchedOk ? '✓' : '✗'} Patched binary: ${patchedOk ? 'found' : 'missing (run: silly login claude OR sillyx)'}`);
  if (hasVersions && hasPipeline) {
    console.log(`  ⚠ Layout ambiguous: both ${rootDir}/versions/ and ${rootDir}/pipeline/ exist — dist + dev copies overlap. Remove one to pick a single source of truth.`);
  }
  console.log('');
  renderAuthLines(dataDir);
  console.log('');
  console.log('  Mode: patched binary (upstream + silly-code patches)');
  // Ripgrep detection — parity with bash doctor's `command -v rg`. On Windows
  // install.ps1 places rg.exe at ~/.local/bin/rg.exe if not already on PATH;
  // check both to cover system-installed and installer-shipped layouts.
  const rgOnPath = spawnSync(isWindows ? 'where' : 'which', ['rg'], { encoding: 'utf8' });
  if (rgOnPath.status === 0) {
    const v = spawnSync('rg', ['--version'], { encoding: 'utf8' });
    const first = (v.stdout || '').split('\n')[0].trim();
    console.log(`  ✓ ripgrep: ${first || 'found on PATH'}`);
  } else if (isWindows) {
    const fallback = path.join(os.homedir(), '.local', 'bin', 'rg.exe');
    if (fs.existsSync(fallback)) {
      const v = spawnSync(fallback, ['--version'], { encoding: 'utf8' });
      const first = (v.stdout || '').split('\n')[0].trim();
      console.log(`  ✓ ripgrep: ${first || fallback} (installer copy)`);
    } else {
      console.log('  ⚠ ripgrep: not found (file search will be slow — run: silly update)');
    }
  } else {
    console.log('  ⚠ ripgrep: not found (file search will be slow — run: silly update)');
  }
  // Git detection — parity with bash doctor's `command -v git` check (bin/silly:123).
  // Optional dependency: needed for dev `silly update` (git pull) + version/commit
  // readout from HEAD. Windows dist installs without git still work via installer
  // re-run, so this is a soft warning like ripgrep above.
  const gitOnPath = spawnSync(isWindows ? 'where' : 'which', ['git'], { encoding: 'utf8' });
  if (gitOnPath.status === 0) {
    const v = spawnSync('git', ['--version'], { encoding: 'utf8' });
    const first = (v.stdout || '').split('\n')[0].trim();
    console.log(`  ✓ Git: ${first || 'found on PATH'}`);
  } else {
    console.log('  ⚠ Git: not found (optional — needed for `silly update` in dev installs)');
  }
  // Adapter compat probe — dev installs only (tests/ not in dist)
  const compatTest = path.join(rootDir, 'tests', 'compat.test.cjs');
  if (fs.existsSync(compatTest)) {
    const r = spawnSync(process.execPath, [compatTest], { encoding: 'utf8' });
    if (r.status === 0) {
      const m = /(\d+) passed, 0 failed/.exec(r.stdout || '');
      console.log(`  ✓ Adapter compat: ${m ? m[1] : 'all'} assertions green`);
    } else {
      console.log('  ✗ Adapter compat: FAILED — run: node tests/compat.test.cjs');
    }
  }
  console.log('');
}

function cmdLogin(provider, patched) {
  if (provider === 'codex') {
    const r = spawnSync(process.execPath, [INSTALL.login, 'codex'], { stdio: 'inherit' });
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
  } else if (provider === 'codex') {
    console.log('[silly] Codex tokens removed');
  }
}

function cmdUpdate() {
  // dist install: no git, no patch.cjs. Point user at the installer.
  if (INSTALL.mode === 'dist') {
    console.log('[silly] Updating via installer...');
    const r = spawnSync('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
       'irm https://raw.githubusercontent.com/hilyfux/silly-code/main/install.ps1 | iex'],
      { stdio: 'inherit' });
    process.exit(r.status ?? 0);
  }
  const r = spawnSync('git', ['-C', rootDir, 'pull', '--ff-only', 'origin', 'main'], { stdio: ['inherit', 'pipe', 'inherit'] });
  if (r.status !== 0) {
    console.error('[silly] git pull failed. Re-run the installer to recover:');
    console.error('  irm https://raw.githubusercontent.com/hilyfux/silly-code/main/install.ps1 | iex');
    process.exit(r.status ?? 1);
  }
  const out = (r.stdout?.toString() || '').trim();
  if (out) process.stdout.write(out + '\n');
  if (/Already up.to.date/i.test(out)) {
    console.log('[silly] Already up to date — skipping patch rebuild.');
    return;
  }
  const patchR = spawnSync(process.execPath, [INSTALL.patchScript], { stdio: 'inherit', cwd: rootDir });
  if (patchR.status !== 0) {
    console.error('[silly] Patch rebuild failed. Re-run the installer or file an issue.');
    process.exit(patchR.status ?? 1);
  }
  console.log('[silly] Update complete.');
}

function cmdUninstall() {
  if (!fs.existsSync(INSTALL.uninstallPs1)) {
    console.error('uninstall.ps1 missing. Reinstall first or remove files manually:');
    console.error(`  ${path.join(os.homedir(), '.local', 'share', 'silly-code')}`);
    console.error(`  ${path.join(os.homedir(), '.local', 'bin', 'silly*.{cmd,ps1}')}`);
    process.exit(1);
  }
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', INSTALL.uninstallPs1], { stdio: 'inherit' });
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
  console.log('    silly report          Collect anonymized debug dumps for a bug report');
  console.log('    silly uninstall       Remove silly-code completely');
  console.log('    silly help            Show this help');
  console.log('');
  console.log('  Launch:');
  console.log('    sillyx                Start with Codex');
  console.log('    sillye                Start with Claude');
  console.log('');
}

// Windows parity for `silly cron` (Unix provides launchd/cron auto-update).
// Schedulers here are platform-specific:
//   - macOS/Linux: launchd / crontab (see bin/silly + install-upgrade-cron.sh)
//   - Windows:     Task Scheduler (not yet implemented; direct user to manual update)
// Keeping this as a helpful stub instead of silently exiting means Windows
// users get a clear explanation + workaround rather than "Unknown subcommand".
function cmdCron(rest) {
  const sub = rest[0] || 'status';
  console.log('');
  console.log('  silly cron — background updates');
  console.log('');
  if (sub === 'install' || sub === 'uninstall' || sub === 'status' || sub === 'run') {
    console.log('  Automatic background updates on Windows are not yet supported.');
    console.log('  (macOS/Linux use launchd / crontab; a Task Scheduler port is pending.)');
    console.log('');
    console.log('  Workaround: run `silly update` manually, or schedule via Windows');
    console.log('  Task Scheduler to execute:');
    console.log(`    node "${path.join(rootDir, 'bin', 'upgrade-check.sh')}"   (Git Bash / WSL)`);
    console.log('');
    console.log('  Track progress: https://github.com/hilyfux/silly-code/issues');
    console.log('');
    return;
  }
  console.error(`  Unknown cron subcommand: ${sub}`);
  console.error('  Usage: silly cron {install|uninstall|status|run}');
  process.exit(1);
}

// Windows parity for `silly report`. Produces an anonymized debug bundle the
// user can attach to a GitHub issue. Mirrors the bash version in bin/silly but
// uses cross-platform APIs (os.tmpdir, path.join, fs.*) instead of tar/whoami.
function cmdReport(dataDir, rest) {
  const debugDir = path.join(os.tmpdir(), 'silly-debug');
  const reportsDir = path.join(dataDir, 'reports');
  let dumps = [];
  try { dumps = fs.readdirSync(debugDir).filter(f => f.endsWith('.json')); } catch {}
  if (!dumps.length) {
    console.log('');
    console.log('  No debug dumps found in ' + debugDir);
    console.log('');
    console.log('  To capture one:');
    console.log('    set SILLY_DEBUG_DUMP=1 && sillyx      (PowerShell: $env:SILLY_DEBUG_DUMP=1)');
    console.log('');
    console.log('  Reproduce the issue, then re-run `silly report`.');
    console.log('');
    process.exit(1);
  }
  fs.mkdirSync(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const stage = path.join(reportsDir, stamp);
  fs.mkdirSync(stage, { recursive: true });

  const user = (os.userInfo().username || '').trim();
  const home = os.homedir();
  const redact = (s) => {
    if (home) s = s.split(home).join('REDACTED_HOME');
    if (user) s = s.split(user).join('REDACTED_USER');
    return s
      .replace(/Bearer\s+[A-Za-z0-9._\-]{10,}/g, 'Bearer REDACTED_TOKEN')
      .replace(/sk-[A-Za-z0-9_\-]{10,}/g, 'REDACTED_SK')
      .replace(/eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, 'REDACTED_JWT')
      .replace(/gho_[A-Za-z0-9]{30,}/g, 'REDACTED_GH_TOKEN')
      .replace(/ghp_[A-Za-z0-9]{30,}/g, 'REDACTED_GH_PAT');
  };
  let kept = 0;
  for (const f of dumps) {
    try {
      const src = fs.readFileSync(path.join(debugDir, f), 'utf8');
      fs.writeFileSync(path.join(stage, f), redact(src));
      kept++;
    } catch {}
  }

  const upstream = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(rootDir, 'deps.json'), 'utf8')).deps.upstream.version; }
    catch { return 'unknown'; }
  })();
  fs.writeFileSync(path.join(stage, 'context.txt'),
    `silly-code report\n` +
    `=================\n` +
    `timestamp: ${new Date().toISOString()}\n` +
    `version:   ${INSTALL.mode}${INSTALL.mode === 'dev' ? '' : ''}\n` +
    `upstream:  ${upstream}\n` +
    `node:      ${process.version}\n` +
    `os:        ${process.platform} ${process.arch} ${os.release()}\n` +
    `dumps:     ${kept}\n`
  );

  console.log('');
  console.log(`  Report staged: ${stage}`);
  console.log(`    ${kept} anonymized dump(s) + context.txt (no PII)`);
  console.log('');
  console.log('  Next steps:');
  console.log(`    1. Zip the folder:  Compress-Archive "${stage}" "${stage}.zip"`);
  console.log('    2. Open https://github.com/hilyfux/silly-code/issues/new');
  console.log('    3. Drag the .zip into the issue comment');
  console.log('');
  if ((rest || [])[0] === '--submit') {
    console.log('  (`--submit` requires gh CLI; not implemented on Windows launcher.)');
    console.log('');
  }
}
