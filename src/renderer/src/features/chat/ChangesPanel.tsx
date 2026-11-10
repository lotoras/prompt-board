import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type { ChatItem, ChatMeta } from '../../../../shared/types'
import { useStore } from '../../store'
import { changedFiles, type ChangedFile } from './changedFiles'
import { DiffLines } from './items/DiffLines'

const NO_ITEMS: ChatItem[] = []

function Stat({ added, removed }: { added: number; removed: number }): React.JSX.Element {
  return (
    <span className="cr-stat num">
      <span className="add">+{added}</span> <span className="del">−{removed}</span>
    </span>
  )
}

function FileRow({
  file,
  selected,
  onSelect
}: {
  file: ChangedFile
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const cut = Math.max(file.path.lastIndexOf('/'), file.path.lastIndexOf('\\')) + 1
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`change-row${selected ? ' on' : ''}`}
      title={file.path}
      onClick={onSelect}
    >
      <span className="cr-path">
        {file.path.slice(0, cut)}
        <b>{file.path.slice(cut)}</b>
      </span>
      <Stat added={file.added} removed={file.removed} />
    </button>
  )
}

/** The files Claude edited in this chat, and the changes of the selected file. */
export function ChangesPanel({ chat }: { chat: ChatMeta }): React.JSX.Element | null {
  const items = useStore((s) => s.items[chat.chatId] ?? NO_ITEMS)
  const open = useStore((s) => s.changesOpen)
  const setOpen = useStore((s) => s.setChangesOpen)
  const [selected, setSelected] = useState<string | null>(null)
  const files = useMemo(() => changedFiles(items), [items])

  if (!open || (!chat.started && items.length === 0)) return null

  const current = files.find((f) => f.path === selected) ?? files[0]

  return (
    <aside className="changes" aria-label="Changes">
      <div className="changes-head">
        <span>
          {files.length} changed {files.length === 1 ? 'file' : 'files'}
        </span>
        <button type="button" className="ctl icon" aria-label="Close changes" onClick={() => setOpen(false)}>
          <X className="i sm" strokeWidth={1.8} />
        </button>
      </div>
      {!current ? (
        <div className="changes-empty">No files edited in this chat yet.</div>
      ) : (
        <>
          <div className="changes-list" role="listbox" aria-label="Changed files">
            {files.map((file) => (
              <FileRow
                key={file.path}
                file={file}
                selected={file === current}
                onSelect={() => setSelected(file.path)}
              />
            ))}
          </div>
          <div key={current.path} className="changes-diff" role="region" aria-label="Diff">
            {current.edits.map((edit, i) => (
              <section key={edit.id}>
                {current.edits.length > 1 && (
                  <div className="change-edit">
                    <span>{`Edit ${i + 1} of ${current.edits.length}`}</span>
                    <Stat added={edit.diff.added} removed={edit.diff.removed} />
                  </div>
                )}
                <DiffLines diff={edit.diff} />
              </section>
            ))}
          </div>
        </>
      )}
    </aside>
  )
}
