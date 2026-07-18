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
  actions: ReloadTerminalActions
): Promise<void> {
  if (terminal.status === 'running') {
    await api.pty.kill(terminal.ptyId)
  }
  const { ptyId } = await api.pty.spawn({
    projectKey: terminal.projectKey,
    resumeSessionId: mode === 'resume' ? terminal.sessionId : undefined
  })
  actions.addTerminal({
    ptyId,
    projectKey: terminal.projectKey,
    title: terminal.title,
    status: 'running',
    sessionId: mode === 'resume' ? terminal.sessionId : undefined
  })
  actions.closeTerminal(terminal.ptyId)
}
