import type { RateLimits, RateLimitWindow, RateLimitWindowId } from '../../shared/types'

const ORDER: RateLimitWindowId[] = [
  'five_hour',
  'seven_day',
  'seven_day_opus',
  'seven_day_fable',
  'seven_day_sonnet'
]
const FABLE: RateLimitWindowId = 'seven_day_fable'
const STATUSES = ['allowed', 'allowed_warning', 'rejected']

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null
}

function isWindowId(v: unknown): v is RateLimitWindowId {
  return typeof v === 'string' && (ORDER as string[]).includes(v)
}

function same(a: RateLimitWindow | undefined, b: RateLimitWindow): boolean {
  return !!a && a.pct === b.pct && a.resetsAt === b.resetsAt && a.status === b.status
}

export interface RateLimitTracker {
  applyEvent(info: unknown): boolean
  applyUsage(resp: unknown): boolean
  get(): RateLimits
}

export function createRateLimitTracker(now: () => number): RateLimitTracker {
  let available = false
  let updatedAt = 0
  const windows = new Map<RateLimitWindowId, RateLimitWindow>()

  function snapshot(): RateLimits {
    return {
      available,
      windows: ORDER.flatMap((id) => {
        const w = windows.get(id)
        return w ? [{ ...w }] : []
      }),
      updatedAt
    }
  }

  return {
    applyEvent(info: unknown): boolean {
      if (!isObj(info) || !isWindowId(info.rateLimitType)) return false
      const id = info.rateLimitType
      const prev = windows.get(id)
      let pct = prev?.pct
      if (typeof info.utilization === 'number' && Number.isFinite(info.utilization)) {
        pct = Math.round(info.utilization <= 1 ? info.utilization * 100 : info.utilization)
      }
      if (pct === undefined) return false
      const next: RateLimitWindow = { id, pct }
      if (typeof info.resetsAt === 'number' && info.resetsAt > 0) {
        next.resetsAt = info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt
      } else if (prev?.resetsAt !== undefined) next.resetsAt = prev.resetsAt
      if (typeof info.status === 'string' && STATUSES.includes(info.status)) {
        next.status = info.status as RateLimitWindow['status']
      } else if (prev?.status) next.status = prev.status
      const changed = !same(prev, next) || !available
      windows.set(id, next)
      available = true
      updatedAt = now()
      return changed
    },

    applyUsage(resp: unknown): boolean {
      const limits = isObj(resp) && resp.rate_limits_available !== false ? resp.rate_limits : null
      const nextWindows = new Map<RateLimitWindowId, RateLimitWindow>()
      if (isObj(limits)) {
        // Per-model weekly rows (e.g. "Fable"); absent = unknown this time, so keep the last value.
        const scoped = limits.model_scoped
        const fableRow = Array.isArray(scoped)
          ? scoped.find((r) => isObj(r) && String(r.display_name).toLowerCase() === 'fable')
          : undefined
        for (const id of ORDER) {
          if (id === FABLE && !Array.isArray(scoped)) {
            const kept = windows.get(FABLE)
            if (kept) nextWindows.set(FABLE, kept)
            continue
          }
          const w = id === FABLE ? fableRow : limits[id]
          if (!isObj(w) || typeof w.utilization !== 'number') continue
          const next: RateLimitWindow = { id, pct: Math.round(w.utilization) }
          const resets = typeof w.resets_at === 'string' ? Date.parse(w.resets_at) : NaN
          if (Number.isFinite(resets)) next.resetsAt = resets
          const prev = windows.get(id)
          if (prev?.status) next.status = prev.status
          nextWindows.set(id, next)
        }
      }
      const nextAvailable = isObj(limits)
      let changed = nextAvailable !== available || nextWindows.size !== windows.size
      for (const [id, w] of nextWindows) if (!same(windows.get(id), w)) changed = true
      windows.clear()
      for (const [id, w] of nextWindows) windows.set(id, w)
      available = nextAvailable
      updatedAt = now()
      return changed
    },

    get: snapshot
  }
}
