/**
 * openai.cjs — Provider config for OpenAI (Codex / GPT)
 *
 * Dual-mode:
 *   - OAuth (ChatGPT) → Responses API at chatgpt.com/backend-api/codex/responses
 *   - API key (sk-...) → Chat Completions at api.openai.com/v1/chat/completions
 *
 * adapter and auth are serialized as strings (.toString()) and injected
 * into the upstream binary's client factory scope. All rules apply:
 *   - NO require() — use await import('node:...')
 *   - NO module/exports/__dirname/__filename
 *   - Functions reference each other by name (auth is called _openaiAuth)
 *   - Per-provider state variable (_openaiData) is declared by the engine
 */

// ── Single source of truth for Codex models ──
// Verified against upstream codex-cli 0.121.0 native binary (strings | grep slug).
// Adding a row here propagates to modelDisplayNames, contextWindow.perModel,
// and the tierNames metadata. The adapter's inline _codexModelTable mirrors
// the slug list; see the "KEEP IN SYNC" marker inside _openaiAdapter.
const CODEX_MODELS = [
  { slug: 'gpt-5.4',             display: 'gpt-5.4',             ctx: 272000 },
  { slug: 'gpt-5.4-mini',        display: 'gpt-5.4-mini',        ctx: 272000 },
  { slug: 'gpt-5.3-codex',       display: 'gpt-5.3-codex',       ctx: 272000 },
  { slug: 'gpt-5.3-codex-spark', display: 'gpt-5.3-codex-spark', ctx: 272000 },
  { slug: 'gpt-5.2-codex',       display: 'gpt-5.2-codex',       ctx: 272000 },
  { slug: 'gpt-5.2',             display: 'gpt-5.2',             ctx: 272000 },
  { slug: 'gpt-5.1-codex-max',   display: 'gpt-5.1-codex-max',   ctx: 400000 },
  { slug: 'gpt-5.1-codex-mini',  display: 'gpt-5.1-codex-mini',  ctx: 272000 },
  { slug: 'gpt-5.1-codex',       display: 'gpt-5.1-codex',       ctx: 272000 },
  { slug: 'gpt-5.1',             display: 'gpt-5.1',             ctx: 272000 },
];
const OAI_LEGACY_MODELS = [
  { slug: 'gpt-4o',      display: 'GPT-4o',      ctx: 128000 },
  { slug: 'gpt-4o-mini', display: 'GPT-4o Mini', ctx: 128000 },
  { slug: 'o3',          display: 'o3',          ctx: 200000 },
];
// Claude alias → Codex slug, tier-aligned with Codex UI's default picks.
// haiku note (2026-04-17 regression): gpt-5.1-codex-mini was observed to
// stall sub-agents ("Explore" / Task spawns) on chatgpt.com's /codex/responses
// endpoint — 3-minute silent timeout, zero tool_uses, zero tokens. Sub-agents
// default to the haiku alias, so mapping haiku to an unstable slug broke every
// agentic workflow. Reverted to gpt-5.3-codex (same as sonnet) until we have
// dumps proving mini is stable on this endpoint. Menu still shows a distinct
// "Fast" slot via patch 53's label remap; user-facing tier structure preserved.
const CODEX_ALIASES = {
  'claude-opus':   'gpt-5.4',             // flagship, most capable
  'claude-sonnet': 'gpt-5.3-codex',       // agentic coding mainstream
  'claude-haiku':  'gpt-5.3-codex',       // reverted from gpt-5.1-codex-mini (see note)
};
// ChatGPT-account migration map (mirrored from codex-cli 0.121.0's model_catalog
// upgrade pointers — strings-extracted from the native binary on 2026-04-17).
// chatgpt.com/backend-api/codex/responses returns HTTP 400 "The '<slug>' model
// is not supported when using Codex with a ChatGPT account" for the LHS slugs,
// and Codex CLI itself silently migrates them to the RHS before dispatch
// (there's a `model_migration.rs` + a `hide_gpt-5.1-codex-max_migration_prompt`
// sentinel in the binary). Mirror that behaviour so our OAuth users don't see
// the "Retrying 5/10 · Unable to connect" storm on Opus 4.6.
const OAUTH_MODEL_MIGRATIONS = {
  'gpt-5.1-codex-max':   'gpt-5.4',
  'gpt-5.1-codex-mini':  'gpt-5.4',
  'gpt-5.2':             'gpt-5.4',
  'gpt-5.2-codex':       'gpt-5.4',
  'gpt-5.1-codex':       'gpt-5.3-codex',
  'gpt-5.1':             'gpt-5.3-codex',
  'gpt-5-codex':         'gpt-5.3-codex',
  'gpt-5-codex-mini':    'gpt-5.3-codex',
  'gpt-5':               'gpt-5.3-codex',
  // 2026-04-17 batch smoke: gpt-5.3-codex-spark accepted by chatgpt.com
  // (no 400) but stream never completes — upstream retry-loop hits 10+
  // requests for a single `reply OK` prompt. The slug appears in the newer
  // Codex web UI (user screenshot) but is absent from the 0.121.0 native
  // binary catalog. Until we confirm spark's SSE contract, migrate to
  // gpt-5.3-codex which is the closest stable sibling.
  'gpt-5.3-codex-spark': 'gpt-5.3-codex',
};
const ALL_MODELS = [...CODEX_MODELS, ...OAI_LEGACY_MODELS];

// ── auth function ────────────────────────────────────────────────────────────
// Returns { headers, kind } where kind is 'oauth' or 'apikey'
// _openaiData is declared by the serialization engine as: let _openaiData = null;
async function _openaiAuth() {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { homedir } = await import('node:os');
  const _dir = process.env.SILLY_CODE_DATA || join(homedir(), '.silly-code');
  if (!_openaiData) {
    // Try new filename first, fall back to legacy
    try {
      _openaiData = JSON.parse(readFileSync(join(_dir, 'codex-auth.json'), 'utf8'));
    } catch {
      try {
        _openaiData = JSON.parse(readFileSync(join(_dir, 'codex-oauth.json'), 'utf8'));
      } catch (e) {
        throw new Error('OpenAI: no auth token. Run: silly login codex');
      }
    }
  }
  if (!_openaiData.access_token) throw new Error('OpenAI: invalid token file');

  // Check JWT expiry — JWT access tokens have 3 dot-separated base64url parts
  const _parts = _openaiData.access_token.split('.');
  const _isJwt = _parts.length === 3;
  if (_isJwt) {
    try {
      const _pay = JSON.parse(atob(_parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (_pay.exp && Date.now() < (_pay.exp * 1000 - 120000)) {
        return { headers: { 'Authorization': 'Bearer ' + _openaiData.access_token }, kind: 'oauth' };
      }
    } catch {}
    // JWT expired or unreadable — try refresh (with concurrency lock)
    if (_openaiData.refresh_token) {
      if (!_openaiData._refreshP) {
        _openaiData._refreshP = (async () => {
          try {
            const _r = await fetch('https://auth.openai.com/oauth/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
                refresh_token: _openaiData.refresh_token,
              }).toString(),
            });
            if (_r.ok) {
              const _d = await _r.json();
              _openaiData.access_token = _d.access_token || _openaiData.access_token;
              if (_d.refresh_token) _openaiData.refresh_token = _d.refresh_token;
              _openaiData.savedAt = new Date().toISOString();
              try { writeFileSync(join(_dir, 'codex-auth.json'), JSON.stringify(_openaiData, null, 2)); } catch {}
            }
          } catch (e) { console.error('[silly] OpenAI token refresh failed:', e.message || e); }
          finally { _openaiData._refreshP = null; }
        })();
      }
      await _openaiData._refreshP;
    }
    return { headers: { 'Authorization': 'Bearer ' + _openaiData.access_token }, kind: 'oauth' };
  }

  // Not a JWT → API key path
  return { headers: { 'Authorization': 'Bearer ' + _openaiData.access_token }, kind: 'apikey' };
}

// ── adapter function ─────────────────────────────────────────────────────────
// Intercepts fetch calls from the upstream client and routes to OpenAI.
// References _openaiAuth (auth), mapModel, msgToOai, makeSseStream,
// msgsToResponsesInput, makeResponsesSseStream, collectResponsesSse, cleanIdentityForProvider from _base.cjs
// all serialized into the same scope.
async function _openaiAdapter(url, init) {
  // Auto-injected by provider-core.cjs from file-top CODEX_MODELS + CODEX_ALIASES.
  // Do NOT manually edit — update the source-of-truth constants above instead.
  const _codexModelTable = "__INJECT__codexModelTable__";
  const _oauthMigrations = "__INJECT__oauthMigrations__";
  const _oaiModelTable = { 'claude-opus': 'gpt-4o', 'claude-sonnet': 'gpt-4o', 'claude-haiku': 'gpt-4o-mini', default: 'gpt-4o' };
  const _provName = 'OpenAI GPT';

  const cred = await _openaiAuth();
  const _b = JSON.parse(init.body);

  // Debug dump — SILLY_DEBUG_DUMP=1 writes raw incoming Anthropic-format request
  // to <os tmpdir>/silly-debug/. Skips system prompt body (can be 200KB+ of identity).
  if (process.env.SILLY_DEBUG_DUMP) {
    try {
      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const { join: _joinDbg } = await import('node:path');
      const _debugDir = _joinDbg(tmpdir(), 'silly-debug');
      mkdirSync(_debugDir, { recursive: true });
      const _stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const _systemLen = typeof _b.system === 'string' ? _b.system.length : Array.isArray(_b.system) ? _b.system.reduce((n, p) => n + ((p.text || '').length), 0) : 0;
      const _dump = { url, cwd: process.cwd(), env_PWD: process.env.PWD, env_CALLER_DIR: process.env.CALLER_DIR, model: _b.model, stream: !!_b.stream, system_preview: (typeof _b.system === 'string' ? _b.system : (_b.system || []).map(p => p.text || '').join('\n')).slice(0, 2000), system_length: _systemLen, message_count: (_b.messages || []).length, messages: _b.messages, tools_count: (_b.tools || []).length };
      writeFileSync(_joinDbg(_debugDir, _stamp + '-openai-request.json'), JSON.stringify(_dump, null, 2));
    } catch (_e) { console.error('[silly-debug]', _e.message || _e); }
  }

  // Only filter tools that are genuinely unusable in sillyx sessions:
  //   RemoteTrigger — GPT cannot be the target of a remote-trigger dispatch
  // NotebookEdit: NOT filtered — harness impl is pure JSON cell editing,
  //   no Jupyter kernel required. Works identically to Edit for .ipynb files.
  // Everything else runs through the harness and CAN work.
  const _CC_UNUSABLE = new Set(['RemoteTrigger']);
  const _tools = ((_b.tools || []).filter(t => !_CC_UNUSABLE.has(t.name)));
  // sillyFastTier lives in _base.cjs; hand it the minified effort getter.
  const _fastTier = sillyFastTier(typeof n8z === 'function' ? n8z : undefined);
  // P0 agent-core: provider-agnostic budget observation. SILLY_AGENT_CORE=1
  // enables local ndjson logging in agentBudgetLog; tracker itself is pure
  // and cheap, so we always compute but only log on opt-in. Writes happen
  // asynchronously after the request is queued (not awaited).
  if (process.env.SILLY_AGENT_CORE === '1') {
    const _ctxWindow = 272000; // openai.cjs default upper bound; tracker normalises
    const _b0 = _b;
    const _budget = agentBudgetTrack({ messages: _b0.messages, systemPrompt: _b0.system, tools: _b0.tools, contextWindow: _ctxWindow });
    agentBudgetLog({ provider: 'openai', model: _b0.model, cred_kind: cred.kind, message_count: (_b0.messages || []).length, ..._budget });
  }
  const _clean = (t) => cleanIdentityForProvider(tameSkillPrompts(t), _provName);
  if (_b.system) {
    if (typeof _b.system === 'string') _b.system = enforceContinuation(_clean(_b.system), _b.messages, _tools);
    else if (Array.isArray(_b.system)) {
      _b.system = _b.system.map(p => p.text ? { ...p, text: _clean(p.text) } : p);
      // Append continuation-discipline block once, on the LAST system block
      if (_b.system.length) {
        const _last = _b.system.length - 1;
        _b.system[_last] = { ..._b.system[_last], text: enforceContinuation(_b.system[_last].text || '', _b.messages, _tools) };
      }
    }
  }
  for (const m of (_b.messages || [])) {
    if (typeof m.content === 'string') m.content = _clean(m.content);
    else if (Array.isArray(m.content)) for (const p of m.content) { if (p.type === 'text' && p.text) p.text = _clean(p.text); }
  }

  if (cred.kind === 'oauth') {
    // ChatGPT OAuth → chatgpt.com Responses API
    // NOTE: chatgpt.com/backend-api/codex/responses requires stream:true — non-streaming
    // requests return HTTP 400 "Stream must be set to true". We always stream and then
    // collect the SSE into a static response when the caller wants non-streaming.
    let _om = mapModel(_b.model, _codexModelTable);
    // Apply the chatgpt.com migration map — several 5.1/5.2 slugs return 400
    // "not supported when using Codex with a ChatGPT account"; Codex CLI
    // silently rewrites to the RHS target before dispatch.
    if (_oauthMigrations[_om]) {
      const _to = _oauthMigrations[_om];
      console.error('[silly] codex: migrating "' + _om + '" → "' + _to + '" (chatgpt.com Codex account does not accept the old slug).');
      _om = _to;
    }
    const _sysText = flattenSystem(_b.system);
    const _input = msgsToResponsesInput(null, _b.messages);
    const _stream = !!_b.stream;
    const _req = { model: _om, instructions: _sysText || 'You are a helpful coding assistant.', input: _input, store: false, stream: true };
    // Do NOT forward temperature / top_p — chatgpt.com's ResponsesApiRequest
    // struct has no such fields (verified against codex-cli 0.121.0 native
    // binary) and returns HTTP 400 "Unsupported parameter: temperature" when
    // passed. Upstream Claude Code sets temperature=1 by default, so every
    // request from the main TUI was being rejected before this fix landed.
    // service_tier: only opt-in via SILLY_CODEX_FAST=1 on /codex/responses.
    // 2026-04-17: user reported 7/10 retry storms after bff322e auto-injected
    // "priority" for effort>=high. chatgpt.com's Codex OAuth endpoint does not
    // officially document service_tier; assume reject / rate-limit until a
    // successful dump proves otherwise. SILLY_CODEX_FAST=1 remains available
    // for users who want to test.
    if (_fastTier && process.env.SILLY_CODEX_FAST === '1') _req.service_tier = 'priority';
    if (_tools.length) {
      // Clean tool descriptions too — 18+ upstream built-in tools (Spawn remote,
      // Submit feedback, Discover plugins, etc.) have "Claude Code" in their
      // description text, leaking identity into GPT's tool catalog.
      _req.tools = _tools.map(t => ({ type: 'function', name: t.name, description: _clean(t.description || ''), parameters: t.input_schema || { type: 'object', properties: {} } }));
      // Serial tool execution — parallel calls cause agent loop confusion with GPT Pro
      _req.parallel_tool_calls = false;
    }
    // 429 retry-with-backoff + fetch timeout: up to 3 attempts (2 waits).
    // chatgpt.com rate-limits aggressively during rapid loop iterations.
    // Without this, Claude Code generates "No response requested." synthetic
    // messages on every 429, burning pua:loop iterations without doing work.
    // Fetch timeout (120s): chatgpt.com occasionally hangs with no response,
    // causing subagents to freeze at "Initializing..." indefinitely.
    // Unconditional request-shape dump (no env flag required). Captures
    // every /codex/responses invocation so interactive TUI failures become
    // post-mortem-able without user intervention. Small files; self-rotates
    // at ~200 entries via mtime sort (kept simple).
    const _bodyStr = JSON.stringify(_req);
    try {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const { tmpdir: _tmp } = await import('node:os');
      const { join: _jr } = await import('node:path');
      const _rDir = _jr(_tmp(), 'silly-debug');
      mkdirSync(_rDir, { recursive: true });
      const _stamp = new Date().toISOString().replace(/[:.]/g, '-');
      writeFileSync(_jr(_rDir, _stamp + '-codex-request.json'), JSON.stringify({
        ts: Date.now(),
        url: 'https://chatgpt.com/backend-api/codex/responses',
        model: _req.model, stream: _req.stream,
        body_size: _bodyStr.length,
        instructions_len: (_req.instructions || '').length,
        input_item_count: (_req.input || []).length,
        input_preview: (_req.input || []).slice(0, 3).map(i => ({ type: i.type, role: i.role, content_parts: Array.isArray(i.content) ? i.content.map(c => ({ type: c.type, len: (c.text || '').length })) : null })),
        tools_count: (_req.tools || []).length,
        tool_names: (_req.tools || []).map(t => t.name),
        extra_fields: Object.keys(_req).filter(k => !['model','instructions','input','store','stream','temperature','top_p','tools','parallel_tool_calls','service_tier'].includes(k)),
      }, null, 2));
    } catch {}
    let _r, _rAttempt = 0;
    // Composite signal: per-attempt 120s timeout + upstream abort (Ctrl+C /
    // WK session shutdown). Without upstream forwarding, an in-flight Codex
    // request keeps the process alive past WK() for up to 120s and /loop
    // appears to ignore cancellation. AbortSignal.any handles listener
    // teardown automatically (no manual add/remove inside the retry loop).
    const _upSig = init && init.signal;
    while (true) {
      const _signal = AbortSignal.any(
        _upSig ? [_upSig, AbortSignal.timeout(120000)] : [AbortSignal.timeout(120000)]
      );
      try {
        _r = await fetch('https://chatgpt.com/backend-api/codex/responses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...cred.headers },
          body: _bodyStr,
          signal: _signal,
        });
      } catch (_fetchErr) {
        // fetch() threw — TLS / abort / DNS / socket reset. Dump the raw error so
        // we can tell the difference. Upstream collapses all of these into the
        // generic "Unable to connect to API" message otherwise.
        try {
          const { mkdirSync, writeFileSync } = await import('node:fs');
          const { tmpdir: _tmp } = await import('node:os');
          const { join: _jr } = await import('node:path');
          const _rDir = _jr(_tmp(), 'silly-debug');
          mkdirSync(_rDir, { recursive: true });
          const _stamp = new Date().toISOString().replace(/[:.]/g, '-');
          writeFileSync(_jr(_rDir, _stamp + '-codex-fetch-error.json'), JSON.stringify({
            ts: Date.now(),
            url: 'https://chatgpt.com/backend-api/codex/responses',
            err_name: _fetchErr && _fetchErr.name,
            err_message: _fetchErr && _fetchErr.message,
            err_code: _fetchErr && _fetchErr.code,
            err_cause_name: _fetchErr && _fetchErr.cause && _fetchErr.cause.name,
            err_cause_message: _fetchErr && _fetchErr.cause && _fetchErr.cause.message,
            err_cause_code: _fetchErr && _fetchErr.cause && _fetchErr.cause.code,
            body_size: _bodyStr.length,
            req_model: _req.model,
            req_tools_count: (_req.tools || []).length,
            req_extra_fields: Object.keys(_req).filter(k => !['model','instructions','input','store','stream','temperature','top_p','tools','parallel_tool_calls','service_tier'].includes(k)),
          }, null, 2));
          console.error('[silly] fetch /codex/responses threw: ' + (_fetchErr && (_fetchErr.message || _fetchErr.name)) + ' (body ' + _bodyStr.length + ' bytes)');
        } catch {}
        throw _fetchErr;
      }
      if (_r.status !== 429 || _rAttempt++ >= 2) break;
      // Cap at 30s: upstream has its own request timeout; waiting 120s risks racing it.
      // parseInt NaN-safe: malformed Retry-After falls back to 60s default.
      const _ra = Math.max(1, parseInt(_r.headers.get('Retry-After') || '', 10) || 60);
      await new Promise(_res => setTimeout(_res, Math.min(_ra, 30) * 1000));
    }
    if (!_r.ok) {
      let _e = await _r.text();
      const _raw = _e;
      try { _e = JSON.parse(_e).detail || JSON.parse(_e).error?.message || _e; } catch {}
      // Always stderr-log the real status + body snippet so upstream's generic
      // "Unable to connect to API" doesn't mask chatgpt.com's actual rejection.
      // Also persist a rejection dump to /tmp/silly-debug so the failure is
      // post-mortem-able without needing SILLY_DEBUG_DUMP preset.
      try {
        const _snippet = (typeof _e === 'string' ? _e : JSON.stringify(_e)).slice(0, 500);
        console.error('[silly] /codex/responses ' + _r.status + ': ' + _snippet);
        const { mkdirSync, writeFileSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { join: _jRej } = await import('node:path');
        const _rd = _jRej(tmpdir(), 'silly-debug');
        mkdirSync(_rd, { recursive: true });
        const _stamp = new Date().toISOString().replace(/[:.]/g, '-');
        writeFileSync(_jRej(_rd, _stamp + '-codex-rejection.json'), JSON.stringify({
          ts: Date.now(), url: 'https://chatgpt.com/backend-api/codex/responses',
          status: _r.status, headers: Object.fromEntries(_r.headers),
          body_raw: _raw.slice(0, 4000), body_parsed: _e,
          req_model: _req.model, req_stream: _req.stream, req_tools_count: (_req.tools || []).length,
          req_input_len: JSON.stringify(_req.input || []).length,
        }, null, 2));
      } catch {}
      const _err = new Error('Codex API error ' + _r.status + ': ' + (typeof _e === 'string' ? _e.slice(0, 500) : JSON.stringify(_e).slice(0, 500)));
      _err.status = _r.status;
      throw _err;
    }
    if (_stream) return new Response(makeResponsesSseStream(_r, _b.model), { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    // Non-streaming caller: drain SSE stream into a static Anthropic response
    return collectResponsesSse(_r, _b.model);
  } else {
    // API key → Chat Completions
    const _om = mapModel(_b.model, _oaiModelTable);
    const _msgs = [];
    if (_b.system) _msgs.push({ role: 'system', content: flattenSystem(_b.system) });
    for (const m of (_b.messages || [])) _msgs.push(...msgToOai(m));
    const _req = { model: _om, messages: _msgs, stream: !!_b.stream, max_tokens: _b.max_tokens || 4096, temperature: _b.temperature != null ? _b.temperature : 1 };
    // Enable include_usage so the final SSE chunk carries prompt/completion tokens —
    // without it the adapter reports input_tokens:0 upstream, so Claude Code's vJ()
    // never sees the true context size and auto-compact never fires until chatgpt.com
    // itself rejects with "prompt is too long" (rendered as "Context limit reached").
    if (_b.stream) _req.stream_options = { include_usage: true };
    if (_fastTier) _req.service_tier = 'priority';
    if (_tools.length) {
      // Use the already-filtered _tools (same as Responses API path) so the
      // Chat Completions path doesn't leak CC-unusable tools (RemoteTrigger)
      // into GPT's tool list. Clean tool descriptions for the same reason as
      // the Responses API path above.
      _req.tools = _tools.map(t => ({ type: 'function', function: { name: t.name, description: _clean(t.description || ''), parameters: t.input_schema || { type: 'object', properties: {} } } }));
      _req.tool_choice = 'auto';
    }
    const _r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cred.headers },
      body: JSON.stringify(_req),
    });
    if (!_r.ok) { let _e = await _r.text(); try { _e = JSON.parse(_e).error?.message || _e; } catch {} throw new Error('OpenAI API error ' + _r.status + ': ' + _e); }
    if (_b.stream) return new Response(makeSseStream(_r, _b.model), { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    return oaiToAnthropicResponse(await _r.json(), _b.model);
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
    modelDisplayNames: Object.assign(
      Object.fromEntries(ALL_MODELS.map(m => [m.slug, m.display])),
      Object.fromEntries(Object.entries(CODEX_ALIASES).map(([a, s]) => [a, ALL_MODELS.find(m => m.slug === s).display])),
      { default: ALL_MODELS.find(m => m.slug === CODEX_ALIASES['claude-opus']).display }
    ),
  },
  models: { ...CODEX_ALIASES, default: CODEX_ALIASES['claude-opus'] },
  contextWindow: {
    default: 200000,
    perModel: Object.fromEntries(ALL_MODELS.map(m => [m.slug, m.ctx])),
  },
  tierNames: { max: 'ChatGPT Pro', pro: 'ChatGPT Plus', api: 'OpenAI API' },
  adapter: _openaiAdapter,
  auth: _openaiAuth,
  _injectableData: {
    _codexModelTable: Object.assign(
      {},
      CODEX_ALIASES,
      { 'claude-opus-4-6': CODEX_ALIASES['claude-opus'], 'claude-opus-4-6[1m]': CODEX_ALIASES['claude-opus'] },
      Object.fromEntries(CODEX_MODELS.map(m => [m.slug, m.slug])),
      { default: CODEX_ALIASES['claude-opus'] }
    ),
    _oauthMigrations: OAUTH_MODEL_MIGRATIONS,
  },
};
