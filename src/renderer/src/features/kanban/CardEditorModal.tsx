import { useState } from 'react'
import { RotateCcw, SquarePen, X } from 'lucide-react'
import type { KanbanCard } from '../../../../shared/types'
import { GLOBAL_BOARD_PROJECT_KEY } from '../../../../shared/types'
import { useStore } from '../../store'
import { TagInput } from './TagInput'
import { canStartInClaude, resumeSession, startInClaude } from './startInClaude'

interface CardEditorFormProps {
  card: KanbanCard
  onClose: () => void
}

function CardEditorForm({ card, onClose }: CardEditorFormProps): React.JSX.Element {
  const projects = useStore((s) => s.projects)
  const mutateBoard = useStore((s) => s.mutateBoard)
  const chats = useStore((s) => s.chats)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const setView = useStore((s) => s.setView)

  const [title, setTitle] = useState(card.title)
  const [body, setBody] = useState(card.body)
  const [tags, setTags] = useState<string[]>(card.tags)
  const [cardProjectKey, setCardProjectKey] = useState(card.projectKey)
  const [dueDate, setDueDate] = useState(card.dueDate ?? '')

  const targetProject = projects.find((p) => p.projectKey === cardProjectKey)
  const canStart = canStartInClaude(targetProject)
  const startTitle = !targetProject ? 'Assign a project with a base path to start a chat' : undefined

  const handleSave = async (): Promise<void> => {
    await mutateBoard({
      type: 'updateCard',
      id: card.id,
      patch: { title, body, tags, projectKey: cardProjectKey, dueDate: dueDate || null }
    })
    onClose()
  }

  const handleDelete = async (): Promise<void> => {
    await mutateBoard({ type: 'deleteCard', id: card.id })
    onClose()
  }

  const handleStart = async (): Promise<void> => {
    if (!targetProject) return
    await startInClaude(card, targetProject)
    onClose()
  }

  const handleResume = async (): Promise<void> => {
    if (!targetProject || !card.link) return
    const live = chats.find((c) => c.sessionId === card.link!.sessionId)
    if (live) {
      setActiveTab(live.projectKey, live.chatId)
      setView({ kind: 'project', projectKey: live.projectKey })
    } else {
      await resumeSession(card, targetProject)
    }
    onClose()
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Edit card</h2>
          <button type="button" className="ctl icon" aria-label="Close" onClick={onClose}>
            <X className="i" strokeWidth={1.8} />
          </button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label htmlFor="card-title">Title</label>
            <input
              id="card-title"
              value={title}
              placeholder="What needs doing?"
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div className="field">
            <label htmlFor="card-body">Body</label>
            <textarea
              id="card-body"
              value={body}
              placeholder="Details. Start in Claude uses these as the prompt."
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="card-tags">Tags</label>
            <TagInput id="card-tags" tags={tags} onChange={setTags} />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="card-due">Due date</label>
              <input
                id="card-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            {card.projectKey === GLOBAL_BOARD_PROJECT_KEY ||
            cardProjectKey === GLOBAL_BOARD_PROJECT_KEY ? (
              <div className="field">
                <label htmlFor="card-project">Project</label>
                <select
                  id="card-project"
                  value={cardProjectKey}
                  onChange={(e) => setCardProjectKey(e.target.value)}
                >
                  <option value={GLOBAL_BOARD_PROJECT_KEY}>Global (unassigned)</option>
                  {projects.map((p) => (
                    <option key={p.projectKey} value={p.projectKey}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div />
            )}
          </div>

          {card.link && <span className="linkchip">Linked session: {card.link.sessionId}</span>}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn danger" onClick={handleDelete}>
            Delete
          </button>
          <span className="spacer" />
          {card.link && (
            <button
              type="button"
              className="btn outline"
              disabled={!canStart}
              onClick={handleResume}
              title={startTitle}
            >
              <RotateCcw className="i sm" strokeWidth={1.8} />
              Resume session
            </button>
          )}
          <button
            type="button"
            className="btn outline"
            disabled={!canStart}
            onClick={handleStart}
            title={startTitle}
          >
            <SquarePen className="i sm" strokeWidth={1.8} />
            Start in Claude
          </button>
          <button type="button" className="btn quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

export function CardEditorModal(): React.JSX.Element | null {
  const editingCardId = useStore((s) => s.editingCardId)
  const setEditingCardId = useStore((s) => s.setEditingCardId)
  const cards = useStore((s) => s.boards.cards)

  const card = cards.find((c) => c.id === editingCardId)
  if (!card) return null

  return <CardEditorForm key={card.id} card={card} onClose={() => setEditingCardId(null)} />
}
