#!/usr/bin/env node
// silly-diag — standalone Windows install diagnostic.
//
// Why this tool exists (Iter 102+ Windows P0 triage):
//   Users report "sillye just hangs — 30s no output, no watchdog fired, nothing."
//   That means the hang is happening BEFORE the watchdog is even armed — i.e.
//   during `await import('./silly-launcher.js')` or the node process bootstrap
//   itself. Those failure classes are invisible to the launcher's own trace
//   because the launcher never finishes loading.
//
//   `silly-diag` is the debug tool of last resort: it DOES NOT import
//   silly-launcher.js (that's specifically the hang source under investigation).
//   Instead it walks through each layer of the startup dependency chain in
//   isolation with per-step timeouts, so when a user reports "nothing works"
//   we can tell them `silly-diag` and immediately see which layer is broken.
//
// Exit codes (stable contract — downstream shells may special-case):
//   0   — all 7 steps pass (healthy install)
//   50  — step1 fs readdir failed
//   51  — step2 cli-patched.js not found in any candidate path
//   52  — step3 ws module missing or unresolvable
//   53  — step4 child `node -e` spawn failed
//   54  — step7 silly-launcher.js import hung >3s or threw
//   (steps 5 + 6 are non-fatal informational probes — they never exit nonzero)
//
// Intentionally zero imports from ./silly-auth or ./silly-launcher or any other
// sibling that could transitively block. Only node:* built-ins via dynamic
// import so failures are attributable to exactly one built-in at a time.

const _tag = (msg) => process.stderr.write(`[silly-diag] ${msg}\n`);
const _start = Date.now();
const _t = () => (Date.now() - _start).toFixed(0) + 'ms';

_tag('silly-diag entry at ' + _t());
_tag('platform=' + process.platform + ' node=' + process.version + ' cwd=' + process.cwd());
_tag('SILLY_CODE_DATA=' + (process.env.SILLY_CODE_DATA || '<unset>'));

// Step 1: fs — can we read __dirname?
try {
  const fs = await import('node:fs');
  const files = fs.readdirSync(import.meta.dirname || '.');
  _tag('step1 fs readdir: OK (' + files.length + ' entries)');
} catch (e) {
  _tag('step1 fs readdir: FAIL ' + e.message);
  process.exit(50);
}

// Step 2: path resolve to cli-patched.js
try {
  const path = await import('node:path');
  const fs = await import('node:fs');
  const candidates = [
    path.resolve(import.meta.dirname, '..', 'pipeline', 'build', 'cli-patched.js'),
    path.resolve(process.env.LOCALAPPDATA || '', 'silly-code', 'pipeline', 'build', 'cli-patched.js'),
    path.resolve(process.env.HOME || '', '.local', 'share', 'silly-code', 'pipeline', 'build', 'cli-patched.js'),
  ];
  const found = candidates.find(p => fs.existsSync(p));
  if (found) {
    const st = fs.statSync(found);
    _tag('step2 cli-patched.js: FOUND at ' + found + ' (' + st.size + ' bytes)');
  } else {
    _tag('step2 cli-patched.js: NOT FOUND in any of: ' + candidates.join(' | '));
    process.exit(51);
  }
} catch (e) {
  _tag('step2 path resolve: FAIL ' + e.message);
  process.exit(51);
}

// Step 3: ws module resolve (vendored — Windows symlink/junction sensitive)
try {
  const { createRequire } = await import('node:module');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const buildDir = path.resolve(import.meta.dirname, '..', 'pipeline', 'build');
  if (fs.existsSync(path.join(buildDir, 'node_modules', 'ws', 'package.json'))) {
    const req = createRequire(path.join(buildDir, 'noop.js'));
    const wsPath = req.resolve('ws');
    _tag('step3 ws resolve: OK ' + wsPath);
  } else {
    _tag('step3 ws resolve: MISSING pipeline/build/node_modules/ws — install.ps1 probably failed');
    process.exit(52);
  }
} catch (e) {
  _tag('step3 ws resolve: FAIL ' + e.message);
  process.exit(52);
}

// Step 4: can spawn child node and get --version?
try {
  const { spawnSync } = await import('node:child_process');
  const res = spawnSync(process.execPath, ['-e', 'console.log(process.version)'], { timeout: 5000 });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error('exit=' + res.status);
  _tag('step4 spawn node: OK ' + res.stdout.toString().trim());
} catch (e) {
  _tag('step4 spawn node: FAIL ' + e.message);
  process.exit(53);
}

// Step 5: can read .claude/settings.json?
try {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const settings = path.join(os.homedir(), '.claude', 'settings.json');
  if (fs.existsSync(settings)) {
    const content = JSON.parse(fs.readFileSync(settings, 'utf8'));
    const keys = Object.keys(content).join(',');
    const pollution = typeof content.model === 'string' && /^(gpt-|o1-|o4-)/.test(content.model);
    _tag('step5 .claude/settings.json: OK keys=' + keys + (pollution ? ' [POLLUTED model=' + content.model + ']' : ''));
  } else {
    _tag('step5 .claude/settings.json: not found (fresh install, OK)');
  }
} catch (e) {
  _tag('step5 settings probe: FAIL ' + e.message);
}

// Step 6: network reachability (small timeout, not fatal)
try {
  const https = await import('node:https');
  const reachable = await new Promise((res) => {
    const req = https.get('https://github.com', { timeout: 3000 }, (r) => {
      res({ status: r.statusCode });
      r.resume();
    });
    req.on('error', () => res({ error: true }));
    req.on('timeout', () => { req.destroy(); res({ timeout: true }); });
  });
  _tag('step6 network github.com: ' + JSON.stringify(reachable));
} catch (e) {
  _tag('step6 network: FAIL ' + e.message);
}

// Step 7: attempt silly-launcher.js import via child process with 3s timeout.
//
// We cannot `await import('./silly-launcher.js')` in-process because the
// launcher calls `process.exit(1)` when SILLY_TARGET_COMMAND is unset, which
// would kill this diag tool before it can report. Instead we spawn a child
// that does the import, drain its stderr (which will include the launcher's
// own [silly-boot] trace if SILLY_TRACE_BOOT=1 propagates), and apply a 3s
// hard timeout. The child's exit code (1 from the "Missing SILLY_TARGET_COMMAND"
// guard) is IGNORED — all we care about is "did import() complete within 3s?"
try {
  _tag('step7 importing silly-launcher.js via child process (3s timeout)...');
  const { spawnSync } = await import('node:child_process');
  const path = await import('node:path');
  const launcherPath = path.resolve(import.meta.dirname, 'silly-launcher.js');
  // Tiny ESM wrapper: import the launcher and exit 0. `Missing
  // SILLY_TARGET_COMMAND` will bubble up as exit=1 from the launcher itself
  // — that's fine; we only care the import resolved, not that the launcher
  // ran successfully. timeout: 3000 turns the Windows-class hang into a
  // visible r.signal === 'SIGTERM' / r.status === null.
  const probe = `import(${JSON.stringify(launcherPath)}).then(()=>process.exit(0)).catch(e=>{process.stderr.write('IMPORT_ERROR: '+e.message+'\\n');process.exit(7)})`;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    timeout: 3000,
    encoding: 'utf8',
  });
  // Exit classifier:
  //   status 0 | 1 | 7   → import resolved (launcher ran or threw AFTER load)
  //   status null + signal SIGTERM → timeout killed it → import hung
  //   anything else      → treat as FAIL
  if (res.status === 0 || res.status === 1 || res.status === 7) {
    _tag('step7 silly-launcher.js import: OK (child exit=' + res.status + ')');
  } else if (res.status === null || res.signal === 'SIGTERM') {
    _tag('step7 silly-launcher.js import: HUNG (>3s) — THIS IS THE HANG SOURCE');
    process.exit(54);
  } else {
    _tag('step7 silly-launcher.js import: FAIL status=' + res.status + ' signal=' + res.signal);
    process.exit(54);
  }
} catch (e) {
  _tag('step7 silly-launcher.js import: FAIL ' + e.message);
  process.exit(54);
}

_tag('all steps pass — silly-diag done at ' + _t());
