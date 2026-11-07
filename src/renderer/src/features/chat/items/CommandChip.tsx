import { SquarePen } from 'lucide-react'
import type { ChatItem } from '../../../../../shared/types'

export function CommandChip({
  item
}: {
  item: Extract<ChatItem, { kind: 'command' }>
}): React.JSX.Element {
  return (
    <div className="u-row">
      <span className="d-chip mono">
        <SquarePen className="i sm" strokeWidth={1.8} />
        {item.args ? `${item.name} ${item.args}` : item.name}
      </span>
    </div>
  )
}
