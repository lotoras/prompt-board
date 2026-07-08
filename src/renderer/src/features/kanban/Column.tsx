import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { KanbanCard, KanbanColumn, Project } from '../../../../shared/types'
import { CardItem } from './CardItem'
import './kanban.css'

interface ColumnProps {
  column: KanbanColumn
  cards: KanbanCard[]
  showProjectTag: boolean
  projectsByKey: Map<string, Project>
  onCardClick: (id: string) => void
  onAddCard: () => void
}

export function Column({
  column,
  cards,
  showProjectTag,
  projectsByKey,
  onCardClick,
  onAddCard
}: ColumnProps): React.JSX.Element {
  const { setNodeRef } = useDroppable({ id: column.id })

  return (
    <div className="kanban-column">
      <div className="kanban-column__header">
        <span>{column.title}</span>
        <button type="button" className="kanban-column__add" onClick={onAddCard}>
          +
        </button>
      </div>
      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="kanban-column__cards">
          {cards.map((card) => (
            <CardItem
              key={card.id}
              card={card}
              showProjectTag={showProjectTag}
              projectName={projectsByKey.get(card.projectKey)?.name}
              onClick={() => onCardClick(card.id)}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  )
}
