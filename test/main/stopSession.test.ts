import { describe, expect, it, vi } from 'vitest'
import { stopSessionProcess, type StopDeps } from '../../src/main/sessions/stopSession'
import type { SessionInfo } from '../../src/shared/types'

const SESSION: SessionInfo = {
  pid: 4242,
  sessionId: 's-1',
  cwd: 'C:\\work\\p1',
  status: 'busy',
  startedAt: 1,
  updatedAt: 2,
  statusUpdatedAt: 2
}

function deps(alive: boolean[], overrides: Partial<StopDeps> = {}): StopDeps {
  const answers = [...alive]
  return {
    isAlive: vi.fn(async () => answers.shift() ?? false),
    killTree: vi.fn(async () => undefined),
    sleep: vi.fn(async () => undefined),
    selfPid: 1,
    ...overrides
  }
}

describe('stopSessionProcess', () => {
  it('stops a live session process and waits until it is gone', async () => {
    const d = deps([true, true, false])
    await stopSessionProcess(SESSION, d)
    expect(d.killTree).toHaveBeenCalledWith(4242)
    expect(d.sleep).toHaveBeenCalled()
  })

  it('does nothing when the process is already gone', async () => {
    const d = deps([false])
    await stopSessionProcess(SESSION, d)
    expect(d.killTree).not.toHaveBeenCalled()
  })

  it("refuses to stop this app's own process", async () => {
    const d = deps([true], { selfPid: 4242 })
    await expect(stopSessionProcess(SESSION, d)).rejects.toThrow(/this app/i)
    expect(d.killTree).not.toHaveBeenCalled()
  })

  it('reports an error when the process will not stop', async () => {
    const d = deps(new Array(200).fill(true))
    await expect(stopSessionProcess(SESSION, d)).rejects.toThrow(/could not stop/i)
  })

  it('still confirms the process is gone when the kill command fails', async () => {
    const d = deps([true, false], { killTree: vi.fn(async () => Promise.reject(new Error('not found'))) })
    await expect(stopSessionProcess(SESSION, d)).resolves.toBeUndefined()
  })
})
