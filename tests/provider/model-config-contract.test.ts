import { describe, expect, it } from 'bun:test'

import { getSupportedProviderIds } from '../../src/services/provider'
import { ALL_MODEL_CONFIGS } from '../../src/utils/model/configs'
import { getAPIProvider } from '../../src/utils/model/providers'

describe('model config/provider contract', () => {
  it('defines model ids for every supported provider', () => {
    const providerIds = getSupportedProviderIds()

    for (const [modelKey, config] of Object.entries(ALL_MODEL_CONFIGS)) {
      expect(Object.keys(config).sort(), `${modelKey} provider keys`).toEqual(
        [...providerIds].sort(),
      )
    }
  })

  it('resolves providers using the canonical registry ids and env priority order', () => {
    const providerEnvKeys = [
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_FOUNDRY',
      'CLAUDE_CODE_USE_OPENAI',
      'CLAUDE_CODE_USE_COPILOT',
    ] as const
    const originalEnv = Object.fromEntries(
      providerEnvKeys.map(key => [key, process.env[key]]),
    ) as Record<(typeof providerEnvKeys)[number], string | undefined>

    const restoreEnv = () => {
      for (const key of providerEnvKeys) {
        const value = originalEnv[key]
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    }

    const clearProviderEnv = () => {
      for (const key of providerEnvKeys) {
        delete process.env[key]
      }
    }

    clearProviderEnv()
    expect(getAPIProvider()).toBe('firstParty')

    process.env.CLAUDE_CODE_USE_COPILOT = '1'
    expect(getAPIProvider()).toBe('copilot')

    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    expect(getAPIProvider()).toBe('openai')

    process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
    expect(getAPIProvider()).toBe('foundry')

    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    expect(getAPIProvider()).toBe('vertex')

    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    expect(getAPIProvider()).toBe('bedrock')

    restoreEnv()
  })
})
