const assert = require('assert');
const { mapModel, msgToOai, msgsToResponsesInput } = require('../pipeline/patches/providers/_base.cjs');

// ── mapModel ──
(function testMapModel() {
  const table = {
    'claude-opus': 'gpt-5.4',
    'claude-sonnet': 'gpt-5.4',
    'claude-haiku': 'gpt-5.3-codex',
    default: 'gpt-5.4',
  };
  assert.strictEqual(mapModel('claude-opus-4-6', table), 'gpt-5.4');
  assert.strictEqual(mapModel('claude-haiku-4-5', table), 'gpt-5.3-codex');
  assert.strictEqual(mapModel('unknown-model', table), 'gpt-5.4');
  assert.strictEqual(mapModel('claude-opus-4-6', null), 'claude-opus-4-6');
  assert.strictEqual(mapModel(null, table), null);
  console.log('  mapModel: PASS');
})();

// ── msgToOai ──
(function testMsgToOaiText() {
  const result = msgToOai({ role: 'user', content: 'hello' });
  assert.deepStrictEqual(result, [{ role: 'user', content: 'hello' }]);
  console.log('  msgToOai text: PASS');
})();

(function testMsgToOaiToolUse() {
  const msg = {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Let me check.' },
      { type: 'tool_use', id: 'tc_1', name: 'bash', input: { command: 'ls' } },
    ],
  };
  const result = msgToOai(msg);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].role, 'assistant');
  assert.strictEqual(result[0].content, 'Let me check.');
  assert.strictEqual(result[0].tool_calls.length, 1);
  assert.strictEqual(result[0].tool_calls[0].function.name, 'bash');
  assert.strictEqual(result[0].tool_calls[0].function.arguments, '{"command":"ls"}');
  console.log('  msgToOai tool_use: PASS');
})();

(function testMsgToOaiToolResult() {
  const msg = {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'tc_1', content: 'file1.txt\nfile2.txt' },
    ],
  };
  const result = msgToOai(msg);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].role, 'tool');
  assert.strictEqual(result[0].tool_call_id, 'tc_1');
  assert.strictEqual(result[0].content, 'file1.txt\nfile2.txt');
  console.log('  msgToOai tool_result: PASS');
})();

(function testMsgToOaiMixed() {
  const msg = {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Running command.' },
      { type: 'tool_use', id: 'tc_2', name: 'bash', input: { command: 'echo hi' } },
    ],
  };
  const result = msgToOai(msg);
  assert.strictEqual(result[0].role, 'assistant');
  assert.ok(result[0].tool_calls);
  assert.strictEqual(result[0].content, 'Running command.');
  console.log('  msgToOai mixed: PASS');
})();

// ── msgsToResponsesInput ──
(function testMsgsToResponsesInputBasic() {
  const result = msgsToResponsesInput('You are helpful.', [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi there' },
  ]);
  assert.strictEqual(result.length, 3);
  assert.strictEqual(result[0].role, 'developer');
  assert.strictEqual(result[0].content, 'You are helpful.');
  assert.strictEqual(result[1].role, 'user');
  assert.strictEqual(result[2].role, 'assistant');
  console.log('  msgsToResponsesInput basic: PASS');
})();

(function testMsgsToResponsesInputToolResult() {
  const result = msgsToResponsesInput(null, [
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'tc_1', content: 'output here' },
    ]},
  ]);
  assert.strictEqual(result.length, 1);
  assert.ok(result[0].content.includes('[Tool result id=tc_1]'));
  assert.ok(result[0].content.includes('output here'));
  console.log('  msgsToResponsesInput tool_result: PASS');
})();

console.log('\nAll _base tests passed.');
