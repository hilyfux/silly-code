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

// ── auth function ────────────────────────────────────────────────────────────
// Returns { headers, kind } where kind is 'oauth' or 'apikey'
// _openaiData is declared by the serialization engine as: let _openaiData = null;
async function _openaiAuth() {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const _dir = process.env.SILLY_CODE_DATA || join(process.env.HOME || '~', '.silly-code');
  if (!_openaiData) {
    // Try new filename first, fall back to legacy
    try {
      _openaiData = JSON.parse(readFileSync(join(_dir, 'codex-auth.json'), 'utf8'));
    } catch {
      try {
        _openaiData = JSON.parse(readFileSync(join(_dir, 'codex-oauth.json'), 'utf8'));
      } catch (e) {
        throw new Error('OpenAI: no auth token. Run: node pipeline/login.mjs codex');
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
    // JWT expired or unreadable — try refresh
    if (_openaiData.refresh_token) {
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
      } catch {}
    }
    return { headers: { 'Authorization': 'Bearer ' + _openaiData.access_token }, kind: 'oauth' };
  }

  // Not a JWT → API key path
  return { headers: { 'Authorization': 'Bearer ' + _openaiData.access_token }, kind: 'apikey' };
}

// ── adapter function ─────────────────────────────────────────────────────────
// Intercepts fetch calls from the upstream client and routes to OpenAI.
// References _openaiAuth (auth), mapModel, msgToOai, makeSseStream,
// msgsToResponsesInput, makeResponsesSseStream from _base.cjs
// all serialized into the same scope.
async function _openaiAdapter(url, init) {
  const _codexModelTable = { 'claude-opus': 'gpt-5.4', 'claude-sonnet': 'gpt-5.4', 'claude-haiku': 'gpt-5.3-codex', default: 'gpt-5.4' };
  const _oaiModelTable = { 'claude-opus': 'gpt-4o', 'claude-sonnet': 'gpt-4o', 'claude-haiku': 'gpt-4o-mini', default: 'gpt-4o' };

  const cred = await _openaiAuth();
  const _b = JSON.parse(init.body);

  if (cred.kind === 'oauth') {
    // ChatGPT OAuth → Responses API
    const _om = mapModel(_b.model, _codexModelTable);
    const _sysText = flattenSystem(_b.system);
    const _input = msgsToResponsesInput(null, _b.messages);
    const _req = { model: _om, instructions: _sysText || 'You are a helpful coding assistant.', input: _input, store: false, stream: true };
    if (_b.tools && _b.tools.length) {
      _req.tools = _b.tools.map(t => ({ type: 'function', name: t.name, description: t.description || '', parameters: t.input_schema || { type: 'object', properties: {} } }));
    }
    const _r = await fetch('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cred.headers },
      body: JSON.stringify(_req),
    });
    if (!_r.ok) { const _e = await _r.text(); throw new Error('Codex API error ' + _r.status + ': ' + _e); }
    return new Response(makeResponsesSseStream(_r, _b.model), { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  } else {
    // API key → Chat Completions
    const _om = mapModel(_b.model, _oaiModelTable);
    const _msgs = [];
    if (_b.system) _msgs.push({ role: 'system', content: flattenSystem(_b.system) });
    for (const m of (_b.messages || [])) _msgs.push(...msgToOai(m));
    const _req = { model: _om, messages: _msgs, stream: !!_b.stream, max_tokens: _b.max_tokens || 4096, temperature: _b.temperature != null ? _b.temperature : 1 };
    if (_b.tools && _b.tools.length) {
      _req.tools = _b.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.input_schema || { type: 'object', properties: {} } } }));
      _req.tool_choice = 'auto';
    }
    const _r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cred.headers },
      body: JSON.stringify(_req),
    });
    if (!_r.ok) { const _e = await _r.text(); throw new Error('OpenAI API error ' + _r.status + ': ' + _e); }
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
    modelDisplayNames: {
      'gpt-5.4-mini': 'GPT 5.4 Mini', 'gpt-5.4': 'GPT 5.4', 'gpt-5.3-codex': 'GPT 5.3 Codex',
      'gpt-4o-mini': 'GPT 4o Mini', 'gpt-4o': 'GPT 4o', 'o3': 'o3',
      'claude-opus': 'GPT 5.4', 'claude-sonnet': 'GPT 5.4', 'claude-haiku': 'GPT 5.3 Codex',
      default: 'GPT 5.4',
    },
  },
  models: { 'claude-opus': 'gpt-5.4', 'claude-sonnet': 'gpt-5.4', 'claude-haiku': 'gpt-5.3-codex', default: 'gpt-5.4' },
  contextWindow: { default: 120000, perModel: {} },
  tierNames: { max: 'ChatGPT Pro', pro: 'ChatGPT Plus', api: 'OpenAI API' },
  adapter: _openaiAdapter,
  auth: _openaiAuth,
};
