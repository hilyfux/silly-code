/**
 * Remote skill state — stub for source-mode compatibility.
 */

export type RemoteSkillMeta = {
  slug: string
  name: string
  description: string
  content?: string
}

export function isSkillSearchEnabled(): boolean {
  return false
}

export function getDiscoveredRemoteSkill(_slug: string): RemoteSkillMeta | null {
  return null
}

export function stripCanonicalPrefix(_name: string): string | null {
  return null
}

export function getDiscoveredRemoteSkills(): RemoteSkillMeta[] {
  return []
}
