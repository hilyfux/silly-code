#!/usr/bin/env node
/**
 * silly-code patch pipeline
 *
 * Takes upstream Claude Code cli.js and applies silly-code patches.
 * Each patch is a named, verifiable transformation.
 *
 * Usage: node pipeline/patch.js [input] [output]
 *   input:  path to upstream cli.js (default: pipeline/upstream/package/cli.js)
 *   output: path to patched cli.js (default: pipeline/build/cli-patched.js)
 */

const fs = require('fs')
const path = require('path')

const INPUT = process.argv[2] || path.join(__dirname, 'upstream/package/cli.js')
const OUTPUT = process.argv[3] || path.join(__dirname, 'build/cli-patched.js')

// Ensure output directory exists
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true })

let src = fs.readFileSync(INPUT, 'utf8')
const results = []

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

// ── Patch 01: Branding — VERSION ─────────────────────────────
patchAll('01-version',
  'VERSION:"2.1.100"',
  'VERSION:"2.1.100-silly"'
)

// ── Patch 02: Branding — PACKAGE_URL ─────────────────────────
patchAll('02-package-url',
  'PACKAGE_URL:"@anthropic-ai/claude-code"',
  'PACKAGE_URL:"silly-code"'
)

// ── Patch 03: Branding — FEEDBACK_CHANNEL ────────────────────
patchAll('03-feedback',
  'FEEDBACK_CHANNEL:"https://github.com/anthropics/claude-code/issues"',
  'FEEDBACK_CHANNEL:"https://github.com/hilyfux/silly-code/issues"'
)

// ── Patch 04: Branding — README_URL ──────────────────────────
patchAll('04-readme-url',
  'README_URL:"https://code.claude.com/docs/en/overview"',
  'README_URL:"https://github.com/hilyfux/silly-code"'
)

// ── Patch 05: Branding — ISSUES_EXPLAINER ────────────────────
patchAll('05-issues',
  'ISSUES_EXPLAINER:"report the issue at https://github.com/anthropics/claude-code/issues"',
  'ISSUES_EXPLAINER:"report the issue at https://github.com/hilyfux/silly-code/issues"'
)

// ── Patch 10: Provider — inject openai + copilot ─────────────
patch('10-provider-detection',
  'return B6(process.env.CLAUDE_CODE_USE_BEDROCK)?"bedrock"',
  'return B6(process.env.CLAUDE_CODE_USE_OPENAI)?"openai":B6(process.env.CLAUDE_CODE_USE_COPILOT)?"copilot":B6(process.env.CLAUDE_CODE_USE_BEDROCK)?"bedrock"'
)

// ── Patch 20: Permission — default bypass ────────────────────
// (placeholder — will be implemented after probe verification)

// ── Write output ─────────────────────────────────────────────
fs.writeFileSync(OUTPUT, src)

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
console.log(`  Output: ${OUTPUT}\n`)

if (fail > 0) process.exit(1)
