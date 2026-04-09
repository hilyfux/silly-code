/**
 * Policy Limits Service — remote enforcement removed in silly-code.
 * All outbound fetches and restriction checks are stubbed.
 * Exports preserved for import compatibility.
 */

export type { PolicyLimitsFetchResult, PolicyLimitsResponse } from './types.js'
export { PolicyLimitsResponseSchema } from './types.js'

export function _resetPolicyLimitsForTesting(): void {}

export function initializePolicyLimitsLoadingPromise(): void {}

export function isPolicyLimitsEligible(): boolean {
  return false
}

export async function waitForPolicyLimitsToLoad(): Promise<void> {}

export async function loadPolicyLimits(): Promise<void> {}

export async function refreshPolicyLimits(): Promise<void> {}

export async function clearPolicyLimitsCache(): Promise<void> {}

export function startBackgroundPolling(): void {}

export function stopBackgroundPolling(): void {}

export function isPolicyAllowed(_policy: string): boolean {
  return true
}
