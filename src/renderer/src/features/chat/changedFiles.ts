import type { ChatItem, DiffBlock } from '../../../../shared/types'

export type FileEdit = Extract<ChatItem, { kind: 'tool' }> & { diff: DiffBlock }

export interface ChangedFile {
  path: string
  added: number
  removed: number
  /** Oldest first. */
  edits: FileEdit[]
}

/** The files Claude edited in a chat, sorted by path. Failed edits changed nothing, so they do not count. */
export function changedFiles(items: ChatItem[]): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>()
  for (const item of items) {
    if (item.kind !== 'tool' || !item.diff || item.status === 'error') continue
    const path = item.diff.file
    let file = byPath.get(path)
    if (!file) byPath.set(path, (file = { path, added: 0, removed: 0, edits: [] }))
    file.added += item.diff.added
    file.removed += item.diff.removed
    file.edits.push(item as FileEdit)
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
}
