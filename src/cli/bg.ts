import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions')

interface SessionMeta {
  id: string
  name?: string
  status?: string
  started?: string
  pid?: number
  logFile?: string
}

function readSessionMeta(sessionId: string): SessionMeta | null {
  const metaFile = path.join(SESSIONS_DIR, `${sessionId}.json`)
  try {
    const raw = fs.readFileSync(metaFile, 'utf8')
    return JSON.parse(raw) as SessionMeta
  } catch {
    return null
  }
}

function listSessions(): SessionMeta[] {
  try {
    const entries = fs.readdirSync(SESSIONS_DIR)
    return entries
      .filter(e => e.endsWith('.json'))
      .map(e => {
        const id = e.replace(/\.json$/, '')
        return readSessionMeta(id)
      })
      .filter((m): m is SessionMeta => m !== null)
  } catch {
    return []
  }
}

export function psHandler(_args: string[]): void {
  const sessions = listSessions()
  if (sessions.length === 0) {
    console.log('No background sessions found.')
    return
  }
  const header = ['ID', 'NAME', 'STATUS', 'STARTED']
  const rows = sessions.map(s => [
    s.id ?? '-',
    s.name ?? '-',
    s.status ?? '-',
    s.started ?? '-',
  ])
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)),
  )
  const fmt = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(widths[i]!)).join('  ')
  console.log(fmt(header))
  console.log(widths.map(w => '-'.repeat(w)).join('  '))
  for (const row of rows) console.log(fmt(row))
}

export function logsHandler(sessionId: string): void {
  const meta = readSessionMeta(sessionId)
  if (!meta) {
    console.error(`Session not found: ${sessionId}`)
    process.exit(1)
  }
  const logFile = meta.logFile ?? path.join(SESSIONS_DIR, `${sessionId}.log`)
  if (!fs.existsSync(logFile)) {
    console.error(`Log file not found: ${logFile}`)
    process.exit(1)
  }
  const content = fs.readFileSync(logFile, 'utf8')
  process.stdout.write(content)
}

export async function attachHandler(sessionId: string): Promise<void> {
  const meta = readSessionMeta(sessionId)
  if (!meta) {
    console.error(`Session not found: ${sessionId}`)
    process.exit(1)
  }

  // Try UDS connection first
  const { listAllLiveSessions, sendToUdsSocket } = await import('../utils/udsClient.js')
  const liveSessions = await listAllLiveSessions()
  const target = liveSessions.find(s => s.sessionId === sessionId && s.alive)

  if (!target) {
    console.error(`Session ${sessionId} is not running or has no UDS socket.`)
    console.error('Use "silly ps" to see active sessions.')
    process.exit(1)
  }

  console.log(`Attaching to session ${sessionId} (pid ${target.pid})...`)
  console.log('Type messages and press Enter to send. Ctrl+C to detach.\n')

  // Stream: forward stdin to remote session
  const readline = await import('readline')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' })
  rl.prompt()
  rl.on('line', async (line: string) => {
    try {
      const msg = JSON.stringify({
        type: 'message',
        from: `attach-${process.pid}`,
        to: sessionId,
        id: `${Date.now()}`,
        payload: { text: line },
        timestamp: Date.now(),
      })
      await sendToUdsSocket(target.socketPath, msg)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Send failed: ${msg}`)
    }
    rl.prompt()
  })
  rl.on('close', () => {
    console.log('\nDetached.')
    process.exit(0)
  })
}

export function killHandler(sessionId: string): void {
  const meta = readSessionMeta(sessionId)
  if (!meta) {
    console.error(`Session not found: ${sessionId}`)
    process.exit(1)
  }
  if (!meta.pid) {
    console.error(`No PID recorded for session: ${sessionId}`)
    process.exit(1)
  }
  try {
    process.kill(meta.pid, 'SIGTERM')
    console.log(`Sent SIGTERM to process ${meta.pid} (session ${sessionId}).`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Failed to kill session ${sessionId}: ${msg}`)
    process.exit(1)
  }
}

export function handleBgFlag(_args: string[]): void {
  console.error(
    'Background sessions require the compiled binary. Run `./cli --bg` instead of `bun run dev`.',
  )
  process.exit(1)
}
