import { describe, expect, it, vi } from 'vitest'
import type { SessionInfo, SessionStatus, SessionsSnapshot } from '../../src/shared/types'

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    pid: 1000,
    sessionId: 'session-1',
    cwd: 'C:\\a\\proj',
    status: 'idle' as SessionStatus,
    startedAt: 1000,
    updatedAt: 1000,
    statusUpdatedAt: 1000,
    ...overrides
  }
}

function makeSnapshot(sessions: SessionInfo[], projectKey = 'proj-1'): SessionsSnapshot {
  return {
    projects: [
      {
        projectKey,
        name: 'Project',
        source: 'auto',
        needsAttention: false,
        sessions
      }
    ]
  }
}

describe('pty/reconcile', () => {
  async function loadReconcile() {
    return import('../../src/main/pty/reconcile')
  }

  describe('edge cases / failure', () => {
    it('preclaimSession skips that session so the pending spawn claims the next candidate', async () => {
      const { registerPendingSpawn, preclaimSession, reconcilePendingSpawns } = await loadReconcile()
      const preclaimed = makeSession({ sessionId: 'preclaimed-1', startedAt: 4000 })
      const other = makeSession({ sessionId: 'other-1', startedAt: 5000 })
      preclaimSession('preclaimed-1')
      registerPendingSpawn('pty-1', 'proj-1', 3000)

      const send = vi.fn()
      const win = { isDestroyed: () => false, webContents: { send } }
      reconcilePendingSpawns(makeSnapshot([preclaimed, other]), () => win as never)

      expect(send).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith(expect.any(String), {
        ptyId: 'pty-1',
        sessionId: 'other-1'
      })
    })
  })

  describe('resume grace window', () => {
    it('links immediately when the expected session is already live', async () => {
      const { registerPendingSpawn, reconcilePendingSpawns } = await loadReconcile()
      const spawnedAt = Date.now()
      const expected = makeSession({ sessionId: 'resumed-1', startedAt: spawnedAt - 60000 })
      registerPendingSpawn('pty-r1', 'proj-1', spawnedAt, 'resumed-1')

      const send = vi.fn()
      const win = { isDestroyed: () => false, webContents: { send } }
      reconcilePendingSpawns(makeSnapshot([expected]), () => win as never)

      expect(send).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith(expect.any(String), {
        ptyId: 'pty-r1',
        sessionId: 'resumed-1'
      })
    })

    it('claims nothing inside the grace window when the expected session is not yet live, even if an unrelated session is available', async () => {
      const { registerPendingSpawn, reconcilePendingSpawns } = await loadReconcile()
      const unrelated = makeSession({ sessionId: 'unrelated-1', startedAt: Date.now() })
      registerPendingSpawn('pty-r2', 'proj-1', Date.now(), 'still-booting')

      const send = vi.fn()
      const win = { isDestroyed: () => false, webContents: { send } }
      reconcilePendingSpawns(makeSnapshot([unrelated]), () => win as never)

      expect(send).not.toHaveBeenCalled()
    })

    it('falls back to the generic oldest-unclaimed rule once the grace window elapses', async () => {
      const { registerPendingSpawn, reconcilePendingSpawns } = await loadReconcile()
      const spawnedAt = Date.now() - 20000
      const repaired = makeSession({ sessionId: 'new-session', startedAt: spawnedAt + 500 })
      registerPendingSpawn('pty-r3', 'proj-1', spawnedAt, 'stale-expected-id')

      const send = vi.fn()
      const win = { isDestroyed: () => false, webContents: { send } }
      reconcilePendingSpawns(makeSnapshot([repaired]), () => win as never)

      expect(send).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith(expect.any(String), {
        ptyId: 'pty-r3',
        sessionId: 'new-session'
      })
    })
  })
})
