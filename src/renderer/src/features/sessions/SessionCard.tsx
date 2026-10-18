import type { SessionInfo } from '../../../../shared/types'
import { formatRelativeTime, formatTokens } from '../../lib/format'
import { useStore } from '../../store'
import { StatusBadge } from './StatusBadge'
import './sessions.css'

interface SessionCardProps {
  session: SessionInfo
}

export function SessionCard({ session }: SessionCardProps): React.JSX.Element {
  const acknowledgeSession = useStore((s) => s.acknowledgeSession)
  const title = session.aiTitle ?? session.name ?? session.sessionId

  return (
    <div className="session-card">
      <div className="session-card__header">
        <StatusBadge
          status={session.status}
          waitingFor={session.waitingFor}
          acknowledged={session.acknowledged}
          onAcknowledge={() => acknowledgeSession(session.sessionId, session.statusUpdatedAt)}
        />
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
