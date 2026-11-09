import { useState } from 'react'
import { Monitor } from 'lucide-react'
import { useStore } from '../../store'
import type { ChatMeta } from '../../../../shared/types'

/** IPC errors arrive wrapped ("Error invoking remote method 'x': Error: real message"). */
function cleanError(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Read-only note for a session running elsewhere, with the takeover button. */
export function ContinueHere({ chat }: { chat: ChatMeta }): React.JSX.Element {
  const takeOverChat = useStore((s) => s.takeOverChat)
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onClick = (): void => {
    if (chat.status === 'busy' && !confirming) {
      setConfirming(true)
      return
    }
    setPending(true)
    setError(null)
    takeOverChat(chat.chatId).catch((e) => {
      setError(cleanError(e))
      setPending(false)
      setConfirming(false)
    })
  }

  return (
    <div className="composer">
      <div className="readonly-note">
        <Monitor className="i" strokeWidth={1.8} />
        <span>
          {error ? (
            <b>{error}</b>
          ) : confirming ? (
            <>
              <b>Claude is working there.</b> Stopping it drops the running turn.
            </>
          ) : (
            <>
              <b>This session runs in another terminal.</b> It updates here live. Continue here ends
              it there.
            </>
          )}
        </span>
        <button type="button" className={`btn ${confirming ? 'amber' : 'outline'}`} disabled={pending} onClick={onClick}>
          {confirming ? 'Stop it and continue here' : 'Continue here'}
        </button>
      </div>
    </div>
  )
}
