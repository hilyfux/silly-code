/**
 * auth-bypass.cjs — Patches 70-79: Non-Claude provider auth isolation
 *
 * Claude Code's startup performs connectivity checks and auth validation
 * against api.anthropic.com BEFORE the provider adapter is injected.
 * For OpenAI (Codex), these checks will always fail because there are no
 * Anthropic credentials — causing the entire TUI to hang on "Unable to
 * connect to API" with 10 retries.
 *
 * This module bypasses those checks when a non-Claude provider is active,
 * letting the adapter handle all API communication.
 */

module.exports = function applyAuthBypass({ patch }) {
  // Patch 70: Skip connectivity pre-flight check for non-Claude providers.
  // Upstream's preflight fn (Zi5 on darwin 2.1.114) GETs BASE_API_URL/api/hello
  // and TOKEN_URL/v1/oauth/hello — these require Anthropic credentials and
  // would hang the TUI for 10 retries on non-Claude auth. Short-circuit when
  // the provider env flag is set.
  //
  // Iter 61 refactor (Iter 20 discipline): every identifier in the FIND side
  // is a ([\w$]+) capture threaded into the REPLACE side, so:
  //   (a) ci-upgrade.cjs's word-boundary rewrites can't silently corrupt this
  //       patch when a bare token (e.g. `t8` in source) coincides with a
  //       varmap VALUE on a different platform (darwin t8=isSubscriber vs
  //       linux t8=reactLaneNode — see memory/project-patch-source-token-
  //       collisions.md and memory/project-platform-bundle-divergence.md).
  //   (b) The same patch survives upstream version bumps that rename the
  //       preflight outer fn or the oauth-config helper, as long as the AST
  //       structure (function X(){try{let H=F(),_=new URL(H.TOKEN_URL)…}) is
  //       preserved.
  // Uniqueness verified: this regex matches exactly one site in upstream
  // 2.1.114 darwin cli.js (probe in Iter 61).
  patch('70-connectivity-bypass',
    /function ([A-Za-z_$][\w$]*)\(\)\{try\{let ([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\),([A-Za-z_$][\w$]*)=new URL\(\2\.TOKEN_URL\)/,
    'function $1(){if(process.env.CLAUDE_CODE_USE_OPENAI)return Promise.resolve({success:!0});try{let $2=$3(),$4=new URL($2.TOKEN_URL)'
  )
}
