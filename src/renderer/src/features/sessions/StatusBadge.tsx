import type { SessionStatus } from '../../../../shared/types'
import './sessions.css'

interface StatusBadgeProps {
  status: SessionStatus
  waitingFor?: string
  dismissable?: boolean
  onAcknowledge?: () => void
}

export function StatusBadge({
  status,
  waitingFor,
  dismissable,
  onAcknowledge
}: StatusBadgeProps): React.JSX.Element {
  const label = status === 'waiting' && waitingFor ? `waiting: ${waitingFor}` : status
  const tone = dismissable ? 'attention' : status

  return (
    <span className={`status-badge status-badge--${tone}`} title={label}>
      {dismissable ? (
        <button
          type="button"
          className="status-badge__dot status-badge__dot--dismissable"
          title="Mark as idle"
          aria-label="Mark as idle"
          onClick={onAcknowledge}
        />
      ) : (
        <span className="status-badge__dot" aria-hidden="true" />
      )}
      {label}
    </span>
  )
}
