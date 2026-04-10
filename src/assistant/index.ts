import os from 'os'
import path from 'path'

let _assistantForced = false

export function isAssistantMode(): boolean {
  return (
    process.argv.includes('--assistant') ||
    process.env['CLAUDE_CODE_ASSISTANT_MODE'] === '1'
  )
}

export function markAssistantForced(): void {
  _assistantForced = true
}

export function isAssistantForced(): boolean {
  return _assistantForced
}

export async function initializeAssistantTeam(): Promise<{
  leaderId: string
  members: string[]
}> {
  const leaderId = process.env['CLAUDE_SESSION_ID'] ?? `session-${Date.now()}`
  return { leaderId, members: [leaderId] }
}

export function getAssistantSystemPromptAddendum(): string {
  return (
    'You are running in assistant mode. ' +
    'You can proactively observe, suggest, and act. ' +
    'Use BriefTool for concise updates.'
  )
}

export function getAssistantActivationPath(): string {
  return path.join(os.homedir(), '.claude', 'assistant-settings.json')
}
