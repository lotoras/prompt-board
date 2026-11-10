import type { DiffBlock } from '../../../../../shared/types'

const MAX_LINES = 300

export function DiffLines({ diff }: { diff: DiffBlock }): React.JSX.Element {
  const shown = diff.lines.slice(0, MAX_LINES)
  return (
    <div className="diff">
      {shown.map((line, i) => (
        <div key={i} className={`dl${line.type === 'add' ? ' a' : line.type === 'del' ? ' d' : ''}`}>
          <span className="n">{line.type === 'del' ? line.oldNo : (line.newNo ?? line.oldNo)}</span>
          <span className="s">{line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}</span>
          <span className="c">{line.text}</span>
        </div>
      ))}
      {diff.lines.length > MAX_LINES && (
        <div className="diff-more">{diff.lines.length - MAX_LINES} more lines not shown</div>
      )}
    </div>
  )
}
