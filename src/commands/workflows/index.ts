import { readFile, readdir } from 'fs/promises'
import { basename, join } from 'path'
import type { Command, PromptCommand } from '../../types/command.js'
import { isENOENT } from '../../utils/errors.js'

/**
 * Scans `.claude/workflows/` in the given cwd for `.md` files and returns
 * them as prompt commands that can be invoked as slash commands.
 */
export async function getWorkflowCommands(cwd: string): Promise<Command[]> {
  const workflowsDir = join(cwd, '.claude', 'workflows')
  let entries: string[]
  try {
    const dirents = await readdir(workflowsDir, { withFileTypes: true })
    entries = dirents
      .filter(d => d.isFile() && d.name.endsWith('.md'))
      .map(d => d.name)
  } catch (err) {
    if (isENOENT(err)) return []
    throw err
  }

  const commands: Command[] = await Promise.all(
    entries.map(async (filename): Promise<Command> => {
      const filePath = join(workflowsDir, filename)
      const name = basename(filename, '.md')
      let content = ''
      try {
        content = await readFile(filePath, 'utf-8')
      } catch {
        content = ''
      }
      // Extract first non-empty line as description, stripping leading # markers
      const firstLine = content
        .split('\n')
        .map(l => l.trim())
        .find(l => l.length > 0)
      const description =
        firstLine?.replace(/^#+\s*/, '') || `Workflow: ${name}`

      const promptCommand: PromptCommand = {
        type: 'prompt',
        progressMessage: `Running workflow: ${name}`,
        contentLength: content.length,
        source: 'projectSettings',
        kind: 'workflow',
        async getPromptForCommand(args) {
          const text = args ? `${content}\n\n${args}` : content
          return [{ type: 'text', text }]
        },
      }

      return {
        name,
        description,
        loadedFrom: 'skills',
        ...promptCommand,
      }
    }),
  )

  return commands
}
