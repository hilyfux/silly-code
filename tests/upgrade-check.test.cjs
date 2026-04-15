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
      ...extraEnv,
    },
  });

  const combined = `${result.stdout || ''}${result.stderr || ''}`;
  return { name, tmp, logDir, result, combined };
}

(function main() {
  {
    const run = runCase('fallback-uses-sillyx-only', {
      SILLY_UPGRADE_CHECK_CI_EXIT: '2',
      SILLY_UPGRADE_CHECK_AGENT_CMD: '/tmp/fake-sillyx',
      SILLY_UPGRADE_CHECK_NO_EXEC: '1',
    });

    assert.strictEqual(run.result.status, 0, run.combined);
    assert.match(run.combined, /current=2\.1\.108-test latest=2\.1\.109-test/);
    assert.match(run.combined, /ci-upgrade couldn't fully resolve — invoking sillyx agent/);
    assert.match(run.combined, /dry-run: would run git reset --hard HEAD --quiet/);
    assert.match(run.combined, /dry-run: would exec \/tmp\/fake-sillyx -p <prompt> --dangerously-skip-permissions/);
    assert.match(run.combined, /ci-upgrade\.cjs just tried and exited 2 \(partial failure\)/);
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
    assert.match(run.combined, /no 'sillyx' binary is available — stopping/);
    assert.doesNotMatch(run.combined, /command -v claude/);
    assert.doesNotMatch(run.combined, /'sillyx' or 'claude'/);
    assert.doesNotMatch(run.combined, /invoking claude agent/);
    console.log('  missing sillyx stops cleanly: PASS');
  }

  console.log('upgrade-check tests passed');
})();
