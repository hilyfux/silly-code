/**
 * UDS Messaging Server — cross-session communication backbone.
 *
 * Protocol: NDJSON (one JSON object per '\n'-terminated line).
 * Delivery: at-most-once (no ACK, no retry — duplicates worse than drops).
 * Cleanup: unlink before bind + registerCleanup on exit.
 * Backpressure: in-memory queue capped at MAX_QUEUE_DEPTH.
 */
import { createServer, type Server, type Socket } from 'net'
import { unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getSessionId } from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'

const MAX_QUEUE_DEPTH = 100
const MAX_MESSAGE_BYTES = 1_048_576 // 1 MB

export type UdsMessage = {
  type: 'task-result' | 'message' | 'notification' | 'ping' | 'pong'
  from: string
  to: string
  id: string
  payload: unknown
  timestamp: number
}

let server: Server | null = null
let boundSocketPath = ''
const messageQueue: UdsMessage[] = []
let onEnqueueCallback: (() => void) | null = null

export function getDefaultUdsSocketPath(): string {
  return join(tmpdir(), `claude-${getSessionId()}-${process.pid}.sock`)
}

export function getUdsMessagingSocketPath(): string {
  return boundSocketPath
}

export function setOnEnqueue(cb: () => void): void {
  onEnqueueCallback = cb
}

export function dequeueMessages(): UdsMessage[] {
  return messageQueue.splice(0)
}

function handleConnection(socket: Socket): void {
  let buffer = ''
  socket.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    // Process complete lines
    let newlineIdx: number
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim()
      buffer = buffer.slice(newlineIdx + 1)
      if (!line) continue
      if (line.length > MAX_MESSAGE_BYTES) {
        logForDebugging(`[UDS] Dropped oversized message: ${line.length} bytes`)
        continue
      }
      try {
        const msg: UdsMessage = JSON.parse(line)
        if (messageQueue.length >= MAX_QUEUE_DEPTH) {
          logForDebugging(`[UDS] Queue full (${MAX_QUEUE_DEPTH}), dropping oldest`)
          messageQueue.shift()
        }
        messageQueue.push(msg)
        onEnqueueCallback?.()
      } catch {
        logForDebugging(`[UDS] Invalid JSON: ${line.slice(0, 80)}...`)
      }
    }
  })
  socket.on('error', () => {}) // swallow client errors
}

export async function startUdsMessaging(
  socketPath?: string,
  _opts?: { isExplicit?: boolean },
): Promise<void> {
  const path = socketPath || getDefaultUdsSocketPath()

  // Stale cleanup: unlink before bind
  try { unlinkSync(path) } catch {}

  return new Promise((resolve, reject) => {
    server = createServer(handleConnection)
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Another process is using this socket — try with a different name
        logForDebugging(`[UDS] Socket in use: ${path}`)
        reject(err)
      } else {
        reject(err)
      }
    })
    server.listen(path, () => {
      boundSocketPath = path
      process.env.CLAUDE_CODE_MESSAGING_SOCKET = path
      logForDebugging(`[UDS] Listening on ${path}`)
      resolve()
    })
  })
}

export function stopUdsMessaging(): void {
  if (server) {
    server.close()
    server = null
  }
  if (boundSocketPath) {
    try { unlinkSync(boundSocketPath) } catch {}
    boundSocketPath = ''
  }
}

// Cleanup on exit
function cleanup(): void {
  stopUdsMessaging()
}
process.on('exit', cleanup)
process.on('SIGTERM', () => { cleanup(); process.exit(0) })
process.on('SIGINT', () => { cleanup(); process.exit(0) })
