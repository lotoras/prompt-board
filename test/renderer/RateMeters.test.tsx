// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../../src/renderer/src/lib/api', () => ({ api: {} }))

import { RateMeters } from '../../src/renderer/src/features/projects/RateMeters'
import { useStore } from '../../src/renderer/src/store'
import type { RateLimits } from '../../src/shared/types'
import { formatResetDay } from '../../src/shared/chat'

const NOW = 1_800_000_000_000

function seed(limits: RateLimits | null): void {
  useStore.setState({ rateLimits: limits } as never)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  seed(null)
})

describe('RateMeters', () => {
  it('renders nothing without data', () => {
    seed(null)
    render(<RateMeters />)
    expect(screen.queryByRole('meter')).toBeNull()
  })

  it('renders nothing when unavailable', () => {
    seed({ available: false, windows: [{ id: 'five_hour', pct: 10 }], updatedAt: 1 })
    render(<RateMeters />)
    expect(screen.queryByRole('meter')).toBeNull()
  })

  it('renders nothing when available but with no windows', () => {
    seed({ available: true, windows: [], updatedAt: 1 })
    render(<RateMeters />)
    expect(screen.queryByRole('meter')).toBeNull()
  })

  it('renders one meter per window with label, value and percent text', () => {
    seed({
      available: true,
      updatedAt: 1,
      windows: [
        { id: 'five_hour', pct: 42 },
        { id: 'seven_day', pct: 10 },
        { id: 'seven_day_opus', pct: 5 }
      ]
    })
    render(<RateMeters />)
    expect(screen.getAllByRole('meter')).toHaveLength(3)
    expect(screen.getByRole('meter', { name: '5h usage' }).getAttribute('aria-valuenow')).toBe('42')
    expect(screen.getByRole('meter', { name: '7d usage' }).getAttribute('aria-valuenow')).toBe('10')
    expect(screen.getByRole('meter', { name: '7d Opus usage' }).getAttribute('aria-valuenow')).toBe('5')
    expect(screen.getByText('5h')).toBeTruthy()
    expect(screen.getByText('7d Opus')).toBeTruthy()
    expect(screen.getByText('42%')).toBeTruthy()
  })

  it('labels the Sonnet window', () => {
    seed({ available: true, updatedAt: 1, windows: [{ id: 'seven_day_sonnet', pct: 3 }] })
    render(<RateMeters />)
    expect(screen.getByRole('meter', { name: '7d Sonnet usage' })).toBeTruthy()
  })

  it('labels the Fable window', () => {
    seed({ available: true, updatedAt: 1, windows: [{ id: 'seven_day_fable', pct: 7 }] })
    render(<RateMeters />)
    expect(screen.getByRole('meter', { name: '7d Fable usage' }).getAttribute('aria-valuenow')).toBe('7')
  })

  it('titles the row with the reset countdown', () => {
    seed({
      available: true,
      updatedAt: 1,
      windows: [{ id: 'five_hour', pct: 42, resetsAt: NOW + (2 * 60 + 14) * 60000 }]
    })
    render(<RateMeters />)
    expect(screen.getByTitle('Resets in 2h 14m')).toBeTruthy()
  })

  it('shows the weekly reset day and countdown once when 7d and 7d Fable share it', () => {
    const at = NOW + (2 * 1440 + 4 * 60) * 60000
    seed({
      available: true,
      updatedAt: 1,
      windows: [
        { id: 'five_hour', pct: 42, resetsAt: NOW + 60 * 60000 },
        { id: 'seven_day', pct: 10, resetsAt: at },
        { id: 'seven_day_fable', pct: 7, resetsAt: at + 20_000 }
      ]
    })
    const { container } = render(<RateMeters />)
    const lines = container.querySelectorAll('.rate-reset')
    expect(lines).toHaveLength(1)
    expect(lines[0].textContent).toBe(`Weekly resets ${formatResetDay(at)} · in 2d 4h`)
    // The line sits right above the first weekly row.
    expect(lines[0].nextElementSibling?.textContent).toContain('7d')
  })

  it('shows one labelled line per distinct weekly reset', () => {
    seed({
      available: true,
      updatedAt: 1,
      windows: [
        { id: 'seven_day', pct: 10, resetsAt: NOW + 1440 * 60000 },
        { id: 'seven_day_fable', pct: 7, resetsAt: NOW + 3 * 1440 * 60000 }
      ]
    })
    const { container } = render(<RateMeters />)
    const lines = [...container.querySelectorAll('.rate-reset')].map((l) => l.textContent)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^7d resets .* · in 1d 0h$/)
    expect(lines[1]).toMatch(/^7d Fable resets .* · in 3d 0h$/)
  })

  it('marks rows hot from 70% and crit from 90%', () => {
    seed({
      available: true,
      updatedAt: 1,
      windows: [
        { id: 'five_hour', pct: 69 },
        { id: 'seven_day', pct: 70 },
        { id: 'seven_day_opus', pct: 90 }
      ]
    })
    render(<RateMeters />)
    const m5 = screen.getByRole('meter', { name: '5h usage' })
    const m7 = screen.getByRole('meter', { name: '7d usage' })
    const mo = screen.getByRole('meter', { name: '7d Opus usage' })
    expect(m5.closest('.hot, .crit')).toBeNull()
    expect(m7.closest('.hot')).not.toBeNull()
    expect(m7.closest('.crit')).toBeNull()
    expect(mo.closest('.crit')).not.toBeNull()
  })
})
