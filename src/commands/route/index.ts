/**
 * /route — Show provider routing status, health, and fallback readiness.
 *
 * Silly Code exclusive. Claude Code has no equivalent.
 */
import type { Command } from '../../types/command.js'

const route: Command = {
  type: 'local',
  name: 'route',
  description: 'Show provider routing status, health, and fallback readiness',
  isEnabled: () => true,
  isHidden: false,
  progressMessage: 'checking provider status',
  aliases: ['routing', 'providers'],
  async call() {
    const { getSupportedProviderIds, getProviderDescriptor } = await import(
      '../../services/provider/index.js'
    )
    const { getAllProviderHealth, getHealthSummary } = await import(
      '../../services/provider/health.js'
    )
    const { getSessionCostBreakdown } = await import(
      '../../services/provider/costTracker.js'
    )
    const { getFallbackStatus } = await import(
      '../../services/provider/fallback.js'
    )

    const lines: string[] = []

    lines.push('── Provider Routing Status ──\n')

    // Provider list with auth status
    const { existsSync } = await import('fs')
    const { homedir } = await import('os')
    const { join } = await import('path')
    const home = homedir()
    const authFiles: Record<string, string> = {
      claude: join(home, '.claude', '.credentials.json'),
      codex: join(home, '.silly-code', 'codex-oauth.json'),
      copilot: join(home, '.silly-code', 'copilot-oauth.json'),
    }

    for (const id of getSupportedProviderIds()) {
      const desc = getProviderDescriptor(id)
      const authed = existsSync(authFiles[id] ?? '')
      lines.push(`  ${desc.name} (${id}): ${authed ? '✓ authenticated' : '✗ not logged in'}`)
      lines.push(`    Models: ${[desc.opusModel, desc.sonnetModel, desc.haikuModel].filter(Boolean).join(', ')}`)
    }

    lines.push('')

    // Health
    lines.push('── Health ──\n')
    lines.push(getHealthSummary())
    lines.push('')

    // Fallback
    lines.push('── Fallback ──\n')
    lines.push(`  ${getFallbackStatus()}`)
    lines.push('')

    // Cost
    const breakdown = getSessionCostBreakdown()
    if (breakdown) {
      lines.push('── Session Cost ──\n')
      lines.push(breakdown)
    }

    return { type: 'text', value: lines.join('\n') }
  },
} satisfies Command

export default route
