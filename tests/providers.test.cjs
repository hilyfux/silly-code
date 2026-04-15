/**
 * providers.test.cjs — adapter-level tests for openai.
 *
 * Each provider adapter is invoked inside a sandbox where _base.cjs
 * helpers are hoisted and `fetch` / `auth` are stubbed. We assert on
 * (a) the outgoing request the adapter produces and
 * (b) the Anthropic-format response it returns.
 *
 * No network, no filesystem writes, no real creds.
 *
 * Canonical Anthropic inputs live under tests/fixtures/.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const base = require('../pipeline/patches/providers/_base.cjs');
const openai = require('../pipeline/patches/providers/openai.cjs');

const FIXTURES = path.join(__dirname, 'fixtures');

// ── Sandbox builder ─────────────────────────────────────────
// Mirrors provider-engine.cjs injection: _base fns + provider state +
// (stubbed) auth + adapter, all hoisted into one function scope with
// `fetch` as the only external.
function buildAdapter(providerModule, authStub) {
  const baseStr = Object.values(base).map(f => f.toString()).join('\n;\n');
  const stateVar = `let _${providerModule.key}Data = null;`;
  const authFn = `async function _${providerModule.key}Auth() { return ${JSON.stringify(authStub)}; }`;
  const adapterStr = providerModule.adapter.toString();
  const adapterName = providerModule.adapter.name;

  const body = [baseStr, stateVar, authFn, adapterStr, `return ${adapterName};`].join('\n;\n');

  // eslint-disable-next-line no-new-func
  return new Function('fetch', body);
}

// ── Mock fetch ─────────────────────────────────────────────
function makeMockFetch(plans) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    const plan = plans.find(p => url.includes(p.urlPart));
    if (!plan) throw new Error(`no mock plan for ${url}`);
    if (plan.sseLines) {
      const enc = new TextEncoder();
      const lines = [...plan.sseLines];
      const body = new ReadableStream({
        pull(ctrl) {
          if (lines.length) ctrl.enqueue(enc.encode(lines.shift() + '\n'));
          else ctrl.close();
        }
      });
      return new Response(body, {
        status: plan.status || 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    return new Response(JSON.stringify(plan.body), {
      status: plan.status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  fn._calls = () => calls;
  return fn;
}

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

// ── Canonical fixture loader ───────────────────────────────
function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name + '.json'), 'utf8'));
}

// ── Test scenarios ─────────────────────────────────────────

(async function main() {
  let passed = 0;
  const fail = (label, err) => {
    console.error(`  ✗ ${label}: ${err.message || err}`);
    process.exit(1);
  };
  const pass = (label) => { console.log(`  ✓ ${label}`); passed++; };

  // Scenario 1 — simple text, Chat Completions path (openai apikey)
  {
    const fx = loadFixture('simple-text-nonstream');
    const oaiPlan = [{
      urlPart: 'chat/completions',
      body: {
        id: 'chatcmpl-1',
        choices: [{ message: { role: 'assistant', content: 'Hi there!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      },
    }];

    for (const [label, provider, authStub] of [
      ['openai / chat-completions (apikey)', openai, { headers: { 'Authorization': 'Bearer sk-fake' }, kind: 'apikey' }],
    ]) {
      try {
        const fetch = makeMockFetch(oaiPlan);
        const adapter = buildAdapter(provider, authStub)(fetch);
        const resp = await adapter('https://api.anthropic.com/v1/messages', {
          body: JSON.stringify(fx),
        });
        const calls = fetch._calls();
        assert.strictEqual(calls.length, 1, `expected 1 upstream call, got ${calls.length}`);
        assert.ok(calls[0].url.includes('chat/completions'), 'wrong upstream URL: ' + calls[0].url);

        if (provider === openai) {
          assert.ok(calls[0].url.includes('api.openai.com'), 'openai apikey path should hit api.openai.com');
        }

        const reqBody = calls[0].body;
        assert.ok(Array.isArray(reqBody.messages), 'upstream body should have messages[]');
        assert.ok(reqBody.model, 'upstream body should set model');
        assert.ok(reqBody.max_tokens > 0, 'upstream body should set max_tokens');

        // Returned Anthropic response
        const respJson = JSON.parse(await resp.text());
        assert.strictEqual(respJson.type, 'message');
        assert.strictEqual(respJson.role, 'assistant');
        assert.strictEqual(respJson.content[0].type, 'text');
        assert.strictEqual(respJson.content[0].text, 'Hi there!');
        assert.strictEqual(respJson.stop_reason, 'end_turn');
        pass(label + ' — simple text');
      } catch (e) { fail(label + ' — simple text', e); }
    }
  }

  // Scenario 2 — streaming, Responses API (openai OAuth → /codex/responses)
  {
    const fx = loadFixture('simple-text-stream');
    const plan = [{
      urlPart: '/codex/responses',
      sseLines: [
        'data: {"type":"response.created","response":{"id":"resp_1"}}',
        'data: {"type":"response.output_text.delta","delta":"Hello"}',
        'data: {"type":"response.output_text.delta","delta":" there"}',
        'data: {"type":"response.completed","response":{"usage":{"output_tokens":2}}}',
      ],
    }];
    try {
      const fetch = makeMockFetch(plan);
      const adapter = buildAdapter(openai, { headers: { 'Authorization': 'Bearer eyJfake' }, kind: 'oauth' })(fetch);
      const resp = await adapter('https://api.anthropic.com/v1/messages', {
        body: JSON.stringify(fx),
      });
      const calls = fetch._calls();
      assert.strictEqual(calls.length, 1);
      assert.ok(calls[0].url.includes('chatgpt.com/backend-api/codex/responses'), 'OAuth codex path wrong URL: ' + calls[0].url);
      assert.ok(Array.isArray(calls[0].body.input), 'Responses API body should have input[]');
      assert.ok(typeof calls[0].body.instructions === 'string', 'Responses API body should have instructions');

      const sseOut = await drainStream(resp.body);
      assert.ok(sseOut.includes('event: message_start'), 'missing message_start');
      assert.ok(sseOut.includes('"Hello"'), 'missing first delta');
      assert.ok(sseOut.includes('" there"'), 'missing second delta');
      assert.ok(sseOut.includes('event: message_stop'), 'missing message_stop');
      pass('openai oauth / responses-api — streaming text');
    } catch (e) { fail('openai oauth / responses-api — streaming text', e); }
  }

  // Scenario 4 — thinking + image blocks must not leak (Responses API)
  //   Regression guard for c862cdb — signature bleed / base64 image stringify.
  {
    const fx = loadFixture('with-thinking-and-image');
    const plan = [{
      urlPart: '/codex/responses',
      sseLines: [
        'data: {"type":"response.created","response":{"id":"r2"}}',
        'data: {"type":"response.output_text.delta","delta":"ok"}',
        'data: {"type":"response.completed","response":{"usage":{"output_tokens":1}}}',
      ],
    }];
    try {
      const fetch = makeMockFetch(plan);
      const adapter = buildAdapter(openai, { headers: { 'Authorization': 'Bearer eyJfake' }, kind: 'oauth' })(fetch);
      const resp = await adapter('https://api.anthropic.com/v1/messages', {
        body: JSON.stringify(fx),
      });
      const [call] = fetch._calls();

      const sentBlob = JSON.stringify(call.body);
      assert.ok(!sentBlob.includes('INTERNAL_REASONING_TOKEN_XYZ'), 'thinking payload leaked into Responses input');
      assert.ok(!sentBlob.includes('FAKE_SIG_BASE64'), 'thinking signature leaked');

      // image block must become input_image (data URL), not JSON-stringified source object
      const hasInputImage = call.body.input.some(i =>
        i.type === 'message' && Array.isArray(i.content) &&
        i.content.some(c => c.type === 'input_image' && typeof c.image_url === 'string' && c.image_url.startsWith('data:image/'))
      );
      assert.ok(hasInputImage, 'image block did not become input_image multi-part');

      await drainStream(resp.body);
      pass('openai oauth — thinking+image resume (regression guard)');
    } catch (e) { fail('openai oauth — thinking+image resume (regression guard)', e); }
  }

  // Scenario 5 — identity prompt hygiene: non-firstParty must not send 'Claude Code' identity verbatim
  {
    const fx = loadFixture('with-identity-system');
    const plan = [{
      urlPart: 'chat/completions',
      body: {
        id: 'chatcmpl-3',
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: {},
      },
    }];
    for (const [label, provider, authStub] of [
      ['openai apikey — identity cleaned', openai, { headers: {}, kind: 'apikey' }],
    ]) {
      try {
        const fetch = makeMockFetch(plan);
        const adapter = buildAdapter(provider, authStub)(fetch);
        await adapter('https://api.anthropic.com/v1/messages', { body: JSON.stringify(fx) });
        const [call] = fetch._calls();
        const sys = call.body.messages.find(m => m.role === 'system');
        assert.ok(sys, 'system message present');
        assert.ok(!sys.content.includes("You are Claude Code, Anthropic's official CLI for Claude"),
          'raw Claude identity leaked in system prompt');
        assert.ok(sys.content.includes('<continuation-discipline>'),
          'continuation-discipline block missing from non-firstParty system prompt');
        pass(label);
      } catch (e) { fail(label, e); }
    }
  }

  console.log(`\n${passed} provider tests passed.`);
})().catch(e => { console.error(e); process.exit(1); });
