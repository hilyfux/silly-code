const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(__dirname, '..', 'pipeline', 'ci-upgrade.cjs');

function runCase(extraEnv) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-upgrade-kg-test-'));
  const kgDir = path.join(tmp, 'kg');
  fs.mkdirSync(kgDir, { recursive: true });
  const outputFile = path.join(tmp, 'github-output.txt');

  const result = spawnSync('node', [script], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      SILLY_CI_UPGRADE_TEST_MODE: '1',
      SILLY_CI_UPGRADE_TEST_KG_DIR: kgDir,
      SILLY_CI_UPGRADE_TEST_WRITE_OUTPUT: '1',
      GITHUB_OUTPUT: outputFile,
      SILLY_CI_UPGRADE_TEST_VARMAP: JSON.stringify({
        '2.1.108-test': { version: '2.1.108-test', shared: 'oldName' },
        '2.1.109-test': { version: '2.1.109-test', shared: 'newName' },
        '2.1.110-test': { version: '2.1.110-test', shared: 'newestName' },
      }),
      ...extraEnv,
    },
  });

  return {
    result,
    eventsPath: path.join(kgDir, 'graph-events.jsonl'),
    snapshotPath: path.join(kgDir, 'work-snapshot.md'),
    outputFile,
  };
}

(function main() {
  {
    const run = runCase({
      SILLY_CI_UPGRADE_TEST_VERSION_PAIR: JSON.stringify({ current: '2.1.108-test', latest: '2.1.109-test' }),
      SILLY_CI_UPGRADE_TEST_PATCH_RESULT: JSON.stringify({ ok: true, fails: [] }),
      SILLY_CI_UPGRADE_TEST_TEST_RESULT: JSON.stringify({ ok: true }),
    });

    assert.strictEqual(run.result.status, 1, `${run.result.stdout}\n${run.result.stderr}`);
    const events = fs.readFileSync(run.eventsPath, 'utf8').trim().split('\n').map(JSON.parse);
    const snapshot = fs.readFileSync(run.snapshotPath, 'utf8');
    const output = fs.readFileSync(run.outputFile, 'utf8');

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'upstream_upgrade_attempt');
    assert.strictEqual(events[0].result, 'upgraded');
    assert.strictEqual(events[0].status, 'upgraded');
    assert.strictEqual(events[0].ci_exit_code, 1);
    assert.strictEqual(events[0].current_version, '2.1.108-test');
    assert.strictEqual(events[0].target_version, '2.1.109-test');
    assert.strictEqual(events[0].patch.build_ok, true);
    assert.deepStrictEqual(events[0].patch.failing_list, []);
    assert.strictEqual(events[0].tests.ok, true);
    assert.strictEqual(events[0].auto_fix.varmap_applied, true);
    assert.strictEqual(events[0].auto_fix.content_anchor_applied, false);
    assert.ok(events[0].lessons.includes('varmap rename sweep was sufficient'));
    assert.match(snapshot, /Last result: upgraded/);
    assert.match(snapshot, /No action needed right now/);
    assert.match(output, /kg_summary=/);
    console.log('  ci-upgrade upgraded KG event: PASS');
  }

  {
    const run = runCase({
      SILLY_CI_UPGRADE_TEST_VERSION_PAIR: JSON.stringify({ current: '2.1.109-test', latest: '2.1.110-test' }),
      SILLY_CI_UPGRADE_TEST_PATCH_RESULT: JSON.stringify({ ok: true, fails: [] }),
      SILLY_CI_UPGRADE_TEST_TEST_RESULT: JSON.stringify({ ok: false, which: 'tests/providers.test.cjs' }),
    });

    assert.strictEqual(run.result.status, 2, `${run.result.stdout}\n${run.result.stderr}`);
    const events = fs.readFileSync(run.eventsPath, 'utf8').trim().split('\n').map(JSON.parse);
    const snapshot = fs.readFileSync(run.snapshotPath, 'utf8');
    const output = fs.readFileSync(run.outputFile, 'utf8');

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'upstream_upgrade_attempt');
    assert.strictEqual(events[0].result, 'tests-failed');
    assert.strictEqual(events[0].status, 'tests-failed');
    assert.strictEqual(events[0].ci_exit_code, 2);
    assert.strictEqual(events[0].current_version, '2.1.109-test');
    assert.strictEqual(events[0].target_version, '2.1.110-test');
    assert.strictEqual(events[0].patch.build_ok, true);
    assert.strictEqual(events[0].patch.failing_count, 0);
    assert.deepStrictEqual(events[0].patch.failing_list, []);
    assert.strictEqual(events[0].tests.ok, false);
    assert.strictEqual(events[0].tests.failed_test, 'tests/providers.test.cjs');
    assert.strictEqual(events[0].next_action, 'invoke_agent');
    assert.strictEqual(events[0].auto_fix.varmap_applied, true);
    assert.strictEqual(events[0].auto_fix.content_anchor_applied, false);
    assert.ok(events[0].lessons.includes('semantic/provider regression surfaced after string-level patching'));
    assert.match(snapshot, /Last result: tests-failed/);
    assert.match(snapshot, /Re-run the scheduled fallback or \/upstream-upgrade with the latest snapshot in context/);
    assert.match(output, /status=tests-failed/);
    assert.match(output, /failing_list=tests\/providers.test.cjs/);
    assert.match(output, /kg_summary=/);
    console.log('  ci-upgrade tests-failed KG event: PASS');
  }

  console.log('ci-upgrade KG tests passed');
})();
