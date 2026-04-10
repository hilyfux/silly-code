import { describe, expect, it } from 'bun:test'

import {
  getProviderDescriptor,
  getSupportedProviderIds,
} from '../../src/services/provider'

describe('provider registry', () => {
  it('returns canonical supported provider ids in order', () => {
    expect(getSupportedProviderIds()).toEqual([
      'firstParty',
      'bedrock',
      'vertex',
      'foundry',
      'openai',
      'copilot',
    ])
  })

  it('returns expected copilot descriptor', () => {
    expect(getProviderDescriptor('copilot')).toMatchObject({
      id: 'copilot',
      displayName: 'GitHub Copilot',
      usesSubscriptionAuth: true,
    })
  })
})
