/**
 * branding.cjs — Patches 01-05: silly-code branding
 *
 * Replaces upstream Anthropic branding with silly-code identity.
 */

module.exports = function applyBranding({ patchAll }) {
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
}
