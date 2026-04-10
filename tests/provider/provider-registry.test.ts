import { describe, expect, it } from 'bun:test'

import {
  getProviderDescriptor,
  getSupportedProviderIds,
} from '../../src/services/provider'

describe('provider registry', () => {
  it('returns canonical supported provider ids', () => {
    expect(getSupportedProviderIds()).toEqual(['claude', 'codex', 'copilot'])
  })

  it('returns expected copilot descriptor', () => {
    expect(getProviderDescriptor('copilot')).toMatchObject({
      id: 'copilot',
      name: 'GitHub Copilot',
    })
  })
})
