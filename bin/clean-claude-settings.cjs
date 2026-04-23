#!/usr/bin/env node
// clean-claude-settings.js — strip non-Claude `model` pollution from ~/.claude/settings.json
//
// Root cause: vanilla Claude Code and sillyx both call upstream's
// updateSettingsForSource("userSettings", {model: X}) which writes to the
// shared ~/.claude/settings.json. Patch 57 stops the WRITE at its source
// for new launches, but pre-existing pollution needs a one-shot cleanup so
// vanilla `claude` stops opening on a gpt-* model.
//
// Contract:
//   - Only touches the TOP-LEVEL `model` field. Leaves permissions,
//     effortLevel, enabledPlugins, hooks, env, etc. untouched.
//   - Only strips values whose prefix looks like a non-Claude slug (gpt-*,
//     o1*, o3*, o4*, codex*, gemini*, grok*). Anything else (including
//     "opus", "sonnet", "claude-*") is left alone.
//   - Preserves file mtime semantics only to the extent of a normal write;
//     the file is rewritten atomically (write-temp, rename).
//   - No-op when settings.json is absent, malformed, or has no `model`.
//
// Exports `cleanClaudeSettings()` (pure; testable) and runs as CLI when
// invoked directly (require.main === module).

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Non-Claude model slug prefixes. Keep this list conservative: anything
// that could plausibly be a Claude alias (opus/sonnet/haiku/claude-*) is
// explicitly omitted so we never strip a legitimate Claude selection.
const FOREIGN_PREFIXES = [
  'gpt-',
  'gpt3',
  'gpt4',
  'o1',
  'o3',
  'o4',
  'codex',
  'gemini',
  'grok',
];

function isForeignSlug(value) {
  if (typeof value !== 'string') return false;
  const v = value.toLowerCase().trim();
  if (!v) return false;
  return FOREIGN_PREFIXES.some(p => v.startsWith(p));
}

/**
 * Clean a settings.json file in-place.
 *
 * @param {string} settingsPath - path to settings.json to clean
 * @param {object} [opts]
 * @param {function} [opts.log] - logger; defaults to noop
 * @returns {{changed: boolean, reason: string, strippedModel?: string, keptKeys?: string[]}}
 */
function cleanSettingsFile(settingsPath, opts = {}) {
  const log = opts.log || (() => {});
  let raw;
  try {
    raw = fs.readFileSync(settingsPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { changed: false, reason: 'no-settings-file' };
    return { changed: false, reason: 'read-error:' + err.code };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { changed: false, reason: 'malformed-json' };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { changed: false, reason: 'not-an-object' };
  }

  if (!Object.prototype.hasOwnProperty.call(data, 'model')) {
    return { changed: false, reason: 'no-model-field' };
  }

  const current = data.model;
  if (!isForeignSlug(current)) {
    return { changed: false, reason: 'model-is-claude-compatible' };
  }

  const stripped = current;
  delete data.model;

  const serialized = JSON.stringify(data, null, 2) + '\n';
  const tmp = settingsPath + '.silly-clean.tmp';
  fs.writeFileSync(tmp, serialized, 'utf8');
  fs.renameSync(tmp, settingsPath);

  log(`[silly] removed polluted model "${stripped}" from ${settingsPath}`);

  return {
    changed: true,
    reason: 'stripped-foreign-model',
    strippedModel: stripped,
    keptKeys: Object.keys(data),
  };
}

/**
 * Default cleanup target: ~/.claude/settings.json (vanilla Claude Code).
 * Also cleans $SILLY_CODE_DATA/settings.json if present (sillyx persists
 * there too; mirrors the same pollution surface).
 */
function cleanClaudeSettings(opts = {}) {
  const home = opts.home || os.homedir();
  const sillyData = opts.sillyData || process.env.SILLY_CODE_DATA || path.join(home, '.silly-code');
  const paths = [
    path.join(home, '.claude', 'settings.json'),
    path.join(sillyData, 'settings.json'),
  ];
  const results = [];
  for (const p of paths) {
    results.push({ path: p, ...cleanSettingsFile(p, opts) });
  }
  return results;
}

/**
 * Throttled auto-heal: runs at most once per 24h (dedup via touch file).
 * Designed to be called on every launcher invocation without hot-path cost.
 * Returns the results array (possibly empty on skip) for caller logging.
 */
function autoHealOnLaunch(opts = {}) {
  const home = opts.home || os.homedir();
  const sillyData = opts.sillyData || process.env.SILLY_CODE_DATA || path.join(home, '.silly-code');
  const stateFile = path.join(sillyData, '.claude-settings-heal');
  const logDir = path.join(sillyData, 'logs');
  try { fs.mkdirSync(sillyData, { recursive: true }); } catch {}

  // 24h dedup
  try {
    const st = fs.statSync(stateFile);
    const ageMs = Date.now() - st.mtimeMs;
    if (ageMs < 24 * 60 * 60 * 1000) return { skipped: true, reason: '24h-dedup' };
  } catch {}

  const results = cleanClaudeSettings({ ...opts, home, sillyData });
  try { fs.writeFileSync(stateFile, String(Date.now()), 'utf8'); } catch {}

  // Record any actual strips into the pollution log for forensics
  const stripped = results.filter(r => r.changed);
  if (stripped.length > 0) {
    try {
      fs.mkdirSync(logDir, { recursive: true });
      const line = stripped
        .map(r => `${new Date().toISOString()} ${r.path} stripped=${r.strippedModel}`)
        .join('\n') + '\n';
      fs.appendFileSync(path.join(logDir, 'anti-pollution.log'), line, 'utf8');
    } catch {}
  }
  return { skipped: false, results };
}

module.exports = {
  cleanSettingsFile,
  cleanClaudeSettings,
  autoHealOnLaunch,
  isForeignSlug,
  FOREIGN_PREFIXES,
};

if (require.main === module) {
  // CLI mode: `silly clean-claude-settings`. Force run regardless of dedup.
  const results = cleanClaudeSettings({ log: (m) => console.log(m) });
  let changed = 0;
  for (const r of results) {
    if (r.changed) {
      console.log(`  cleaned: ${r.path}`);
      console.log(`    removed model=${r.strippedModel}`);
      console.log(`    kept keys: ${(r.keptKeys || []).join(', ') || '(none)'}`);
      changed++;
    } else {
      console.log(`  skipped: ${r.path} (${r.reason})`);
    }
  }
  if (changed === 0) {
    console.log('\n  No pollution found.');
  } else {
    console.log(`\n  ${changed} file(s) cleaned.`);
  }
  process.exit(0);
}
