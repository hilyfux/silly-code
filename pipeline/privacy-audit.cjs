#!/usr/bin/env node
/**
 * pipeline/privacy-audit.cjs
 * 隐私安全自动审计 — 每日定时任务的一部分
 *
 * 扫描 upstream binary 中所有遥测/数据采集接口，对比 privacy.cjs 的阻断列表。
 * Exit 0 = 全部覆盖，无新发现
 * Exit 1 = 发现未阻断的遥测端点（findings 写入 stdout JSON）
 * Exit 2 = upstream binary 不存在或扫描出错
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Guard against require-time detonation. Same pattern as pipeline/ci-upgrade.cjs
// (Iter 80): the entire file body below spawns python3 subprocesses, scans
// upstream binary, writes to .knowledge-graph/, and can process.exit(1|2). A
// stray require() would trigger the full audit. Iter 83 closure —
// defense-in-depth, not a feature.
if (require.main !== module) return;

const ROOT = path.join(__dirname, '..');
const UPSTREAM = path.join(__dirname, 'upstream/package/cli.js');
const PRIVACY_CJS = path.join(__dirname, 'patches/privacy.cjs');
const KG_DIR = path.join(ROOT, '.knowledge-graph');
const REPORT_PATH = path.join(KG_DIR, 'privacy-audit-latest.json');

if (!fs.existsSync(UPSTREAM)) {
  console.error(JSON.stringify({ status: 'error', error: 'upstream binary not found: ' + UPSTREAM }));
  process.exit(2);
}

// Retrieve upstream version from package.json
let upstreamVersion = 'unknown';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'upstream/package/package.json'), 'utf8'));
  upstreamVersion = pkg.version || 'unknown';
} catch {}

// Run the scan using Python (consistent with upgrade skill methodology)
const pyScript = `
import re, json, sys

with open(${JSON.stringify(UPSTREAM)}) as f:
    binary = f.read()
with open(${JSON.stringify(PRIVACY_CJS)}) as f:
    privacy = f.read()

# ── Telemetry/tracking domains and paths to watch ──
TELEMETRY_PATS = [
    r'https?://[^\\\\s"\\'\\\\x60,;)]{10,}(?:statsig|datadoghq|growthbook|amplitude|segment|mixpanel|launchdarkly)[^\\\\s"\\'\\\\x60,;)]{0,120}',
    r'api\\\\.anthropic\\\\.com/api/claude_code/(?!v[0-9])[^\\\\s"\\'\\\\x60,;)]{5,80}',
    r'api\\\\.anthropic\\\\.com/api/claude_cli_[^\\\\s"\\'\\\\x60,;)]{5,80}',
    r'api\\\\.anthropic\\\\.com/api/claude_code_shared[^\\\\s"\\'\\\\x60,;)]{5,80}',
    r'storage\\\\.googleapis\\\\.com/claude-code[^\\\\s"\\'\\\\x60,;)]{5,80}',
    r'beacon\\\\.[^\\\\s"\\'\\\\x60,;)]{5,60}',
]

# ── Data collection field patterns (active collection, not SDK internals) ──
DATA_PATS = [
    (r'j1\\\\(["\\'](info|error)["\\'],[\\\\s]*["\\'](\\\\w+)["\\'],[\\\\s]*\\\\{[^}]*(?:email|userId|accountId|machineId)[^}]*\\\\}', 'active_telemetry_with_pii'),
]

findings = []
seen = set()

for pat in TELEMETRY_PATS:
    for m in re.finditer(pat, binary):
        url = m.group(0).rstrip('",;)\\'\\\\x60 ')
        if url in seen or len(url) < 12:
            continue
        seen.add(url)
        # Check if meaningfully covered in privacy.cjs
        domain_path = url.replace('https://', '').replace('http://', '')
        # Try multiple anchor lengths
        blocked = False
        for anchor_len in [30, 20, 15, 10]:
            anchor = domain_path[:anchor_len]
            if anchor and anchor in privacy:
                blocked = True
                break
        if not blocked:
            findings.append({'type': 'unblocked_endpoint', 'url': url})

print(json.dumps({
    'status': 'clean' if not findings else 'new_endpoints',
    'upstream_version': ${JSON.stringify(upstreamVersion)},
    'findings': findings,
    'scan_ts': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
}, indent=2))
sys.exit(0 if not findings else 1)
`;

// Write Python script to temp file to avoid shell escaping nightmares
const tmpPy = path.join(require('os').tmpdir(), `silly-privacy-audit-${Date.now()}.py`);
try {
  fs.writeFileSync(tmpPy, pyScript.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n'));
  const raw = execSync(`python3 "${tmpPy}"`, { encoding: 'utf8', timeout: 30000 });
  const result = JSON.parse(raw);

  // Persist report to knowledge-graph
  try {
    fs.mkdirSync(KG_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(result, null, 2));
  } catch {}

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === 'clean' ? 0 : 1);
} catch (e) {
  // Python may exit 1 with valid JSON on stdout
  const raw = (e.stdout || '').trim();
  if (raw) {
    try {
      const result = JSON.parse(raw);
      try { fs.writeFileSync(REPORT_PATH, JSON.stringify(result, null, 2)); } catch {}
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.status === 'clean' ? 0 : 1);
    } catch {}
  }
  const err = { status: 'error', error: e.message.slice(0, 200) };
  console.error(JSON.stringify(err));
  process.exit(2);
} finally {
  try { fs.unlinkSync(tmpPy); } catch {}
}
