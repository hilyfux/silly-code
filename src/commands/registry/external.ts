import type { Command } from '../../types/command.js'

export async function loadExternalCommands(
  cwd: string,
  getSkills: (cwd: string) => Promise<{
    skillDirCommands: Command[]
    pluginSkills: Command[]
    bundledSkills: Command[]
    builtinPluginSkills: Command[]
  }>,
  getPluginCommands: () => Promise<Command[]>,
  getWorkflowCommands: ((cwd: string) => Promise<Command[]>) | null,
): Promise<Command[]> {
  const [
    { skillDirCommands, pluginSkills, bundledSkills, builtinPluginSkills },
    pluginCommands,
    workflowCommands,
  ] = await Promise.all([
    getSkills(cwd),
    getPluginCommands(),
    getWorkflowCommands ? getWorkflowCommands(cwd) : Promise.resolve([]),
  ])

  return [
    ...bundledSkills,
    ...builtinPluginSkills,
    ...skillDirCommands,
    ...workflowCommands,
    ...pluginCommands,
    ...pluginSkills,
  ]
}
