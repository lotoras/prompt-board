import { useEffect, useState } from 'react'
import { formatCountdown, formatResetDay, formatResetIn } from '../../../../shared/chat'
import type { RateLimitWindow, RateLimitWindowId, RateLimits } from '../../../../shared/types'
import { useStore } from '../../store'

const LABELS: Record<RateLimitWindowId, string> = {
  five_hour: '5h',
  seven_day: '7d',
  seven_day_opus: '7d Opus',
  seven_day_fable: '7d Fable',
  seven_day_sonnet: '7d Sonnet'
}

const shows = (l: RateLimits | undefined): l is RateLimits =>
  Boolean(l?.available && l.windows.length > 0)

/** Re-renders every 30 s so the countdowns stay current. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** Weekly windows with a future reset, grouped by reset minute ("7d" and "7d Fable" usually share one). */
function weeklyResets(windows: RateLimitWindow[], now: number): { labels: string[]; at: number }[] {
  const groups = new Map<number, { labels: string[]; at: number }>()
  for (const w of windows) {
    if (w.id === 'five_hour' || !w.resetsAt || w.resetsAt <= now) continue
    const key = Math.round(w.resetsAt / 60000)
    const g = groups.get(key) ?? { labels: [], at: w.resetsAt }
    g.labels.push(LABELS[w.id])
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => a.at - b.at)
}

function MeterGroup({
  limits,
  now,
  title,
  prefix = ''
}: {
  limits: RateLimits
  now: number
  title?: string
  prefix?: string
}): React.JSX.Element {
  const resets = weeklyResets(limits.windows, now)
  const firstWeekly = limits.windows.findIndex((w) => w.id !== 'five_hour')
  return (
    <>
      {title && <div className="rate-group">{title}</div>}
      {limits.windows.map((w, i) => {
        const label = LABELS[w.id]
        const pct = Math.max(0, Math.min(100, w.pct))
        const tone = pct >= 90 ? ' crit' : pct >= 70 ? ' hot' : ''
        return (
          <div key={w.id} className="rate-item">
            {i === firstWeekly &&
              resets.map((r) => (
                <div key={r.at} className="rate-reset">
                  {resets.length > 1 ? `${r.labels.join(' · ')} resets` : 'Weekly resets'}{' '}
                  <b>{formatResetDay(r.at)}</b>
                  <span className="num">{` · in ${formatCountdown(r.at, now)}`}</span>
                </div>
              ))}
            <div className={`rate-row${tone}`} title={formatResetIn(w.resetsAt, now) || undefined}>
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
          </div>
        )
      })}
    </>
  )
}

export function RateMeters(): React.JSX.Element | null {
  const limits = useStore((s) => s.rateLimits)
  const now = useNow()
  const second = limits?.second
  if (!limits || (!shows(limits) && !shows(second))) return null
  return (
    <div className="rate-meters">
      {shows(limits) && (
        <MeterGroup limits={limits} now={now} title={shows(second) ? 'Claude 1' : undefined} />
      )}
      {shows(second) && <MeterGroup limits={second} now={now} title="Claude 2" prefix="Claude 2 " />}
    </div>
  )
}
