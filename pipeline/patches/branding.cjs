/**
 * branding.cjs — Patches 01-05: silly-code branding
 *
 * Replaces upstream Anthropic branding with silly-code identity.
 */

module.exports = function applyBranding({ patch, patchAll }) {
  patchAll('01-version',
    'VERSION:"2.1.100"',
    'VERSION:"2.1.100-silly"'
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
}
