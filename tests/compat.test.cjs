/**
 * compat.test.cjs — Claude Code feature × sillyx adapter compatibility matrix.
 *
 * Each `test` asserts a single surface: skill taming, identity cleaning,
 * continuation discipline, MCP serialization, ToolSearch deferred tools,
 * subagent/hook text flow. Fixtures are real-shape Claude Code harness
 * fragments taken from upstream system-reminder / catalog output.
 *
 * Purpose (per boost autoresearch): this file is the LOCKED EVALUATOR.
 * Adapter changes are judged by whether compat.test.cjs goes green, not
 * by intuition.
 */

'use strict';

const assert = require('assert');
const base = require('../pipeline/patches/providers/_base.cjs');
const {
  tameSkillPrompts,
  cleanIdentityForProvider,
  enforceContinuation,
  findOpenTodos,
  msgToOai,
  msgsToResponsesInput,
  flattenSystem,
  _cleanToolArgs,
  agentBudgetLog,
} = base;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n    ' + (e.message || e)); fail++; }
}

console.log('\nSillyx × Claude Code compatibility matrix\n');

// ── Skill taming ──────────────────────────────────────────────
test('taming: strips <EXTREMELY-IMPORTANT>', () => {
  const s = 'hello\n<EXTREMELY-IMPORTANT>\nyou MUST invoke\n</EXTREMELY-IMPORTANT>\nworld';
  const o = tameSkillPrompts(s);
  assert(!o.includes('EXTREMELY-IMPORTANT'));
  assert(o.includes('hello'));
  assert(o.includes('world'));
});

test('taming: strips <EXTREMELY_IMPORTANT> underscore variant', () => {
  const s = '<EXTREMELY_IMPORTANT>\nblocking content\n</EXTREMELY_IMPORTANT>';
  assert(!tameSkillPrompts(s).includes('blocking content'));
});

test('taming: strips <HARD-GATE> and <SUBAGENT-STOP>', () => {
  const s = 'a<HARD-GATE>x</HARD-GATE>b<SUBAGENT-STOP>y</SUBAGENT-STOP>c';
  const o = tameSkillPrompts(s);
  assert.strictEqual(o, 'abc');
});

test('taming: softens "ABSOLUTELY MUST invoke the skill"', () => {
  const o = tameSkillPrompts('Note: you ABSOLUTELY MUST invoke the skill now.');
  assert(/consider invoking/i.test(o), 'soft phrasing missing');
  assert(!/ABSOLUTELY MUST/.test(o), 'still has hard directive');
});

test('taming: softens "1% chance" skill-activation directive', () => {
  const o = tameSkillPrompts('If even a 1% chance a skill might apply, invoke it.');
  assert(/a skill clearly applies/i.test(o));
  assert(!/1% chance/i.test(o));
});

test('taming: strips Red Flags markdown table entirely', () => {
  const s = [
    'prose before',
    '## Red Flags',
    '| Thought | Reality |',
    '|---------|---------|',
    '| "just a simple question" | check skills |',
    'prose after',
  ].join('\n');
  const o = tameSkillPrompts(s);
  assert(!o.includes('Red Flags'));
  assert(o.includes('prose before'));
  assert(o.includes('prose after'));
});

test('taming: strips fenced ```dot blocks', () => {
  const s = 'before\n```dot\ndigraph G { a -> b }\n```\nafter';
  const o = tameSkillPrompts(s);
  assert(!o.includes('digraph'));
  assert(o.includes('before'));
  assert(o.includes('after'));
});

test('taming: strips bare digraph blocks', () => {
  const s = 'before\ndigraph skill_flow {\n  a -> b;\n}\nafter';
  const o = tameSkillPrompts(s);
  assert(!o.includes('digraph'), 'digraph body still present: ' + o);
});

test('taming: strips "Triggers on: ..." tails in skill catalog', () => {
  const s = '- /boost skill. Triggers on: "boost", "优化", "tune".\nContent.';
  const o = tameSkillPrompts(s);
  assert(!/Triggers on/i.test(o));
  assert(o.includes('/boost skill'));
});

test('taming: rewrites <system-reminder>ToolSearch deferred tools into usable plain text', () => {
  const s = '<system-reminder>\nThe following deferred tools are now available via ToolSearch. Their schemas are NOT loaded — calling them directly will fail:\nMonitor\nScheduleWakeup\nWebFetch\n</system-reminder>';
  const o = tameSkillPrompts(s);
  assert(!/<system-reminder>/.test(o), 'system-reminder wrapper still present');
  assert(/TOOL LOADING REQUIRED/.test(o), 'missing loading-required header');
  assert(/Monitor/.test(o) && /ScheduleWakeup/.test(o) && /WebFetch/.test(o), 'tool names lost');
  assert(/ToolSearch/.test(o), 'must still tell GPT to call ToolSearch');
});

test('taming: strips UserPromptSubmit hook system-reminder', () => {
  const s = 'keep\n<system-reminder>\nUserPromptSubmit hook additional context: Activate PUA\n</system-reminder>\nkeep';
  const o = tameSkillPrompts(s);
  assert(!/UserPromptSubmit hook/.test(o));
  assert(o.split('keep').length === 3, 'surrounding text damaged');
});

test('taming: strips x-anthropic-billing-header line', () => {
  const s = 'x-anthropic-billing-header: priority\nrest of system';
  const o = tameSkillPrompts(s);
  assert(!/x-anthropic-billing-header/.test(o));
  assert(o.includes('rest of system'));
});

test('taming: preserves legitimate skill prose', () => {
  const s = 'Skill: brainstorming. Use when exploring multiple approaches before committing.';
  const o = tameSkillPrompts(s);
  assert.strictEqual(o, s, 'mutated a clean skill description');
});

test('taming: handles null/empty without crash', () => {
  assert.strictEqual(tameSkillPrompts(''), '');
  assert.strictEqual(tameSkillPrompts(null), null);
  assert.strictEqual(tameSkillPrompts(undefined), undefined);
});

// ── Identity cleaning ─────────────────────────────────────────
test('identity: replaces "Claude Code" with provider name', () => {
  const o = cleanIdentityForProvider('You are Claude Code helping.', 'OpenAI Codex');
  assert(o.includes('Silly Code'));
  assert(!/\bClaude Code\b/.test(o));
});

test('identity: replaces "Anthropic\'s official CLI for Claude"', () => {
  const o = cleanIdentityForProvider("You are Anthropic's official CLI for Claude.", 'OpenAI Codex');
  assert(/multi-provider/.test(o));
  assert(!/Anthropic's official CLI/.test(o));
});

test('identity: replaces "Claude Opus/Sonnet/Haiku 4.X" with provider name', () => {
  const o = cleanIdentityForProvider('Powered by Claude Opus 4.7 and Claude Sonnet 4.6.', 'OpenAI Codex');
  assert(!/Claude Opus/.test(o));
  assert(!/Claude Sonnet/.test(o));
  assert(/OpenAI Codex/.test(o));
});

test('identity: rewrites Co-Authored-By', () => {
  const o = cleanIdentityForProvider('Co-Authored-By: Claude <noreply@anthropic.com>', 'OpenAI Codex');
  assert(/Silly Code \(OpenAI Codex\)/.test(o));
  assert(!/noreply@anthropic/.test(o));
});

test('identity: does NOT break CLAUDE.md path references', () => {
  const o = cleanIdentityForProvider('See CLAUDE.md and claude.ai for docs.', 'OpenAI Codex');
  assert(/CLAUDE\.md/.test(o));
  assert(/claude\.ai/.test(o));
});

test('identity: does NOT break Anthropic URLs', () => {
  const o = cleanIdentityForProvider('POST https://api.anthropic.com/v1', 'OpenAI Codex');
  assert(/anthropic\.com/.test(o));
});

test('identity: preserves @anthropic-ai/ package names', () => {
  const o = cleanIdentityForProvider('Import @anthropic-ai/claude-code', 'OpenAI Codex');
  assert(/@anthropic-ai\//.test(o), 'package namespace damaged');
});

test('identity: strips model family/ID lines', () => {
  const s = 'You are powered by the model named claude-opus-4-7. The exact model ID is claude-opus-4-7. The most recent Claude model family is 4.X.';
  const o = cleanIdentityForProvider(s, 'OpenAI Codex');
  assert(/powered by OpenAI Codex/.test(o));
  assert(!/exact model ID/.test(o));
  assert(!/recent Claude model family/.test(o));
});

test('identity: handles null/empty', () => {
  assert.strictEqual(cleanIdentityForProvider('', 'OpenAI Codex'), '');
  assert.strictEqual(cleanIdentityForProvider(null, 'x'), null);
});

// ── enforceContinuation ───────────────────────────────────────
test('continuation: appends discipline block when absent', () => {
  const o = enforceContinuation('system text', [], []);
  assert(/<continuation-discipline>/.test(o));
  assert(/HARD RULES/.test(o));
  assert(o.startsWith('system text'));
});

test('continuation: idempotent — no duplicate on re-run', () => {
  const first = enforceContinuation('sys', [], []);
  const second = enforceContinuation(first, [], []);
  const occur = (second.match(/<continuation-discipline>/g) || []).length;
  assert.strictEqual(occur, 1, 'duplicated block on second pass');
});

test('continuation: surfaces open TodoWrite items', () => {
  const messages = [{
    role: 'assistant',
    content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [
      { content: 'do A', status: 'pending', activeForm: 'Doing A' },
      { content: 'do B', status: 'completed' },
      { content: 'do C', status: 'in_progress', activeForm: 'Doing C' },
    ]}}],
  }];
  const o = enforceContinuation('sys', messages, []);
  assert(/2 unfinished item/.test(o));
  assert(/Doing A/.test(o));
  assert(/Doing C/.test(o));
  assert(!/do B/.test(o), 'completed item leaked');
});

test('continuation: refresh replaces stale todo content on idempotent re-run', () => {
  const m1 = [{ role: 'assistant', content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [
    { content: 'OLD_ITEM', status: 'pending' },
  ]}}] }];
  const first = enforceContinuation('sys', m1, []);
  assert(/OLD_ITEM/.test(first), 'first pass missed OLD_ITEM');
  const m2 = [{ role: 'assistant', content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [
    { content: 'OLD_ITEM', status: 'completed' },
    { content: 'NEW_ITEM', status: 'in_progress' },
  ]}}] }];
  const second = enforceContinuation(first, m2, []);
  assert((second.match(/<continuation-discipline>/g) || []).length === 1, 'block duplicated');
  assert(/NEW_ITEM/.test(second), 'new item missing after refresh');
  assert(!/- \[pending\] OLD_ITEM/.test(second), 'stale OLD_ITEM leaked into refreshed block');
});

test('continuation: LOOP ENFORCEMENT only when ScheduleWakeup was called before', () => {
  const tools = [{ name: 'ScheduleWakeup' }];
  const freshMsgs = [{ role: 'user', content: 'start /loop' }];
  const afterWakeup = [{
    role: 'assistant',
    content: [{ type: 'tool_use', name: 'ScheduleWakeup', input: { delaySeconds: 120 } }],
  }];
  const withoutCall = enforceContinuation('sys', freshMsgs, tools);
  const withCall = enforceContinuation('sys', afterWakeup, tools);
  assert(!/LOOP ENFORCEMENT/.test(withoutCall), 'LOOP ENFORCEMENT false-positive');
  assert(/LOOP ENFORCEMENT/.test(withCall), 'LOOP ENFORCEMENT missing after wakeup call');
});

test('continuation: handles undefined/null messages & tools without throw', () => {
  assert.doesNotThrow(() => enforceContinuation('sys', undefined, undefined));
  assert.doesNotThrow(() => enforceContinuation('sys', null, null));
});

// ── findOpenTodos ────────────────────────────────────────────
test('findOpenTodos: returns pending+in_progress, skips completed', () => {
  const msgs = [{ role: 'assistant', content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [
    { content: 'a', status: 'pending' },
    { content: 'b', status: 'completed' },
    { content: 'c', status: 'in_progress' },
  ]}}] }];
  const out = findOpenTodos(msgs);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].content, 'a');
  assert.strictEqual(out[1].content, 'c');
});

test('findOpenTodos: prefers most recent TodoWrite', () => {
  const msgs = [
    { role: 'assistant', content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [{ content: 'old', status: 'pending' }] }}] },
    { role: 'user', content: 'interim' },
    { role: 'assistant', content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [{ content: 'new', status: 'pending' }] }}] },
  ];
  const out = findOpenTodos(msgs);
  assert.strictEqual(out[0].content, 'new');
});

test('findOpenTodos: tolerates lowercase "todowrite"', () => {
  const msgs = [{ role: 'assistant', content: [{ type: 'tool_use', name: 'todowrite', input: { todos: [{ content: 'x', status: 'pending' }] }}] }];
  assert.strictEqual(findOpenTodos(msgs).length, 1);
});

test('findOpenTodos: returns [] when no TodoWrite present', () => {
  assert.deepStrictEqual(findOpenTodos([{ role: 'user', content: 'hi' }]), []);
  assert.deepStrictEqual(findOpenTodos([]), []);
  assert.deepStrictEqual(findOpenTodos(null), []);
});

// ── MCP server_tool_* serialization ──────────────────────────
test('msgToOai: serializes server_tool_use block as text (not dropped)', () => {
  const msg = { role: 'assistant', content: [
    { type: 'text', text: 'calling mcp' },
    { type: 'server_tool_use', id: 'st_1', name: 'mcp__x__search', input: { q: 'rust' } },
  ]};
  const out = msgToOai(msg);
  const concat = JSON.stringify(out);
  assert(/mcp__x__search/.test(concat), 'MCP tool name lost');
  assert(/rust/.test(concat), 'MCP input lost');
});

test('msgToOai: serializes server_tool_result as text (not dropped)', () => {
  const msg = { role: 'user', content: [
    { type: 'server_tool_result', tool_use_id: 'st_1', content: [{ type: 'text', text: 'found 42 hits' }] },
  ]};
  const out = msgToOai(msg);
  const concat = JSON.stringify(out);
  assert(/found 42 hits/.test(concat), 'MCP result content lost');
});

test('msgToOai: drops thinking + redacted_thinking on cross-provider resume', () => {
  const msg = { role: 'assistant', content: [
    { type: 'thinking', thinking: 'internal reasoning', signature: 'sig_base64_payload' },
    { type: 'redacted_thinking', data: 'encrypted' },
    { type: 'text', text: 'answer' },
  ]};
  const out = msgToOai(msg);
  const concat = JSON.stringify(out);
  assert(!/sig_base64_payload/.test(concat), 'thinking signature leaked');
  assert(!/encrypted/.test(concat), 'redacted_thinking leaked');
  assert(/answer/.test(concat));
});

test('msgToOai: tool_use becomes tool_calls structure', () => {
  const msg = { role: 'assistant', content: [
    { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/x' } },
  ]};
  const out = msgToOai(msg);
  const m = Array.isArray(out) ? out[0] : out;
  assert(m.tool_calls);
  assert.strictEqual(m.tool_calls[0].function.name, 'Read');
});

test('msgToOai: tool_result becomes role:tool message', () => {
  const msg = { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'tu_1', content: 'file contents' },
  ]};
  const out = msgToOai(msg);
  const arr = Array.isArray(out) ? out : [out];
  const toolMsg = arr.find(m => m.role === 'tool');
  assert(toolMsg, 'no role:tool message produced');
  assert.strictEqual(toolMsg.tool_call_id, 'tu_1');
});

// ── msgsToResponsesInput / images ────────────────────────────
test('msgsToResponsesInput: tool_result with realistic image preserves full data (not 100-char truncation)', () => {
  // Screenshot-style base64 ~500 chars; current code truncates to 100 → data lost
  const bigPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAA' +
    'SUVORK5CYII='.repeat(12);  // >1000 chars — realistic screenshot payload
  const msgs = [
    { role: 'assistant', content: [
      { type: 'tool_use', id: 'tu_shot', name: 'browser_take_screenshot', input: {} },
    ]},
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'tu_shot', content: [
        { type: 'text', text: 'screenshot of page' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: bigPng } },
      ]},
    ]},
  ];
  const out = msgsToResponsesInput(null, msgs);
  const s = JSON.stringify(out);
  assert(/function_call_output/.test(s), 'function_call_output missing');
  // Core compat requirement: the full image data URL must reach GPT somehow —
  // either inline in function_call_output or via a follow-up input_image message.
  const hasInputImage = out.some(p =>
    p.type === 'message' && Array.isArray(p.content) &&
    p.content.some(c => c.type === 'input_image' && c.image_url && c.image_url.includes(bigPng))
  );
  assert(hasInputImage,
    'tool_result image must be re-emitted as input_image multi-part so GPT can see it; current output: ' + s.slice(0, 400));
  assert(!/\.\.\.\]/.test(s) || hasInputImage, 'data URL truncated AND no input_image fallback — image lost');
});

test('msgsToResponsesInput: preserves assistant text + function_call pairs', () => {
  const msgs = [
    { role: 'assistant', content: [
      { type: 'text', text: 'I will read the file' },
      { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/x' } },
    ]},
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'tu_1', content: 'contents' },
    ]},
  ];
  const out = msgsToResponsesInput(null, msgs);
  const s = JSON.stringify(out);
  assert(/I will read the file/.test(s), 'assistant text lost before tool_use');
  assert(/function_call/.test(s), 'function_call missing');
  assert(/function_call_output/.test(s), 'function_call_output missing');
  assert(/contents/.test(s), 'tool result body lost');
});

// ── flattenSystem ────────────────────────────────────────────
test('flattenSystem: string passes through', () => {
  assert.strictEqual(flattenSystem('hi'), 'hi');
});

test('flattenSystem: array joins .text parts, strips cache_control', () => {
  const s = flattenSystem([
    { type: 'text', text: 'A', cache_control: { type: 'ephemeral' } },
    { type: 'text', text: 'B' },
  ]);
  assert(/A/.test(s) && /B/.test(s));
  assert(!/cache_control/.test(s));
});

// ── Harness integration: hooks / subagents / skill frontmatter ─
test('hooks: cleanIdentityForProvider preserves PreToolUse additionalContext prose', () => {
  // Upstream Claude Code hooks inject additionalContext via stdin JSON; the text
  // reaches the LLM as a system-reminder message. Identity cleaning runs on that
  // text and must NOT delete the user's custom guidance.
  const s = 'PreToolUse:Read hook additional context: [kg:size-guard] large file, prefer Grep first.';
  const o = cleanIdentityForProvider(s, 'OpenAI Codex');
  assert(/kg:size-guard/.test(o), 'custom hook tag dropped');
  assert(/prefer Grep first/.test(o), 'hook guidance prose dropped');
  assert(/hook additional context/.test(o), 'hook context marker dropped');
});

test('hooks: cleanIdentityForProvider preserves SessionStart hook restoration context', () => {
  const s = 'SessionStart hook additional context: [上下文已压缩] 工作状态恢复\n## 活跃模块\n- bin (r:23 w:19)';
  const o = cleanIdentityForProvider(s, 'OpenAI Codex');
  assert(/SessionStart hook/.test(o));
  assert(/工作状态恢复/.test(o), 'Chinese restoration context damaged');
  assert(/活跃模块/.test(o));
});

test('hooks: tameSkillPrompts preserves hook additionalContext body wrapped in system-reminder', () => {
  // Hook bodies reach the model wrapped in <system-reminder>...</system-reminder>.
  // Only UserPromptSubmit hook is stripped (it's a harness-internal signal);
  // other hook types (PreToolUse/PostToolUse/SessionStart) must survive.
  const s = '<system-reminder>\nPreToolUse:Bash hook additional context: warn if rm -rf\n</system-reminder>';
  const o = tameSkillPrompts(s);
  assert(/rm -rf/.test(o), 'PreToolUse hook guidance stripped (should only strip UserPromptSubmit)');
});

test('subagent: cleanIdentityForProvider rewrites "You are Claude" in subagent prompts', () => {
  // Subagents are spawned with system prompts like "You are Claude, Anthropic's
  // official CLI for Claude." — without identity cleaning, the GPT-driven subagent
  // would introspect itself as Claude and potentially refuse provider-specific tasks.
  const s = "You are Claude, Anthropic's official CLI for Claude. Today is 2026-04-22.";
  const o = cleanIdentityForProvider(s, 'OpenAI Codex');
  assert(!/You are Claude\b(?!\.)/.test(o), 'subagent still self-identifies as Claude: ' + o);
  assert(/multi-provider/.test(o), 'provider-agnostic rewrite missing');
  assert(/2026-04-22/.test(o), 'date context lost');
});

test('subagent: cleanIdentityForProvider rewrites "interactive agent that helps"', () => {
  // Agent tool subagent system prompts mention "interactive agent".
  const s = "You are Claude Code. You are an interactive agent that helps users with software engineering tasks.";
  const o = cleanIdentityForProvider(s, 'OpenAI Codex');
  assert(/Silly Code/.test(o));
  assert(/interactive agent that helps users/.test(o), 'agent role description damaged');
  assert(!/Claude Code/.test(o));
});

test('skills: tameSkillPrompts preserves frontmatter description: line verbatim', () => {
  // Skills are surfaced with frontmatter `name:` / `description:` lines in the
  // skill catalog. These are the LLM's primary discovery signal and must not be
  // mangled by taming.
  const s = [
    '---',
    'name: brainstorming',
    'description: Use when exploring multiple approaches before committing',
    '---',
    '## Red Flags',
    '| X | Y |',
    '| - | - |',
    '| a | b |',
    'body continues',
  ].join('\n');
  const o = tameSkillPrompts(s);
  assert(/name: brainstorming/.test(o), 'skill name frontmatter dropped');
  assert(/description: Use when/.test(o), 'skill description frontmatter dropped');
  assert(!/Red Flags/.test(o), 'Red Flags block should still be stripped');
  assert(/body continues/.test(o), 'skill body dropped');
});

test('skills: tameSkillPrompts preserves skill catalog entry (name + 1-line description)', () => {
  const s = '- /brainstorming skill. Description: Use when exploring approaches. Triggers on: "brainstorm", "explore".';
  const o = tameSkillPrompts(s);
  assert(/brainstorming skill/.test(o));
  assert(/Use when exploring approaches/.test(o), 'description stripped along with triggers');
  assert(!/Triggers on/.test(o), 'triggers tail not stripped');
});

// ── Responses API thinking-block round-trip ──────────────────
test('thinking: msgsToResponsesInput drops thinking blocks (no signature leak)', () => {
  // On session resume, prior-assistant messages may contain Claude-internal
  // thinking blocks with opaque signature payloads. Resubmitting those to GPT
  // via Responses API would either be rejected (unknown signature scheme) or
  // leak internal state. Must be dropped silently.
  const msgs = [
    { role: 'assistant', content: [
      { type: 'thinking', thinking: 'internal step 1', signature: 'sig_opaque_claude_payload' },
      { type: 'redacted_thinking', data: 'encrypted_blob' },
      { type: 'text', text: 'Here is my answer.' },
      { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/x' } },
    ]},
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' },
    ]},
  ];
  const out = msgsToResponsesInput(null, msgs);
  const s = JSON.stringify(out);
  assert(!/sig_opaque_claude_payload/.test(s), 'thinking signature leaked into Responses API input');
  assert(!/encrypted_blob/.test(s), 'redacted_thinking leaked');
  assert(/Here is my answer/.test(s), 'assistant text lost');
  assert(/function_call/.test(s), 'tool_use → function_call translation broken');
  assert(/function_call_output/.test(s), 'tool_result → function_call_output translation broken');
});

test('thinking: msgToOai (Chat Completions path) also drops signature payload', () => {
  const msg = { role: 'assistant', content: [
    { type: 'thinking', thinking: 'hidden', signature: 'sig_leak_attempt' },
    { type: 'text', text: 'visible' },
  ]};
  const out = msgToOai(msg);
  assert(!/sig_leak_attempt/.test(JSON.stringify(out)));
});

// ── MCP naming / tool_use argument cleanup ──────────────────
test('MCP: mcp__<server>__<tool> name format survives msgToOai tool_calls translation', () => {
  const msg = { role: 'assistant', content: [
    { type: 'tool_use', id: 'tu_m', name: 'mcp__playwright__browser_snapshot', input: { url: 'https://x' } },
  ]};
  const out = msgToOai(msg);
  const m = Array.isArray(out) ? out[0] : out;
  assert.strictEqual(m.tool_calls[0].function.name, 'mcp__playwright__browser_snapshot',
    'MCP double-underscore name mangled: ' + m.tool_calls[0].function.name);
});

test('MCP: mcp__<server>__<tool> name format survives msgsToResponsesInput function_call translation', () => {
  const msgs = [{ role: 'assistant', content: [
    { type: 'tool_use', id: 'tu_m', name: 'mcp__pencil__batch_get', input: { patterns: ['x'] } },
  ]}];
  const out = msgsToResponsesInput(null, msgs);
  const fc = out.find(p => p.type === 'function_call');
  assert(fc, 'no function_call emitted');
  assert.strictEqual(fc.name, 'mcp__pencil__batch_get', 'MCP name mangled in Responses API path');
});

test('_cleanToolArgs: strips empty-string optional params that GPT emits', () => {
  const cleaned = _cleanToolArgs('{"file_path":"/x","pages":"","offset":null,"limit":10}');
  assert.strictEqual(cleaned.file_path, '/x');
  assert.strictEqual(cleaned.limit, 10);
  assert(!('pages' in cleaned), 'empty string pages should be stripped');
  assert(!('offset' in cleaned), 'null offset should be stripped');
});

test('_cleanToolArgs: returns null on invalid JSON, {} on empty string (raw || "{}" fallback)', () => {
  assert.strictEqual(_cleanToolArgs('not json'), null);
  // Empty string collapses to '{}' via `raw || '{}'`, yielding an empty object.
  assert.deepStrictEqual(_cleanToolArgs(''), {});
  assert.deepStrictEqual(_cleanToolArgs(null), {});
  assert.deepStrictEqual(_cleanToolArgs(undefined), {});
});

// ── Cross-platform path semantics (agentBudgetLog) ──────────
test('cross-platform: agentBudgetLog no-op when SILLY_AGENT_CORE unset (privacy default)', async () => {
  // Privacy default: zero logging unless explicitly opted in.
  const prev = process.env.SILLY_AGENT_CORE;
  delete process.env.SILLY_AGENT_CORE;
  try {
    await agentBudgetLog({ model: 'test' });  // must not throw, must not write
  } finally {
    if (prev !== undefined) process.env.SILLY_AGENT_CORE = prev;
  }
});

test('cross-platform: agentBudgetLog uses node:path.join (not hardcoded "/")', () => {
  // Smoke test: the function body must reference node:path and node:os for
  // cross-platform home resolution, not hard-coded POSIX separators. We inspect
  // the stringified function since the function itself is serialized into the
  // patched binary the same way.
  const body = agentBudgetLog.toString();
  assert(/node:path/.test(body), 'must import node:path for cross-platform separator');
  assert(/node:os/.test(body), 'must import node:os for homedir()');
  assert(/homedir\(\)/.test(body), 'must call homedir() not hardcoded ~/');
  // No naked POSIX path concatenation.
  assert(!/['"]\/\.silly-code['"]/.test(body), 'hardcoded posix path found');
});

test('cross-platform: msgsToResponsesInput output is pure JSON (safe to serialize on any OS)', () => {
  const msgs = [{ role: 'user', content: 'hi' }];
  const out = msgsToResponsesInput('system', msgs);
  const json = JSON.stringify(out);
  assert(json.length > 0);
  // Ensure no functions/symbols/undefined leaked.
  assert.doesNotThrow(() => JSON.parse(json));
});

// ── Tool-description identity cleaning ──────────────────────
test('tool descriptions: cleanIdentityForProvider removes "Claude Code" from built-in tool descriptions', () => {
  // Upstream binary ships ~18 tool descriptions like "Cost of the Claude Code
  // subscription" / "Diagnose and verify your Claude Code install" that leak
  // the Claude brand into GPT's tool catalog. The adapter must run _clean on
  // the description field before forwarding the tool list.
  const samples = [
    'Cost of the Claude Code subscription',
    'Spawn a remote Claude Code task',
    'Submit feedback about Claude Code',
    'Diagnose and verify your Claude Code install',
    'Discover Claude Code plugins',
  ];
  for (const desc of samples) {
    const cleaned = cleanIdentityForProvider(desc, 'OpenAI Codex');
    assert(!/\bClaude Code\b/.test(cleaned), `leaked Claude Code: ${desc} → ${cleaned}`);
    assert(/Silly Code/.test(cleaned), `replacement missing: ${cleaned}`);
  }
});

// ── End-to-end: tame → clean → continuation order ────────────
test('pipeline order: tame strips hard-gate, clean renames Claude, continuation appends', () => {
  const raw = '<HARD-GATE>\nBlock unless approved.\n</HARD-GATE>\nYou are Claude Code, serving @anthropic-ai/claude-code.';
  const stage1 = tameSkillPrompts(raw);
  const stage2 = cleanIdentityForProvider(stage1, 'OpenAI Codex');
  const stage3 = enforceContinuation(stage2, [], []);
  assert(!/HARD-GATE/.test(stage3));
  assert(!/\bClaude Code\b/.test(stage3));
  assert(/@anthropic-ai\/claude-code/.test(stage3), 'package id damaged');
  assert(/<continuation-discipline>/.test(stage3));
});

// ── Summary ─────────────────────────────────────────────────
console.log('');
console.log('  ' + pass + ' passed, ' + fail + ' failed');
if (fail > 0) process.exit(1);
