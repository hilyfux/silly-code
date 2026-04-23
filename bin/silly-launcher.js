#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { AUTH_FILES, authState } from './silly-auth.js';

// Make silent-failure impossible. Iter 100 cascade taught us that on Windows a
// spawn-and-vanish (no stderr, just a returned prompt) is the worst possible UX
// because users cannot self-diagnose. Globally surface every uncaught error to
// stderr with a clear marker, and emit a one-line trace of every step when
// SILLY_DEBUG=1 — cheap, opt-in, lets `silly report` capture full launch trail.
process.on('uncaughtException', (e) => {
  process.stderr.write(`[silly-launcher] uncaught: ${e && e.stack || e}\n`);
  process.exit(2);
});
process.on('unhandledRejection', (e) => {
  process.stderr.write(`[silly-launcher] unhandled: ${e && e.stack || e}\n`);
  process.exit(2);
});
const DEBUG = process.env.SILLY_DEBUG === '1' || process.env.SILLY_DEBUG === 'true';
const dbg = (...a) => { if (DEBUG) process.stderr.write(`[silly-debug] ${a.join(' ')}\n`); };

// ── Boot trace + silent-hang watchdog (Windows P0 triage) ────────────────────
// Two independent safety nets that together make a silent hang self-diagnosing:
//
//   (1) SILLY_TRACE_BOOT=1  →  per-step elapsed-ms line on stderr so the user
//       can see WHERE boot stalls. Zero cost when flag is unset.
//
//   (2) Watchdog             →  if boot doesn't reach the `spawn(cli-patched)`
//       handoff within 30s, print a clear explanation + exit 42 so the user
//       never sees a mute prompt. Opt-out via SILLY_NO_BOOT_WATCHDOG=1 for CI
//       or embedded use. Uses .unref() so it never keeps the event loop alive
//       on normal paths — success spawn clears it before the timer fires.
//
// 30s rationale: cold `node pipeline/patch.cjs` on a clean machine takes
// ~8-12s (patch + vendor-ws copy). Doctor runs spawnSync(compat.test.cjs)
// which adds ~2-4s. 30s gives 3× headroom; real hangs are usually infinite
// (TTY read, network with no timeout), not "almost done in 35s".
const TRACE_BOOT = process.env.SILLY_TRACE_BOOT === '1' || process.env.SILLY_TRACE_BOOT === 'true';
const _bootT0 = Date.now();
const trace = (tag) => {
  if (TRACE_BOOT) process.stderr.write(`[silly-boot +${Date.now() - _bootT0}ms] ${tag}\n`);
};
trace('silly-launcher.js top');

const WATCHDOG_MS = Number(process.env.SILLY_BOOT_WATCHDOG_MS) || 30_000;
const WATCHDOG_ENABLED = process.env.SILLY_NO_BOOT_WATCHDOG !== '1';
let _bootWatchdog = null;
if (WATCHDOG_ENABLED) {
  _bootWatchdog = setTimeout(() => {
    process.stderr.write(
      `\n[silly] startup did not complete within ${WATCHDOG_MS}ms — likely a blocking I/O call.\n` +
      `[silly] Re-run with SILLY_TRACE_BOOT=1 to see per-step progress:\n` +
      `[silly]   PowerShell:  $env:SILLY_TRACE_BOOT=1; sillye\n` +
      `[silly]   cmd.exe:     set SILLY_TRACE_BOOT=1 && sillye\n` +
      `[silly]   bash:        SILLY_TRACE_BOOT=1 sillye\n` +
      `[silly] Or disable the watchdog:   SILLY_NO_BOOT_WATCHDOG=1\n` +
      `[silly] File an issue: https://github.com/hilyfux/silly-code/issues (tag: windows-hang)\n`
    );
    process.exit(42);  // stable exit code for "boot watchdog fired"
  }, WATCHDOG_MS);
  // unref() so this timer alone never blocks a clean exit — the parent event
  // loop can close as soon as spawn() has detached its child handle.
  _bootWatchdog.unref();
}
// Call once we've successfully handed off to the child process. Any path
// that reaches `spawn(patched, ...)` clears the watchdog; pre-spawn errors
// (missing binary, login failure) call process.exit() which tears down the
// timer anyway.
function clearBootWatchdog(reason) {
  if (_bootWatchdog) {
    clearTimeout(_bootWatchdog);
    _bootWatchdog = null;
    trace(`watchdog cleared (${reason})`);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const command = process.env.SILLY_TARGET_COMMAND;
const isWindows = process.platform === 'win32';
dbg('boot', `cmd=${command} cwd=${process.cwd()} dir=${__dirname} platform=${process.platform} node=${process.version}`);
trace(`boot cmd=${command} platform=${process.platform} node=${process.version}`);

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

  // Runtime deps (ws) ship at $root/.deps/node_modules in dist mode; dev mode
  // uses the repo's top-level node_modules (standard npm resolution).
  const depsModules = path.join(root, '.deps', 'node_modules');
  const nodePath = mode === 'dist' && fs.existsSync(depsModules) ? depsModules : null;

  return { root, mode, patched, login, uninstallPs1, patchScript, nodePath };
})();
const rootDir = INSTALL.root;
dbg('install', `root=${INSTALL.root} mode=${INSTALL.mode} patched=${INSTALL.patched} exists=${fs.existsSync(INSTALL.patched)} nodePath=${INSTALL.nodePath || '(none)'}`);
trace(`install resolved mode=${INSTALL.mode} root=${INSTALL.root} patched=${INSTALL.patched} exists=${fs.existsSync(INSTALL.patched)}`);

if (!command) {
  console.error('Missing SILLY_TARGET_COMMAND');
  process.exit(1);
}

if (!isWindows) {
  const target = path.join(__dirname, command);
  trace(`spawn unix target=${target}`);
  const child = spawn(target, process.argv.slice(2), { stdio: 'inherit', shell: false });
  clearBootWatchdog('unix-spawn');
  child.on('exit', code => process.exit(code ?? 0));
  child.on('error', err => { console.error(err.message); process.exit(1); });
} else {
  trace('enter runOnWindows');
  await runOnWindows();
}

async function runOnWindows() {
  trace('runOnWindows: resolve dataDir');
  const dataDir = process.env.SILLY_CODE_DATA || path.join(os.homedir(), '.silly-code');
  fs.mkdirSync(dataDir, { recursive: true });
  // Pin the resolved dataDir for every child process (login.mjs, cli-patched.js)
  // so a bare HOME env or cwd change can never re-route tokens.
  process.env.SILLY_CODE_DATA = dataDir;
  const patched = INSTALL.patched;
  trace(`runOnWindows: dataDir=${dataDir} dispatch cmd=${command}`);

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
  if (fs.existsSync(patched)) { trace('ensurePatched: binary present'); return; }
  if (INSTALL.mode === 'dist' || !fs.existsSync(INSTALL.patchScript)) {
    // dist install lost its binary, or dev install has no patch.cjs — either
    // way, pointing at the installer is the only recovery.
    console.error('[silly] Patched binary missing. Reinstall:');
    console.error('  irm https://raw.githubusercontent.com/hilyfux/silly-code/main/install.ps1 | iex');
    process.exit(1);
  }
  console.log('[silly] Building patched binary (first run)...');
  trace('ensurePatched: spawnSync patch.cjs (may take 10-20s)');
  const r = spawnSync(process.execPath, [INSTALL.patchScript], { stdio: 'inherit', cwd: rootDir });
  trace(`ensurePatched: patch.cjs exit=${r.status}`);
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
  trace(`launchProvider: name=${name}`);
  if (info.env) process.env[info.env] = '1';
  const loggedIn = providerLoggedIn(info.authKey, dataDir);
  dbg('provider', `name=${name} env=${info.env || '(none)'} loggedIn=${loggedIn}`);
  trace(`launchProvider: loggedIn=${loggedIn}`);
  if (!loggedIn) {
    if (name === 'sillyx') {
      console.log(`\n  ${name} — ${info.label}\n`);
      console.log('[silly] Not logged in. Starting login now...\n');
      dbg('login', `spawn ${process.execPath} ${INSTALL.login} codex`);
      trace('launchProvider: spawnSync login.mjs');
      const r = spawnSync(process.execPath, [INSTALL.login, 'codex'], { stdio: 'inherit' });
      dbg('login', `exit=${r.status}`);
      trace(`launchProvider: login.mjs exit=${r.status}`);
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
  dbg('spawn', `${process.execPath} ${patched} ${userArgs.join(' ')}`);
  trace(`launchProvider: spawn cli-patched.js (${patched})`);

  // ── Downstream TUI silent-hang safety net (Iter 103) ──
  //
  // Problem: on some Windows terminals (ConEmu, nested shells, unusual raw-mode
  // implementations), the upstream Ink/React TUI can block forever on its first
  // terminal-size query / raw-mode setup. With `stdio: 'inherit'` the launcher
  // has zero visibility — child produces no output and never exits, user sees
  // an unblinking prompt and cannot self-diagnose.
  //
  // Fix: pipe child stdout/stderr through the launcher so (a) we forward every
  // byte to the user's terminal (preserving Ink's output fidelity), and (b) we
  // can observe the FIRST byte to confirm TUI woke up. That first-output event
  // both clears the boot watchdog and disarms a separate downstream watchdog
  // that fires if no output arrives within N seconds. stdin stays 'inherit'
  // because the TUI must read keyboard directly.
  //
  // Env flags (all independent of the boot watchdog):
  //   SILLY_DOWNSTREAM_WATCHDOG_MS=30000   override timeout (default 10000ms)
  //   SILLY_NO_DOWNSTREAM_WATCHDOG=1       disable entirely (old/slow machines)
  //
  // Exit codes:
  //   45 = downstream TUI silent-hang fired (stable contract, mirrors 42)
  //   46 = spawn() itself failed (binary missing / ENOENT / etc.)
  const sp = spawn(process.execPath, [patched, ...userArgs], {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: spawnEnv(),
  });

  let _firstOutputSeen = false;
  const _markOutput = (src) => {
    if (!_firstOutputSeen) {
      _firstOutputSeen = true;
      clearBootWatchdog('first-output-' + src);
      trace(`launchProvider: first downstream output on ${src}`);
    }
  };
  sp.stdout.on('data', (chunk) => { _markOutput('stdout'); process.stdout.write(chunk); });
  sp.stderr.on('data', (chunk) => { _markOutput('stderr'); process.stderr.write(chunk); });

  const DOWNSTREAM_WATCHDOG_MS = Number(process.env.SILLY_DOWNSTREAM_WATCHDOG_MS) || 10_000;
  const DOWNSTREAM_WATCHDOG_ENABLED = process.env.SILLY_NO_DOWNSTREAM_WATCHDOG !== '1';
  let _downstreamDeadline = null;
  // Flag so the sp.on('exit') handler knows we're tearing down intentionally
  // and MUST exit 45 rather than whatever exit code the killed child produces.
  // Without this, SIGTERM wins the race against the kill-then-exit timer and
  // the process leaks out as exit 0, hiding the silent-hang diagnosis.
  let _watchdogFired = false;
  if (DOWNSTREAM_WATCHDOG_ENABLED) {
    _downstreamDeadline = setTimeout(() => {
      if (_firstOutputSeen) return;
      _watchdogFired = true;
      process.stderr.write(
        `\n[silly][FATAL] Claude Code TUI did not emit any output within ${DOWNSTREAM_WATCHDOG_MS}ms.\n` +
        `[silly][FATAL] Likely cause: terminal raw-mode/query incompatibility (ConEmu, nested shells, etc.).\n` +
        `[silly][FATAL] Workaround: use non-TTY mode — sillye -p "your prompt"\n` +
        `[silly][FATAL] Or try a different terminal (Windows Terminal, pure PowerShell, cmd.exe).\n` +
        `[silly][FATAL] Override timeout: SILLY_DOWNSTREAM_WATCHDOG_MS=30000\n` +
        `[silly][FATAL] Disable entirely: SILLY_NO_DOWNSTREAM_WATCHDOG=1\n`
      );
      try { sp.kill('SIGTERM'); } catch {}
      // SIGKILL escalation + force-exit 45 as a last resort. NOT .unref()'d —
      // if the child dies instantly from SIGTERM, sp.on('exit') fires first
      // and calls process.exit(45) via the _watchdogFired branch below. If
      // the child resists SIGTERM, this 2s timer ensures we don't hang forever.
      setTimeout(() => {
        try { sp.kill('SIGKILL'); } catch {}
        process.exit(45);  // stable "downstream silent hang" contract
      }, 2000);
    }, DOWNSTREAM_WATCHDOG_MS);
    _downstreamDeadline.unref();  // never block clean exit
  }

  sp.on('exit', code => {
    if (_downstreamDeadline) clearTimeout(_downstreamDeadline);
    dbg('child', `exit code=${code}`);
    trace(`launchProvider: child exit code=${code}`);
    if (_watchdogFired) process.exit(45);  // watchdog-induced kill, preserve 45
    // Zero-output-exit guard: child exited fast (<10s watchdog) but emitted
    // nothing to stdout/stderr. Most likely causes: auth token expired, API
    // call rejected silently, upstream cli.js init-time fast-exit. Don't let
    // this class of silent-success-exit go unnoticed.
    if (!_firstOutputSeen && process.env.SILLY_NO_ZERO_OUTPUT_GUARD !== '1') {
      process.stderr.write(
        '[silly][FATAL] Child exited (code=' + code + ') without emitting any output.\n' +
        '[silly][FATAL] Likely causes: (1) auth token expired — run: silly login claude  (or silly login codex)\n' +
        '[silly][FATAL]                (2) upstream init-time fast-exit (Windows + cli.js bug)\n' +
        '[silly][FATAL]                (3) SSL/network unreachable without emitting error\n' +
        '[silly][FATAL] Diagnose: SILLY_TRACE_BOOT=1 + silly-diag  OR  set SILLY_DEBUG_DUMP=1; sillye -p "hi"\n' +
        '[silly][FATAL] Disable guard: SILLY_NO_ZERO_OUTPUT_GUARD=1\n'
      );
      process.exit(47);  // stable contract: zero-output fast exit
    }
    process.exit(code ?? 0);
  });
  sp.on('error', err => {
    if (_downstreamDeadline) clearTimeout(_downstreamDeadline);
    process.stderr.write(`[silly][FATAL] Failed to spawn cli-patched.js: ${err.message}\n`);
    process.exit(46);  // stable "spawn failure" contract
  });
}

function spawnEnv() {
  if (!INSTALL.nodePath) return process.env;
  const sep = process.platform === 'win32' ? ';' : ':';
  const existing = process.env.NODE_PATH || '';
  return { ...process.env, NODE_PATH: existing ? `${INSTALL.nodePath}${sep}${existing}` : INSTALL.nodePath };
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
    case 'clean-claude-settings':
      return cmdCleanClaudeSettings();
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
  // Track whether any check printed a warning (⚠) or failure (✗) so we can
  // tail the output with a silly-diag recommendation. Set by the inline checks
  // below — each one flips this when it prints something non-green.
  let anyAnomaly = false;
  console.log('');
  console.log('  silly-code doctor');
  console.log('');
  console.log(`  ✓ Node: ${process.version}`);
  console.log(`  ✓ Platform: ${process.platform} ${process.arch}`);
  console.log(`  ${patchedOk ? '✓' : '✗'} Patched binary: ${patchedOk ? 'found' : 'missing (run: silly login claude OR sillyx)'}`);
  if (!patchedOk) anyAnomaly = true;
  if (hasVersions && hasPipeline) {
    console.log(`  ⚠ Layout ambiguous: both ${rootDir}/versions/ and ${rootDir}/pipeline/ exist — dist + dev copies overlap. Remove one to pick a single source of truth.`);
    anyAnomaly = true;
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
      anyAnomaly = true;
    }
  } else {
    console.log('  ⚠ ripgrep: not found (file search will be slow — run: silly update)');
    anyAnomaly = true;
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
    anyAnomaly = true;
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
      anyAnomaly = true;
    }
  }
  console.log('');
  // When any check above flagged an anomaly, or if the user specifically
  // reports silent-hang symptoms (captured as SILLY_DOCTOR_HINT_DIAG=1), point
  // them at the standalone silly-diag tool. silly-diag walks the startup dep
  // chain layer-by-layer WITHOUT importing silly-launcher.js, so it survives
  // the specific failure class where `await import('./silly-launcher.js')`
  // hangs before the watchdog is armed. Opt-in recommendation only — don't
  // shout this at happy users on every doctor run.
  if (anyAnomaly || process.env.SILLY_DOCTOR_HINT_DIAG === '1') {
    console.log('  For detailed layer-by-layer diagnostics, run:');
    console.log('    silly-diag              (or: node ' + path.join(__dirname, 'silly-diag.js') + ')');
    console.log('  This probes fs, cli-patched.js, ws, child-spawn, settings, network,');
    console.log('  and a bounded silly-launcher import — useful when sillye/sillyx hang silently.');
    console.log('');
  }
}

function cmdLogin(provider, patched) {
  if (provider === 'codex') {
    const r = spawnSync(process.execPath, [INSTALL.login, 'codex'], { stdio: 'inherit' });
    process.exit(r.status ?? 0);
  }
  if (provider === 'claude') {
    ensurePatched(patched);
    console.log('[silly] Launching Silly Code — use /login inside the TUI to sign in to claude.ai');
    const child = spawn(process.execPath, [patched], { stdio: 'inherit', env: spawnEnv() });
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
  console.log('    silly clean-claude-settings  Strip foreign model pollution from ~/.claude/settings.json');
  console.log('    silly uninstall       Remove silly-code completely');
  console.log('    silly help            Show this help');
  console.log('');
  console.log('  Launch:');
  console.log('    sillyx                Start with Codex');
  console.log('    sillye                Start with Claude');
  console.log('');
}

// Strip non-Claude `model` pollution from ~/.claude/settings.json.
// Delegates to the shared clean-claude-settings CJS module so the logic is
// identical between bash (bin/silly clean-claude-settings) and Node
// (silly-launcher for Windows).
function cmdCleanClaudeSettings() {
  // The helper is CommonJS; require() via createRequire to avoid ESM import fuss.
  const { createRequire } = require('node:module');
  const localRequire = createRequire(import.meta.url);
  const helper = localRequire('./clean-claude-settings.cjs');
  console.log('');
  console.log('  silly clean-claude-settings');
  console.log('');
  const results = helper.cleanClaudeSettings({ log: (m) => console.log(m) });
  let changed = 0;
  for (const r of results) {
    if (r.changed) {
      console.log(`  cleaned: ${r.path}`);
      console.log(`    removed model=${r.strippedModel}`);
      console.log(`    kept keys: ${(r.keptKeys || []).join(', ') || '(none)'}`);
      changed++;
    } else {
      console.log(`  skipped: ${r.path} (${r.reason})`);
    }
  }
  console.log('');
  console.log(changed === 0 ? '  No pollution found.' : `  ${changed} file(s) cleaned.`);
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
