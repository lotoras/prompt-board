import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalMeta } from '../../src/renderer/src/store/terminalsSlice'

const { spawn, kill } = vi.hoisted(() => ({ spawn: vi.fn(), kill: vi.fn() }))

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: { pty: { spawn, kill } }
}))

import { reloadTerminal } from '../../src/renderer/src/features/terminal/reloadTerminal'

const PROJECT_KEY = 'proj-1'

function makeTerminal(overrides: Partial<TerminalMeta> = {}): TerminalMeta {
  return {
    ptyId: 'old-pty',
    projectKey: PROJECT_KEY,
    title: 'My Terminal',
    status: 'running',
    sessionId: 'sess-1',
    ...overrides
  }
}

describe('reloadTerminal', () => {
  let addTerminal: ReturnType<typeof vi.fn>
  let closeTerminal: ReturnType<typeof vi.fn>

  beforeEach(() => {
    spawn.mockReset()
    kill.mockReset()
    spawn.mockResolvedValue({ ptyId: 'new-pty' })
    kill.mockResolvedValue(undefined)
    addTerminal = vi.fn()
    closeTerminal = vi.fn()
  })

  it('kills the old pty for a running terminal', async () => {
    const terminal = makeTerminal({ status: 'running' })

    await reloadTerminal(terminal, 'resume', { addTerminal, closeTerminal })

    expect(kill).toHaveBeenCalledWith('old-pty')
    expect(spawn).toHaveBeenCalled()
  })

  it('does not kill the old pty for an exited terminal', async () => {
    const terminal = makeTerminal({ status: 'exited' })

    await reloadTerminal(terminal, 'resume', { addTerminal, closeTerminal })

    expect(kill).not.toHaveBeenCalled()
    expect(spawn).toHaveBeenCalled()
  })

  it('spawns with resumeSessionId equal to the terminal sessionId in resume mode', async () => {
    const terminal = makeTerminal({ sessionId: 'sess-42' })

    await reloadTerminal(terminal, 'resume', { addTerminal, closeTerminal })

    expect(spawn).toHaveBeenCalledWith({
      projectKey: PROJECT_KEY,
      resumeSessionId: 'sess-42'
    })
  })

  it('spawns with resumeSessionId undefined in fresh mode', async () => {
    const terminal = makeTerminal({ sessionId: 'sess-42' })

    await reloadTerminal(terminal, 'fresh', { addTerminal, closeTerminal })

    expect(spawn).toHaveBeenCalledWith({
      projectKey: PROJECT_KEY,
      resumeSessionId: undefined
    })
  })

  it('adds the new terminal and closes the old one', async () => {
    const terminal = makeTerminal({ ptyId: 'old-pty', title: 'My Terminal' })

    await reloadTerminal(terminal, 'resume', { addTerminal, closeTerminal })

    expect(addTerminal).toHaveBeenCalledWith({
      ptyId: 'new-pty',
      projectKey: PROJECT_KEY,
      title: 'My Terminal',
      status: 'running',
      sessionId: 'sess-1'
    })
    expect(closeTerminal).toHaveBeenCalledWith('old-pty')
  })

  it('forwards undefined sessionId to addTerminal in fresh mode', async () => {
    const terminal = makeTerminal({ sessionId: 'sess-42' })

    await reloadTerminal(terminal, 'fresh', { addTerminal, closeTerminal })

    expect(addTerminal).toHaveBeenCalledWith({
      ptyId: 'new-pty',
      projectKey: PROJECT_KEY,
      title: 'My Terminal',
      status: 'running',
      sessionId: undefined
    })
  })
})
