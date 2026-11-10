import { describe, expect, it } from 'vitest'
import { changedFiles } from '../../src/renderer/src/features/chat/changedFiles'
import type { ChatItem } from '../../src/shared/types'
import { assistant, tool } from './chatFixtures'

const edit = (id: string, file: string, added = 1, removed = 0, status = 'ok'): ChatItem =>
  tool(id, { name: 'Edit', status, diff: { file, added, removed, lines: [] } })

describe('changedFiles', () => {
  it('returns nothing without edits', () => {
    expect(changedFiles([assistant('a'), tool('r')])).toEqual([])
  })

  it('groups edits per file with totals, oldest edit first', () => {
    const [file] = changedFiles([edit('e1', 'src/a.ts', 2, 1), edit('e2', 'src/a.ts', 3, 4)])
    expect(file.path).toBe('src/a.ts')
    expect(file.added).toBe(5)
    expect(file.removed).toBe(5)
    expect(file.edits.map((e) => e.id)).toEqual(['e1', 'e2'])
  })

  it('sorts files by path', () => {
    const files = changedFiles([edit('e1', 'src/z.ts'), edit('e2', 'lib/b.ts'), edit('e3', 'src/a.ts')])
    expect(files.map((f) => f.path)).toEqual(['lib/b.ts', 'src/a.ts', 'src/z.ts'])
  })

  it('skips failed edits but keeps running ones', () => {
    const files = changedFiles([edit('e1', 'bad.ts', 1, 0, 'error'), edit('e2', 'live.ts', 1, 0, 'running')])
    expect(files.map((f) => f.path)).toEqual(['live.ts'])
  })
})
