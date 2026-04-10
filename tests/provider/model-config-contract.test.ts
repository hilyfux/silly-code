import { describe, expect, it } from 'bun:test'

import {
  getSupportedProviderIds,
  getProviderDescriptor,
  PROVIDER_REGISTRY,
} from '../../src/services/provider'

describe('provider contract', () => {
  it('every registered provider has required fields', () => {
    for (const id of getSupportedProviderIds()) {
      const desc = getProviderDescriptor(id)
      expect(desc.id).toBe(id)
      expect(typeof desc.name).toBe('string')
      expect(typeof desc.sonnetModel).toBe('string')
    }
  })

  it('registry covers exactly the declared ProviderId union', () => {
    const ids = getSupportedProviderIds()
    expect(ids).toContain('claude')
    expect(ids).toContain('codex')
    expect(ids).toContain('copilot')
    expect(ids.length).toBe(3)
  })

  it('PROVIDER_REGISTRY is consistent with accessor functions', () => {
    for (const [id, desc] of Object.entries(PROVIDER_REGISTRY)) {
      expect(getProviderDescriptor(id as any)).toBe(desc)
    }
  })
})
