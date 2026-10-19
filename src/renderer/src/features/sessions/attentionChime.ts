import { sessionNeedsAttention } from '../../../../shared/types'
import type { SessionInfo, SessionsSnapshot } from '../../../../shared/types'

export function newlyNeedingAttention(prev: SessionsSnapshot, next: SessionsSnapshot): string[] {
  const before = new Map<string, SessionInfo>()
  for (const project of prev.projects) {
    for (const s of project.sessions) before.set(s.sessionId, s)
  }
  const ids: string[] = []
  for (const project of next.projects) {
    for (const s of project.sessions) {
      const old = before.get(s.sessionId)
      if (!old) continue
      if (sessionNeedsAttention(old) || !sessionNeedsAttention(s)) continue
      if (s.statusUpdatedAt === old.statusUpdatedAt) continue
      ids.push(s.sessionId)
    }
  }
  return ids
}

export function createAttentionChime(opts: {
  play: () => void
  isEnabled: () => boolean
  now?: () => number
  minGapMs?: number
}): (prev: SessionsSnapshot, next: SessionsSnapshot) => void {
  const { play, isEnabled, now = Date.now, minGapMs = 1500 } = opts
  let lastPlayed = -Infinity
  return (prev, next) => {
    if (newlyNeedingAttention(prev, next).length === 0) return
    if (!isEnabled()) return
    const t = now()
    if (t - lastPlayed < minGapMs) return
    lastPlayed = t
    play()
  }
}
