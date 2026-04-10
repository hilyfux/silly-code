/**
 * TerminalCaptureTool — capture and stream output from background terminal processes.
 *
 * Designed for: watching dev servers, long-running builds, test suites.
 * Each panel is a named background process with a ring buffer of output.
 */
import { spawn, type ChildProcess } from 'child_process'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getCwd } from '../../utils/state.js'

const MAX_BUFFER_LINES = 500
const MAX_PANELS = 10

type Panel = {
  id: string
  command: string
  process: ChildProcess
  buffer: string[]
  exitCode: number | null
  startedAt: number
}

const panels = new Map<string, Panel>()

function generateId(): string {
  return `panel-${Date.now().toString(36)}`
}

function getOrCreatePanel(command: string, panelId?: string): Panel {
  if (panelId && panels.has(panelId)) {
    return panels.get(panelId)!
  }

  if (panels.size >= MAX_PANELS) {
    // Evict oldest completed panel, or oldest overall
    let oldest: Panel | null = null
    for (const p of panels.values()) {
      if (p.exitCode !== null) { panels.delete(p.id); break }
      if (!oldest || p.startedAt < oldest.startedAt) oldest = p
    }
    if (panels.size >= MAX_PANELS && oldest) {
      oldest.process.kill()
      panels.delete(oldest.id)
    }
  }

  const id = panelId || generateId()
  const child = spawn('sh', ['-c', command], {
    cwd: getCwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0' },
  })

  const panel: Panel = {
    id,
    command,
    process: child,
    buffer: [],
    exitCode: null,
    startedAt: Date.now(),
  }

  const pushLine = (line: string) => {
    panel.buffer.push(line)
    if (panel.buffer.length > MAX_BUFFER_LINES) {
      panel.buffer.splice(0, panel.buffer.length - MAX_BUFFER_LINES)
    }
  }

  child.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      if (line) pushLine(line)
    }
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      if (line) pushLine(`[stderr] ${line}`)
    }
  })
  child.on('close', (code) => { panel.exitCode = code })
  child.on('error', (err) => { pushLine(`[error] ${err.message}`) })

  panels.set(id, panel)
  return panel
}

type InputSchema = typeof inputSchema extends () => infer R ? R : never
type Output = string

const inputSchema = lazySchema(() =>
  z.strictObject({
    command: z.string().describe('Shell command to run in background (e.g. "npm run dev")'),
    panel_id: z.string().optional().describe('Panel ID to read from. Omit to start new panel.'),
    action: z.enum(['start', 'read', 'stop', 'list']).default('start').describe(
      'start: launch command; read: get recent output; stop: kill panel; list: show all panels',
    ),
    lines: z.number().optional().default(50).describe('Number of recent lines to return (for read)'),
  }),
)

export const TerminalCaptureTool = buildTool<InputSchema, Output>({
  name: 'TerminalPanel',
  description:
    'Manage background terminal panels. Start a command, read its output, stop it, or list all panels. ' +
    'Useful for watching dev servers, builds, or test suites while doing other work.',
  inputSchema,
  isReadOnly: () => false,
  isConcurrencySafe: () => true,
  async call({ input, abortSignal: _signal }): Promise<Output> {
    const { action, command, panel_id, lines } = input

    if (action === 'list') {
      if (panels.size === 0) return 'No active panels.'
      const rows = [...panels.values()].map(p =>
        `${p.id}  ${p.exitCode !== null ? `exited(${p.exitCode})` : 'running'}  ${p.command.slice(0, 60)}  [${p.buffer.length} lines]`,
      )
      return `Panels (${panels.size}):\n${rows.join('\n')}`
    }

    if (action === 'stop') {
      const panel = panels.get(panel_id || '')
      if (!panel) return `Panel not found: ${panel_id}`
      panel.process.kill()
      panels.delete(panel.id)
      return `Stopped panel ${panel.id}`
    }

    if (action === 'read') {
      const panel = panels.get(panel_id || '')
      if (!panel) return `Panel not found: ${panel_id}`
      const n = Math.min(lines || 50, panel.buffer.length)
      const recent = panel.buffer.slice(-n)
      const status = panel.exitCode !== null ? `exited(${panel.exitCode})` : 'running'
      return `[${panel.id} | ${status}] Last ${recent.length} lines:\n${recent.join('\n')}`
    }

    // action === 'start'
    if (!command) return 'Error: command is required for start action'
    const panel = getOrCreatePanel(command, panel_id)
    return `Started panel ${panel.id}: ${command}\nUse TerminalPanel with action:"read" panel_id:"${panel.id}" to see output.`
  },
  renderToolUseMessage(input): string {
    return `[TerminalPanel] ${input.action || 'start'}: ${input.command || input.panel_id || ''}`
  },
  renderToolResultMessage(output): string {
    return output
  },
} satisfies ToolDef<InputSchema, Output>)
