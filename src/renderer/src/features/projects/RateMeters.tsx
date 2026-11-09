import { formatResetIn } from '../../../../shared/chat'
import type { RateLimitWindowId, RateLimits } from '../../../../shared/types'
import { useStore } from '../../store'

const LABELS: Record<RateLimitWindowId, string> = {
  five_hour: '5h',
  seven_day: '7d',
  seven_day_opus: '7d Opus',
  seven_day_sonnet: '7d Sonnet'
}

const resetIn = (resetsAt: number | undefined): string => formatResetIn(resetsAt, Date.now())

const shows = (l: RateLimits | undefined): l is RateLimits =>
  Boolean(l?.available && l.windows.length > 0)

function MeterGroup({
  limits,
  title,
  prefix = ''
}: {
  limits: RateLimits
  title?: string
  prefix?: string
}): React.JSX.Element {
  return (
    <>
      {title && <div className="rate-group">{title}</div>}
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
              aria-label={`${prefix}${label} usage`}
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
    </>
  )
}

export function RateMeters(): React.JSX.Element | null {
  const limits = useStore((s) => s.rateLimits)
  const second = limits?.second
  if (!limits || (!shows(limits) && !shows(second))) return null
  return (
    <div className="rate-meters">
      {shows(limits) && <MeterGroup limits={limits} title={shows(second) ? 'Claude 1' : undefined} />}
      {shows(second) && <MeterGroup limits={second} title="Claude 2" prefix="Claude 2 " />}
    </div>
  )
}
