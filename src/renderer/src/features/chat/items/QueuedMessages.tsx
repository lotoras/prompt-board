import { useState } from 'react'
import type { ChatMeta } from '../../../../../shared/types'
import { api } from '../../../lib/api'
import { AttachmentChip } from '../Composer'

/** Messages sent while Claude works. Claude picks them up by itself unless the user stops it first
 * or takes them back with Undo. */
export function QueuedMessages({ chat }: { chat: ChatMeta }): React.JSX.Element | null {
  const queued = chat.queued ?? []
  const listKey = queued.map((m) => m.id).join()
  const [stoppedFor, setStoppedFor] = useState<string | null>(null)
  const [undoingFor, setUndoingFor] = useState<string | null>(null)

  if (queued.length === 0) return null

  const stop = (): void => {
    setStoppedFor(listKey)
    void Promise.resolve(api.chat.interrupt(chat.chatId)).catch((e) => {
      console.error(e)
      setStoppedFor(null)
    })
  }

  const undo = (): void => {
    setUndoingFor(listKey)
    // A message Claude already took stays and shows as sent; the queue update clears the rest.
    void Promise.all(queued.map((m) => api.chat.cancelQueued(chat.chatId, m.id)))
      .catch((e) => console.error(e))
      .finally(() => setUndoingFor(null))
  }

  const busy = stoppedFor === listKey || undoingFor === listKey

  return (
    <div className="queued-group">
      {queued.map((m) => (
        <div key={m.id} className="u-row">
          {m.text && <div className="bubble queued">{m.text}</div>}
          {m.attachments.length > 0 && (
            <div className="u-chips">
              {m.attachments.map((a, i) => (
                <AttachmentChip key={`${a.name}-${i}`} attachment={a} />
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="queued-actions">
        <span>Waiting for Claude</span>
        <button type="button" className="btn outline" disabled={busy} onClick={undo}>
          Undo
        </button>
        <button type="button" className="btn outline" disabled={busy} onClick={stop}>
          Stop and send now
        </button>
      </div>
    </div>
  )
}
