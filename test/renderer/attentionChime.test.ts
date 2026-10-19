import { describe, expect, it, vi } from 'vitest'
import {
  createAttentionChime,
  newlyNeedingAttention
} from '../../src/renderer/src/features/sessions/attentionChime'
import type {
  ProjectView,
  SessionInfo,
  SessionsSnapshot
} from '../../src/shared/types'

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    pid: 100,
    sessionId: 's1',
    cwd: 'C:\\proj',
    status: 'busy',
    startedAt: 1000,
    updatedAt: 1000,
    statusUpdatedAt: 1000,
    ...overrides
  }
}

function project(projectKey: string, sessions: SessionInfo[]): ProjectView {
  return { projectKey, name: projectKey, source: 'auto', needsAttention: false, sessions }
}

function snap(...projects: ProjectView[]): SessionsSnapshot {
  return { projects }
}

function one(s: SessionInfo): SessionsSnapshot {
  return snap(project('p1', [s]))
}

describe('newlyNeedingAttention', () => {
  it('returns the id for busy -> idle with a new statusUpdatedAt', () => {
    const prev = one(session({ status: 'busy', statusUpdatedAt: 1000 }))
    const next = one(session({ status: 'idle', statusUpdatedAt: 2000 }))
    expect(newlyNeedingAttention(prev, next)).toEqual(['s1'])
  })

  it('returns the id for busy -> waiting', () => {
    const prev = one(session({ status: 'busy', statusUpdatedAt: 1000 }))
    const next = one(session({ status: 'waiting', statusUpdatedAt: 2000 }))
    expect(newlyNeedingAttention(prev, next)).toEqual(['s1'])
  })

  it('returns the id for acknowledged idle -> waiting with a new statusUpdatedAt', () => {
    const prev = one(session({ status: 'idle', acknowledged: true, statusUpdatedAt: 1000 }))
    const next = one(session({ status: 'waiting', acknowledged: false, statusUpdatedAt: 2000 }))
    expect(newlyNeedingAttention(prev, next)).toEqual(['s1'])
  })

  it('returns [] when the session is absent from prev', () => {
    const prev = one(session({ sessionId: 'other', status: 'busy' }))
    const next = snap(
      project('p1', [session({ sessionId: 'other', status: 'busy' })]),
      project('p2', [session({ sessionId: 'new', status: 'idle', statusUpdatedAt: 2000 })])
    )
    expect(newlyNeedingAttention(prev, next)).toEqual([])
  })

  it('returns [] for the first snapshot from an empty one', () => {
    const next = one(session({ status: 'idle', statusUpdatedAt: 2000 }))
    expect(newlyNeedingAttention({ projects: [] }, next)).toEqual([])
  })

  it('returns [] for unchanged attention -> attention', () => {
    const prev = one(session({ status: 'idle', statusUpdatedAt: 1000 }))
    const next = one(session({ status: 'waiting', statusUpdatedAt: 2000 }))
    expect(newlyNeedingAttention(prev, next)).toEqual([])
    expect(newlyNeedingAttention(prev, prev)).toEqual([])
  })

  it('returns [] for attention -> busy', () => {
    const prev = one(session({ status: 'idle', statusUpdatedAt: 1000 }))
    const next = one(session({ status: 'busy', statusUpdatedAt: 2000 }))
    expect(newlyNeedingAttention(prev, next)).toEqual([])
  })

  it('returns [] for un-acknowledge (same statusUpdatedAt, acknowledged true -> false)', () => {
    const prev = one(session({ status: 'idle', acknowledged: true, statusUpdatedAt: 1000 }))
    const next = one(session({ status: 'idle', acknowledged: false, statusUpdatedAt: 1000 }))
    expect(newlyNeedingAttention(prev, next)).toEqual([])
  })

  it('matches sessions by sessionId across multiple projects', () => {
    const prev = snap(
      project('p1', [session({ sessionId: 'a', status: 'busy', statusUpdatedAt: 1000 })]),
      project('p2', [session({ sessionId: 'b', status: 'busy', statusUpdatedAt: 1000 })])
    )
    const next = snap(
      project('p1', [session({ sessionId: 'a', status: 'idle', statusUpdatedAt: 2000 })]),
      project('p2', [session({ sessionId: 'b', status: 'busy', statusUpdatedAt: 1000 })])
    )
    expect(newlyNeedingAttention(prev, next)).toEqual(['a'])
  })

  it('returns every transitioning id across projects', () => {
    const prev = snap(
      project('p1', [session({ sessionId: 'a', status: 'busy', statusUpdatedAt: 1000 })]),
      project('p2', [session({ sessionId: 'b', status: 'busy', statusUpdatedAt: 1000 })])
    )
    const next = snap(
      project('p1', [session({ sessionId: 'a', status: 'idle', statusUpdatedAt: 2000 })]),
      project('p2', [session({ sessionId: 'b', status: 'waiting', statusUpdatedAt: 2000 })])
    )
    expect([...newlyNeedingAttention(prev, next)].sort()).toEqual(['a', 'b'])
  })
})

describe('createAttentionChime', () => {
  const busy = snap(
    project('p1', [
      session({ sessionId: 'a', status: 'busy', statusUpdatedAt: 1000 }),
      session({ sessionId: 'b', status: 'busy', statusUpdatedAt: 1000 })
    ])
  )
  const done = snap(
    project('p1', [
      session({ sessionId: 'a', status: 'idle', statusUpdatedAt: 2000 }),
      session({ sessionId: 'b', status: 'waiting', statusUpdatedAt: 2000 })
    ])
  )

  it('plays exactly once when two sessions transition in one snapshot', () => {
    const play = vi.fn()
    const onSnapshot = createAttentionChime({ play, isEnabled: () => true, now: () => 10_000 })
    onSnapshot(busy, done)
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('suppresses a second transition within minGapMs and plays after the gap', () => {
    const play = vi.fn()
    let t = 10_000
    const onSnapshot = createAttentionChime({
      play,
      isEnabled: () => true,
      now: () => t,
      minGapMs: 1500
    })
    onSnapshot(busy, done)
    expect(play).toHaveBeenCalledTimes(1)

    t = 10_500
    onSnapshot(busy, done)
    expect(play).toHaveBeenCalledTimes(1)

    t = 11_500
    onSnapshot(busy, done)
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('never plays when isEnabled() is false', () => {
    const play = vi.fn()
    const onSnapshot = createAttentionChime({ play, isEnabled: () => false, now: () => 10_000 })
    onSnapshot(busy, done)
    expect(play).not.toHaveBeenCalled()
  })

  it('does not play when there are no transitions', () => {
    const play = vi.fn()
    const onSnapshot = createAttentionChime({ play, isEnabled: () => true, now: () => 10_000 })
    onSnapshot(busy, busy)
    onSnapshot({ projects: [] }, done)
    expect(play).not.toHaveBeenCalled()
  })
})
