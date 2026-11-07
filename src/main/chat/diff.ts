import { structuredPatch } from 'diff'
import type { DiffBlock, DiffLine } from '../../shared/types'

const WRITE_LINE_CAP = 400

export interface PatchHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

export function diffFromPatch(file: string, hunks: PatchHunk[]): DiffBlock {
  const lines: DiffLine[] = []
  let added = 0
  let removed = 0
  for (const hunk of hunks) {
    let oldNo = hunk.oldStart
    let newNo = hunk.newStart
    for (const raw of hunk.lines) {
      const mark = raw.charAt(0)
      const text = raw.slice(1)
      if (mark === '+') {
        lines.push({ type: 'add', text, newNo: newNo++ })
        added++
      } else if (mark === '-') {
        lines.push({ type: 'del', text, oldNo: oldNo++ })
        removed++
      } else if (mark === ' ') {
        lines.push({ type: 'ctx', text, oldNo: oldNo++, newNo: newNo++ })
      }
    }
  }
  return { file, added, removed, lines }
}

export function diffFromStrings(file: string, oldText: string, newText: string): DiffBlock {
  const patch = structuredPatch(file, file, oldText, newText, '', '', { context: 3 })
  return diffFromPatch(file, patch.hunks)
}

export function diffForWrite(file: string, content: string): DiffBlock {
  const all = content.split('\n')
  const lines: DiffLine[] = all
    .slice(0, WRITE_LINE_CAP)
    .map((text, i) => ({ type: 'add', text, newNo: i + 1 }))
  return { file, added: all.length, removed: 0, lines }
}
