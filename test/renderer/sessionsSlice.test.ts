// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectView, SessionsSnapshot } from '../../src/shared/types'

const { acknowledge, unacknowledge, list } = vi.hoisted(() => ({
  acknowledge: vi.fn(),
  unacknowledge: vi.fn(),
  list: vi.fn()
}))

vi.mock('../../src/renderer/src/lib/api', () => ({
  api: { sessions: { acknowledge, unacknowledge, list } }
}))

import { useStore } from '../../src/renderer/src/store'

function makeProject(acknowledged: boolean): ProjectView {
  return {
    projectKey: 'p1',
    name: 'p1',
    source: 'auto',
    needsAttention: !acknowledged,
    sessions: [
      {
        pid: 1,
        sessionId: 's1',
        cwd: 'C:\\p1',
        status: 'waiting',
        startedAt: 1,
        updatedAt: 1,
        statusUpdatedAt: 5,
        acknowledged
      }
    ]
  }
}

function makeSnapshot(acknowledged = false): SessionsSnapshot {
  return { projects: [makeProject(acknowledged)] }
}

describe('sessionsSlice acknowledge actions', () => {
  beforeEach(() => {
    acknowledge.mockReset()
    unacknowledge.mockReset()
    list.mockReset()
    useStore.getState().setSnapshot(makeSnapshot())
  })

  it('optimistically flips acknowledged and needsAttention before the api resolves', async () => {
    let resolve!: () => void
    acknowledge.mockReturnValue(new Promise<void>((r) => (resolve = r)))

    const pending = useStore.getState().acknowledgeSession('s1', 5)

    const p = useStore.getState().snapshot.projects[0]
    expect(p.sessions[0].acknowledged).toBe(true)
    expect(p.needsAttention).toBe(false)
    expect(acknowledge).toHaveBeenCalledWith('s1', 5)

    resolve()
    await pending
  })

  it('optimistically restores attention on unacknowledgeSession', async () => {
    useStore.getState().setSnapshot(makeSnapshot(true))
    unacknowledge.mockResolvedValue(undefined)

    const pending = useStore.getState().unacknowledgeSession('s1')
    const p = useStore.getState().snapshot.projects[0]
    expect(p.sessions[0].acknowledged).toBe(false)
    expect(p.needsAttention).toBe(true)
    await pending
    expect(unacknowledge).toHaveBeenCalledWith('s1')
  })

  it('logs instead of throwing when the api call rejects (main re-emits the truth)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    acknowledge.mockRejectedValue(new Error('boom'))

    await expect(useStore.getState().acknowledgeSession('s1', 5)).resolves.toBeUndefined()

    expect(error).toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  })
})
