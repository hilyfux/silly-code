/**
 * privacy.cjs — Patches 30-39: Zero telemetry / privacy protection
 *
 * Blocks all external telemetry, analytics, and tracking endpoints.
 * Nothing leaves the machine except the actual API calls you make.
 */

module.exports = function applyPrivacy({ patch }) {
  // Patch 30: Block Statsig telemetry
  patch('30-statsig-block',
    'return nU.fetch(`${K}/api/eval/${_}`',
    'return Promise.resolve(new Response("{}",{status:200}));nU.fetch(`${K}/api/eval/${_}`'
  )

  // Patch 31: Block metrics reporting
  patch('31-metrics-block',
    '/api/claude_code/metrics',
    '/api/claude_code/metrics_disabled_by_silly'
  )

  // Patch 32: Block shared transcripts
  patch('32-transcripts-block',
    '/api/claude_code_shared_session_transcripts',
    '/api/claude_code_shared_session_transcripts_disabled'
  )

  // Patch 33: Block feedback reporting
  patch('33-feedback-block',
    '/api/claude_cli_feedback',
    '/api/claude_cli_feedback_disabled'
  )

  // Patch 34: Block metrics_enabled check
  patch('34-metrics-enabled-block',
    '/api/claude_code/organizations/metrics_enabled',
    '/api/claude_code/organizations/metrics_disabled'
  )

  // Patch 35: Block Datadog logging
  patch('35-datadog-block',
    'http-intake.logs.us5.datadoghq.com/api/v2/logs',
    'localhost:0/datadog-disabled'
  )

  // Patch 36: Block GrowthBook feature flag fetch
  patch('36-growthbook-block',
    'cdn.growthbook.io',
    'localhost:0/growthbook-disabled'
  )

  // Patch 37: Block auto-update check
  patch('37-autoupdate-block',
    'storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases',
    'localhost:0/autoupdate-disabled'
  )

  // Patch 38: Block plugin stats
  patch('38-plugin-stats-block',
    'raw.githubusercontent.com/anthropics/claude-plugins-official/refs/heads/stats/stats/plugin-installs.json',
    'localhost:0/plugin-stats-disabled'
  )

  // Patch 39: Block changelog fetch
  patch('39-changelog-block',
    'raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md',
    'localhost:0/changelog-disabled'
  )
}
