import type { Command } from '../commands.js'

const proactive = {
  type: 'prompt',
  name: 'proactive',
  description: 'Toggle proactive suggestions mode',
  source: 'builtin',
  isEnabled: () => true,
  progressMessage: 'configuring proactive mode',
  getPromptForCommand: (_args: string) =>
    'Toggle proactive mode: from now on, actively watch for opportunities to improve the code, architecture, or workflow as we work. When you notice something worth fixing or enhancing, briefly surface the opportunity and offer to implement it. If proactive mode was already on, turn it off and work only when explicitly asked.',
} satisfies Command

export default proactive
