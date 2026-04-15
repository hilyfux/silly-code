import { describe, expect, it } from 'bun:test'

import {
  getProviderDescriptor,
  getSupportedProviderIds,
} from '../../src/services/provider'

describe('provider registry', () => {
  it('returns canonical supported provider ids', () => {
    expect(getSupportedProviderIds()).toEqual(['claude', 'codex'])
  })

  it('returns expected codex descriptor', () => {
    expect(getProviderDescriptor('codex')).toMatchObject({
      id: 'codex',
      name: 'OpenAI Codex',
    })
  })
})
