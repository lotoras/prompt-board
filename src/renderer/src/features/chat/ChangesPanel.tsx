import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type { ChatItem, ChatMeta, DiffBlock, GitChanges } from '../../../../shared/types'
import { api } from '../../lib/api'
import { useStore } from '../../store'
import { changedFiles } from './changedFiles'
import { DiffLines } from './items/DiffLines'

const NO_ITEMS: ChatItem[] = []
const REFRESH_MS = 400
const TAGS = { added: 'new', deleted: 'deleted', renamed: 'renamed' } as const

/** One row of the panel, from git or (fallback) from the chat's Edit/Write tool results. */
interface PanelFile {
  path: string
  added: number
  removed: number
  tag?: string
  binary?: boolean
  /** Oldest first. Git files have one. */
  diffs: { id: string; diff: DiffBlock }[]
}

function fromGit(changes: GitChanges): PanelFile[] {
  return changes.files.map((f) => ({
    path: f.path,
    added: f.added,
    removed: f.removed,
    tag: f.status === 'modified' ? undefined : TAGS[f.status],
    binary: f.binary,
    diffs: [{ id: f.path, diff: f.diff }]
  }))
}

function fromTools(items: ChatItem[]): PanelFile[] {
  return changedFiles(items).map((f) => ({
    path: f.path,
    added: f.added,
    removed: f.removed,
    diffs: f.edits.map((e) => ({ id: e.id, diff: e.diff }))
  }))
}

/** The chat folder's git changes; null until known, or when the folder is not a repo. */
function useGitChanges(chat: ChatMeta, open: boolean, items: ChatItem[]): GitChanges | null {
  const [changes, setChanges] = useState<GitChanges | null>(null)
  const [focusTick, setFocusTick] = useState(0)

  useEffect(() => {
    const onFocus = (): void => setFocusTick((n) => n + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  useEffect(() => {
    if (!open || !chat.cwd || !api.git?.changes) return
    let live = true
    const load = (): void => {
      api.git
        .changes(chat.cwd)
        .then((res) => live && setChanges(res?.isRepo ? res : null))
        .catch(() => live && setChanges(null))
    }
    // The first load is immediate; later ones (new chat items, focus) wait for the stream to settle.
    const timer = setTimeout(load, changes ? REFRESH_MS : 0)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `changes` only picks the delay
  }, [open, chat.cwd, items, focusTick])

  return changes
}

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
  file: PanelFile
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
      {file.tag && <span className="cr-tag">{file.tag}</span>}
      <Stat added={file.added} removed={file.removed} />
    </button>
  )
}

/** Every change in the chat's folder (git), or the files Claude edited when it is not a repo. */
export function ChangesPanel({ chat }: { chat: ChatMeta }): React.JSX.Element | null {
  const items = useStore((s) => s.items[chat.chatId] ?? NO_ITEMS)
  const open = useStore((s) => s.changesOpen)
  const setOpen = useStore((s) => s.setChangesOpen)
  const [selected, setSelected] = useState<string | null>(null)
  const git = useGitChanges(chat, open, items)
  const files = useMemo(() => (git ? fromGit(git) : fromTools(items)), [git, items])

  if (!open || (!git && !chat.started && items.length === 0)) return null

  const current = files.find((f) => f.path === selected) ?? files[0]

  return (
    <aside className="changes" aria-label="Changes">
      <div className="changes-head">
        <span
          title={git ? `Compared with ${git.baseLabel ?? 'HEAD'}` : 'Files edited in this chat'}
        >
          {files.length} changed {files.length === 1 ? 'file' : 'files'}
        </span>
        <button type="button" className="ctl icon" aria-label="Close changes" onClick={() => setOpen(false)}>
          <X className="i sm" strokeWidth={1.8} />
        </button>
      </div>
      {!current ? (
        <div className="changes-empty">
          {git ? 'No changes in this folder yet.' : 'No files edited in this chat yet.'}
        </div>
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
            {current.binary ? (
              <div className="changes-empty">Binary file — no line changes to show.</div>
            ) : (
              current.diffs.map(({ id, diff }, i) => (
                <section key={id}>
                  {current.diffs.length > 1 && (
                    <div className="change-edit">
                      <span>{`Edit ${i + 1} of ${current.diffs.length}`}</span>
                      <Stat added={diff.added} removed={diff.removed} />
                    </div>
                  )}
                  <DiffLines diff={diff} />
                </section>
              ))
            )}
          </div>
        </>
      )}
    </aside>
  )
}
