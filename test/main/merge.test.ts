import { describe, expect, it } from 'vitest'
import { mergeSessions } from '../../src/main/sessions/merge'
import { pathKey } from '../../src/shared/pathKey'
import type { Project, SessionInfo, SessionStatus } from '../../src/shared/types'

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    projectKey: pathKey('C:\\a\\my-proj'),
    name: 'My Proj',
    basePath: 'C:\\a\\my-proj',
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    pid: 1000,
    sessionId: 'session-1',
    cwd: 'C:\\a\\my-proj',
    status: 'idle' as SessionStatus,
    startedAt: 1,
    updatedAt: 1,
    statusUpdatedAt: 1,
    procStart: 1,
    ...overrides
  }
}

describe('mergeSessions', () => {
  describe('happy path', () => {
    it('marks a matching manual project as both and keeps the manual name', () => {
      const project = makeProject({ name: 'Manual Name' })
      const session = makeSession({ cwd: 'C:\\a\\my-proj' })
      const result = mergeSessions([project], [session])
      expect(result.projects).toHaveLength(1)
      expect(result.projects[0].source).toBe('both')
      expect(result.projects[0].name).toBe('Manual Name')
      expect(result.projects[0].sessions).toEqual([session])
    })

    it('surfaces an unmatched manual project as empty and spawnable', () => {
      const project = makeProject({ projectKey: pathKey('C:\\other') })
      const result = mergeSessions([project], [])
      expect(result.projects[0].source).toBe('manual')
      expect(result.projects[0].sessions).toEqual([])
      expect(result.projects[0].needsAttention).toBe(false)
    })

    it('derives the name for an unmatched auto session group from the last path segment', () => {
      const session = makeSession({ cwd: 'C:\\a\\my-proj' })
      const result = mergeSessions([], [session])
      expect(result.projects[0].source).toBe('auto')
      expect(result.projects[0].name).toBe('my-proj')
    })

    it('derives the name correctly for a trailing-slash cwd', () => {
      const session = makeSession({ cwd: 'C:\\a\\my-proj\\' })
      const result = mergeSessions([], [session])
      expect(result.projects[0].name).toBe('my-proj')
    })
  })

  describe('edge cases', () => {
    it('groups sessions with differently-cased drives into one group', () => {
      const s1 = makeSession({ pid: 1, cwd: 'C:\\Foo' })
      const s2 = makeSession({ pid: 2, cwd: 'c:/Foo' })
      const result = mergeSessions([], [s1, s2])
      expect(result.projects).toHaveLength(1)
      expect(result.projects[0].sessions).toHaveLength(2)
    })

    it('sets needsAttention based on status and acknowledgement', () => {
      const busy = mergeSessions([], [makeSession({ status: 'busy' })])
      const idleUnacked = mergeSessions([], [makeSession({ status: 'idle' })])
      const idleAcked = mergeSessions([], [makeSession({ status: 'idle', acknowledged: true })])
      const waiting = mergeSessions([], [makeSession({ status: 'waiting' })])
      expect(busy.projects[0].needsAttention).toBe(false)
      expect(idleUnacked.projects[0].needsAttention).toBe(true)
      expect(idleAcked.projects[0].needsAttention).toBe(false)
      expect(waiting.projects[0].needsAttention).toBe(true)
    })

    it('sorts needsAttention projects first, then by latest activity', () => {
      const attentionProject = makeSession({
        pid: 1,
        cwd: 'C:\\attn',
        status: 'waiting',
        updatedAt: 1
      })
      const recentProject = makeSession({
        pid: 2,
        cwd: 'C:\\recent',
        updatedAt: 100,
        acknowledged: true
      })
      const staleProject = makeSession({
        pid: 3,
        cwd: 'C:\\stale',
        updatedAt: 10,
        acknowledged: true
      })

      const result = mergeSessions([], [staleProject, recentProject, attentionProject])
      const names = result.projects.map((p) => p.name)
      expect(names).toEqual(['attn', 'recent', 'stale'])
    })

    it('returns an empty list for empty inputs', () => {
      expect(mergeSessions([], [])).toEqual({ projects: [] })
    })

    it('handles manual-only input', () => {
      const result = mergeSessions([makeProject()], [])
      expect(result.projects).toHaveLength(1)
      expect(result.projects[0].source).toBe('manual')
    })

    it('handles sessions-only input', () => {
      const result = mergeSessions([], [makeSession()])
      expect(result.projects).toHaveLength(1)
      expect(result.projects[0].source).toBe('auto')
    })
  })
})
