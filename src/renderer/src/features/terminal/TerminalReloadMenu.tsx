import { useState } from 'react'
import type { TerminalMeta } from '../../store/terminalsSlice'
import type { ReloadMode } from './reloadTerminal'
import './terminal.css'

interface TerminalReloadMenuProps {
  terminal: TerminalMeta
  x: number
  y: number
  onPick: (mode: ReloadMode) => void
  onClose: () => void
}

function shortId(sessionId: string): string {
  return sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId
}

export function TerminalReloadMenu({
  terminal,
  x,
  y,
  onPick,
  onClose
}: TerminalReloadMenuProps): React.JSX.Element {
  const [pendingMode, setPendingMode] = useState<ReloadMode | null>(null)

  const handlePick = (mode: ReloadMode): void => {
    if (terminal.status === 'running') {
      setPendingMode(mode)
    } else {
      onPick(mode)
    }
  }

  return (
    <div className="terminal-reload-menu__backdrop" onClick={onClose}>
      <div
        className="terminal-reload-menu"
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
      >
        {pendingMode ? (
          <div className="terminal-reload-menu__confirm">
            <p className="terminal-reload-menu__warning">
              This terminal is still running — reloading ends it.
            </p>
            <button
              type="button"
              className="terminal-reload-menu__confirm-btn"
              onClick={() => onPick(pendingMode)}
            >
              Reload
            </button>
            <button
              type="button"
              className="terminal-reload-menu__cancel-btn"
              onClick={() => setPendingMode(null)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              className="terminal-reload-menu__option"
              disabled={!terminal.sessionId}
              onClick={() => handlePick('resume')}
            >
              <span className="terminal-reload-menu__option-title">Resume previous session</span>
              {terminal.sessionId && (
                <span className="terminal-reload-menu__option-subtitle">
                  {shortId(terminal.sessionId)}
                </span>
              )}
            </button>
            <button
              type="button"
              className="terminal-reload-menu__option"
              onClick={() => handlePick('fresh')}
            >
              <span className="terminal-reload-menu__option-title">Start fresh</span>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
