import { formatResetIn } from '../../../../shared/chat'
import type { RateLimitWindowId } from '../../../../shared/types'
import { useStore } from '../../store'

const LABELS: Record<RateLimitWindowId, string> = {
  five_hour: '5h',
  seven_day: '7d',
  seven_day_opus: '7d Opus',
  seven_day_sonnet: '7d Sonnet'
}

const resetIn = (resetsAt: number | undefined): string => formatResetIn(resetsAt, Date.now())

export function RateMeters(): React.JSX.Element | null {
  const limits = useStore((s) => s.rateLimits)
  if (!limits || !limits.available || limits.windows.length === 0) return null
  return (
    <div className="rate-meters">
      {limits.windows.map((w) => {
        const label = LABELS[w.id]
        const pct = Math.max(0, Math.min(100, w.pct))
        const tone = pct >= 90 ? ' crit' : pct >= 70 ? ' hot' : ''
        return (
          <div key={w.id} className={`rate-row${tone}`} title={resetIn(w.resetsAt) || undefined}>
            <span className="rate-lbl">{label}</span>
            <div
              className="rate-bar"
              role="meter"
              aria-label={`${label} usage`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={w.pct}
            >
              <i style={{ width: `${pct}%` }} />
            </div>
            <span className="rate-pct num">{`${w.pct}%`}</span>
          </div>
        )
      })}
    </div>
  )
}
