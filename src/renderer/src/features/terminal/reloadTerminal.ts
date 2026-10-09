import { api } from '../../lib/api'
import type { TerminalMeta } from '../../store/terminalsSlice'

export type ReloadMode = 'resume' | 'fresh'

export interface ReloadTerminalActions {
  addTerminal: (meta: {
    ptyId: string
    projectKey: string
    title: string
    status: 'running' | 'exited'
    sessionId?: string
  }) => void
  closeTerminal: (ptyId: string) => void
}

export async function reloadTerminal(
  terminal: TerminalMeta,
  mode: ReloadMode,
  actions: ReloadTerminalActions,
  opts?: { freshFallback?: boolean }
): Promise<void> {
  if (terminal.status === 'running') {
    await api.pty.kill(terminal.ptyId)
  }
  const { ptyId, resumed } = await api.pty.spawn({
    projectKey: terminal.projectKey,
    resumeSessionId: mode === 'resume' ? terminal.sessionId : undefined,
    freshFallback: opts?.freshFallback
  })
  actions.addTerminal({
    ptyId,
    projectKey: terminal.projectKey,
    title: terminal.title,
    status: 'running',
    sessionId: mode === 'resume' ? (resumed ? terminal.sessionId : undefined) : undefined
  })
  actions.closeTerminal(terminal.ptyId)
}
