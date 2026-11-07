import { pathKey } from '../../shared/pathKey'
import { sessionNeedsAttention } from '../../shared/types'
import type {
  Project,
  ProjectView,
  SessionInfo,
  SessionsSnapshot,
  SessionStatus
} from '../../shared/types'

export interface StatusOverlayEntry {
  status: SessionStatus
  waitingFor?: string
  statusUpdatedAt: number
}

const WORKTREES_SEGMENT = '/.claude/worktrees/'

/** Pure: replace status fields of sessions whose sessionId has an overlay entry. */
export function applyStatusOverlay(
  sessions: SessionInfo[],
  overlay: Map<string, StatusOverlayEntry>
): SessionInfo[] {
  if (overlay.size === 0) return sessions
  return sessions.map((s) => {
    const o = overlay.get(s.sessionId)
    if (!o) return s
    const rest: SessionInfo = { ...s }
    delete rest.waitingFor
    return {
      ...rest,
      status: o.status,
      ...(o.waitingFor !== undefined ? { waitingFor: o.waitingFor } : {}),
      statusUpdatedAt: o.statusUpdatedAt
    }
  })
}

function lastPathSegment(cwd: string): string {
  const normalized = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  const segments = normalized.split('/')
  return segments[segments.length - 1] || normalized
}

function latestActivity(sessions: SessionInfo[]): number {
  return sessions.reduce((latest, s) => Math.max(latest, s.updatedAt), 0)
}

/**
 * Pure reconciliation of manually configured projects with auto-discovered
 * live sessions (already enriched with transcript data), grouped by
 * `pathKey(cwd)`. A manual project whose key matches a session group
 * absorbs those sessions (`source: 'both'`, manual name wins); unmatched
 * manual projects surface as empty, spawnable entries (`source: 'manual'`);
 * unmatched session groups surface as `source: 'auto'` with a name derived
 * from the last path segment of `cwd`.
 */
export function mergeSessions(
  manualProjects: Project[],
  liveSessions: SessionInfo[]
): SessionsSnapshot {
  const manualKeys = manualProjects.map((p) => p.projectKey)
  const grouped = new Map<string, SessionInfo[]>()
  for (const session of liveSessions) {
    let key = pathKey(session.cwd)
    const owner = manualKeys.find((k) => key.startsWith(k + WORKTREES_SEGMENT))
    if (owner) key = owner
    const bucket = grouped.get(key)
    if (bucket) bucket.push(session)
    else grouped.set(key, [session])
  }

  const projects: ProjectView[] = []
  const consumedKeys = new Set<string>()

  for (const project of manualProjects) {
    const sessions = grouped.get(project.projectKey) ?? []
    consumedKeys.add(project.projectKey)
    projects.push({
      projectKey: project.projectKey,
      name: project.name,
      basePath: project.basePath,
      source: sessions.length > 0 ? 'both' : 'manual',
      needsAttention: sessions.some(sessionNeedsAttention),
      sessions
    })
  }

  for (const [key, sessions] of grouped) {
    if (consumedKeys.has(key)) continue
    projects.push({
      projectKey: key,
      name: lastPathSegment(sessions[0].cwd),
      source: 'auto',
      needsAttention: sessions.some(sessionNeedsAttention),
      sessions
    })
  }

  projects.sort((a, b) => {
    if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1
    return latestActivity(b.sessions) - latestActivity(a.sessions)
  })

  return { projects }
}
