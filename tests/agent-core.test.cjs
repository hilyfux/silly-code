/**
 * agent-core.test.cjs — P0 budget tracker unit tests
 *
 * Verifies the provider-agnostic budget tracker returns sane numbers
 * across the shapes the adapter pre-flight will feed it.
 */

'use strict';

const assert = require('node:assert');
const { agentBudgetTrack } = require('../pipeline/patches/providers/_base.cjs');

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { console.log('  \u2713', label); pass++; } else { console.log('  \u2717', label); fail++; } };

// ── T1: empty conversation → all-zero used, byte_estimate source ──
{
  const r = agentBudgetTrack({ messages: [], systemPrompt: '', tools: [], contextWindow: 200000 });
  ok('T1 empty: used=0', r.used === 0);
  ok('T1 empty: total=200000', r.total === 200000);
  ok('T1 empty: remaining=200000', r.remaining === 200000);
  ok('T1 empty: usedPct=0', r.usedPct === 0);
  ok('T1 empty: compactAt=167000', r.compactAt === 167000);
  ok('T1 empty: blockingAt=197000', r.blockingAt === 197000);
  ok('T1 empty: source=byte_estimate', r.source === 'byte_estimate');
}

// ── T2: assistant usage anchor → assistant_usage source ──
{
  const messages = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 100, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 50 } },
  ];
  const r = agentBudgetTrack({ messages, systemPrompt: '', tools: [], contextWindow: 200000 });
  ok('T2 assistant usage: used=155', r.used === 155);
  ok('T2 assistant usage: source=assistant_usage', r.source === 'assistant_usage');
}

// ── T3: assistant usage + trailing user turn → mixed source, adds byte estimate ──
{
  const messages = [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: [{ type: 'text', text: 'reply' }], usage: { input_tokens: 1000, output_tokens: 10 } },
    { role: 'user', content: 'A'.repeat(3500) }, // 3500 bytes → ~1000 tokens at 3.5 bpt
  ];
  const r = agentBudgetTrack({ messages, systemPrompt: '', tools: [], contextWindow: 200000 });
  ok('T3 mixed: source=mixed', r.source === 'mixed');
  ok('T3 mixed: used >= 2010 (anchor 1010 + tail ~1000)', r.used >= 2010);
  ok('T3 mixed: used <= 2020', r.used <= 2020);
}

// ── T4: no assistant usage → byte_estimate of all content ──
{
  const messages = [
    { role: 'user', content: 'B'.repeat(7000) }, // ~2000 tokens
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'C'.repeat(3500) }] }, // ~1000 tokens
  ];
  const systemPrompt = 'D'.repeat(1750); // ~500 tokens
  const r = agentBudgetTrack({ messages, systemPrompt, tools: [], contextWindow: 200000 });
  ok('T4 byte_estimate: source=byte_estimate', r.source === 'byte_estimate');
  ok('T4 byte_estimate: used ~= 3500 (2000+1000+500)', r.used >= 3490 && r.used <= 3510);
}

// ── T5: tool_use blocks count toward size ──
{
  const messages = [
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] },
  ];
  const r = agentBudgetTrack({ messages, systemPrompt: '', tools: [], contextWindow: 200000 });
  ok('T5 tool_use: used > 0', r.used > 0);
  ok('T5 tool_use: source=byte_estimate', r.source === 'byte_estimate');
}

// ── T6: compactAt / blockingAt math at 1M context ──
{
  const r = agentBudgetTrack({ messages: [], systemPrompt: '', tools: [], contextWindow: 1000000 });
  ok('T6 1M total', r.total === 1000000);
  ok('T6 1M compactAt = 967000', r.compactAt === 967000);
  ok('T6 1M blockingAt = 997000', r.blockingAt === 997000);
}

// ── T7: pathological inputs don't throw ──
{
  // Malformed messages, missing content, unknown block types
  const messages = [
    null,
    { role: 'user' },
    { role: 'assistant', content: [{ type: 'weird_block', data: 'x' }], usage: { input_tokens: 'not-a-number' } },
    { role: 'user', content: [{ type: 'image', source: {} }] },
  ];
  let threw = false;
  let r;
  try { r = agentBudgetTrack({ messages, systemPrompt: null, tools: null, contextWindow: null }); }
  catch { threw = true; }
  ok('T7 never throws', !threw);
  ok('T7 falls back to default total=200000', r && r.total === 200000);
}

// ── T8: assistant usage with cache_read dominates over output ──
{
  const messages = [
    { role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 1000, cache_read_input_tokens: 100000, output_tokens: 5 } },
  ];
  const r = agentBudgetTrack({ messages, systemPrompt: '', tools: [], contextWindow: 200000 });
  ok('T8 cache_read counted: used >= 101005', r.used === 101005);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
