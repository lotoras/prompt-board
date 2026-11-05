import { api } from '../../lib/api'
import type { TerminalMeta } from '../../store/terminalsSlice'
import type { ClaudeAccountId } from '../../../../shared/types'

export type ReloadMode = 'resume' | 'fresh'

export interface ReloadTerminalActions {
  addTerminal: (meta: {
    ptyId: string
    projectKey: string
    title: string
    status: 'running' | 'exited'
    sessionId?: string
    account?: ClaudeAccountId
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
    freshFallback: opts?.freshFallback,
    account: terminal.account
  })
  actions.addTerminal({
    ptyId,
    projectKey: terminal.projectKey,
    title: terminal.title,
    status: 'running',
    sessionId: mode === 'resume' ? (resumed ? terminal.sessionId : undefined) : undefined,
    account: terminal.account
  })
  actions.closeTerminal(terminal.ptyId)
}
