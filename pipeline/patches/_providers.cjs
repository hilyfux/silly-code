/**
 * _providers.cjs — Shared provider loading + validation
 *
 * Loaded once on require. Provides validated, sorted provider configs
 * to provider-core, provider-ux, and provider-identity modules.
 */

const path = require('path');

const PROVIDERS_DIR = path.join(__dirname, 'providers');
const base = require(path.join(PROVIDERS_DIR, '_base.cjs'));
const providerFiles = ['claude.cjs', 'openai.cjs'];

const providers = providerFiles.map(f => {
  const p = require(path.join(PROVIDERS_DIR, f));
  if (typeof p.contextWindow === 'number') {
    p.contextWindow = { default: p.contextWindow, perModel: {} };
  } else if (p.contextWindow && !p.contextWindow.perModel) {
    p.contextWindow = { ...p.contextWindow, perModel: {} };
  }
  return p;
});

function validate(providers) {
  const keys = new Set();
  const runtimeIds = new Set();
  const envKeys = new Set();
  const priorities = new Set();
  let defaultCount = 0;

  for (const p of providers) {
    if (!p.key || typeof p.key !== 'string') throw new Error(`Provider missing key`);
    if (keys.has(p.key)) throw new Error(`Duplicate provider key: ${p.key}`);
    keys.add(p.key);

    if (!p.runtimeId || typeof p.runtimeId !== 'string') throw new Error(`${p.key}: missing runtimeId`);
    if (runtimeIds.has(p.runtimeId)) throw new Error(`Duplicate runtimeId: ${p.runtimeId} (provider ${p.key})`);
    runtimeIds.add(p.runtimeId);

    if (p.envKey === null) {
      defaultCount++;
      if (p.runtimeId !== 'firstParty') throw new Error(`${p.key}: default provider (envKey: null) must have runtimeId: 'firstParty'`);
    } else {
      if (envKeys.has(p.envKey)) throw new Error(`Duplicate envKey: ${p.envKey}`);
      envKeys.add(p.envKey);
    }

    if (p.priority != null) {
      if (priorities.has(p.priority)) throw new Error(`Duplicate priority: ${p.priority} (provider ${p.key})`);
      priorities.add(p.priority);
    }

    if (p.models && !p.models.default) throw new Error(`${p.key}: models table missing 'default' entry`);

    if (!p.tierNames || !p.tierNames.max || !p.tierNames.pro || !p.tierNames.api) {
      throw new Error(`${p.key}: tierNames must have max, pro, api`);
    }

    if (p.adapter && !p.auth) throw new Error(`${p.key}: adapter requires auth`);
    if (p.adapter && typeof p.adapter !== 'function') throw new Error(`${p.key}: adapter must be a function`);
    if (p.auth && typeof p.auth !== 'function') throw new Error(`${p.key}: auth must be a function`);

    if (!p.identity?.systemPrompt) throw new Error(`${p.key}: identity.systemPrompt required`);

    if (p.contextWindow && typeof p.contextWindow.default !== 'number') {
      throw new Error(`${p.key}: contextWindow.default must be a number`);
    }
  }

  if (defaultCount !== 1) throw new Error(`Exactly one provider must have envKey: null (found ${defaultCount})`);
}

validate(providers);

const sorted = providers.filter(p => p.priority != null).sort((a, b) => a.priority - b.priority);
const fallback = providers.find(p => p.priority == null);
const allRuntimeIds = providers.filter(p => p.runtimeId !== 'firstParty').map(p => p.runtimeId);

module.exports = { base, providers, sorted, fallback, allRuntimeIds };
