import { useStore } from '../../store'
import { SessionCard } from './SessionCard'
import './sessions.css'

interface SessionBoardProps {
  projectKey: string
}

export function SessionBoard({ projectKey }: SessionBoardProps): React.JSX.Element {
  const sessions = useStore((s) => s.projectView(projectKey)?.sessions ?? [])

  if (sessions.length === 0) {
    return <div className="session-board__empty">No active sessions for this project.</div>
  }

  return (
    <div className="session-board">
      {sessions.map((session) => (
        <SessionCard key={session.pid} session={session} />
      ))}
    </div>
  )
}
