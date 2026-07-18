import { useStore } from '../../store'
import { SessionCard } from './SessionCard'
import './sessions.css'

const EMPTY_SESSIONS: never[] = []

interface SessionBoardProps {
  projectKey: string
}

export function SessionBoard({ projectKey }: SessionBoardProps): React.JSX.Element {
  const sessions = useStore((s) => s.projectView(projectKey)?.sessions ?? EMPTY_SESSIONS)
  const sessionsError = useStore((s) => s.sessionsError)

  if (sessions.length === 0) {
    return (
      <>
        {sessionsError && <div className="session-board__error">{sessionsError}</div>}
        <div className="session-board__empty">No active sessions for this project.</div>
      </>
    )
  }

  return (
    <>
      {sessionsError && <div className="session-board__error">{sessionsError}</div>}
      <div className="session-board">
        {sessions.map((session) => (
          <SessionCard key={session.pid} session={session} />
        ))}
      </div>
    </>
  )
}
