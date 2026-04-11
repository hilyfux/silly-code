/**
 * branding.cjs — Patches 01-05: silly-code branding
 *
 * Replaces upstream Anthropic branding with silly-code identity.
 */

module.exports = function applyBranding({ patch, patchAll }) {
  patchAll('01-version',
    'VERSION:"2.1.101"',
    'VERSION:"2.1.101-silly"'
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
    'The most recent Claude model family is Claude 4.6 and 4.5. Model IDs — Opus 4.6: \'${wj7.opus}\', Sonnet 4.6: \'${wj7.sonnet}\', Haiku 4.5: \'${wj7.haiku}\'. When building AI applications, default to the latest and most capable Claude models.',
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

  // 09b skipped: CWD context is part of SIMPLE_ID match, handled by patch 63a in provider-engine.cjs

  // Patch 09c: Verification agent — "You are Claude, and you are bad"
  patch('09c-verification-identity',
    'You are Claude, and you are bad at verification.',
    'You are the AI model, and you are bad at verification.'
  )
}
