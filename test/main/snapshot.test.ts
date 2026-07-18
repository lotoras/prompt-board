import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionInfo, SessionStatus } from '../../src/shared/types'

const {
  readRegistryMock,
  filterAliveSessionsMock,
  locateTranscriptMock,
  tailTranscriptMock,
  listProjectsMock,
  getAcksMock
} = vi.hoisted(() => ({
  readRegistryMock: vi.fn(),
  filterAliveSessionsMock: vi.fn(),
  locateTranscriptMock: vi.fn(),
  tailTranscriptMock: vi.fn(),
  listProjectsMock: vi.fn(),
  getAcksMock: vi.fn()
}))

vi.mock('../../src/main/sessions/registry', () => ({ readRegistry: readRegistryMock }))
vi.mock('../../src/main/sessions/liveness', () => ({ filterAliveSessions: filterAliveSessionsMock }))
vi.mock('../../src/main/sessions/transcript', () => ({
  locateTranscript: locateTranscriptMock,
  tailTranscript: tailTranscriptMock
}))
vi.mock('../../src/main/projects/store', () => ({ listProjects: listProjectsMock }))
vi.mock('../../src/main/sessions/acks', () => ({ getAcks: getAcksMock }))

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    pid: 1000,
    sessionId: 'session-1',
    cwd: 'C:\\a\\proj',
    status: 'idle' as SessionStatus,
    startedAt: 1,
    updatedAt: 1,
    statusUpdatedAt: 1,
    ...overrides
  }
}

describe('buildSnapshot', () => {
  beforeEach(() => {
    vi.resetModules()
    readRegistryMock.mockReset().mockResolvedValue([])
    filterAliveSessionsMock.mockReset().mockResolvedValue([])
    locateTranscriptMock.mockReset().mockResolvedValue(null)
    tailTranscriptMock.mockReset().mockResolvedValue({})
    listProjectsMock.mockReset().mockResolvedValue([])
    getAcksMock.mockReset().mockResolvedValue({})
  })

  async function loadSnapshot() {
    return import('../../src/main/sessions/snapshot')
  }

  describe('happy path', () => {
    it('keeps the other sessions when one enrichSession throws', async () => {
      const s1 = makeSession({ pid: 1, sessionId: 'a', cwd: 'C:\\a\\proj1' })
      const s2 = makeSession({ pid: 2, sessionId: 'b', cwd: 'C:\\a\\proj2' })
      readRegistryMock.mockResolvedValue([s1, s2])
      filterAliveSessionsMock.mockResolvedValue([s1, s2])
      locateTranscriptMock.mockImplementation(async (sessionId: string) =>
        sessionId === 'a' ? '/path/a.jsonl' : '/path/b.jsonl'
      )
      tailTranscriptMock.mockImplementation(async (path: string) => {
        if (path === '/path/a.jsonl') throw new Error('read failed')
        return { aiTitle: 'Title B', model: 'claude-x', totalTokens: 5 }
      })

      const { buildSnapshot } = await loadSnapshot()
      const result = await buildSnapshot()
      const sessions = result.projects.flatMap((p) => p.sessions)
      expect(sessions).toHaveLength(2)

      const rawA = sessions.find((s) => s.sessionId === 'a')
      expect(rawA?.aiTitle).toBeUndefined()

      const enrichedB = sessions.find((s) => s.sessionId === 'b')
      expect(enrichedB?.aiTitle).toBe('Title B')
    })

    it('marks an idle session acknowledged when the ack store has a matching statusUpdatedAt', async () => {
      const idle = makeSession({ sessionId: 'idle-1', status: 'idle', statusUpdatedAt: 42 })
      readRegistryMock.mockResolvedValue([idle])
      filterAliveSessionsMock.mockResolvedValue([idle])
      getAcksMock.mockResolvedValue({ 'idle-1': 42 })

      const { buildSnapshot } = await loadSnapshot()
      const result = await buildSnapshot()
      const sessions = result.projects.flatMap((p) => p.sessions)
      expect(sessions[0].acknowledged).toBe(true)
    })

    it('leaves an idle session unacknowledged when the ack is stale or missing', async () => {
      const stale = makeSession({ sessionId: 'idle-stale', status: 'idle', statusUpdatedAt: 42 })
      const missing = makeSession({ sessionId: 'idle-missing', status: 'idle', statusUpdatedAt: 42 })
      readRegistryMock.mockResolvedValue([stale, missing])
      filterAliveSessionsMock.mockResolvedValue([stale, missing])
      getAcksMock.mockResolvedValue({ 'idle-stale': 1 })

      const { buildSnapshot } = await loadSnapshot()
      const result = await buildSnapshot()
      const sessions = result.projects.flatMap((p) => p.sessions)
      expect(sessions.find((s) => s.sessionId === 'idle-stale')?.acknowledged).toBe(false)
      expect(sessions.find((s) => s.sessionId === 'idle-missing')?.acknowledged).toBe(false)
    })

    it('never marks a busy session acknowledged even with a matching ack entry', async () => {
      const busy = makeSession({ sessionId: 'busy-1', status: 'busy', statusUpdatedAt: 42 })
      readRegistryMock.mockResolvedValue([busy])
      filterAliveSessionsMock.mockResolvedValue([busy])
      getAcksMock.mockResolvedValue({ 'busy-1': 42 })

      const { buildSnapshot } = await loadSnapshot()
      const result = await buildSnapshot()
      const sessions = result.projects.flatMap((p) => p.sessions)
      expect(sessions[0].acknowledged).toBe(false)
    })
  })

  describe('edge cases / failure', () => {
    it('resolves instead of rejecting when transcript reading throws for every session', async () => {
      const s1 = makeSession()
      readRegistryMock.mockResolvedValue([s1])
      filterAliveSessionsMock.mockResolvedValue([s1])
      locateTranscriptMock.mockRejectedValue(new Error('scan failed'))

      const { buildSnapshot } = await loadSnapshot()
      const result = await buildSnapshot()
      const sessions = result.projects.flatMap((p) => p.sessions)
      expect(sessions).toEqual([{ ...s1, acknowledged: false }])
    })

    it('resolves to an empty snapshot instead of rejecting when listProjects is unavailable', async () => {
      readRegistryMock.mockResolvedValue([])
      filterAliveSessionsMock.mockResolvedValue([])
      listProjectsMock.mockRejectedValue(new Error('projects.json malformed'))

      const { buildSnapshot } = await loadSnapshot()
      await expect(buildSnapshot()).resolves.toEqual({ projects: [] })
    })
  })
})
