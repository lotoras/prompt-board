import { FlaskConical, Sparkles } from 'lucide-react'
import type { ChatItem } from '../../../../../shared/types'
import { AttachmentChip } from '../Composer'

type UserItem = Extract<ChatItem, { kind: 'user' }>

export function UserMessage({ item }: { item: UserItem }): React.JSX.Element {
  const { directives, attachments } = item
  const hasChips = directives.ultra || directives.codex !== 'off' || attachments.length > 0
  return (
    <div className="u-row">
      {item.text && <div className="bubble">{item.text}</div>}
      {hasChips && (
        <div className="u-chips">
          {attachments.map((a, i) => (
            <AttachmentChip key={`${a.name}-${i}`} attachment={a} />
          ))}
          {directives.codex === 'tests' && (
            <span className="d-chip">
              <FlaskConical className="i sm" strokeWidth={1.8} />
              Codex writes tests
            </span>
          )}
          {directives.codex === 'full' && (
            <span className="d-chip">
              <FlaskConical className="i sm" strokeWidth={1.8} />
              Codex tests and review
            </span>
          )}
          {directives.ultra && (
            <span className="d-chip">
              <Sparkles className="i sm" strokeWidth={1.8} />
              Ultra
            </span>
          )}
        </div>
      )}
    </div>
  )
}
