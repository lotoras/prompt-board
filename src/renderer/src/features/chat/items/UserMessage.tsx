import { useState } from 'react'
import { FlaskConical, Pencil, Sparkles } from 'lucide-react'
import type { ChatItem } from '../../../../../shared/types'
import { api } from '../../../lib/api'
import { useStore } from '../../../store'
import { AttachmentChip } from '../Composer'

type UserItem = Extract<ChatItem, { kind: 'user' }>

export function UserMessage({ chatId, item }: { chatId: string; item: UserItem }): React.JSX.Element {
  const { directives, attachments } = item
  const chat = useStore((s) => s.chats.find((c) => c.chatId === chatId))
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(item.text)
  const [revertFiles, setRevertFiles] = useState(false)
  const [sent, setSent] = useState(false)

  const hasChips = directives.think || directives.codex !== 'off' || attachments.length > 0
  const canEdit =
    !!chat && chat.mode !== 'external' && chat.status !== 'busy' && item.parentUuid !== undefined

  const submit = (): void => {
    if (!chat || !text.trim()) return
    setSent(true)
    void Promise.resolve(
      api.chat.rewind({
        chatId,
        userItemId: item.id,
        text,
        attachments: [],
        toggles: chat.toggles,
        revertFiles
      })
    )
      .then(() => setEditing(false))
      .catch((e) => console.error(e))
      .finally(() => setSent(false))
  }

  return (
    <div className="u-row">
      {editing ? (
        <div className="edit-box">
          <textarea
            autoFocus
            aria-label="Edit message text"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <label className="edit-opt">
            <input
              type="checkbox"
              aria-label="Also restore files"
              checked={revertFiles}
              onChange={(e) => setRevertFiles(e.target.checked)}
            />
            Also restore files
          </label>
          <div className="card-foot" style={{ padding: 0 }}>
            <span className="spacer" />
            <button
              type="button"
              className="btn quiet"
              onClick={() => {
                setEditing(false)
                setText(item.text)
                setRevertFiles(false)
              }}
            >
              Cancel
            </button>
            <button type="button" className="btn primary" disabled={sent || !text.trim()} onClick={submit}>
              Send edit
            </button>
          </div>
        </div>
      ) : (
        item.text && <div className="bubble">{item.text}</div>
      )}
      {canEdit && !editing && (
        <button
          type="button"
          className="edit-btn"
          aria-label="Edit message"
          title="Edit and resend from here"
          onClick={() => setEditing(true)}
        >
          <Pencil className="i sm" strokeWidth={1.8} />
        </button>
      )}
      {hasChips && (
        <div className="u-chips">
          {attachments.map((a, i) => (
            <AttachmentChip key={`${a.name}-${i}`} attachment={a} />
          ))}
          {directives.codex === 'tests' && (
            <span className="d-chip">
              <FlaskConical className="i sm" strokeWidth={1.8} />
              Codex writes tests
            </span>
          )}
          {directives.codex === 'full' && (
            <span className="d-chip">
              <FlaskConical className="i sm" strokeWidth={1.8} />
              Codex tests and review
            </span>
          )}
          {directives.think && (
            <span className="d-chip">
              <Sparkles className="i sm" strokeWidth={1.8} />
              Think harder
            </span>
          )}
        </div>
      )}
    </div>
  )
}
