import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import type { PtySessionEvent, SessionInfo, SessionsSnapshot } from '../../shared/types'
import { restoreLog } from '../lib/restoreLog'

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

// A resumed CLI may register under a NEW sessionId. Rather than sit unlinked for the full grace
// window, claim early when the evidence is unambiguous.
const EARLY_CLAIM_MIN_MS = 2500 // give the expected id a fair first chance
const EARLY_CLAIM_MAX_START_SKEW_MS = 10000 // candidate must have started right after our spawn

const pendingSpawns = new Map<string, PendingSpawn>()
const claimedSessionIds = new Set<string>()
const bindings = new Map<string, { pid: number; sessionId: string; procStart?: number }>()

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

export function isPendingSpawn(ptyId: string): boolean {
  return pendingSpawns.has(ptyId)
}

export function preclaimSession(sessionId: string): void {
  claimedSessionIds.add(sessionId)
}

export function releasePtyBinding(ptyId: string): void {
  bindings.delete(ptyId)
}

export function listPtyBindings(): PtySessionEvent[] {
  return [...bindings].map(([ptyId, b]) => ({ ptyId, sessionId: b.sessionId }))
}

/**
 * Match pending pty spawns against the latest sessions snapshot. A pending
 * spawn with an `expectedSessionId` (a resume) links immediately once that
 * exact session is live; while it is not yet live, it holds off for
 * `RESUME_GRACE_MS` before falling through to generic matching, so a
 * booting resume never gets mislabelled with someone else's session. Once
 * `EARLY_CLAIM_MIN_MS` has elapsed, an unambiguous single candidate (no other
 * pending spawn in the project) is claimed early instead of waiting out the
 * full grace window. Otherwise (or once the grace window elapses) a pending
 * spawn claims the oldest unclaimed session in its project whose `startedAt`
 * is at or after the spawn time (within tolerance). Once claimed, a session
 * is never reassigned to a different terminal — that guarantee is
 * cross-terminal only: a bound terminal still follows its pid's current
 * sessionId as it rotates (see `refreshPtyBindings`).
 */
export function reconcilePendingSpawns(
  snapshot: SessionsSnapshot,
  getWindow: () => BrowserWindow | null
): void {
  if (pendingSpawns.size === 0) return

  const claim = (ptyId: string, session: SessionInfo, how: string): void => {
    const pending = pendingSpawns.get(ptyId)
    restoreLog('claim', {
      ptyId,
      how,
      sessionId: session.sessionId,
      pid: session.pid,
      expectedSessionId: pending?.expectedSessionId,
      elapsedMs: pending ? Date.now() - pending.spawnedAt : undefined
    })
    claimedSessionIds.add(session.sessionId)
    pendingSpawns.delete(ptyId)
    bindings.set(ptyId, {
      pid: session.pid,
      sessionId: session.sessionId,
      procStart: session.procStart
    })

    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.pty.session, { ptyId, sessionId: session.sessionId })
    }
  }

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

    if (pending.expectedSessionId) {
      const expected = project.sessions.find((s) => s.sessionId === pending.expectedSessionId)
      if (expected) {
        claim(ptyId, expected, 'expected')
        continue
      }

      const elapsed = Date.now() - pending.spawnedAt
      if (elapsed < RESUME_GRACE_MS) {
        const soleOtherPending = ![...pendingSpawns].some(
          ([id, p]) => id !== ptyId && p.projectKey === pending.projectKey
        )
        const only = candidates.length === 1 ? candidates[0] : undefined
        const earlyOk =
          elapsed >= EARLY_CLAIM_MIN_MS &&
          soleOtherPending &&
          only !== undefined &&
          only.startedAt <= pending.spawnedAt + EARLY_CLAIM_MAX_START_SKEW_MS
        if (!earlyOk) continue
        claim(ptyId, only!, 'early')
        continue
      }
    }

    const match = candidates[0]
    if (!match) continue

    claim(ptyId, match, 'fallback')
  }
}

/**
 * Re-derive each bound terminal's sessionId from the latest snapshot and
 * re-emit `pty:session` when it changed (e.g. the CLI rotated its
 * sessionId under the same pid via `/clear`). The pid lookup is
 * snapshot-global so a session that drifted into a different project group
 * still resolves. A pid missing from the snapshot leaves its binding
 * untouched — only `pty:exit`/kill release a binding.
 */
export function refreshPtyBindings(
  snapshot: SessionsSnapshot,
  getWindow: () => BrowserWindow | null
): void {
  const all = snapshot.projects.flatMap((p) => p.sessions)

  for (const [ptyId, b] of bindings) {
    const live = all.find((s) => s.pid === b.pid)
    if (!live) continue

    if (
      typeof b.procStart === 'number' &&
      typeof live.procStart === 'number' &&
      live.procStart !== b.procStart
    ) {
      continue
    }

    claimedSessionIds.add(live.sessionId)

    if (live.sessionId !== b.sessionId) {
      restoreLog('rebind', { ptyId, pid: live.pid, from: b.sessionId, to: live.sessionId })
      bindings.set(ptyId, { pid: live.pid, sessionId: live.sessionId, procStart: live.procStart })

      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.pty.session, { ptyId, sessionId: live.sessionId })
      }
    }
  }
}
