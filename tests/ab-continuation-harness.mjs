#!/usr/bin/env node
// tests/ab-continuation-harness.mjs
//
// A/B harness for the tail-position continuation reminder (commit b6754aa).
// Measures the rate at which gpt-5.x emits tool_use vs. narration-only on a
// multi-step task prompt, with and without the <continuation-reminder> block
// injected at the tail of the Responses API input array.
//
// USAGE
//   node tests/ab-continuation-harness.mjs             # dry-run (prints prompts)
//   SILLY_AB_LIVE=1 node tests/ab-continuation-harness.mjs
//     → makes real chatgpt.com/backend-api/codex/responses calls (N=5 per arm,
//       ~30s total). Consumes ChatGPT Pro quota; runs at low volume to stay
//       respectful.
//
// ENV
//   SILLY_AB_LIVE=1              enable real network calls
//   SILLY_AB_N=<int>             override N per arm (default 5)
//   SILLY_AB_MODEL=<slug>        override model (default gpt-5.4)
//
// OUTPUT
//   Per arm: tool_use count / narration-only count / error count
//   Delta: narration-rate A vs B (negative means reminder reduces narration)
//
// This is an OPT-IN empirical validation tool, NOT auto-run by npm test.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const N = parseInt(process.env.SILLY_AB_N || '5', 10);
const MODEL = process.env.SILLY_AB_MODEL || 'gpt-5.4';
const LIVE = process.env.SILLY_AB_LIVE === '1';

// ── Multi-step narration-bait prompt ────────────────────────────────────────
// A task that's decomposable into sequential tool calls. A "lazy" GPT will
// narrate "OK I'll do these steps" without actually calling the tool.
const BASE_INSTRUCTIONS = `You are Silly Code, a coding assistant. The user will ask you to perform a multi-step task. You MUST call the available tools — do not narrate what you "will do". Every acknowledgment must be followed by an immediate tool call in the same response.`;

const USER_TASK = `Run these three independent bash commands to collect diagnostic info:
1. uname -a
2. date -u +%FT%TZ
3. echo "arithmetic check: 3+4 = $((3+4))"

After each, briefly comment on the result.`;

const BASH_TOOL = {
  type: 'function',
  name: 'Bash',
  description: 'Execute a bash command and return stdout/stderr.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The bash command to run' },
      description: { type: 'string', description: 'Short purpose' },
    },
    required: ['command'],
  },
};

// ── Build request body for each arm ─────────────────────────────────────────
// Arm A: with <continuation-reminder> tail developer message
// Arm B: identical but no tail reminder
const TAIL_REMINDER = {
  role: 'developer',
  content: `<continuation-reminder>
You are in autonomous tool-calling mode. Any acknowledgment ("OK", "好的", "let me continue", "I'll do that") MUST be followed by a concrete tool call in the SAME response. Narration without action = failure. If the user asked for N actions, emit N tool calls now. Do not stop until every action is executed or you hit an unrecoverable error.
</continuation-reminder>`,
};

// Simulate mid-agent-loop state: model already completed step 1 via tool call,
// now we ask it to continue with steps 2 & 3. This is where narration-stop
// actually happens — after a tool success, model may say "OK, next I'll do X"
// and emit finish_reason=stop without actually calling the tool.
function buildMidAgentInput() {
  return [
    { role: 'user', content: USER_TASK },
    { role: 'assistant', content: 'Running step 1.' },
    {
      type: 'function_call',
      call_id: 'call_step1',
      name: 'Bash',
      arguments: JSON.stringify({ command: 'uname -a', description: 'step 1: OS check' }),
    },
    {
      type: 'function_call_output',
      call_id: 'call_step1',
      output: 'Darwin macbook.local 24.0.0 Darwin Kernel Version 24.0.0 arm64',
    },
    { role: 'user', content: 'Continue with the remaining steps.' },
  ];
}

function buildBody(withReminder) {
  const input = buildMidAgentInput();
  if (withReminder) input.push(TAIL_REMINDER);
  return {
    model: MODEL,
    instructions: BASE_INSTRUCTIONS,
    input,
    store: false,
    stream: true,
    tools: [BASH_TOOL],
    parallel_tool_calls: false,
  };
}

// ── Load OAuth token ────────────────────────────────────────────────────────
async function loadToken() {
  const dataDir = process.env.SILLY_CODE_DATA || join(homedir(), '.silly-code');
  let data;
  for (const name of ['codex-auth.json', 'codex-oauth.json']) {
    try { data = JSON.parse(readFileSync(join(dataDir, name), 'utf8')); break; } catch {}
  }
  if (!data || !data.access_token) throw new Error('no OAuth token. Run: silly login codex');

  // Refresh if JWT expiry within 2 min
  const parts = data.access_token.split('.');
  if (parts.length === 3) {
    try {
      const pay = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (pay.exp && Date.now() < pay.exp * 1000 - 120_000) return data.access_token;
    } catch {}
    if (data.refresh_token) {
      const r = await fetch('https://auth.openai.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
          refresh_token: data.refresh_token,
          scope: 'openid profile email offline_access',
        }),
      });
      if (r.ok) {
        const j = await r.json();
        if (j.access_token) return j.access_token;
      }
    }
  }
  return data.access_token;
}

// ── Classify a single SSE stream ────────────────────────────────────────────
// Returns one of: 'tool_use' | 'narration_only' | 'error' | 'mixed'
async function classifyResponse(resp) {
  if (!resp.ok) return { kind: 'error', detail: `HTTP ${resp.status} ${await resp.text().catch(() => '')}` };
  let toolCallCount = 0;
  let textChunks = 0;
  let finishReason = null;
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        let ev;
        try { ev = JSON.parse(raw); } catch { continue; }
        const t = ev.type || '';
        if (t === 'response.output_item.added' && ev.item?.type === 'function_call') toolCallCount++;
        if (t === 'response.output_text.delta') textChunks++;
        if (t === 'response.completed') finishReason = ev.response?.status || 'completed';
      }
    }
  } catch (e) { return { kind: 'error', detail: e.message }; }
  if (toolCallCount > 0 && textChunks > 0) return { kind: 'mixed', toolCallCount, textChunks };
  if (toolCallCount > 0) return { kind: 'tool_use', toolCallCount };
  if (textChunks > 0) return { kind: 'narration_only', textChunks };
  return { kind: 'error', detail: `no output (finish=${finishReason})` };
}

async function runArm(label, withReminder, token) {
  const results = { label, tool_use: 0, narration_only: 0, mixed: 0, error: 0, details: [] };
  for (let i = 0; i < N; i++) {
    const body = buildBody(withReminder);
    const t0 = Date.now();
    let resp;
    try {
      resp = await fetch('https://chatgpt.com/backend-api/codex/responses', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'chatgpt-account-id': '',
          'OpenAI-Beta': 'responses=experimental',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      results.error++;
      results.details.push({ i, kind: 'error', detail: `fetch: ${e.message}`, ms: Date.now() - t0 });
      continue;
    }
    const cls = await classifyResponse(resp);
    results[cls.kind]++;
    results.details.push({ i, ...cls, ms: Date.now() - t0 });
    process.stderr.write(`  [${label}] ${i + 1}/${N}: ${cls.kind}${cls.toolCallCount ? ' (' + cls.toolCallCount + ' tool calls)' : ''} ${Date.now() - t0}ms\n`);
  }
  return results;
}

function summarize(arm) {
  const acted = arm.tool_use + arm.mixed;
  const lazy = arm.narration_only;
  const pct = (x) => ((x / N) * 100).toFixed(0) + '%';
  return `${arm.label}: tool_use=${arm.tool_use}/${N} (${pct(arm.tool_use)}), mixed=${arm.mixed}/${N}, narration_only=${arm.narration_only}/${N} (${pct(arm.narration_only)}), error=${arm.error}/${N}\n  → acted=${acted}/${N} (${pct(acted)}), lazy=${lazy}/${N} (${pct(lazy)})`;
}

// ── main ───────────────────────────────────────────────────────────────────
if (!LIVE) {
  console.log('# DRY-RUN. Set SILLY_AB_LIVE=1 to make real chatgpt.com calls.\n');
  console.log('Arm A (with tail reminder):');
  console.log(JSON.stringify(buildBody(true), null, 2).slice(0, 800) + '...\n');
  console.log('Arm B (without tail reminder):');
  console.log(JSON.stringify(buildBody(false), null, 2).slice(0, 800) + '...\n');
  console.log(`Would make ${N * 2} calls against model=${MODEL}.`);
  process.exit(0);
}

console.error(`# A/B harness — LIVE mode, N=${N} per arm, model=${MODEL}\n`);
const token = await loadToken();
console.error(`# Token loaded, ${token.length} chars\n`);
console.error(`# --- Arm A: with tail reminder ---`);
const armA = await runArm('A(+reminder)', true, token);
console.error(`# --- Arm B: without tail reminder ---`);
const armB = await runArm('B(-reminder)', false, token);

console.log('\n== A/B RESULT ==');
console.log(summarize(armA));
console.log(summarize(armB));

const lazyA = armA.narration_only / N;
const lazyB = armB.narration_only / N;
const delta = (lazyA - lazyB) * 100;
console.log(`\nNarration-rate Δ (A − B): ${delta > 0 ? '+' : ''}${delta.toFixed(1)}pp`);
console.log(`Interpretation: ${delta < 0 ? 'reminder REDUCED narration' : delta > 0 ? 'reminder INCREASED narration' : 'no effect'} (N=${N} too small for statistical certainty; this is a smoke signal)`);
