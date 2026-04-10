/**
 * Provider Fallback Engine Eval
 *
 * Tests the decision function, capability filter, policy enforcement,
 * safe replay boundary, and structured event logging.
 */
import { describe, expect, it } from 'bun:test'
import {
  decideFallback,
  canSafelyReplay,
  resolveFallbackPolicy,
  providerSupportsCapabilities,
  getFallbackStatus,
  getFallbackEvents,
  type RequestState,
} from '../src/services/provider/fallback'

const base = {
  requestId: 'test-001',
  currentProvider: 'claude' as const,
  requiredCapabilities: [] as any[],
  attemptsSoFar: 0,
  maxAttempts: 3,
}

describe('fallback decision engine', () => {
  describe('retryable error classification', () => {
    it('429 is retryable', () => {
      const d = decideFallback({ ...base, error: '429 Too Many Requests', requestState: 'in_flight_no_output' })
      expect(d.shouldRetry).toBe(true)
    })

    it('500 is retryable', () => {
      const d = decideFallback({ ...base, error: '500 Internal Server Error', requestState: 'in_flight_no_output' })
      expect(d.shouldRetry).toBe(true)
    })

    it('ETIMEDOUT is retryable', () => {
      const d = decideFallback({ ...base, error: 'ETIMEDOUT', requestState: 'in_flight_no_output' })
      expect(d.shouldRetry).toBe(true)
    })
  })

  describe('non-retryable errors', () => {
    it('auth error → fail closed', () => {
      const d = decideFallback({ ...base, error: 'authentication_error', requestState: 'in_flight_no_output' })
      expect(d.shouldRetry).toBe(false)
      expect(d.event.outcome).toBe('fail_closed')
    })

    it('content policy → fail closed', () => {
      const d = decideFallback({ ...base, error: 'content_policy', requestState: 'in_flight_no_output' })
      expect(d.shouldRetry).toBe(false)
    })
  })

  describe('safe replay boundary (state machine)', () => {
    const safeStates: RequestState[] = ['request_created', 'in_flight_no_output', 'failed']
    const unsafeStates: RequestState[] = ['first_token_emitted', 'tool_call_started', 'tool_call_completed', 'completed']

    for (const s of safeStates) {
      it(`${s} → replay allowed`, () => {
        expect(canSafelyReplay(s).allowed).toBe(true)
      })
    }
    for (const s of unsafeStates) {
      it(`${s} → replay blocked`, () => {
        expect(canSafelyReplay(s).allowed).toBe(false)
      })
    }

    it('after first token emitted, fallback is fail_closed', () => {
      const d = decideFallback({ ...base, error: '429', requestState: 'first_token_emitted' })
      expect(d.shouldRetry).toBe(false)
      expect(d.event.outcome).toBe('fail_closed')
      expect(d.event.streamHadOutput).toBe(true)
    })

    it('after tool call started, fallback is fail_closed', () => {
      const d = decideFallback({ ...base, error: '429', requestState: 'tool_call_started' })
      expect(d.shouldRetry).toBe(false)
      expect(d.event.toolSideEffectStarted).toBe(true)
    })
  })

  describe('capability filter', () => {
    it('claude supports all capabilities', () => {
      expect(providerSupportsCapabilities('claude', ['streaming', 'tool_use', 'long_context', 'image_input'])).toBe(true)
    })

    it('codex lacks image_input', () => {
      expect(providerSupportsCapabilities('codex', ['image_input'])).toBe(false)
    })

    it('copilot lacks long_context', () => {
      expect(providerSupportsCapabilities('copilot', ['long_context'])).toBe(false)
    })

    it('fallback rejects provider missing required capability', () => {
      const d = decideFallback({
        ...base,
        error: '429',
        requestState: 'in_flight_no_output',
        requiredCapabilities: ['image_input'],
        currentProvider: 'codex',
        fallbackChain: ['claude', 'codex'], // all tried
      })
      // copilot also doesn't have image_input, so no viable fallback
      // (claude was already tried per fallbackChain)
      expect(d.event.outcome).toBe('capability_mismatch')
    })
  })

  describe('policy enforcement', () => {
    it('strict policy blocks all fallback', () => {
      const orig = process.env.CLAUDE_CODE_FALLBACK_POLICY
      process.env.CLAUDE_CODE_FALLBACK_POLICY = 'strict'
      const d = decideFallback({ ...base, error: '429', requestState: 'in_flight_no_output' })
      expect(d.shouldRetry).toBe(false)
      expect(d.event.outcome).toBe('policy_block')
      if (orig === undefined) delete process.env.CLAUDE_CODE_FALLBACK_POLICY
      else process.env.CLAUDE_CODE_FALLBACK_POLICY = orig
    })

    it('same-provider-retry only retries current provider', () => {
      const orig = process.env.CLAUDE_CODE_FALLBACK_POLICY
      process.env.CLAUDE_CODE_FALLBACK_POLICY = 'same-provider-retry'
      const d = decideFallback({ ...base, error: '429', requestState: 'in_flight_no_output' })
      expect(d.shouldRetry).toBe(true)
      expect(d.nextProvider).toBe('claude')
      expect(d.event.outcome).toBe('retry')
      if (orig === undefined) delete process.env.CLAUDE_CODE_FALLBACK_POLICY
      else process.env.CLAUDE_CODE_FALLBACK_POLICY = orig
    })

    it('resolveFallbackPolicy reads env var', () => {
      const orig = process.env.CLAUDE_CODE_FALLBACK_POLICY
      process.env.CLAUDE_CODE_FALLBACK_POLICY = 'strict'
      expect(resolveFallbackPolicy()).toBe('strict')
      if (orig === undefined) delete process.env.CLAUDE_CODE_FALLBACK_POLICY
      else process.env.CLAUDE_CODE_FALLBACK_POLICY = orig
    })
  })

  describe('structured event logging', () => {
    it('every decision produces a FallbackEvent', () => {
      decideFallback({ ...base, error: '429', requestState: 'in_flight_no_output', requestId: 'evt-test' })
      const events = getFallbackEvents()
      const last = events[events.length - 1]!
      expect(last.requestId).toBe('evt-test')
      expect(last.timestamp).toBeTruthy()
      expect(last.originalProvider).toBe('claude')
      expect(['retry', 'fallback', 'fail_closed', 'policy_block', 'capability_mismatch']).toContain(last.outcome)
      expect(typeof last.safeReplayAllowed).toBe('boolean')
      expect(typeof last.streamHadOutput).toBe('boolean')
      expect(typeof last.toolSideEffectStarted).toBe('boolean')
    })

    it('event includes full fallback chain', () => {
      const d = decideFallback({
        ...base,
        error: '429',
        requestState: 'in_flight_no_output',
        fallbackChain: ['claude'],
        currentProvider: 'codex',
      })
      expect(d.event.fallbackChain).toContain('claude')
      expect(d.event.fallbackChain).toContain('codex')
    })
  })

  describe('budget enforcement', () => {
    it('stops after max attempts', () => {
      const d = decideFallback({ ...base, error: '429', requestState: 'in_flight_no_output', attemptsSoFar: 3, maxAttempts: 3 })
      expect(d.shouldRetry).toBe(false)
      expect(d.reason).toContain('Budget exhausted')
    })
  })

  describe('status', () => {
    it('returns structured status', () => {
      const s = getFallbackStatus()
      expect(s).toContain('Policy')
      expect(s).toContain('Providers')
    })
  })
})
