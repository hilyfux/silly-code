/**
 * Provider Fallback Engine Eval
 *
 * Verifies the multi-provider fallback logic — Silly Code's core differentiator.
 * Claude Code has exactly one provider and CANNOT do any of this.
 */
import { describe, expect, it } from 'bun:test'
import { createFallbackState, decideFallback, getFallbackStatus } from '../src/services/provider/fallback'

describe('provider fallback engine', () => {
  describe('retryable error detection', () => {
    it('identifies 429 rate limit as retryable', () => {
      const state = createFallbackState('claude')
      const decision = decideFallback(state, 'Error: 429 Too Many Requests')
      expect(decision.shouldFallback).toBe(true)
    })

    it('identifies 500 server error as retryable', () => {
      const state = createFallbackState('claude')
      const decision = decideFallback(state, 'Error: 500 Internal Server Error')
      expect(decision.shouldFallback).toBe(true)
    })

    it('identifies timeout as retryable', () => {
      const state = createFallbackState('claude')
      const decision = decideFallback(state, 'ETIMEDOUT: connection timed out')
      expect(decision.shouldFallback).toBe(true)
    })

    it('identifies overloaded as retryable', () => {
      const state = createFallbackState('claude')
      const decision = decideFallback(state, 'Anthropic API is overloaded')
      expect(decision.shouldFallback).toBe(true)
    })
  })

  describe('non-retryable error detection', () => {
    it('rejects auth errors', () => {
      const state = createFallbackState('claude')
      const decision = decideFallback(state, 'authentication_error: invalid key')
      expect(decision.shouldFallback).toBe(false)
      expect(decision.reason).toContain('Non-retryable')
    })

    it('rejects content policy errors', () => {
      const state = createFallbackState('claude')
      const decision = decideFallback(state, 'content_policy violation')
      expect(decision.shouldFallback).toBe(false)
    })
  })

  describe('fallback progression', () => {
    it('retries same provider first before switching', () => {
      const state = createFallbackState('claude')
      const d1 = decideFallback(state, '429 rate limited')
      expect(d1.shouldFallback).toBe(true)
      expect(d1.nextProvider).toBe('claude') // retry same first
    })

    it('respects max total attempts', () => {
      const state = createFallbackState('claude')
      state.maxTotalAttempts = 2
      decideFallback(state, '429')
      decideFallback(state, '429')
      const d3 = decideFallback(state, '429')
      expect(d3.shouldFallback).toBe(false)
      expect(d3.reason).toContain('Max total attempts')
    })

    it('every decision includes attempt number', () => {
      const state = createFallbackState('claude')
      const d1 = decideFallback(state, '429')
      expect(d1.attempt).toBe(1)
      const d2 = decideFallback(state, '429')
      expect(d2.attempt).toBe(2)
    })
  })

  describe('fallback status', () => {
    it('reports current fallback readiness', () => {
      const status = getFallbackStatus()
      expect(typeof status).toBe('string')
      expect(status).toContain('Fallback')
    })
  })
})
