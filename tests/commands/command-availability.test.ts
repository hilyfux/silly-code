import { describe, expect, it, mock } from 'bun:test'
import type { Command } from '../../src/types/command.js'

const authMocks = {
  isUsing3PServices: mock(() => false),
  isClaudeAISubscriber: mock(() => false),
}

const providerMocks = {
  isFirstPartyAnthropicBaseUrl: mock(() => true),
}

mock.module('../../src/utils/auth.js', () => authMocks)
mock.module('../../src/utils/model/providers.js', () => providerMocks)

const { meetsAvailabilityRequirement } = await import('../../src/commands/registry/availability.js')

describe('meetsAvailabilityRequirement', () => {
  it('returns true for commands without availability requirements', () => {
    const command = {
      type: 'local',
      name: 'example',
      description: 'Example command',
      isEnabled: () => true,
      userFacingName() {
        return this.name
      },
      call: async () => ({
        type: 'message',
        messageType: 'info',
        message: 'ok',
      }),
    } as Command

    expect(meetsAvailabilityRequirement(command)).toBe(true)
  })
})
