#!/usr/bin/env node
/**
 * silly-code patch pipeline (modular)
 *
 * Orchestrator that loads patch modules and applies them in order.
 * Each module owns a domain: branding, providers, equality, privacy, platform.
 *
 * Usage: node pipeline/patch.cjs [input] [output]
 *   input:  path to upstream cli.js (default: pipeline/upstream/package/cli.js)
 *   output: path to patched cli.js (default: pipeline/build/cli-patched.js)
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')

const INPUT = process.argv[2] || path.join(__dirname, 'upstream/package/cli.js')
const OUTPUT = process.argv[3] || path.join(__dirname, 'build/cli-patched.js')

// ── Build-time git SHA (silly-code repo) ────────────────────
// Embedded into version string so `sillyx --version` shows which exact
// commit the binary was built from. Lets you instantly diff dev vs installed.
let SILLY_GIT_SHA = 'dev'
try {
  SILLY_GIT_SHA = execSync('git rev-parse --short HEAD', {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'ignore'],
  }).toString().trim()
} catch {}
const SILLY_VERSION_SUFFIX = `silly.${SILLY_GIT_SHA}`

// ── Upstream version guard ──────────────────────────────────
const depsPath = path.join(__dirname, '..', 'deps.json')
if (fs.existsSync(depsPath)) {
  const deps = JSON.parse(fs.readFileSync(depsPath, 'utf8'))
  const expectedVer = deps.deps?.upstream?.version
  const upstreamPkg = path.join(__dirname, 'upstream/package/package.json')
  if (expectedVer && fs.existsSync(upstreamPkg)) {
    const actualVer = JSON.parse(fs.readFileSync(upstreamPkg, 'utf8')).version
    if (actualVer !== expectedVer) {
      console.error(`\n  ✗ Upstream version mismatch: expected ${expectedVer}, got ${actualVer}`)
      console.error(`    MATCH constants may be invalid. Run: node pipeline/upgrade.cjs fetch`)
      console.error(`    Or update deps.json upstream.version to ${actualVer}\n`)
      process.exit(1)
    }
  }
}

// Ensure output directory exists
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true })

let src = fs.readFileSync(INPUT, 'utf8')
// bun-extract (v2.1.113+) emits non-ASCII chars as \uXXXX escape sequences.
// Upstream runtime behavior is identical, but our patch FINDs use literal
// unicode (crafted against the older literal form). Decode BMP escapes back
// to literals here so patches remain version-stable across extract formats.
//
// SAFETY: skip code points that must remain escaped in JS source:
//   - ASCII (0x00-0x7F): never needed literal; decoding e.g. \u005C to `\`
//     would corrupt escape sequences and strings
//   - Line terminators 0x2028 / 0x2029: break string literals pre-ES2019
//   - Surrogate range 0xD800-0xDFFF: must be written as a paired sequence;
//     decoding one half produces a lone surrogate which Node's utf-8
//     serializer replaces with U+FFFD, silently corrupting the source.
src = src.replace(/\\u([0-9a-fA-F]{4})/g, (full, hex) => {
  const cp = parseInt(hex, 16)
  if (cp < 0x80) return full
  if (cp === 0x2028 || cp === 0x2029) return full
  if (cp >= 0xD800 && cp <= 0xDFFF) return full
  return String.fromCharCode(cp)
})
const results = []

// ── Patch helpers (shared by all modules) ────────────────────

function patch(name, find, replace) {
  if (typeof find === 'string') {
    if (!src.includes(find)) {
      results.push({ name, status: 'FAIL', reason: 'pattern not found' })
      return
    }
    src = src.replace(find, replace)
    results.push({ name, status: 'OK' })
  } else if (find instanceof RegExp) {
    if (!find.test(src)) {
      results.push({ name, status: 'FAIL', reason: 'regex not matched' })
      return
    }
    src = src.replace(find, replace)
    results.push({ name, status: 'OK' })
  }
}

function patchAll(name, find, replace) {
  const count = src.split(find).length - 1
  if (count === 0) {
    results.push({ name, status: 'FAIL', reason: 'pattern not found' })
    return
  }
  src = src.replaceAll(find, replace)
  results.push({ name, status: 'OK', count })
}

// ── Load and apply patch modules in order ────────────────────

const helpers = { patch, patchAll, sillyVersionSuffix: SILLY_VERSION_SUFFIX }
const modules = [
  require('./patches/branding.cjs'),
  require('./patches/provider-engine.cjs'),
  require('./patches/equality.cjs'),
  require('./patches/privacy.cjs'),
  require('./patches/auth-bypass.cjs'),
]

for (const mod of modules) {
  mod(helpers)
}

// ── Report ───────────────────────────────────────────────────
console.log('\n  silly-code patch pipeline\n')
const ok = results.filter(r => r.status === 'OK').length
const fail = results.filter(r => r.status === 'FAIL').length
for (const r of results) {
  const icon = r.status === 'OK' ? '✓' : '✗'
  const extra = r.count ? ` (${r.count}x)` : ''
  const reason = r.reason ? ` — ${r.reason}` : ''
  console.log(`  ${icon} ${r.name}${extra}${reason}`)
}
console.log(`\n  ${ok} OK, ${fail} FAIL`)

// ── Atomic write: only overwrite output if ALL patches passed ─
if (fail > 0) {
  console.log(`  Output: NOT written (${fail} patches failed)\n`)
  process.exit(1)
}
fs.writeFileSync(OUTPUT + '.tmp', src)
fs.renameSync(OUTPUT + '.tmp', OUTPUT)
console.log(`  Output: ${OUTPUT}\n`)

// ── ESM/CJS override ────────────────────────────────────────────────────
// Upstream 2.1.113+ ships a Bun-compiled native binary. bun-extract.cjs
// carves the embedded CJS blob (wrapped in the Bun runtime's
// `(function(exports, require, module, __filename, __dirname){…})` shim)
// back into cli.js. The upstream npm package.json still declares
// `"type": "module"`, which Node inherits into pipeline/build/ and then
// refuses to execute the CJS shim (`file:///…cli-patched.js` ESM parse).
// Force Node to parse pipeline/build/cli-patched.js as CommonJS.
{
  const buildPkg = path.join(path.dirname(OUTPUT), 'package.json')
  fs.writeFileSync(buildPkg, JSON.stringify({ type: 'commonjs' }, null, 2) + '\n')
}

// ── Vendor symlink: ensure pipeline/build/vendor → ripgrep source ─────────
// cli-patched.js uses import.meta.url to locate vendor/ripgrep/. Since it
// lives in pipeline/build/ (not the npm package dir), the vendor dir must
// exist at pipeline/build/vendor/ or Glob/Grep silently fail with ENOENT.
{
  const buildDir = path.dirname(OUTPUT)
  const vendorLink = path.join(buildDir, 'vendor')
  // Find the vendor in the npm/npx cache.
  // Sort entries by mtime descending — newest cache entry (most likely to match
  // the current claude-code version) is checked first, avoiding a full linear scan.
  let vendorSrc = null
  const npxDir = path.join(os.homedir(), '.npm', '_npx')  // os.homedir() is cross-platform (Windows: USERPROFILE)
  try {
    const entries = fs.readdirSync(npxDir)
      .map(e => { try { return { e, mtime: fs.statSync(path.join(npxDir, e)).mtimeMs } } catch { return { e, mtime: 0 } } })
      .sort((a, b) => b.mtime - a.mtime)
    for (const { e } of entries) {
      const p = path.join(npxDir, e, 'node_modules', '@anthropic-ai', 'claude-code', 'vendor')
      if (fs.existsSync(p)) { vendorSrc = p; break }
    }
  } catch {}
  if (!vendorSrc) {
    // Fallback: check local node_modules (if package is installed, not npx)
    try {
      const p = require.resolve('@anthropic-ai/claude-code/package.json')
      const candidate = path.join(path.dirname(p), 'vendor')
      if (fs.existsSync(candidate)) vendorSrc = candidate
    } catch {}
  }
  if (vendorSrc) {
    // Update symlink if missing or pointing elsewhere.
    // Windows: use 'junction' for directories — works without admin/Developer Mode.
    // macOS/Linux: third arg is ignored.
    const _symlinkType = process.platform === 'win32' ? 'junction' : undefined
    let needsLink = true
    try {
      const existing = fs.readlinkSync(vendorLink)
      if (existing === vendorSrc) needsLink = false
      else fs.unlinkSync(vendorLink)
    } catch (e) {
      // readlinkSync throws EINVAL on a real directory (left over from an
      // older install flow that populated vendor/ripgrep directly). Wipe it
      // so the symlink below can take its place.
      if (e.code === 'EINVAL' || e.code === 'EISDIR') fs.rmSync(vendorLink, { recursive: true, force: true })
    }
    if (needsLink) {
      fs.symlinkSync(vendorSrc, vendorLink, _symlinkType)
      console.log(`  → vendor: ${vendorLink}`)
    }
  } else {
    console.warn('  ⚠ vendor/ripgrep not found in npm/npx cache — Glob/Grep will ENOENT')
  }
}
