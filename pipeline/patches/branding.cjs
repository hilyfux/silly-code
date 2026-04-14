/**
 * branding.cjs — Patches 01-05: silly-code branding
 *
 * Replaces upstream Anthropic branding with silly-code identity.
 */

module.exports = function applyBranding({ patch, patchAll }) {
  patchAll('01-version',
    'VERSION:"2.1.105"',
    'VERSION:"2.1.105-silly"'
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
    'The most recent Claude model family is Claude 4.6 and 4.5. Model IDs — Opus 4.6: \'${BH7.opus}\', Sonnet 4.6: \'${BH7.sonnet}\', Haiku 4.5: \'${BH7.haiku}\'. When building AI applications, default to the latest and most capable Claude models.',
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
    'var mOK="Claude Code"',
    'var mOK="Silly Code"'
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

  // Patch 12a-e: Cuter mascot — swap bulky L-corners (▛▜/▟/▙) at head top
  // for tiny dot-pixels (▘▝▖▗) so the creature reads as 呆萌 baby-blob
  // instead of a blocky robot. Two rows × 4 poses (default/look-left/
  // look-right/arms-up). ▛███▜ appears in both default+arms-up poses.
  patchAll('12a-mascot-eyes-default',
    'r1E:"▛███▜"',
    'r1E:"▘███▝"'
  )
  patch('12b-mascot-eyes-look-left',
    'r1E:"▟███▟"',
    'r1E:"▘███▘"'
  )
  patch('12c-mascot-eyes-look-right',
    'r1E:"▙███▙"',
    'r1E:"▝███▝"'
  )

  // Patch 12d: Apple Terminal variant — eyes up-outward for wide-eyed cute
  patchAll('12d-mascot-apple-default',
    '" ▗   ▖ "',
    '" ▘   ▝ "'
  )
}
