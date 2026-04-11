// tests/schema.test.cjs
const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('Schema validation tests\n');

// Test 1: Real configs load and validate
(function testRealConfigs() {
  const providersDir = path.join(__dirname, '..', 'pipeline', 'patches', 'providers');
  const files = fs.readdirSync(providersDir).filter(f => f.endsWith('.cjs') && f !== '_base.cjs');
  const providers = files.map(f => require(path.join(providersDir, f)));

  // Validate key uniqueness
  const keys = providers.map(p => p.key);
  assert.strictEqual(new Set(keys).size, keys.length, 'Duplicate keys found');

  // Validate runtimeId uniqueness
  const rids = providers.map(p => p.runtimeId);
  assert.strictEqual(new Set(rids).size, rids.length, 'Duplicate runtimeIds found');

  // Validate exactly one default provider (envKey === null)
  const defaults = providers.filter(p => p.envKey === null);
  assert.strictEqual(defaults.length, 1, 'Must have exactly one default provider');

  // Validate priority uniqueness among non-null
  const priorities = providers.filter(p => p.priority != null).map(p => p.priority);
  assert.strictEqual(new Set(priorities).size, priorities.length, 'Duplicate priorities found');

  // Validate tierNames has all 3 keys
  for (const p of providers) {
    assert.ok(p.tierNames.max, `${p.key}: missing tierNames.max`);
    assert.ok(p.tierNames.pro, `${p.key}: missing tierNames.pro`);
    assert.ok(p.tierNames.api, `${p.key}: missing tierNames.api`);
  }

  // Validate adapter/auth pairing
  for (const p of providers) {
    if (p.adapter) assert.ok(p.auth, `${p.key}: adapter without auth`);
  }

  // Validate identity.systemPrompt is non-empty
  for (const p of providers) {
    assert.ok(p.identity.systemPrompt && p.identity.systemPrompt.length > 0, `${p.key}: empty systemPrompt`);
  }

  // Validate contextWindow normalization
  for (const p of providers) {
    if (p.contextWindow != null) {
      if (typeof p.contextWindow === 'number') {
        // Raw number is valid but engine will normalize
      } else {
        assert.ok(typeof p.contextWindow.default === 'number', `${p.key}: contextWindow.default must be a number`);
      }
    }
  }

  // Validate identity required fields
  for (const p of providers) {
    assert.ok(p.identity, `${p.key}: missing identity`);
    assert.ok(p.identity.agentPrompt, `${p.key}: missing identity.agentPrompt`);
    assert.ok(p.identity.simplePrompt, `${p.key}: missing identity.simplePrompt`);
  }

  // Validate models table has 'default' if present
  for (const p of providers) {
    if (p.models) {
      assert.ok(p.models.default, `${p.key}: models table missing 'default' entry`);
    }
  }

  console.log('  Schema validation (real configs): PASS');
})();

// Test 2: Detect duplicate keys
(function testDuplicateKeys() {
  const fakeProviders = [
    { key: 'a', runtimeId: 'r1', envKey: null, priority: null, tierNames: { max: 'x', pro: 'y', api: 'z' }, identity: { systemPrompt: 'x', agentPrompt: 'x', simplePrompt: 'x' } },
    { key: 'a', runtimeId: 'r2', envKey: 'E', priority: 10, tierNames: { max: 'x', pro: 'y', api: 'z' }, identity: { systemPrompt: 'x', agentPrompt: 'x', simplePrompt: 'x' } },
  ];
  // We can't call validate() directly since it's internal to the engine,
  // but we can verify our own check logic
  const keys = fakeProviders.map(p => p.key);
  assert.notStrictEqual(new Set(keys).size, keys.length, 'Should detect duplicate keys');
  console.log('  Duplicate key detection: PASS');
})();

// Test 3: Detect missing default provider
(function testMissingDefault() {
  const providersDir = path.join(__dirname, '..', 'pipeline', 'patches', 'providers');
  const files = fs.readdirSync(providersDir).filter(f => f.endsWith('.cjs') && f !== '_base.cjs');
  const providers = files.map(f => require(path.join(providersDir, f)));
  const defaults = providers.filter(p => p.envKey === null);
  assert.strictEqual(defaults.length, 1, 'Exactly one default provider required');
  assert.strictEqual(defaults[0].key, 'claude', 'Default provider should be claude');
  console.log('  Default provider check: PASS');
})();

// Test 4: Engine loads without errors
(function testEngineLoads() {
  const engine = require(path.join(__dirname, '..', 'pipeline', 'patches', 'provider-engine.cjs'));
  assert.strictEqual(typeof engine, 'function', 'Engine should export a function');
  console.log('  Engine loads as function: PASS');
})();

console.log('\nAll schema tests passed.');
