#!/usr/bin/env node
/**
 * pipeline/audit-doc-refs.cjs
 * 文档 commit-hash 引用审计 — Iter 95+96 程序固化为 npm script (Iter 97)
 *
 * 扫描所有 *.md 文件中的 7-hex 字符串 [0-9a-f]{7}，逐个用 git rev-parse 验证：
 * - in-repo OK     → 该 hash 解析到 silly-code 真实 commit
 * - external KG    → 已知外部 knowledge-graph skill 的 hash（白名单）
 * - false positive → 数字-only token (e.g. "3000000") 或二进制噪声
 * - MISS           → 未知 hash，可能是 dangling/重写的 ref，需要人工 classify
 *
 * 默认 exit 0 (info tool)；传 --strict 时若有 MISS 则 exit 1 (CI gate)。
 *
 * 用法：
 *   npm run audit:doc-refs            # 普通模式，仅打印报告
 *   npm run audit:doc-refs -- --strict # CI 模式，MISS 则 fail
 *   node pipeline/audit-doc-refs.cjs --json # 结构化 JSON 输出
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Pipeline entry-point guard — Iter 83 三分类规则 #1。本脚本会 spawn git 子进程并 exit，
// require() 会触发整个审计；guard 防御性短路，被 testPipelineEntryPointGuards 锁住。
if (require.main !== module) return;

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const JSON_OUT = args.includes('--json');

// 已知 external hash 白名单 — 这些 hash 来自 knowledge-graph skill 自己的 git repo，
// 不在 silly-code 的 git log 中是预期。Iter 95 sweep 确认。
const EXTERNAL_KG_HASHES = new Set([
  '4698fd2', // KG skill repo
  '77b49b8', // KG skill repo
  'd6a5f03', // KG skill repo
  'f6dc89c', // KG installer version (root CLAUDE.md)
]);

// 已知 false positive token —"恰好像 hex 但其实不是 commit"
const FALSE_POSITIVES = new Set([
  '3000000', // API_TIMEOUT_MS 等数字常量
]);

// 扫描范围：所有 .md 文件，但排除 build/cache/upstream 目录
const SCAN_GLOBS = [
  'docs',
  '.claude/skills',
  '.claude',
];

const SCAN_FILES = [
  'CLAUDE.md',
  'README.md',
];

const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  'pipeline/upstream',
  'pipeline/build',
  '.knowledge-graph',
  'dist',
  'build',
]);

// 递归收集 .md 文件
function collectMd(dirAbs, out) {
  let entries;
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = path.join(dirAbs, e.name);
    const rel = path.relative(ROOT, abs);
    if (EXCLUDE_DIRS.has(rel) || EXCLUDE_DIRS.has(e.name)) continue;
    if (e.isDirectory()) {
      collectMd(abs, out);
    } else if (e.isFile() && (e.name.endsWith('.md') || e.name === 'CLAUDE.md')) {
      out.push(abs);
    }
  }
}

// 收集所有 CLAUDE.md（任意深度）
function collectClaudeMd(dirAbs, out) {
  let entries;
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const rel = path.relative(ROOT, path.join(dirAbs, e.name));
    if (EXCLUDE_DIRS.has(rel) || EXCLUDE_DIRS.has(e.name)) continue;
    const abs = path.join(dirAbs, e.name);
    if (e.isDirectory()) {
      collectClaudeMd(abs, out);
    } else if (e.name === 'CLAUDE.md') {
      out.push(abs);
    }
  }
}

const filesSet = new Set();
// 1. SCAN_GLOBS 下的 *.md
for (const g of SCAN_GLOBS) {
  const abs = path.join(ROOT, g);
  if (!fs.existsSync(abs)) continue;
  const list = [];
  collectMd(abs, list);
  for (const f of list) filesSet.add(f);
}
// 2. 任意深度的 CLAUDE.md
const claudeMd = [];
collectClaudeMd(ROOT, claudeMd);
for (const f of claudeMd) filesSet.add(f);
// 3. 根目录 README.md / CLAUDE.md
for (const name of SCAN_FILES) {
  const abs = path.join(ROOT, name);
  if (fs.existsSync(abs)) filesSet.add(abs);
}

const files = [...filesSet].sort();

// 提取每个文件中的 (lineNo, token) 对
const HEX7 = /\b[0-9a-f]{7}\b/g;
const findings = []; // {file, line, token}
const tokenLocations = new Map(); // token -> [{file, line}]

for (const f of files) {
  let content;
  try {
    content = fs.readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  // 跳过看起来像二进制的文件（含 NULL 字节）
  if (content.includes('\x00')) continue;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    HEX7.lastIndex = 0;
    while ((m = HEX7.exec(line)) !== null) {
      const tok = m[0];
      findings.push({ file: path.relative(ROOT, f), line: i + 1, token: tok });
      if (!tokenLocations.has(tok)) tokenLocations.set(tok, []);
      tokenLocations.get(tok).push({ file: path.relative(ROOT, f), line: i + 1 });
    }
  }
}

// 对每个 unique token 分类
const classify = {
  ok: [],          // {token, locations: []}
  external_kg: [],
  false_positive: [],
  miss: [],
};

const uniqueTokens = [...tokenLocations.keys()].sort();

for (const tok of uniqueTokens) {
  const locs = tokenLocations.get(tok);
  if (FALSE_POSITIVES.has(tok)) {
    classify.false_positive.push({ token: tok, reason: 'known decimal/numeric constant', locations: locs });
    continue;
  }
  if (EXTERNAL_KG_HASHES.has(tok)) {
    classify.external_kg.push({ token: tok, reason: 'knowledge-graph skill external repo', locations: locs });
    continue;
  }
  // 用 git rev-parse 验证
  try {
    execSync(`git rev-parse --verify --quiet "${tok}^{commit}"`, {
      cwd: ROOT,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    classify.ok.push({ token: tok, locations: locs });
  } catch {
    classify.miss.push({ token: tok, locations: locs });
  }
}

// 输出
const summary = {
  scanned_files: files.length,
  total_token_occurrences: findings.length,
  unique_tokens: uniqueTokens.length,
  ok: classify.ok.length,
  external_kg: classify.external_kg.length,
  false_positive: classify.false_positive.length,
  miss: classify.miss.length,
};

if (JSON_OUT) {
  console.log(JSON.stringify({ summary, classify }, null, 2));
} else {
  console.log('# Doc commit-hash reference audit');
  console.log('');
  console.log(`Scanned ${summary.scanned_files} files; ${summary.total_token_occurrences} token occurrences (${summary.unique_tokens} unique 7-hex).`);
  console.log('');
  console.log(`  ✓ OK in-repo          : ${summary.ok}`);
  console.log(`  ✓ External KG (known) : ${summary.external_kg}`);
  console.log(`  ✓ False positive (FP) : ${summary.false_positive}`);
  console.log(`  ${summary.miss > 0 ? '✗' : '✓'} Unclassified MISS    : ${summary.miss}`);
  console.log('');
  if (classify.miss.length > 0) {
    console.log('## MISS — needs manual classification');
    console.log('');
    for (const m of classify.miss) {
      console.log(`  ${m.token}`);
      for (const loc of m.locations.slice(0, 3)) {
        console.log(`    ${loc.file}:${loc.line}`);
      }
      if (m.locations.length > 3) console.log(`    … +${m.locations.length - 3} more`);
    }
    console.log('');
    console.log('Classify each MISS as one of:');
    console.log('  1. False positive → add to FALSE_POSITIVES set in pipeline/audit-doc-refs.cjs');
    console.log('  2. External repo  → add to EXTERNAL_KG_HASHES set');
    console.log('  3. True rot       → fix the doc by replacing with a real commit hash');
    console.log('');
    console.log('See memory/project-doc-commit-ref-audit.md for the audit playbook.');
  }
}

if (STRICT && classify.miss.length > 0) {
  process.exit(1);
}
process.exit(0);
