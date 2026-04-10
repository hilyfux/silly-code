import { formatTotalCost } from '../../cost-tracker.js'
import { currentLimits } from '../../services/claudeAiLimits.js'
import { getSessionCostBreakdown } from '../../services/provider/costTracker.js'
import type { LocalCommandCall } from '../../types/command.js'
import { isClaudeAISubscriber } from '../../utils/auth.js'

export const call: LocalCommandCall = async () => {
  let value = ''

  if (isClaudeAISubscriber()) {
    if (currentLimits.isUsingOverage) {
      value =
        'You are currently using your overages to power your Silly Code usage. We will automatically switch you back to your subscription rate limits when they reset'
    } else {
      value =
        'You are currently using your subscription to power your Silly Code usage'
    }
    value += '\n\n'
  }

  value += formatTotalCost()

  // Per-provider cost breakdown (Silly Code exclusive feature)
  const breakdown = getSessionCostBreakdown()
  if (breakdown) {
    value += '\n\n── Provider Breakdown ──\n' + breakdown
  }

  return { type: 'text', value }
}
