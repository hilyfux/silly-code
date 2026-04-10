/**
 * Provider Fallback Engine
 *
 * When the primary provider fails with a retryable error (429, 5xx, timeout),
 * this module decides whether and how to retry — same provider or cross-provider.
 *
 * Integration point: called from claude.ts when withRetry throws CannotRetryError,
 * ONLY if no output has been emitted and no tool side effects have occurred.
 *
 * State machine:
 *   request_created → in_flight_no_output → first_token_emitted → completed
 *                                         → tool_call_started → completed
 *                          ↓ (error)            ↓ (error)
 *                     RETRY/FALLBACK OK      FAIL CLOSED
 *
 * Capabilities: fallback provider must support the capabilities needed
 * by the current request (streaming, tool_use, etc.).
 *
 * Policy:
 *   strict              — no cross-provider fallback (user explicitly pinned provider)
 *   same-provider-retry — retry same provider only
 *   cross-provider      — retry same first, then switch provider
 */

import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { ProviderId } from './types.js'
import { getProviderHealth, recordFailure } from './health.js'
import { logForDebugging } from '../../utils/debug.js'

// ── Types ────────────────────────────────────────────────────

export type FallbackPolicy = 'strict' | 'same-provider-retry' | 'cross-provider'

export type RequestCapability = 'streaming' | 'tool_use' | 'long_context' | 'image_input'

export type RequestState =
  | 'request_created'
  | 'in_flight_no_output'
  | 'first_token_emitted'
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'completed'
  | 'failed'

export type FallbackEvent = {
  timestamp: string
  requestId: string
  requestState: RequestState
  originalProvider: ProviderId
  selectedProvider: ProviderId | null
  fallbackChain: string[]
  reason: string
  retryCount: number
  safeReplayAllowed: boolean
  streamHadOutput: boolean
  toolSideEffectStarted: boolean
  outcome: 'retry' | 'fallback' | 'fail_closed' | 'policy_block' | 'capability_mismatch'
}

export type FallbackDecision = {
  shouldRetry: boolean
  nextProvider: ProviderId | null
  reason: string
  event: FallbackEvent
}

// ── Provider capabilities ────────────────────────────────────

const PROVIDER_CAPABILITIES: Record<ProviderId, Set<RequestCapability>> = {
  claude: new Set(['streaming', 'tool_use', 'long_context', 'image_input']),
  codex: new Set(['streaming', 'tool_use', 'long_context']),
  copilot: new Set(['streaming', 'tool_use']),
}

export function providerSupportsCapabilities(
  provider: ProviderId,
  required: RequestCapability[],
): boolean {
  const caps = PROVIDER_CAPABILITIES[provider]
  if (!caps) return false
  return required.every(r => caps.has(r))
}

// ── Auth check ───────────────────────────────────────────────

const AUTH_FILES: Record<ProviderId, string> = {
  claude: join(homedir(), '.claude', '.credentials.json'),
  codex: join(homedir(), '.silly-code', 'codex-oauth.json'),
  copilot: join(homedir(), '.silly-code', 'copilot-oauth.json'),
}

const FALLBACK_ORDER: ProviderId[] = ['claude', 'codex', 'copilot']

function isProviderAuthenticated(id: ProviderId): boolean {
  return existsSync(AUTH_FILES[id])
}

function getAuthenticatedProviders(): ProviderId[] {
  return FALLBACK_ORDER.filter(isProviderAuthenticated)
}

// ── Policy resolution ────────────────────────────────────────

/**
 * Determine fallback policy. If user explicitly set a provider env var,
 * they've pinned their choice — cross-provider fallback would violate intent.
 */
export function resolveFallbackPolicy(): FallbackPolicy {
  const explicit = process.env.CLAUDE_CODE_FALLBACK_POLICY
  if (explicit === 'strict' || explicit === 'same-provider-retry' || explicit === 'cross-provider') {
    return explicit
  }
  // If user explicitly pinned a provider via env var, default to same-provider-retry
  if (
    process.env.CLAUDE_CODE_USE_OPENAI === '1' ||
    process.env.CLAUDE_CODE_USE_COPILOT === '1' ||
    process.env.CLAUDE_CODE_USE_BEDROCK === '1' ||
    process.env.CLAUDE_CODE_USE_VERTEX === '1' ||
    process.env.CLAUDE_CODE_USE_FOUNDRY === '1'
  ) {
    return 'same-provider-retry'
  }
  return 'cross-provider'
}

// ── Error classification ─────────────────────────────────────

function isRetryableError(error: string): boolean {
  const patterns = ['429', '500', '502', '503', 'ETIMEDOUT', 'ECONNRESET',
    'ECONNREFUSED', 'overloaded', 'rate_limit', 'capacity']
  const lower = error.toLowerCase()
  return patterns.some(p => lower.includes(p.toLowerCase()))
}

function isNonRetryableError(error: string): boolean {
  const patterns = ['authentication_error', 'invalid_api_key', 'permission_denied',
    'content_policy', 'invalid_request']
  const lower = error.toLowerCase()
  return patterns.some(p => lower.includes(p.toLowerCase()))
}

// ── Safe replay boundary ─────────────────────────────────────

/**
 * Determine if the current request state allows retry/fallback.
 *
 * Core safety invariant: once output has been emitted to the user or
 * a tool side effect has started, we cannot silently restart the request
 * with a different provider without risking duplicate output or actions.
 */
export function canSafelyReplay(state: RequestState): {
  allowed: boolean
  reason: string
} {
  switch (state) {
    case 'request_created':
    case 'in_flight_no_output':
      return { allowed: true, reason: 'no output emitted, no side effects' }
    case 'first_token_emitted':
      return { allowed: false, reason: 'tokens already sent to user — would cause duplicate output' }
    case 'tool_call_started':
      return { allowed: false, reason: 'tool side effect in progress — would risk duplicate execution' }
    case 'tool_call_completed':
      return { allowed: false, reason: 'tool completed — context already has tool result' }
    case 'completed':
      return { allowed: false, reason: 'request already completed' }
    case 'failed':
      return { allowed: true, reason: 'request failed before output — safe to retry' }
  }
}

// ── Event log ────────────────────────────────────────────────

const fallbackEvents: FallbackEvent[] = []
const MAX_EVENTS = 100

function recordEvent(event: FallbackEvent): void {
  fallbackEvents.push(event)
  if (fallbackEvents.length > MAX_EVENTS) fallbackEvents.splice(0, fallbackEvents.length - MAX_EVENTS)
  logForDebugging(`[Fallback] ${event.outcome}: ${event.reason} (${event.originalProvider} → ${event.selectedProvider ?? 'none'})`)
}

export function getFallbackEvents(): readonly FallbackEvent[] {
  return fallbackEvents
}

export function getLastFallbackEvent(): FallbackEvent | null {
  return fallbackEvents.length > 0 ? fallbackEvents[fallbackEvents.length - 1]! : null
}

// ── Main decision function ───────────────────────────────────

type FallbackInput = {
  requestId: string
  error: string
  currentProvider: ProviderId
  requestState: RequestState
  requiredCapabilities: RequestCapability[]
  attemptsSoFar: number
  maxAttempts?: number
  fallbackChain?: ProviderId[]
}

export function decideFallback(input: FallbackInput): FallbackDecision {
  const {
    requestId,
    error,
    currentProvider,
    requestState,
    requiredCapabilities,
    attemptsSoFar,
    maxAttempts = 3,
    fallbackChain = [],
  } = input

  const policy = resolveFallbackPolicy()
  const replay = canSafelyReplay(requestState)
  const streamHadOutput = requestState === 'first_token_emitted' || requestState === 'tool_call_started' || requestState === 'tool_call_completed' || requestState === 'completed'
  const toolStarted = requestState === 'tool_call_started' || requestState === 'tool_call_completed'

  const baseEvent: Omit<FallbackEvent, 'outcome' | 'selectedProvider'> = {
    timestamp: new Date().toISOString(),
    requestId,
    requestState,
    originalProvider: currentProvider,
    fallbackChain: [...fallbackChain, currentProvider],
    reason: error.slice(0, 200),
    retryCount: attemptsSoFar,
    safeReplayAllowed: replay.allowed,
    streamHadOutput,
    toolSideEffectStarted: toolStarted,
  }

  // Not safe to replay
  if (!replay.allowed) {
    const event: FallbackEvent = { ...baseEvent, selectedProvider: null, outcome: 'fail_closed' }
    recordEvent(event)
    return { shouldRetry: false, nextProvider: null, reason: `Fail closed: ${replay.reason}`, event }
  }

  // Non-retryable error
  if (isNonRetryableError(error)) {
    const event: FallbackEvent = { ...baseEvent, selectedProvider: null, outcome: 'fail_closed' }
    recordEvent(event)
    return { shouldRetry: false, nextProvider: null, reason: `Non-retryable: ${error.slice(0, 100)}`, event }
  }

  // Not retryable at all
  if (!isRetryableError(error)) {
    const event: FallbackEvent = { ...baseEvent, selectedProvider: null, outcome: 'fail_closed' }
    recordEvent(event)
    return { shouldRetry: false, nextProvider: null, reason: `Not retryable: ${error.slice(0, 100)}`, event }
  }

  // Budget exhausted
  if (attemptsSoFar >= maxAttempts) {
    const event: FallbackEvent = { ...baseEvent, selectedProvider: null, outcome: 'fail_closed' }
    recordEvent(event)
    return { shouldRetry: false, nextProvider: null, reason: `Budget exhausted (${attemptsSoFar}/${maxAttempts})`, event }
  }

  // Strict policy: no fallback at all
  if (policy === 'strict') {
    const event: FallbackEvent = { ...baseEvent, selectedProvider: null, outcome: 'policy_block' }
    recordEvent(event)
    return { shouldRetry: false, nextProvider: null, reason: 'Policy: strict — no fallback allowed', event }
  }

  // Same-provider retry: retry current provider only
  if (policy === 'same-provider-retry') {
    const event: FallbackEvent = { ...baseEvent, selectedProvider: currentProvider, outcome: 'retry' }
    recordEvent(event)
    return { shouldRetry: true, nextProvider: currentProvider, reason: `Same-provider retry (attempt ${attemptsSoFar + 1})`, event }
  }

  // Cross-provider: find capable, authenticated, healthy alternative
  const tried = new Set(fallbackChain)
  const candidates = getAuthenticatedProviders()
    .filter(id => !tried.has(id) || id === currentProvider)
    .filter(id => providerSupportsCapabilities(id, requiredCapabilities))

  if (candidates.length === 0) {
    const event: FallbackEvent = { ...baseEvent, selectedProvider: null, outcome: 'capability_mismatch' }
    recordEvent(event)
    return { shouldRetry: false, nextProvider: null, reason: 'No capable fallback provider available', event }
  }

  // Prefer a different provider if current is in the tried set
  const otherCandidates = candidates.filter(id => id !== currentProvider)
  const next = otherCandidates.length > 0
    ? otherCandidates.sort((a, b) => {
        const ha = getProviderHealth(a)
        const hb = getProviderHealth(b)
        const order = { healthy: 0, degraded: 1, down: 2 }
        return (order[ha.status] ?? 3) - (order[hb.status] ?? 3)
      })[0]!
    : currentProvider // all others tried, retry current

  const outcome = next === currentProvider ? 'retry' : 'fallback'
  const event: FallbackEvent = { ...baseEvent, selectedProvider: next, outcome }
  recordEvent(event)

  recordFailure(currentProvider, error)

  return {
    shouldRetry: true,
    nextProvider: next,
    reason: `${outcome}: ${currentProvider} → ${next} (${error.slice(0, 60)})`,
    event,
  }
}

// ── Status ───────────────────────────────────────────────────

export function getFallbackStatus(): string {
  const providers = getAuthenticatedProviders()
  const policy = resolveFallbackPolicy()
  const last = getLastFallbackEvent()
  const lines = [
    `Policy: ${policy}`,
    `Providers: ${providers.length > 0 ? providers.join(' → ') : 'none authenticated'}`,
  ]
  if (last) {
    lines.push(`Last event: ${last.outcome} — ${last.reason.slice(0, 80)}`)
  }
  return lines.join('\n  ')
}
