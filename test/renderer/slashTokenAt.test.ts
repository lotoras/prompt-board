import { describe, expect, it } from 'vitest'
import { slashTokenAt } from '../../src/renderer/src/features/chat/slashMatch'

describe('slashTokenAt', () => {
  it('finds a lone slash at the start', () => {
    expect(slashTokenAt('/', 1)).toEqual({ start: 0, end: 1, query: '' })
  })

  it('finds a token after text', () => {
    expect(slashTokenAt('fix it /cc', 10)).toEqual({ start: 7, end: 10, query: 'cc' })
  })

  it('accepts colons and dashes in the name', () => {
    expect(slashTokenAt('/ai-brain:cc', 12)).toEqual({ start: 0, end: 12, query: 'ai-brain:cc' })
  })

  it('ignores a slash inside a path', () => {
    expect(slashTokenAt('src/foo', 7)).toBeNull()
    expect(slashTokenAt('/usr/bin', 8)).toBeNull()
  })

  it('returns null once the cursor is past a space', () => {
    expect(slashTokenAt('a /b c', 6)).toBeNull()
  })

  it('uses the text before the cursor only', () => {
    expect(slashTokenAt('/cc and more', 3)).toEqual({ start: 0, end: 3, query: 'cc' })
  })

  it('returns null for plain text', () => {
    expect(slashTokenAt('hello', 5)).toBeNull()
  })
})
