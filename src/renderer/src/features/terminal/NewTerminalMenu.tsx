import { CLAUDE_ACCOUNTS, type ClaudeAccountId } from '../../../../shared/types'
import './terminal.css'

interface NewTerminalMenuProps {
  x: number
  y: number
  onPick: (account: ClaudeAccountId) => void
  onClose: () => void
}

export function NewTerminalMenu({
  x,
  y,
  onPick,
  onClose
}: NewTerminalMenuProps): React.JSX.Element {
  return (
    <div className="terminal-reload-menu__backdrop" onClick={onClose}>
      <div
        className="terminal-reload-menu"
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
      >
        {CLAUDE_ACCOUNTS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className="terminal-reload-menu__option"
            onClick={() => onPick(id)}
          >
            <span className="terminal-reload-menu__option-title">{label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
