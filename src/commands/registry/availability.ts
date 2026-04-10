import { isUsing3PServices, isClaudeAISubscriber } from '../../utils/auth.js'
import { isFirstPartyAnthropicBaseUrl } from '../../utils/model/providers.js'
import type { Command } from '../../types/command.js'

export function meetsAvailabilityRequirement(cmd: Command): boolean {
  if (!cmd.availability) return true
  for (const a of cmd.availability) {
    switch (a) {
      case 'claude-ai':
        if (isClaudeAISubscriber()) return true
        break
      case 'console':
        if (
          !isClaudeAISubscriber() &&
          !isUsing3PServices() &&
          isFirstPartyAnthropicBaseUrl()
        ) {
          return true
        }
        break
      default: {
        const _exhaustive: never = a
        void _exhaustive
        break
      }
    }
  }
  return false
}
