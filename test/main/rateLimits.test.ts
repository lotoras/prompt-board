import { describe, expect, it } from 'vitest'
import { createRateLimitTracker } from '../../src/main/chat/rateLimits'

const NOW = 1_700_000_000_000

function make(now = NOW) {
  let t = now
  const tracker = createRateLimitTracker(() => t)
  return { tracker, tick: (ms: number) => (t += ms) }
}

describe('chat/rateLimits initial state', () => {
  it('starts unavailable with no windows', () => {
    expect(make().tracker.get()).toEqual({ available: false, windows: [], updatedAt: 0 })
  })
})

describe('chat/rateLimits applyEvent', () => {
  it('treats utilization <= 1 as a fraction', () => {
    const { tracker } = make()
    expect(
      tracker.applyEvent({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.42 })
    ).toBe(true)
    const limits = tracker.get()
    expect(limits.available).toBe(true)
    expect(limits.updatedAt).toBe(NOW)
    expect(limits.windows).toHaveLength(1)
    expect(limits.windows[0]).toMatchObject({ id: 'five_hour', pct: 42, status: 'allowed' })
  })

  it('treats utilization > 1 as an already-percent value (rounded)', () => {
    const { tracker } = make()
    tracker.applyEvent({ status: 'allowed', rateLimitType: 'seven_day', utilization: 55.4 })
    expect(tracker.get().windows[0]).toMatchObject({ id: 'seven_day', pct: 55 })
  })

  it('treats exactly 1 as a fraction (100 %)', () => {
    const { tracker } = make()
    tracker.applyEvent({ status: 'rejected', rateLimitType: 'five_hour', utilization: 1 })
    expect(tracker.get().windows[0].pct).toBe(100)
  })

  it('converts resetsAt in epoch seconds to ms and keeps ms values', () => {
    const a = make().tracker
    a.applyEvent({
      status: 'allowed',
      rateLimitType: 'five_hour',
      utilization: 0.1,
      resetsAt: 1_700_003_600
    })
    expect(a.get().windows[0].resetsAt).toBe(1_700_003_600_000)

    const b = make().tracker
    b.applyEvent({
      status: 'allowed',
      rateLimitType: 'five_hour',
      utilization: 0.1,
      resetsAt: 1_700_003_600_000
    })
    expect(b.get().windows[0].resetsAt).toBe(1_700_003_600_000)
  })

  it('keeps the status of each window', () => {
    const { tracker } = make()
    tracker.applyEvent({ status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.8 })
    expect(tracker.get().windows[0].status).toBe('allowed_warning')
  })

  it('ignores unknown rate limit types and junk', () => {
    const { tracker } = make()
    expect(
      tracker.applyEvent({ status: 'allowed', rateLimitType: 'overage', utilization: 0.5 })
    ).toBe(false)
    expect(tracker.applyEvent(null)).toBe(false)
    expect(tracker.applyEvent('nope')).toBe(false)
    expect(tracker.get()).toEqual({ available: false, windows: [], updatedAt: 0 })
  })

  it('returns false when the same event changes nothing, true when a value changes', () => {
    const { tracker, tick } = make()
    const ev = {
      status: 'allowed',
      rateLimitType: 'five_hour',
      utilization: 0.3,
      resetsAt: 1_700_003_600
    }
    expect(tracker.applyEvent(ev)).toBe(true)
    tick(1000)
    expect(tracker.applyEvent({ ...ev })).toBe(false)
    expect(tracker.applyEvent({ ...ev, utilization: 0.31 })).toBe(true)
    expect(tracker.applyEvent({ ...ev, utilization: 0.31, status: 'allowed_warning' })).toBe(true)
  })

  it('updates an existing window instead of adding a duplicate', () => {
    const { tracker } = make()
    tracker.applyEvent({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.1 })
    tracker.applyEvent({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.2 })
    expect(tracker.get().windows.map((w) => [w.id, w.pct])).toEqual([['five_hour', 20]])
  })
})

describe('chat/rateLimits applyUsage', () => {
  const resp = {
    rate_limits_available: true,
    rate_limits: {
      five_hour: { utilization: 31.6, resets_at: '2026-11-07T15:00:00.000Z' },
      seven_day: { utilization: 12, resets_at: '2026-11-12T10:00:00.000Z' },
      seven_day_opus: null,
      seven_day_sonnet: { utilization: null, resets_at: null }
    }
  }

  it('builds one window per present key with non-null utilization', () => {
    const { tracker } = make()
    expect(tracker.applyUsage(resp)).toBe(true)
    const limits = tracker.get()
    expect(limits.available).toBe(true)
    expect(limits.updatedAt).toBe(NOW)
    expect(limits.windows.map((w) => [w.id, w.pct])).toEqual([
      ['five_hour', 32],
      ['seven_day', 12]
    ])
  })

  it('parses ISO resets_at to epoch ms', () => {
    const { tracker } = make()
    tracker.applyUsage(resp)
    expect(tracker.get().windows[0].resetsAt).toBe(Date.parse('2026-11-07T15:00:00.000Z'))
  })

  it('goes unavailable when rate_limits_available is false', () => {
    const { tracker } = make()
    tracker.applyUsage(resp)
    expect(tracker.applyUsage({ rate_limits_available: false })).toBe(true)
    const limits = tracker.get()
    expect(limits.available).toBe(false)
    expect(limits.windows).toEqual([])
  })

  it('goes unavailable when rate_limits is missing', () => {
    const { tracker } = make()
    tracker.applyUsage(resp)
    tracker.applyUsage({ rate_limits_available: true })
    expect(tracker.get()).toMatchObject({ available: false, windows: [] })
  })

  it('returns false when nothing changed', () => {
    const { tracker, tick } = make()
    tracker.applyUsage(resp)
    tick(5000)
    expect(tracker.applyUsage(JSON.parse(JSON.stringify(resp)))).toBe(false)
  })

  const withFable = (fable: unknown) => ({
    rate_limits_available: true,
    rate_limits: {
      five_hour: { utilization: 10, resets_at: null },
      seven_day_opus: { utilization: 20, resets_at: null },
      seven_day_sonnet: { utilization: 30, resets_at: null },
      model_scoped: fable
    }
  })

  it('reads the Fable weekly window from model_scoped, placed after Opus', () => {
    const { tracker } = make()
    tracker.applyUsage(
      withFable([
        { display_name: 'Fable', utilization: 44.6, resets_at: '2026-11-12T10:00:00.000Z' }
      ])
    )
    const limits = tracker.get()
    expect(limits.windows.map((w) => [w.id, w.pct])).toEqual([
      ['five_hour', 10],
      ['seven_day_opus', 20],
      ['seven_day_fable', 45],
      ['seven_day_sonnet', 30]
    ])
    expect(limits.windows[2].resetsAt).toBe(Date.parse('2026-11-12T10:00:00.000Z'))
  })

  it('ignores other model_scoped rows and null utilization', () => {
    const { tracker } = make()
    tracker.applyUsage(
      withFable([
        { display_name: 'Mythos', utilization: 5, resets_at: null },
        { display_name: 'fable', utilization: null, resets_at: null }
      ])
    )
    expect(tracker.get().windows.map((w) => w.id)).not.toContain('seven_day_fable')
  })

  it('keeps the last Fable window when model_scoped is absent, drops it on an empty list', () => {
    const { tracker } = make()
    tracker.applyUsage(withFable([{ display_name: 'Fable', utilization: 12, resets_at: null }]))
    tracker.applyUsage(withFable(undefined))
    expect(tracker.get().windows.find((w) => w.id === 'seven_day_fable')?.pct).toBe(12)
    tracker.applyUsage(withFable([]))
    expect(tracker.get().windows.map((w) => w.id)).not.toContain('seven_day_fable')
  })
})

describe('chat/rateLimits window order', () => {
  it('orders windows five_hour, seven_day, seven_day_opus, seven_day_sonnet', () => {
    const { tracker } = make()
    for (const t of ['seven_day_sonnet', 'seven_day_opus', 'seven_day', 'five_hour']) {
      tracker.applyEvent({ status: 'allowed', rateLimitType: t, utilization: 0.5 })
    }
    expect(tracker.get().windows.map((w) => w.id)).toEqual([
      'five_hour',
      'seven_day',
      'seven_day_opus',
      'seven_day_sonnet'
    ])
  })

  it('orders usage windows the same way', () => {
    const { tracker } = make()
    tracker.applyUsage({
      rate_limits_available: true,
      rate_limits: {
        seven_day_opus: { utilization: 5, resets_at: null },
        five_hour: { utilization: 6, resets_at: null }
      }
    })
    expect(tracker.get().windows.map((w) => w.id)).toEqual(['five_hour', 'seven_day_opus'])
  })
})
