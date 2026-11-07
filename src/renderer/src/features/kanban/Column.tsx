import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import type { KanbanCard, KanbanColumn, Project } from '../../../../shared/types'
import { CardItem } from './CardItem'

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
  const { setNodeRef, isOver } = useDroppable({ id: column.id })
  const isActionColumn = column.id === 'start-coding'

  return (
    <div className={`lane${isActionColumn ? ' start' : ''}`}>
      <div className="lane-head">
        <span>{column.title}</span>
        <span className="n num">{cards.length}</span>
        <button
          type="button"
          className="add-card"
          aria-label={`Add card to ${column.title}`}
          onClick={onAddCard}
        >
          <Plus className="i sm" strokeWidth={1.8} />
        </button>
      </div>
      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className={`lane-body${isOver ? ' over' : ''}`}>
          {isActionColumn && cards.length === 0 && (
            <div className="lane-hint">
              Drop a card here to start a chat with it.
              <br />
              The prompt is filled in, not sent.
            </div>
          )}
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
