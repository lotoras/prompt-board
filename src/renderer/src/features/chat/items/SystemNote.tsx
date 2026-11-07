import { Webhook } from 'lucide-react'
import type { ChatItem } from '../../../../../shared/types'

export function SystemNote({
  item
}: {
  item: Extract<ChatItem, { kind: 'system' }>
}): React.JSX.Element {
  return (
    <div className="sys" style={item.tone === 'error' ? { color: 'var(--err)' } : undefined}>
      <Webhook className="i sm" strokeWidth={1.8} />
      <span>{item.text}</span>
    </div>
  )
}
