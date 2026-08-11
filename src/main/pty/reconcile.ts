import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import type { SessionsSnapshot } from '../../shared/types'

interface PendingSpawn {
  projectKey: string
  spawnedAt: number
  expectedSessionId?: string
}

// Allow a small negative tolerance for clock skew between the pty spawn
// timestamp and the registry's `startedAt` (which is written by the spawned
// `clauded` process itself, slightly after we recorded the spawn time).
const START_TOLERANCE_MS = 2000

// How long a resumed session gets to register under its expected id before
// we fall back to generic matching (and possibly repair a broken resume).
const RESUME_GRACE_MS = 15000

const pendingSpawns = new Map<string, PendingSpawn>()
const claimedSessionIds = new Set<string>()

export function registerPendingSpawn(
  ptyId: string,
  projectKey: string,
  spawnedAt: number,
  expectedSessionId?: string
): void {
  pendingSpawns.set(ptyId, { projectKey, spawnedAt, expectedSessionId })
}

export function clearPendingSpawn(ptyId: string): void {
  pendingSpawns.delete(ptyId)
}

export function preclaimSession(sessionId: string): void {
  claimedSessionIds.add(sessionId)
}

/**
 * Match pending pty spawns against the latest sessions snapshot. A pending
 * spawn with an `expectedSessionId` (a resume) links immediately once that
 * exact session is live; while it is not yet live, it holds off for
 * `RESUME_GRACE_MS` before falling through to generic matching, so a
 * booting resume never gets mislabelled with someone else's session.
 * Otherwise (or once the grace window elapses) a pending spawn claims the
 * oldest unclaimed session in its project whose `startedAt` is at or after
 * the spawn time (within tolerance). Once claimed, a session is never
 * reassigned to a different terminal.
 */
export function reconcilePendingSpawns(
  snapshot: SessionsSnapshot,
  getWindow: () => BrowserWindow | null
): void {
  if (pendingSpawns.size === 0) return

  const claim = (ptyId: string, sessionId: string): void => {
    claimedSessionIds.add(sessionId)
    pendingSpawns.delete(ptyId)

    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.pty.session, { ptyId, sessionId })
    }
  }

  for (const [ptyId, pending] of pendingSpawns) {
    const project = snapshot.projects.find((p) => p.projectKey === pending.projectKey)
    if (!project) continue

    if (pending.expectedSessionId) {
      const expected = project.sessions.find((s) => s.sessionId === pending.expectedSessionId)
      if (expected) {
        claim(ptyId, expected.sessionId)
        continue
      }
      if (Date.now() - pending.spawnedAt < RESUME_GRACE_MS) continue
    }

    const candidates = project.sessions
      .filter(
        (s) =>
          s.startedAt >= pending.spawnedAt - START_TOLERANCE_MS &&
          !claimedSessionIds.has(s.sessionId)
      )
      .sort((a, b) => a.startedAt - b.startedAt)

    const match = candidates[0]
    if (!match) continue

    claim(ptyId, match.sessionId)
  }
}
