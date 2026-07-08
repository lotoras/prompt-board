import type { SessionInfo } from '../../../../shared/types'
import { formatRelativeTime, formatTokens } from '../../lib/format'
import { StatusBadge } from './StatusBadge'
import './sessions.css'

interface SessionCardProps {
  session: SessionInfo
}

export function SessionCard({ session }: SessionCardProps): React.JSX.Element {
  const title = session.aiTitle ?? session.sessionId

  return (
    <div className="session-card">
      <div className="session-card__header">
        <StatusBadge status={session.status} waitingFor={session.waitingFor} />
      </div>
      <div className="session-card__title" title={title}>
        {title}
      </div>
      <div className="session-card__meta">
        {session.model && <span className="session-card__model">{session.model}</span>}
        <span className="session-card__tokens">{formatTokens(session.totalTokens)} tok</span>
        <span className="session-card__time">{formatRelativeTime(session.updatedAt)}</span>
      </div>
    </div>
  )
}
