/**
 * branding.cjs — Patches 01-05: silly-code branding
 *
 * Replaces upstream Anthropic branding with silly-code identity.
 */

module.exports = function applyBranding({ patch, patchAll, sillyVersionSuffix }) {
  // ── firstParty guard helpers ─────────────────────────────────
  // Identity strings (patches 06b/08/08a/08b/09*/11a-d) must stay byte-identical
  // to upstream for firstParty (sillye → Claude) to avoid identity bleed, while
  // still showing silly-code branding for non-firstParty providers. Three emit
  // shapes depending on the surrounding JS context:
  //
  //   fp(orig, silly)     — template-literal fragment, no inner interpolations.
  //                         Emits `${cond?"orig":"silly"}` (DQ ternary inside ${…}).
  //   fpTmpl(orig, silly) — template-literal fragment WITH inner ${…} interpolations.
  //                         Emits `${cond?\`orig\`:\`silly\`}` (nested backticks so
  //                         ${H}, ${hf8.opus} etc. evaluate in the outer scope).
  //   fpExpr(orig, silly) — standalone string literal ("…" or '…') in expression
  //                         position (array element / fn argument). FIND must
  //                         include the enclosing quotes; emits (cond?"orig":"silly").
  //
  // All three use the same probe: `typeof uq==="function"&&uq()==="firstParty"`.
  // Same shape as patches 61/63a/65 in provider-identity.cjs.
  const _probe = '(typeof uq==="function"&&uq()==="firstParty")';
  const fp = (orig, silly) =>
    '${' + _probe + '?' + JSON.stringify(orig) + ':' + JSON.stringify(silly) + '}';
  const fpTmpl = (orig, silly) =>
    '${' + _probe + '?`' + orig + '`:`' + silly + '`}';
  const fpExpr = (orig, silly) =>
    '(' + _probe + '?' + JSON.stringify(orig) + ':' + JSON.stringify(silly) + ')';

  // Build-time git SHA embedded: `sillyx --version` → "2.1.114-silly.<sha>"
  // This makes dev and installed binaries immediately distinguishable.
  const _ver = `2.1.114-${sillyVersionSuffix || 'silly'}`
  patchAll('01-version',
    'VERSION:"2.1.114"',
    `VERSION:"${_ver}"`
  )

  patchAll('02-package-url',
    'PACKAGE_URL:"@anthropic-ai/claude-code"',
    'PACKAGE_URL:"silly-code"'
  )

  patchAll('03-feedback',
    'FEEDBACK_CHANNEL:"https://github.com/anthropics/claude-code/issues"',
    'FEEDBACK_CHANNEL:"https://github.com/hilyfux/silly-code/issues"'
  )

  patchAll('04-readme-url',
    'README_URL:"https://code.claude.com/docs/en/overview"',
    'README_URL:"https://github.com/hilyfux/silly-code"'
  )

  patchAll('05-issues',
    'ISSUES_EXPLAINER:"report the issue at https://github.com/anthropics/claude-code/issues"',
    'ISSUES_EXPLAINER:"report the issue at https://github.com/hilyfux/silly-code/issues"'
  )

  // Suppress upstream npm-to-native-installer deprecation banner
  patch('06-no-npm-deprecation',
    'Claude Code has switched from npm to native installer. Run `claude install` or see https://docs.anthropic.com/en/docs/claude-code/getting-started for more options.',
    ''
  )

  // Patch 06b: TUI header title — "Claude Code v..." → "Silly Code v...",
  // but firstParty (sillye) keeps "Claude Code" byte-identical.
  patch('06b-header-title',
    'title:`Claude Code v$',
    'title:`' + fp('Claude Code', 'Silly Code') + ' v$'
  )

  // Patch 07: Mascot color — warm red → vibrant teal/green (silly & cute)
  // RGB theme colors (light/dark/dimmed/high-contrast)
  patchAll('07-mascot-color',
    'clawd_body:"rgb(215,119,87)"',
    'clawd_body:"rgb(72,209,176)"'
  )

  // ANSI fallback colors
  patchAll('07a-mascot-ansi',
    'clawd_body:"ansi:redBright"',
    'clawd_body:"ansi:greenBright"'
  )

  // Patch 08: Environment section — Claude model family info
  // This leaks Claude model IDs into the system prompt for non-firstParty
  // providers. firstParty (sillye) keeps the upstream text with inner
  // ${hf8.*} interpolations; non-firstParty sees the trimmed variant.
  patch('08-model-family',
    'The most recent Claude model family is Claude 4.X. Model IDs — Opus 4.7: \'${hf8.opus}\', Sonnet 4.6: \'${hf8.sonnet}\', Haiku 4.5: \'${hf8.haiku}\'. When building AI applications, default to the latest and most capable Claude models.',
    fpTmpl(
      'The most recent Claude model family is Claude 4.X. Model IDs — Opus 4.7: \'${hf8.opus}\', Sonnet 4.6: \'${hf8.sonnet}\', Haiku 4.5: \'${hf8.haiku}\'. When building AI applications, default to the latest and most capable Claude models.',
      'The most recent model family is Claude 4.6 and 4.5. When building AI applications, default to the latest and most capable models.'
    )
  )

  // Patch 08a: Environment section — "Claude Code is available as a CLI".
  // Full DQ literal swap → expression: firstParty keeps original, silly gets trimmed.
  patch('08a-cli-description',
    '"Claude Code is available as a CLI in the terminal, desktop app (Mac/Windows), web app (claude.ai/code), and IDE extensions (VS Code, JetBrains)."',
    fpExpr(
      'Claude Code is available as a CLI in the terminal, desktop app (Mac/Windows), web app (claude.ai/code), and IDE extensions (VS Code, JetBrains).',
      'Silly Code is available as a CLI in the terminal.'
    )
  )

  // Patch 08b: Environment section — "Fast mode for Claude Code".
  // Full DQ literal swap → expression: firstParty keeps original, silly sees rebrand.
  patch('08b-fast-mode',
    '"Fast mode for Claude Code uses Claude Opus 4.6 with faster output (it does not downgrade to a smaller model). It can be toggled with /fast and is only available on Opus 4.6."',
    fpExpr(
      'Fast mode for Claude Code uses Claude Opus 4.6 with faster output (it does not downgrade to a smaller model). It can be toggled with /fast and is only available on Opus 4.6.',
      'Fast mode for Silly Code uses Claude Opus 4.6 with faster output (it does not downgrade to a smaller model). It can be toggled with /fast and is only available on Opus 4.6.'
    )
  )

  // ── Patches 09*: subagent / tool-result identity, firstParty-guarded ──
  // Every identity string below is substring-replaced inside an upstream
  // backtick template literal. The replacement keeps the surrounding text
  // intact and inserts a `${cond?"orig":"silly"}` interpolation so sillye
  // (firstParty) sees the upstream text byte-identical while non-firstParty
  // providers see silly-code branding. See fp/fpTmpl helpers at top.

  // Patch 09: Sub-agent identity — file search specialist
  patch('09-search-agent-identity',
    'You are a file search specialist for Claude Code, Anthropic\'s official CLI for Claude.',
    fp(
      'You are a file search specialist for Claude Code, Anthropic\'s official CLI for Claude.',
      'You are a file search specialist for Silly Code, a multi-provider AI coding assistant.'
    )
  )

  // Patch 09a: Sub-agent identity — general agent.
  // Two occurrences, each a FULL DQ string literal (NOT backtick template):
  //   1. `return\`${"…"}\`` — DQ inside template interpolation
  //   2. `DY7="…"` — DQ variable assignment
  // Both need fpExpr (expression swap), not fp (template interpolation),
  // because inside a DQ string literal \${…} is literal text, not interpolation.
  // The two strings differ in length, so we patch them separately.
  const _09aShort = 'You are an agent for Claude Code, Anthropic\'s official CLI for Claude. Given the user\'s message, you should use the tools available to complete the task. Complete the task fully—don\'t gold-plate, but don\'t leave it half-done.'
  const _09aLong  = _09aShort + ' When you complete the task, respond with a concise report covering what was done and any key findings — the caller will relay this to the user, so it only needs the essentials.'
  const _09aShortSilly = 'You are an agent for Silly Code, a multi-provider AI coding assistant. Given the user\'s message, you should use the tools available to complete the task. Complete the task fully—don\'t gold-plate, but don\'t leave it half-done.'
  const _09aLongSilly = _09aShortSilly + ' When you complete the task, respond with a concise report covering what was done and any key findings — the caller will relay this to the user, so it only needs the essentials.'
  patch('09a-general-agent-identity-short',
    '"' + _09aShort + '"',
    fpExpr(_09aShort, _09aShortSilly)
  )
  patch('09a-general-agent-identity-long',
    '"' + _09aLong + '"',
    fpExpr(_09aLong, _09aLongSilly)
  )

  // Patch 09b: Plan agent identity
  patch('09b-plan-agent-identity',
    'You are a software architect and planning specialist for Claude Code. Your role is to explore the codebase and design implementation plans.',
    fp(
      'You are a software architect and planning specialist for Claude Code. Your role is to explore the codebase and design implementation plans.',
      'You are a software architect and planning specialist for Silly Code. Your role is to explore the codebase and design implementation plans.'
    )
  )

  // Patch 09i: Auto-mode classifier reviewer
  patch('09i-classifier-reviewer-identity',
    'You are an expert reviewer of auto mode classifier rules for Claude Code.',
    fp(
      'You are an expert reviewer of auto mode classifier rules for Claude Code.',
      'You are an expert reviewer of auto mode classifier rules for Silly Code.'
    )
  )

  // Patch 09j: Hook condition evaluator
  patch('09j-hook-condition-identity',
    'You are evaluating a hook condition in Claude Code.',
    fp(
      'You are evaluating a hook condition in Claude Code.',
      'You are evaluating a hook condition in Silly Code.'
    )
  )

  // Patch 09k: Stop-condition hook evaluator
  patch('09k-stop-hook-identity',
    'You are evaluating a stop-condition hook in Claude Code.',
    fp(
      'You are evaluating a stop-condition hook in Claude Code.',
      'You are evaluating a stop-condition hook in Silly Code.'
    )
  )

  // Patch 09l: Stop condition verifier
  patch('09l-stop-verifier-identity',
    'You are verifying a stop condition in Claude Code.',
    fp(
      'You are verifying a stop condition in Claude Code.',
      'You are verifying a stop condition in Silly Code.'
    )
  )

  // Patch 09m: Onboarding guide generator
  patch('09m-onboarding-identity',
    'You are helping a power user generate an onboarding guide for teammates who are new to Claude Code.',
    fp(
      'You are helping a power user generate an onboarding guide for teammates who are new to Claude Code.',
      'You are helping a power user generate an onboarding guide for teammates who are new to Silly Code.'
    )
  )

  // Patch 09n: Remote agent scheduler
  patch('09n-remote-agent-identity',
    'You are helping the user schedule, update, list, or run **remote** Claude Code agents.',
    fp(
      'You are helping the user schedule, update, list, or run **remote** Claude Code agents.',
      'You are helping the user schedule, update, list, or run **remote** Silly Code agents.'
    )
  )

  // Patch 09o: Session search agent
  patch('09o-session-search-identity',
    'You are searching for past Claude Code conversation sessions on behalf of the user.',
    fp(
      'You are searching for past Claude Code conversation sessions on behalf of the user.',
      'You are searching for past Silly Code conversation sessions on behalf of the user.'
    )
  )

  // Patch 09p: Memory selector agent
  patch('09p-memory-selector-identity',
    'You are selecting memories that will be useful to Claude Code as it processes',
    fp(
      'You are selecting memories that will be useful to Claude Code as it processes',
      'You are selecting memories that will be useful to Silly Code as it processes'
    )
  )

  // 09b skipped: CWD context is part of SIMPLE_ID match, handled by patch 63a in provider-engine.cjs

  // Patch 09c: Verification agent — "You are Claude, and you are bad".
  // Inside a backtick template, so use fp() — firstParty keeps "You are Claude",
  // non-firstParty sees "You are the AI model".
  patch('09c-verification-identity',
    'You are Claude, and you are bad at verification.',
    fp(
      'You are Claude, and you are bad at verification.',
      'You are the AI model, and you are bad at verification.'
    )
  )

  // Patch 09d: Status line setup agent system prompt
  patch('09d-statusline-agent-identity',
    'You are a status line setup agent for Claude Code. Your job is to create or update the statusLine command in the user\'s Claude Code settings.',
    fp(
      'You are a status line setup agent for Claude Code. Your job is to create or update the statusLine command in the user\'s Claude Code settings.',
      'You are a status line setup agent for Silly Code. Your job is to create or update the statusLine command in the user\'s Silly Code settings.'
    )
  )

  // Patch 09e: Claude guide agent — explains Claude Code/SDK/API to users.
  // For non-firstParty providers, this agent is less useful but keep it
  // functional; just replace identity phrasing so the agent doesn't claim
  // to be running as Claude Code when it isn't. firstParty stays byte-identical.
  patch('09e-guide-agent-identity',
    'You are the Claude guide agent. Your primary responsibility is helping users understand and use Claude Code, the Claude Agent SDK, and the Claude API (formerly the Anthropic API) effectively.',
    fp(
      'You are the Claude guide agent. Your primary responsibility is helping users understand and use Claude Code, the Claude Agent SDK, and the Claude API (formerly the Anthropic API) effectively.',
      'You are the Silly Code guide agent. Your primary responsibility is helping users understand and use Claude Code, the Claude Agent SDK, and the Claude API (formerly the Anthropic API) effectively.'
    )
  )

  // Patch 09f: WebFetch tool error — leaks "Claude Code" into tool result.
  // Inside a backtick template WITH ${H} interpolation → use fpTmpl so the
  // nested backticks preserve ${H} evaluation on both branches.
  patch('09f-webfetch-error',
    'Claude Code is unable to fetch from ${H}',
    fpTmpl(
      'Claude Code is unable to fetch from ${H}',
      'Silly Code is unable to fetch from ${H}'
    )
  )

  // Patch 09g: BashTool security warning — leaks "Claude Code" into tool result.
  // Inside a backtick template WITH ${H} interpolation → fpTmpl.
  patch('09g-bash-validate-warning',
    'security, Claude Code cannot automatically validate ${H} commands',
    fpTmpl(
      'security, Claude Code cannot automatically validate ${H} commands',
      'security, Silly Code cannot automatically validate ${H} commands'
    )
  )

  // Patch 09h: BashTool cd warning — leaks "Claude Code" into tool result.
  // This lives inside a DQ string literal (not a template), so we swap the
  // ENTIRE quoted string for an (cond?"orig":"silly") expression via fpExpr.
  patch('09h-bash-cd-warning',
    '"Commands that change directories and perform write operations require explicit approval to ensure paths are evaluated correctly. For security, Claude Code cannot automatically determine the final working directory when \'cd\' is used in compound commands."',
    fpExpr(
      'Commands that change directories and perform write operations require explicit approval to ensure paths are evaluated correctly. For security, Claude Code cannot automatically determine the final working directory when \'cd\' is used in compound commands.',
      'Commands that change directories and perform write operations require explicit approval to ensure paths are evaluated correctly. For security, Silly Code cannot automatically determine the final working directory when \'cd\' is used in compound commands.'
    )
  )

  // Patch 10a: TUI header brand name variable
  patch('10a-header-brand-var',
    'var Ya9="Claude Code"',
    'var Ya9="Silly Code"'
  )

  // Patch 10b: TUI header themed render — status bar "Claude Code vX.X.X"
  patch('10b-header-themed-render',
    'o8("claude",HH)("Claude Code")',
    'o8("claude",HH)("Silly Code")'
  )

  // Patch 10c: TUI header bold render — cache sentinel fallback
  patch('10c-header-bold-render',
    'bold:!0},"Claude Code"',
    'bold:!0},"Silly Code"'
  )

  // Patch 10d: MCP client info — title in LSP/MCP handshake
  patchAll('10d-mcp-client-title',
    'title:"Claude Code"',
    'title:"Silly Code"'
  )

  // Patch 10e: MCP client info — name field
  patchAll('10e-mcp-client-name',
    'name:"Claude Code"',
    'name:"Silly Code"'
  )

  // Patch 10f: MCP display name fallback
  patch('10f-mcp-display-fallback',
    '"claudeai-proxy"?"claude.ai":"Claude Code"',
    '"claudeai-proxy"?"claude.ai":"Silly Code"'
  )

  // Patch 10g: Agent name fallback in TUI header
  patch('10g-agent-name-fallback',
    '??"Claude Code"',
    '??"Silly Code"'
  )

  // Patch 10h: First-run permission prompt
  patch('10h-first-run-prompt',
    'null,"Claude Code","\'","ll be able to read',
    'null,"Silly Code","\'","ll be able to read'
  )

  // Patch 11a: Image tool description — leaks brand into system prompt.
  // Inside a backtick template (see tool description assembly) → fp().
  patch('11a-multimodal-desc',
    'are presented visually as Claude Code is a multimodal LLM',
    fp(
      'are presented visually as Claude Code is a multimodal LLM',
      'are presented visually as the assistant is a multimodal LLM'
    )
  )

  // Patch 11b: think-back session extractor prompt — leaks brand to LLM.
  // Inside a backtick template → fp().
  patch('11b-think-back-session',
    'Analyze this Claude Code session and extract structured',
    fp(
      'Analyze this Claude Code session and extract structured',
      'Analyze this session and extract structured'
    )
  )

  // Patch 11c: think-back usage-data analyzer prompts (7 occurrences).
  // All inside backtick templates → fp(). patchAll emits the same ${…} at each site.
  patchAll('11c-think-back-usage',
    'Analyze this Claude Code usage data',
    fp(
      'Analyze this Claude Code usage data',
      'Analyze this usage data'
    )
  )

  // Patch 11d: Bug report template — leaks brand into LLM context.
  // Full DQ literal (array element) → fpExpr swaps the whole string.
  patch('11d-bug-report-template',
    '"Claude Code is an agentic coding CLI based on the Anthropic API."',
    fpExpr(
      'Claude Code is an agentic coding CLI based on the Anthropic API.',
      'Silly Code is an agentic coding CLI based on a multi-provider backend.'
    )
  )

  // Patch 11e: Bug report header text (user-facing)
  patchAll('11e-bug-report-header',
    'bug report for Claude Code',
    'bug report for Silly Code'
  )

  // Patch 11f: Restart prompts (4 occurrences, user-facing UI)
  patchAll('11f-restart-text',
    'restart Claude Code',
    'restart Silly Code'
  )

  // Patch 11g: Stats loader label
  patch('11g-stats-loader',
    'Loading your Claude Code stats…',
    'Loading your Silly Code stats…'
  )

  // Patch 11h: Changes-review UI bullet
  patch('11h-changes-review',
    "Review Claude Code's changes",
    "Review Silly Code's changes"
  )

  // Patches 12a-f: Silly-blob face — swap blocky robot eyes for expressive
  // 5-char emoticon faces. The pose axis (default / look-L / look-R / arms-up)
  // already carries direction via arm glyphs, so arms-up reuses the default
  // face for simplicity. Both NuY (standard) and EuY (Apple Terminal) get it.
  patchAll('12a-mascot-eyes-default',
    'r1E:"▛███▜"',
    'r1E:"(o_o)"'
  )
  patch('12b-mascot-eyes-look-left',
    'r1E:"▟███▟"',
    'r1E:"(<_<)"'
  )
  patch('12c-mascot-eyes-look-right',
    'r1E:"▙███▙"',
    'r1E:"(>_>)"'
  )
  patchAll('12d-mascot-apple-default',
    '" ▗   ▖ "',
    '" (o_o) "'
  )
  patch('12e-mascot-apple-look-left',
    '" ▘   ▘ "',
    '" (<_<) "'
  )
  patch('12f-mascot-apple-look-right',
    '" ▝   ▝ "',
    '" (>_>) "'
  )

  // Patch 14a: Hide OAuth org name in welcome card for non-firstParty.
  // OpenAI users get the email-shaped orgName from their upstream provider
  // ("user@x.com's Organization") — exposing it in the welcome card is an
  // identity leak under our purity contract.
  patch('14a-welcome-hide-org-non-firstParty',
    '!process.env.IS_DEMO&&D.oauthAccount?.organizationName&&h8.createElement',
    '!process.env.IS_DEMO&&M.oauthAccount?.organizationName&&(typeof gq!=="function"||gq()==="firstParty")&&V7.createElement'
  )

  // Patch 14b: Don't inject user's email into agent system prompt for non-firstParty.
  // Upstream appends `The user's email address is X` to the prompt as user context.
  // For non-Claude providers, this leaks account email into the conversation.
  patch('14b-agent-prompt-hide-email',
    "let K=S5()?.emailAddress;return{...q&&{claudeMd:q},...K&&{userEmail:`The user's email address is",
    "let K=(typeof gq==='function'&&gq()!=='firstParty')?null:S5()?.emailAddress;return{...q&&{claudeMd:q},...K&&{userEmail:`The user's email address is"
  )

  // Patches 13a-l: Multi-color mascot — saturated rainbow plushie
  // Aesthetic: 90s plush toy — bold pastels, intentional L/R asymmetry
  // (different arm/foot colors like a hand-sewn creature), deep indigo belly
  // for self-glow depth. Navy eyes on soft pink face for kawaii expression.
  // 14 distinct color uses across 1 creature, harmonized via rainbow order
  // (pink-magenta → orange-gold → emerald → sky → violet).
  const PINK_FACE = '#fbcfe8'  // face bg (kept pastel so navy eyes contrast)
  const NAVY = '#1e1b4b'       // eye text
  const ROSE = '#f472b6'       // r1L (left head-arm)
  const ORANGE = '#fb923c'     // r1R (right head-arm)
  const EMERALD = '#10b981'    // r2L (left leg), body-block #4
  const VIOLET = '#8b5cf6'     // r2R (right leg), right feet
  const INDIGO_BG = '#312e81'  // body-bar background (deep belly)
  // Names are 5+ chars (not ≤3) to avoid collision with any
  // mangled minified varmap value — see Iter 57/58 memory +
  // docs/superpowers/plans/2026-04-23-darwin-varmap-gap-audit.md
  // (previous `B2` collided with linux varmap `isCronEnabled_func`).
  const BLOCK_1 = '#ec4899'    // body block 1 — magenta
  const BLOCK_2 = '#f97316'    // body block 2 — orange
  const BLOCK_3 = '#eab308'    // body block 3 — gold
  const BLOCK_4 = '#10b981'    // body block 4 — emerald (= EMERALD)
  const BLOCK_5 = '#0ea5e9'    // body block 5 — sky
  const FOOT_L = '#ec4899'     // left feet (matches block 1)

  // NuY (standard render, 7 spans)
  patch('13a-mascot-r1L',
    'createElement(L,{color:"clawd_body"},T.r1L)',
    `createElement(L,{color:"${ROSE}"},T.r1L)`
  )
  patch('13b-mascot-r1E-face',
    'createElement(L,{color:"clawd_body",backgroundColor:"clawd_background"},T.r1E)',
    `createElement(L,{color:"${NAVY}",backgroundColor:"${PINK_FACE}"},T.r1E)`
  )
  patch('13c-mascot-r1R',
    'createElement(L,{color:"clawd_body"},T.r1R)',
    `createElement(L,{color:"${ORANGE}"},T.r1R)`
  )
  patch('13d-mascot-r2L',
    'createElement(L,{color:"clawd_body"},T.r2L)',
    `createElement(L,{color:"${EMERALD}"},T.r2L)`
  )
  // Body bar: split "█████" into 5 individually-colored blocks on indigo.
  patch('13e-mascot-body-bar',
    'createElement(L,{color:"clawd_body",backgroundColor:"clawd_background"},"█████")',
    `createElement(L,{backgroundColor:"${INDIGO_BG}"},` +
      `t3.createElement(L,{color:"${BLOCK_1}"},"█"),` +
      `t3.createElement(L,{color:"${BLOCK_2}"},"█"),` +
      `t3.createElement(L,{color:"${BLOCK_3}"},"█"),` +
      `t3.createElement(L,{color:"${BLOCK_4}"},"█"),` +
      `t3.createElement(L,{color:"${BLOCK_5}"},"█")` +
    `)`
  )
  patch('13f-mascot-r2R',
    'createElement(L,{color:"clawd_body"},T.r2R)',
    `createElement(L,{color:"${VIOLET}"},T.r2R)`
  )
  // Feet: split "▘▘ ▝▝" so L-pair and R-pair render in different colors
  // (pink ▘▘ + violet ▝▝) — asymmetric hand-sewn plushie feel.
  patch('13g-mascot-feet',
    'createElement(L,{color:"clawd_body"},"  ","▘▘ ▝▝","  ")',
    `createElement(L,null,` +
      `t3.createElement(L,null,"  "),` +
      `t3.createElement(L,{color:"${FOOT_L}"},"▘▘"),` +
      `t3.createElement(L,null," "),` +
      `t3.createElement(L,{color:"${VIOLET}"},"▝▝"),` +
      `t3.createElement(L,null,"  ")` +
    `)`
  )

  // yuY (Apple Terminal variant, 5 spans — anchored via Symbol.for prefix)
  patch('13h-mascot-apple-left',
    'Symbol.for("react.memo_cache_sentinel"))K=t3.createElement(L,{color:"clawd_body"},"▗")',
    `Symbol.for("react.memo_cache_sentinel"))K=t3.createElement(L,{color:"${ROSE}"},"▗")`
  )
  patch('13i-mascot-apple-face',
    '!==O)T=t3.createElement(L,{color:"clawd_background",backgroundColor:"clawd_body"},O)',
    `!==O)T=t3.createElement(L,{color:"${NAVY}",backgroundColor:"${PINK_FACE}"},O)`
  )
  patch('13j-mascot-apple-right',
    'Symbol.for("react.memo_cache_sentinel"))$=t3.createElement(L,{color:"clawd_body"},"▖")',
    `Symbol.for("react.memo_cache_sentinel"))$=t3.createElement(L,{color:"${ORANGE}"},"▖")`
  )
  // Apple body bar: the original `" ".repeat(7)` on a bg color renders
  // nothing visible when bg blends with the terminal theme. Replace with
  // 7 actual block chars each in a distinct color — guaranteed to show up.
  patch('13k-mascot-apple-body',
    't3.createElement(L,{backgroundColor:"clawd_body"}," ".repeat(7))',
    `t3.createElement(L,null,` +
      `t3.createElement(L,{color:"${BLOCK_1}"},"█"),` +
      `t3.createElement(L,{color:"${BLOCK_2}"},"█"),` +
      `t3.createElement(L,{color:"${BLOCK_3}"},"█"),` +
      `t3.createElement(L,{color:"${BLOCK_3}"},"█"),` +
      `t3.createElement(L,{color:"${BLOCK_4}"},"█"),` +
      `t3.createElement(L,{color:"${BLOCK_5}"},"█"),` +
      `t3.createElement(L,{color:"${VIOLET}"},"█")` +
    `)`
  )
  // Apple feet: same asymmetric split as NuY.
  patch('13l-mascot-apple-feet',
    't3.createElement(L,{color:"clawd_body"},"▘▘ ▝▝")',
    `t3.createElement(L,null,` +
      `t3.createElement(L,{color:"${FOOT_L}"},"▘▘"),` +
      `t3.createElement(L,null," "),` +
      `t3.createElement(L,{color:"${VIOLET}"},"▝▝")` +
    `)`
  )
}
