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
//
// `globals` (optional) lets a test inject upstream-mangled helpers the
// adapter references by bare name (e.g. `n8z` for the /effort level).
// These names are mangled in the real binary and cannot be imported —
// the adapter guards with `typeof <name> === 'function'` so tests can
// stub them with a predictable return value. Each entry is emitted as
// a `const <name> = <expr>;` at the top of the sandbox body so the
// adapter's `typeof`-guarded lookup finds it. Value must be a string
// that is a valid JS expression (e.g. `"() => 'xhigh'"`).
function buildAdapter(providerModule, authStub, globals = {}) {
  const baseStr = Object.values(base).map(f => f.toString()).join('\n;\n');
  const stateVar = `let _${providerModule.key}Data = null;`;
  const authFn = `async function _${providerModule.key}Auth() { return ${JSON.stringify(authStub)}; }`;
  const adapterStr = providerModule.adapter.toString();
  const adapterName = providerModule.adapter.name;

  const globalDecls = Object.entries(globals)
    .map(([name, expr]) => `const ${name} = ${expr};`)
    .join('\n');

  const parts = [];
  if (globalDecls) parts.push(globalDecls);
  parts.push(baseStr, stateVar, authFn, adapterStr, `return ${adapterName};`);
  const body = parts.join('\n;\n');

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

  // Scenario 6 — skill/subagent prompt flow must stay usable after adapter cleaning
  {
    const fx = loadFixture('skill-subagent-system');
    const plan = [{
      urlPart: '/codex/responses',
      body: {
        id: 'resp_skill_1',
        output: [],
        usage: { input_tokens: 12, output_tokens: 3 },
      },
    }];
    try {
      const fetch = makeMockFetch(plan);
      const adapter = buildAdapter(openai, { headers: { 'Authorization': 'Bearer eyJfake' }, kind: 'oauth' })(fetch);
      await adapter('https://api.anthropic.com/v1/messages', { body: JSON.stringify(fx) });
      const [call] = fetch._calls();
      assert.ok(call.url.includes('/codex/responses'), 'skill/subagent flow should hit Codex OAuth path');
      assert.ok(typeof call.body.instructions === 'string', 'Responses API instructions missing');
      assert.ok(/using-superpowers skill/.test(call.body.instructions), 'using-superpowers entry lost');
      assert.ok(/boost skill/.test(call.body.instructions), 'boost entry lost');
      assert.ok(!/Triggers on:/.test(call.body.instructions), 'skill trigger tails not stripped');
      assert.ok(/ToolSearch/.test(call.body.instructions), 'ToolSearch guidance lost');
      assert.ok(/ScheduleWakeup/.test(call.body.instructions), 'deferred-tool names lost');
      assert.ok(/knowledge-graph/.test(call.body.instructions), 'UserPromptSubmit skill hook context lost');
      assert.ok(/select:Skill/.test(call.body.instructions), 'Skill ToolSearch fallback missing');
      assert.ok(/interactive agent that helps users/.test(call.body.instructions), 'subagent role description damaged');
      assert.ok(!/Claude Code/.test(call.body.instructions), 'Claude identity leaked');
      assert.ok(/<continuation-discipline>/.test(call.body.instructions), 'continuation discipline missing');
      // Tail-position continuation reminder (Candidate A — attention-adjacent nudge).
      // Must ride as the final input item with role='developer' so the model
      // sees it immediately before generating its next token.
      assert.ok(Array.isArray(call.body.input), 'input array missing');
      const _tail = call.body.input[call.body.input.length - 1];
      assert.ok(_tail && _tail.role === 'developer' && /<continuation-reminder>/.test(_tail.content || ''),
        'tail continuation-reminder missing or wrong role');
      assert.ok(Array.isArray(call.body.tools) && call.body.tools.some(t => t.name === 'ToolSearch'), 'ToolSearch tool missing from forwarded tool catalog');
      assert.ok(Array.isArray(call.body.tools) && call.body.tools.some(t => t.name === 'ScheduleWakeup'), 'ScheduleWakeup tool missing from forwarded tool catalog');
      assert.strictEqual(call.body.parallel_tool_calls, false, 'parallel tool calls must stay disabled for GPT provider path');
      pass('openai oauth — skill/subagent prompt flow preserved');
    } catch (e) { fail('openai oauth — skill/subagent prompt flow preserved', e); }
  }

  // Scenario 7 — worktree + subagent fixture: Agent/EnterWorktree/ExitWorktree tool passthrough
  {
    const fx = loadFixture('worktree-subagent');
    const plan = [{
      urlPart: '/codex/responses',
      body: {
        id: 'resp_worktree_1',
        output: [],
        usage: { input_tokens: 15, output_tokens: 3 },
      },
    }];
    try {
      const fetch = makeMockFetch(plan);
      const adapter = buildAdapter(openai, { headers: { 'Authorization': 'Bearer eyJfake' }, kind: 'oauth' })(fetch);
      await adapter('https://api.anthropic.com/v1/messages', { body: JSON.stringify(fx) });
      const [call] = fetch._calls();
      assert.ok(call.url.includes('/codex/responses'), 'worktree flow should hit codex OAuth path');
      assert.ok(Array.isArray(call.body.tools), 'tools array missing');
      const toolNames = call.body.tools.map(t => t.name);
      assert.ok(toolNames.includes('Agent'), 'Agent tool missing');
      assert.ok(toolNames.includes('EnterWorktree'), 'EnterWorktree tool missing');
      assert.ok(toolNames.includes('ExitWorktree'), 'ExitWorktree tool missing');
      assert.ok(!/Claude Code/.test(call.body.instructions), 'Claude identity leaked in worktree scenario');
      assert.strictEqual(call.body.parallel_tool_calls, false, 'parallel_tool_calls must stay false');
      pass('openai oauth — worktree+subagent fixture flow preserved');
    } catch (e) { fail('openai oauth — worktree+subagent fixture flow preserved', e); }
  }

  // Scenario 8 — PostToolBatch + UserPromptExpansion hook rewriting (C2 extension)
  // Validates that the SKILL_TAMING_HOOKS whitelist now covers 2.1.115+ hook
  // channels. Each hook body should reach the Responses API instructions as a
  // labeled "[HOOK CONTEXT] <Name>:" prefix, and the Skill keyword in the
  // PostToolBatch body should trigger the ToolSearch loading hint.
  {
    const fx = loadFixture('hook-post-tool-batch');
    const plan = [{
      urlPart: '/codex/responses',
      body: {
        id: 'resp_hook_batch_1',
        output: [],
        usage: { input_tokens: 8, output_tokens: 2 },
      },
    }];
    try {
      const fetch = makeMockFetch(plan);
      const adapter = buildAdapter(openai, { headers: { 'Authorization': 'Bearer eyJfake' }, kind: 'oauth' })(fetch);
      await adapter('https://api.anthropic.com/v1/messages', { body: JSON.stringify(fx) });
      const [call] = fetch._calls();
      assert.ok(call.url.includes('/codex/responses'), 'hook taming flow should hit Codex OAuth path');
      assert.ok(typeof call.body.instructions === 'string', 'Responses API instructions missing');
      assert.ok(/\[HOOK CONTEXT\] PostToolBatch:/.test(call.body.instructions), 'PostToolBatch hook not labeled');
      assert.ok(/\[HOOK CONTEXT\] UserPromptExpansion:/.test(call.body.instructions), 'UserPromptExpansion hook not labeled');
      // Skill reference in PostToolBatch should trigger ToolSearch hint
      assert.ok(/call ToolSearch/.test(call.body.instructions), 'Skill hint missing');
      assert.ok(!/<system-reminder>/.test(call.body.instructions), 'raw system-reminder wrapper leaked after hook taming');
      assert.ok(/3 bash calls completed/.test(call.body.instructions), 'PostToolBatch body text dropped');
      assert.ok(/Available skills: using-superpowers, boost/.test(call.body.instructions), 'UserPromptExpansion body text dropped');
      pass('openai oauth — PostToolBatch/UserPromptExpansion hook taming');
    } catch (e) { fail('openai oauth — PostToolBatch/UserPromptExpansion hook taming', e); }
  }

  // Scenario 9 — reasoning.effort forwarding (Claude /effort → OpenAI reasoning.effort).
  //   openai.cjs:275-282 reads the upstream-mangled `n8z()` accessor to learn
  //   the user's selected /effort level and forwards it to the Responses API.
  //   The ladder mapping is Claude-wider-than-OpenAI: max→high (graceful
  //   fallback), xhigh→high, high→high, medium→medium, low→low. Unknown or
  //   undefined must leave `reasoning` unset so the server applies its own
  //   default (no silent downgrade).
  {
    const fx = loadFixture('simple-text-stream');
    const mkPlan = () => [{
      urlPart: '/codex/responses',
      sseLines: [
        'data: {"type":"response.created","response":{"id":"r_eff"}}',
        'data: {"type":"response.output_text.delta","delta":"ok"}',
        'data: {"type":"response.completed","response":{"usage":{"output_tokens":1}}}',
      ],
    }];

    // [n8z-return, expected reasoning shape on outbound body]
    // OpenAI Responses API accepts "xhigh" directly (Codex 0.124's
    // ReasoningEffort::XHigh serializes to lowercase "xhigh"), so we
    // pass xhigh through unchanged — NOT downgraded to "high". max is
    // a Claude-only tier, gracefully mapped to xhigh (OpenAI's ceiling).
    const cases = [
      ['xhigh',       { effort: 'xhigh' }],   // passthrough — OpenAI accepts xhigh
      ['max',         { effort: 'xhigh' }],   // max graceful-fallback → xhigh (OpenAI ceiling)
      ['high',        { effort: 'high' }],    // pass-through
      ['medium',      { effort: 'medium' }],  // pass-through
      ['low',         { effort: 'low' }],     // pass-through
      ['unknown-tier', undefined],            // not in _effMap → no field set
    ];

    for (const [effReturn, expected] of cases) {
      const label = `openai oauth — reasoning.effort forwarding (n8z=${effReturn})`;
      try {
        const fetch = makeMockFetch(mkPlan());
        // n8z is the mangled /effort accessor in upstream. Stub with a
        // lambda returning effReturn verbatim so _eff = n8z() gives us the
        // test case's value.
        const globals = { n8z: `() => ${JSON.stringify(effReturn)}` };
        const adapter = buildAdapter(
          openai,
          { headers: { 'Authorization': 'Bearer eyJfake' }, kind: 'oauth' },
          globals,
        )(fetch);
        const resp = await adapter('https://api.anthropic.com/v1/messages', {
          body: JSON.stringify(fx),
        });
        const [call] = fetch._calls();
        assert.ok(call.url.includes('/codex/responses'), 'must hit Codex OAuth path');

        if (expected === undefined) {
          assert.strictEqual(
            call.body.reasoning, undefined,
            `n8z=${effReturn}: reasoning must be UNSET (server applies default), got ${JSON.stringify(call.body.reasoning)}`
          );
        } else {
          assert.deepStrictEqual(
            call.body.reasoning, expected,
            `n8z=${effReturn}: reasoning must be ${JSON.stringify(expected)}, got ${JSON.stringify(call.body.reasoning)}`
          );
        }
        await drainStream(resp.body);
        pass(label);
      } catch (e) { fail(label, e); }
    }
  }

  console.log(`\n${passed} provider tests passed.`);
})().catch(e => { console.error(e); process.exit(1); });
