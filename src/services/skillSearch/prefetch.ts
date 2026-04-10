/**
 * Skill search prefetch — stub for source-mode compatibility.
 * Required by: src/query.ts + src/utils/attachments.ts (EXPERIMENTAL_SKILL_SEARCH flag)
 */

export async function prefetchSkillSearch(): Promise<void> {}

export async function maybePrefetchRemoteSkills(): Promise<void> {}

export async function startSkillDiscoveryPrefetch(
  _signal: unknown,
  _messages: unknown[],
  _context?: unknown,
): Promise<null> {
  return null
}

export async function getTurnZeroSkillDiscovery(
  _input: unknown,
  _messages: unknown[],
  _context?: unknown,
): Promise<null> {
  return null
}
