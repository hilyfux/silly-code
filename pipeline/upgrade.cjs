#!/usr/bin/env node
/**
 * upgrade.cjs — Version upgrade automation
 *
 * Detects variable name changes between upstream versions using landmark strings.
 * Verifies all patch patterns still match. Reports breakage.
 *
 * Usage:
 *   node pipeline/upgrade.cjs                    # Check current upstream
 *   node pipeline/upgrade.cjs scan <cli.js>      # Scan a specific cli.js
 *   node pipeline/upgrade.cjs fetch              # npm pack latest + scan + patch
 *   node pipeline/upgrade.cjs verify             # Verify patches against current upstream
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const PIPELINE = __dirname
const UPSTREAM_DIR = path.join(PIPELINE, 'upstream')
const BUILD_DIR = path.join(PIPELINE, 'build')

// ── Colors ──
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m',
}
function log(c, msg) { console.log(`${c}${msg}${C.reset}`) }

// ══════════════════════════════════════════════════════════════
// Landmark definitions — stable strings that locate minified names
// ══════════════════════════════════════════════════════════════

const LANDMARKS = [
  {
    name: 'isEnvTruthy',
    // Pattern: function XX(q){if(!q)return!1;if(typeof q==="boolean")return q;...["1","true","yes","on"].includes(
    regex: /function (\w+)\(q\)\{if\(!q\)return!1;if\(typeof q==="boolean"\)return q;[^}]*\["1","true","yes","on"\]/,
    field: 'isEnvTruthy',
  },
  {
    name: 'getAPIProvider',
    // Pattern: ...CLAUDE_CODE_USE_BEDROCK...?"bedrock"...
    // The function containing this returns provider strings
    regex: /return (\w+)\(process\.env\.CLAUDE_CODE_USE_BEDROCK\)\?"bedrock"/,
    field: 'isEnvTruthy_in_getAPIProvider',
    // Also extract the function name by looking at surrounding context
  },
  {
    name: 'getAPIProvider_fn',
    // The function name wrapping the provider chain
    // Pattern: function XX(){return YY(process.env.CLAUDE_CODE_USE_BEDROCK)
    regex: /function ([\w$]+)\(\)\{[^}]*process\.env\.CLAUDE_CODE_USE_BEDROCK[^}]*"bedrock"/,
    field: 'getAPIProvider',
  },
  {
    name: 'isFirstParty (D$)',
    // Pattern: function XX(q=dq()){return q==="firstParty"||q==="anthropicAws"}
    // Note: \w doesn't match $, so use [\w$]+ for minified names like D$
    regex: /function ([\w$]+)\(q=([\w$]+)\(\)\)\{return q==="firstParty"\|\|q==="anthropicAws"\}/,
    field: 'isFirstParty',
    captures: { 1: 'isFirstParty', 2: 'getAPIProvider' },
  },
  {
    name: 'providerFamily (fg)',
    // Pattern: function XX(q=dq()){return q==="firstParty"||q==="anthropicAws"||q==="foundry"||q==="mantle"}
    regex: /function ([\w$]+)\(q=([\w$]+)\(\)\)\{return q==="firstParty"\|\|q==="anthropicAws"\|\|q==="foundry"\|\|q==="mantle"\}/,
    field: 'providerFamily',
    captures: { 1: 'providerFamily', 2: 'getAPIProvider' },
  },
  {
    name: 'modelAwareProviderResolver',
    // Pattern: P=XX(_);if(P==="bedrock")
    regex: /([\w$]+)=([\w$]+)\([\w$]+\);if\(\1==="bedrock"\)/,
    field: 'modelAwareProviderResolver_call',
    captures: { 2: 'modelAwareProviderResolver' },
  },
  {
    name: 'subscriptionTier (XK)',
    // Pattern: function XX(){if(YYY())return ZZZ();if(!AA())return null;...subscriptionType
    regex: /function ([\w$]+)\(\)\{if\(([\w$]+)\(\)\)return ([\w$]+)\(\);if\(!([\w$]+)\(\)\)return null;let q=([\w$]+)\(\);if\(!q\)return null;return q\.subscriptionType/,
    field: 'subscriptionTier',
    captures: { 1: 'subscriptionTier' },
  },
  {
    name: 'isSubscriber (m7)',
    // Pattern: function XX(){if(!YY())return!1;return ZZ(
    regex: /function ([\w$]+)\(\)\{if\(!([\w$]+)\(\)\)return!1;return ([\w$]+)\(([\w$]+)\(\)\?\.scopes/,
    field: 'isSubscriber',
    captures: { 1: 'isSubscriber' },
  },
  {
    name: 'statsigTransport (TU)',
    // Pattern: TU.fetch(`${K}/api/eval/${_}`
    regex: /([\w$]+)\.fetch\(`\$\{([\w$]+)\}\/api\/eval\/\$\{[\w$]+\}`/,
    field: 'statsigTransport',
    captures: { 1: 'statsigTransport' },
  },
  {
    name: 'AnthropicSDK (hL)',
    // Pattern: new XX({...M,apiKey  (the Anthropic constructor)
    // Look for the bedrock branch to find it nearby
    regex: /new ([\w$]+)\(\{\.\.\.([\w$]+),apiKey/,
    field: 'AnthropicSDK',
    captures: { 1: 'AnthropicSDK', 2: 'configVar' },
  },
  {
    name: 'defaultContextWindow (Hy1)',
    // Pattern: Hy1=200000 — the default context window constant
    regex: /([\w$]+)=200000/,
    field: 'defaultContextWindow',
  },
  {
    name: 'version (comment)',
    // The authoritative version is in the comment at line ~4
    regex: /\/\/ Version: (\d+\.\d+\.\d+)/,
    field: 'version',
  },
]

// ── Patch patterns to verify ────────────────────────────────

function getPatchPatterns(vars) {
  // Return the find-patterns that each patch needs to match
  // Uses detected variable names where possible
  return [
    { id: '01', name: 'version',      type: 'all', pattern: () => `VERSION:"${vars.version || '2.1.100'}"` },
    { id: '02', name: 'package-url',   type: 'all', pattern: () => 'PACKAGE_URL:"@anthropic-ai/claude-code"' },
    { id: '03', name: 'feedback',      type: 'all', pattern: () => 'FEEDBACK_CHANNEL:"https://github.com/anthropics/claude-code/issues"' },
    { id: '04', name: 'readme-url',    type: 'all', pattern: () => 'README_URL:"https://code.claude.com/docs/en/overview"' },
    { id: '05', name: 'issues',        type: 'all', pattern: () => 'ISSUES_EXPLAINER:"report the issue at https://github.com/anthropics/claude-code/issues"' },
    { id: '10', name: 'provider-detect',type: 'one', pattern: () => {
      const b6 = vars.isEnvTruthy || 'B6'
      return `return ${b6}(process.env.CLAUDE_CODE_USE_BEDROCK)?"bedrock"`
    }},
    { id: '13', name: 'model-resolve', type: 'one', pattern: () => {
      const d$ = vars.isFirstParty || 'D$'
      const dq = vars.getAPIProvider || 'dq'
      return `function ${d$}(q=${dq}()){return q==="firstParty"||q==="anthropicAws"}`
    }},
    { id: '14', name: 'provider-family',type: 'one', pattern: () => {
      const fg = vars.providerFamily || 'fg'
      const dq = vars.getAPIProvider || 'dq'
      return `function ${fg}(q=${dq}()){return q==="firstParty"||q==="anthropicAws"||q==="foundry"||q==="mantle"}`
    }},
    { id: '11-12', name: 'adapters',   type: 'one', pattern: () => {
      const bx = vars.modelAwareProviderResolver || 'BX'
      return `P=${bx}(_);if(P==="bedrock")`
    }},
    { id: '15', name: 'model-defaults',type: 'one', pattern: () => `// Version: ${vars.version || '2.1.100'}` },
    { id: '20', name: 'tier-bypass',   type: 'one', pattern: () => {
      const xk = vars.subscriptionTier || 'XK'
      return `function ${xk}(){`
    }},
    { id: '21', name: 'subscriber',    type: 'one', pattern: () => {
      const m7 = vars.isSubscriber || 'm7'
      return `function ${m7}(){`
    }},
    { id: '30', name: 'statsig',       type: 'one', pattern: () => {
      const tu = vars.statsigTransport || 'TU'
      return `return ${tu}.fetch(`
    }},
    { id: '31', name: 'metrics',       type: 'one', pattern: () => '/api/claude_code/metrics' },
    { id: '32', name: 'transcripts',   type: 'one', pattern: () => '/api/claude_code_shared_session_transcripts' },
    { id: '33', name: 'feedback',      type: 'one', pattern: () => '/api/claude_cli_feedback' },
    { id: '34', name: 'metrics-enabled',type: 'one', pattern: () => '/api/claude_code/organizations/metrics_enabled' },
    { id: '35', name: 'datadog',       type: 'one', pattern: () => 'http-intake.logs.us5.datadoghq.com' },
    { id: '36', name: 'growthbook',    type: 'one', pattern: () => 'cdn.growthbook.io' },
    { id: '37', name: 'autoupdate',    type: 'one', pattern: () => 'storage.googleapis.com/claude-code-dist-' },
    { id: '38', name: 'plugin-stats',  type: 'one', pattern: () => 'raw.githubusercontent.com/anthropics/claude-plugins-official/' },
    { id: '39', name: 'changelog',     type: 'one', pattern: () => 'raw.githubusercontent.com/anthropics/claude-code/' },
    { id: '50', name: 'context-window',type: 'one', pattern: () => `// Version: ${vars.version || '2.1.100'}` },
    { id: '51', name: 'default-context',type: 'one', pattern: () => {
      const hy1 = vars.defaultContextWindow || 'Hy1'
      return `${hy1}=200000`
    }},
  ]
}

// ══════════════════════════════════════════════════════════════
// Core: scan a cli.js and extract variable mappings
// ══════════════════════════════════════════════════════════════

function scan(cliPath) {
  log(C.bold, `\n  Scanning: ${cliPath}`)
  const src = fs.readFileSync(cliPath, 'utf8')
  log(C.dim, `  Size: ${(src.length / 1024 / 1024).toFixed(1)} MB`)

  const vars = {}
  const found = []
  const missed = []

  for (const lm of LANDMARKS) {
    const m = src.match(lm.regex)
    if (m) {
      if (lm.captures) {
        for (const [idx, name] of Object.entries(lm.captures)) {
          const val = m[parseInt(idx)]
          if (val && !vars[name]) {
            vars[name] = val
          }
        }
      } else if (lm.field === 'version') {
        vars.version = m[1]
      } else {
        vars[lm.field] = m[1]
      }
      found.push(lm.name)
    } else {
      missed.push(lm.name)
    }
  }

  log(C.bold, `\n  Landmark detection: ${found.length}/${LANDMARKS.length}`)
  for (const f of found) log(C.green, `    ✓ ${f}`)
  for (const m of missed) log(C.yellow, `    ✗ ${m}`)

  log(C.bold, `\n  Variable map:`)
  for (const [k, v] of Object.entries(vars).sort()) {
    log(C.cyan, `    ${k} = ${v}`)
  }

  return { vars, src }
}

// ══════════════════════════════════════════════════════════════
// Verify: check all patch patterns match
// ══════════════════════════════════════════════════════════════

function verify(src, vars) {
  const patterns = getPatchPatterns(vars)
  const ok = []
  const fail = []

  log(C.bold, `\n  Patch pattern verification:`)

  for (const p of patterns) {
    const pat = p.pattern()
    const found = src.includes(pat)
    if (found) {
      ok.push(p)
      log(C.green, `    ✓ ${p.id} ${p.name}`)
    } else {
      fail.push(p)
      log(C.red, `    ✗ ${p.id} ${p.name}`)
      log(C.dim, `      Pattern: ${pat.slice(0, 80)}...`)
    }
  }

  log(C.bold, `\n  ${ok.length} OK, ${fail.length} FAIL`)
  return { ok, fail }
}

// ══════════════════════════════════════════════════════════════
// Diff: compare old vs new variable maps
// ══════════════════════════════════════════════════════════════

function diffVars(oldVars, newVars) {
  const changes = []
  const allKeys = new Set([...Object.keys(oldVars), ...Object.keys(newVars)])

  for (const key of [...allKeys].sort()) {
    const o = oldVars[key]
    const n = newVars[key]
    if (o && n && o !== n) {
      changes.push({ key, from: o, to: n, type: 'CHANGED' })
    } else if (o && !n) {
      changes.push({ key, from: o, to: null, type: 'REMOVED' })
    } else if (!o && n) {
      changes.push({ key, from: null, to: n, type: 'ADDED' })
    }
  }

  if (changes.length === 0) {
    log(C.green, `\n  No variable changes detected`)
  } else {
    log(C.bold, `\n  Variable changes: ${changes.length}`)
    for (const c of changes) {
      if (c.type === 'CHANGED') {
        log(C.yellow, `    ~ ${c.key}: ${c.from} → ${c.to}`)
      } else if (c.type === 'REMOVED') {
        log(C.red, `    - ${c.key}: ${c.from}`)
      } else {
        log(C.green, `    + ${c.key}: ${c.to}`)
      }
    }
  }

  return changes
}

// ══════════════════════════════════════════════════════════════
// Fetch: npm pack latest, extract, scan, verify
// ══════════════════════════════════════════════════════════════

function fetchAndUpgrade() {
  log(C.bold, '\n  Fetching latest @anthropic-ai/claude-code...\n')

  const tmpDir = path.join(PIPELINE, '.upgrade-tmp')
  fs.mkdirSync(tmpDir, { recursive: true })

  try {
    // npm pack downloads the tarball
    const tgz = execSync('npm pack @anthropic-ai/claude-code --pack-destination ' + tmpDir, {
      cwd: tmpDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()

    const tgzPath = path.join(tmpDir, tgz)
    log(C.dim, `  Downloaded: ${tgz}`)

    // Extract
    execSync(`tar xzf "${tgzPath}" -C "${tmpDir}"`, { stdio: 'pipe' })

    const newCli = path.join(tmpDir, 'package', 'cli.js')
    if (!fs.existsSync(newCli)) {
      log(C.red, '  Error: cli.js not found in package')
      return
    }

    // Scan new version
    const newResult = scan(newCli)

    // Load old variable map
    const networkFile = path.join(PIPELINE, 'binary-network.json')
    let oldVars = {}
    if (fs.existsSync(networkFile)) {
      const net = JSON.parse(fs.readFileSync(networkFile, 'utf8'))
      oldVars = net.variable_map || {}
      // Flatten: the old map has "isEnvTruthy": "B6" format
      // but our scan produces the same format, so direct compare works
    }

    // Diff
    diffVars(oldVars, newResult.vars)

    // Verify patches against new source
    const result = verify(newResult.src, newResult.vars)

    if (result.fail.length > 0) {
      log(C.red, `\n  ⚠ ${result.fail.length} patches need updating!`)
      log(C.dim, '  The new cli.js is at: ' + newCli)
      log(C.dim, '  Fix patch patterns, then copy to upstream/:')
      log(C.dim, `    cp "${newCli}" "${path.join(UPSTREAM_DIR, 'package/cli.js')}"`)
    } else {
      log(C.green, '\n  All patches verified! Ready to upgrade.')
      log(C.dim, '  To apply:')
      log(C.dim, `    cp "${newCli}" "${path.join(UPSTREAM_DIR, 'package/cli.js')}"`)
      log(C.dim, `    node pipeline/patch.cjs`)
    }

    // Save new variable map
    const mapFile = path.join(PIPELINE, `varmap-${newResult.vars.version || 'unknown'}.json`)
    fs.writeFileSync(mapFile, JSON.stringify(newResult.vars, null, 2))
    log(C.dim, `  Variable map saved: ${mapFile}`)

  } finally {
    // Cleanup
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
}

// ══════════════════════════════════════════════════════════════
// Generate: auto-update patch.cjs patterns for new variable names
// ══════════════════════════════════════════════════════════════

function generatePatchUpdate(newVars) {
  log(C.bold, '\n  Generating patch updates...\n')

  // Read current patches directory
  const patchDir = path.join(PIPELINE, 'patches')
  const files = fs.readdirSync(patchDir).filter(f => f.endsWith('.cjs'))

  // Map of old → new replacements needed
  const replacements = {
    'B6': newVars.isEnvTruthy,
    'dq': newVars.getAPIProvider,
    'D$': newVars.isFirstParty,
    'fg': newVars.providerFamily,
    'BX': newVars.modelAwareProviderResolver,
    'XK': newVars.subscriptionTier,
    'm7': newVars.isSubscriber,
    'TU': newVars.statsigTransport,
    'hL': newVars.AnthropicSDK,
  }

  // Filter out unchanged
  const changes = Object.entries(replacements)
    .filter(([old, nw]) => nw && old !== nw)

  if (changes.length === 0) {
    log(C.green, '  No variable name changes to apply')
    return
  }

  log(C.yellow, `  ${changes.length} variable names changed:`)
  for (const [old, nw] of changes) {
    log(C.dim, `    ${old} → ${nw}`)
  }
  log(C.dim, '\n  Apply these changes manually to patch modules in pipeline/patches/')
  log(C.dim, '  Then run: node pipeline/patch.cjs to verify')
}

// ══════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════

const cmd = process.argv[2]

switch (cmd) {
  case 'scan': {
    const target = process.argv[3] || path.join(UPSTREAM_DIR, 'package/cli.js')
    scan(target)
    break
  }

  case 'verify': {
    const target = process.argv[3] || path.join(UPSTREAM_DIR, 'package/cli.js')
    const { vars, src } = scan(target)
    verify(src, vars)
    break
  }

  case 'fetch': {
    fetchAndUpgrade()
    break
  }

  default: {
    // Default: scan + verify current upstream
    const target = path.join(UPSTREAM_DIR, 'package/cli.js')
    if (!fs.existsSync(target)) {
      log(C.red, `\n  No upstream found at: ${target}`)
      log(C.dim, '  Run: node pipeline/upgrade.cjs fetch')
      break
    }
    const { vars, src } = scan(target)
    verify(src, vars)
    break
  }
}
