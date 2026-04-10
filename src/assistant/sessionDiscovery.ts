import { readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export type AssistantSession = {
  id: string
  name: string
  status: 'active' | 'idle' | 'stopped'
  startedAt: string
  lastActivity: string
}

export async function discoverAssistantSessions(): Promise<AssistantSession[]> {
  const sessionsDir = join(homedir(), '.claude', 'sessions')
  try {
    const files = readdirSync(sessionsDir).filter(f => f.endsWith('.json'))
    const sessions: AssistantSession[] = []
    for (const file of files) {
      try {
        const raw = readFileSync(join(sessionsDir, file), 'utf8')
        const data = JSON.parse(raw)
        if (data.type === 'assistant' || data.assistant) {
          sessions.push({
            id: data.id || file.replace('.json', ''),
            name: data.name || 'Unnamed',
            status: data.status || 'idle',
            startedAt: data.startedAt || data.created || '',
            lastActivity: data.lastActivity || data.updated || '',
          })
        }
      } catch { /* skip malformed files */ }
    }
    return sessions
  } catch {
    return []
  }
}
