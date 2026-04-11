# Provider Modularization Implementation Plan — COMPLETED 2026-04-11

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 3 scattered patch files (providers.cjs, identity.cjs, platform.cjs) with a single-engine governed provider system where each provider is a self-contained config file and one engine generates all patches.

**Architecture:** Provider config files (`providers/*.cjs`) declare identity, models, context window, tier names, adapter, and auth. A shared base (`_base.cjs`) holds protocol translation functions. The engine (`provider-engine.cjs`) loads configs, validates schemas, serializes adapters, and generates all provider-related patches. Match string constants are centralized in the engine — upstream upgrades only touch those constants.

**Tech Stack:** Node.js (CommonJS), string injection into minified binary, SSE stream translation, JWT token handling.

**Spec:** `docs/superpowers/specs/2026-04-11-provider-modularization-design.md`

**Spec extensions:** Two fields are added to `identity` beyond what the spec defines:
1. `modelDisplayNames` — table mapping model strings to TUI display names (e.g. `'gpt-5.4': 'GPT 5.4'`). Required for patch 60 (per-model TUI title bar display). Null = use upstream default.
2. `sdkPrompt` — SDK/Agent SDK identity string. Required for patch 62. Null = use shared default.

---

### Task 1: Create Shared Base (`_base.cjs`) + Tests

**Files:**
- Create: `pipeline/patches/providers/_base.cjs`
- Create: `tests/base.test.cjs`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p pipeline/patches/providers
mkdir -p tests
```

- [ ] **Step 2: Write tests for `mapModel` and `msgToOai`**

```javascript
// tests/base.test.cjs
const assert = require('assert');
const { mapModel, msgToOai } = require('../pipeline/patches/providers/_base.cjs');

// ── mapModel ──
(function testMapModel() {
  const table = {
    'claude-opus': 'gpt-5.4',
    'claude-sonnet': 'gpt-5.4',
    'claude-haiku': 'gpt-5.3-codex',
    default: 'gpt-5.4',
  };

  // Known mapping
  assert.strictEqual(mapModel('claude-opus-4-6', table), 'gpt-5.4');
  assert.strictEqual(mapModel('claude-haiku-4-5', table), 'gpt-5.3-codex');

  // Unknown model → default
  assert.strictEqual(mapModel('unknown-model', table), 'gpt-5.4');

  // Null table → pass through
  assert.strictEqual(mapModel('claude-opus-4-6', null), 'claude-opus-4-6');

  // Null model → return model
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
  // Should produce one assistant message with both content and tool_calls
  assert.strictEqual(result[0].role, 'assistant');
  assert.ok(result[0].tool_calls);
  assert.strictEqual(result[0].content, 'Running command.');
  console.log('  msgToOai mixed: PASS');
})();

console.log('\nAll _base tests passed.');
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node tests/base.test.cjs`
Expected: FAIL with `Cannot find module '../pipeline/patches/providers/_base.cjs'`

- [ ] **Step 4: Create `_base.cjs` with all 5 protocol functions**

```javascript
// pipeline/patches/providers/_base.cjs
/**
 * _base.cjs — Shared protocol translation functions
 *
 * These functions are serialized as strings and injected into the binary
 * alongside provider adapters. They run in the upstream client factory scope.
 *
 * Exports are also used directly in tests (Node.js module context).
 */

function mapModel(model, table) {
  if (!table || !model) return model;
  for (const [k, v] of Object.entries(table)) {
    if (k !== 'default' && model.includes(k)) return v;
  }
  return table.default || model;
}

function msgToOai(msg) {
  if (typeof msg.content === 'string') return [{ role: msg.role, content: msg.content }];
  if (!Array.isArray(msg.content)) return [{ role: msg.role, content: String(msg.content || '') }];
  const _texts = [], _toolCalls = [], _toolResults = [];
  for (const p of msg.content) {
    if (p.type === 'text') _texts.push({ type: 'text', text: p.text });
    else if (p.type === 'image') _texts.push({ type: 'image_url', image_url: { url: 'data:' + p.source.media_type + ';base64,' + p.source.data } });
    else if (p.type === 'tool_use') _toolCalls.push({ id: p.id || 'tc_' + Date.now(), type: 'function', function: { name: p.name, arguments: JSON.stringify(p.input || {}) } });
    else if (p.type === 'tool_result') {
      const _c = typeof p.content === 'string' ? p.content : (p.content || []).map(c => c.text || '').join('');
      _toolResults.push({ role: 'tool', tool_call_id: p.tool_use_id, content: _c });
    }
    else _texts.push({ type: 'text', text: JSON.stringify(p) });
  }
  const _out = [];
  if (_toolCalls.length > 0) {
    const _am = { role: 'assistant', tool_calls: _toolCalls };
    if (_texts.length > 0) _am.content = _texts.length === 1 && _texts[0].type === 'text' ? _texts[0].text : _texts;
    else _am.content = null;
    _out.push(_am);
  } else if (_texts.length > 0) {
    _out.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: _texts.length === 1 && _texts[0].type === 'text' ? _texts[0].text : _texts });
  }
  for (const tr of _toolResults) _out.push(tr);
  return _out;
}

function msgsToResponsesInput(system, messages) {
  const _parts = [];
  if (system) { _parts.push({ type: 'message', role: 'developer', content: typeof system === 'string' ? system : (system || []).map(p => p.text || '').join('') }); }
  for (const m of (messages || [])) {
    if (typeof m.content === 'string') { _parts.push({ type: 'message', role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }); continue; }
    if (!Array.isArray(m.content)) { _parts.push({ type: 'message', role: m.role === 'user' ? 'user' : 'assistant', content: String(m.content || '') }); continue; }
    const _text = m.content.map(p => {
      if (p.type === 'text') return p.text;
      if (p.type === 'tool_result') return '[Tool result id=' + p.tool_use_id + ']: ' + (typeof p.content === 'string' ? p.content : (p.content || []).map(c => c.text || '').join(''));
      if (p.type === 'tool_use') return '[Tool call ' + p.name + ': ' + JSON.stringify(p.input) + ']';
      return JSON.stringify(p);
    }).join('');
    _parts.push({ type: 'message', role: m.role === 'user' ? 'user' : 'assistant', content: _text });
  }
  return _parts;
}

function makeSseStream(oaiResp, model) {
  const _enc = new TextEncoder(), _dec = new TextDecoder();
  const _msgId = 'msg_sc_' + Date.now();
  let _sentStart = false, _blockIdx = 0, _blockOpen = false, _outTok = 0;
  return new ReadableStream({ async start(ctrl) {
    const _rd = oaiResp.body.getReader(); let _buf = '';
    const _send = (ev, d) => ctrl.enqueue(_enc.encode('event: ' + ev + '\ndata: ' + JSON.stringify(d) + '\n\n'));
    try { while (true) {
      const { done, value } = await _rd.read(); if (done) break;
      _buf += _dec.decode(value, { stream: true });
      const _lines = _buf.split('\n'); _buf = _lines.pop() || '';
      for (const line of _lines) {
        if (!line.startsWith('data: ')) continue;
        const _d = line.slice(6).trim();
        if (_d === '[DONE]') {
          if (_blockOpen) _send('content_block_stop', { type: 'content_block_stop', index: _blockIdx });
          _send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: _outTok } });
          _send('message_stop', { type: 'message_stop' }); ctrl.close(); return;
        }
        let _chunk; try { _chunk = JSON.parse(_d) } catch { continue }
        if (!_sentStart) { _sentStart = true; _send('message_start', { type: 'message_start', message: { id: _msgId, type: 'message', role: 'assistant', content: [], model, stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } }); }
        const _ch = _chunk.choices?.[0]; if (!_ch) continue;
        const _dt = _ch.delta || {};
        if (_dt.content != null) {
          if (!_blockOpen) { _blockOpen = true; _send('content_block_start', { type: 'content_block_start', index: _blockIdx, content_block: { type: 'text', text: '' } }); }
          _outTok++; _send('content_block_delta', { type: 'content_block_delta', index: _blockIdx, delta: { type: 'text_delta', text: _dt.content } });
        }
        if (_dt.tool_calls) {
          for (const tc of _dt.tool_calls) {
            const ti = tc.index || 0;
            if (_blockOpen) { _send('content_block_stop', { type: 'content_block_stop', index: _blockIdx }); _blockIdx++; _blockOpen = false; }
            if (tc.function?.name) _send('content_block_start', { type: 'content_block_start', index: _blockIdx + ti, content_block: { type: 'tool_use', id: 'tc_' + (tc.id || ti + '_' + Date.now()), name: tc.function.name, input: {} } });
            if (tc.function?.arguments) _send('content_block_delta', { type: 'content_block_delta', index: _blockIdx + ti, delta: { type: 'input_json_delta', partial_json: tc.function.arguments } });
          }
        }
        if (_ch.finish_reason) {
          if (_blockOpen) _send('content_block_stop', { type: 'content_block_stop', index: _blockIdx });
          _send('message_delta', { type: 'message_delta', delta: { stop_reason: _ch.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn' }, usage: { output_tokens: _outTok } });
          _send('message_stop', { type: 'message_stop' }); ctrl.close(); return;
        }
      }
    } } catch (e) { ctrl.error(e); }
  } });
}

function makeResponsesSseStream(oaiResp, model) {
  const _enc = new TextEncoder(), _dec = new TextDecoder();
  const _msgId = 'msg_sc_' + Date.now();
  let _blockIdx = 0, _blockOpen = false, _outTok = 0, _sentStart = false;
  return new ReadableStream({ async start(ctrl) {
    const _rd = oaiResp.body.getReader(); let _buf = '';
    const _send = (ev, d) => ctrl.enqueue(_enc.encode('event: ' + ev + '\ndata: ' + JSON.stringify(d) + '\n\n'));
    try { while (true) {
      const { done, value } = await _rd.read(); if (done) break;
      _buf += _dec.decode(value, { stream: true });
      const _lines = _buf.split('\n'); _buf = _lines.pop() || '';
      for (const line of _lines) {
        if (!line.startsWith('data: ')) continue;
        const _d = line.slice(6).trim();
        if (_d === '[DONE]') {
          if (_blockOpen) _send('content_block_stop', { type: 'content_block_stop', index: _blockIdx });
          _send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: _outTok } });
          _send('message_stop', { type: 'message_stop' }); ctrl.close(); return;
        }
        let _ev; try { _ev = JSON.parse(_d) } catch { continue }
        const _t = _ev.type;
        if (_t === 'response.created' && !_sentStart) {
          _sentStart = true;
          _send('message_start', { type: 'message_start', message: { id: _ev.response?.id || _msgId, type: 'message', role: 'assistant', content: [], model, stop_reason: null, usage: { input_tokens: _ev.response?.usage?.input_tokens || 0, output_tokens: 0 } } });
        }
        if (_t === 'response.output_text.delta') {
          if (!_sentStart) { _sentStart = true; _send('message_start', { type: 'message_start', message: { id: _msgId, type: 'message', role: 'assistant', content: [], model, stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } }); }
          if (!_blockOpen) { _blockOpen = true; _send('content_block_start', { type: 'content_block_start', index: _blockIdx, content_block: { type: 'text', text: '' } }); }
          _outTok++;
          _send('content_block_delta', { type: 'content_block_delta', index: _blockIdx, delta: { type: 'text_delta', text: _ev.delta || '' } });
        }
        if (_t === 'response.output_item.added' && _ev.item?.type === 'function_call') {
          if (_blockOpen) { _send('content_block_stop', { type: 'content_block_stop', index: _blockIdx }); _blockIdx++; _blockOpen = false; }
          _send('content_block_start', { type: 'content_block_start', index: _blockIdx, content_block: { type: 'tool_use', id: _ev.item.call_id || 'tc_' + Date.now(), name: _ev.item.name || '', input: {} } });
          _blockOpen = true;
        }
        if (_t === 'response.function_call_arguments.delta') {
          _send('content_block_delta', { type: 'content_block_delta', index: _blockIdx, delta: { type: 'input_json_delta', partial_json: _ev.delta || '' } });
        }
        if (_t === 'response.function_call_arguments.done') {
          if (_blockOpen) { _send('content_block_stop', { type: 'content_block_stop', index: _blockIdx }); _blockIdx++; _blockOpen = false; }
        }
        if (_t === 'response.output_text.done') {
          if (_blockOpen) { _send('content_block_stop', { type: 'content_block_stop', index: _blockIdx }); _blockIdx++; _blockOpen = false; }
        }
        if (_t === 'response.completed') {
          if (_blockOpen) { _send('content_block_stop', { type: 'content_block_stop', index: _blockIdx }); }
          const _u = _ev.response?.usage || {};
          _send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: _u.output_tokens || _outTok } });
          _send('message_stop', { type: 'message_stop' }); ctrl.close(); return;
        }
      }
    } } catch (e) { ctrl.error(e); }
  } });
}

module.exports = { mapModel, msgToOai, msgsToResponsesInput, makeSseStream, makeResponsesSseStream };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node tests/base.test.cjs`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add pipeline/patches/providers/_base.cjs tests/base.test.cjs
git commit -m "feat: extract shared base protocol functions with tests"
```

---

### Task 2: Create Provider Config Files

**Files:**
- Create: `pipeline/patches/providers/claude.cjs`
- Create: `pipeline/patches/providers/openai.cjs`
- Create: `pipeline/patches/providers/copilot.cjs`

- [ ] **Step 1: Create `claude.cjs` (minimal config)**

```javascript
// pipeline/patches/providers/claude.cjs
/**
 * Claude provider — default/fallback
 *
 * No adapter or auth: uses the native Anthropic SDK unmodified.
 * Only identity overrides (Silly Code branding) and tier names.
 */
module.exports = {
  key: 'claude',
  runtimeId: 'firstParty',
  envKey: null,
  priority: null,

  identity: {
    displayName: null,
    systemPrompt: 'You are Silly Code, a multi-provider AI coding assistant, currently running with Claude as the backend model.',
    agentPrompt: 'You are a Silly Code agent, running with Claude.',
    simplePrompt: 'You are Silly Code (Claude).',
    sdkPrompt: 'You are Silly Code, a multi-provider AI coding assistant, running within the Agent SDK.',
    modelDisplayNames: null,
  },

  models: null,
  contextWindow: null,
  tierNames: { max: 'Claude Max', pro: 'Claude Pro', api: 'Claude API' },

  adapter: null,
  auth: null,
};
```

- [ ] **Step 2: Create `openai.cjs` (config + adapter + auth)**

```javascript
// pipeline/patches/providers/openai.cjs
/**
 * OpenAI/Codex provider
 *
 * Dual-mode: OAuth (ChatGPT) → Responses API, API key → Chat Completions.
 * adapter and auth are serialized and injected into the binary at build time.
 */

// ── Auth function (serialized) ──
async function _openaiAuth() {
  if (!_openaiData) {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const _dir = process.env.SILLY_CODE_DATA || join(process.env.HOME || '~', '.silly-code');
    try { _openaiData = JSON.parse(readFileSync(join(_dir, 'codex-auth.json'), 'utf8')); }
    catch (e) {
      // Fallback: try legacy filename
      try { _openaiData = JSON.parse(readFileSync(join(_dir, 'codex-oauth.json'), 'utf8')); }
      catch (e2) { throw new Error('OpenAI: no auth token. Run: silly login codex'); }
    }
  }
  if (!_openaiData.access_token) throw new Error('OpenAI: invalid token file');
  // Check JWT expiry
  try {
    const _parts = _openaiData.access_token.split('.');
    if (_parts.length === 3) {
      const _pay = JSON.parse(atob(_parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (_pay.exp && Date.now() < (_pay.exp * 1000 - 120000)) {
        const _isOAuth = _openaiData.access_token.startsWith('ey');
        return { headers: { Authorization: 'Bearer ' + _openaiData.access_token }, kind: _isOAuth ? 'oauth' : 'apikey' };
      }
    }
  } catch {}
  // Token expired or unreadable — try refresh
  if (!_openaiData.refresh_token) {
    const _isOAuth = _openaiData.access_token.startsWith('ey');
    return { headers: { Authorization: 'Bearer ' + _openaiData.access_token }, kind: _isOAuth ? 'oauth' : 'apikey' };
  }
  try {
    const _r = await fetch('https://auth.openai.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: 'app_EMoamEEZ73f0CkXaXp7hrann', refresh_token: _openaiData.refresh_token }).toString() });
    if (_r.ok) {
      const _d = await _r.json();
      _openaiData.access_token = _d.access_token || _openaiData.access_token;
      if (_d.refresh_token) _openaiData.refresh_token = _d.refresh_token;
      _openaiData.savedAt = new Date().toISOString();
      try { const { writeFileSync } = await import('node:fs'); const { join } = await import('node:path'); const _dir = process.env.SILLY_CODE_DATA || join(process.env.HOME || '~', '.silly-code'); writeFileSync(join(_dir, 'codex-auth.json'), JSON.stringify(_openaiData, null, 2)); } catch {}
    }
  } catch {}
  const _isOAuth = _openaiData.access_token.startsWith('ey');
  return { headers: { Authorization: 'Bearer ' + _openaiData.access_token }, kind: _isOAuth ? 'oauth' : 'apikey' };
}

// ── Adapter function (serialized) ──
async function _openaiAdapter(url, init) {
  const cred = await _openaiAuth();
  const _b = JSON.parse(init.body);

  if (cred.kind === 'oauth') {
    // ChatGPT OAuth → Responses API
    const CODEX_MODELS = { 'claude-opus': 'gpt-5.4', 'claude-sonnet': 'gpt-5.4', 'claude-haiku': 'gpt-5.3-codex', default: 'gpt-5.4' };
    const _om = mapModel(_b.model, CODEX_MODELS);
    const _sysText = typeof _b.system === 'string' ? _b.system : (_b.system || []).map(p => p.text || '').join('');
    const _input = msgsToResponsesInput(null, _b.messages);
    const _req = { model: _om, instructions: _sysText || 'You are a helpful coding assistant.', input: _input, store: false, stream: true };
    if (_b.tools && _b.tools.length) { _req.tools = _b.tools.map(t => ({ type: 'function', name: t.name, description: t.description || '', parameters: t.input_schema || { type: 'object', properties: {} } })); }
    const _r = await fetch('https://chatgpt.com/backend-api/codex/responses', { method: 'POST', headers: { 'Content-Type': 'application/json', ...cred.headers }, body: JSON.stringify(_req) });
    if (!_r.ok) { const _e = await _r.text(); throw new Error('Codex API error ' + _r.status + ': ' + _e); }
    return new Response(makeResponsesSseStream(_r, _b.model), { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  } else {
    // API key → Chat Completions
    const CHAT_MODELS = { 'claude-opus': 'gpt-4o', 'claude-sonnet': 'gpt-4o', 'claude-haiku': 'gpt-4o-mini', default: 'gpt-4o' };
    const _om = mapModel(_b.model, CHAT_MODELS);
    const _msgs = [];
    if (_b.system) _msgs.push({ role: 'system', content: typeof _b.system === 'string' ? _b.system : (_b.system || []).map(p => p.text || '').join('') });
    for (const m of (_b.messages || [])) _msgs.push(...msgToOai(m));
    const _req = { model: _om, messages: _msgs, stream: !!_b.stream, max_tokens: _b.max_tokens || 4096, temperature: _b.temperature != null ? _b.temperature : 1 };
    if (_b.tools && _b.tools.length) { _req.tools = _b.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.input_schema || { type: 'object', properties: {} } } })); _req.tool_choice = 'auto'; }
    const _r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...cred.headers }, body: JSON.stringify(_req) });
    if (!_r.ok) { const _e = await _r.text(); throw new Error('OpenAI API error ' + _r.status + ': ' + _e); }
    if (_b.stream) return new Response(makeSseStream(_r, _b.model), { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    const _d = await _r.json(); const _c = _d.choices?.[0], _mg = _c?.message, _ct = [];
    if (_mg?.content) _ct.push({ type: 'text', text: _mg.content });
    if (_mg?.tool_calls) for (const tc of _mg.tool_calls) { let _i = {}; try { _i = JSON.parse(tc.function.arguments || '{}'); } catch {} _ct.push({ type: 'tool_use', id: tc.id || 'tc_' + Date.now(), name: tc.function.name, input: _i }); }
    return new Response(JSON.stringify({ id: 'msg_' + (_d.id || Date.now()), type: 'message', role: 'assistant', content: _ct, model: _b.model, stop_reason: _c?.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn', usage: { input_tokens: _d.usage?.prompt_tokens || 0, output_tokens: _d.usage?.completion_tokens || 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
}

module.exports = {
  key: 'openai',
  runtimeId: 'openai',
  envKey: 'CLAUDE_CODE_USE_OPENAI',
  priority: 10,

  identity: {
    displayName: 'OpenAI GPT',
    systemPrompt: 'You are Silly Code, a multi-provider AI coding assistant, currently running with OpenAI GPT as the backend model.',
    agentPrompt: 'You are a Silly Code agent, running with OpenAI GPT.',
    simplePrompt: 'You are Silly Code (OpenAI GPT).',
    sdkPrompt: null,
    modelDisplayNames: {
      'gpt-5.4-mini': 'GPT 5.4 Mini',
      'gpt-5.4': 'GPT 5.4',
      'gpt-5.3-codex': 'GPT 5.3 Codex',
      'gpt-4o-mini': 'GPT 4o Mini',
      'gpt-4o': 'GPT 4o',
      'o3': 'o3',
      'claude-opus': 'GPT 5.4',
      'claude-sonnet': 'GPT 5.4',
      'claude-haiku': 'GPT 5.3 Codex',
      default: 'GPT 5.4',
    },
  },

  models: {
    'claude-opus': 'gpt-5.4',
    'claude-sonnet': 'gpt-5.4',
    'claude-haiku': 'gpt-5.3-codex',
    default: 'gpt-5.4',
  },

  contextWindow: {
    default: 120000,
    perModel: {},
  },

  tierNames: { max: 'ChatGPT Pro', pro: 'ChatGPT Plus', api: 'OpenAI API' },

  adapter: _openaiAdapter,
  auth: _openaiAuth,
};
```

- [ ] **Step 3: Create `copilot.cjs` (config + adapter + auth)**

```javascript
// pipeline/patches/providers/copilot.cjs
/**
 * GitHub Copilot provider
 *
 * Uses GitHub OAuth token to get Copilot API token, then Chat Completions API.
 * adapter and auth are serialized and injected into the binary at build time.
 */

// ── Auth function (serialized) ──
async function _copilotAuth() {
  if (!_copilotData) {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const _dir = process.env.SILLY_CODE_DATA || join(process.env.HOME || '~', '.silly-code');
    try { _copilotData = JSON.parse(readFileSync(join(_dir, 'copilot-auth.json'), 'utf8')); }
    catch (e) {
      try { _copilotData = JSON.parse(readFileSync(join(_dir, 'copilot-oauth.json'), 'utf8')); }
      catch (e2) { throw new Error('Copilot: no auth token. Run: silly login copilot'); }
    }
  }
  // Check if cached Copilot token is still valid
  if (_copilotData.copilotToken && _copilotData.copilotExpiresAt && Date.now() < _copilotData.copilotExpiresAt - 60000) {
    return {
      headers: { Authorization: 'Bearer ' + _copilotData.copilotToken, 'Copilot-Integration-Id': 'vscode-chat', 'Editor-Version': 'vscode/1.85.0' },
      kind: 'oauth',
    };
  }
  // Refresh Copilot token via GitHub API
  const _r = await fetch('https://api.github.com/copilot_internal/v2/token', { method: 'GET', headers: { 'Authorization': 'Bearer ' + _copilotData.githubToken, 'Editor-Version': 'vscode/1.85.0', 'Copilot-Integration-Id': 'vscode-chat' } });
  if (!_r.ok) throw new Error('Copilot token refresh failed: ' + _r.status);
  const _d = await _r.json();
  _copilotData.copilotToken = _d.token;
  _copilotData.copilotExpiresAt = (_d.expires_at || 0) * 1000;
  try { const { writeFileSync } = await import('node:fs'); const { join } = await import('node:path'); const _dir = process.env.SILLY_CODE_DATA || join(process.env.HOME || '~', '.silly-code'); writeFileSync(join(_dir, 'copilot-auth.json'), JSON.stringify(_copilotData)); } catch {}
  return {
    headers: { Authorization: 'Bearer ' + _copilotData.copilotToken, 'Copilot-Integration-Id': 'vscode-chat', 'Editor-Version': 'vscode/1.85.0' },
    kind: 'oauth',
  };
}

// ── Adapter function (serialized) ──
async function _copilotAdapter(url, init) {
  const cred = await _copilotAuth();
  const _b = JSON.parse(init.body);
  const COPILOT_MODELS = { 'claude-opus': 'gpt-4o', 'claude-sonnet': 'gpt-4o', 'claude-haiku': 'gpt-4o-mini', default: 'gpt-4o' };
  const _om = mapModel(_b.model, COPILOT_MODELS);
  const _msgs = [];
  if (_b.system) _msgs.push({ role: 'system', content: typeof _b.system === 'string' ? _b.system : (_b.system || []).map(p => p.text || '').join('') });
  for (const m of (_b.messages || [])) _msgs.push(...msgToOai(m));
  const _req = { model: _om, messages: _msgs, stream: !!_b.stream, max_tokens: _b.max_tokens || 4096 };
  if (_b.tools && _b.tools.length) { _req.tools = _b.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.input_schema || { type: 'object', properties: {} } } })); _req.tool_choice = 'auto'; }
  const _r = await fetch('https://api.githubcopilot.com/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...cred.headers }, body: JSON.stringify(_req) });
  if (!_r.ok) { const _e = await _r.text(); throw new Error('Copilot API error ' + _r.status + ': ' + _e); }
  if (_b.stream) return new Response(makeSseStream(_r, _b.model), { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  const _d = await _r.json(); const _c = _d.choices?.[0], _mg = _c?.message, _ct = [];
  if (_mg?.content) _ct.push({ type: 'text', text: _mg.content });
  if (_mg?.tool_calls) for (const tc of _mg.tool_calls) { let _i = {}; try { _i = JSON.parse(tc.function.arguments || '{}'); } catch {} _ct.push({ type: 'tool_use', id: tc.id || 'tc_' + Date.now(), name: tc.function.name, input: _i }); }
  return new Response(JSON.stringify({ id: 'msg_' + (_d.id || Date.now()), type: 'message', role: 'assistant', content: _ct, model: _b.model, stop_reason: _c?.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn', usage: { input_tokens: _d.usage?.prompt_tokens || 0, output_tokens: _d.usage?.completion_tokens || 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

module.exports = {
  key: 'copilot',
  runtimeId: 'copilot',
  envKey: 'CLAUDE_CODE_USE_COPILOT',
  priority: 20,

  identity: {
    displayName: 'GitHub Copilot',
    systemPrompt: 'You are Silly Code, a multi-provider AI coding assistant, currently running with GitHub Copilot as the backend model.',
    agentPrompt: 'You are a Silly Code agent, running with GitHub Copilot.',
    simplePrompt: 'You are Silly Code (GitHub Copilot).',
    sdkPrompt: null,
    modelDisplayNames: {
      'gpt-4o-mini': 'GPT 4o Mini (Copilot)',
      'gpt-4o': 'GPT 4o (Copilot)',
      'o3': 'o3 (Copilot)',
      'claude-opus': 'GPT 4o (Copilot)',
      'claude-sonnet': 'GPT 4o (Copilot)',
      'claude-haiku': 'GPT 4o Mini (Copilot)',
      default: 'GPT 4o (Copilot)',
    },
  },

  models: {
    'claude-opus': 'gpt-4o',
    'claude-sonnet': 'gpt-4o',
    'claude-haiku': 'gpt-4o-mini',
    default: 'gpt-4o',
  },

  contextWindow: {
    default: 30000,
    perModel: {},
  },

  tierNames: { max: 'Copilot Pro', pro: 'Copilot', api: 'Copilot API' },

  adapter: _copilotAdapter,
  auth: _copilotAuth,
};
```

- [ ] **Step 4: Verify configs load without errors**

Run: `node -e "const c=require('./pipeline/patches/providers/claude.cjs');const o=require('./pipeline/patches/providers/openai.cjs');const p=require('./pipeline/patches/providers/copilot.cjs');console.log('Loaded:',c.key,o.key,p.key);console.log('Adapters:',typeof o.adapter,typeof p.adapter);console.log('Auth:',typeof o.auth,typeof p.auth)"`

Expected:
```
Loaded: claude openai copilot
Adapters: function function
Auth: function function
```

- [ ] **Step 5: Commit**

```bash
git add pipeline/patches/providers/claude.cjs pipeline/patches/providers/openai.cjs pipeline/patches/providers/copilot.cjs
git commit -m "feat: add provider config files (claude, openai, copilot)"
```

---

### Task 3: Create Provider Engine — Loading & Schema Validation

**Files:**
- Create: `pipeline/patches/provider-engine.cjs`
- Create: `tests/schema.test.cjs`

- [ ] **Step 1: Write schema validation tests**

```javascript
// tests/schema.test.cjs
const assert = require('assert');

// We'll test the validate function directly by requiring the engine's internals
// For now, test by requiring the engine with real provider configs
const path = require('path');

// Test 1: Real configs load and validate
(function testRealConfigs() {
  // The engine exports a function; calling it needs patch/patchAll which we mock
  const results = [];
  const mockHelpers = {
    patch(name) { results.push({ name, status: 'OK' }); },
    patchAll(name) { results.push({ name, status: 'OK' }); },
  };

  // Temporarily override src for engine to read (engine needs binary source)
  // Instead, test the validation by loading providers directly
  const fs = require('fs');
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

  console.log('  Schema validation (real configs): PASS');
})();

console.log('\nAll schema tests passed.');
```

- [ ] **Step 2: Run tests to verify they pass** (these validate existing configs, should pass now)

Run: `node tests/schema.test.cjs`
Expected: PASS

- [ ] **Step 3: Create engine file with loading + validation**

```javascript
// pipeline/patches/provider-engine.cjs
/**
 * provider-engine.cjs — Loads provider configs, validates schemas,
 * generates all provider-related patches from aggregated configs.
 *
 * Replaces: providers.cjs, identity.cjs, platform.cjs
 */

const fs = require('fs');
const path = require('path');

// ── Load providers ──
const PROVIDERS_DIR = path.join(__dirname, 'providers');
const base = require(path.join(PROVIDERS_DIR, '_base.cjs'));
const providerFiles = fs.readdirSync(PROVIDERS_DIR)
  .filter(f => f.endsWith('.cjs') && f !== '_base.cjs')
  .sort();
const providers = providerFiles.map(f => {
  const p = require(path.join(PROVIDERS_DIR, f));
  // Normalize contextWindow shorthand
  if (typeof p.contextWindow === 'number') {
    p.contextWindow = { default: p.contextWindow, perModel: {} };
  } else if (p.contextWindow && !p.contextWindow.perModel) {
    p.contextWindow = { ...p.contextWindow, perModel: {} };
  }
  return p;
});

// ── Schema validation ──
function validate(providers) {
  const keys = new Set();
  const runtimeIds = new Set();
  const envKeys = new Set();
  const priorities = new Set();
  let defaultCount = 0;

  for (const p of providers) {
    // key
    if (!p.key || typeof p.key !== 'string') throw new Error(`Provider missing key`);
    if (keys.has(p.key)) throw new Error(`Duplicate provider key: ${p.key}`);
    keys.add(p.key);

    // runtimeId
    if (!p.runtimeId || typeof p.runtimeId !== 'string') throw new Error(`${p.key}: missing runtimeId`);
    if (runtimeIds.has(p.runtimeId)) throw new Error(`Duplicate runtimeId: ${p.runtimeId} (provider ${p.key})`);
    runtimeIds.add(p.runtimeId);

    // envKey
    if (p.envKey === null) {
      defaultCount++;
    } else {
      if (envKeys.has(p.envKey)) throw new Error(`Duplicate envKey: ${p.envKey}`);
      envKeys.add(p.envKey);
    }

    // priority
    if (p.priority != null) {
      if (priorities.has(p.priority)) throw new Error(`Duplicate priority: ${p.priority} (provider ${p.key})`);
      priorities.add(p.priority);
    }

    // models
    if (p.models && !p.models.default) throw new Error(`${p.key}: models table missing 'default' entry`);

    // tierNames
    if (!p.tierNames || !p.tierNames.max || !p.tierNames.pro || !p.tierNames.api) {
      throw new Error(`${p.key}: tierNames must have max, pro, api`);
    }

    // adapter/auth pairing
    if (p.adapter && !p.auth) throw new Error(`${p.key}: adapter requires auth`);
    if (p.adapter && typeof p.adapter !== 'function') throw new Error(`${p.key}: adapter must be a function`);
    if (p.auth && typeof p.auth !== 'function') throw new Error(`${p.key}: auth must be a function`);

    // identity
    if (!p.identity?.systemPrompt) throw new Error(`${p.key}: identity.systemPrompt required`);

    // contextWindow
    if (p.contextWindow && typeof p.contextWindow.default !== 'number') {
      throw new Error(`${p.key}: contextWindow.default must be a number`);
    }
  }

  if (defaultCount !== 1) throw new Error(`Exactly one provider must have envKey: null (found ${defaultCount})`);
}

// ── Match string constants (upstream v2.1.101) ──
const MATCH = {
  DETECT:      'return F6(process.env.CLAUDE_CODE_USE_BEDROCK)?"bedrock"',
  INJECT:      'P=cX(_);if(P==="bedrock")',
  RESOLVE:     'function D$(q=dq()){return q==="firstParty"||q==="anthropicAws"}',
  FAMILY:      'function lg(q=dq()){return q==="firstParty"||q==="anthropicAws"||q==="foundry"||q==="mantle"}',
  CONTEXT_DEFAULT: 'xL1=200000',
  DISPLAY:     'function y0(q){if(dq()==="foundry")return;',
  IDENTITY:    'Bh1="You are Claude Code, Anthropic\\\'s official CLI for Claude."',
  SDK_ID:      'z14="You are Claude Code, Anthropic\\\'s official CLI for Claude, running within the Claude Agent SDK."',
  AGENT_ID:    'Y14="You are a Claude agent, built on Anthropic\\\'s Claude Agent SDK."',
  MODEL_ID:    'You are powered by the model named ${$}. The exact model ID is ${q}.',
  SIMPLE_ID:   '?"You are Claude Code, Anthropic\\\'s official CLI for Claude.":`You are Claude Code, Anthropic\\\'s official CLI for Claude.',
  TIER:        'case"max":return"Claude Max";case"pro":return"Claude Pro";default:return"Claude API"',
  CONSTRUCTOR: 'gL',
  VERSION:     '// Version: 2.1.101',
};

// ── Serialization safeguards ──
function checkSerialization(code, label) {
  // Static scan
  if (/\brequire\s*\(/.test(code)) throw new Error(`${label}: bare require() detected`);
  if (/\b(module|exports|__dirname|__filename)\b/.test(code)) throw new Error(`${label}: module-scope reference detected`);
  const importMatches = code.match(/import\s*\([^)]+\)/g) || [];
  for (const im of importMatches) {
    if (!im.includes("'node:") && !im.includes('"node:')) throw new Error(`${label}: non-node: import detected: ${im}`);
  }
  // Isolation compile check (compile-level defense)
  try {
    new Function(code);
  } catch (e) {
    throw new Error(`${label}: compile check failed — ${e.message}`);
  }
  // Minimal execution verification: invoke with no-op fetch mock
  try {
    const mockFetch = () => Promise.resolve(new Response('{}', { status: 200 }));
    new Function('fetch', code)(mockFetch);
  } catch (e) {
    // ReferenceErrors during execution are expected (missing runtime vars like dq, cX)
    // Only fail on SyntaxError or TypeError indicating broken code structure
    if (e instanceof SyntaxError || e instanceof TypeError) {
      throw new Error(`${label}: execution verification failed — ${e.message}`);
    }
  }
}

// ── Patch generation ──
module.exports = function applyProviders({ patch, patchAll }) {
  validate(providers);

  const sorted = providers
    .filter(p => p.priority != null)
    .sort((a, b) => a.priority - b.priority);
  const fallback = providers.find(p => p.priority == null);
  const nonDefault = sorted; // providers with envKey (non-fallback)
  const allRuntimeIds = providers.filter(p => p.runtimeId !== 'firstParty').map(p => p.runtimeId);

  // ── Patch 10: Provider detection ──
  const detectChain = sorted.map(p =>
    `F6(process.env.${p.envKey})?"${p.runtimeId}"`
  ).join(':');
  patch('10-provider-detection',
    MATCH.DETECT,
    'return ' + detectChain + ':' + MATCH.DETECT.replace('return ', '')
  );

  // ── Patch 13: Model resolution ──
  const resolveExt = allRuntimeIds.map(id => `||q==="${id}"`).join('');
  patch('13-model-resolution',
    MATCH.RESOLVE,
    MATCH.RESOLVE.replace(
      'q==="firstParty"||q==="anthropicAws"}',
      'q==="firstParty"||q==="anthropicAws"' + resolveExt + '}'
    )
  );

  // ── Patch 14: Provider family ──
  const familyExt = allRuntimeIds.map(id => `||q==="${id}"`).join('');
  patch('14-provider-family',
    MATCH.FAMILY,
    MATCH.FAMILY.replace(
      'q==="foundry"||q==="mantle"}',
      'q==="foundry"||q==="mantle"' + familyExt + '}'
    )
  );

  // ── Patch 11-12: Adapter injection ──
  const adaptersWithCode = providers.filter(p => p.adapter);
  // Serialize _base.cjs functions
  const baseStr = Object.values(base).map(f => f.toString()).join(';');
  // Serialize per-provider state + auth + adapter
  const providerStrs = adaptersWithCode.map(p => {
    return `let _${p.key}Data=null;` +
      p.auth.toString() + ';' +
      p.adapter.toString();
  });
  const injectionCode = baseStr + ';' + providerStrs.join(';');

  // Safeguard check on combined injection code
  checkSerialization(injectionCode, 'adapter-injection');

  // Build adapter branches
  const adapterBranches = adaptersWithCode.map(p => {
    const adapterName = p.adapter.name;
    return `if(P==="${p.runtimeId}"){return new ${MATCH.CONSTRUCTOR}({...M,apiKey:'${p.key}-placeholder',fetch:${adapterName}});}`;
  }).join('');

  patch('11-12-provider-adapters',
    MATCH.INJECT,
    `P=cX(_);${injectionCode};${adapterBranches}if(P==="bedrock")`
  );

  // ── Patch 15: Model defaults ──
  patch('15-model-defaults',
    MATCH.VERSION,
    MATCH.VERSION + '\n' +
    'if(!process.env.ANTHROPIC_DEFAULT_SONNET_MODEL)process.env.ANTHROPIC_DEFAULT_SONNET_MODEL="claude-sonnet-4-6";\n' +
    'if(!process.env.ANTHROPIC_DEFAULT_OPUS_MODEL)process.env.ANTHROPIC_DEFAULT_OPUS_MODEL="claude-opus-4-6";\n' +
    'if(!process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL)process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL="claude-haiku-4-5";'
  );

  // ── Patch 50: Context window env vars ──
  const ctxProviders = nonDefault.filter(p => p.contextWindow);
  if (ctxProviders.length > 0) {
    const ctxIife = '(function(){' +
      ctxProviders.map((p, i) => {
        const cond = i === 0 ? 'if' : 'else if';
        return `${cond}(process.env.${p.envKey}){` +
          'process.env.DISABLE_COMPACT=process.env.DISABLE_COMPACT||"1";' +
          `process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS=process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS||"${p.contextWindow.default}";` +
          '}';
      }).join('') +
      '})();\n';

    patch('50-context-window',
      MATCH.VERSION + '\n' + 'if(!process.env.ANTHROPIC_DEFAULT_SONNET_MODEL)',
      MATCH.VERSION + '\n' + ctxIife + 'if(!process.env.ANTHROPIC_DEFAULT_SONNET_MODEL)'
    );
  }

  // ── Patch 51: Default context fallback with per-model support ──
  // Resolution: mappedModel = mapModel(requested, provider.models)
  //             → contextWindow.perModel[mappedModel] ?? contextWindow.default
  if (ctxProviders.length > 0) {
    // For providers with perModel overrides, generate nested lookup
    // For providers with only default, generate simple ternary
    const ctxChain = ctxProviders.map(p => {
      const hasPerModel = p.contextWindow.perModel && Object.keys(p.contextWindow.perModel).length > 0;
      if (hasPerModel) {
        // Build per-model lookup: check each model name against current model
        const perModelChecks = Object.entries(p.contextWindow.perModel)
          .map(([model, tokens]) => `(_cm&&_cm.includes("${model}"))?${tokens}`)
          .join(':');
        return `process.env.${p.envKey}?(function(){var _cm=typeof _==="string"?_:"";return ${perModelChecks}:${p.contextWindow.default}})()`;
      }
      return `process.env.${p.envKey}?${p.contextWindow.default}`;
    }).join(':');
    patch('51-default-context',
      MATCH.CONTEXT_DEFAULT,
      `xL1=(${ctxChain}:200000)`
    );
  }

  // ── Patch 60: Model display name ──
  const displayProviders = providers.filter(p => p.identity.modelDisplayNames);
  if (displayProviders.length > 0) {
    const displayBranches = displayProviders.map(p => {
      const names = p.identity.modelDisplayNames;
      const entries = Object.entries(names).filter(([k]) => k !== 'default');
      const checks = entries.map(([model, display]) =>
        `if(_m.includes("${model}"))return"${display}";`
      ).join('');
      return `if(dq()==="${p.runtimeId}"){let _m=q.toLowerCase();${checks}return"${names.default}";}`;
    }).join('');

    patch('60-model-display-name',
      MATCH.DISPLAY,
      `function y0(q){${displayBranches}if(dq()==="foundry")return;`
    );
  }

  // ── Patch 61: System prompt identity ──
  const identityBranches = providers
    .filter(p => p.runtimeId !== 'firstParty')
    .map(p => `if(_p==="${p.runtimeId}")return"${p.identity.systemPrompt}";`)
    .join('');
  const fallbackPrompt = fallback.identity.systemPrompt;
  patch('61-system-identity',
    MATCH.IDENTITY,
    `Bh1=(()=>{const _p=typeof dq==="function"?dq():"firstParty";${identityBranches}return"${fallbackPrompt}";})()`
  );

  // ── Patch 62: SDK identity ──
  const sdkPrompt = providers.find(p => p.identity.sdkPrompt)?.identity.sdkPrompt
    || 'You are Silly Code, a multi-provider AI coding assistant, running within the Agent SDK.';
  patch('62-sdk-identity',
    MATCH.SDK_ID,
    `z14="${sdkPrompt}"`
  );

  // ── Patch 64: Model ID in prompt ──
  patch('64-model-id-in-prompt',
    MATCH.MODEL_ID,
    'You are powered by the model named ${$}.'
  );

  // ── Patch 65: Agent identity ──
  const agentBranches = providers
    .filter(p => p.runtimeId !== 'firstParty')
    .map(p => `if(_p==="${p.runtimeId}")return"${p.identity.agentPrompt}";`)
    .join('');
  const fallbackAgent = fallback.identity.agentPrompt;
  patch('65-agent-identity',
    MATCH.AGENT_ID,
    `Y14=(()=>{const _p=typeof dq==="function"?dq():"firstParty";${agentBranches}return"${fallbackAgent}";})()`
  );

  // ── Patch 63a: Simple identity ──
  const simpleBranches = providers
    .filter(p => p.runtimeId !== 'firstParty')
    .map(p => `if(_p==="${p.runtimeId}")return"${p.identity.simplePrompt}";`)
    .join('');
  const fallbackSimple = fallback.identity.simplePrompt;
  const longBranches = providers
    .filter(p => p.runtimeId !== 'firstParty')
    .map(p => `if(_p==="${p.runtimeId}")return"${p.identity.systemPrompt}";`)
    .join('');
  patch('63a-prompt-simple-identity',
    MATCH.SIMPLE_ID,
    `?(()=>{const _p=typeof dq==="function"?dq():"firstParty";${simpleBranches}return"${fallbackSimple}";})()`
    + `:((()=>{const _p=typeof dq==="function"?dq():"firstParty";${longBranches}return"${fallbackPrompt}";})())+\``
  );

  // ── Patch 63: Tier display ──
  const tierLevels = ['max', 'pro', 'api'];
  const tierCases = tierLevels.map((level, i) => {
    const branches = providers
      .filter(p => p.runtimeId !== 'firstParty')
      .map(p => `(typeof dq==="function"&&dq()==="${p.runtimeId}")?"${p.tierNames[level]}"`)
      .join(':');
    const fallbackTier = fallback.tierNames[level];
    const prefix = level === 'api' ? 'default' : `case"${level}"`;
    return `${prefix}:return ${branches}:"${fallbackTier}"`;
  });
  patch('63-tier-display',
    MATCH.TIER,
    tierCases.join(';')
  );

  // ── Patch report ──
  const providerList = providers.map(p => p.key).join(', ');
  const adapterCount = adaptersWithCode.length;
  const identityCount = providers.length;
  console.log(`\n  PATCH REPORT (provider-engine)`);
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  10-provider-detection    ${sorted.length} providers in chain`);
  console.log(`  11-12-provider-adapters  ${adapterCount} adapters injected (${adaptersWithCode.map(p=>p.key).join(', ')})`);
  console.log(`  13-14-resolution/family  ${allRuntimeIds.length} runtimeIds added`);
  if (ctxProviders.length > 0) console.log(`  50-51-context-window     ${ctxProviders.length} providers with custom context`);
  console.log(`  60-65-identity           ${identityCount} identity branches`);
  console.log(`  63/63a-tier/simple       ${providers.filter(p=>p.runtimeId!=='firstParty').length} non-default providers`);
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  providers: ${providerList}`);
};
```

- [ ] **Step 4: Verify engine loads without errors**

Run: `node -e "const e = require('./pipeline/patches/provider-engine.cjs'); console.log('Engine loaded, type:', typeof e)"`

Expected: `Engine loaded, type: function`

- [ ] **Step 5: Commit**

```bash
git add pipeline/patches/provider-engine.cjs tests/schema.test.cjs
git commit -m "feat: add provider engine with schema validation and patch generation"
```

---

### Task 4: Wire Orchestrator + Remove Old Files

**Files:**
- Modify: `pipeline/patch.cjs`
- Delete: `pipeline/patches/providers.cjs`
- Delete: `pipeline/patches/identity.cjs`
- Delete: `pipeline/patches/platform.cjs`

- [ ] **Step 1: Update `patch.cjs` to use provider-engine**

Replace the modules array in `pipeline/patch.cjs:58-65`:

```javascript
// Before:
const modules = [
  require('./patches/branding.cjs'),
  require('./patches/providers.cjs'),
  require('./patches/identity.cjs'),
  require('./patches/equality.cjs'),
  require('./patches/privacy.cjs'),
  require('./patches/platform.cjs'),
]

// After:
const modules = [
  require('./patches/branding.cjs'),
  require('./patches/provider-engine.cjs'),
  require('./patches/equality.cjs'),
  require('./patches/privacy.cjs'),
]
```

Note: `identity.cjs` and `platform.cjs` are removed — their patches are now generated by `provider-engine.cjs`. The engine also replaces `providers.cjs`.

- [ ] **Step 2: Verify build succeeds before removing old files**

Run: `node pipeline/patch.cjs`
Expected: All patches OK, no FAIL. The old files still exist but are unused (not required by patch.cjs anymore).

- [ ] **Step 3: Remove old files**

```bash
git rm pipeline/patches/providers.cjs
git rm pipeline/patches/identity.cjs
git rm pipeline/patches/platform.cjs
```

- [ ] **Step 4: Verify build still succeeds after removal**

Run: `node pipeline/patch.cjs`
Expected: Same result as step 2. Old files not needed.

- [ ] **Step 5: Commit**

```bash
git add pipeline/patch.cjs
git commit -m "feat: wire provider engine, remove old provider/identity/platform patches"
```

---

### Task 5: Build Verification & Smoke Test

**Files:** None (testing only)

- [ ] **Step 1: Run full build**

Run: `node pipeline/patch.cjs`
Expected: All patches OK. Provider engine reports loaded providers and adapter count.

```
  PROVIDER ENGINE: 3 providers loaded (claude, copilot, openai), 2 adapters injected

  silly-code patch pipeline

  ✓ 01-version (127x)
  ✓ 02-package-url (127x)
  ...
  ✓ 10-provider-detection
  ✓ 13-model-resolution
  ✓ 14-provider-family
  ✓ 11-12-provider-adapters
  ✓ 15-model-defaults
  ✓ 50-context-window
  ✓ 51-default-context
  ✓ 60-model-display-name
  ✓ 61-system-identity
  ✓ 62-sdk-identity
  ✓ 64-model-id-in-prompt
  ✓ 65-agent-identity
  ✓ 63a-prompt-simple-identity
  ✓ 63-tier-display
  ...
  35 OK, 0 FAIL
```

- [ ] **Step 2: Run all tests**

Run: `node tests/base.test.cjs && node tests/schema.test.cjs`
Expected: All tests PASS.

- [ ] **Step 3: Smoke test — Claude (native)**

Run: `node pipeline/build/cli-patched.js -p "What is your name? What model are you?"`
Expected: Response mentions "Silly Code" and Claude model name.

- [ ] **Step 4: Smoke test — OpenAI**

Run: `CLAUDE_CODE_USE_OPENAI=1 SILLY_CODE_DATA=~/.silly-code node pipeline/build/cli-patched.js -p "What is your name? What model are you?"`
Expected: Response from GPT model. TUI shows GPT model name.

- [ ] **Step 5: Smoke test — Copilot**

Run: `CLAUDE_CODE_USE_COPILOT=1 SILLY_CODE_DATA=~/.silly-code node pipeline/build/cli-patched.js -p "What is your name? What model are you?"`
Expected: Response from Copilot. TUI shows Copilot model name.

- [ ] **Step 6: Verify patch report matches expected counts**

Check that total patch count matches the original (35 OK, 0 FAIL). If count differs, investigate — the engine may generate a different number of patches than the original files if some were consolidated or split.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: provider modularization complete — single-engine governed provider system"
```

---

## File Inventory

### Created
| File | Responsibility |
|------|---------------|
| `pipeline/patches/providers/_base.cjs` | Shared protocol translation (5 functions) |
| `pipeline/patches/providers/claude.cjs` | Claude config (default, no adapter) |
| `pipeline/patches/providers/openai.cjs` | OpenAI config + adapter + auth |
| `pipeline/patches/providers/copilot.cjs` | Copilot config + adapter + auth |
| `pipeline/patches/provider-engine.cjs` | Load, validate, generate all provider patches |
| `tests/base.test.cjs` | Unit tests for _base.cjs |
| `tests/schema.test.cjs` | Schema validation tests |

### Modified
| File | Change |
|------|--------|
| `pipeline/patch.cjs` | Replace 3 requires with 1 provider-engine require |

### Deleted
| File | Reason |
|------|--------|
| `pipeline/patches/providers.cjs` | Replaced by engine + provider configs |
| `pipeline/patches/identity.cjs` | Replaced by engine (generated from provider identity config) |
| `pipeline/patches/platform.cjs` | Replaced by engine (generated from provider contextWindow config) |
