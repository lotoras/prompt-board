import { describe, expect, it } from 'vitest'
import { formatDroppedPaths } from '../../src/renderer/src/features/terminal/formatDroppedPaths'

describe('formatDroppedPaths', () => {
  describe('happy path', () => {
    it('returns a single plain path with a trailing space', () => {
      expect(formatDroppedPaths(['C:\\a\\b.txt'])).toBe('C:\\a\\b.txt ')
    })

    it('double-quotes a path containing whitespace', () => {
      expect(formatDroppedPaths(['C:\\My Files\\b.txt'])).toBe('"C:\\My Files\\b.txt" ')
    })

    it('space-joins multiple paths, quoting only ones with whitespace', () => {
      const result = formatDroppedPaths(['C:\\a\\b.txt', 'C:\\My Files\\c.txt', 'D:\\d.txt'])
      expect(result).toBe('C:\\a\\b.txt "C:\\My Files\\c.txt" D:\\d.txt ')
    })
  })

  describe('edge cases', () => {
    it('filters out blank/empty entries', () => {
      expect(formatDroppedPaths(['C:\\a\\b.txt', '', 'D:\\d.txt'])).toBe('C:\\a\\b.txt D:\\d.txt ')
    })

    it('returns an empty string for an empty array', () => {
      expect(formatDroppedPaths([])).toBe('')
    })

    it('returns an empty string when all entries are empty', () => {
      expect(formatDroppedPaths(['', ''])).toBe('')
    })
  })
})
