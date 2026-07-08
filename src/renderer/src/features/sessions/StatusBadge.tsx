import type { SessionStatus } from '../../../../shared/types'
import './sessions.css'

interface StatusBadgeProps {
  status: SessionStatus
  waitingFor?: string
}

export function StatusBadge({ status, waitingFor }: StatusBadgeProps): React.JSX.Element {
  const label = status === 'waiting' && waitingFor ? `waiting: ${waitingFor}` : status

  return (
    <span className={`status-badge status-badge--${status}`} title={label}>
      {label}
    </span>
  )
}
