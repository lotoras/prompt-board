import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { KanbanCard } from '../../../../shared/types'
import { GLOBAL_BOARD_PROJECT_KEY } from '../../../../shared/types'
import './kanban.css'

interface CardItemProps {
  card: KanbanCard
  showProjectTag: boolean
  projectName?: string
  onClick: () => void
}

export function CardItem({
  card,
  showProjectTag,
  projectName,
  onClick
}: CardItemProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`card-item${isDragging ? ' card-item--dragging' : ''}`}
      onClick={onClick}
    >
      {showProjectTag && (
        <span className="card-item__project-chip">
          {card.projectKey === GLOBAL_BOARD_PROJECT_KEY
            ? 'global'
            : (projectName ?? card.projectKey)}
        </span>
      )}
      <div className="card-item__title">{card.title}</div>
      {card.tags.length > 0 && (
        <div className="card-item__tags">
          {card.tags.map((tag) => (
            <span key={tag} className="tag-chip tag-chip--sm">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
