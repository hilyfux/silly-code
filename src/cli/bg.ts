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

export function attachHandler(_sessionId: string): void {
  console.error(
    'attach is not supported in source mode (requires compiled binary IPC).',
  )
  process.exit(1)
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
