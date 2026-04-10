/**
 * Skill search signals — stub for source-mode compatibility.
 */

export type DiscoverySignal = {
  slug: string
  name: string
  score: number
}

export function emitDiscoverySignal(_signal: DiscoverySignal): void {}

export function getDiscoverySignals(): DiscoverySignal[] {
  return []
}
