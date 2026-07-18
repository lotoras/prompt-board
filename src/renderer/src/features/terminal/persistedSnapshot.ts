import type { PersistedTerminalsState } from '../../../../shared/types'
import type { TerminalMeta } from '../../store/terminalsSlice'

export function buildPersistedSnapshot(
  terminals: Record<string, TerminalMeta>,
  activeTabByProject: Record<string, string>
): PersistedTerminalsState {
  const survivors = Object.values(terminals).filter(
    (t): t is TerminalMeta & { sessionId: string } => t.status === 'running' && !!t.sessionId
  )

  const activeSessionByProject: Record<string, string> = {}
  for (const [projectKey, activePtyId] of Object.entries(activeTabByProject)) {
    const terminal = survivors.find((t) => t.ptyId === activePtyId)
    if (terminal) {
      activeSessionByProject[projectKey] = terminal.sessionId
    }
  }

  return {
    terminals: survivors.map((t) => ({
      projectKey: t.projectKey,
      sessionId: t.sessionId,
      title: t.title
    })),
    activeSessionByProject
  }
}
