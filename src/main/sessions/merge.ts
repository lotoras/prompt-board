import { pathKey } from '../../shared/pathKey'
import { sessionNeedsAttention } from '../../shared/types'
import type { Project, ProjectView, SessionInfo, SessionsSnapshot } from '../../shared/types'

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
  const grouped = new Map<string, SessionInfo[]>()
  for (const session of liveSessions) {
    const key = pathKey(session.cwd)
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
