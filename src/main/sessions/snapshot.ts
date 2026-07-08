import type { SessionInfo, SessionsSnapshot } from '../../shared/types'
import { listProjects } from '../projects/store'
import { filterAliveSessions } from './liveness'
import { mergeSessions } from './merge'
import { readRegistry } from './registry'
import { locateTranscript, tailTranscript } from './transcript'

async function enrichSession(session: SessionInfo): Promise<SessionInfo> {
  const path = await locateTranscript(session.sessionId)
  if (!path) return session
  const enrichment = await tailTranscript(path)
  return {
    ...session,
    aiTitle: enrichment.aiTitle ?? session.aiTitle,
    model: enrichment.model ?? session.model,
    totalTokens: enrichment.totalTokens ?? session.totalTokens
  }
}

/**
 * Build the full sessions snapshot: read the live registry, filter by
 * liveness (PID-reuse guard), enrich with transcript data, and merge with
 * manually configured projects.
 */
export async function buildSnapshot(): Promise<SessionsSnapshot> {
  const [registry, manualProjects] = await Promise.all([readRegistry(), listProjects()])
  const alive = await filterAliveSessions(registry)
  const enriched = await Promise.all(alive.map(enrichSession))
  return mergeSessions(manualProjects, enriched)
}
