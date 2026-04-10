/**
 * UDS Client — send messages to other sessions via Unix domain sockets.
 *
 * Connect-send-disconnect pattern (no persistent connections).
 * At-most-once delivery — no retry on failure.
 */
import { connect, type Socket } from 'net'
import { readdirSync, readFileSync, statSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { join, basename } from 'path'

export type SessionRecord = {
  sessionId: string
  pid: number
  socketPath: string
  alive: boolean
}

/**
 * Send a single message to a remote session's UDS socket.
 * Opens a fresh connection, writes the NDJSON line, closes.
 * Rejects if the target is unreachable (dead session, stale socket).
 */
export async function sendToUdsSocket(
  socketPath: string,
  message: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const client: Socket = connect(socketPath, () => {
      const line = message.endsWith('\n') ? message : message + '\n'
      client.write(line, () => {
        client.end()
        resolve()
      })
    })
    client.setTimeout(5000)
    client.on('timeout', () => {
      client.destroy()
      reject(new Error(`UDS send timeout: ${socketPath}`))
    })
    client.on('error', (err: NodeJS.ErrnoException) => {
      client.destroy()
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
        reject(new Error(`Session unreachable (${err.code}): ${socketPath}`))
      } else {
        reject(err)
      }
    })
  })
}

/**
 * Discover all live silly-code sessions by scanning for socket files.
 * Checks both tmpdir (socket files) and ~/.claude/sessions/ (metadata).
 */
export async function listAllLiveSessions(): Promise<SessionRecord[]> {
  const sessions: SessionRecord[] = []

  // Scan tmpdir for claude-*.sock files
  try {
    const tmpFiles = readdirSync(tmpdir())
    for (const file of tmpFiles) {
      if (!file.startsWith('claude-') || !file.endsWith('.sock')) continue
      const socketPath = join(tmpdir(), file)
      // Parse session ID and PID from filename: claude-<sessionId>-<pid>.sock
      const parts = basename(file, '.sock').split('-')
      if (parts.length < 3) continue
      const pid = parseInt(parts[parts.length - 1]!, 10)
      const sessionId = parts.slice(1, -1).join('-')
      if (isNaN(pid)) continue

      // Check if process is alive
      let alive = false
      try {
        process.kill(pid, 0) // signal 0 = check existence
        alive = true
      } catch {}

      sessions.push({ sessionId, pid, socketPath, alive })
    }
  } catch {}

  // Also scan ~/.claude/sessions/ for metadata files
  try {
    const sessionsDir = join(homedir(), '.claude', 'sessions')
    const files = readdirSync(sessionsDir).filter(f => f.endsWith('.json'))
    for (const file of files) {
      try {
        const raw = readFileSync(join(sessionsDir, file), 'utf8')
        const data = JSON.parse(raw)
        if (data.pid && data.socketPath) {
          const existing = sessions.find(s => s.sessionId === data.sessionId)
          if (!existing) {
            let alive = false
            try { process.kill(data.pid, 0); alive = true } catch {}
            sessions.push({
              sessionId: data.sessionId || file.replace('.json', ''),
              pid: data.pid,
              socketPath: data.socketPath,
              alive,
            })
          }
        }
      } catch {}
    }
  } catch {}

  return sessions
}

/**
 * Send a typed message object to a session, serialized as NDJSON.
 */
export async function sendMessage(
  socketPath: string,
  msg: {
    type: string
    from: string
    to: string
    payload: unknown
  },
): Promise<void> {
  const fullMsg = {
    ...msg,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  }
  return sendToUdsSocket(socketPath, JSON.stringify(fullMsg))
}
