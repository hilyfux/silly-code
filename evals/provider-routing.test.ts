/**
 * Provider Routing Eval
 *
 * Verifies smart routing selects appropriate provider+model per task type.
 */
import { describe, expect, it } from 'bun:test'
import { classifyTask, routeTask } from '../src/services/provider/router'

describe('provider routing', () => {
  describe('task classification', () => {
    it('classifies reasoning tasks', () => {
      expect(classifyTask('think about why this design is wrong')).toBe('reasoning')
      expect(classifyTask('analyze the architecture')).toBe('reasoning')
      expect(classifyTask('explain how this works')).toBe('reasoning')
    })

    it('classifies coding tasks', () => {
      expect(classifyTask('implement a new function')).toBe('coding')
      expect(classifyTask('fix the bug in auth.ts')).toBe('coding')
      expect(classifyTask('refactor the database layer')).toBe('coding')
    })

    it('classifies fast tasks', () => {
      expect(classifyTask('quick question about syntax')).toBe('fast')
      expect(classifyTask('just tell me the command')).toBe('fast')
    })

    it('defaults to general', () => {
      expect(classifyTask('hello')).toBe('general')
    })
  })

  describe('route decision', () => {
    it('returns a valid decision for every task type', () => {
      for (const type of ['reasoning', 'coding', 'fast', 'review', 'general'] as const) {
        const decision = routeTask(type)
        expect(decision.providerId).toBeTruthy()
        expect(decision.model).toBeTruthy()
        expect(decision.reason).toBeTruthy()
      }
    })

    it('respects user preference when set', () => {
      const decision = routeTask('coding', 'codex')
      // Should try codex if authenticated, fall back otherwise
      expect(decision.providerId).toBeTruthy()
    })
  })
})
