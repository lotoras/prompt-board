import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'

describe('accounts: env and paths', () => {
  let home: string

  beforeEach(async () => {
    vi.resetModules()
    home = await fs.mkdtemp(join(os.tmpdir(), 'acc-env-'))
    vi.spyOn(os, 'homedir').mockReturnValue(home)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(home, { recursive: true, force: true })
  })

  it('account 2 runs with its own config dir', async () => {
    const { withAccountEnv } = await import('../../src/main/accounts')
    expect(withAccountEnv({ A: '1' }, 2)).toEqual({ A: '1', CLAUDE_CONFIG_DIR: join(home, '.claude-2') })
  })

  it('account 1 never inherits a config dir', async () => {
    const { withAccountEnv } = await import('../../src/main/accounts')
    expect(withAccountEnv({ A: '1', CLAUDE_CONFIG_DIR: 'x' }, 1)).toEqual({ A: '1' })
  })

  it('tells which account owns a transcript path', async () => {
    const { accountOfPath } = await import('../../src/main/accounts')
    expect(accountOfPath(join(home, '.claude-2', 'projects', 'p', 's.jsonl'))).toBe(2)
    expect(accountOfPath(join(home, '.claude', 'projects', 'p', 's.jsonl'))).toBe(1)
  })

  it('account 1 is always available, account 2 only when its config dir exists', async () => {
    const { listAccounts } = await import('../../src/main/accounts')
    expect(listAccounts().map((a) => a.available)).toEqual([true, false])
    await fs.mkdir(join(home, '.claude-2'))
    expect(listAccounts()).toEqual([
      { id: 1, label: 'Claude 1', available: true },
      { id: 2, label: 'Claude 2', available: true }
    ])
  })
})
