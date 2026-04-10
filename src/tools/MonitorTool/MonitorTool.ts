import { spawn } from 'child_process'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

const MONITOR_TOOL_NAME = 'Monitor'
const DEFAULT_TIMEOUT_MS = 10_000

const inputSchema = lazySchema(() =>
  z.strictObject({
    pid_or_command: z
      .string()
      .describe('PID of a background process or a shell command to monitor'),
    timeout_ms: z
      .number()
      .optional()
      .describe('How long to collect output in milliseconds (default: 10000)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    output: z.string().describe('Captured stdout/stderr from the process'),
    timedOut: z.boolean().describe('Whether collection ended due to timeout'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const MonitorTool = buildTool({
  name: MONITOR_TOOL_NAME,
  searchHint: 'watch or tail output of a running background process',
  maxResultSizeChars: 200_000,
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  async description() { return 'Monitor a background process for output' },
  async prompt() { return 'Monitor a background process for output' },
  isReadOnly() { return true },
  isConcurrencySafe() { return true },
  renderToolUseMessage(input) {
    return `Monitoring: ${input.pid_or_command ?? ''}`
  },
  renderToolResultMessage(output) {
    return (output as Output).output || '(no output)'
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.output || '(no output)',
    }
  },
  async call({ pid_or_command, timeout_ms }, { abortController }) {
    const timeout = timeout_ms ?? DEFAULT_TIMEOUT_MS
    const chunks: string[] = []
    let timedOut = false
    await new Promise<void>(resolve => {
      const isNumeric = /^\d+$/.test(pid_or_command.trim())
      const [cmd, ...args] = isNumeric
        ? ['tail', '--pid', pid_or_command, '-f', '/dev/null']
        : ['sh', '-c', pid_or_command]
      const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      const onData = (chunk: Buffer) => chunks.push(chunk.toString())
      proc.stdout.on('data', onData)
      proc.stderr.on('data', onData)
      const timer = setTimeout(() => { timedOut = true; proc.kill(); resolve() }, timeout)
      const done = () => { clearTimeout(timer); resolve() }
      proc.on('close', done)
      proc.on('error', done)
      abortController.signal.addEventListener('abort', () => { proc.kill(); resolve() })
    })
    return { data: { output: chunks.join(''), timedOut } }
  },
} satisfies ToolDef<InputSchema, Output>)
