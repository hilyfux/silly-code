import type { Command } from '../../types/command.js'

export function buildBuiltinCommands(commands: Command[]): Command[] {
  return commands.filter(Boolean)
}

export function getBuiltinCommandNames(commands: Command[]): string[] {
  return commands.map(command => command.name)
}
