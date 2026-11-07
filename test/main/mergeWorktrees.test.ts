import { describe, expect, it } from 'vitest'
import { applyStatusOverlay, mergeSessions } from '../../src/main/sessions/merge'
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

describe('mergeSessions worktree grouping', () => {
  it('groups a session in <basePath>/.claude/worktrees/* under the manual project', () => {
    const project = makeProject()
    const wt = makeSession({
      sessionId: 'wt',
      cwd: 'C:\\a\\my-proj\\.claude\\worktrees\\feature-x'
    })
    const main = makeSession({ sessionId: 'main', pid: 1001 })
    const result = mergeSessions([project], [main, wt])
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].source).toBe('both')
    expect(result.projects[0].sessions.map((s) => s.sessionId).sort()).toEqual(['main', 'wt'])
  })

  it('marks a manual project with only a worktree session as both', () => {
    const wt = makeSession({ cwd: 'C:\\a\\my-proj\\.claude\\worktrees\\feature-x' })
    const result = mergeSessions([makeProject()], [wt])
    expect(result.projects[0].source).toBe('both')
    expect(result.projects[0].sessions).toEqual([wt])
  })

  it('does not group worktrees of an unrelated or longer-named project', () => {
    const other = makeSession({
      sessionId: 'other',
      cwd: 'C:\\a\\my-proj-2\\.claude\\worktrees\\feature-x'
    })
    const result = mergeSessions([makeProject()], [other])
    const manual = result.projects.find((p) => p.source !== 'auto')!
    expect(manual.sessions).toEqual([])
    expect(result.projects).toHaveLength(2)
  })
})

describe('applyStatusOverlay', () => {
  it('replaces status, waitingFor and statusUpdatedAt for matching sessionIds', () => {
    const a = makeSession({ sessionId: 'a', status: 'idle' })
    const b = makeSession({ sessionId: 'b', pid: 2, status: 'idle', statusUpdatedAt: 5 })
    const out = applyStatusOverlay(
      [a, b],
      new Map([['a', { status: 'waiting' as SessionStatus, waitingFor: 'question', statusUpdatedAt: 99 }]])
    )
    expect(out[0]).toMatchObject({ sessionId: 'a', status: 'waiting', waitingFor: 'question', statusUpdatedAt: 99 })
    expect(out[1]).toEqual(b)
  })

  it('does not mutate the input sessions', () => {
    const a = makeSession({ sessionId: 'a' })
    applyStatusOverlay(
      [a],
      new Map([['a', { status: 'busy' as SessionStatus, statusUpdatedAt: 50 }]])
    )
    expect(a.status).toBe('idle')
    expect(a.statusUpdatedAt).toBe(1)
  })

  it('returns equal sessions for an empty overlay', () => {
    const a = makeSession()
    expect(applyStatusOverlay([a], new Map())).toEqual([a])
  })
})
