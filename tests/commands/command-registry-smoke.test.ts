import { describe, expect, it } from 'bun:test'

import { getBuiltinCommandNames } from '../../src/commands/registry/builtin.js'

describe('builtin command registry', () => {
  it('includes stable user-facing commands', () => {
    expect(
      getBuiltinCommandNames([
        { name: 'login' },
        { name: 'logout' },
        { name: 'status' },
        { name: 'model' },
      ] as any),
    ).toEqual(expect.arrayContaining(['login', 'logout', 'status', 'model']))
  })
})
