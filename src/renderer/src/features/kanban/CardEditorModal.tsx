import { useState } from 'react'
import type { KanbanCard } from '../../../../shared/types'
import { GLOBAL_BOARD_PROJECT_KEY } from '../../../../shared/types'
import { useStore } from '../../store'
import { api } from '../../lib/api'
import { TagInput } from './TagInput'
import './kanban.css'

interface CardEditorFormProps {
  card: KanbanCard
  onClose: () => void
}

function CardEditorForm({ card, onClose }: CardEditorFormProps): React.JSX.Element {
  const projects = useStore((s) => s.projects)
  const mutateBoard = useStore((s) => s.mutateBoard)
  const addTerminal = useStore((s) => s.addTerminal)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const setPendingCardLink = useStore((s) => s.setPendingCardLink)
  const setView = useStore((s) => s.setView)
  const capsPty = api.caps.pty

  const [title, setTitle] = useState(card.title)
  const [body, setBody] = useState(card.body)
  const [tags, setTags] = useState<string[]>(card.tags)
  const [cardProjectKey, setCardProjectKey] = useState(card.projectKey)

  const targetProject = projects.find((p) => p.projectKey === cardProjectKey)
  const canStart = capsPty && targetProject !== undefined && targetProject.basePath !== ''

  const handleSave = async (): Promise<void> => {
    await mutateBoard({
      type: 'updateCard',
      id: card.id,
      patch: { title, body, tags, projectKey: cardProjectKey }
    })
    onClose()
  }

  const handleDelete = async (): Promise<void> => {
    await mutateBoard({ type: 'deleteCard', id: card.id })
    onClose()
  }

  const handleStart = async (): Promise<void> => {
    if (!targetProject) return
    const query = body ? `${title}\n\n${body}` : title
    const { ptyId } = await api.pty.spawn({ projectKey: targetProject.projectKey, initialQuery: query })
    setPendingCardLink(ptyId, card.id)
    addTerminal({ ptyId, projectKey: targetProject.projectKey, title: '', status: 'running' })
    setActiveTab(targetProject.projectKey, ptyId)
    setView({ kind: 'project', projectKey: targetProject.projectKey, tab: 'terminals' })
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit card</h2>

        <label className="modal__field">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>

        <label className="modal__field">
          Body
          <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>

        <label className="modal__field">
          Tags
          <TagInput tags={tags} onChange={setTags} />
        </label>

        {card.projectKey === GLOBAL_BOARD_PROJECT_KEY ||
        cardProjectKey === GLOBAL_BOARD_PROJECT_KEY ? (
          <label className="modal__field">
            Project
            <select value={cardProjectKey} onChange={(e) => setCardProjectKey(e.target.value)}>
              <option value={GLOBAL_BOARD_PROJECT_KEY}>Global (unassigned)</option>
              {projects.map((p) => (
                <option key={p.projectKey} value={p.projectKey}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {card.link && <span className="tag-chip session-chip">Linked session: {card.link.sessionId}</span>}

        <button
          type="button"
          className="modal__start-btn"
          disabled={!canStart}
          onClick={handleStart}
          title={
            !capsPty
              ? 'Terminals are not available yet (Phase 2)'
              : !targetProject
                ? 'Assign a project with a base path to start a terminal'
                : undefined
          }
        >
          Start in Claude
        </button>

        <div className="modal__actions">
          <button type="button" className="modal__delete" onClick={handleDelete}>
            Delete
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={handleSave}>
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
