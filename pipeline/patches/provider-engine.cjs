/**
 * provider-engine.cjs — Delegation wrapper
 *
 * Splits into three focused modules by change vector:
 *   provider-core.cjs     (10-15)  — detection, injection, resolution
 *   provider-ux.cjs       (50-55)  — context window, menu, heading
 *   provider-identity.cjs (60-67)  — display names, identity, tier
 *
 * This wrapper preserves the interface for patch.cjs and ci-upgrade.cjs.
 * MATCH constants live in pipeline/match-registry.cjs (shared with upgrade tools).
 */

const core = require('./provider-core.cjs');
const ux = require('./provider-ux.cjs');
const identity = require('./provider-identity.cjs');
const { providers } = require('./_providers.cjs');

module.exports = function applyProviders(helpers) {
  core(helpers);
  ux(helpers);
  identity(helpers);

  const adaptersWithCode = providers.filter(p => p.adapter);
  console.log(`\n  PATCH REPORT (provider-engine)`);
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  providers: ${providers.map(p => p.key).join(', ')}`);
  console.log(`  adapters:  ${adaptersWithCode.map(p => p.key).join(', ') || 'none'}`);
  console.log(`  modules:   provider-core → provider-ux → provider-identity`);
  console.log(`  ${'─'.repeat(50)}`);
};
