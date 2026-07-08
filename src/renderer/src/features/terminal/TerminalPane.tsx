import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../../store'
import { api } from '../../lib/api'
import { TerminalTabStrip } from './TerminalTabStrip'
import { XtermView } from './XtermView'
import './terminal.css'

interface TerminalPaneProps {
  projectKey: string
}

export function TerminalPane({ projectKey }: TerminalPaneProps): React.JSX.Element {
  const terminals = useStore(useShallow((s) => s.terminalsFor(projectKey)))
  const activePtyId = useStore((s) => s.activeTabByProject[projectKey])
  const addTerminal = useStore((s) => s.addTerminal)
  const closeTerminal = useStore((s) => s.closeTerminal)
  const setActiveTab = useStore((s) => s.setActiveTab)

  const handleNew = async (): Promise<void> => {
    const { ptyId } = await api.pty.spawn({ projectKey })
    addTerminal({ ptyId, projectKey, title: '', status: 'running' })
  }

  return (
    <div className="terminal-pane">
      <TerminalTabStrip
        terminals={terminals}
        activePtyId={activePtyId}
        onSelect={(ptyId) => setActiveTab(projectKey, ptyId)}
        onClose={closeTerminal}
        onNew={handleNew}
      />
      <div className="terminal-pane__views">
        {terminals.length === 0 && (
          <div className="terminal-pane__empty">No terminals yet. Click "+ New terminal".</div>
        )}
        {terminals.map((terminal) => (
          <XtermView
            key={terminal.ptyId}
            ptyId={terminal.ptyId}
            visible={terminal.ptyId === activePtyId}
          />
        ))}
      </div>
    </div>
  )
}
