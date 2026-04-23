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

// Guard against require-time detonation. Same pattern as pipeline/ci-upgrade.cjs
// (Iter 80): the entire file body below runs at require-time (git rev-parse,
// fs.readFileSync of upstream cli.js, patch module loading, writeFileSync of
// build output, symlink vendoring, process.exit on failure). A stray
// `require('./pipeline/patch.cjs')` from any diagnostic/test would trigger a
// full patch run. Iter 83 closure — defense-in-depth, not a feature.
if (require.main !== module) return

const INPUT = process.argv[2] || path.join(__dirname, 'upstream/package/cli.js')
const OUTPUT = process.argv[3] || path.join(__dirname, 'build/cli-patched.js')

// Git SHA embedded in version string so `sillyx --version` reveals the
// exact commit the binary was built from — dev vs installed is instantly diffable.
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
// bun-extract (2.1.113+) emits non-ASCII as \uXXXX — our patch FINDs use the
// old literal form. Decode BMP escapes so patches are version-stable, but
// keep these escaped to avoid corrupting the source:
//   ASCII (< 0x80)        — would break escape sequences / strings
//   0x2028 / 0x2029       — break string literals pre-ES2019
//   surrogates D800-DFFF  — lone halves become U+FFFD on utf-8 serialize
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
  require('./patches/cross-platform.cjs'),
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

// Force CJS parsing on the patched build. The upstream npm package.json
// (2.1.113+) declares "type":"module", but bun-extract re-emits the
// embedded binary as a CJS shim — Node would refuse it as ESM.
{
  const buildPkg = path.join(path.dirname(OUTPUT), 'package.json')
  fs.writeFileSync(buildPkg, JSON.stringify({ type: 'commonjs' }, null, 2) + '\n')
}

// Deploy vendored ws into pipeline/build/node_modules/ws.
// The bun-bundled cli.js externally `require('ws')`; Node's resolver walks up
// from cli-patched.js's directory and finds it here. Vendoring (vs runtime
// `npm install ws`) is mandatory: user directive — clone must be complete,
// no install-time or runtime downloads, no half-installed states.
{
  const buildDir = path.dirname(OUTPUT)
  const wsSrc = path.join(__dirname, '..', 'vendor', 'ws')
  const wsDst = path.join(buildDir, 'node_modules', 'ws')
  if (!fs.existsSync(wsSrc)) {
    console.error(`  FATAL: vendored ws missing at ${wsSrc} — repo corrupt, reinstall`)
    process.exit(1)
  }
  fs.mkdirSync(path.dirname(wsDst), { recursive: true })
  fs.rmSync(wsDst, { recursive: true, force: true })
  fs.cpSync(wsSrc, wsDst, { recursive: true })
}

// Vendor symlink: cli-patched.js locates vendor/ripgrep/ relative to itself,
// but lives in pipeline/build/ (not the npm package dir). Without this link
// Glob/Grep silently fail with ENOENT.
//
// Resolution order (first hit wins):
//   1. Existing pipeline/build/vendor/ripgrep/<arch>-<platform>/ — installer
//      (install.ps1 / install.sh) may have pre-populated this before patch.cjs
//      runs. A real directory here is authoritative and left untouched.
//   2. npm/npx cache at ~/.npm/_npx/<hash>/node_modules/@anthropic-ai/claude-code/vendor
//   3. Local node_modules via require.resolve (non-npx installs)
//
// On Windows clean boxes path 2+3 are typically empty — install.ps1 MUST
// download ripgrep from BurntSushi/ripgrep releases into
// pipeline\build\vendor\ripgrep\<arch>-win32\rg.exe BEFORE invoking patch.cjs,
// otherwise Glob/Grep ENOENT at runtime. We emit an actionable error (exit 1)
// rather than a silent warning so a broken install is loud at build time.
// Opt-out: SILLY_VENDOR_OPTIONAL=1 for developer workflows without vendor.
{
  const buildDir = path.dirname(OUTPUT)
  const vendorLink = path.join(buildDir, 'vendor')

  // Path 1: real directory left by installer. Preserve and skip linking.
  let preservedRealDir = false
  try {
    const st = fs.lstatSync(vendorLink)
    if (st.isDirectory() && !st.isSymbolicLink()) {
      const rgDir = path.join(vendorLink, 'ripgrep')
      if (fs.existsSync(rgDir)) {
        console.log(`  → vendor: ${vendorLink} (preserved, installer-populated)`)
        preservedRealDir = true
      }
    }
  } catch {}

  if (!preservedRealDir) {
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
        // EINVAL/EISDIR: a real directory exists here (old install flow). Wipe it.
        // ENOENT: nothing at that path yet — leave needsLink=true so we create it.
        if (e.code === 'EINVAL' || e.code === 'EISDIR') fs.rmSync(vendorLink, { recursive: true, force: true })
        else if (e.code !== 'ENOENT') throw e
      }
      if (needsLink) {
        fs.symlinkSync(vendorSrc, vendorLink, _symlinkType)
        console.log(`  → vendor: ${vendorLink}`)
      }
    } else if (process.env.SILLY_VENDOR_OPTIONAL === '1') {
      console.warn('  ⚠ vendor/ripgrep not found (SILLY_VENDOR_OPTIONAL=1) — Glob/Grep will ENOENT at runtime')
    } else {
      console.error('')
      console.error('  ✗ vendor/ripgrep not found. cli-patched.js cannot run Glob/Grep without it.')
      console.error('')
      if (process.platform === 'win32') {
        console.error('    Windows: the installer (install.ps1) downloads ripgrep from')
        console.error('    https://github.com/BurntSushi/ripgrep/releases and places it at')
        console.error('    pipeline\\build\\vendor\\ripgrep\\<arch>-win32\\rg.exe BEFORE invoking')
        console.error('    patch.cjs. If you are running patch.cjs manually, either:')
        console.error('      • re-run install.ps1, OR')
        console.error('      • download rg.exe manually into pipeline\\build\\vendor\\ripgrep\\x64-win32\\')
        console.error('        (or arm64-win32\\ on ARM64), OR')
        console.error('      • set SILLY_VENDOR_OPTIONAL=1 to skip (Glob/Grep will ENOENT at runtime).')
      } else {
        console.error('    Linux/macOS: activate the npm/npx cache by running once:')
        console.error('      npx @anthropic-ai/claude-code --version')
        console.error('    Then re-run node pipeline/patch.cjs.')
        console.error('    Alternatively, set SILLY_VENDOR_OPTIONAL=1 to skip (Glob/Grep will ENOENT).')
      }
      console.error('')
      process.exit(1)
    }
  }
}
