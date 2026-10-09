import { afterEach, describe, expect, it, vi } from 'vitest'
import { dueState, formatDueDate, todayLocalISO } from '../../src/renderer/src/lib/format'

describe('format — due dates', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('dueState', () => {
    it('returns overdue when dueDate is before today', () => {
      expect(dueState('2026-08-17', '2026-08-20')).toBe('overdue')
    })

    it('returns today when dueDate equals today', () => {
      expect(dueState('2026-08-20', '2026-08-20')).toBe('today')
    })

    it('returns future when dueDate is after today', () => {
      expect(dueState('2026-08-25', '2026-08-20')).toBe('future')
    })
  })

  describe('formatDueDate', () => {
    it('formats an overdue date as "Nd overdue"', () => {
      expect(formatDueDate('2026-08-17', '2026-08-20')).toBe('3d overdue')
    })

    it('formats today as "today"', () => {
      expect(formatDueDate('2026-08-20', '2026-08-20')).toBe('today')
    })

    it('formats tomorrow as "tomorrow"', () => {
      expect(formatDueDate('2026-08-21', '2026-08-20')).toBe('tomorrow')
    })

    it('formats a future date beyond tomorrow via toLocaleDateString', () => {
      const result = formatDueDate('2026-09-05', '2026-08-20')
      expect(result).toBe(
        new Date(2026, 8, 5).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      )
    })
  })

  describe('todayLocalISO', () => {
    it('uses local calendar components, not a UTC toISOString() shift', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 7, 20, 23, 30))
      expect(todayLocalISO()).toBe('2026-08-20')
    })

    it('zero-pads single-digit months and days', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 0, 5, 12, 0))
      expect(todayLocalISO()).toBe('2026-01-05')
    })
  })
})
