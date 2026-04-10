import type { Command } from '../../types/command.js'

type SkillEntry = {
  name: string
  description: string
  whenToUse: string
  command: Command
}

type SkillIndex = SkillEntry[]

let cachedIndex: SkillIndex | null = null
let cachedCommandsRef: readonly Command[] | null = null

export function clearSkillIndexCache(): void {
  cachedIndex = null
  cachedCommandsRef = null
}

export function getSkillIndex(commands: readonly Command[]): SkillIndex {
  if (cachedIndex && cachedCommandsRef === commands) {
    return cachedIndex
  }
  cachedCommandsRef = commands
  cachedIndex = commands
    .filter(cmd => !cmd.isHidden && cmd.type === 'prompt')
    .map(cmd => ({
      name: cmd.name.toLowerCase(),
      description: (cmd.description ?? '').toLowerCase(),
      whenToUse: (cmd.whenToUse ?? '').toLowerCase(),
      command: cmd,
    }))
  return cachedIndex
}

function scoreEntry(entry: SkillEntry, terms: string[]): number {
  let score = 0
  for (const term of terms) {
    if (entry.name.includes(term)) score += 3
    if (entry.description.includes(term)) score += 2
    if (entry.whenToUse.includes(term)) score += 1
  }
  return score
}

export function searchSkills(
  query: string,
  commands: readonly Command[],
): Command[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const terms = q.split(/\s+/).filter(Boolean)
  const index = getSkillIndex(commands)

  return index
    .map(entry => ({ entry, score: scoreEntry(entry, terms) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => entry.command)
}
