/**
 * branding.cjs — Patches 01-05: silly-code branding
 *
 * Replaces upstream Anthropic branding with silly-code identity.
 */

module.exports = function applyBranding({ patch, patchAll }) {
  patchAll('01-version',
    'VERSION:"2.1.109"',
    'VERSION:"2.1.109-silly"'
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

  // Patch 06b: TUI header title — "Claude Code v..." → "Silly Code v..."
  patch('06b-header-title',
    'title:`Claude Code v$',
    'title:`Silly Code v$'
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
  // This leaks Claude model IDs into the system prompt for all providers
  patch('08-model-family',
    'The most recent Claude model family is Claude 4.6 and 4.5. Model IDs — Opus 4.6: \'${uj7.opus}\', Sonnet 4.6: \'${uj7.sonnet}\', Haiku 4.5: \'${uj7.haiku}\'. When building AI applications, default to the latest and most capable Claude models.',
    'The most recent model family is Claude 4.6 and 4.5. When building AI applications, default to the latest and most capable models.'
  )

  // Patch 08a: Environment section — "Claude Code is available as a CLI"
  patch('08a-cli-description',
    'Claude Code is available as a CLI in the terminal, desktop app (Mac/Windows), web app (claude.ai/code), and IDE extensions (VS Code, JetBrains).',
    'Silly Code is available as a CLI in the terminal.'
  )

  // Patch 08b: Environment section — "Fast mode for Claude Code"
  patch('08b-fast-mode',
    'Fast mode for Claude Code uses the same',
    'Fast mode for Silly Code uses the same'
  )

  // Patch 09: Sub-agent identity — file search specialist
  patch('09-search-agent-identity',
    'You are a file search specialist for Claude Code, Anthropic\'s official CLI for Claude.',
    'You are a file search specialist for Silly Code, a multi-provider AI coding assistant.'
  )

  // Patch 09a: Sub-agent identity — general agent (2 occurrences)
  patchAll('09a-general-agent-identity',
    'You are an agent for Claude Code, Anthropic\'s official CLI for Claude.',
    'You are an agent for Silly Code, a multi-provider AI coding assistant.'
  )

  // Patch 09b: Plan agent identity
  patch('09b-plan-agent-identity',
    'You are a software architect and planning specialist for Claude Code. Your role is to explore the codebase and design implementation plans.',
    'You are a software architect and planning specialist for Silly Code. Your role is to explore the codebase and design implementation plans.'
  )

  // Patch 09i: Auto-mode classifier reviewer
  patch('09i-classifier-reviewer-identity',
    'You are an expert reviewer of auto mode classifier rules for Claude Code.',
    'You are an expert reviewer of auto mode classifier rules for Silly Code.'
  )

  // Patch 09j: Hook condition evaluator
  patch('09j-hook-condition-identity',
    'You are evaluating a hook condition in Claude Code.',
    'You are evaluating a hook condition in Silly Code.'
  )

  // Patch 09k: Stop-condition hook evaluator
  patch('09k-stop-hook-identity',
    'You are evaluating a stop-condition hook in Claude Code.',
    'You are evaluating a stop-condition hook in Silly Code.'
  )

  // Patch 09l: Stop condition verifier
  patch('09l-stop-verifier-identity',
    'You are verifying a stop condition in Claude Code.',
    'You are verifying a stop condition in Silly Code.'
  )

  // Patch 09m: Onboarding guide generator
  patch('09m-onboarding-identity',
    'You are helping a power user generate an onboarding guide for teammates who are new to Claude Code.',
    'You are helping a power user generate an onboarding guide for teammates who are new to Silly Code.'
  )

  // Patch 09n: Remote agent scheduler
  patch('09n-remote-agent-identity',
    'You are helping the user schedule, update, list, or run **remote** Claude Code agents.',
    'You are helping the user schedule, update, list, or run **remote** Silly Code agents.'
  )

  // Patch 09o: Session search agent
  patch('09o-session-search-identity',
    'You are searching for past Claude Code conversation sessions on behalf of the user.',
    'You are searching for past Silly Code conversation sessions on behalf of the user.'
  )

  // Patch 09p: Memory selector agent
  patch('09p-memory-selector-identity',
    'You are selecting memories that will be useful to Claude Code as it processes',
    'You are selecting memories that will be useful to Silly Code as it processes'
  )

  // 09b skipped: CWD context is part of SIMPLE_ID match, handled by patch 63a in provider-engine.cjs

  // Patch 09c: Verification agent — "You are Claude, and you are bad"
  patch('09c-verification-identity',
    'You are Claude, and you are bad at verification.',
    'You are the AI model, and you are bad at verification.'
  )

  // Patch 09d: Status line setup agent system prompt
  patch('09d-statusline-agent-identity',
    'You are a status line setup agent for Claude Code. Your job is to create or update the statusLine command in the user\'s Claude Code settings.',
    'You are a status line setup agent for Silly Code. Your job is to create or update the statusLine command in the user\'s Silly Code settings.'
  )

  // Patch 09e: Claude guide agent — explains Claude Code/SDK/API to users.
  // For non-firstParty providers, this agent is less useful but keep it
  // functional; just replace identity phrasing so the agent doesn't claim
  // to be running as Claude Code when it isn't.
  patch('09e-guide-agent-identity',
    'You are the Claude guide agent. Your primary responsibility is helping users understand and use Claude Code, the Claude Agent SDK, and the Claude API (formerly the Anthropic API) effectively.',
    'You are the Silly Code guide agent. Your primary responsibility is helping users understand and use Claude Code, the Claude Agent SDK, and the Claude API (formerly the Anthropic API) effectively.'
  )

  // Patch 09f: WebFetch tool error — leaks "Claude Code" into tool result
  patch('09f-webfetch-error',
    'Claude Code is unable to fetch from ${q}',
    'Silly Code is unable to fetch from ${q}'
  )

  // Patch 09g: BashTool security warning — leaks "Claude Code" into tool result
  patch('09g-bash-validate-warning',
    'security, Claude Code cannot automatically validate ${q} commands',
    'security, Silly Code cannot automatically validate ${q} commands'
  )

  // Patch 09h: BashTool cd warning — leaks "Claude Code" into tool result
  patch('09h-bash-cd-warning',
    'security, Claude Code cannot automatically determine the final working directory',
    'security, Silly Code cannot automatically determine the final working directory'
  )

  // Patch 10a: TUI header brand name variable
  patch('10a-header-brand-var',
    'var PYK="Claude Code"',
    'var PYK="Silly Code"'
  )

  // Patch 10b: TUI header themed render — status bar "Claude Code vX.X.X"
  patch('10b-header-themed-render',
    '"claude",l)("Claude Code")',
    '"claude",l)("Silly Code")'
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

  // Patch 11a: Image tool description — leaks brand into system prompt
  patch('11a-multimodal-desc',
    'are presented visually as Claude Code is a multimodal LLM',
    'are presented visually as the assistant is a multimodal LLM'
  )

  // Patch 11b: think-back session extractor prompt — leaks brand to LLM
  patch('11b-think-back-session',
    'Analyze this Claude Code session and extract structured',
    'Analyze this session and extract structured'
  )

  // Patch 11c: think-back usage-data analyzer prompts (7 occurrences)
  patchAll('11c-think-back-usage',
    'Analyze this Claude Code usage data',
    'Analyze this usage data'
  )

  // Patch 11d: Bug report template — leaks brand into LLM context
  patch('11d-bug-report-template',
    'Claude Code is an agentic coding CLI based on the Anthropic API',
    'Silly Code is an agentic coding CLI based on a multi-provider backend'
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
  // OpenAI / Copilot users get the email-shaped orgName from their upstream
  // provider ("user@x.com's Organization") — exposing it in the welcome card
  // is an identity leak under our purity contract.
  patch('14a-welcome-hide-org-non-firstParty',
    '!process.env.IS_DEMO&&X.oauthAccount?.organizationName?`${c} · ${B} · ${X.oauthAccount.organizationName}`:`${c} · ${B}`',
    '!process.env.IS_DEMO&&X.oauthAccount?.organizationName&&(typeof Uq!=="function"||Uq()==="firstParty")?`${c} · ${B} · ${X.oauthAccount.organizationName}`:`${c} · ${B}`'
  )

  // Patch 14b: Don't inject user's email into agent system prompt for non-firstParty.
  // Upstream appends `The user's email address is X` to the prompt as user context.
  // For non-Claude providers, this leaks account email into the conversation.
  patch('14b-agent-prompt-hide-email',
    "let z=k_()?.emailAddress;return{..._&&{claudeMd:_},...z&&{userEmail:`The user's email address is",
    "let z=(typeof Uq==='function'&&Uq()!=='firstParty')?null:k_()?.emailAddress;return{..._&&{claudeMd:_},...z&&{userEmail:`The user's email address is"
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
  const B1 = '#ec4899'         // body block 1 — magenta
  const B2 = '#f97316'         // body block 2 — orange
  const B3 = '#eab308'         // body block 3 — gold
  const B4 = '#10b981'         // body block 4 — emerald (= EMERALD)
  const B5 = '#0ea5e9'         // body block 5 — sky
  const FOOT_L = '#ec4899'     // left feet (matches block 1)

  // NuY (standard render, 7 spans)
  patch('13a-mascot-r1L',
    'createElement(T,{color:"clawd_body"},A.r1L)',
    `createElement(T,{color:"${ROSE}"},A.r1L)`
  )
  patch('13b-mascot-r1E-face',
    'createElement(T,{color:"clawd_body",backgroundColor:"clawd_background"},A.r1E)',
    `createElement(T,{color:"${NAVY}",backgroundColor:"${PINK_FACE}"},A.r1E)`
  )
  patch('13c-mascot-r1R',
    'createElement(T,{color:"clawd_body"},A.r1R)',
    `createElement(T,{color:"${ORANGE}"},A.r1R)`
  )
  patch('13d-mascot-r2L',
    'createElement(T,{color:"clawd_body"},A.r2L)',
    `createElement(T,{color:"${EMERALD}"},A.r2L)`
  )
  // Body bar: split "█████" into 5 individually-colored blocks on indigo.
  patch('13e-mascot-body-bar',
    'createElement(T,{color:"clawd_body",backgroundColor:"clawd_background"},"█████")',
    `createElement(T,{backgroundColor:"${INDIGO_BG}"},` +
      `lz.createElement(T,{color:"${B1}"},"█"),` +
      `lz.createElement(T,{color:"${B2}"},"█"),` +
      `lz.createElement(T,{color:"${B3}"},"█"),` +
      `lz.createElement(T,{color:"${B4}"},"█"),` +
      `lz.createElement(T,{color:"${B5}"},"█")` +
    `)`
  )
  patch('13f-mascot-r2R',
    'createElement(T,{color:"clawd_body"},A.r2R)',
    `createElement(T,{color:"${VIOLET}"},A.r2R)`
  )
  // Feet: split "▘▘ ▝▝" so L-pair and R-pair render in different colors
  // (pink ▘▘ + violet ▝▝) — asymmetric hand-sewn plushie feel.
  patch('13g-mascot-feet',
    'createElement(T,{color:"clawd_body"},"  ","▘▘ ▝▝","  ")',
    `createElement(T,null,` +
      `lz.createElement(T,null,"  "),` +
      `lz.createElement(T,{color:"${FOOT_L}"},"▘▘"),` +
      `lz.createElement(T,null," "),` +
      `lz.createElement(T,{color:"${VIOLET}"},"▝▝"),` +
      `lz.createElement(T,null,"  ")` +
    `)`
  )

  // yuY (Apple Terminal variant, 5 spans — anchored via Symbol.for prefix)
  patch('13h-mascot-apple-left',
    'Symbol.for("react.memo_cache_sentinel"))z=lz.createElement(T,{color:"clawd_body"},"▗")',
    `Symbol.for("react.memo_cache_sentinel"))z=lz.createElement(T,{color:"${ROSE}"},"▗")`
  )
  patch('13i-mascot-apple-face',
    '!==Y)A=lz.createElement(T,{color:"clawd_background",backgroundColor:"clawd_body"},Y)',
    `!==Y)A=lz.createElement(T,{color:"${NAVY}",backgroundColor:"${PINK_FACE}"},Y)`
  )
  patch('13j-mascot-apple-right',
    'Symbol.for("react.memo_cache_sentinel"))O=lz.createElement(T,{color:"clawd_body"},"▖")',
    `Symbol.for("react.memo_cache_sentinel"))O=lz.createElement(T,{color:"${ORANGE}"},"▖")`
  )
  // Apple body bar: the original `" ".repeat(7)` on a bg color renders
  // nothing visible when bg blends with the terminal theme. Replace with
  // 7 actual block chars each in a distinct color — guaranteed to show up.
  patch('13k-mascot-apple-body',
    'lz.createElement(T,{backgroundColor:"clawd_body"}," ".repeat(7))',
    `lz.createElement(T,null,` +
      `lz.createElement(T,{color:"${B1}"},"█"),` +
      `lz.createElement(T,{color:"${B2}"},"█"),` +
      `lz.createElement(T,{color:"${B3}"},"█"),` +
      `lz.createElement(T,{color:"${B3}"},"█"),` +
      `lz.createElement(T,{color:"${B4}"},"█"),` +
      `lz.createElement(T,{color:"${B5}"},"█"),` +
      `lz.createElement(T,{color:"${VIOLET}"},"█")` +
    `)`
  )
  // Apple feet: same asymmetric split as NuY.
  patch('13l-mascot-apple-feet',
    'lz.createElement(T,{color:"clawd_body"},"▘▘ ▝▝")',
    `lz.createElement(T,null,` +
      `lz.createElement(T,{color:"${FOOT_L}"},"▘▘"),` +
      `lz.createElement(T,null," "),` +
      `lz.createElement(T,{color:"${VIOLET}"},"▝▝")` +
    `)`
  )
}
