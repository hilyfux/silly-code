import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const PID_FILE = join(homedir(), '.claude', 'daemon.pid')

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function start(): Promise<void> {
  writeFileSync(PID_FILE, String(process.pid), 'utf8')
  console.log(`[daemon] started (pid=${process.pid}, pidfile=${PID_FILE})`)
}

async function stop(): Promise<void> {
  if (!existsSync(PID_FILE)) {
    console.log('[daemon] not running (no pid file)')
    return
  }
  const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10)
  if (isAlive(pid)) {
    process.kill(pid, 'SIGTERM')
    console.log(`[daemon] sent SIGTERM to pid ${pid}`)
  } else {
    console.log(`[daemon] process ${pid} was not running`)
  }
  unlinkSync(PID_FILE)
  console.log('[daemon] pid file removed')
}

async function status(): Promise<void> {
  if (!existsSync(PID_FILE)) {
    console.log('[daemon] stopped (no pid file)')
    return
  }
  const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10)
  if (isAlive(pid)) {
    console.log(`[daemon] running (pid=${pid})`)
  } else {
    console.log(`[daemon] dead (pid=${pid} not alive, stale pid file at ${PID_FILE})`)
  }
}

function usage(): void {
  console.log('Usage: daemon <start|stop|status>')
}

export async function daemonMain(args: string[]): Promise<void> {
  const [subcommand] = args
  switch (subcommand) {
    case 'start':  return start()
    case 'stop':   return stop()
    case 'status': return status()
    default:       usage()
  }
}
