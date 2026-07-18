import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../../store'
import { api } from '../../lib/api'
import { TerminalTabStrip } from './TerminalTabStrip'
import { TerminalReloadMenu } from './TerminalReloadMenu'
import { XtermView } from './XtermView'
import { TerminalErrorBoundary } from './TerminalErrorBoundary'
import { reloadTerminal } from './reloadTerminal'
import type { TerminalMeta } from '../../store/terminalsSlice'
import { isIdleUnacknowledged, type SessionStatus } from '../../../../shared/types'
import './terminal.css'

interface TerminalPaneProps {
  projectKey: string
}

export function TerminalPane({ projectKey }: TerminalPaneProps): React.JSX.Element {
  const terminals = useStore(useShallow((s) => s.terminalsFor(projectKey)))
  const sessions = useStore(useShallow((s) => s.projectView(projectKey)?.sessions ?? []))
  const activePtyId = useStore((s) => s.activeTabByProject[projectKey])
  const addTerminal = useStore((s) => s.addTerminal)
  const closeTerminal = useStore((s) => s.closeTerminal)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const [reloadTarget, setReloadTarget] = useState<{
    terminal: TerminalMeta
    x: number
    y: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const statusByPtyId = useMemo(() => {
    const bySession = new Map(sessions.map((s) => [s.sessionId, s]))
    const map: Record<
      string,
      {
        status: SessionStatus
        waitingFor?: string
        dismissable: boolean
        sessionId: string
        statusUpdatedAt: number
      }
    > = {}
    for (const t of terminals) {
      const s = t.sessionId ? bySession.get(t.sessionId) : undefined
      if (s)
        map[t.ptyId] = {
          status: s.status,
          waitingFor: s.waitingFor,
          dismissable: isIdleUnacknowledged(s),
          sessionId: s.sessionId,
          statusUpdatedAt: s.statusUpdatedAt
        }
    }
    return map
  }, [terminals, sessions])

  const handleNew = async (): Promise<void> => {
    try {
      const { ptyId } = await api.pty.spawn({ projectKey })
      addTerminal({ ptyId, projectKey, title: '', status: 'running' })
      setError(null)
    } catch (e) {
      setError((e as Error)?.message ?? 'Failed to open terminal')
    }
  }

  return (
    <div className="terminal-pane">
      <TerminalTabStrip
        terminals={terminals}
        activePtyId={activePtyId}
        statusByPtyId={statusByPtyId}
        onSelect={(ptyId) => setActiveTab(projectKey, ptyId)}
        onClose={closeTerminal}
        onNew={handleNew}
        onReload={(t, rect) => setReloadTarget({ terminal: t, x: rect.left, y: rect.bottom })}
      />
      {reloadTarget && (
        <TerminalReloadMenu
          terminal={reloadTarget.terminal}
          x={reloadTarget.x}
          y={reloadTarget.y}
          onPick={async (mode) => {
            try {
              await reloadTerminal(reloadTarget.terminal, mode, { addTerminal, closeTerminal })
              setError(null)
            } catch (e) {
              setError((e as Error)?.message ?? 'Failed to reload terminal')
            }
            setReloadTarget(null)
          }}
          onClose={() => setReloadTarget(null)}
        />
      )}
      <div className="terminal-pane__views">
        {terminals.length === 0 && (
          <div className="terminal-pane__empty">No terminals yet. Click "+ New terminal".</div>
        )}
        {error && <div className="terminal-pane__empty">{error}</div>}
        <TerminalErrorBoundary>
          {terminals.map((terminal) => (
            <XtermView
              key={terminal.ptyId}
              ptyId={terminal.ptyId}
              visible={terminal.ptyId === activePtyId}
            />
          ))}
        </TerminalErrorBoundary>
      </div>
    </div>
  )
}
