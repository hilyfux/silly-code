#!/usr/bin/env node
/**
 * upgrade-probe.cjs — pre-flight diagnostics for an upstream bump.
 *
 * Classifies every minified identifier our patches reference into one of:
 *   (1) varmap        — auto-renamed by ci-upgrade via varmap diff
 *   (2) content-anchor — auto-renamed by ci-upgrade via stable string tail
 *   (3) bare          — NEITHER layer catches a rename. Silent-coupling risk
 *                       unless listed in BARE_INJECT_TOKENS with a guard.
 *
 * For each identifier, reports whether it's present in the current upstream,
 * so upgrade day reads like: "<N> identifiers dropped, candidates: …".
 * Not a build step. Run manually: `node pipeline/upgrade-probe.cjs`.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PIPELINE = __dirname;
const UPSTREAM = path.join(PIPELINE, 'upstream/package/cli.js');
const MATCH_REGISTRY = path.join(PIPELINE, 'match-registry.cjs');

// ── Load inputs ──
const upstreamSrc = fs.readFileSync(UPSTREAM, 'utf8');
const engineSrc = fs.readFileSync(MATCH_REGISTRY, 'utf8');

const upstreamPkg = JSON.parse(fs.readFileSync(path.join(PIPELINE, 'upstream/package/package.json'), 'utf8'));
const upstreamVer = upstreamPkg.version;

const varmapFile = path.join(PIPELINE, `varmap-${upstreamVer}.json`);
const varmap = fs.existsSync(varmapFile) ? JSON.parse(fs.readFileSync(varmapFile, 'utf8')) : {};

// ── Extract MATCH block literals from provider-engine.cjs ──
const mStart = engineSrc.indexOf('const MATCH = {');
const mEnd = engineSrc.indexOf('};', mStart);
const matchBlock = engineSrc.slice(mStart, mEnd);
const matchLiterals = Array.from(matchBlock.matchAll(/([A-Z_][A-Z0-9_]*):\s*'((?:[^'\\]|\\.)*)'/g))
  .map(x => ({ key: x[1], value: x[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\') }));

// ── Extract BARE_INJECT_TOKENS list ──
const bareStart = engineSrc.indexOf('BARE_INJECT_TOKENS = [');
const bareEnd = engineSrc.indexOf('];', bareStart);
const bareBlock = bareStart >= 0 ? engineSrc.slice(bareStart, bareEnd) : '';
const guardedBare = new Set(
  Array.from(bareBlock.matchAll(/\[\s*(?:MATCH\.[A-Z_]+|'([^']+)')/g))
    .map(x => x[1])
    .filter(Boolean)
);
// Constructor comes via MATCH.CONSTRUCTOR — add explicitly
if (bareStart >= 0 && bareBlock.includes('MATCH.CONSTRUCTOR')) {
  const c = matchLiterals.find(m => m.key === 'CONSTRUCTOR');
  if (c) guardedBare.add(c.value);
}

// ── Extract code-shaped identifiers only ──
// The MATCH values mix code with identity prose. Tokenize only where syntax
// proves the token is an identifier: function call, assignment LHS, function/
// class declaration, bare CONSTRUCTOR value. Strip string literals first so
// "Claude" inside "You are Claude Code…" can't masquerade as a minified name.
function stripStrings(s) {
  return s.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
}
function extractCodeTokens(str) {
  const code = stripStrings(str);
  const out = new Set();
  const patterns = [
    /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g,              // call
    /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=)/g,          // assign LHS
    /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,        // decl
    /\bclass\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /\bnew\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
  ];
  for (const re of patterns) {
    let m; while ((m = re.exec(code))) out.add(m[1]);
  }
  const keywords = new Set(['function', 'return', 'if', 'else', 'var', 'let', 'const', 'new', 'typeof', 'class', 'extends', 'this', 'process', 'case', 'default', 'switch']);
  for (const k of [...out]) if (keywords.has(k)) out.delete(k);
  return out;
}

const allTokens = new Set();
// Self-anchored = declared with `function X(` or `class X` inside a MATCH value.
// Renaming X there makes the MATCH string itself fail to match → patch-time fail,
// not silent runtime break. Treat these as "find-side anchored".
const selfAnchored = new Set();
for (const { value } of matchLiterals) {
  for (const t of extractCodeTokens(value)) allTokens.add(t);
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value.trim())) allTokens.add(value.trim());
  const d = value.matchAll(/\b(?:function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g);
  for (const m of d) selfAnchored.add(m[1]);
}
// Single-letter tokens are minifier-scope-local params (P, Q, q, _). They appear
// in MATCH values as internal bindings, not references to upstream identifiers.
for (const t of [...allTokens]) if (t.length === 1) allTokens.delete(t);

// Pull inject-side tokens from the guard list so they appear in the report
// even when absent from MATCH values (uvK etc. are replacement-only refs).
for (const t of guardedBare) allTokens.add(t);

// Proper word boundary that handles $ (JS \b does not).
function countOccurrences(token) {
  const re = new RegExp(`(?<![A-Za-z_$0-9])${token.replace(/[$]/g, '\\$')}(?![A-Za-z_$0-9])`, 'g');
  return (upstreamSrc.match(re) || []).length;
}

// ── Classify each token ──
const varmapValues = new Map(); // minified → semantic
for (const [k, v] of Object.entries(varmap)) {
  if (k === 'version') continue;
  varmapValues.set(v, k);
}

// Content-anchor pattern: token that appears in a MATCH literal shaped like
// `X="..."` or `var X="..."` with at least 8 chars of suffix.
const contentAnchored = new Set();
for (const { value } of matchLiterals) {
  const m = value.match(/^(?:var\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*"([^"]{8,})"/);
  if (m) contentAnchored.add(m[1]);
}

// ── Report ──
const lines = [];
const push = s => lines.push(s);

push(`\n  silly-code upgrade-probe  (upstream ${upstreamVer})`);
push('  ' + '═'.repeat(60));

push(`\n  MATCH block: ${matchLiterals.length} entries`);
push(`  varmap:      ${varmapValues.size} identifiers`);
push(`  guard list:  ${guardedBare.size} BARE_INJECT_TOKENS entries`);

const layer = { varmap: [], content: [], self: [], bare_guarded: [], bare_unguarded: [] };
for (const t of [...allTokens].sort()) {
  if (varmapValues.has(t))         layer.varmap.push([t, varmapValues.get(t)]);
  else if (contentAnchored.has(t)) layer.content.push(t);
  else if (selfAnchored.has(t))    layer.self.push(t);
  else if (guardedBare.has(t))     layer.bare_guarded.push(t);
  else                             layer.bare_unguarded.push(t);
}

push(`\n  (1) varmap-covered (auto-renamed on bump):`);
for (const [t, sem] of layer.varmap) push(`       ${t.padEnd(6)} = ${sem}`);

push(`\n  (2) content-anchor covered (ci-upgrade re-anchors via string tail):`);
for (const t of layer.content) push(`       ${t}`);

push(`\n  (2b) self-anchored in MATCH find-side (rename → patch-time fail, not silent):`);
for (const t of layer.self) push(`       ${t}`);

push(`\n  (3) bare inject — guarded:`);
for (const t of layer.bare_guarded) push(`       ${t}  ✓ structural guard in match-registry.cjs`);

push(`\n  (3) bare inject — UNGUARDED  (silent-coupling risk):`);
if (layer.bare_unguarded.length === 0) {
  push(`       — none —`);
} else {
  for (const t of layer.bare_unguarded) {
    const present = countOccurrences(t) > 0;
    push(`       ${t}  ${present ? '✓ present in upstream' : '✗ MISSING — hunt rename now'}`);
  }
}

push(`\n  upstream presence check:`);
for (const t of [...layer.varmap.map(x => x[0]), ...layer.content, ...layer.self, ...layer.bare_guarded]) {
  const count = countOccurrences(t);
  const ok = count > 0 ? '✓' : '✗';
  push(`       ${ok} ${t.padEnd(6)}  ${count}x`);
}

push('');
console.log(lines.join('\n'));

// Exit code = number of unguarded identifiers missing from upstream
const missingUnguarded = layer.bare_unguarded.filter(t => countOccurrences(t) === 0).length;
process.exit(missingUnguarded);
