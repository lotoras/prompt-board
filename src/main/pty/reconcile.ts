import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import type { SessionsSnapshot } from '../../shared/types'

interface PendingSpawn {
  projectKey: string
  spawnedAt: number
}

// Allow a small negative tolerance for clock skew between the pty spawn
// timestamp and the registry's `startedAt` (which is written by the spawned
// `clauded` process itself, slightly after we recorded the spawn time).
const START_TOLERANCE_MS = 2000

const pendingSpawns = new Map<string, PendingSpawn>()
const claimedSessionIds = new Set<string>()

export function registerPendingSpawn(ptyId: string, projectKey: string, spawnedAt: number): void {
  pendingSpawns.set(ptyId, { projectKey, spawnedAt })
}

export function clearPendingSpawn(ptyId: string): void {
  pendingSpawns.delete(ptyId)
}

/**
 * Match pending pty spawns against the latest sessions snapshot: a pending
 * spawn claims the oldest unclaimed session in its project whose
 * `startedAt` is at or after the spawn time (within tolerance). Once
 * claimed, a session is never reassigned to a different terminal.
 */
export function reconcilePendingSpawns(
  snapshot: SessionsSnapshot,
  getWindow: () => BrowserWindow | null
): void {
  if (pendingSpawns.size === 0) return

  for (const [ptyId, pending] of pendingSpawns) {
    const project = snapshot.projects.find((p) => p.projectKey === pending.projectKey)
    if (!project) continue

    const candidates = project.sessions
      .filter(
        (s) =>
          s.startedAt >= pending.spawnedAt - START_TOLERANCE_MS &&
          !claimedSessionIds.has(s.sessionId)
      )
      .sort((a, b) => a.startedAt - b.startedAt)

    const match = candidates[0]
    if (!match) continue

    claimedSessionIds.add(match.sessionId)
    pendingSpawns.delete(ptyId)

    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.pty.session, { ptyId, sessionId: match.sessionId })
    }
  }
}
