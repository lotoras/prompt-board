import { describe, expect, it } from 'vitest'
import { diffForWrite, diffFromPatch, diffFromStrings } from '../../src/main/chat/diff'

describe('diffFromStrings', () => {
  it('counts added and removed lines and numbers from 1', () => {
    const d = diffFromStrings('a.ts', 'one\ntwo\nthree\n', 'one\nTWO\nthree\n')
    expect(d.file).toBe('a.ts')
    expect(d.added).toBe(1)
    expect(d.removed).toBe(1)
    expect(d.lines.find((l) => l.type === 'del')).toMatchObject({ text: 'two', oldNo: 2 })
    expect(d.lines.find((l) => l.type === 'add')).toMatchObject({ text: 'TWO', newNo: 2 })
    expect(d.lines[0]).toMatchObject({ type: 'ctx', text: 'one', oldNo: 1, newNo: 1 })
  })

  it('limits context to 3 lines around the change', () => {
    const oldText = Array.from({ length: 20 }, (_, i) => `l${i + 1}`).join('\n')
    const newText = oldText.replace('l10', 'CHANGED')
    const d = diffFromStrings('a.ts', oldText, newText)
    expect(d.lines.filter((l) => l.type === 'ctx')).toHaveLength(6)
    expect(d.lines.some((l) => l.text === 'l6')).toBe(false)
    expect(d.lines.some((l) => l.text === 'l7')).toBe(true)
    expect(d.lines.some((l) => l.text === 'l13')).toBe(true)
    expect(d.lines.some((l) => l.text === 'l14')).toBe(false)
  })
})

describe('diffFromPatch', () => {
  it('maps prefixed lines to ctx/add/del and advances numbers', () => {
    const d = diffFromPatch('b.ts', [
      {
        oldStart: 5,
        oldLines: 3,
        newStart: 5,
        newLines: 3,
        lines: [' keep', '-old', '+new', ' tail']
      }
    ])
    expect(d.added).toBe(1)
    expect(d.removed).toBe(1)
    expect(d.lines).toEqual([
      { type: 'ctx', text: 'keep', oldNo: 5, newNo: 5 },
      { type: 'del', text: 'old', oldNo: 6 },
      { type: 'add', text: 'new', newNo: 6 },
      { type: 'ctx', text: 'tail', oldNo: 7, newNo: 7 }
    ])
  })

  it('restarts numbering at each hunk start', () => {
    const d = diffFromPatch('b.ts', [
      { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] },
      { oldStart: 50, oldLines: 1, newStart: 60, newLines: 1, lines: ['-c', '+d'] }
    ])
    expect(d.lines.filter((l) => l.type === 'del').map((l) => l.oldNo)).toEqual([1, 50])
    expect(d.lines.filter((l) => l.type === 'add').map((l) => l.newNo)).toEqual([1, 60])
  })
})

describe('diffForWrite', () => {
  it('marks every line as an addition', () => {
    const d = diffForWrite('c.ts', 'x\ny\nz')
    expect(d.added).toBe(3)
    expect(d.removed).toBe(0)
    expect(d.lines.every((l) => l.type === 'add')).toBe(true)
    expect(d.lines.map((l) => l.newNo)).toEqual([1, 2, 3])
  })

  it('caps the output at 400 lines', () => {
    const content = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n')
    expect(diffForWrite('big.ts', content).lines.length).toBeLessThanOrEqual(400)
  })
})
