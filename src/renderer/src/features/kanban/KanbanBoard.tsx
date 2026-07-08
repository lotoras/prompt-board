import { useMemo } from 'react'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import type { KanbanCard } from '../../../../shared/types'
import { GLOBAL_BOARD_PROJECT_KEY } from '../../../../shared/types'
import { useStore } from '../../store'
import { between } from '../../lib/fractionalIndex'
import { Column } from './Column'
import { CardEditorModal } from './CardEditorModal'
import { canStartInClaude, startInClaude } from './startInClaude'
import './kanban.css'

const START_CODING_COLUMN_ID = 'start-coding'
const DOING_COLUMN_ID = 'doing'

interface KanbanBoardProps {
  projectKey: string
}

function sortByOrder(cards: KanbanCard[]): KanbanCard[] {
  return [...cards].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
}

export function KanbanBoard({ projectKey }: KanbanBoardProps): React.JSX.Element {
  const boards = useStore((s) => s.boards.boards)
  const allCards = useStore((s) => s.boards.cards)
  const projects = useStore((s) => s.projects)
  const mutateBoard = useStore((s) => s.mutateBoard)
  const setEditingCardId = useStore((s) => s.setEditingCardId)
  const setPendingCardLink = useStore((s) => s.setPendingCardLink)
  const addTerminal = useStore((s) => s.addTerminal)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const setView = useStore((s) => s.setView)

  const board = boards.find((b) => b.projectKey === projectKey)
  const isGlobal = projectKey === GLOBAL_BOARD_PROJECT_KEY

  const cards = useMemo(
    () => (isGlobal ? allCards : allCards.filter((c) => c.projectKey === projectKey)),
    [isGlobal, allCards, projectKey]
  )

  const projectsByKey = useMemo(() => new Map(projects.map((p) => [p.projectKey, p])), [projects])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const columns = useMemo(
    () => (board ? [...board.columns].sort((a, b) => a.order - b.order) : []),
    [board]
  )

  const cardsByColumn = useMemo(() => {
    const map = new Map<string, KanbanCard[]>()
    for (const column of columns) {
      map.set(column.id, sortByOrder(cards.filter((c) => c.columnId === column.id)))
    }
    return map
  }, [columns, cards])

  const columnIds = new Set(columns.map((c) => c.id))

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (!over) return

    const activeCard = cards.find((c) => c.id === active.id)
    if (!activeCard) return

    let targetColumnId: string
    if (columnIds.has(String(over.id))) {
      targetColumnId = String(over.id)
    } else {
      const overCard = cards.find((c) => c.id === over.id)
      if (!overCard) return
      targetColumnId = overCard.columnId
    }

    if (targetColumnId === START_CODING_COLUMN_ID) {
      const project = projectsByKey.get(activeCard.projectKey)
      if (!canStartInClaude(project)) return

      const doingSiblings = (cardsByColumn.get(DOING_COLUMN_ID) ?? []).filter(
        (c) => c.id !== activeCard.id
      )
      const order = between(doingSiblings[doingSiblings.length - 1]?.order, undefined)

      startInClaude(activeCard, project!, {
        setPendingCardLink,
        addTerminal,
        setActiveTab,
        setView
      })
      mutateBoard({ type: 'moveCard', id: activeCard.id, columnId: DOING_COLUMN_ID, order })
      return
    }

    const siblings = (cardsByColumn.get(targetColumnId) ?? []).filter((c) => c.id !== activeCard.id)

    let insertIndex = siblings.length
    if (!columnIds.has(String(over.id))) {
      const overIndex = siblings.findIndex((c) => c.id === over.id)
      if (overIndex !== -1) insertIndex = overIndex
    }

    const before = siblings[insertIndex - 1]
    const after = siblings[insertIndex]
    const order = between(before?.order, after?.order)

    if (activeCard.columnId === targetColumnId && activeCard.order === order) return

    mutateBoard({ type: 'moveCard', id: activeCard.id, columnId: targetColumnId, order })
  }

  const handleAddCard = (columnId: string): void => {
    const targetProjectKey = isGlobal ? GLOBAL_BOARD_PROJECT_KEY : projectKey
    const siblings = cardsByColumn.get(columnId) ?? []
    const order = between(siblings[siblings.length - 1]?.order, undefined)

    mutateBoard({
      type: 'createCard',
      card: {
        projectKey: targetProjectKey,
        columnId,
        title: 'New card',
        body: '',
        tags: [],
        order
      }
    }).then(() => {
      const created = useStore
        .getState()
        .boards.cards.find(
          (c) => c.projectKey === targetProjectKey && c.columnId === columnId && c.order === order
        )
      if (created) setEditingCardId(created.id)
    })
  }

  if (!board) {
    return <div className="kanban-board__empty">Loading board…</div>
  }

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="kanban-board">
          {columns.map((column) => (
            <Column
              key={column.id}
              column={column}
              cards={cardsByColumn.get(column.id) ?? []}
              showProjectTag={isGlobal}
              projectsByKey={projectsByKey}
              onCardClick={setEditingCardId}
              onAddCard={() => handleAddCard(column.id)}
            />
          ))}
        </div>
      </DndContext>
      <CardEditorModal />
    </>
  )
}
