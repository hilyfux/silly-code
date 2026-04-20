#!/usr/bin/env node
/**
 * bun-extract.cjs — Recover cli.js from a Bun-compiled Claude Code native binary.
 *
 * Since upstream 2.1.113 the npm package `@anthropic-ai/claude-code` ships only
 * an installer; the real binary lives in platform-specific optional deps
 * (`@anthropic-ai/claude-code-<platform>`) produced by `bun build --compile`.
 * The embedded JS source is stored inline as two identical 12-13 MB printable
 * regions beginning with the marker:
 *
 *     // @bun @bytecode @bun-cjs
 *     (function(exports, require, module, __filename, __dirname) {...})
 *
 * This tool locates the first such region and writes it as a self-contained
 * cli.js so the existing patch pipeline (varmap/content-anchor/regex) can
 * apply unchanged. A small IIFE bootstrap is appended so the extracted file
 * runs under Node without modification.
 *
 * CLI:
 *   node pipeline/bun-extract.cjs <version> <outDir>
 *     version  — upstream version (e.g. 2.1.114)
 *     outDir   — directory where cli.js + package.json are written
 *
 * Library:
 *   const { extractCliJs } = require('./bun-extract.cjs');
 *   extractCliJs(binaryPath) -> { js, size, startOffset, endOffset }
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const MIN_BLOB = 4 * 1024 * 1024;           // 4 MB — real bundle is ~13 MB
const MARKER = Buffer.from('// @bun @bytecode @bun-cjs\n(function(exports, require, module, __filename, __dirname) {');

function isPrintable(b) {
  return (b >= 32 && b < 127) || b === 9 || b === 10 || b === 13;
}

// The @bun-cjs marker appears at multiple offsets: a short stub in the
// bytecode section, the full cli.js (~13 MB), an identical source copy, and
// small trailing sub-module fragments. Walk every hit and return the largest
// contiguous printable region that contains one. Reject regions below
// MIN_BLOB to avoid the stub/fragment false positives.
function locateBunBundle(buf) {
  const lim = buf.length;
  const hits = [];
  let from = 0;
  while (true) {
    const i = buf.indexOf(MARKER, from);
    if (i < 0) break;
    hits.push(i);
    from = i + 1;
  }
  if (!hits.length) throw new Error('bun-extract: @bun-cjs marker not found');
  let best = null;
  for (const h of hits) {
    let start = h;
    while (start > 0 && isPrintable(buf[start - 1])) start--;
    let end = h + MARKER.length;
    while (end < lim && isPrintable(buf[end])) end++;
    const size = end - start;
    if (!best || size > best.size) best = { start, end, size };
  }
  if (best.size < MIN_BLOB) {
    throw new Error(`bun-extract: no region >= ${MIN_BLOB} bytes (largest ${best.size})`);
  }
  return best;
}

function extractCliJs(binaryPath) {
  const buf = fs.readFileSync(binaryPath);
  const { start, end, size } = locateBunBundle(buf);
  const js = buf.slice(start, end).toString('utf8');
  return { js, size, startOffset: start, endOffset: end };
}

// Node shim: the Bun CJS wrapper expects (exports, require, module, __filename, __dirname)
// to be provided by the host. Append an IIFE invocation that supplies the
// current module's bindings so `node cli.js` works standalone.
function wrapForNode(js) {
  return js + '\n(exports, require, module, __filename, __dirname);\n';
}

function detectPlatform() {
  const p = process.platform;
  let c = os.arch();
  if (p === 'darwin' && c === 'x64') {
    try {
      const r = execSync('sysctl -n sysctl.proc_translated', { encoding: 'utf8' }).trim();
      if (r === '1') c = 'arm64';
    } catch { /* not on mac or sysctl missing — leave as-is */ }
  }
  if (p === 'linux') {
    try {
      const report = process.report?.getReport?.();
      if (report && report.header?.glibcVersionRuntime === undefined) {
        return `linux-${c}-musl`;
      }
    } catch { /* ignore */ }
  }
  return `${p}-${c}`;
}

function fetchAndStageFromBunBinary(version, outDir, { platform = detectPlatform(), keepTmp = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'silly-bun-extract-'));
  const platPkg = `@anthropic-ai/claude-code-${platform}`;
  try {
    execSync(`npm pack ${platPkg}@${version} --pack-destination ${tmp}`, {
      cwd: tmp, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const tgz = `anthropic-ai-claude-code-${platform}-${version}.tgz`;
    execSync(`tar -xzf "${tgz}"`, { cwd: tmp, stdio: 'pipe' });
    const binPath = path.join(tmp, 'package', 'claude');
    if (!fs.existsSync(binPath)) throw new Error(`bun-extract: native binary not found at ${binPath}`);
    const { js, size } = extractCliJs(binPath);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'cli.js'), wrapForNode(js));
    // Synthesize a minimal package.json matching the legacy wrapper schema.
    const pkg = {
      name: '@anthropic-ai/claude-code',
      version,
      bin: { claude: 'cli.js' },
      type: 'module',
      engines: { node: '>=18.0.0' },
      files: ['cli.js'],
      'silly-code:source': 'bun-extract',
      'silly-code:platform': platform,
      'silly-code:extractedBytes': size,
    };
    fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    return { cliJsBytes: size, platform, outDir };
  } finally {
    if (!keepTmp) {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

module.exports = { extractCliJs, wrapForNode, locateBunBundle, detectPlatform, fetchAndStageFromBunBinary };

if (require.main === module) {
  const [, , version, outDir] = process.argv;
  if (!version || !outDir) {
    process.stderr.write('usage: node pipeline/bun-extract.cjs <version> <outDir>\n');
    process.exit(2);
  }
  try {
    const r = fetchAndStageFromBunBinary(version, outDir);
    process.stdout.write(JSON.stringify(r) + '\n');
  } catch (e) {
    process.stderr.write(`bun-extract failed: ${e.message}\n`);
    process.exit(1);
  }
}
