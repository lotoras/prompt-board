import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Calendar, RotateCcw } from 'lucide-react'
import type { KanbanCard } from '../../../../shared/types'
import { GLOBAL_BOARD_PROJECT_KEY, statusTone } from '../../../../shared/types'
import { todayLocalISO, dueState, formatDueDate } from '../../lib/format'
import { useStore } from '../../store'

interface CardItemContentProps {
  card: KanbanCard
  showProjectTag: boolean
  projectName?: string
}

function CardItemInner({ card, showProjectTag, projectName }: CardItemContentProps): React.JSX.Element {
  const today = todayLocalISO()
  const linkedChat = useStore((s) =>
    card.link ? s.chats.find((c) => c.sessionId === card.link!.sessionId) : undefined
  )
  const due = card.dueDate ? dueState(card.dueDate, today) : undefined
  return (
    <>
      <div className="t">{card.title}</div>
      <div className="row">
        {showProjectTag && card.projectKey !== GLOBAL_BOARD_PROJECT_KEY && (
          <span className="projchip">{projectName ?? card.projectKey}</span>
        )}
        {card.tags.map((tag) => (
          <span key={tag} className="tag">
            {tag}
          </span>
        ))}
        {card.dueDate && (
          <span className={`due${due === 'overdue' ? ' over' : due === 'today' ? ' today' : ''}`}>
            <Calendar className="i sm" strokeWidth={1.8} />
            {formatDueDate(card.dueDate, today)}
          </span>
        )}
        {card.link && (
          <span className="linkchip">
            {linkedChat ? (
              <span className={`dot ${statusTone(linkedChat)}`} />
            ) : (
              <RotateCcw className="i sm" strokeWidth={1.8} />
            )}
            Chat
          </span>
        )}
      </div>
    </>
  )
}

export function CardItemOverlay({ card, showProjectTag, projectName }: CardItemContentProps): React.JSX.Element {
  return (
    <div className="kcard overlay">
      <CardItemInner card={card} showProjectTag={showProjectTag} projectName={projectName} />
    </div>
  )
}

interface CardItemProps extends CardItemContentProps {
  onClick: () => void
}

export function CardItem({ card, showProjectTag, projectName, onClick }: CardItemProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id })
  const style = { transform: CSS.Transform.toString(transform), transition, touchAction: 'none' as const }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`kcard${isDragging ? ' dragging' : ''}`}
      onClick={onClick}
    >
      <CardItemInner card={card} showProjectTag={showProjectTag} projectName={projectName} />
    </div>
  )
}
