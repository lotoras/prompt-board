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
})
