import { useMemo } from 'react'
import { Calendar } from 'lucide-react'
import type { KanbanCard } from '../../../../shared/types'
import { GLOBAL_BOARD_PROJECT_KEY } from '../../../../shared/types'
import { useStore } from '../../store'
import { todayLocalISO, dueState, formatDueDate } from '../../lib/format'

export function AktuellesList(): React.JSX.Element {
  const cards = useStore((s) => s.boards.cards)
  const dueCards = useStore((s) => s.dueCards)
  const projects = useStore((s) => s.projects)
  const setEditingCardId = useStore((s) => s.setEditingCardId)
  const globalBoardMode = useStore((s) => s.globalBoardMode)
  const setGlobalBoardMode = useStore((s) => s.setGlobalBoardMode)

  const today = todayLocalISO()
  const rows = useMemo(() => dueCards(), [cards, dueCards])

  const projectsByKey = useMemo(() => new Map(projects.map((p) => [p.projectKey, p])), [projects])

  const overdue = rows.filter((c) => c.dueDate! < today)
  const dueToday = rows.filter((c) => c.dueDate! === today)

  const renderRow = (card: KanbanCard): React.JSX.Element => {
    const state = dueState(card.dueDate!, today)
    return (
      <button
        type="button"
        key={card.id}
        className="akt-row aktuelles-row"
        onClick={() => setEditingCardId(card.id)}
      >
        <span className="projchip">
          {card.projectKey === GLOBAL_BOARD_PROJECT_KEY
            ? 'Global'
            : (projectsByKey.get(card.projectKey)?.name ?? card.projectKey)}
        </span>
        <span className="t aktuelles-row__title">{card.title}</span>
        <span className={`due${state === 'overdue' ? ' over' : state === 'today' ? ' today' : ''}`}>
          <Calendar className="i sm" strokeWidth={1.8} />
          {formatDueDate(card.dueDate!, today)}
        </span>
      </button>
    )
  }

  const section = (title: string, list: KanbanCard[]): React.JSX.Element | null =>
    list.length === 0 ? null : (
      <>
        <div className="akt-h">
          <span className="aktuelles__section-header">{title}</span>
          <span className="n num">{list.length}</span>
        </div>
        {list.map(renderRow)}
      </>
    )

  return (
    <>
      <div className="board-head">
        <h2>Aktuelles</h2>
        <span className="sub">Due today and overdue</span>
        <span className="view-switch">
          <button
            type="button"
            className={globalBoardMode === 'board' ? 'on' : ''}
            onClick={() => setGlobalBoardMode('board')}
          >
            Board
          </button>
          <button
            type="button"
            className={globalBoardMode === 'aktuelles' ? 'on' : ''}
            onClick={() => setGlobalBoardMode('aktuelles')}
          >
            Aktuelles
          </button>
        </span>
      </div>
      <div className="akt">
        <div className="akt-inner aktuelles">
          {rows.length === 0 ? (
            <p className="aktuelles__empty" style={{ color: 'var(--muted)' }}>
              Nothing due.
            </p>
          ) : (
            <>
              {section('OVERDUE', overdue)}
              {section('TODAY', dueToday)}
            </>
          )}
        </div>
      </div>
    </>
  )
}
