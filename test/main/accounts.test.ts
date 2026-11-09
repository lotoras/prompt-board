import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import os from 'os'
import { join } from 'path'

describe('accounts', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.spyOn(os, 'homedir').mockReturnValue(join(os.tmpdir(), 'acc-home'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accountConfigDir maps 1 to ~/.claude and 2 to ~/.claude-2', async () => {
    const { accountConfigDir } = await import('../../src/main/accounts')
    expect(accountConfigDir(1)).toBe(join(os.tmpdir(), 'acc-home', '.claude'))
    expect(accountConfigDir(2)).toBe(join(os.tmpdir(), 'acc-home', '.claude-2'))
  })

  it('accountLauncher maps 1 to clauded and 2 to clauded2', async () => {
    const { accountLauncher } = await import('../../src/main/accounts')
    expect(accountLauncher(1)).toBe('clauded')
    expect(accountLauncher(2)).toBe('clauded2')
  })
})
