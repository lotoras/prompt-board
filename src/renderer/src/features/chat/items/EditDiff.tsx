import { useState } from 'react'
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react'
import type { ChatItem } from '../../../../../shared/types'

type ToolItem = Extract<ChatItem, { kind: 'tool' }>

const MAX_LINES = 300

export function EditDiff({ item }: { item: ToolItem }): React.JSX.Element | null {
  const [open, setOpen] = useState(true)
  const diff = item.diff
  if (!diff) return null
  const shown = diff.lines.slice(0, MAX_LINES)
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
      {open && (
        <div className="diff">
          {shown.map((line, i) => (
            <div
              key={i}
              className={`dl${line.type === 'add' ? ' a' : line.type === 'del' ? ' d' : ''}`}
            >
              <span className="n">{line.type === 'del' ? line.oldNo : (line.newNo ?? line.oldNo)}</span>
              <span className="s">{line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}</span>
              <span className="c">{line.text}</span>
            </div>
          ))}
          {diff.lines.length > MAX_LINES && (
            <div className="diff-more">{diff.lines.length - MAX_LINES} more lines not shown</div>
          )}
        </div>
      )}
    </div>
  )
}
