/**
 * platform.cjs — Patches 50-51: Context window & output token adaptation
 *
 * Claude: 200K context (default), Codex/OpenAI: 128K, Copilot: ~32K.
 *
 * Upstream uses:
 *   pv() — context window: reads CLAUDE_CODE_MAX_CONTEXT_TOKENS (only when DISABLE_COMPACT=1)
 *   jo() — max output tokens: hardcoded per model family
 *   Hy1  — default context window (200000)
 *
 * We set correct env vars at startup AND patch the default for non-Claude providers.
 */

module.exports = function applyPlatform({ patch }) {
  // Patch 50: Context window adaptation via env vars
  // pv() reads CLAUDE_CODE_MAX_CONTEXT_TOKENS (requires DISABLE_COMPACT=1)
  // Must match AFTER patch 15 has already modified the '// Version: 2.1.100' line
  patch('50-context-window',
    '// Version: 2.1.100\n' +
    'if(!process.env.ANTHROPIC_DEFAULT_SONNET_MODEL)',
    '// Version: 2.1.100\n' +
    '(function(){' +
      'const _p=process.env.CLAUDE_CODE_USE_COPILOT?"copilot":process.env.CLAUDE_CODE_USE_OPENAI?"codex":null;' +
      'if(_p==="copilot"){' +
        'process.env.DISABLE_COMPACT=process.env.DISABLE_COMPACT||"1";' +
        'process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS=process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS||"30000";' +
      '}else if(_p==="codex"){' +
        'process.env.DISABLE_COMPACT=process.env.DISABLE_COMPACT||"1";' +
        'process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS=process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS||"120000";' +
      '}' +
    '})();\n' +
    'if(!process.env.ANTHROPIC_DEFAULT_SONNET_MODEL)'
  )

  // Patch 51: Default context window fallback
  // Hy1=200000 is the hardcoded default. For non-Claude providers, override at runtime.
  // This catches code paths that don't go through pv() env var check.
  patch('51-default-context',
    'Hy1=200000',
    'Hy1=(process.env.CLAUDE_CODE_USE_COPILOT?30000:process.env.CLAUDE_CODE_USE_OPENAI?120000:200000)'
  )
}
