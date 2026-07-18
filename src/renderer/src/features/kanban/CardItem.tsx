import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { KanbanCard } from '../../../../shared/types'
import { GLOBAL_BOARD_PROJECT_KEY } from '../../../../shared/types'
import './kanban.css'

interface CardItemContentProps {
  card: KanbanCard
  showProjectTag: boolean
  projectName?: string
}

function CardItemInner({ card, showProjectTag, projectName }: CardItemContentProps): React.JSX.Element {
  return (
    <>
      {showProjectTag && (
        <span className="card-item__project-chip">
          {card.projectKey === GLOBAL_BOARD_PROJECT_KEY ? 'global' : (projectName ?? card.projectKey)}
        </span>
      )}
      <div className="card-item__title">{card.title}</div>
      {card.link && <span className="tag-chip tag-chip--sm session-chip">session</span>}
      {card.tags.length > 0 && (
        <div className="card-item__tags">
          {card.tags.map((tag) => (<span key={tag} className="tag-chip tag-chip--sm">{tag}</span>))}
        </div>
      )}
    </>
  )
}

export function CardItemOverlay({ card, showProjectTag, projectName }: CardItemContentProps): React.JSX.Element {
  return (
    <div className="card-item card-item--overlay">
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
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className={`card-item${isDragging ? ' card-item--dragging' : ''}`} onClick={onClick}>
      <CardItemInner card={card} showProjectTag={showProjectTag} projectName={projectName} />
    </div>
  )
}
