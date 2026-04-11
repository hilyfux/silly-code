const assert = require('assert');
const { mapModel, msgToOai, msgsToResponsesInput, flattenSystem, oaiToAnthropicResponse, makeSseStream, makeResponsesSseStream } = require('../pipeline/patches/providers/_base.cjs');

// Helper: create a mock Response with SSE body from lines
function mockSseResponse(lines) {
  const enc = new TextEncoder();
  const chunks = lines.map(l => enc.encode(l + '\n'));
  let i = 0;
  const body = new ReadableStream({
    pull(ctrl) {
      if (i < chunks.length) ctrl.enqueue(chunks[i++]);
      else ctrl.close();
    }
  });
  return { body };
}

// Helper: drain a ReadableStream to string
async function drainStream(stream) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value);
  }
  return out;
}

(async function main() {
  // ── mapModel ──
  {
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
  }

  // ── msgToOai ──
  {
    const result = msgToOai({ role: 'user', content: 'hello' });
    assert.deepStrictEqual(result, [{ role: 'user', content: 'hello' }]);
    console.log('  msgToOai text: PASS');
  }

  {
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
  }

  {
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
  }

  {
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
  }

  // ── msgsToResponsesInput ──
  {
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
  }

  {
    const result = msgsToResponsesInput(null, [
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'tc_1', content: 'output here' },
      ]},
    ]);
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].content.includes('[Tool result id=tc_1]'));
    assert.ok(result[0].content.includes('output here'));
    console.log('  msgsToResponsesInput tool_result: PASS');
  }

  // ── flattenSystem ──
  {
    assert.strictEqual(flattenSystem('Hello'), 'Hello');
    assert.strictEqual(flattenSystem(''), '');
    assert.strictEqual(flattenSystem(null), '');
    assert.strictEqual(flattenSystem(undefined), '');
    console.log('  flattenSystem string: PASS');
  }

  {
    const result = flattenSystem([{ text: 'Part 1' }, { text: 'Part 2' }]);
    assert.strictEqual(result, 'Part 1Part 2');
    assert.strictEqual(flattenSystem([{ text: 'Only' }]), 'Only');
    assert.strictEqual(flattenSystem([{}]), '');
    console.log('  flattenSystem array: PASS');
  }

  // ── oaiToAnthropicResponse ──
  {
    const oaiJson = {
      id: 'chatcmpl-123',
      choices: [{ message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
    const resp = oaiToAnthropicResponse(oaiJson, 'gpt-4o');
    const body = JSON.parse(await resp.text());
    assert.strictEqual(body.type, 'message');
    assert.strictEqual(body.role, 'assistant');
    assert.strictEqual(body.content[0].type, 'text');
    assert.strictEqual(body.content[0].text, 'Hello!');
    assert.strictEqual(body.stop_reason, 'end_turn');
    assert.strictEqual(body.usage.input_tokens, 10);
    assert.strictEqual(body.usage.output_tokens, 5);
    console.log('  oaiToAnthropicResponse text: PASS');
  }

  {
    const oaiJson = {
      id: 'chatcmpl-456',
      choices: [{ message: { role: 'assistant', content: null, tool_calls: [
        { id: 'tc_1', type: 'function', function: { name: 'bash', arguments: '{"command":"ls"}' } },
      ]}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 20, completion_tokens: 10 },
    };
    const resp = oaiToAnthropicResponse(oaiJson, 'gpt-4o');
    const body = JSON.parse(await resp.text());
    assert.strictEqual(body.stop_reason, 'tool_use');
    assert.strictEqual(body.content[0].type, 'tool_use');
    assert.strictEqual(body.content[0].name, 'bash');
    assert.deepStrictEqual(body.content[0].input, { command: 'ls' });
    console.log('  oaiToAnthropicResponse tool_calls: PASS');
  }

  // ── makeSseStream ──
  {
    const sseLines = [
      'data: {"choices":[{"delta":{"content":"Hi"},"index":0}]}',
      'data: {"choices":[{"delta":{"content":" there"},"index":0}]}',
      'data: {"choices":[{"index":0,"finish_reason":"stop"}]}',
    ];
    const output = await drainStream(makeSseStream(mockSseResponse(sseLines), 'gpt-4o'));
    assert.ok(output.includes('event: message_start'), 'missing message_start');
    assert.ok(output.includes('event: content_block_start'), 'missing content_block_start');
    assert.ok(output.includes('"text_delta"'), 'missing text_delta');
    assert.ok(output.includes('"Hi"'), 'missing first chunk');
    assert.ok(output.includes('" there"'), 'missing second chunk');
    assert.ok(output.includes('event: message_stop'), 'missing message_stop');
    console.log('  makeSseStream text: PASS');
  }

  {
    const sseLines = [
      'data: {"choices":[{"delta":{"content":"OK"},"index":0}]}',
      'data: [DONE]',
    ];
    const output = await drainStream(makeSseStream(mockSseResponse(sseLines), 'gpt-4o'));
    assert.ok(output.includes('event: message_stop'), 'missing message_stop on [DONE]');
    assert.ok(output.includes('"end_turn"'), 'missing end_turn stop reason');
    console.log('  makeSseStream [DONE]: PASS');
  }

  // ── makeResponsesSseStream ──
  {
    const sseLines = [
      'data: {"type":"response.created","response":{"id":"resp_1","usage":{"input_tokens":5}}}',
      'data: {"type":"response.output_text.delta","delta":"Hello"}',
      'data: {"type":"response.output_text.delta","delta":" world"}',
      'data: {"type":"response.output_text.done"}',
      'data: {"type":"response.completed","response":{"usage":{"output_tokens":2}}}',
    ];
    const output = await drainStream(makeResponsesSseStream(mockSseResponse(sseLines), 'gpt-5.4'));
    assert.ok(output.includes('event: message_start'), 'missing message_start');
    assert.ok(output.includes('"Hello"'), 'missing first delta');
    assert.ok(output.includes('" world"'), 'missing second delta');
    assert.ok(output.includes('event: message_stop'), 'missing message_stop');
    console.log('  makeResponsesSseStream text: PASS');
  }

  {
    const sseLines = [
      'data: {"type":"response.created","response":{"id":"resp_2"}}',
      'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"fc_1","name":"bash"}}',
      'data: {"type":"response.function_call_arguments.delta","delta":"{\\"cmd\\""}',
      'data: {"type":"response.function_call_arguments.done"}',
      'data: {"type":"response.completed","response":{"usage":{"output_tokens":3}}}',
    ];
    const output = await drainStream(makeResponsesSseStream(mockSseResponse(sseLines), 'gpt-5.4'));
    assert.ok(output.includes('event: message_start'), 'missing message_start');
    assert.ok(output.includes('"tool_use"'), 'missing tool_use block');
    assert.ok(output.includes('"bash"'), 'missing tool name');
    assert.ok(output.includes('"input_json_delta"'), 'missing input_json_delta');
    assert.ok(output.includes('event: message_stop'), 'missing message_stop');
    console.log('  makeResponsesSseStream tool_call: PASS');
  }

  console.log('\nAll _base tests passed.');
})().catch(e => { console.error(e); process.exit(1); });
