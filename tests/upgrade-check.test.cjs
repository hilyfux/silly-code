const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(__dirname, '..', 'bin', 'upgrade-check.sh');

function runCase(name, extraEnv) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-check-test-'));
  const logDir = path.join(tmp, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  // Every case gets an isolated stamp file so tests never pollute
  // .knowledge-graph/.upgrade-check-agent-stamp in the real repo, and so
  // a dedup test case can't leak state into an unrelated case. Callers can
  // override via SILLY_UPGRADE_CHECK_STAMP_FILE in extraEnv if they need to
  // pre-seed or inspect the file.
  const defaultStamp = path.join(tmp, 'agent-stamp');
  const result = spawnSync('bash', [script], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      SILLY_UPGRADE_CHECK_DRY_RUN: '1',
      SILLY_UPGRADE_CHECK_ASSUME_CLEAN: '1',
      SILLY_UPGRADE_CHECK_ASSUME_SYNCED: '1',
      SILLY_UPGRADE_CHECK_CURRENT_VERSION: '2.1.108-test',
      SILLY_UPGRADE_CHECK_LATEST_VERSION: '2.1.109-test',
      SILLY_UPGRADE_CHECK_LOG_DIR: logDir,
      SILLY_UPGRADE_CHECK_STAMP_FILE: defaultStamp,
      ...extraEnv,
    },
  });

  const combined = `${result.stdout || ''}${result.stderr || ''}`;
  return { name, tmp, logDir, result, combined, stampFile: extraEnv.SILLY_UPGRADE_CHECK_STAMP_FILE || defaultStamp };
}

(function main() {
  {
    // Iter 63: lock the exit-code contract docstring. It's the only mechanism
    // protecting the script's behavioral contract from silent drift — a future
    // edit that removes the contract header must fail this test loudly.
    const src = fs.readFileSync(script, 'utf8');
    assert.match(src, /EXIT-CODE CONTRACT \(locked by tests\/upgrade-check\.test\.cjs\)/, 'docstring must retain the EXIT-CODE CONTRACT header');
    assert.match(src, /0 — no-op this slot/, 'docstring must enumerate exit 0 conditions');
    assert.match(src, /1 — hard stop/, 'docstring must enumerate exit 1 conditions');
    assert.match(src, /ENV OVERRIDES \(for tests only — never set in production\)/, 'docstring must mark ENV OVERRIDES as test-only');
    console.log('  exit-code contract docstring present: PASS');
  }

  {
    const run = runCase('fallback-uses-sillyx-only', {
      SILLY_UPGRADE_CHECK_CI_EXIT: '2',
      SILLY_UPGRADE_CHECK_AGENT_CMD: '/tmp/fake-sillyx',
      SILLY_UPGRADE_CHECK_NO_EXEC: '1',
    });

    assert.strictEqual(run.result.status, 0, run.combined);
    assert.match(run.combined, /current=2\.1\.108-test latest=2\.1\.109-test/);
    assert.match(run.combined, /ci-upgrade exit 2 — manual rename sweep needed, will invoke sillyx/);
    assert.match(run.combined, /dry-run: would run git reset --hard HEAD --quiet/);
    assert.match(run.combined, /dry-run: would exec \/tmp\/fake-sillyx -p <prompt> --dangerously-skip-permissions/);
    assert.match(run.combined, /ci-upgrade\.cjs just ran and exited 2 \(partial failure/);
    assert.doesNotMatch(run.combined, /invoking claude agent/);
    assert.doesNotMatch(run.combined, /command -v claude/);
    assert.doesNotMatch(run.combined, /'sillyx' or 'claude'/);
    console.log('  fallback uses sillyx only: PASS');
  }

  {
    const run = runCase('missing-sillyx-stops-cleanly', {
      SILLY_UPGRADE_CHECK_CI_EXIT: '2',
      PATH: '/usr/bin:/bin',
    });

    assert.strictEqual(run.result.status, 1, run.combined);
    assert.match(run.combined, /no 'sillyx' binary available — stopping/);
    assert.doesNotMatch(run.combined, /command -v claude/);
    assert.doesNotMatch(run.combined, /'sillyx' or 'claude'/);
    assert.doesNotMatch(run.combined, /invoking claude agent/);
    console.log('  missing sillyx stops cleanly: PASS');
  }

  // Iter 64 — agent dedup stamp behavior.
  // A pending LATEST that failed once must not re-spawn sillyx every slot.
  // Three scenarios:
  //   (a) fresh stamp for the same LATEST → downgrade to dedup_skip, no exec
  //   (b) stale stamp beyond window → stamp ignored, sillyx runs normally
  //   (c) successful needs_agent run writes the stamp file before exec
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-check-dedup-a-'));
    const stampFile = path.join(tmp, 'stamp');
    const now = 1_700_000_000;
    fs.writeFileSync(stampFile, `2.1.109-test|${now - 60}\n`); // 60s old, window 3600s
    const run = runCase('dedup-skips-fresh-stamp', {
      SILLY_UPGRADE_CHECK_CI_EXIT: '2',
      SILLY_UPGRADE_CHECK_AGENT_CMD: '/tmp/fake-sillyx',
      SILLY_UPGRADE_CHECK_NO_EXEC: '1',
      SILLY_UPGRADE_CHECK_STAMP_FILE: stampFile,
      SILLY_UPGRADE_CHECK_DEDUP_WINDOW: '3600',
      SILLY_UPGRADE_CHECK_NOW_EPOCH: String(now),
    });
    assert.strictEqual(run.result.status, 0, run.combined);
    assert.match(run.combined, /dedup: sillyx already invoked for 2\.1\.109-test within 3600s window — skipping upgrade path this slot/);
    // Privacy clean + dedup_skip → exit before exec
    assert.match(run.combined, /all tasks clean — no agent needed today/);
    assert.doesNotMatch(run.combined, /dry-run: would exec \/tmp\/fake-sillyx/);
    console.log('  dedup skips fresh stamp: PASS');
  }

  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-check-dedup-b-'));
    const stampFile = path.join(tmp, 'stamp');
    const now = 1_700_000_000;
    fs.writeFileSync(stampFile, `2.1.109-test|${now - 7200}\n`); // 2h old, window 3600s
    const run = runCase('dedup-ignores-stale-stamp', {
      SILLY_UPGRADE_CHECK_CI_EXIT: '2',
      SILLY_UPGRADE_CHECK_AGENT_CMD: '/tmp/fake-sillyx',
      SILLY_UPGRADE_CHECK_NO_EXEC: '1',
      SILLY_UPGRADE_CHECK_STAMP_FILE: stampFile,
      SILLY_UPGRADE_CHECK_DEDUP_WINDOW: '3600',
      SILLY_UPGRADE_CHECK_NOW_EPOCH: String(now),
    });
    assert.strictEqual(run.result.status, 0, run.combined);
    assert.doesNotMatch(run.combined, /dedup: sillyx already invoked/);
    assert.match(run.combined, /dry-run: would exec \/tmp\/fake-sillyx/);
    // Stale stamp should have been overwritten with fresh one
    const written = fs.readFileSync(stampFile, 'utf8').trim();
    assert.match(written, /^2\.1\.109-test\|1700000000$/, `stamp contents: ${written}`);
    console.log('  dedup ignores stale stamp and re-stamps: PASS');
  }

  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-check-dedup-c-'));
    const stampFile = path.join(tmp, 'stamp');
    const now = 1_700_000_000;
    // No pre-existing stamp — the run itself must create one before exec.
    const run = runCase('dedup-writes-stamp-before-exec', {
      SILLY_UPGRADE_CHECK_CI_EXIT: '2',
      SILLY_UPGRADE_CHECK_AGENT_CMD: '/tmp/fake-sillyx',
      SILLY_UPGRADE_CHECK_NO_EXEC: '1',
      SILLY_UPGRADE_CHECK_STAMP_FILE: stampFile,
      SILLY_UPGRADE_CHECK_DEDUP_WINDOW: '3600',
      SILLY_UPGRADE_CHECK_NOW_EPOCH: String(now),
    });
    assert.strictEqual(run.result.status, 0, run.combined);
    assert.match(run.combined, /dry-run: would exec \/tmp\/fake-sillyx/);
    assert.ok(fs.existsSync(stampFile), 'stamp file must exist after needs_agent run');
    const written = fs.readFileSync(stampFile, 'utf8').trim();
    assert.match(written, /^2\.1\.109-test\|1700000000$/, `stamp contents: ${written}`);
    console.log('  needs_agent run writes stamp before exec: PASS');
  }

  console.log('upgrade-check tests passed');
})();
