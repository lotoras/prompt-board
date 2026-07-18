import { api } from '../../lib/api'
import type { TerminalMeta } from '../../store/terminalsSlice'
import type { SessionStatus } from '../../../../shared/types'
import './terminal.css'

interface TerminalTabStripProps {
  terminals: TerminalMeta[]
  activePtyId: string | undefined
  statusByPtyId: Record<
    string,
    {
      status: SessionStatus
      waitingFor?: string
      dismissable: boolean
      sessionId: string
      statusUpdatedAt: number
    }
  >
  onSelect: (ptyId: string) => void
  onClose: (ptyId: string) => void
  onNew: () => void
  onReload: (terminal: TerminalMeta, rect: DOMRect) => void
}

function shortId(ptyId: string): string {
  return ptyId.length > 8 ? ptyId.slice(0, 8) : ptyId
}

export function TerminalTabStrip({
  terminals,
  activePtyId,
  statusByPtyId,
  onSelect,
  onClose,
  onNew,
  onReload
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
      {terminals.map((terminal) => {
        const s = statusByPtyId[terminal.ptyId]
        return (
          <button
            key={terminal.ptyId}
            type="button"
            className={`terminal-tabs__tab${
              terminal.ptyId === activePtyId ? ' terminal-tabs__tab--active' : ''
            }${terminal.status === 'exited' ? ' terminal-tabs__tab--exited' : ''}`}
            onClick={() => onSelect(terminal.ptyId)}
          >
            {s && (
              <span
                className={`terminal-tabs__status-dot terminal-tabs__status-dot--${s.dismissable ? 'attention' : s.status}${s.dismissable ? ' terminal-tabs__status-dot--dismissable' : ''}`}
                title={
                  s.dismissable
                    ? 'Mark as idle'
                    : s.status === 'waiting' && s.waitingFor
                      ? `waiting: ${s.waitingFor}`
                      : s.status
                }
                role={s.dismissable ? 'button' : undefined}
                onClick={
                  s.dismissable
                    ? (e) => {
                        e.stopPropagation()
                        void api.sessions.acknowledge(s.sessionId, s.statusUpdatedAt)
                      }
                    : undefined
                }
              />
            )}
            <span className="terminal-tabs__title">{terminal.title || shortId(terminal.ptyId)}</span>
            <span
              className="terminal-tabs__reload"
              role="button"
              aria-label="Reload terminal"
              onClick={(e) => {
                e.stopPropagation()
                onReload(terminal, e.currentTarget.getBoundingClientRect())
              }}
            >
              ↻
            </span>
            <span
              className="terminal-tabs__close"
              role="button"
              aria-label="Close terminal"
              onClick={(e) => handleClose(e, terminal)}
            >
              ×
            </span>
          </button>
        )
      })}
      <button type="button" className="terminal-tabs__new" onClick={onNew}>
        + New terminal
      </button>
    </div>
  )
}
