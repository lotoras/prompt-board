import { useState } from 'react'
import { ShieldCheck, ShieldQuestion, ShieldX } from 'lucide-react'
import type { ChatItem, PermissionDecision } from '../../../../../shared/types'
import { api } from '../../../lib/api'

type PermissionItem = Extract<ChatItem, { kind: 'permission' }>

export function PermissionCard({
  chatId,
  item
}: {
  chatId: string
  item: PermissionItem
}): React.JSX.Element {
  const [sent, setSent] = useState(false)

  if (item.state !== 'pending') {
    const allowed = item.state === 'allowed'
    const Icon = allowed ? ShieldCheck : ShieldX
    return (
      <div className="answered">
        <Icon className="i sm" strokeWidth={1.8} />
        <span>{item.summary || item.title}</span>
        <b>{allowed ? 'Allowed' : 'Denied'}</b>
      </div>
    )
  }

  const decide = (decision: PermissionDecision): void => {
    setSent(true)
    void Promise.resolve(api.chat.decidePermission(chatId, item.id, decision)).catch((e) => {
      console.error(e)
      setSent(false)
    })
  }

  return (
    <div className="ask">
      <div className="cx-head">
        <ShieldQuestion className="i sm" strokeWidth={1.8} />
        <span>{item.title}</span>
      </div>
      {item.description && <div className="ask-q">{item.description}</div>}
      {item.summary && (
        <div className="ask-q" style={{ fontFamily: 'var(--mono)', fontSize: 12.5, fontWeight: 400 }}>
          {item.summary}
        </div>
      )}
      <div className="card-foot">
        <button type="button" className="btn quiet" disabled={sent} onClick={() => decide({ allow: false })}>
          Deny
        </button>
        <span className="spacer" />
        {item.canAlwaysAllow && (
          <button
            type="button"
            className="btn outline"
            disabled={sent}
            onClick={() => decide({ allow: true, always: true })}
          >
            Allow for this chat
          </button>
        )}
        <button type="button" className="btn amber" disabled={sent} onClick={() => decide({ allow: true })}>
          Allow
        </button>
      </div>
    </div>
  )
}
