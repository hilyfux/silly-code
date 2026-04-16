/**
 * auth-bypass.cjs — Patches 70-79: Non-Claude provider auth isolation
 *
 * Claude Code's startup performs connectivity checks and auth validation
 * against api.anthropic.com BEFORE the provider adapter is injected.
 * For non-Claude providers (OpenAI, Copilot), these checks will always
 * fail because there are no Anthropic credentials — causing the entire
 * TUI to hang on "Unable to connect to API" with 10 retries.
 *
 * This module bypasses those checks when a non-Claude provider is active,
 * letting the adapter handle all API communication.
 */

module.exports = function applyAuthBypass({ patch }) {
  // Patch 70: Skip connectivity pre-flight check for non-Claude providers
  // O2A() is called on startup to verify api.anthropic.com reachability.
  // It GETs BASE_API_URL/api/hello and TOKEN_URL/v1/oauth/hello.
  // These endpoints are unreachable without Anthropic credentials.
  // When adapter env vars are set, return {success:true} immediately.
  patch('70-connectivity-bypass',
    'function O2A(){try{let q=r7()',
    'function O2A(){if(process.env.CLAUDE_CODE_USE_OPENAI||process.env.CLAUDE_CODE_USE_COPILOT)return Promise.resolve({success:!0});try{let q=r7()'
  )
}
