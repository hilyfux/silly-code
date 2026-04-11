/**
 * copilot.cjs — Provider config for GitHub Copilot
 *
 * Single-mode: GitHub OAuth → Chat Completions at api.githubcopilot.com
 *
 * adapter and auth are serialized as strings (.toString()) and injected
 * into the upstream binary's client factory scope. All rules apply:
 *   - NO require() — use await import('node:...')
 *   - NO module/exports/__dirname/__filename
 *   - Functions reference each other by name (auth is called _copilotAuth)
 *   - Per-provider state variable (_copilotData) is declared by the engine
 */

// ── auth function ────────────────────────────────────────────────────────────
// Returns { headers, kind } where headers includes all required Copilot headers.
// _copilotData is declared by the serialization engine as: let _copilotData = null;
async function _copilotAuth() {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const _dir = process.env.SILLY_CODE_DATA || join(process.env.HOME || '~', '.silly-code');
  const _hdrs = (tok) => ({ 'Authorization': 'Bearer ' + tok, 'Copilot-Integration-Id': 'vscode-chat', 'Editor-Version': 'vscode/1.85.0' });
  if (!_copilotData) {
    try {
      _copilotData = JSON.parse(readFileSync(join(_dir, 'copilot-auth.json'), 'utf8'));
    } catch {
      try {
        _copilotData = JSON.parse(readFileSync(join(_dir, 'copilot-oauth.json'), 'utf8'));
      } catch (e) {
        throw new Error('Copilot: no auth token. Run: silly login copilot');
      }
    }
  }

  if (!_copilotData.githubToken) throw new Error('Copilot: auth file missing githubToken. Re-run: silly login copilot');

  // Return cached Copilot API token if still valid (60s buffer)
  if (_copilotData.copilotToken && _copilotData.copilotExpiresAt && Date.now() < _copilotData.copilotExpiresAt - 60000) {
    return { headers: _hdrs(_copilotData.copilotToken), kind: 'oauth' };
  }

  // Refresh Copilot API token using GitHub OAuth token (with concurrency lock)
  if (!_copilotData._refreshP) {
    _copilotData._refreshP = (async () => {
      try {
        const _r = await fetch('https://api.github.com/copilot_internal/v2/token', {
          method: 'GET',
          headers: _hdrs(_copilotData.githubToken),
        });
        if (!_r.ok) throw new Error('Copilot token refresh failed: ' + _r.status);
        const _d = await _r.json();
        _copilotData.copilotToken = _d.token;
        _copilotData.copilotExpiresAt = (_d.expires_at || 0) * 1000;
        try { writeFileSync(join(_dir, 'copilot-auth.json'), JSON.stringify(_copilotData)); } catch {}
      } catch (e) { console.error('[silly] Copilot token refresh failed:', e.message || e); throw e; }
      finally { _copilotData._refreshP = null; }
    })();
  }
  await _copilotData._refreshP;

  return { headers: _hdrs(_copilotData.copilotToken), kind: 'oauth' };
}

// ── adapter function ─────────────────────────────────────────────────────────
// Intercepts fetch calls from the upstream client and routes to Copilot.
// References _copilotAuth (auth), mapModel, msgToOai, makeSseStream
// all serialized into the same scope.
async function _copilotAdapter(url, init) {
  const _copilotModelTable = { 'claude-opus': 'gpt-4o', 'claude-sonnet': 'gpt-4o', 'claude-haiku': 'gpt-4o-mini', default: 'gpt-4o' };

  const cred = await _copilotAuth();
  const _b = JSON.parse(init.body);
  const _msgs = [];
  if (_b.system) _msgs.push({ role: 'system', content: flattenSystem(_b.system) });
  for (const m of (_b.messages || [])) _msgs.push(...msgToOai(m));
  const _om = mapModel(_b.model, _copilotModelTable);
  const _req = { model: _om, messages: _msgs, stream: !!_b.stream, max_tokens: _b.max_tokens || 4096 };
  if (_b.tools && _b.tools.length) {
    _req.tools = _b.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.input_schema || { type: 'object', properties: {} } } }));
    _req.tool_choice = 'auto';
  }
  const _r = await fetch('https://api.githubcopilot.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cred.headers },
    body: JSON.stringify(_req),
  });
  if (!_r.ok) { const _e = await _r.text(); throw new Error('Copilot API error ' + _r.status + ': ' + _e); }
  if (_b.stream) return new Response(makeSseStream(_r, _b.model), { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  return oaiToAnthropicResponse(await _r.json(), _b.model);
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
      'gpt-4o-mini': 'GPT 4o Mini (Copilot)', 'gpt-4o': 'GPT 4o (Copilot)', 'o3': 'o3 (Copilot)',
      'claude-opus': 'GPT 4o (Copilot)', 'claude-sonnet': 'GPT 4o (Copilot)', 'claude-haiku': 'GPT 4o Mini (Copilot)',
      default: 'GPT 4o (Copilot)',
    },
  },
  models: { 'claude-opus': 'gpt-4o', 'claude-sonnet': 'gpt-4o', 'claude-haiku': 'gpt-4o-mini', default: 'gpt-4o' },
  contextWindow: { default: 30000, perModel: {} },
  tierNames: { max: 'Copilot Pro', pro: 'Copilot', api: 'Copilot API' },
  adapter: _copilotAdapter,
  auth: _copilotAuth,
};
