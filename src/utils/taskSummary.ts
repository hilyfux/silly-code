/**
 * Task summary — stub for source-mode compatibility.
 * Required by: src/query.ts (BG_SESSIONS flag)
 */

export function shouldGenerateTaskSummary(): boolean {
  return false
}

export async function maybeGenerateTaskSummary(_opts: Record<string, unknown>): Promise<void> {}
