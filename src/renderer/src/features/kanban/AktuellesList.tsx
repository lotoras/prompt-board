import { useMemo } from 'react'
import type { KanbanCard } from '../../../../shared/types'
import { GLOBAL_BOARD_PROJECT_KEY } from '../../../../shared/types'
import { useStore } from '../../store'
import { todayLocalISO, dueState, formatDueDate } from '../../lib/format'
import { CardEditorModal } from './CardEditorModal'
import './kanban.css'

export function AktuellesList(): React.JSX.Element {
  const cards = useStore((s) => s.boards.cards)
  const boards = useStore((s) => s.boards.boards)
  const dueCards = useStore((s) => s.dueCards)
  const projects = useStore((s) => s.projects)
  const setEditingCardId = useStore((s) => s.setEditingCardId)

  const today = todayLocalISO()
  const rows = useMemo(() => dueCards(), [cards, dueCards])

  const projectsByKey = useMemo(() => new Map(projects.map((p) => [p.projectKey, p])), [projects])

  const columnTitleById = useMemo(() => {
    const globalBoard = boards.find((b) => b.projectKey === GLOBAL_BOARD_PROJECT_KEY)
    return new Map((globalBoard?.columns ?? []).map((c) => [c.id, c.title]))
  }, [boards])

  if (rows.length === 0) {
    return (
      <div className="aktuelles">
        <div className="aktuelles__empty">Nothing due.</div>
        <CardEditorModal />
      </div>
    )
  }

  const overdue = rows.filter((c) => c.dueDate! < today)
  const dueToday = rows.filter((c) => c.dueDate! === today)

  const renderRow = (card: KanbanCard): React.JSX.Element => (
    <div key={card.id} className="aktuelles-row" onClick={() => setEditingCardId(card.id)}>
      <span className="card-item__project-chip">
        {card.projectKey === GLOBAL_BOARD_PROJECT_KEY
          ? 'global'
          : (projectsByKey.get(card.projectKey)?.name ?? card.projectKey)}
      </span>
      <span className="aktuelles-row__title">{card.title}</span>
      <span className="aktuelles-row__column">
        {columnTitleById.get(card.columnId) ?? card.columnId}
      </span>
      <span className={`card-item__due card-item__due--${dueState(card.dueDate!, today)}`}>
        {formatDueDate(card.dueDate!, today)}
      </span>
    </div>
  )

  return (
    <div className="aktuelles">
      {overdue.length > 0 && (
        <>
          <div className="aktuelles__section-header">OVERDUE</div>
          {overdue.map(renderRow)}
        </>
      )}
      {dueToday.length > 0 && (
        <>
          <div className="aktuelles__section-header">TODAY</div>
          {dueToday.map(renderRow)}
        </>
      )}
      <CardEditorModal />
    </div>
  )
}
