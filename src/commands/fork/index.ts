import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { Command } from '../../commands.js'

const fork: Command = {
  type: 'prompt',
  name: 'fork',
  description: 'Fork current session into a parallel subagent',
  source: 'builtin',
  isEnabled: () => true,
  progressMessage: 'forking session',
  async getPromptForCommand(args): Promise<ContentBlockParam[]> {
    return [
      {
        type: 'text',
        text: `Spawn an Agent tool call to handle the following task in a parallel subagent. Pass the task as the prompt argument to the Agent tool and let the subagent complete it independently.\n\nTask: ${args}`,
      },
    ]
  },
}

export default fork
