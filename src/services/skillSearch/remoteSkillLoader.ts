/**
 * Remote skill loader — stub for source-mode compatibility.
 */

export async function loadRemoteSkill(_slug: string): Promise<string | null> {
  return null
}

export function logRemoteSkillLoaded(
  _slug: string,
  _meta: { wasDiscovered: boolean },
): void {}
