import { execFile } from 'child_process'
import { access } from 'fs/promises'
import { join } from 'path'
import { promisify } from 'util'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { WORKFLOW_TOOL_NAME } from './constants.js'

const execFileAsync = promisify(execFile)

const inputSchema = lazySchema(() =>
  z.strictObject({
    workflow_name: z.string().describe('Name of the workflow to execute'),
    args: z.array(z.string()).optional().describe('Arguments to pass to the workflow'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() => z.object({ stdout: z.string(), stderr: z.string(), exitCode: z.number() }))
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

async function resolveWorkflowPath(name: string, cwd: string): Promise<string> {
  for (const dir of [join(cwd, '.claude', 'workflows'), join(cwd, '.workflows')]) {
    const p = join(dir, name)
    try {
      await access(p)
      return p
    } catch { /* try next */ }
  }
  throw new Error(`Workflow '${name}' not found in .claude/workflows/ or .workflows/`)
}

function formatOutput({ stdout, stderr, exitCode }: Output): string {
  const parts = [stdout, stderr && `stderr: ${stderr}`, exitCode !== 0 && `exit: ${exitCode}`]
  return parts.filter(Boolean).join('\n') || '(no output)'
}

export const WorkflowTool = buildTool({
  name: WORKFLOW_TOOL_NAME,
  searchHint: 'execute a named workflow script',
  maxResultSizeChars: 100_000,
  async description() { return 'Execute a workflow script' },
  async prompt() { return 'Execute a workflow script from .claude/workflows/ or .workflows/' },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  isReadOnly() { return false },
  isConcurrencySafe() { return false },
  renderToolUseMessage({ workflow_name, args }) {
    return `Running workflow: ${workflow_name}${args?.length ? ' ' + args.join(' ') : ''}`
  },
  renderToolResultMessage(output) { return formatOutput(output as Output) },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { tool_use_id: toolUseID, type: 'tool_result', content: formatOutput(output as Output) }
  },
  async call({ workflow_name, args }, { abortController }) {
    const cwd = getCwd()
    const scriptPath = await resolveWorkflowPath(workflow_name, cwd)
    try {
      const { stdout, stderr } = await execFileAsync(scriptPath, args ?? [], {
        cwd,
        signal: abortController.signal,
      })
      return { data: { stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0 } }
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number }
      return {
        data: {
          stdout: e.stdout ?? '',
          stderr: e.stderr ?? '',
          exitCode: typeof e.code === 'number' ? e.code : 1,
        },
      }
    }
  },
} satisfies ToolDef<InputSchema, Output>)
