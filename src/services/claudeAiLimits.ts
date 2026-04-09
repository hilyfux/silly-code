/**
 * Claude AI Limits — rate limit and quota enforcement removed in silly-code.
 * All quota checks always return "allowed". Exports preserved for import compatibility.
 */

// Re-export message functions from centralized location
export {
  getRateLimitErrorMessage,
  getRateLimitWarning,
  getUsingOverageText,
} from './rateLimitMessages.js'

export type RateLimitType =
  | 'five_hour'
  | 'seven_day'
  | 'seven_day_opus'
  | 'seven_day_sonnet'
  | 'overage'

export type OverageDisabledReason =
  | 'overage_not_provisioned'
  | 'org_level_disabled'
  | 'org_level_disabled_until'
  | 'out_of_credits'
  | 'seat_tier_level_disabled'
  | 'member_level_disabled'
  | 'seat_tier_zero_credit_limit'
  | 'group_zero_credit_limit'
  | 'member_zero_credit_limit'
  | 'org_service_level_disabled'
  | 'org_service_zero_credit_limit'
  | 'no_limits_configured'
  | 'unknown'

export type ClaudeAILimits = {
  status: 'allowed' | 'allowed_warning' | 'rejected'
  unifiedRateLimitFallbackAvailable: boolean
  resetsAt?: number
  rateLimitType?: RateLimitType
  utilization?: number
  overageStatus?: 'allowed' | 'allowed_warning' | 'rejected'
  overageResetsAt?: number
  overageDisabledReason?: OverageDisabledReason
  isUsingOverage?: boolean
  surpassedThreshold?: number
}

export let currentLimits: ClaudeAILimits = {
  status: 'allowed',
  unifiedRateLimitFallbackAvailable: false,
  isUsingOverage: false,
}

type StatusChangeListener = (limits: ClaudeAILimits) => void
export const statusListeners: Set<StatusChangeListener> = new Set()

export function getRateLimitDisplayName(type: RateLimitType): string {
  const names: Record<RateLimitType, string> = {
    five_hour: 'session limit',
    seven_day: 'weekly limit',
    seven_day_opus: 'Opus limit',
    seven_day_sonnet: 'Sonnet limit',
    overage: 'extra usage limit',
  }
  return names[type] || type
}

export function emitStatusChange(limits: ClaudeAILimits): void {
  currentLimits = limits
  statusListeners.forEach(listener => listener(limits))
}

export function getRawUtilization(): { five_hour?: unknown; seven_day?: unknown } {
  return {}
}

export async function checkQuotaStatus(): Promise<void> {}

export function extractQuotaStatusFromHeaders(_headers: globalThis.Headers): void {}

export function extractQuotaStatusFromError(_error: unknown): void {}
