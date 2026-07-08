import { api } from '../../lib/api'
import type { TerminalMeta } from '../../store/terminalsSlice'
import './terminal.css'

interface TerminalTabStripProps {
  terminals: TerminalMeta[]
  activePtyId: string | undefined
  onSelect: (ptyId: string) => void
  onClose: (ptyId: string) => void
  onNew: () => void
}

function shortId(ptyId: string): string {
  return ptyId.length > 8 ? ptyId.slice(0, 8) : ptyId
}

export function TerminalTabStrip({
  terminals,
  activePtyId,
  onSelect,
  onClose,
  onNew
}: TerminalTabStripProps): React.JSX.Element {
  const handleClose = (e: React.MouseEvent, terminal: TerminalMeta): void => {
    e.stopPropagation()
    if (terminal.status === 'running') {
      api.pty.kill(terminal.ptyId).finally(() => onClose(terminal.ptyId))
    } else {
      onClose(terminal.ptyId)
    }
  }

  return (
    <div className="terminal-tabs">
      {terminals.map((terminal) => (
        <button
          key={terminal.ptyId}
          type="button"
          className={`terminal-tabs__tab${
            terminal.ptyId === activePtyId ? ' terminal-tabs__tab--active' : ''
          }${terminal.status === 'exited' ? ' terminal-tabs__tab--exited' : ''}`}
          onClick={() => onSelect(terminal.ptyId)}
        >
          <span className="terminal-tabs__title">{terminal.title || shortId(terminal.ptyId)}</span>
          <span
            className="terminal-tabs__close"
            role="button"
            aria-label="Close terminal"
            onClick={(e) => handleClose(e, terminal)}
          >
            ×
          </span>
        </button>
      ))}
      <button type="button" className="terminal-tabs__new" onClick={onNew}>
        + New terminal
      </button>
    </div>
  )
}
