import { useState } from 'react'
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react'
import type { ChatItem } from '../../../../../shared/types'
import { DiffLines } from './DiffLines'

type ToolItem = Extract<ChatItem, { kind: 'tool' }>

export function EditDiff({ item }: { item: ToolItem }): React.JSX.Element | null {
  const [open, setOpen] = useState(true)
  const diff = item.diff
  if (!diff) return null
  const Chev = open ? ChevronDown : ChevronRight
  return (
    <div className="card-x">
      <button type="button" className="cx-head" onClick={() => setOpen(!open)}>
        <Pencil className="i sm" strokeWidth={1.8} />
        <span>{item.name === 'Write' ? 'Wrote' : 'Edited'}</span>
        <span className="path">{diff.file}</span>
        <span className="right">
          <span className="add num">+{diff.added}</span>
          <span className="del num">−{diff.removed}</span>
          <Chev className="i sm" strokeWidth={1.8} />
        </span>
      </button>
      {open && <DiffLines diff={diff} />}
    </div>
  )
}
