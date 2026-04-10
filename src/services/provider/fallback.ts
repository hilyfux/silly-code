/**
 * Provider Fallback Engine
 *
 * Silly Code exclusive: when the primary provider fails (429, 500, timeout),
 * automatically retry with the next available provider. Zero user intervention.
 *
 * Claude Code can NEVER do this — it has exactly one provider.
 *
 * Architecture:
 *   1. Caller tries primary provider
 *   2. On retryable failure → fallbackEngine.shouldFallback(error)
 *   3. If yes → fallbackEngine.getNextProvider()
 *   4. Caller reconstructs client with new provider and retries
 *   5. All decisions are logged for observability
 *
 * NOT attempted:
 *   - Mid-stream fallback (too complex, response format may differ)
 *   - Auth errors (user needs to fix credentials, not auto-switch)
 *   - Content policy errors (switching provider won't help)
 */

import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { ProviderId } from './types.js'
import { getProviderHealth, recordFailure } from './health.js'

export type FallbackDecision = {
  shouldFallback: boolean
  nextProvider: ProviderId | null
  reason: string
  originalProvider: ProviderId
  originalError: string
  attempt: number
}

type FallbackState = {
  currentProvider: ProviderId
  attempts: Map<ProviderId, number>
  maxAttemptsPerProvider: number
  maxTotalAttempts: number
  totalAttempts: number
}

const AUTH_FILES: Record<ProviderId, string> = {
  claude: join(homedir(), '.claude', '.credentials.json'),
  codex: join(homedir(), '.silly-code', 'codex-oauth.json'),
  copilot: join(homedir(), '.silly-code', 'copilot-oauth.json'),
}

// Provider priority order for fallback (most capable → least)
const FALLBACK_ORDER: ProviderId[] = ['claude', 'codex', 'copilot']

function isProviderAuthenticated(id: ProviderId): boolean {
  return existsSync(AUTH_FILES[id])
}

function getAuthenticatedProviders(): ProviderId[] {
  return FALLBACK_ORDER.filter(isProviderAuthenticated)
}

/** Errors that justify trying another provider */
function isRetryableError(error: string): boolean {
  const retryable = [
    '429',            // rate limited
    '500',            // server error
    '502',            // bad gateway
    '503',            // service unavailable
    'ETIMEDOUT',      // timeout
    'ECONNRESET',     // connection reset
    'ECONNREFUSED',   // connection refused
    'overloaded',     // Anthropic overloaded message
    'rate_limit',     // rate limit error type
    'capacity',       // at capacity
  ]
  const lower = error.toLowerCase()
  return retryable.some(r => lower.includes(r.toLowerCase()))
}

/** Errors where fallback would not help */
function isNonRetryableError(error: string): boolean {
  const nonRetryable = [
    'authentication_error',
    'invalid_api_key',
    'permission_denied',
    'content_policy',
    'invalid_request',
  ]
  const lower = error.toLowerCase()
  return nonRetryable.some(r => lower.includes(r.toLowerCase()))
}

export function createFallbackState(primaryProvider: ProviderId): FallbackState {
  return {
    currentProvider: primaryProvider,
    attempts: new Map(),
    maxAttemptsPerProvider: 2,
    maxTotalAttempts: 4,
    totalAttempts: 0,
  }
}

export function decideFallback(
  state: FallbackState,
  error: string,
): FallbackDecision {
  state.totalAttempts++
  const currentAttempts = (state.attempts.get(state.currentProvider) ?? 0) + 1
  state.attempts.set(state.currentProvider, currentAttempts)

  // Record failure for health tracking
  recordFailure(state.currentProvider, error)

  // Non-retryable: stop immediately
  if (isNonRetryableError(error)) {
    return {
      shouldFallback: false,
      nextProvider: null,
      reason: `Non-retryable error: ${error.slice(0, 100)}`,
      originalProvider: state.currentProvider,
      originalError: error,
      attempt: state.totalAttempts,
    }
  }

  // Budget exhausted
  if (state.totalAttempts >= state.maxTotalAttempts) {
    return {
      shouldFallback: false,
      nextProvider: null,
      reason: `Max total attempts (${state.maxTotalAttempts}) reached`,
      originalProvider: state.currentProvider,
      originalError: error,
      attempt: state.totalAttempts,
    }
  }

  // Not retryable at all
  if (!isRetryableError(error)) {
    return {
      shouldFallback: false,
      nextProvider: null,
      reason: `Error not retryable: ${error.slice(0, 100)}`,
      originalProvider: state.currentProvider,
      originalError: error,
      attempt: state.totalAttempts,
    }
  }

  // Current provider still has budget? Retry same provider first
  if (currentAttempts < state.maxAttemptsPerProvider) {
    return {
      shouldFallback: true,
      nextProvider: state.currentProvider,
      reason: `Retry same provider (attempt ${currentAttempts}/${state.maxAttemptsPerProvider})`,
      originalProvider: state.currentProvider,
      originalError: error,
      attempt: state.totalAttempts,
    }
  }

  // Current provider exhausted — find next authenticated healthy provider
  const authenticated = getAuthenticatedProviders()
  const tried = new Set(
    [...state.attempts.entries()]
      .filter(([, n]) => n >= state.maxAttemptsPerProvider)
      .map(([id]) => id),
  )
  const candidates = authenticated.filter(id => !tried.has(id))

  if (candidates.length === 0) {
    return {
      shouldFallback: false,
      nextProvider: null,
      reason: 'All authenticated providers exhausted',
      originalProvider: state.currentProvider,
      originalError: error,
      attempt: state.totalAttempts,
    }
  }

  // Pick healthiest candidate
  const next = candidates.sort((a, b) => {
    const ha = getProviderHealth(a)
    const hb = getProviderHealth(b)
    if (ha.status !== hb.status) {
      const order = { healthy: 0, degraded: 1, down: 2 }
      return (order[ha.status] ?? 3) - (order[hb.status] ?? 3)
    }
    return ha.avgLatencyMs - hb.avgLatencyMs
  })[0]!

  state.currentProvider = next

  return {
    shouldFallback: true,
    nextProvider: next,
    reason: `Falling back from ${state.currentProvider} to ${next} (${error.slice(0, 60)})`,
    originalProvider: state.currentProvider,
    originalError: error,
    attempt: state.totalAttempts,
  }
}

/** Human-readable summary of fallback capability */
export function getFallbackStatus(): string {
  const providers = getAuthenticatedProviders()
  if (providers.length <= 1) {
    return `Fallback: unavailable (only ${providers.length} provider authenticated)`
  }
  return `Fallback: active (${providers.length} providers: ${providers.join(' → ')})`
}
