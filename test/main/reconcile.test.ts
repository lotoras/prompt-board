import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  beforeEach(() => {
    vi.resetModules()
  })

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

  describe('early claim', () => {
    it('does not claim before EARLY_CLAIM_MIN_MS even with a single unambiguous candidate', async () => {
      const { registerPendingSpawn, reconcilePendingSpawns } = await loadReconcile()
      const spawnedAt = Date.now() - 2000
      const candidate = makeSession({ sessionId: 'forked-1', startedAt: spawnedAt + 100 })
      registerPendingSpawn('pty-e1', 'proj-1', spawnedAt, 'still-booting')

      const send = vi.fn()
      const win = { isDestroyed: () => false, webContents: { send } }
      reconcilePendingSpawns(makeSnapshot([candidate]), () => win as never)

      expect(send).not.toHaveBeenCalled()
    })

    it('claims early with the new id once elapsed and exactly one candidate is unambiguous', async () => {
      const { registerPendingSpawn, reconcilePendingSpawns } = await loadReconcile()
      const spawnedAt = Date.now() - 3000
      const candidate = makeSession({ sessionId: 'forked-1', startedAt: spawnedAt + 100 })
      registerPendingSpawn('pty-e2', 'proj-1', spawnedAt, 'still-booting')

      const send = vi.fn()
      const win = { isDestroyed: () => false, webContents: { send } }
      reconcilePendingSpawns(makeSnapshot([candidate]), () => win as never)

      expect(send).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith(expect.any(String), {
        ptyId: 'pty-e2',
        sessionId: 'forked-1'
      })
    })

    it('does not claim early with two unclaimed candidates, but falls back once the grace window elapses', async () => {
      const { registerPendingSpawn, reconcilePendingSpawns } = await loadReconcile()
      const spawnedAt = Date.now() - 3000
      const first = makeSession({ sessionId: 'candidate-a', startedAt: spawnedAt + 100 })
      const second = makeSession({ sessionId: 'candidate-b', startedAt: spawnedAt + 200 })
      registerPendingSpawn('pty-e3', 'proj-1', spawnedAt, 'still-booting')

      const send = vi.fn()
      const win = { isDestroyed: () => false, webContents: { send } }
      reconcilePendingSpawns(makeSnapshot([first, second]), () => win as never)
      expect(send).not.toHaveBeenCalled()

      send.mockClear()
      const laterSpawnedAt = Date.now() - 20000
      registerPendingSpawn('pty-e3', 'proj-1', laterSpawnedAt, 'still-booting')
      const firstLate = makeSession({ sessionId: 'candidate-a', startedAt: laterSpawnedAt + 100 })
      const secondLate = makeSession({ sessionId: 'candidate-b', startedAt: laterSpawnedAt + 200 })
      reconcilePendingSpawns(makeSnapshot([firstLate, secondLate]), () => win as never)

      expect(send).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith(expect.any(String), {
        ptyId: 'pty-e3',
        sessionId: 'candidate-a'
      })
    })

    it('does not claim early when a second pending spawn exists in the same project', async () => {
      const { registerPendingSpawn, reconcilePendingSpawns } = await loadReconcile()
      const spawnedAt = Date.now() - 3000
      const candidate = makeSession({ sessionId: 'forked-1', startedAt: spawnedAt + 100 })
      registerPendingSpawn('pty-e4', 'proj-1', spawnedAt, 'still-booting')
      registerPendingSpawn('pty-e4b', 'proj-1', spawnedAt, 'also-booting')

      const send = vi.fn()
      const win = { isDestroyed: () => false, webContents: { send } }
      reconcilePendingSpawns(makeSnapshot([candidate]), () => win as never)

      expect(send).not.toHaveBeenCalled()
    })

    it('does not claim a candidate that started too long after the spawn', async () => {
      const { registerPendingSpawn, reconcilePendingSpawns } = await loadReconcile()
      const spawnedAt = Date.now() - 3000
      const tooLate = makeSession({ sessionId: 'late-1', startedAt: spawnedAt + 10001 })
      registerPendingSpawn('pty-e5', 'proj-1', spawnedAt, 'still-booting')

      const send = vi.fn()
      const win = { isDestroyed: () => false, webContents: { send } }
      reconcilePendingSpawns(makeSnapshot([tooLate]), () => win as never)

      expect(send).not.toHaveBeenCalled()
    })
  })

  describe('regression guards', () => {
    it('links immediately when the expected session is already live (no early-claim gating)', async () => {
      const { registerPendingSpawn, reconcilePendingSpawns } = await loadReconcile()
      const spawnedAt = Date.now()
      const expected = makeSession({ sessionId: 'resumed-2', startedAt: spawnedAt - 60000 })
      registerPendingSpawn('pty-g1', 'proj-1', spawnedAt, 'resumed-2')

      const send = vi.fn()
      const win = { isDestroyed: () => false, webContents: { send } }
      reconcilePendingSpawns(makeSnapshot([expected]), () => win as never)

      expect(send).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith(expect.any(String), {
        ptyId: 'pty-g1',
        sessionId: 'resumed-2'
      })
    })

    it('an already-claimed session is never reassigned to another pending spawn', async () => {
      const { registerPendingSpawn, preclaimSession, reconcilePendingSpawns } = await loadReconcile()
      const claimed = makeSession({ sessionId: 'claimed-already', startedAt: 4000 })
      preclaimSession('claimed-already')
      registerPendingSpawn('pty-g2', 'proj-1', 3000)

      const send = vi.fn()
      const win = { isDestroyed: () => false, webContents: { send } }
      reconcilePendingSpawns(makeSnapshot([claimed]), () => win as never)

      expect(send).not.toHaveBeenCalled()
    })
  })

  describe('pid-anchored bindings (refreshPtyBindings / releasePtyBinding / listPtyBindings)', () => {
    it('rotation heals: a bound terminal picks up a new sessionId under the same pid', async () => {
      const { registerPendingSpawn, reconcilePendingSpawns, refreshPtyBindings } = await loadReconcile()
      const pid = 2001
      const before = makeSession({ pid, sessionId: 'sess-a', startedAt: 1000 })
      registerPendingSpawn('pty-rot1', 'proj-1', 1000)

      const send = vi.fn()
      const win = { isDestroyed: () => false, webContents: { send } }
      reconcilePendingSpawns(makeSnapshot([before]), () => win as never)
      expect(send).toHaveBeenCalledTimes(1)
      send.mockClear()

      const after = makeSession({ pid, sessionId: 'sess-b', startedAt: 1000 })
      refreshPtyBindings(makeSnapshot([after]), () => win as never)

      expect(send).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith(expect.any(String), {
        ptyId: 'pty-rot1',
        sessionId: 'sess-b'
      })
    })

    it('no spam: refreshing with an unchanged snapshot does not re-emit', async () => {
      const { registerPendingSpawn, reconcilePendingSpawns, refreshPtyBindings } = await loadReconcile()
      const pid = 2002
      const session = makeSession({ pid, sessionId: 'sess-c', startedAt: 1000 })
      registerPendingSpawn('pty-nospam', 'proj-1', 1000)

      const send = vi.fn()
      const win = { isDestroyed: () => false, webContents: { send } }
      reconcilePendingSpawns(makeSnapshot([session]), () => win as never)
      send.mockClear()

      refreshPtyBindings(makeSnapshot([session]), () => win as never)

      expect(send).not.toHaveBeenCalled()
    })

    it('a rotated-away sessionId is not stealable by another pending spawn in the same project', async () => {
      const { registerPendingSpawn, reconcilePendingSpawns, refreshPtyBindings } = await loadReconcile()
      const pid = 2003
      const original = makeSession({ pid, sessionId: 'sess-d', startedAt: 1000 })
      registerPendingSpawn('pty-steal1', 'proj-1', 1000)

      const send = vi.fn()
      const win = { isDestroyed: () => false, webContents: { send } }
      reconcilePendingSpawns(makeSnapshot([original]), () => win as never)

      const rotated = makeSession({ pid, sessionId: 'sess-e', startedAt: 1000 })
      refreshPtyBindings(makeSnapshot([rotated]), () => win as never)
      send.mockClear()

      const other = makeSession({ pid: 9999, sessionId: 'sess-f', startedAt: 1000 })
      registerPendingSpawn('pty-steal2', 'proj-1', 1000)
      reconcilePendingSpawns(makeSnapshot([rotated, other]), () => win as never)

      expect(send).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith(expect.any(String), {
        ptyId: 'pty-steal2',
        sessionId: 'sess-f'
      })
    })

    it('a binding is retained (not dropped) while its pid is absent from the snapshot, and heals once the pid reappears', async () => {
      const { registerPendingSpawn, reconcilePendingSpawns, refreshPtyBindings, listPtyBindings } =
        await loadReconcile()
      const pid = 2004
      const original = makeSession({ pid, sessionId: 'sess-g', startedAt: 1000 })
      registerPendingSpawn('pty-absent', 'proj-1', 1000)

      const send = vi.fn()
      const win = { isDestroyed: () => false, webContents: { send } }
      reconcilePendingSpawns(makeSnapshot([original]), () => win as never)
      send.mockClear()

      const otherPidSession = makeSession({ pid: 3000, sessionId: 'sess-unrelated', startedAt: 1000 })
      refreshPtyBindings(makeSnapshot([otherPidSession]), () => win as never)

      expect(send).not.toHaveBeenCalled()
      expect(listPtyBindings()).toEqual([{ ptyId: 'pty-absent', sessionId: 'sess-g' }])

      const reappeared = makeSession({ pid, sessionId: 'sess-h', startedAt: 1000 })
      refreshPtyBindings(makeSnapshot([reappeared]), () => win as never)

      expect(send).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith(expect.any(String), {
        ptyId: 'pty-absent',
        sessionId: 'sess-h'
      })
    })

    it('releasePtyBinding stops future refreshes from touching that pty', async () => {
      const { registerPendingSpawn, reconcilePendingSpawns, refreshPtyBindings, releasePtyBinding } =
        await loadReconcile()
      const pid = 2005
      const original = makeSession({ pid, sessionId: 'sess-i', startedAt: 1000 })
      registerPendingSpawn('pty-release', 'proj-1', 1000)

      const send = vi.fn()
      const win = { isDestroyed: () => false, webContents: { send } }
      reconcilePendingSpawns(makeSnapshot([original]), () => win as never)
      send.mockClear()

      releasePtyBinding('pty-release')

      const rotated = makeSession({ pid, sessionId: 'sess-j', startedAt: 1000 })
      refreshPtyBindings(makeSnapshot([rotated]), () => win as never)

      expect(send).not.toHaveBeenCalled()
    })

    it('resolves the bound pid across projects: a session that moved to a different projectKey still heals the binding', async () => {
      const { registerPendingSpawn, reconcilePendingSpawns, refreshPtyBindings } = await loadReconcile()
      const pid = 2006
      const original = makeSession({ pid, sessionId: 'sess-k', startedAt: 1000 })
      registerPendingSpawn('pty-cross', 'proj-1', 1000)

      const send = vi.fn()
      const win = { isDestroyed: () => false, webContents: { send } }
      reconcilePendingSpawns(makeSnapshot([original]), () => win as never)
      send.mockClear()

      const movedProject = makeSession({ pid, sessionId: 'sess-l', startedAt: 1000 })
      refreshPtyBindings(makeSnapshot([movedProject], 'proj-2'), () => win as never)

      expect(send).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith(expect.any(String), {
        ptyId: 'pty-cross',
        sessionId: 'sess-l'
      })
    })

    it('listPtyBindings reflects the claimed binding and a subsequent rotation', async () => {
      const { registerPendingSpawn, reconcilePendingSpawns, refreshPtyBindings, listPtyBindings } =
        await loadReconcile()
      const pid = 2007
      const original = makeSession({ pid, sessionId: 'sess-m', startedAt: 1000 })
      registerPendingSpawn('pty-list', 'proj-1', 1000)

      const send = vi.fn()
      const win = { isDestroyed: () => false, webContents: { send } }
      reconcilePendingSpawns(makeSnapshot([original]), () => win as never)

      expect(listPtyBindings()).toEqual([{ ptyId: 'pty-list', sessionId: 'sess-m' }])

      const rotated = makeSession({ pid, sessionId: 'sess-n', startedAt: 1000 })
      refreshPtyBindings(makeSnapshot([rotated]), () => win as never)

      expect(listPtyBindings()).toEqual([{ ptyId: 'pty-list', sessionId: 'sess-n' }])
    })
  })
})
