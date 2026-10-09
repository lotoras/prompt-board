export function formatTokens(total: number | undefined): string {
  if (!total) return '0'
  if (total < 1000) return String(total)
  if (total < 1_000_000) return `${(total / 1000).toFixed(1)}k`
  return `${(total / 1_000_000).toFixed(1)}m`
}

export function formatRelativeTime(epochMs: number): string {
  const diffMs = Date.now() - epochMs
  const diffSec = Math.round(diffMs / 1000)
  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHour = Math.round(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`
  const diffDay = Math.round(diffHour / 24)
  return `${diffDay}d ago`
}

export function todayLocalISO(): string {
  const d = new Date()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function localDateFromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d) // NOT new Date(iso) — that parses as UTC and shifts a day
}

export function dueState(dueDate: string, today: string): 'overdue' | 'today' | 'future' {
  return dueDate < today ? 'overdue' : dueDate === today ? 'today' : 'future'
}

export function formatDueDate(dueDate: string, today: string): string {
  const MS = 86_400_000
  const n = Math.round(
    (localDateFromISO(dueDate).getTime() - localDateFromISO(today).getTime()) / MS
  )
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n < 0) return `${-n}d overdue`
  return localDateFromISO(dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
